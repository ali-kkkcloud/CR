import { getUserFromReq } from '../../../lib/auth'
import { readSheetCached, ISSUE_SHEET_ID, CRM_SHEET_ID, TABS, TTL } from '../../../lib/sheets'

const ISSUE_TAB = 'Issues- Realtime'

// Column layout (0-indexed) confirmed from the live "Issues- Realtime" sheet
// header row: A(unused) B=Issue Id C=Clients D=Vehicle Number
// E=Timestamp Issues Raised F=Year G=Month H=Raised by I=Raised via[Forum]
// J=Sub-request K=Issue Details L=Incident Type M=Remarks N=(unused)
// O=Assigned To P=Location Q=Last Online R=Resolved Y/N
// S=Timestamp Issues Resolved T=Date-Current Status
const COL = {
  ISSUE_ID:     1,   // B
  CLIENT:       2,   // C
  VEHICLE:      3,   // D
  RAISED_AT:    4,   // E - Timestamp Issues Raised
  RAISED_BY:    7,   // H
  SUB_REQUEST:  9,   // J
  DETAILS:      10,  // K - Issue Details
  INCIDENT_TYPE:11,  // L
  REMARKS:      12,  // M
  ASSIGNED_TO:  14,  // O
  LOCATION:     15,  // P
  LAST_ONLINE:  16,  // Q
  RESOLVED:     17,  // R - Resolved Y/N
  RESOLVED_AT:  18,  // S - Timestamp Issues Resolved
  CURR_STATUS:  19,  // T - Date-Current Status
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    // Cached — the Issue Tracker is the biggest sheet the app reads and this
    // list is polled from every dashboard.
    const rows = await readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, TTL.ISSUES)
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

      // Prefer the sheet's real Issue Id (col B); fall back to a synthesized
      // one only if that cell is blank so nothing crashes on legacy rows.
      const rowNum = idx + 2 // +1 for slice, +1 for header
      const issueId = (row[COL.ISSUE_ID] || '').toString().trim() || `ISS${String(rowNum).padStart(5,'0')}`

      const item = {
        rowIndex:     rowNum,
        issueId,
        client:       row[COL.CLIENT]        || '',
        vehicle:      row[COL.VEHICLE]       || '',
        raisedAt:     row[COL.RAISED_AT]     || '',
        raisedBy:     row[COL.RAISED_BY]     || '',
        details:      row[COL.DETAILS]       || '',
        incidentType: row[COL.INCIDENT_TYPE] || '',
        remarks:      row[COL.REMARKS]       || '',
        assignedTo:   row[COL.ASSIGNED_TO]   || '',
        location:     row[COL.LOCATION]      || '',
        lastOnline:   row[COL.LAST_ONLINE]   || '',
        resolvedAt:   row[COL.RESOLVED_AT]   || '',
        currentStatus:row[COL.CURR_STATUS]   || '',
        resolved,
      }
      // The last row wins. The Issue Tracker is filled in by hand and by other
      // tools, and the same request turning up twice is ordinary — but showing
      // it twice makes a queue of nine look like a queue of eleven, and the
      // person working it cannot tell which copy they already did.
      const seenBefore = issueId in byIssueId
      byIssueId[issueId] = item

      const shouldShow = user.role === 'admin' || raisedBy === empName
      if (!shouldShow) return

      const list = resolved ? completed : pending
      if (seenBefore) {
        // Replace the earlier copy wherever it landed, rather than adding to it.
        const dropFrom = (arr) => {
          const i = arr.findIndex(x => x.issueId === issueId)
          if (i >= 0) arr.splice(i, 1)
        }
        dropFrom(pending); dropFrom(completed)
      }
      list.push(item)
    })

    // ── Follow-ups: one row per request, the latest one ──────────────────
    //
    // Forwarding APPENDS. That is right — the tab is the record of who handed
    // what to whom, and rewriting it would throw the trail away. But it means
    // one request can have several rows: handed on twice, or forwarded again
    // at the end of a later shift, or simply saved twice when the first press
    // looked like it had not worked.
    //
    // Reading every row as its own item duplicated the request on the screen.
    // Worse, it duplicated it in the WRONG PLACES: a request handed from one
    // person to a second and on to a third sat in all three queues at once,
    // because the first two rows still said Pending against their names. Three
    // people each believed the same footage was theirs to pull.
    //
    // The last row for a request is where it stands now. Everything before it
    // is history.
    const followupRows = await readSheetCached(CRM_SHEET_ID, `${TABS.FOOTAGE_FOLLOWUP}!A:J`, TTL.QUEUE)
    const latestByIssue = new Map()
    followupRows.slice(1).forEach(r => {
      const id = (r[2] || '').toString().trim()
      if (id) latestByIssue.set(id, r)
    })

    const asFollowup = (r) => ({
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
    })

    // Closing writes "Closed — <reason>", never the bare word. Testing for
    // equality with 'Closed' therefore matched nothing at all, so every
    // follow-up an admin had ever closed stayed on the screen forever,
    // stacking up beside the live ones with no way to tell them apart.
    const isClosed = (r) => (r[7] || '').toString().trim().startsWith('Closed')
    const open = [...latestByIssue.values()]
      .filter(r => !isClosed(r) && !(byIssueId[r[2]]?.resolved))
    const followups = (user.role === 'admin' ? open : open.filter(r => r[6] === user.name))
      .map(asFollowup)

    return res.status(200).json({ pending, completed, followups })

  } catch (err) {
    console.error('Footage list error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
