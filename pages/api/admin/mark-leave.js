import { getUserFromReq } from '../../../lib/auth'
import { appendRow, CRM_SHEET_ID, TABS, todayStr, nowStr } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    const { empId, empName, date, fromHour, toHour, reason } = req.body
    if (!empName || !date || fromHour === undefined) {
      return res.status(400).json({ error: 'empName, date, fromHour required' })
    }
    const now = nowStr()
    // EmpID | Name | Date | LeaveFrom_Hour | LeaveTo_Hour | Reason | MarkedBy | MarkedAt
    await appendRow(CRM_SHEET_ID, TABS.LEAVES, [
      empId || '', empName, date, fromHour, toHour ?? '', reason || 'Admin marked', user.name, now,
    ])
    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('Mark leave error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
