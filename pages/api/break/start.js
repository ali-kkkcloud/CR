import { getUserFromReq } from '../../../lib/auth'
import { appendRow, readSheet, CRM_SHEET_ID, TABS, todayStr, nowStr } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const now   = nowStr()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.BREAKS}!A:G`)

    // Don't allow two overlapping breaks
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i]
      if ((r[0] || '').toString().trim() === user.empId.toString().trim() && r[2] === today && r[6] === 'Active') {
        return res.status(200).json({ success: true, alreadyOnBreak: true, startTime: r[3] })
      }
    }

    // Cols: EmpId | Name | Date | StartTime | EndTime | DurationMinutes | Status | Type
    await appendRow(CRM_SHEET_ID, TABS.BREAKS, [user.empId, user.name, today, now, '', '', 'Active', 'Manual'])
    return res.status(200).json({ success: true, startTime: now })
  } catch (err) {
    console.error('Break start error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
