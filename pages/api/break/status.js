import { getUserFromReq } from '../../../lib/auth'
import { readSheet, CRM_SHEET_ID, TABS, todayStr, calcDurationMinutes, nowStr } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.BREAKS}!A:G`)

    const myToday = rows.slice(1).filter(r =>
      (r[0] || '').toString().trim() === user.empId.toString().trim() && r[2] === today
    )

    const active = myToday.find(r => r[6] === 'Active')
    const history = myToday.map(r => ({
      startTime: r[3] || '',
      endTime:   r[4] || '',
      minutes:   r[6] === 'Active' ? calcDurationMinutes(today, r[3], today, nowStr()) : (parseInt(r[5]) || 0),
      status:    r[6] || '',
    }))

    const totalMinutesToday = history.reduce((s,h) => s + (h.minutes||0), 0)

    return res.status(200).json({
      onBreak: !!active,
      startTime: active ? active[3] : null,
      history,
      totalMinutesToday,
    })
  } catch (err) {
    console.error('Break status error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
