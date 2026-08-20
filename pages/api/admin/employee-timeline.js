import { getUserFromReq } from '../../../lib/auth'
import { readSheetCached, CRM_SHEET_ID, TABS, todayStr, TTL } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    const employeeName = (req.query.employee || '').toString()
    const date = (req.query.date || todayStr()).toString()
    if (!employeeName) return res.status(400).json({ error: 'employee required' })

    const [updateRows, redistRows] = await Promise.all([
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:L`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`, TTL.LIVE),
    ])

    const myUpdates  = updateRows.slice(1).filter(r => r[0] === date && r[2] === employeeName)
    const redistTo   = redistRows.slice(1).filter(r => r[0] === date && r[3] === employeeName)
    const redistFrom = redistRows.slice(1).filter(r => r[0] === date && r[2] === employeeName)

    const hourMap = {}
    myUpdates.forEach(r => {
      const hour = parseInt(r[4])
      if (!hourMap[hour]) hourMap[hour] = []
      hourMap[hour].push({
        client: r[3],
        status: r[5] || '',
        misalignVehicles: r[6] || '',
        alertCount: r[7] || '',
        fatigue: r[8] || '',
        filled: !!(r[5] || r[6] || r[7]),
        time: r[1] || '',
      })
    })

    redistTo.forEach(r => {
      const hour = parseInt(r[5])
      if (!hourMap[hour]) hourMap[hour] = []
      const clientName = r[4]
      if (!hourMap[hour].some(c => c.client === clientName)) {
        hourMap[hour].push({
          client: clientName, status: '', misalignVehicles: '', alertCount: '', fatigue: '',
          filled: false, isRedistributed: true, fromEmployee: r[2],
        })
      }
    })

    const timeline = Object.keys(hourMap)
      .map(h => parseInt(h)).sort((a, b) => a - b)
      .map(hour => ({
        hour,
        clients: hourMap[hour],
        totalClients: hourMap[hour].length,
        completedClients: hourMap[hour].filter(c => c.filled).length,
      }))

    const totalClients   = timeline.reduce((s, t) => s + t.totalClients, 0)
    const totalCompleted = timeline.reduce((s, t) => s + t.completedClients, 0)

    return res.status(200).json({
      employee: employeeName,
      date,
      timeline,
      totalClients,
      totalCompleted,
      totalMissed: totalClients - totalCompleted,
      redistributedAway: redistFrom.map(r => ({ client: r[4], toEmployee: r[3], hour: parseInt(r[5]) })),
    })

  } catch (err) {
    console.error('Employee timeline error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
