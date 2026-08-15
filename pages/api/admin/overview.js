import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr,
  getShiftOverridesForDate, getLeaveMapForDate, getOnShiftNamesFromLog, fetchClientVehicleCounts,
} from '../../../lib/sheets'
import { ALL_EMPLOYEES, isScheduledAtHour, distributeClientsForHour } from '../../../lib/schedule'
import { buildHourPool, buildLockedAssignments, collapseSlotOwners } from '../../../lib/distribution'

const ISSUE_TAB = 'Issues- Realtime'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    const today       = todayStr()
    const currentHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours()

    const [credRows, shiftRows, updateRows, redistRows, footageRows, overridesMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID,   `${TABS.CREDENTIALS}!A:H`, 60000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.SHIFT_LOG}!A:H`, 15000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.CRM_UPDATES}!A:K`, 15000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.REDISTRIB}!A:G`, 15000),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, 30000),
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

    // The hour in progress, worked out exactly as the employee's own board
    // works it out — same pool, same locks, same vehicle-count balancing.
    try {
      const leaveMap   = await getLeaveMapForDate(today)
      const vehicleMap = await fetchClientVehicleCounts()
      // A night shift is logged under the day it began, so both days count
      // as "clocked in right now".
      const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
      const y = new Date(istNow.getTime() - 24 * 3600000)
      const yesterday = `${String(y.getDate()).padStart(2,'0')}/${String(y.getMonth()+1).padStart(2,'0')}/${y.getFullYear()}`
      const onShiftNames = getOnShiftNamesFromLog(shiftRows, [today, yesterday])
      const { poolNames } = buildHourPool({ hour: currentHour, leaveMap, overridesMap, onShiftNames })
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

    const empStatus = ALL_EMPLOYEES.map(emp => {
      const shiftLog   = todayShifts.find(r => r[1] === emp.name)
      const override   = overridesMap[emp.name]
      const effective  = override ? { ...emp, start: override.start, end: override.end } : emp
      const isActive   = isScheduledAtHour(effective, currentHour)
      const isWeekOff  = weekOffEmps.has(emp.name)
      const hasStarted = !!shiftLog?.[3]
      const hasEnded   = shiftLog?.[6] === 'Ended'

      const myWork = workByEmp[emp.name] || { assigned: 0, completed: 0 }
      const assignedCount  = myWork.assigned
      const completedCount = myWork.completed

      let statusLabel = 'Not Started'
      if (isWeekOff)       statusLabel = 'Week Off'
      else if (hasEnded)   statusLabel = 'Ended'
      else if (hasStarted) statusLabel = 'Active'
      else if (isActive)   statusLabel = 'Not Started'
      else                 statusLabel = 'Off Shift'

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
      redistribution: todayRedistrib,
      footage: { pending: pendingFootage, done: doneFootage },
      kpis: {
        total:      ALL_EMPLOYEES.length,
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
