import { getUserFromReq } from '../../../lib/auth'
import { readSheet, CRM_SHEET_ID, TABS, todayStr, nowIST } from '../../../lib/sheets'
import { getClientsForEmployeeAtHour } from '../../../lib/schedule'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error:'Unauthorized' })
  try {
    const hour  = nowIST().getHours()
    const today = todayStr()

    const redistRows = await readSheet(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`)
    const redistributedToMe = redistRows.slice(1)
      .filter(r => r[0]===today && r[3]===user.name)
      .map(r => ({ fromEmployee:r[2], client:r[4], hour:parseInt(r[5]), toEmployee:r[3] }))

    const clients = getClientsForEmployeeAtHour(user.name, hour, redistributedToMe)

    const updateRows = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)
    const filled = updateRows.slice(1)
      .filter(r => r[0]===today && r[2]===user.name && parseInt(r[4])===hour)
      .reduce((acc, r) => {
        acc[r[3]] = {
          status:           r[5]  || '',
          misalignVehicles: r[6]  || '',
          alertCount:       r[7]  || '',
          fatigue:          r[8]  || '',
          fatigueCount:     r[9]  || '',
          notes:            r[10] || '',
        }
        return acc
      }, {})

    return res.status(200).json({ hour, clients, filled })
  } catch(err) {
    console.error(err)
    return res.status(500).json({ error:'Server error' })
  }
}
