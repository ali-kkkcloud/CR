import { getUserFromReq } from '../../../lib/auth'
import { readSheet, ISSUE_SHEET_ID } from '../../../lib/sheets'

const ISSUE_TAB = 'Issues- Realtime'
const COL = {
  ISSUE_ID:0, CLIENT:2, RAISED_AT:3, LAST_ONLINE:4,
  SUB_REQUEST:5, DETAILS:6, VEHICLE:9, RAISED_BY:10,
  RESOLVED:13, RESOLVED_AT:14, LOCATION:15,
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const rows = await readSheet(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:S`)
    if (!rows || rows.length < 2) return res.status(200).json({ pending: [], completed: [] })

    const pending = [], completed = []

    rows.slice(1).forEach((row, idx) => {
      const sub = (row[COL.SUB_REQUEST] || '').toString().trim().toLowerCase()
      if (!sub.includes('customer request for video')) return

      const raisedBy = (row[COL.RAISED_BY] || '').toString().trim().toLowerCase()
      const empName  = user.name.toLowerCase()
      const resolved = (row[COL.RESOLVED] || '').toString().trim().toLowerCase()

      const shouldShow = user.role === 'admin' || raisedBy === empName
      if (!shouldShow) return

      const item = {
        rowIndex:   idx + 2,
        issueId:    row[COL.ISSUE_ID]    || '',
        client:     row[COL.CLIENT]      || '',
        raisedAt:   row[COL.RAISED_AT]   || '',
        details:    row[COL.DETAILS]     || '',
        vehicle:    row[COL.VEHICLE]     || '',
        raisedBy:   row[COL.RAISED_BY]   || '',
        location:   row[COL.LOCATION]    || '',
        resolvedAt: row[COL.RESOLVED_AT] || '',
        resolved:   resolved === 'yes',
      }

      if (resolved === 'yes') completed.push(item)
      else pending.push(item)
    })

    return res.status(200).json({ pending, completed })

  } catch (err) {
    console.error('Footage list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
