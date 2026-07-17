import { getUserFromReq } from '../../../lib/auth'
import { readSheet, updateRowCells, CRM_SHEET_ID, TABS, todayStr, nowStr, calcDurationMinutes } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const now   = nowStr()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.BREAKS}!A:G`)

    let rowIndex = -1, startTime = ''
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i]
      if ((r[0] || '').toString().trim() === user.empId.toString().trim() && r[2] === today && r[6] === 'Active') {
        rowIndex = i + 1
        startTime = r[3]
        break
      }
    }
    if (rowIndex === -1) return res.status(404).json({ error: 'No active break found' })

    const minutes = calcDurationMinutes(today, startTime, today, now)
    // Cols E=EndTime F=DurationMinutes G=Status (1-indexed start col 5 = 'E')
    await updateRowCells(CRM_SHEET_ID, TABS.BREAKS, rowIndex, 5, [now, minutes, 'Completed'])

    return res.status(200).json({ success: true, endTime: now, minutes })
  } catch (err) {
    console.error('Break end error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
