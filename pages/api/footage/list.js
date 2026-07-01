import { getUserFromReq } from '../../../lib/auth'
import { readSheet, ISSUE_SHEET_ID, CRM_SHEET_ID, TABS } from '../../../lib/sheets'

const ISSUE_TAB = 'Issues- Realtime'

// NEW column layout (0-indexed) confirmed from sheet screenshot:
const COL = {
  CLIENT:       2,   // C
  VEHICLE:      3,   // D
  RAISED_AT:    4,   // E - Timestamp Issues Raised
  RAISED_BY:    5,   // F
  SUB_REQUEST:  7,   // H
  DETAILS:      8,   // I - Issue Details
  REMARKS:      10,  // K - Remarks
  LOCATION:     13,  // N
  RESOLVED:     15,  // P - Resolved Y/N
  RESOLVED_AT:  16,  // Q - Timestamp Issues Resolved
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const rows = await readSheet(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:R`)
    if (!rows || rows.length < 2) {
      return res.status(200).json({ pending: [], completed: [], followups: [] })
    }

    const pending = [], completed = []
    const byIssueId = {}

    rows.slice(1).forEach((row, idx) => {
      const sub = (row[COL.SUB_REQUEST] || '').toString().trim().toLowerCase()
      if (!sub.includes('customer request for video')) return

      const raisedBy  = (row[COL.RAISED_BY] || '').toString().trim().toLowerCase()
      const empName   = user.name.toLowerCase()
      const resolvedRaw = (row[COL.RESOLVED] || '').toString().trim().toLowerCase()
      const resolved  = resolvedRaw === 'yes' || resolvedRaw === 'true' || resolvedRaw === '1'

      // Use row number as stable ID since no explicit Issue ID col in new layout
      const rowNum = idx + 2 // +1 for slice, +1 for header
      const issueId = `ISS${String(rowNum).padStart(5,'0')}`

      const item = {
        rowIndex:   rowNum,
        issueId,
        client:     row[COL.CLIENT]      || '',
        vehicle:    row[COL.VEHICLE]     || '',
        raisedAt:   row[COL.RAISED_AT]   || '',
        raisedBy:   row[COL.RAISED_BY]   || '',
        details:    row[COL.DETAILS]     || '',
        remarks:    row[COL.REMARKS]     || '',
        location:   row[COL.LOCATION]    || '',
        resolvedAt: row[COL.RESOLVED_AT] || '',
        resolved,
      }
      byIssueId[issueId] = item

      const shouldShow = user.role === 'admin' || raisedBy === empName
      if (!shouldShow) return

      if (resolved) completed.push(item)
      else pending.push(item)
    })

    // Follow-ups forwarded TO this employee
    const followupRows = await readSheet(CRM_SHEET_ID, `${TABS.FOOTAGE_FOLLOWUP}!A:J`)
    let followups = []

    if (user.role === 'admin') {
      followups = followupRows.slice(1)
        .filter(r => r[7] !== 'Closed' && !(byIssueId[r[2]]?.resolved))
        .map(r => ({
          issueId:          r[2],
          client:           r[3] || byIssueId[r[2]]?.client || '',
          vehicle:          r[4] || byIssueId[r[2]]?.vehicle || '',
          originalEmployee: r[5],
          forwardedTo:      r[6],
          forwardedAt:      `${r[0]} ${r[1]}`,
          status:           r[7] || 'Pending',
          details:          byIssueId[r[2]]?.details || '',
          raisedAt:         byIssueId[r[2]]?.raisedAt || '',
          location:         byIssueId[r[2]]?.location || '',
        }))
    } else {
      followups = followupRows.slice(1)
        .filter(r => r[6] === user.name && r[7] !== 'Closed' && !(byIssueId[r[2]]?.resolved))
        .map(r => ({
          issueId:          r[2],
          client:           r[3] || byIssueId[r[2]]?.client || '',
          vehicle:          r[4] || byIssueId[r[2]]?.vehicle || '',
          originalEmployee: r[5],
          forwardedTo:      r[6],
          forwardedAt:      `${r[0]} ${r[1]}`,
          status:           r[7] || 'Pending',
          details:          byIssueId[r[2]]?.details || '',
          raisedAt:         byIssueId[r[2]]?.raisedAt || '',
          location:         byIssueId[r[2]]?.location || '',
        }))
    }

    return res.status(200).json({ pending, completed, followups })

  } catch (err) {
    console.error('Footage list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
