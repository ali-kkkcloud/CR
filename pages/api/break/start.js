import { getUserFromReq } from '../../../lib/auth'
import { appendRow, readSheet, CRM_SHEET_ID, TABS, todayStr, nowStr } from '../../../lib/sheets'
import { recentDates, findOpenBreaks } from '../../../lib/attendance'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const now   = nowStr()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`)

    // Don't allow two overlapping breaks. Searched across both days, since a
    // break opened at 23:52 is still the one running at 00:05 — matching on
    // today alone would open a second row alongside it.
    const open = findOpenBreaks(rows, user.empId, recentDates())
    if (open.length > 0) {
      return res.status(200).json({ success: true, alreadyOnBreak: true, startTime: open[0].startTime })
    }

    // Cols: EmpId | Name | Date | StartTime | EndTime | DurationMinutes | Status | Type
    await appendRow(CRM_SHEET_ID, TABS.BREAKS, [user.empId, user.name, today, now, '', '', 'Active', 'Manual'])
    return res.status(200).json({ success: true, startTime: now })
  } catch (err) {
    console.error('Break start error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
