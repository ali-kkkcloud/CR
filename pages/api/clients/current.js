import { getUserFromReq } from '../../../lib/auth'
import { readSheet, CRM_SHEET_ID, TABS, todayStr, nowIST, fetchClientVehicleCounts } from '../../../lib/sheets'
import { getClientsForEmployeeAtHour } from '../../../lib/schedule'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const hour  = nowIST().getHours()
    const today = todayStr()

    const shiftRows = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)
    const activeMap = {}
    for (let i = 1; i < shiftRows.length; i++) {
      const r = shiftRows[i]
      if (r[2] === today) {
        activeMap[r[1]] = r[6]
      }
    }
    const activeEmployeeNames = Object.entries(activeMap)
      .filter(([, status]) => status === 'Active')
      .map(([name]) => name)

    const vehicleMap = await fetchClientVehicleCounts()

    const redistRows = await readSheet(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`)
    const redistributedToMe = redistRows.slice(1)
      .filter(r => r[0] === today && r[3] === user.name && parseInt(r[5]) === hour)
      .map(r => ({ fromEmployee: r[2], client: r[4] }))

    const clients = getClientsForEmployeeAtHour(user.name, hour, activeEmployeeNames, vehicleMap, redistributedToMe)

    const updateRows = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)
    const filled = updateRows.slice(1)
      .filter(r => r[0] === today && r[2] === user.name && parseInt(r[4]) === hour)
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

    return res.status(200).json({ hour, clients, filled, activeEmployeeCount: activeEmployeeNames.length })

  } catch (err) {
    console.error('Clients fetch error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
