// ══════════════════════════════════════════════════════════════════════
// Two things an admin can say about a client, and the tabs that hold them
//
//   HIDDEN   "This client is not being watched on these dates." A date, not a
//            rule — future dates are the point of it, so a fleet that has told
//            us it is off the road next Tuesday is marked today and nobody has
//            to remember on Tuesday morning. The client comes off every board,
//            every total and every audit for those days, so it is not counted
//            as work anybody missed.
//
//   NOTE     "Whoever gets this client at this hour, read this first." No
//            date: it stands until it is deleted, because it is a standing
//            instruction about the client rather than a fact about one day.
//            The client sorts to the top of that hour's board and the note is
//            shown on it.
//
// ── Why nothing is ever deleted from the sheet ────────────────────────
//
// There is no row-delete in lib/sheets, deliberately: deleting by row index on
// a live book is a race, and the row you delete is whichever one is at that
// index by the time Google acts. So "delete" appends a row marked Removed, and
// the parsers in lib/roster take the LAST row for a key. That makes removal
// idempotent, safe under concurrency, and leaves a record of who took what off
// which day — which somebody will eventually want.
// ══════════════════════════════════════════════════════════════════════
import { getUserFromReq } from '../../../lib/auth'
import {
  appendRows, ensureTab, invalidateSheetCache, readSheetCached,
  CRM_SHEET_ID, TABS, TTL, todayStr, nowStr,
  CLIENT_HIDDEN_HEADER, CLIENT_NOTES_HEADER,
} from '../../../lib/sheets'
import { loadScheduleData } from '../../../lib/roster'
import { clientTimings, hiddenMap, clientNotes } from '../../../lib/schedule'

const DATE = /^\d{2}\/\d{2}\/\d{4}$/

// The operating day is what every date column in these sheets holds, so a
// date typed on the screen has to arrive in that shape and no other. A
// malformed one would sit in the tab hiding nothing, which looks exactly like
// the feature not working.
const validDate = (d) => DATE.test(d)

export default async function handler(req, res) {
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    await loadScheduleData()

    // ── What the screen needs to draw itself ──────────────────────────
    if (req.method === 'GET') {
      const timings = clientTimings()
      return res.status(200).json({
        today: todayStr(),
        // Every client, with the hours it actually runs. The note form offers
        // only these hours for the client chosen — an hour the client is not
        // scheduled for is an hour it can never be held in, so a note there
        // would never be seen and the admin would have no way of knowing.
        clients: Object.entries(timings)
          .map(([client, hours]) => ({ client, hours: [...hours].sort((a, b) => a - b) }))
          .sort((a, b) => a.client.localeCompare(b.client)),
        hidden: Object.entries(hiddenMap())
          .flatMap(([date, set]) => [...set].map(client => ({ date, client })))
          .sort((a, b) => a.date.localeCompare(b.date) || a.client.localeCompare(b.client)),
        notes: Object.entries(clientNotes())
          .flatMap(([client, byHour]) =>
            Object.entries(byHour).map(([hour, note]) => ({ client, hour: Number(hour), note })))
          .sort((a, b) => a.client.localeCompare(b.client) || a.hour - b.hour),
      })
    }

    if (req.method !== 'POST') return res.status(405).end()

    const { action, kind } = req.body || {}
    if (kind !== 'hidden' && kind !== 'note') {
      return res.status(400).json({ error: 'kind must be "hidden" or "note"' })
    }
    const at = `${todayStr()} ${nowStr()}`

    // ══ Hidden ══════════════════════════════════════════════════════
    if (kind === 'hidden') {
      const clients = [...new Set((req.body.clients || []).map(c => (c || '').toString().trim()).filter(Boolean))]
      const dates   = [...new Set((req.body.dates   || []).map(d => (d || '').toString().trim()).filter(Boolean))]
      if (!clients.length) return res.status(400).json({ error: 'Pick at least one client.' })
      if (!dates.length)   return res.status(400).json({ error: 'Pick at least one date.' })

      const bad = dates.filter(d => !validDate(d))
      if (bad.length) return res.status(400).json({ error: `Dates must be dd/mm/yyyy — got ${bad[0]}` })

      // A client the timings sheet has never heard of cannot be hidden,
      // because it was never shown. Refusing it here is how a typo is caught
      // at the moment it is made rather than a week later when somebody
      // wonders why nothing happened.
      const known = clientTimings()
      const unknown = clients.filter(c => known[c] === undefined)
      if (unknown.length) {
        return res.status(400).json({ error: `Not in Client_Timings: ${unknown.join(', ')}` })
      }

      const status = action === 'remove' ? 'Removed' : 'Hidden'
      const reason = (req.body.reason || '').toString().trim().slice(0, 200)
      const rows = []
      dates.forEach(date => clients.forEach(client =>
        rows.push([date, client, reason, user.name, at, status])))

      await ensureTab(CRM_SHEET_ID, TABS.CLIENT_HIDDEN, CLIENT_HIDDEN_HEADER)
      await appendRows(CRM_SHEET_ID, TABS.CLIENT_HIDDEN, rows)
      invalidateSheetCache(CRM_SHEET_ID, `${TABS.CLIENT_HIDDEN}!`)
      return res.status(200).json({ ok: true, written: rows.length, status })
    }

    // ══ Note ════════════════════════════════════════════════════════
    const clients = [...new Set((req.body.clients || []).map(c => (c || '').toString().trim()).filter(Boolean))]
    const hours   = [...new Set((req.body.hours || []).map(h => parseInt(h, 10)).filter(h => Number.isInteger(h) && h >= 0 && h <= 23))]
    if (!clients.length) return res.status(400).json({ error: 'Pick at least one client.' })
    if (!hours.length)   return res.status(400).json({ error: 'Pick at least one hour.' })

    const timings = clientTimings()
    const unknown = clients.filter(c => timings[c] === undefined)
    if (unknown.length) return res.status(400).json({ error: `Not in Client_Timings: ${unknown.join(', ')}` })

    // ── An hour the client does not run in ────────────────────────────
    //
    // Client_Timings is the master list, so a note at an hour it does not
    // schedule can never be delivered: nobody holds the client then. Silently
    // writing it would be the same fault the pins had — a second sheet
    // quietly disagreeing with the one that decides.
    if (action !== 'remove') {
      const offHours = []
      clients.forEach(c => hours.forEach(h => {
        if (!(timings[c] || []).includes(h)) offHours.push(`${c} @ ${h}:00`)
      }))
      if (offHours.length) {
        return res.status(400).json({
          error: `Client_Timings does not run these at that hour: ${offHours.slice(0, 4).join(', ')}` +
                 (offHours.length > 4 ? ` and ${offHours.length - 4} more` : ''),
        })
      }
    }

    const note = (req.body.note || '').toString().trim().slice(0, 500)
    if (action !== 'remove' && !note) return res.status(400).json({ error: 'Write the note.' })

    const status = action === 'remove' ? 'Removed' : 'Active'
    const rows = []
    clients.forEach(client => hours.forEach(hour =>
      rows.push([client, String(hour), note, user.name, at, status])))

    await ensureTab(CRM_SHEET_ID, TABS.CLIENT_NOTES, CLIENT_NOTES_HEADER)
    await appendRows(CRM_SHEET_ID, TABS.CLIENT_NOTES, rows)
    invalidateSheetCache(CRM_SHEET_ID, `${TABS.CLIENT_NOTES}!`)
    return res.status(200).json({ ok: true, written: rows.length, status })
  } catch (err) {
    console.error('client-rules error:', err)
    return res.status(500).json({ error: err.message || 'Server error' })
  }
}
