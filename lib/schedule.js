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

  // How far ahead of the rostered start this is. Wraparound-aware for night
  // shifts, where "before 22:00" can mean an hour on the other side of
  // midnight; past 12 hours it isn't early any more, it's the far side of
  // the clock, so treat it as not early.
  let hoursEarly = emp.end <= emp.start
    ? (emp.start - arrivalHour + 24) % 24
    : emp.start - arrivalHour
  if (hoursEarly > 12) hoursEarly = 0
  const isEarly = hoursEarly > 0

  // ── ONE rule, whichever end of the roster you arrive at ──
  //
  // The window opens at the hour you clocked in and runs the shift's usual
  // length, plus the make-up hour if you arrived past the half hour. Early,
  // on time, or hours late — the same arithmetic, because the shift is a
  // length of work, not a fixed pair of clock hands.
  //
  // This was briefly changed so that a late arrival kept the rostered end
  // ("the start moves, the end does not"). That was wrong and it is not what
  // the operation runs on: somebody rostered 8–17 who signs in at noon owes
  // nine hours from noon, so their window is 12:00–21:00. Reverted.
  //
  // What DOES still hold — and is a separate rule, in lib/dayplan.js — is
  // that the hours BEFORE they arrived were never theirs. Turning up at four
  // gives you a shift from four; it does not hand you the morning's clients.
  // The two rules together are the whole behaviour: the window follows the
  // arrival, and the arrival is the earliest hour any client can reach them.
  const start = arrivalHour
  const end   = (arrivalHour + duration + extraHour) % 24

  return {
    start, end, duration, extraHour, hoursEarly, isEarly,
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

// What a client WEIGHS when the hour is being shared out.
//
// Not the same thing as how many vehicles it has, which is reported as it
// stands — this is only ever used to decide who takes what.
//
// A client the vehicle source has never heard of counts as 0 vehicles, and 0
// is catastrophic here: the running load never moves, so the person with the
// lowest load is the same person every single time, and every unweighted
// client in the hour lands on them. On a live night that was one operator
// holding eighty-nine clients of a hundred and forty-one while the hours
// either side of it held one apiece, and every client on the screen reading
// "0 vehicles".
//
// The vehicle list itself is the real problem when that happens, and the
// admin's Dashboard names it. But missing data must degrade to "one client is
// one client", never to "this work is free". At least one unit each, so an
// hour with no vehicle counts at all still splits evenly by count — and where
// the counts are real they are far larger than 1 and decide the split exactly
// as before.
function weightOf(vehicleCount) {
  return Math.max(1, vehicleCount || 0)
}

function getVehicleCountLocal(vehicleMap, clientName) {
  // Same key the map is built under — see vehicleKey in lib/sheets. Trimming
  // alone left "PSR  TRAVELS" unmatched against "PSR TRAVELS", and an
  // unmatched client weighs nothing in a split balanced by vehicles.
  const key = (clientName || '').toString().replace(/\s+/g, ' ').trim().toLowerCase()
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
      // Whoever this belongs to is not in the pool — they stepped away on a
      // break, or went home. A lock only ever exists for work that carries a
      // real update, so this is FINISHED work: it must not go back into the
      // rotation for somebody to redo, and it must not disappear either.
      //
      // It used to do the second. The client was reserved and then returned to
      // nobody, so six completed clients at ten in the morning were on no
      // board and in no total — which reads exactly like six clients lost, and
      // is indistinguishable from it on every screen. Finished work stays with
      // whoever finished it.
      if (reserveOffShiftLocks) {
        reservedClients.add(clientName)
        ;(distribution[empName] ||= []).push({
          client: clientName, vehicleCount: getVehicleCountLocal(vehicleMap, clientName),
          isSpecific: false, isLocked: true, ownerOffShift: true,
        })
      }
      return
    }
    distribution[empName].push({
      client: clientName, vehicleCount: getVehicleCountLocal(vehicleMap, clientName),
      isSpecific: false, isLocked: true,
    })
    reservedClients.add(clientName)
  })

  // A named client whose owner is not here has to be covered by somebody else.
  //
  // Fixed clients are only ever handed to the employee they are named against,
  // so the moment that employee steps away — a break, leave, going home — their
  // named accounts stopped existing: not on their board, because they are away,
  // and not on anyone else's, because nothing else ever looks at them. Pinning
  // a client to a person is meant to make it MORE looked after, not less.
  //
  // They join the ordinary rotation, and only while their owner is absent.
  // Membership is tested against the POOL, not against the distribution's keys.
  // The distribution can now carry a name that is not in the pool — somebody
  // off shift holding work they already finished — and reading the keys would
  // take that as "their owner is here", quietly stranding every named client
  // belonging to a person who has stepped away.
  const inPool = new Set(scheduledEmployeeNames)
  const orphanedFixed = []
  employees().forEach(e => {
    if (inPool.has(e.name)) return                          // owner is here
    const mine = specificClientsFor(e.name, hour)
    if (mine) orphanedFixed.push(...mine)
  })

  const scheduledNow = Object.entries(clientTimings())
    .filter(([, hours]) => hours.includes(hour))
    .map(([name]) => name)

  const remainingClients = [...new Set([...scheduledNow, ...orphanedFixed])]
    .filter(c => !reservedClients.has(c))
    .sort((a, b) => getVehicleCountLocal(vehicleMap, b) - getVehicleCountLocal(vehicleMap, a))

  let eligibleEmps = sorted.filter(name => !customTextEmps.has(name) && !specificEmps.has(name))

  // If that leaves nobody to take the ordinary rotation, the people with fixed
  // clients take it after all.
  //
  // Without this the hour's remaining clients were assigned to NOBODY: at nine
  // this morning the only person in the pool had two named accounts for that
  // hour, so she was given those two and the other 125 clients of the hour
  // simply ceased to exist — absent from her board, absent from every
  // colleague's board, and absent from the Command Center, which is the worst
  // possible way for work to go missing because nothing anywhere reports it.
  //
  // Custom-duty employees stay out: an hour set aside for training or calls is
  // deliberately not fleet work, and handing them a rotation would be
  // overriding a real instruction rather than filling a hole.
  if (eligibleEmps.length === 0 && specificEmps.size > 0) {
    eligibleEmps = sorted.filter(name => specificEmps.has(name))
  }

  if (eligibleEmps.length > 0) {
    const load = {}
    eligibleEmps.forEach(name => {
      load[name] = distribution[name].reduce((s, c) => s + weightOf(c.vehicleCount), 0)
    })
    remainingClients.forEach(client => {
      const vehicleCount = getVehicleCountLocal(vehicleMap, client)
      let minEmp = eligibleEmps[0]
      eligibleEmps.forEach(name => { if (load[name] < load[minEmp]) minEmp = name })
      distribution[minEmp].push({ client, vehicleCount, isSpecific: false })
      load[minEmp] += weightOf(vehicleCount)
    })
  }
  // Anything still unplaced at this point — every available person is on
  // custom duty, or nobody is rostered at all — is NOT silently dropped. It is
  // reported by auditHourAssignment below and surfaced in the Command Center,
  // because a client that reaches no board is invisible by definition: no
  // employee can miss it, so nothing would ever say it was left.

  return distribution
}

// Every client due at this hour, and where each one ended up.
//
// The one thing this platform must never do is lose a client. A slot that
// reaches nobody is invisible by definition: it is on no board, so no employee
// can miss it, and until this existed it was on no screen either. This is the
// check that makes that impossible to happen quietly — the split is measured
// against the schedule itself, and anything the split did not place is
// returned by name.
//
// `reason` says why, because the three cases need three different responses:
//   'no-staff'    — nobody is rostered for this hour at all. A gap in the
//                   roster, or everybody rostered for it is on leave. Only the
//                   sheet can fix it.
//   'custom-duty' — everybody available is set to training or calls this hour.
//   'ok'          — every client is placed.
export function auditHourAssignment(hour, poolNames, vehicleMap = {}, lockedAssignments = {}, reserveOffShiftLocks = false) {
  // Work due this hour is the schedule PLUS every client named against an
  // employee in Employee_Hours for this hour.
  //
  // Named clients count whether or not their owner is in the pool. A named
  // client is delivered to its owner even when Client_Timings does not mention
  // it, so counting only the ones whose owner is absent made the denominator
  // depend on who happened to be at work: at nine in the morning the day held
  // 127 slots and the audit called it 126, and the Command Center reported
  // "127 of 126 unassigned". The two numbers have to be measured the same way.
  const namedThisHour = []
  employees().forEach(e => {
    const mine = specificClientsFor(e.name, hour)
    if (mine) namedThisHour.push(...mine)
  })
  const due = [...new Set([
    ...Object.entries(clientTimings()).filter(([, hours]) => hours.includes(hour)).map(([name]) => name),
    ...namedThisHour,
  ])]
  if (due.length === 0) return { hour, due: 0, assigned: 0, unassigned: [], reason: 'ok' }

  const dist = distributeClientsForHour(hour, poolNames, vehicleMap, lockedAssignments, reserveOffShiftLocks)
  const placed = new Set()
  Object.values(dist).forEach(cs => cs.forEach(c => placed.add(c.client)))

  // A client held back because whoever finished it has gone off shift is not
  // missing — it is done. Only genuinely unplaced ones count.
  const lockedElsewhere = new Set(
    Object.entries(lockedAssignments || {})
      .filter(([, owner]) => reserveOffShiftLocks && !poolNames.includes(owner))
      .map(([client]) => client)
  )

  const unassigned = due.filter(c => !placed.has(c) && !lockedElsewhere.has(c))
  const reason = unassigned.length === 0 ? 'ok'
    : poolNames.length === 0 ? 'no-staff'
    : 'custom-duty'
  return { hour, due: due.length, assigned: placed.size, unassigned, reason }
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
    // Weighted the same way as the ordinary split — see weightOf. Adding the
    // raw count meant a hand-over of clients with no vehicle record went
    // entirely to one colleague.
    load[minEmp] += weightOf(vehicleCount)
  })

  return log
}

// ── Who is not coming in today ──────────────────────────────────────────
//
// There are two ways to be off, and a screen that knows only one of them
// contradicts the screen next to it.
//
//   · The standing weekly day off, a Yes in the Credentials tab. Set once and
//     true every week.
//   · The no-show sweep in /api/clients/current, which writes a "Week Off"
//     row into Leaves when somebody never clocks in. Decided on the day.
//
// The Dashboard already took the union of the two — the comment there records
// the bug that made it necessary, a person reading "Week off" on one screen
// and "Not started" on another. But the rule was fixed in that one file and
// left alone in the two others that ask the same question, so the same
// contradiction came straight back: CHANDAN sat under WEEK OFF on the
// Dashboard and under Not Started on Hour by hour, on the same evening.
//
// This is worse than a wrong label. All three pass the answer into
// computeDayPlan, so the three screens were building three different days —
// and an employee wrongly counted as present holds clients that should have
// gone to somebody who is actually there.
//
// One function, three callers. A row shortened to "Week Off (returned)" means
// they did turn up after all, so only the exact string counts.
export function weekOffNamesFor(leaveMap = {}) {
  const out = new Set(employees().filter(e => e.isWeekOff).map(e => e.name))
  Object.entries(leaveMap).forEach(([name, entries]) => {
    if ((entries || []).some(l => (l.reason || '').toString().trim() === 'Week Off')) out.add(name)
  })
  return out
}
