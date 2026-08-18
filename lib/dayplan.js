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
  // Standing weekly week-off from Credentials, plus anything else the caller
  // knows keeps somebody off the whole day.
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
  const hoursWithRows = new Set(
    rowsForDate.map(r => parseInt(r[4])).filter(h => Number.isFinite(h))
  )
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
      .filter(n => !weekOffNames.has(n))
  ))
  const livePool = (hour) => buildHourPool({
    hour, leaveMap, overridesMap, onShiftNames, clockedOutNames, awayNames,
  }).poolNames

  const poolFor = (hour) => {
    if (!isToday) return livePool(hour)
    if (hour === nowHour) return livePool(hour)
    if (hourHasPassed(hour, nowHour)) {
      const wereHere = whoWasOnShiftAtHour(shiftRows, date, hour, nowHour)
      const pool = rosterPool(hour).filter(n => wereHere.has(n))
      return pool.length > 0 ? pool : livePool(hour)
    }
    return rosterPool(hour).filter(n => !goneHomeToday.has(n))
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

    const settled = hoursWithRows.has(hour) && (!isToday || hourHasPassed(hour, nowHour))
    const locked  = buildLockedAssignments(updateRows, date, hour)
    const pool    = settled ? [] : poolFor(hour)

    const owners = {}
    if (settled) {
      Object.entries(settledOwners[hour] || {}).forEach(([name, cs]) => {
        owners[name] = cs.map(client => ({ client, vehicleCount: vehiclesOf(client) }))
      })
    } else {
      const dist = distributeClientsForHour(hour, pool, vehicleMap, locked, true)
      Object.entries(dist).forEach(([name, cs]) => {
        if (cs.length) owners[name] = cs.map(c => ({
          client: c.client, vehicleCount: c.vehicleCount || 0,
          isSpecific: !!c.isSpecific, isLocked: !!c.isLocked,
        }))
      })
    }

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

    // What the hour could not place, and why. For a settled hour the rows are
    // the record, so anything with a row counts as having reached somebody.
    let unassigned = due.filter(c => !placed.has(c))
    let reason = unassigned.length === 0 ? 'ok' : (pool.length === 0 ? 'no-staff' : 'custom-duty')
    if (!settled && unassigned.length > 0) {
      const audit = auditHourAssignment(hour, pool, vehicleMap, locked, true)
      unassigned = audit.unassigned
      reason = audit.reason
    }

    hours.push({
      hour, settled, passed, pool,
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
    goneHomeToday, awayNames, onShiftNames,
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
  // An hour the plan actually gives them, or one they have already recorded
  // work in, belongs to their day whatever their window says now — a late
  // start or an OT extension must not erase a morning already worked.
  const mine = plan.byEmployee[emp.name]
  if (mine) Object.keys(mine.hours).forEach(h => inDay.add(parseInt(h)))

  return businessHourOrder().filter(h => inDay.has(h))
}
