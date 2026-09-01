import { getUserFromReq } from '../../../lib/auth'
import { appendRow, CRM_SHEET_ID, TABS, todayStr, nowStr } from '../../../lib/sheets'
import { employees } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const { issueId, client, vehicle, forwardedTo } = req.body
    if (!issueId || !forwardedTo) return res.status(400).json({ error: 'issueId and forwardedTo required' })

    // The name has to be somebody on the roster.
    //
    // This took whatever it was given and wrote it into the queue. The screen
    // only ever offers real colleagues — the list comes from the same roster —
    // so a bad name could not arrive by accident from the app. It could arrive
    // any other way, and then the request sat in a queue addressed to nobody:
    // never shown to anyone, never chased, and counted as forwarded. A footage
    // request that quietly goes nowhere is worse than one that fails loudly.
    //
    // Matched on the trimmed name, the same way every other tab keys on it.
    await loadScheduleData()
    const known = employees().some(e =>
      (e.name || '').toString().trim() === forwardedTo.toString().trim())
    if (!known) {
      return res.status(400).json({ error: `${forwardedTo} is not on the roster — pick a name from the list.` })
    }

    await appendRow(CRM_SHEET_ID, TABS.FOOTAGE_FOLLOWUP, [
      todayStr(), nowStr(), issueId, client || '', vehicle || '',
      user.name, forwardedTo, 'Pending', '', '',
    ])
    return res.status(200).json({ success: true })
  } catch (err) {
    console.error('Forward error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
