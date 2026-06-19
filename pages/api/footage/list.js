import { getUserFromReq } from '../../../lib/auth'
import { readSheet, ISSUE_SHEET_ID, CRM_SHEET_ID, TABS } from '../../../lib/sheets'

const ISSUE_TAB = 'Issues- Realtime'
const COL = {
  ISSUE_ID:0, CLIENT:2, RAISED_AT:3, SUB_REQUEST:5, DETAILS:6,
  VEHICLE:9, RAISED_BY:10, RESOLVED:13, RESOLVED_AT:14, LOCATION:15,
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const rows = await readSheet(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:S`)
    if (!rows || rows.length < 2) return res.status(200).json({ pending: [], completed: [], followups: [] })

    const pending = [], completed = []
    const byIssueId = {}

    rows.slice(1).forEach((row, idx) => {
      const sub = (row[COL.SUB_REQUEST] || '').toString().trim().toLowerCase()
      if (!sub.includes('customer request for video')) return
      const raisedBy = (row[COL.RAISED_BY] || '').toString().trim().toLowerCase()
      const empName  = user.name.toLowerCase()
      const resolved = (row[COL.RESOLVED] || '').toString().trim().toLowerCase()

      const item = {
        rowIndex: idx + 2,
        issueId:    row[COL.ISSUE_ID]  || '',
        client:     row[COL.CLIENT]    || '',
        raisedAt:   row[COL.RAISED_AT] || '',
        details:    row[COL.DETAILS]   || '',
        vehicle:    row[COL.VEHICLE]   || '',
        raisedBy:   row[COL.RAISED_BY] || '',
        location:   row[COL.LOCATION]  || '',
        resolvedAt: row[COL.RESOLVED_AT] || '',
        resolved:   resolved === 'yes',
      }
      byIssueId[item.issueId] = item

      const shouldShow = user.role === 'admin' || raisedBy === empName
      if (!shouldShow) return

      if (resolved === 'yes') completed.push(item)
      else pending.push(item)
    })

    // Follow-ups
    const followupRows = await readSheet(CRM_SHEET_ID, `${TABS.FOOTAGE_FOLLOWUP}!A:J`)
    let followups = []

    if (user.role === 'admin') {
      // Admin sees all open follow-ups
      followups = followupRows.slice(1)
        .filter(r => r[7] !== 'Closed' && !(byIssueId[r[2]]?.resolved))
        .map(r => ({
          issueId: r[2], client: r[3], vehicle: r[4],
          originalEmployee: r[5], forwardedTo: r[6],
          forwardedAt: `${r[0]} ${r[1]}`, status: r[7] || 'Pending',
          details: byIssueId[r[2]]?.details || '',
          raisedAt: byIssueId[r[2]]?.raisedAt || '',
          location: byIssueId[r[2]]?.location || '',
        }))
    } else {
      // Employee sees only those forwarded to them
      followups = followupRows.slice(1)
        .filter(r => r[6] === user.name && r[7] !== 'Closed' && !(byIssueId[r[2]]?.resolved))
        .map(r => ({
          issueId: r[2], client: r[3], vehicle: r[4],
          originalEmployee: r[5], forwardedTo: r[6],
          forwardedAt: `${r[0]} ${r[1]}`, status: r[7] || 'Pending',
          details: byIssueId[r[2]]?.details || '',
          raisedAt: byIssueId[r[2]]?.raisedAt || '',
          location: byIssueId[r[2]]?.location || '',
        }))
    }

    return res.status(200).json({ pending, completed, followups })
  } catch (err) {
    console.error('Footage list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
