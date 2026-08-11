import { getUserFromReq } from '../../../lib/auth'
import { readSheet, readSheetCached, CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr, getShiftOverridesForDate } from '../../../lib/sheets'
import { ALL_EMPLOYEES, isScheduledAtHour } from '../../../lib/schedule'

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

    // ── Collapse every (client, hour) slot down to one owner + done flag ──
    // CRM_Updates is append-only, so a single slot can show up several
    // times: the placeholder written when it was assigned, another one if
    // it later moved to someone else, and the real update once it's filled
    // in. Counting rows directly therefore double-counts the same piece of
    // work — which is why "Updates Completed" was reporting the assigned
    // total instead of what was actually done. A row carrying real data
    // always wins (that's who did the work); otherwise the most recent
    // placeholder is the current owner.
    const slotState = new Map()
    updateRows.slice(1).forEach(r => {
      if (r[0] !== today) return
      const key = `${r[3]}|${r[4]}`
      const isDone = !!(r[5] || '').toString().trim()
      const prev = slotState.get(key)
      if (prev && prev.done && !isDone) return
      slotState.set(key, { owner: r[2], done: isDone })
    })

    const workByEmp = {}
    slotState.forEach(({ owner, done }) => {
      if (!workByEmp[owner]) workByEmp[owner] = { assigned: 0, completed: 0 }
      workByEmp[owner].assigned += 1
      if (done) workByEmp[owner].completed += 1
    })

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
