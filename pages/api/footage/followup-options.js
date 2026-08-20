import { getUserFromReq } from '../../../lib/auth'
import { readSheetCached, CRM_SHEET_ID, TABS, todayStr, TTL } from '../../../lib/sheets'
import { employees } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const today = todayStr()
    const shiftRows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE)
    const statusMap = {}
    for (let i = 1; i < shiftRows.length; i++) {
      const r = shiftRows[i]
      if (r[2] === today) statusMap[r[1]] = r[6]
    }

    const active = employees()
      .filter(e => statusMap[e.name] === 'Active' && e.name !== user.name)
      .map(e => ({ name: e.name, isNight: e.isNight, status: 'active' }))

    const others = employees()
      .filter(e => statusMap[e.name] !== 'Active' && e.name !== user.name)
      .map(e => ({ name: e.name, isNight: e.isNight, status: statusMap[e.name] === 'Ended' ? 'ended' : 'not_started' }))

    return res.status(200).json({ active, others })
  } catch (err) {
    console.error('Followup options error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
