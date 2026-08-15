import { getUserFromReq } from '../../../lib/auth'
import { readSheetCached, CRM_SHEET_ID, TABS, todayStr } from '../../../lib/sheets'
import { ALL_EMPLOYEES } from '../../../lib/schedule'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const shiftRows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000)
    const statusMap = {}
    for (let i = 1; i < shiftRows.length; i++) {
      const r = shiftRows[i]
      if (r[2] === today) statusMap[r[1]] = r[6]
    }

    const active = ALL_EMPLOYEES
      .filter(e => statusMap[e.name] === 'Active' && e.name !== user.name)
      .map(e => ({ name: e.name, isNight: e.isNight, status: 'active' }))

    const others = ALL_EMPLOYEES
      .filter(e => statusMap[e.name] !== 'Active' && e.name !== user.name)
      .map(e => ({ name: e.name, isNight: e.isNight, status: statusMap[e.name] === 'Ended' ? 'ended' : 'not_started' }))

    return res.status(200).json({ active, others })
  } catch (err) {
    console.error('Followup options error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
