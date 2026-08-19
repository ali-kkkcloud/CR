import {
  employees, clientTimings, specificClientsFor, customTextFor,
  distributeClientsForHour, getScheduledEmployeesAtHour, auditHourAssignment,
} from './schedule'
import { buildHourPool, buildLockedAssignments, collapseSlotOwners } from './distribution'
import {
  businessHourOrder, hourHasPassed, whoWasOnShiftAtHour,
  getOnShiftNamesFromLog, getClockedOutNamesFromLog, getAwayOnBreakNames,
} from './sheets'

// ══════════════════════════════════════════════════════════════════════
// The day, worked out once.
//
// "How many clients does this person have today?" was being answered in four
// places, four different ways, and it gave four different answers about the
// same person on the same afternoon: 69 on their own dashboard, 50 in the rail
// beside it, 176 on the admin's Dashboard, 207 on Hour by hour. Every one of
// them was defensible on its own and no two agreed, which makes all four
// useless — you cannot chase a number you cannot trust.
//
// There is one answer now and this is where it is computed. Everything else
// reads it: the employee's board, the employee's own day, the rail on their
// dashboard, the admin's Dashboard and the admin's Hour by hour.
//
// The rules, in one place:
//
//   DUE      Every client Client_Timings schedules for the hour, plus every
//            client named against somebody in Employee_Hours for that hour.
//            A named client is delivered whether or not the timings sheet
//            mentions it, so it is part of the day either way.
//
//   SETTLED  An hour that is over and has rows in CRM_Updates is read from
//            those rows — they are the record of who actually held what, and
//            the only honest one. Settled applies to the WHOLE hour, never to
//            one employee at a time: mixing rows for some people with a
//            recomputed split for others put the same client on two boards.
//
//   LIVE     The hour in progress is split between whoever is clocked in,
//            exactly as the employee's own board splits it.
//
//   AHEAD    An hour still to come is split between the people the ROSTER puts
//            on it, minus anyone on leave, on a week off, or who has already
//            gone home for the day. Not "who is at a desk this minute" — the
//            night shift covers tonight whether or not it has arrived.
//
//   GONE     An hour already finished with no rows at all is judged on who was
//            actually at work then, read back from the attendance log.
//
// Anything the split cannot place is returned by name in `unassigned`. It is
// never dropped: a client on no board is invisible, and invisible is the one
// thing this platform must never let a client be.
// ══════════════════════════════════════════════════════════════════════
export function computeDayPlan({
  date,                       // the operating day being planned, DD/MM/YYYY
  today,                      // the operating day right now
  nowHour,                    // IST hour right now
  shiftRows, updateRows,
  breakRows = [],
  leaveMap = {}, overridesMap = {},
  vehicleMap = {},
  // The STANDING weekly week-off from Credentials. Everything else that keeps
  // somebody off for the day — the "Week Off" row the no-show sweep writes, and
  // the fact that turning up overrides both — is worked out here, so every
  // caller gets the same answer. Passing a differently-built set from each
  // screen is what made the Dashboard say an employee had no clients today
  // while Hour by hour, reading the same plan, said a hundred and four.
  weekOffNames = new Set(),
  yesterday,
}) {
  const isToday = date === today
  const vehiclesOf = (c) => vehicleMap[(c || '').toString().trim().toLowerCase()]?.vehicleCount || 0

  // ── Presence ────────────────────────────────────────────────────────
  const dates = yesterday ? [date, yesterday] : [date]
  const onShiftNames = isToday
    ? getOnShiftNamesFromLog(shiftRows, dates)
    // A day already finished has nobody Active: presence means "turned up".
    : new Set(shiftRows.slice(1).filter(r => r[2] === date).map(r => (r[1] || '').toString().trim()).filter(Boolean))
  const clockedOutNames = isToday ? getClockedOutNamesFromLog(shiftRows, dates) : new Set()
  const awayNames = isToday ? getAwayOnBreakNames(breakRows, dates) : new Set()

  // Gone home for THIS operating day: a row dated today, none of them Active.
  // Rows dated yesterday are ignored on purpose — a night shift that ended at
  // six this morning is due back tonight, and reading its Ended row would
  // empty every night hour of its staff.
  const rowsTodayByName = {}
  shiftRows.slice(1).filter(r => r[2] === date).forEach(r => {
    const n = (r[1] || '').toString().trim()
    if (n) (rowsTodayByName[n] ||= []).push(r)
  })
  const goneHomeToday = new Set(
    Object.entries(rowsTodayByName)
      .filter(([, rows]) => !rows.some(r => r[6] === 'Active'))
      .map(([n]) => n)
  )

  // Off for the whole day: the standing flag, plus anyone the no-show sweep
  // marked "Week Off" — and never anyone who actually turned up, whatever any
  // flag says.
  const offToday = new Set(weekOffNames)
  Object.entries(leaveMap || {}).forEach(([name, entries]) => {
    if (entries.some(l => (l.reason || '').toString().trim() === 'Week Off')) offToday.add(name)
  })
  Object.entries(rowsTodayByName).forEach(([name, rows]) => {
    if (rows.some(r => r[3])) offToday.delete(name)
  })

  // The hour each person first clocked in today, in operating-day position.
  //
  // Hours before that are not their day. Somebody who signed in at four in the
  // afternoon was still being shown seven in the morning through three in the
  // afternoon on their own hour strip — eight hours they were not present for,
  // with client counts against them — because the strip was built from the
  // roster rather than from when they actually arrived.
  const ORDER = businessHourOrder()
  const posOf = (h) => ORDER.indexOf(h)
  const arrivedAt = {}
  Object.entries(rowsTodayByName).forEach(([name, rows]) => {
    let best = null
    rows.forEach(r => {
      const t = (r[3] || '').toString().trim()
      const m = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i)
      if (!m) return
      let h = parseInt(m[1], 10)
      const ap = (m[3] || '').toLowerCase()
      if (ap === 'pm' && h !== 12) h += 12
      if (ap === 'am' && h === 12) h = 0
      if (!Number.isFinite(h)) return
      if (best === null || posOf(h) < posOf(best)) best = h
    })
    if (best !== null) arrivedAt[name] = best
  })

  // ── The grace hour ──────────────────────────────────────────────────
  //
  // Somebody who has not clocked in still gets their FIRST shift hour. They
  // may be five minutes away, and pulling their clients the moment the hour
  // opens would churn the whole floor for nothing. From the NEXT hour on they
  // are treated as absent — their share goes to the people who are here — and
  // the no-show sweep writes the matching "Week Off" row into the Leaves tab.
  // The moment they do sign in, their shift starts from that hour and they get
  // that hour's clients, like anybody else arriving late.
  //
  // This is decided here rather than read off the swept row, because the sweep
  // only fires when somebody's board happens to be loaded. Waiting for it left
  // an employee who never turned up showing a full nine-hour day — 0 of 64
  // clients spread across every hour of a shift they were not working — which
  // is both wrong on their screen and wrong in every total that reads it.
  const startHourOf = (name) => {
    const ov = overridesMap?.[name]
    if (ov && Number.isFinite(ov.start)) return ov.start
    const e = employees().find(x => x.name === name)
    return Number.isFinite(e?.start) ? e.start : null
  }
  const graceHourOnly = {}
  employees().forEach(e => {
    if (rowsTodayByName[e.name]?.some(r => r[3])) return       // they turned up
    const start = startHourOf(e.name)
    if (start == null) return
    // Only once the grace hour is actually over. Before that, nothing is
    // decided — the day is still projected as if they will arrive.
    if (isToday && !hourHasPassed(start, nowHour)) return
    graceHourOnly[e.name] = start
  })
  // Their first hour is still theirs; every other hour of their shift is not.
  const missedThisHour = (name, hour) =>
    graceHourOnly[name] !== undefined && graceHourOnly[name] !== hour

  // ── What each hour holds ────────────────────────────────────────────
  const timings = clientTimings()
  const dueAt = (hour) => {
    const s = new Set(
      Object.entries(timings).filter(([, hs]) => hs.includes(hour)).map(([n]) => n)
    )
    employees().forEach(e => (specificClientsFor(e.name, hour) || []).forEach(c => s.add(c)))
    return [...s]
  }

  // Rows for this date, indexed once.
  const rowsForDate = updateRows.slice(1).filter(r => r[0] === date)
  const settledOwners = {}
  collapseSlotOwners(updateRows, r => r[0] === date).forEach(({ owner, client, hour }) => {
    const h = parseInt(hour)
    if (!Number.isFinite(h)) return
    ;(settledOwners[h] ||= {})
    ;(settledOwners[h][owner] ||= []).push(client)
  })

  const rosterCache = {}
  const rosterPool = (hour) => (rosterCache[hour] ||= (
    getScheduledEmployeesAtHour(hour, leaveMap, overridesMap)
      .map(e => e.name)
      .filter(n => !offToday.has(n))
  ))
  const livePool = (hour) => buildHourPool({
    hour, leaveMap, overridesMap, onShiftNames, clockedOutNames, awayNames,
  }).poolNames

  // Nobody who has missed their grace hour is in any pool but that one hour.
  const withoutNoShows = (hour, names) => names.filter(n => !missedThisHour(n, hour))

  const poolFor = (hour) => {
    if (!isToday) return livePool(hour)

    if (hourHasPassed(hour, nowHour) && hour !== nowHour) {
      // Who was ACTUALLY at work then, from the attendance log. If that is
      // nobody, the honest answer is nobody — the hour is reported as having
      // reached no one, which is what the coverage warning exists to say.
      //
      // It used to fall back to "whoever is clocked in now", and that is how
      // somebody who signed in at six in the evening was handed seven in the
      // morning: the morning had no attendance rows, so every one of those
      // hours fell on the only person online, and their own hour strip opened
      // with eight hours of work they were never present for. A past hour
      // cannot be given to somebody who was not there.
      //
      // Plus the ONE hour a no-show still owns. Somebody rostered from eight
      // who never signed in holds eight-to-nine and nothing after it — and
      // that hour has to stay against their name, or the fact that they were
      // due and did not come vanishes from the record. Handing it to whoever
      // was online instead is how "why did you not do these?" became a
      // question nobody could answer.
      const wereHere = whoWasOnShiftAtHour(shiftRows, date, hour, nowHour)
      return rosterPool(hour).filter(n => wereHere.has(n) || graceHourOnly[n] === hour)
    }

    // The hour in progress, and every hour still to come, are split between
    // the people the ROSTER puts on them — not between whoever happens to be
    // clocked in this second.
    //
    // Reading only the clocked-in list handed one person the whole floor: at
    // eight in the morning the seven-o'clock employee was given all seventy of
    // the eight-o'clock hour's clients, because the eight-o'clock employee had
    // not pressed Start Shift yet. They are five minutes away, not absent —
    // and their share is theirs until the grace hour runs out, at which point
    // withoutNoShows drops them and the split hands their work to the people
    // who are actually here.
    return withoutNoShows(hour, rosterPool(hour).filter(n => !goneHomeToday.has(n)))
  }

  const hours = []
  const byEmployee = {}
  const ofEmp = (name) => (byEmployee[name] ||= {
    name, hours: {}, clients: 0, vehicles: 0, hoursWithClients: 0,
  })
  let dueClients = 0, dueVehicles = 0, placedClients = 0
  let dueClientsSoFar = 0, dueVehiclesSoFar = 0

  for (const hour of businessHourOrder()) {
    const due = dueAt(hour)
    if (due.length === 0) continue

    const hourVehicles = due.reduce((s, c) => s + vehiclesOf(c), 0)
    // "So far" counts every hour up to and including the one in progress.
    const passed = !isToday || hourHasPassed(hour, nowHour) || hour === nowHour
    dueClients  += due.length
    dueVehicles += hourVehicles
    if (passed) { dueClientsSoFar += due.length; dueVehiclesSoFar += hourVehicles }

    // ── A finished hour keeps everything it held, not just what got done ──
    //
    // An hour that is over used to be read back from CRM_Updates alone. That
    // was fine while a blank row was written for every client on every board;
    // once rows are written only where somebody recorded something, it turned
    // every past hour into a perfect score. Fifteen clients of which five were
    // done read back, an hour later, as "5 / 5" — the ten that were never
    // touched simply were not there any more.
    //
    // That is the opposite of what the record is for. Nobody can be asked why
    // ten clients went untouched if the screen says there were only ever five,
    // and nobody can go back and finish them if they cannot see them.
    //
    // So a past hour is worked out the same way every other hour is: the
    // schedule's clients, split between the people who were actually there,
    // with anything already recorded PINNED to whoever recorded it. The rows
    // decide what is DONE; they no longer decide what existed.
    const locked  = buildLockedAssignments(updateRows, date, hour)
    const pool    = poolFor(hour)

    const owners = {}
    const dist = distributeClientsForHour(hour, pool, vehicleMap, locked, true)
    Object.entries(dist).forEach(([name, cs]) => {
      if (cs.length) owners[name] = cs.map(c => ({
        client: c.client, vehicleCount: c.vehicleCount || 0,
        isSpecific: !!c.isSpecific, isLocked: !!c.isLocked,
      }))
    })

    // Anybody who recorded work in this hour holds it, whatever the split
    // says now — a client somebody finished can never belong to somebody else.
    Object.entries(settledOwners[hour] || {}).forEach(([name, cs]) => {
      cs.forEach(client => {
        if (locked[client] !== name) return
        const mine = (owners[name] ||= [])
        if (!mine.some(c => c.client === client)) {
          mine.push({ client, vehicleCount: vehiclesOf(client), isLocked: true })
        }
      })
    })

    const placed = new Set()
    Object.entries(owners).forEach(([name, cs]) => {
      const e = ofEmp(name)
      e.hours[hour] = cs
      e.clients  += cs.length
      e.vehicles += cs.reduce((s, c) => s + (c.vehicleCount || 0), 0)
      e.hoursWithClients += 1
      cs.forEach(c => placed.add(c.client))
    })
    placedClients += placed.size

    // What the hour could not place, and why.
    let unassigned = due.filter(c => !placed.has(c))
    let reason = unassigned.length === 0 ? 'ok' : (pool.length === 0 ? 'no-staff' : 'custom-duty')
    if (unassigned.length > 0) {
      const audit = auditHourAssignment(hour, pool, vehicleMap, locked, true)
      unassigned = audit.unassigned
      reason = audit.reason
    }

    hours.push({
      hour, passed, pool,
      due, dueCount: due.length, dueVehicles: hourVehicles,
      owners, placed: placed.size,
      unassigned, reason,
    })
  }

  // ── What was actually recorded ──────────────────────────────────────
  // Counted as SLOTS — one client in one hour is one piece of work — the same
  // unit the due figures use, so done can never outrun due the way a count of
  // distinct client names or of raw rows could.
  const doneSlots = new Set()
  const doneByEmp = {}
  let doneVehicles = 0, doneAlerts = 0, doneFatigue = 0
  rowsForDate.filter(r => (r[5] || '').toString().trim()).forEach(r => {
    const key = `${r[4]}|${r[3]}`
    const a = (doneByEmp[r[2]] ||= { clients: new Set(), vehicles: 0, alerts: 0, fatigue: 0 })
    a.clients.add(key)
    a.vehicles += parseInt(r[11]) || 0
    a.alerts   += parseInt(r[7])  || 0
    a.fatigue  += parseInt(r[9])  || 0
    doneSlots.add(key)
    doneVehicles += parseInt(r[11]) || 0
    doneAlerts   += parseInt(r[7])  || 0
    doneFatigue  += parseInt(r[9])  || 0
  })

  let doneSoFar = 0, doneAll = 0
  hours.forEach(h => {
    const n = h.due.filter(c => doneSlots.has(`${h.hour}|${c}`)).length
    h.done = n
    doneAll += n
    if (h.passed) doneSoFar += n
  })

  Object.values(byEmployee).forEach(e => {
    const a = doneByEmp[e.name]
    e.clientsDone     = a ? a.clients.size : 0
    e.vehiclesChecked = a ? a.vehicles : 0
    e.alerts          = a ? a.alerts : 0
    e.fatigue         = a ? a.fatigue : 0
  })
  // Somebody who recorded work but holds nothing right now still belongs here.
  Object.entries(doneByEmp).forEach(([name, a]) => {
    if (byEmployee[name]) return
    const e = ofEmp(name)
    e.clientsDone = a.clients.size
    e.vehiclesChecked = a.vehicles
    e.alerts = a.alerts
    e.fatigue = a.fatigue
  })

  return {
    date, isToday, nowHour,
    hours,
    byEmployee,
    goneHomeToday, offToday, awayNames, onShiftNames, arrivedAt, graceHourOnly,
    totals: {
      dueClients, dueVehicles, placedClients,
      dueClientsSoFar, dueVehiclesSoFar,
      doneClients: doneAll, doneClientsSoFar: doneSoFar,
      doneVehicles, doneAlerts, doneFatigue,
      unassigned: hours.reduce((s, h) => s + h.unassigned.length, 0),
    },
  }
}

// The hours of one employee's day, in operating-day order (7am → 7am).
//
// Not "from their shift start", which is where this used to begin: a late
// start moved somebody's window to 1pm, and the noon hour they had already
// worked was then printed after nine in the evening. The day runs 7am to 7am
// and the hours read in that order for everybody.
export function employeeDayHours(plan, emp, effective) {
  const inDay = new Set()
  const start = effective?.start ?? emp?.start
  const end   = effective?.end   ?? emp?.end
  if (Number.isFinite(start) && Number.isFinite(end)) {
    if (end <= start) {
      for (let h = start; h < 24; h++) inDay.add(h)
      for (let h = 0; h < end; h++) inDay.add(h)
    } else {
      for (let h = start; h < end; h++) inDay.add(h)
    }
  }
  // Hours before they actually arrived are not their day.
  //
  // Applied only once they HAVE clocked in — somebody who has not started yet
  // should still see the whole day ahead of them, because all of it is still
  // theirs to do. The moment they sign in at four in the afternoon, the
  // morning stops being theirs: they were not there for it, and printing eight
  // empty hours against their name reads as work they failed to do.
  const arrival = plan.arrivedAt?.[emp.name]
  if (arrival != null) {
    const order = businessHourOrder()
    const from = order.indexOf(arrival)
    ;[...inDay].forEach(h => { if (order.indexOf(h) < from) inDay.delete(h) })
  }

  // An hour the plan actually gives them, or one they have already recorded
  // work in, belongs to their day whatever their window says now — a late
  // start or an OT extension must not erase a morning already worked, and an
  // employee who worked, went home and came back keeps both stretches.
  const mine = plan.byEmployee[emp.name]
  if (mine) Object.keys(mine.hours).forEach(h => inDay.add(parseInt(h)))

  return businessHourOrder().filter(h => inDay.has(h))
}
