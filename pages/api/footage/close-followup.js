import { getUserFromReq } from '../../../lib/auth'
import { readSheet, updateRowCells, CRM_SHEET_ID, TABS, todayStr, nowStr } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden — admin only' })

  try {
    const { issueId, reason } = req.body
    if (!issueId) return res.status(400).json({ error: 'issueId required' })

    const rows = await readSheet(CRM_SHEET_ID, `${TABS.FOOTAGE_FOLLOWUP}!A:J`)
    let rowIndex = -1
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][2] === issueId && rows[i][7] !== 'Closed') {
        rowIndex = i + 1; break
      }
    }
    if (rowIndex === -1) return res.status(404).json({ error: 'Follow-up not found' })

    // Update cols H (Status), I (ClosedBy), J (ClosedAt)
    await updateRowCells(CRM_SHEET_ID, TABS.FOOTAGE_FOLLOWUP, rowIndex, 8, [
      `Closed — ${reason || 'Admin closed'}`, user.name, `${todayStr()} ${nowStr()}`
    ])

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('Close followup error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
