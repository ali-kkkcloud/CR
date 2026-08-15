// lib/schedule.js
// Core principle: distribution is based on SCHEDULED employees, not login status.
// Only admin "leave" action removes someone from distribution.

// ── What the platform is running on ───────────────────────────────────
// Nothing operational is written down in this file any more. The roster,
// the client hours, and the per-employee fixed clients and custom slots all
// come from the spreadsheet — lib/roster.js reads them and puts them here at
// the start of every request that needs them. Keeping a copy in code was the
// problem: adding a client or moving somebody's hours meant editing source
// and redeploying, and the copy in code silently disagreed with the sheet
// the moment either changed.
let _employees     = []
let _timings       = {}
let _employeeHours = {}          // { name: { hour: { clients: [], text: '' } } }

export function setScheduleData({ employees, timings, employeeHours } = {}) {
  if (Array.isArray(employees))              _employees     = employees
  if (timings && typeof timings === 'object') _timings       = timings
  if (employeeHours && typeof employeeHours === 'object') _employeeHours = employeeHours
}
export function employees()     { return _employees }
export function clientTimings() { return _timings }

// Clients this employee always gets at this hour, whoever else is on shift.
export function specificClientsFor(name, hour) {
  const c = _employeeHours[name]?.[hour]?.clients
  return c && c.length ? c : null
}
// An hour that isn't client work at all — "CALL", "OFFLINE REPORTS" and so on.
export function customTextFor(name, hour) {
  return _employeeHours[name]?.[hour]?.text || null
}

export function isScheduledAtHour(emp, hour) {
  // Wraparound is derived from the ACTUAL hours, not the static isNight
  // flag: an Early/Late Start or OT adjustment can push a normally-day
  // shift across midnight (e.g. 17:00-02:00), and conversely can pull a
  // night shift's window so it no longer wraps. Trusting the flag caused
  // post-midnight hours to be silently dropped for adjusted shifts.
  const wraps = emp.end <= emp.start
  if (wraps) return hour >= emp.start || hour < emp.end
  return hour >= emp.start && hour < emp.end
}

// Get all employees SCHEDULED for this hour (regardless of login status)
// Subtract anyone admin has marked on leave for this hour.
// `overridesMap` = { empName: { start, end } } — today's effective shift
// window for employees who used Early Start and/or OT (see Shift_Overrides
// sheet). When present for an employee, it's used INSTEAD of their static
// the roster's start/end for this scheduling check only.
export function getScheduledEmployeesAtHour(hour, leaveMap = {}, overridesMap = {}) {
  return employees().filter(emp => {
    const override = overridesMap[emp.name]
    const effective = override ? { ...emp, start: override.start, end: override.end } : emp
    if (!isScheduledAtHour(effective, hour)) return false
    const leaves = leaveMap[emp.name] || []
    // leaveMap[empName] = array of { fromHour, toHour } — exclude if this hour is covered
    for (const leave of leaves) {
      if (isHourInLeave(hour, leave.fromHour, leave.toHour)) return false
    }
    return true
  })
}

function isHourInLeave(hour, fromHour, toHour) {
  // fromHour inclusive, toHour exclusive (same-day range)
  if (fromHour <= toHour) return hour >= fromHour && hour < toHour
  // Crosses midnight
  return hour >= fromHour || hour < toHour
}

export function getEmployeeShift(empName) {
  return employees().find(e => e.name === empName) || null
}

// How many hours the roster says this shift runs for. Wraparound-aware, so
// a 22:00–07:00 night shift measures as 9 hours, not -15.
export function shiftDuration(emp) {
  const d = ((emp.end - emp.start) % 24 + 24) % 24
  return d === 0 ? 24 : d
}

// The window an arrival actually earns.
//
// Two rules combine:
//
//  1. The shift starts at the HOUR you clocked in and runs for its usual
//     length — an 08:00–17:00 employee arriving at 11 works 11:00–20:00.
//
//  2. The arrival MINUTE decides whether that first hour counts as worked.
//     Clock in by half past and it does, so the shift ends where rule 1
//     puts it. Clock in from :31 onward and most of that hour is already
//     gone, so ONE MORE HOUR is added to the end to make the time up.
//
// Worked through, for an 08:00–17:00 shift:
//   08:00–08:30 -> 08:00–17:00   (unchanged)
//   08:31–08:59 -> 08:00–18:00   (owes an hour)
//   11:00–11:30 -> 11:00–20:00
//   11:31–11:59 -> 11:00–21:00   (owes an hour)
//
// The employee still picks up whatever is left of the hour they joined —
// they are scheduled from that hour onward, so its unfinished clients come
// to them through the normal split.
//
// This applies however somebody arrives: early, on time, or late.
export function computeShiftWindow(emp, now) {
  const arrivalHour = now.getHours()
  const arrivalMin  = now.getMinutes()
  const duration    = shiftDuration(emp)
  const extraHour   = arrivalMin > 30 ? 1 : 0

  const start = arrivalHour
  const end   = (arrivalHour + duration + extraHour) % 24

  // How far ahead of the rostered start this is. Wraparound-aware for night
  // shifts, where "before 22:00" can mean an hour on the other side of
  // midnight; past 12 hours it isn't early any more, it's the far side of
  // the clock, so treat it as not early.
  let hoursEarly = emp.end <= emp.start
    ? (emp.start - arrivalHour + 24) % 24
    : emp.start - arrivalHour
  if (hoursEarly > 12) hoursEarly = 0

  return {
    start, end, duration, extraHour,
    hoursEarly,
    isEarly: hoursEarly > 0,
    // Arrived at the rostered hour, inside the half hour: nothing to record.
    unchanged: start === emp.start && end === emp.end,
    hoursShifted: ((start - emp.start) % 24 + 24) % 24,
  }
}

// Pulling a shift forward means finishing earlier, so an early arrival is
// opt-in — the employee confirms before it is applied. Returns null when
// this arrival is not early. Arriving early past the half hour still owes
// the extra hour, exactly as any other arrival does.
export function computeEarlyStart(emp, now) {
  const w = computeShiftWindow(emp, now)
  return w.isEarly ? w : null
}

// OT: extends the CURRENT effective end (static, or already early-start
// adjusted) by a fixed 3 hours. One-time use per day — the caller is
// responsible for checking whether OT was already used today.
export function computeOTExtension(currentStart, currentEnd) {
  const newEnd = (currentEnd + 3) % 24
  return { start: currentStart, end: newEnd }
}

function getVehicleCountLocal(vehicleMap, clientName) {
  const key = (clientName || '').toString().trim().toLowerCase()
  return vehicleMap[key]?.vehicleCount || 0
}

// Core distribution — scheduled employees (admin-leave-aware), locked-assignment-aware
//
// `reserveOffShiftLocks` controls what happens to a locked client whose
// owner is not in the pool. When the locks represent COMPLETED work (the
// live split in /api/clients/current), pass true: the slot is already
// done, so it must be held back rather than handed to whoever is left —
// otherwise finishing a client and then ending your shift would push that
// same client back onto a colleague's board as fresh work. The
// admin-leave planner passes false, because there a lock can simply mean
// "assigned to someone who is now also on leave", which does need moving.
export function distributeClientsForHour(hour, scheduledEmployeeNames, vehicleMap = {}, lockedAssignments = {}, reserveOffShiftLocks = false) {
  const distribution = {}
  scheduledEmployeeNames.forEach(name => { distribution[name] = [] })
  if (scheduledEmployeeNames.length === 0) return distribution

  const sorted = [...scheduledEmployeeNames].sort((a, b) => a.localeCompare(b))
  const reservedClients = new Set()
  const customTextEmps  = new Set()
  // Anyone with fixed clients this hour works only on those. Naming a client
  // in Employee_Hours says "this hour is that client's" — piling the ordinary
  // rotation on top as well left somebody with a named account also holding
  // eighteen others, which is the opposite of what pinning it was for.
  const specificEmps    = new Set()

  sorted.forEach(name => {
    if (customTextFor(name, hour)) { customTextEmps.add(name); return }
    const specific = specificClientsFor(name, hour)
    if (specific) {
      specificEmps.add(name)
      distribution[name].push(...specific.map(c => ({
        client: c, vehicleCount: getVehicleCountLocal(vehicleMap, c), isSpecific: true,
      })))
      specific.forEach(c => reservedClients.add(c))
    }
  })

  // Apply locked assignments (already decided this hour — don't reshuffle)
  Object.entries(lockedAssignments).forEach(([clientName, empName]) => {
    if (reservedClients.has(clientName)) return
    if (!distribution[empName]) {
      if (reserveOffShiftLocks) reservedClients.add(clientName)
      return
    }
    distribution[empName].push({
      client: clientName, vehicleCount: getVehicleCountLocal(vehicleMap, clientName),
      isSpecific: false, isLocked: true,
    })
    reservedClients.add(clientName)
  })

  const remainingClients = Object.entries(clientTimings())
    .filter(([, hours]) => hours.includes(hour))
    .map(([name]) => name)
    .filter(c => !reservedClients.has(c))
    .sort((a, b) => getVehicleCountLocal(vehicleMap, b) - getVehicleCountLocal(vehicleMap, a))

  const eligibleEmps = sorted.filter(name => !customTextEmps.has(name) && !specificEmps.has(name))

  if (eligibleEmps.length > 0) {
    const load = {}
    eligibleEmps.forEach(name => {
      load[name] = distribution[name].reduce((s, c) => s + c.vehicleCount, 0)
    })
    remainingClients.forEach(client => {
      const vehicleCount = getVehicleCountLocal(vehicleMap, client)
      let minEmp = eligibleEmps[0]
      eligibleEmps.forEach(name => { if (load[name] < load[minEmp]) minEmp = name })
      distribution[minEmp].push({ client, vehicleCount, isSpecific: false })
      load[minEmp] += vehicleCount
    })
  }

  return distribution
}

export function getClientsForEmployeeAtHour(employeeName, hour, scheduledEmployeeNames, vehicleMap = {}, lockedAssignments = {}, reserveOffShiftLocks = false) {
  const customText = customTextFor(employeeName, hour)
  if (customText) return [{ client: customText, isCustom: true }]

  const dist = distributeClientsForHour(hour, scheduledEmployeeNames, vehicleMap, lockedAssignments, reserveOffShiftLocks)
  return (dist[employeeName] || []).map(c => ({
    client: c.client, vehicleCount: c.vehicleCount, isSpecific: c.isSpecific,
  }))
}

// For End Shift — only current hour's UNFILLED clients move to others
export function computeCurrentHourRedistribution(leavingEmployee, currentHour, unfilledClients, remainingScheduledNames, vehicleMap = {}) {
  const log = []
  if (!remainingScheduledNames.length || !unfilledClients.length) return log

  const sortedTargets = [...remainingScheduledNames].sort((a, b) => a.localeCompare(b))
  const load = {}
  sortedTargets.forEach(name => { load[name] = 0 })

  const sorted = [...unfilledClients].sort((a, b) =>
    getVehicleCountLocal(vehicleMap, b) - getVehicleCountLocal(vehicleMap, a)
  )

  sorted.forEach(client => {
    const vehicleCount = getVehicleCountLocal(vehicleMap, client)
    let minEmp = sortedTargets[0]
    sortedTargets.forEach(name => { if (load[name] < load[minEmp]) minEmp = name })
    log.push({ fromEmployee: leavingEmployee, toEmployee: minEmp, client, hour: currentHour })
    load[minEmp] += vehicleCount
  })

  return log
}
