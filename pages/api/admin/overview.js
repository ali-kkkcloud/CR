import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr,
  getShiftOverridesForDate, getLeaveMapForDate, getOnShiftNamesFromLog, getClockedOutNamesFromLog, yesterdayStr,
  hourHasPassed, whoWasOnShiftAtHour,
  getAwayOnBreakNames, fetchClientVehicleCounts,
} from '../../../lib/sheets'
import { employees, isScheduledAtHour, distributeClientsForHour, clientTimings, getScheduledEmployeesAtHour, auditHourAssignment } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { buildHourPool, buildLockedAssignments, collapseSlotOwners } from '../../../lib/distribution'
import { sweepShiftAutoClose } from '../../../lib/attendance'

const ISSUE_TAB = 'Issues- Realtime'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const today       = todayStr()
    const currentHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours()

    // Close shifts left running past their window, before anything is read —
    // so this very response shows the floor as it now is rather than as it was
    // a refresh ago. Idempotent; a row already Ended is skipped.
    try { await sweepShiftAutoClose(employees()) }
    catch (e) { console.error('shift auto-close sweep failed:', e.message) }

    const [credRows, shiftRows, breakRows, updateRows, redistRows, footageRows, overridesMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID,   `${TABS.CREDENTIALS}!A:H`, 60000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.SHIFT_LOG}!A:H`, 15000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.BREAKS}!A:H`, 15000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.CRM_UPDATES}!A:K`, 15000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.REDISTRIB}!A:G`, 15000),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, 90000),
      getShiftOverridesForDate(today),
    ])

    const weekOffEmps = new Set(
      credRows.slice(1)
        .filter(r => (r[7] || '').toString().toLowerCase() === 'yes')
        .map(r => r[1])
    )

    const todayShifts = shiftRows.slice(1).filter(r => r[2] === today)

    // ── One owner per slot, rather than one row per hand-over ──
    // For hours already gone this trail is the only record there is. For the
    // hour in progress it isn't good enough: a placeholder keeps the name of
    // whoever held the client when the row was written, and the split moves
    // every time somebody clocks in or out — so the current hour is taken
    // from the live split further down instead.
    const slotState = collapseSlotOwners(updateRows, r => r[0] === today)

    const workByEmp = {}
    slotState.forEach(({ owner, done, hour }) => {
      if (!workByEmp[owner]) workByEmp[owner] = { assigned: 0, completed: 0 }
      // Finished work counts wherever it happened. Unfinished work in the
      // hour in progress is left out here and replaced by the live split,
      // so the Command Center shows the same board the employee is looking
      // at rather than a stale trail of who held what earlier.
      if (done) { workByEmp[owner].assigned += 1; workByEmp[owner].completed += 1; return }
      if (parseInt(hour) === currentHour) return
      workByEmp[owner].assigned += 1
    })

    // Every hour of the day, audited against the schedule itself: is each
    // client due this hour actually on somebody's board?
    //
    // The one thing this platform must never do is lose a client, and a client
    // that reaches nobody is invisible by definition — it is on no board, so no
    // employee can miss it, and nothing would ever report it. This measures the
    // split against Client_Timings directly and names anything unplaced.
    let coverageGaps = []

    // A night shift is logged under the day it began, so both days count as
    // "clocked in right now".
    const yesterdayTop = yesterdayStr()
    // The same definition of "on shift" the employee's own screen uses: an
    // Active row, and not one left open so long that it is plainly forgotten.
    // The admin used to read the raw row instead, so somebody whose own
    // dashboard said "Not started" was listed here as on duty — two answers
    // about the same person on the same platform.
    const onShiftNamesTop = getOnShiftNamesFromLog(shiftRows, [today, yesterdayTop])
    const awayNamesTop    = getAwayOnBreakNames(breakRows, [today, yesterdayTop])

    // The hour in progress, worked out exactly as the employee's own board
    // works it out — same pool, same locks, same vehicle-count balancing.
    try {
      const leaveMap   = await getLeaveMapForDate(today)
      const vehicleMapForAudit = await fetchClientVehicleCounts()
      // Which clients already reached somebody's board, hour by hour. A row in
      // CRM_Updates is written the moment a client lands in front of an
      // employee, so for an hour that has finished this trail IS the record of
      // who had what — and it is the only honest one. Recomputing a finished
      // hour from who happens to be on shift now reported the entire day as
      // unassigned the moment the last person went home, which is both alarming
      // and false: those hours were worked.
      const seenByHour = {}
      updateRows.slice(1).filter(r => r[0] === today).forEach(r => {
        const h = parseInt(r[4])
        if (!Number.isFinite(h)) return
        if (!seenByHour[h]) seenByHour[h] = new Set()
        seenByHour[h].add(r[3])
      })

      const nowHour = currentHour
      for (let h = 0; h < 24; h++) {
        const due = Object.entries(clientTimings()).filter(([, hs]) => hs.includes(h)).map(([n]) => n)
        if (due.length === 0) continue

        let unassigned, reason
        if (hourHasPassed(h, nowHour)) {
          // Finished. Judged on who was ACTUALLY at work during that hour, read
          // back from the attendance log's own start and end times — not on who
          // is clocked in now, which by the evening is nobody and would report a
          // fully worked day as belonging to no one.
          //
          // A client counts as having reached somebody if it was placed by the
          // split for that hour, or if a row was written for it. The second is
          // what covers an hour whose staffing has since been edited.
          const wereHere = whoWasOnShiftAtHour(shiftRows, today, h, nowHour)
          const rostered = getScheduledEmployeesAtHour(h, leaveMap, overridesMap).map(e => e.name)
          const pool = rostered.filter(n => wereHere.has(n))
          const seen = seenByHour[h] || new Set()
          if (pool.length === 0) {
            unassigned = due.filter(c => !seen.has(c))
            reason = 'no-staff'
          } else {
            const audit = auditHourAssignment(
              h, pool, vehicleMapForAudit,
              buildLockedAssignments(updateRows, today, h), true
            )
            unassigned = audit.unassigned.filter(c => !seen.has(c))
            reason = audit.reason
          }
        } else {
          const { poolNames } = buildHourPool({
            hour: h, leaveMap, overridesMap,
            onShiftNames: onShiftNamesTop,
            clockedOutNames: getClockedOutNamesFromLog(shiftRows, [today, yesterdayTop]),
            awayNames: awayNamesTop,
          })
          const audit = auditHourAssignment(
            h, poolNames, vehicleMapForAudit,
            buildLockedAssignments(updateRows, today, h), true
          )
          unassigned = audit.unassigned
          reason = audit.reason
        }

        if (unassigned.length > 0) {
          coverageGaps.push({
            hour: h,
            clients: unassigned.length,
            due: due.length,
            reason,
            past: hourHasPassed(h, nowHour),
            sample: unassigned.slice(0, 6),
          })
        }
      }
      const vehicleMap = await fetchClientVehicleCounts()
      // A night shift is logged under the day it began, so both days count
      // as "clocked in right now".
      const yesterday = yesterdayTop
      const { poolNames } = buildHourPool({
        hour: currentHour, leaveMap, overridesMap, onShiftNames: onShiftNamesTop,
        clockedOutNames: getClockedOutNamesFromLog(shiftRows, [today, yesterday]),
        // Somebody on a long break is not working this hour, so the hour is
        // not theirs — the boards apply the same rule, and the two must never
        // disagree about who holds a client.
        awayNames: awayNamesTop,
      })
      const locked = buildLockedAssignments(updateRows, today, currentHour)
      const dist = distributeClientsForHour(currentHour, poolNames, vehicleMap, locked, true)
      Object.entries(dist).forEach(([name, clients]) => {
        if (!workByEmp[name]) workByEmp[name] = { assigned: 0, completed: 0 }
        // Anything already finished is counted above; this adds what is
        // still outstanding on their board right now.
        const outstanding = clients.filter(c => locked[c.client] !== name).length
        workByEmp[name].assigned += outstanding
      })
    } catch (e) {
      // The live split is an improvement on the row trail, not a
      // requirement — never take the whole Command Center down for it.
      console.error('overview: live split failed', e.message)
    }

    const empStatus = employees().map(emp => {
      const shiftLog   = todayShifts.find(r => r[1] === emp.name)
      const override   = overridesMap[emp.name]
      const effective  = override ? { ...emp, start: override.start, end: override.end } : emp
      const isActive   = isScheduledAtHour(effective, currentHour)
      const isWeekOff  = weekOffEmps.has(emp.name)
      const hasStarted = !!shiftLog?.[3]
      const hasEnded   = shiftLog?.[6] === 'Ended'
      // Row still says Active, but not recently enough to be believed — the
      // shift was never closed and the day has moved on. It is neither "on
      // duty" nor "ended"; it is a row somebody has to tidy up.
      const shiftStale = hasStarted && !hasEnded && !onShiftNamesTop.has(emp.name)

      const myWork = workByEmp[emp.name] || { assigned: 0, completed: 0 }
      const assignedCount  = myWork.assigned
      const completedCount = myWork.completed

      let statusLabel = 'Not Started'
      if (isWeekOff)        statusLabel = 'Week Off'
      else if (hasEnded)    statusLabel = 'Ended'
      else if (shiftStale)  statusLabel = 'Left Open'
      else if (hasStarted)  statusLabel = 'Active'
      else if (isActive)    statusLabel = 'Not Started'
      else                  statusLabel = 'Off Shift'

      return {
        name:         emp.name,
        shiftStart:   emp.start,
        shiftEnd:     emp.end,
        // The window actually in force today — an Early/Late Start or OT
        // adjustment moves this away from the static roster hours, and the
        // admin needs to see the real one.
        effStart:     effective.start,
        effEnd:       effective.end,
        isAdjusted:   !!override,
        // Is this employee inside their shift window at this very hour?
        // Drives the live "right now" health reading.
        isScheduledNow: isActive,
        // Clocked in, but their window has already run out. Nothing closes a
        // shift on its own, so this is somebody the admin has to chase: the
        // attendance row has no end time and no duration until it is closed.
        shiftOverdue: statusLabel === 'Active' && !isActive,
        // A shift row still open from long enough ago that nobody is coming
        // back to it. Shown separately so it reads as data to clean up rather
        // than as somebody standing on the floor.
        shiftStale,
        onBreakLong:  awayNamesTop.has(emp.name),
        isNight:      emp.isNight,
        isWeekOff,
        statusLabel,
        startTime:    shiftLog?.[3] || '',
        endTime:      shiftLog?.[4] || '',
        duration:     shiftLog?.[5] || '',
        totalUpdates: completedCount,
        assignedCount,
        pendingCount: assignedCount - completedCount,
      }
    })

    const todayRedistrib = redistRows.slice(1)
      .filter(r => r[0] === today)
      .map(r => ({ from: r[2], to: r[3], client: r[4], hour: r[5] }))

    // Issue Tracker: J(9)=Sub-request, R(17)=Resolved Y/N
    const pendingFootage = footageRows.slice(1).filter(r => {
      const sub = (r[9] || '').toString().toLowerCase()
      const resolved = (r[17] || '').toString().toLowerCase()
      return sub.includes('customer request for video') && resolved !== 'yes'
    }).length

    const doneFootage = footageRows.slice(1).filter(r => {
      const sub = (r[9] || '').toString().toLowerCase()
      const resolved = (r[17] || '').toString().toLowerCase()
      return sub.includes('customer request for video') && resolved === 'yes'
    }).length

    return res.status(200).json({
      employees:      empStatus,
      coverageGaps,
      redistribution: todayRedistrib,
      footage: { pending: pendingFootage, done: doneFootage },
      kpis: {
        total:      employees().length,
        active:     empStatus.filter(e => e.statusLabel === 'Active').length,
        weekOff:    empStatus.filter(e => e.isWeekOff).length,
        notStarted: empStatus.filter(e => e.statusLabel === 'Not Started').length,
      },
    })

  } catch (err) {
    console.error('Admin overview error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
