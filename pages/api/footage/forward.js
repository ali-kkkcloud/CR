import { getUserFromReq } from '../../../lib/auth'
import { appendRow, CRM_SHEET_ID, TABS, todayStr, nowStr } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const { issueId, client, vehicle, forwardedTo } = req.body
    if (!issueId || !forwardedTo) return res.status(400).json({ error: 'issueId and forwardedTo required' })

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
