import { getUserFromReq } from '../../../lib/auth'
import { readSheet, ISSUE_SHEET_ID, CRM_SHEET_ID, TABS, todayStr } from '../../../lib/sheets'
import { ALL_EMPLOYEES } from '../../../lib/schedule'

const ISSUE_TAB = 'Issues- Realtime'

function dateNDaysAgo(n) {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    const today = todayStr()
    const last7Dates = Array.from({ length: 7 }, (_, i) => dateNDaysAgo(i))

    const [shiftRows, updateRows, footageRows] = await Promise.all([
      readSheet(CRM_SHEET_ID,   `${TABS.SHIFT_LOG}!A:H`),
      readSheet(CRM_SHEET_ID,   `${TABS.CRM_UPDATES}!A:K`),
      readSheet(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:S`),
    ])

    const progress = ALL_EMPLOYEES.map(emp => {
      const attendance = last7Dates.map(date => {
        const rowsForDate = shiftRows.slice(1).filter(r => r[1] === emp.name && r[2] === date)
        if (rowsForDate.length === 0) {
          return { date, status: 'absent', startTime: '', endTime: '', duration: '' }
        }
        const latest = rowsForDate[rowsForDate.length - 1]
        return {
          date,
          status:    latest[6] === 'Active' ? 'active' : latest[6] === 'Ended' ? 'completed' : 'absent',
          startTime: latest[3] || '',
          endTime:   latest[4] || '',
          duration:  latest[5] || '',
        }
      })

      const daysPresent = attendance.filter(a => a.status !== 'absent').length
      const daysAbsent   = attendance.filter(a => a.status === 'absent').length

      const todayUpdates = updateRows.slice(1).filter(r => r[0] === today && r[2] === emp.name)
      const todayClients = [...new Set(todayUpdates.map(r => r[3]))]

      const myFootage = footageRows.slice(1).filter(r => {
        const sub = (r[5]  || '').toString().toLowerCase()
        const by  = (r[10] || '').toString().trim().toLowerCase()
        return sub.includes('customer request for video') && by === emp.name.toLowerCase()
      })
      const footagePending = myFootage.filter(r => (r[13]||'').toString().toLowerCase() !== 'yes').length
      const footageCompletedToday = myFootage.filter(r => {
        const resolvedAt = (r[14]||'').toString()
        return (r[13]||'').toString().toLowerCase()==='yes' && resolvedAt.includes(today)
      }).length

      return {
        name: emp.name,
        shiftStart: emp.start,
        shiftEnd: emp.end,
        isNight: emp.isNight,
        attendance,
        daysPresent,
        daysAbsent,
        todayClientsCount: todayClients.length,
        todayUpdatesCount: todayUpdates.length,
        todayMisaligns: todayUpdates.filter(r => r[6] && r[6] !== '—' && r[6] !== '').length,
        todayAlerts: todayUpdates.reduce((s,r)=>s+(parseInt(r[7])||0),0),
        footagePending,
        footageCompletedToday,
      }
    })

    return res.status(200).json({ progress, dates: last7Dates })

  } catch (err) {
    console.error('Employee progress error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
