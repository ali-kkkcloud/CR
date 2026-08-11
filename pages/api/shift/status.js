// pages/api/shift/status.js
import { getUserFromReq } from '../../../lib/auth'
import { readSheet, CRM_SHEET_ID, TABS, todayStr } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)

    // Search from the BOTTOM (most recent row first) — fixes stale-row bug
    // when an employee has multiple Start/End cycles on the same date
    let myRow = null
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i]
      if ((r[0] || '').toString().trim() === user.empId.toString().trim() && r[2] === today) {
        myRow = r
        break
      }
    }

    if (!myRow) {
      return res.status(200).json({ status: 'not_started' })
    }
    if (myRow[6] === 'Active') {
      return res.status(200).json({ status: 'active', startTime: myRow[3], shiftDate: myRow[2] })
    }
    if (myRow[6] === 'Ended') {
      return res.status(200).json({ status: 'ended', startTime: myRow[3], endTime: myRow[4], shiftDate: myRow[2] })
    }
    return res.status(200).json({ status: 'not_started' })

  } catch (err) {
    console.error('Shift status error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
