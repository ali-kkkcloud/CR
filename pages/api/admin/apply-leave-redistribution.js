import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, appendRows, CRM_SHEET_ID, TABS, todayStr, nowStr,
  fetchClientVehicleCounts, getLeaveMapForDate
} from '../../../lib/sheets'
import { getScheduledEmployeesAtHour, distributeClientsForHour, ALL_EMPLOYEES } from '../../../lib/schedule'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    const { empName, date, fromHour, toHour } = req.body
    if (!empName || !date || fromHour === undefined) {
      return res.status(400).json({ error: 'empName, date, fromHour required' })
    }

    const now = nowStr()
    const leaveMap   = await getLeaveMapForDate(date)
    const vehicleMap = await fetchClientVehicleCounts()
    const updateRows = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)

    const emp = ALL_EMPLOYEES.find(e => e.name === empName)
    if (!emp) return res.status(400).json({ error: 'Employee not found' })

    const end = toHour !== undefined ? parseInt(toHour) : 24
    const affectedHours = []
    for (let h = parseInt(fromHour); h < end; h++) {
      let inShift = emp.isNight
        ? (h >= emp.start || h < emp.end)
        : (h >= emp.start && h < emp.end)
      if (inShift) affectedHours.push(h)
    }

    const redistRows      = []
    const placeholderRows = []

    for (const hour of affectedHours) {
      const withThem    = getScheduledEmployeesAtHour(hour, {}).map(e => e.name)
      const withoutThem = getScheduledEmployeesAtHour(hour, leaveMap).map(e => e.name)
      if (!withThem.includes(empName)) continue

      const lockedAll = {}
      updateRows.slice(1)
        .filter(r => r[0] === date && parseInt(r[4]) === hour)
        .forEach(r => { lockedAll[r[3]] = r[2] })

      const lockedWithoutEmp = Object.fromEntries(
        Object.entries(lockedAll).filter(([, v]) => v !== empName)
      )

      const oldDist      = distributeClientsForHour(hour, withThem, vehicleMap, {})
      const theirClients = (oldDist[empName] || [])
        .map(c => c.client)
        .filter(c => !lockedAll[c] || lockedAll[c] === empName)

      if (!theirClients.length) continue

      const newDist = distributeClientsForHour(hour, withoutThem, vehicleMap, lockedWithoutEmp)

      theirClients.forEach(client => {
        let newOwner = null
        for (const [name, clients] of Object.entries(newDist)) {
          if (clients.some(c => c.client === client)) { newOwner = name; break }
        }
        if (!newOwner || newOwner === empName) return

        redistRows.push([date, now, empName, newOwner, client, String(hour), 'Admin Leave'])

        const exists = updateRows.slice(1).some(
          r => r[0] === date && r[2] === newOwner && r[3] === client && parseInt(r[4]) === hour
        )
        if (!exists) {
          placeholderRows.push([date, now, newOwner, client, String(hour), '', '', '', 'No', '', ''])
        }
      })
    }

    if (redistRows.length > 0)      await appendRows(CRM_SHEET_ID, TABS.REDISTRIB,    redistRows)
    if (placeholderRows.length > 0) await appendRows(CRM_SHEET_ID, TABS.CRM_UPDATES, placeholderRows)

    return res.status(200).json({
      success: true,
      redistributed: redistRows.length,
      hours: affectedHours.length
    })

  } catch (err) {
    console.error('Apply leave redistribution error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
