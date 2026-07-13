import { getUserFromReq } from '../../../lib/auth'
import { readSheet, CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr } from '../../../lib/sheets'
import { ALL_EMPLOYEES, isScheduledAtHour } from '../../../lib/schedule'

const ISSUE_TAB = 'Issues- Realtime'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    const today       = todayStr()
    const currentHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours()

    const [credRows, shiftRows, updateRows, redistRows, footageRows] = await Promise.all([
      readSheet(CRM_SHEET_ID,   `${TABS.CREDENTIALS}!A:H`),
      readSheet(CRM_SHEET_ID,   `${TABS.SHIFT_LOG}!A:H`),
      readSheet(CRM_SHEET_ID,   `${TABS.CRM_UPDATES}!A:K`),
      readSheet(CRM_SHEET_ID,   `${TABS.REDISTRIB}!A:G`),
      readSheet(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`),
    ])

    const weekOffEmps = new Set(
      credRows.slice(1)
        .filter(r => (r[7] || '').toString().toLowerCase() === 'yes')
        .map(r => r[1])
    )

    const todayShifts = shiftRows.slice(1).filter(r => r[2] === today)

    const empStatus = ALL_EMPLOYEES.map(emp => {
      const shiftLog   = todayShifts.find(r => r[1] === emp.name)
      const isActive   = isScheduledAtHour(emp, currentHour)
      const isWeekOff  = weekOffEmps.has(emp.name)
      const hasStarted = !!shiftLog?.[3]
      const hasEnded   = shiftLog?.[6] === 'Ended'

      const myUpdates = updateRows.slice(1).filter(r => r[0] === today && r[2] === emp.name)
      const myPending = myUpdates.filter(r => !r[5] || r[5] === '')

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
        isNight:      emp.isNight,
        isWeekOff,
        statusLabel,
        startTime:    shiftLog?.[3] || '',
        endTime:      shiftLog?.[4] || '',
        duration:     shiftLog?.[5] || '',
        totalUpdates: myUpdates.length,
        pendingCount: myPending.length,
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
