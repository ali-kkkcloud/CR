import { getUserFromReq } from '../../../lib/auth'
import { readSheet, CRM_SHEET_ID, TABS, todayStr, getLeaveMapForDate } from '../../../lib/sheets'
import { ALL_EMPLOYEES, getScheduledEmployeesAtHour, distributeClientsForHour } from '../../../lib/schedule'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    const date = (req.query.date || todayStr()).toString()

    const [updateRows, shiftRows, leaveMap, redistRows] = await Promise.all([
      readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`),
      readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`),
      getLeaveMapForDate(date),
      readSheet(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`),
    ])

    // All update rows for this date, indexed by employee+hour+client
    const updatesByEmpHour = {}
    updateRows.slice(1)
      .filter(r => r[0] === date)
      .forEach(r => {
        const key = `${r[2]}__${r[4]}`
        if (!updatesByEmpHour[key]) updatesByEmpHour[key] = {}
        const hasRealData = !!(r[5] || '').toString().trim()
        updatesByEmpHour[key][r[3]] = {
          status: r[5] || '', misalignVehicles: r[6] || '', alertCount: r[7] || '',
          fatigue: r[8] || '', fatigueCount: r[9] || '',
          updatedAt: hasRealData ? r[1] : '',
          filled: hasRealData,
        }
      })

    // Shift log for this date — who actually logged in
    const loginMap = {}
    shiftRows.slice(1)
      .filter(r => r[2] === date)
      .forEach(r => { loginMap[r[1]] = { startTime: r[3], endTime: r[4], duration: r[5], status: r[6] } })

    // All unique hours that appear in any client timing
    const allHours = [...new Set(
      Object.values({ ...require('../../../lib/schedule').CLIENT_TIMINGS })
        .flat()
    )].sort((a, b) => {
      // Sort 7am onwards, wrapping midnight correctly
      const norm = h => h < 7 ? h + 24 : h
      return norm(a) - norm(b)
    })

    // Build per-employee per-hour data
    const empData = ALL_EMPLOYEES.map(emp => {
      const shiftLog = loginMap[emp.name] || null
      const leaves   = leaveMap[emp.name] || []

      const hours = allHours
        .filter(hour => {
          // Is this employee scheduled at this hour?
          if (emp.isNight) { if (!(hour >= emp.start || hour < emp.end)) return false }
          else { if (!(hour >= emp.start && hour < emp.end)) return false }
          return true
        })
        .map(hour => {
          const isOnLeave = leaves.some(l => {
            const from = l.fromHour, to = l.toHour
            if (from <= to) return hour >= from && hour < to
            return hour >= from || hour < to
          })

          const schedEmps = getScheduledEmployeesAtHour(hour, leaveMap)
          const schedNames = schedEmps.map(e => e.name)

          // Get locked assignments for this hour (from actual CRM_Updates)
          const lockedAssignments = {}
          updateRows.slice(1)
            .filter(r => r[0] === date && parseInt(r[4]) === hour)
            .forEach(r => { lockedAssignments[r[3]] = r[2] })

          // Distribution for this hour
          const dist = distributeClientsForHour(hour, schedNames, {}, lockedAssignments)
          const assignedClients = dist[emp.name] || []

          const key = `${emp.name}__${hour}`
          const empHourData = updatesByEmpHour[key] || {}

          const clients = assignedClients.map(c => {
            const data = empHourData[c.client] || {}
            return {
              client: c.client,
              vehicleCount: c.vehicleCount,
              filled: !!data.filled,
              status: data.status || '',
              updatedAt: data.updatedAt || '',
              misalignVehicles: data.misalignVehicles || '',
              alertCount: data.alertCount || '',
              fatigue: data.fatigue || '',
            }
          })

          return {
            hour,
            isOnLeave,
            clients,
            totalClients: clients.length,
            completedClients: clients.filter(c => c.filled).length,
            missedClients: clients.filter(c => !c.filled).length,
          }
        })

      return {
        name: emp.name,
        shiftStart: emp.start,
        shiftEnd: emp.end,
        isNight: emp.isNight,
        loggedIn: !!shiftLog,
        startTime: shiftLog?.startTime || '',
        endTime:   shiftLog?.endTime   || '',
        duration:  shiftLog?.duration  || '',
        status:    shiftLog?.status    || 'not_started',
        leaves,
        hours,
        totalAssigned:  hours.reduce((s, h) => s + h.totalClients, 0),
        totalCompleted: hours.reduce((s, h) => s + h.completedClients, 0),
        totalMissed:    hours.reduce((s, h) => s + h.missedClients, 0),
      }
    })

    return res.status(200).json({ date, employees: empData })

  } catch (err) {
    console.error('Full day view error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
