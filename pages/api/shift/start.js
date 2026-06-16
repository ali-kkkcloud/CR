import { getUserFromReq } from '../../../lib/auth'
import { appendRow, readSheet, CRM_SHEET_ID, TABS, todayStr, nowStr } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error:'Unauthorized' })
  try {
    const today = todayStr(), now = nowStr()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)
    const already = rows.slice(1).find(r => r[0]===user.empId && r[2]===today && r[6]==='Active')
    if (already) return res.status(200).json({ success:true, alreadyStarted:true, startTime:already[3] })
    await appendRow(CRM_SHEET_ID, TABS.SHIFT_LOG, [user.empId, user.name, today, now, '', '', 'Active', ''])
    return res.status(200).json({ success:true, startTime:now })
  } catch(err) {
    console.error(err)
    return res.status(500).json({ error:'Server error' })
  }
}
