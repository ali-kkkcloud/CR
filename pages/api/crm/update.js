import { getUserFromReq } from '../../../lib/auth'
import { readSheet, appendRow, updateRowCells, CRM_SHEET_ID, TABS, todayStr, nowStr, nowIST } from '../../../lib/sheets'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { client, slot, status, misalignVehicles, alertCount, fatigue, fatigueCount, notes } = req.body
    const today = todayStr(), now = nowStr(), hour = nowIST().getHours()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)
    let existingRowIndex = -1
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0]===today && rows[i][2]===user.name && rows[i][3]===client && rows[i][4]===String(slot??hour)) {
        existingRowIndex = i+1; break
      }
    }
    const rowData = [today, now, user.name, client, String(slot??hour), status||'', misalignVehicles||'', String(alertCount||0), fatigue||'No', String(fatigueCount||0), notes||'']
    if (existingRowIndex > 0) await updateRowCells(CRM_SHEET_ID, TABS.CRM_UPDATES, existingRowIndex, 1, rowData)
    else await appendRow(CRM_SHEET_ID, TABS.CRM_UPDATES, rowData)
    return res.status(200).json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Server error' })
  }
}
