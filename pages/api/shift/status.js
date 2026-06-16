import { getUserFromReq } from '../../../lib/auth'
import { readSheet, CRM_SHEET_ID, TABS, todayStr } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error:'Unauthorized' })
  try {
    const today = todayStr()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)
    const myRow = rows.slice(1).find(r => r[0]===user.empId && r[2]===today)
    if (!myRow)                  return res.status(200).json({ status:'not_started' })
    if (myRow[6]==='Active')     return res.status(200).json({ status:'active',   startTime:myRow[3] })
    if (myRow[6]==='Ended')      return res.status(200).json({ status:'ended',    startTime:myRow[3], endTime:myRow[4] })
    return res.status(200).json({ status:'not_started' })
  } catch(err) {
    console.error(err)
    return res.status(500).json({ error:'Server error' })
  }
}
