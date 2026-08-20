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

    // Close EVERY open row for this request, not just the first one found.
    //
    // A request that has been handed on has a row per hand-off, and they are
    // all still open. Closing only the earliest left the latest one Pending —
    // so the request stayed on the screen and the admin's Close did nothing
    // they could see. Pressing it again closed the second row, and so on:
    // one press per hand-off, with no way to tell how many were needed.
    //
    // Closing the request means closing the request.
    const openRows = []
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][2] === issueId && !(rows[i][7] || '').toString().startsWith('Closed')) {
        openRows.push(i + 1)
      }
    }
    if (openRows.length === 0) return res.status(404).json({ error: 'Follow-up not found' })

    // Update cols H (Status), I (ClosedBy), J (ClosedAt)
    const closedAt = `${todayStr()} ${nowStr()}`
    for (const rowIndex of openRows) {
      await updateRowCells(CRM_SHEET_ID, TABS.FOOTAGE_FOLLOWUP, rowIndex, 8, [
        `Closed — ${reason || 'Admin closed'}`, user.name, closedAt
      ])
    }

    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('Close followup error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
