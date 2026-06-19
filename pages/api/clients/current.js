import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, appendRows, CRM_SHEET_ID, TABS, todayStr, nowStr, nowIST,
  fetchClientVehicleCounts, getLeaveMapForDate
} from '../../../lib/sheets'
import { getClientsForEmployeeAtHour, getScheduledEmployeesAtHour } from '../../../lib/schedule'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const hour  = nowIST().getHours()
    const today = todayStr()
    const now   = nowStr()

    // ── Get leave map (admin-marked leaves) ──
    const leaveMap = await getLeaveMapForDate(today)

    // ── Scheduled employees for this hour (leave-aware) ──
    const scheduledEmps = getScheduledEmployeesAtHour(hour, leaveMap)
    const scheduledNames = scheduledEmps.map(e => e.name)

    const vehicleMap = await fetchClientVehicleCounts()

    // ── Locked assignments (already decided this hour) ──
    const updateRows = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)
    const lockedAssignments = {}
    updateRows.slice(1)
      .filter(r => r[0] === today && parseInt(r[4]) === hour)
      .forEach(r => { lockedAssignments[r[3]] = r[2] })

    const clients = getClientsForEmployeeAtHour(user.name, hour, scheduledNames, vehicleMap, lockedAssignments)

    // ── Write placeholder rows for newly assigned clients ──
    const existingForMe = new Set(
      updateRows.slice(1)
        .filter(r => r[0] === today && r[2] === user.name && parseInt(r[4]) === hour)
        .map(r => r[3])
    )
    const newRows = []
    clients.forEach(c => {
      if (c.isCustom) return
      if (!existingForMe.has(c.client)) {
        newRows.push([today, now, user.name, c.client, String(hour), '', '', '', 'No', '', ''])
      }
    })
    if (newRows.length > 0) await appendRows(CRM_SHEET_ID, TABS.CRM_UPDATES, newRows)

    // ── Build filled map ──
    const allMyRows = [
      ...updateRows.slice(1).filter(r => r[0] === today && r[2] === user.name && parseInt(r[4]) === hour),
      ...newRows.map(r => r),
    ]
    const filled = {}
    allMyRows.forEach(r => {
      const hasRealData = !!(r[5] || '').toString().trim()
      filled[r[3]] = {
        status: r[5] || '', misalignVehicles: r[6] || '', alertCount: r[7] || '',
        fatigue: r[8] || '', fatigueCount: r[9] || '', notes: r[10] || '',
        updatedAt: hasRealData ? (r[1] || '') : '',
      }
    })

    return res.status(200).json({ hour, clients, filled, scheduledCount: scheduledNames.length })

  } catch (err) {
    console.error('Clients fetch error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
