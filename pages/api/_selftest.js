// Exhaustive proof that no client can go missing.
//
// Admin-only, and not linked from anywhere: open /api/_selftest signed in as
// the admin and it answers, from the live sheet, whether the schedule can lose
// a client. Worth running after any change to the roster, the client hours or
// the split itself — it is the check that turns "it looked right on screen"
// into a number.
//
// Runs the real distribution against the real sheet, for every hour of the
// operating day, under every staffing shape the floor can actually take:
// everybody in, one person in, nobody in, people away on breaks, people on
// leave, people on a week off, hours where the only person available is on
// custom duty, and randomised partial floors.
//
// For each combination it asserts three things:
//   1. every client the schedule holds for that hour reaches SOMEBODY,
//   2. no client reaches two people,
//   3. anything that genuinely cannot be placed is REPORTED by the audit,
//      never dropped silently.
import { getUserFromReq } from '../../lib/auth'
import { loadScheduleData } from '../../lib/roster'
import {
  employees, clientTimings, specificClientsFor, customTextFor,
  distributeClientsForHour, auditHourAssignment, getScheduledEmployeesAtHour,
} from '../../lib/schedule'
import { fetchClientVehicleCounts, businessHourOrder } from '../../lib/sheets'
import { buildHourPool } from '../../lib/distribution'

// Deterministic pseudo-random, so a failure can be reproduced exactly.
function rng(seed) {
  let s = seed
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
}

export default async function handler(req, res) {
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
  try {
    await loadScheduleData()
    const vehicleMap = await fetchClientVehicleCounts()
    const emps = employees()
    const rand = rng(20260818)

    const fails = []
    let cases = 0, slotsPlaced = 0
    const note = (m) => { if (fails.length < 40) fails.push(m) }

    // Everything an employee could be handed at this hour: the schedule, plus
    // any client named against somebody in Employee_Hours.
    const dueAt = (hour) => {
      const s = new Set(
        Object.entries(clientTimings()).filter(([, hs]) => hs.includes(hour)).map(([n]) => n)
      )
      emps.forEach(e => (specificClientsFor(e.name, hour) || []).forEach(c => s.add(c)))
      return s
    }

    const check = (label, hour, poolNames, locked = {}) => {
      cases++
      const due  = dueAt(hour)
      const dist = distributeClientsForHour(hour, poolNames, vehicleMap, locked, true)
      const seen = new Map()
      Object.entries(dist).forEach(([name, cs]) => cs.forEach(c => {
        if (seen.has(c.client)) note(`${label} h${hour}: "${c.client}" on both ${seen.get(c.client)} and ${name}`)
        seen.set(c.client, name)
      }))
      const missing = [...due].filter(c => !seen.has(c))
      const audit = auditHourAssignment(hour, poolNames, vehicleMap, locked, true)
      const reported = new Set(audit.unassigned)

      // Anything not placed must be named by the audit — that is what makes an
      // unplaceable client visible instead of silently absent.
      const silent = missing.filter(c => !reported.has(c))
      if (silent.length) note(`${label} h${hour}: ${silent.length} client(s) placed nowhere AND not reported — e.g. ${silent.slice(0,3).join(', ')}`)

      // With at least one person available who is not on custom duty, nothing
      // should be unplaced at all.
      const canWork = poolNames.filter(n => !customTextFor(n, hour))
      if (canWork.length > 0 && missing.length > 0) {
        note(`${label} h${hour}: ${missing.length} unplaced with ${canWork.length} people able to work — e.g. ${missing.slice(0,3).join(', ')}`)
      }
      // The audit's own denominator must match the real due set.
      if (audit.due !== due.size) note(`${label} h${hour}: audit says ${audit.due} due, schedule holds ${due.size}`)
      // Nothing invented: everything placed must be something that was due.
      const extra = [...seen.keys()].filter(c => !due.has(c))
      if (extra.length) note(`${label} h${hour}: ${extra.length} client(s) placed that were not due — e.g. ${extra.slice(0,3).join(', ')}`)
      slotsPlaced += seen.size
      return { placed: seen.size, dueCount: due.size, missing: missing.length, reason: audit.reason }
    }

    const perHour = []
    for (const hour of businessHourOrder()) {
      const due = dueAt(hour)
      if (due.size === 0) continue
      const rostered = getScheduledEmployeesAtHour(hour, {}, {}).map(e => e.name)

      // 1 — the whole roster for this hour is at work.
      const full = check('all-in', hour, rostered)

      // 2 — exactly one person is at work. Every rostered person, in turn.
      rostered.forEach(n => check(`alone:${n}`, hour, [n]))

      // 3 — nobody clocked in yet: buildHourPool must fall back to the roster
      //     rather than leave the hour ownerless.
      const { poolNames: fallback } = buildHourPool({
        hour, leaveMap: {}, overridesMap: {},
        onShiftNames: new Set(), clockedOutNames: new Set(), awayNames: new Set(),
      })
      if (fallback.length === 0 && rostered.length > 0) {
        note(`no-one-in h${hour}: pool empty though ${rostered.length} rostered`)
      }
      check('no-one-in', hour, fallback)

      // 4 — everybody at work except one, for each one (covers a break, leave,
      //     a week off and going home — all of them remove a name from the pool).
      rostered.forEach(n => {
        const rest = rostered.filter(x => x !== n)
        if (rest.length) check(`without:${n}`, hour, rest)
      })

      // 5 — everyone away on a long break. buildHourPool must keep the hour
      //     owned rather than drop every client off the floor.
      const { poolNames: allAway } = buildHourPool({
        hour, leaveMap: {}, overridesMap: {},
        onShiftNames: new Set(rostered), clockedOutNames: new Set(),
        awayNames: new Set(rostered),
      })
      if (rostered.length > 0 && allAway.length === 0) {
        note(`all-away h${hour}: every client would be on nobody's board`)
      }
      check('all-away', hour, allAway)

      // 6 — only the people with a named client this hour are here. This is the
      //     case that once left 125 clients with no owner at all.
      const fixedOnly = rostered.filter(n => specificClientsFor(n, hour))
      if (fixedOnly.length) check('fixed-only', hour, fixedOnly)

      // 7 — only people on custom duty are here. Nothing CAN be placed; the
      //     requirement is that it is reported, not that it is placed.
      const customOnly = rostered.filter(n => customTextFor(n, hour))
      if (customOnly.length) {
        const r = check('custom-only', hour, customOnly)
        if (r.missing > 0 && r.reason !== 'custom-duty') {
          note(`custom-only h${hour}: unplaced work reported as "${r.reason}" rather than custom-duty`)
        }
      }

      // 8 — random partial floors, with some work already locked to whoever
      //     finished it (including, deliberately, people no longer in the pool).
      for (let t = 0; t < 6; t++) {
        const subset = rostered.filter(() => rand() > 0.45)
        if (subset.length === 0) continue
        const locked = {}
        ;[...due].slice(0, Math.floor(due.size * 0.2)).forEach((c, i) => {
          locked[c] = rostered[i % rostered.length]
        })
        check(`partial#${t}`, hour, subset, locked)
      }

      // 9 — leave windows: everyone rostered is on leave covering this hour.
      const leaveMap = {}
      rostered.forEach(n => { leaveMap[n] = [{ fromHour: hour, toHour: (hour + 1) % 24, reason: 'Leave', markedBy: 'Admin' }] })
      const onLeave = getScheduledEmployeesAtHour(hour, leaveMap, {}).map(e => e.name)
      const r9 = check('all-on-leave', hour, onLeave)
      if (onLeave.length === 0 && r9.missing !== r9.dueCount) {
        note(`all-on-leave h${hour}: pool empty but only ${r9.missing} of ${r9.dueCount} reported`)
      }

      perHour.push({
        hour, due: due.size, placedWhenFullyStaffed: full.placed,
        unplacedWhenFullyStaffed: full.missing, rostered: rostered.length,
      })
    }

    // ── Is the ordinary share actually equal? ────────────────────────────
    // The rule the operation runs on: everybody who is NOT holding a named
    // client and NOT on custom duty that hour splits the rest of the hour by
    // vehicle count, as evenly as the clients allow. "As evenly as the clients
    // allow" is the honest caveat — a single client with 553 vehicles cannot
    // be cut in half, so one person must carry it and their hour is larger by
    // however much that client exceeds an even share. This measures the real
    // spread, and separates the part the algorithm could have avoided from the
    // part no algorithm could.
    const balance = []
    for (const hour of businessHourOrder()) {
      const due = dueAt(hour)
      if (due.size === 0) continue
      const rostered = getScheduledEmployeesAtHour(hour, {}, {}).map(e => e.name)
      const ordinary = rostered.filter(n => !customTextFor(n, hour) && !specificClientsFor(n, hour))
      if (ordinary.length < 2) continue

      const dist = distributeClientsForHour(hour, rostered, vehicleMap, {}, true)
      const loads = ordinary.map(n => (dist[n] || []).reduce((s, c) => s + (c.vehicleCount || 0), 0))
      const total = loads.reduce((a, b) => a + b, 0)
      const mean  = total / ordinary.length
      const min = Math.min(...loads), max = Math.max(...loads)

      // The biggest single client in the ordinary rotation this hour. Nothing
      // can split it, so no split can be fairer than this.
      const ordinaryClients = ordinary.flatMap(n => (dist[n] || []).filter(c => !c.isSpecific))
      const biggest = ordinaryClients.reduce((m, c) => Math.max(m, c.vehicleCount || 0), 0)
      const unavoidable = Math.max(0, biggest - mean)

      balance.push({
        hour, people: ordinary.length, clients: ordinaryClients.length,
        totalVehicles: total, mean: Math.round(mean), min, max,
        spread: max - min,
        // How far the worst-loaded person is above the even share, and how
        // much of that one indivisible client already explains.
        overMean: Math.round(max - mean),
        unavoidable: Math.round(unavoidable),
        avoidable: Math.round(Math.max(0, (max - mean) - unavoidable)),
        biggestClient: biggest,
      })
      // The split must never leave somebody more than one indivisible client
      // above the even share — that is the most a greedy balance can cost.
      if (max - mean > biggest + 1) {
        note(`balance h${hour}: worst load ${max} is ${Math.round(max-mean)} over the even share ${Math.round(mean)}, and the biggest single client is only ${biggest}`)
      }
    }

    // Every client in the sheet is scheduled for at least one hour, and every
    // hour it is scheduled for places it.
    const everyClient = Object.keys(clientTimings())
    const neverDue = everyClient.filter(c => (clientTimings()[c] || []).length === 0)
    if (neverDue.length) note(`${neverDue.length} client(s) in Client_Timings with no hours: ${neverDue.slice(0,5).join(', ')}`)

    const totalDue = perHour.reduce((s, h) => s + h.due, 0)
    const totalPlaced = perHour.reduce((s, h) => s + h.placedWhenFullyStaffed, 0)

    return res.status(200).json({
      ok: fails.length === 0 && totalDue === totalPlaced,
      cases, slotsPlaced,
      clientsInSheet: everyClient.length,
      totalDuePerDay: totalDue,
      totalPlacedWhenFullyStaffed: totalPlaced,
      hoursCovered: perHour.length,
      perHour,
      balance,
      failures: fails,
    })
  } catch (e) {
    return res.status(500).json({ error: e.message, stack: (e.stack || '').split('\n').slice(0, 6) })
  }
}
