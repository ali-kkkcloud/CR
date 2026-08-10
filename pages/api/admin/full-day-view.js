import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, TABS, todayStr, fetchClientVehicleCounts, getLeaveMapForDate, getShiftOverridesForDate
} from '../../../lib/sheets'
import {
  ALL_EMPLOYEES, getScheduledEmployeesAtHour, distributeClientsForHour, EMPLOYEE_CUSTOM_TEXT
} from '../../../lib/schedule'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    const date = (req.query.date || todayStr()).toString()

    const [updateRows, shiftRows, leaveMap, redistRows, vehicleMap, overridesMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`, 10000),
      readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000),
      getLeaveMapForDate(date),
      readSheetCached(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`, 10000),
      fetchClientVehicleCounts(),
      getShiftOverridesForDate(date),
    ])

    // Index updates by emp+hour
    const updateIdx = {}
    updateRows.slice(1)
      .filter(r => r[0] === date)
      .forEach(r => {
        const key = `${r[2]}__${r[4]}`
        if (!updateIdx[key]) updateIdx[key] = {}
        const hasData = !!(r[5] || '').toString().trim()
        updateIdx[key][r[3]] = {
          filled:    hasData,
          status:    r[5] || '',
          updatedAt: hasData ? r[1] : '',
          misalignVehicles: r[6] || '',
          alertCount: r[7] || '',
        }
      })

    // Locked assignments per hour (from CRM_Updates)
    const lockedByHour = {}
    updateRows.slice(1)
      .filter(r => r[0] === date)
      .forEach(r => {
        const h = parseInt(r[4])
        if (!lockedByHour[h]) lockedByHour[h] = {}
        lockedByHour[h][r[3]] = r[2]
      })

    // Login map
    const loginMap = {}
    shiftRows.slice(1)
      .filter(r => r[2] === date)
      .forEach(r => { loginMap[r[1]] = { startTime:r[3], endTime:r[4], duration:r[5], status:r[6] } })

    const empData = ALL_EMPLOYEES.map(emp => {
      const shiftLog = loginMap[emp.name] || null
      const leaves   = leaveMap[emp.name] || []
      const empOverride = overridesMap[emp.name]
      const effectiveEmp = empOverride ? { ...emp, start: empOverride.start, end: empOverride.end } : emp

      // All scheduled hours for this employee (Early Start / OT aware),
      // built in CHRONOLOGICAL SHIFT ORDER starting from the actual start
      // hour — not ascending numeric order, which would put post-midnight
      // hours (0,1,2...) before the shift's real early hours for anyone
      // wrapping past midnight. Wraparound is derived from the EFFECTIVE
      // start/end (not the static isNight flag), since an Early/Late Start
      // or OT can push a normally-day shift across midnight too.
      const isWrap = effectiveEmp.end <= effectiveEmp.start
      const scheduledHours = []
      if (isWrap) {
        for (let h = effectiveEmp.start; h < 24; h++) scheduledHours.push(h)
        for (let h = 0; h < effectiveEmp.end; h++) scheduledHours.push(h)
      } else {
        for (let h = effectiveEmp.start; h < effectiveEmp.end; h++) scheduledHours.push(h)
      }

      const hours = scheduledHours.map(hour => {
        const isOnLeave = leaves.some(l => {
          if (l.fromHour <= l.toHour) return hour >= l.fromHour && hour < l.toHour
          return hour >= l.fromHour || hour < l.toHour
        })

        const customText = EMPLOYEE_CUSTOM_TEXT[emp.name]?.[hour]
        if (customText) {
          return { hour, isOnLeave: false, isCustom: true, customText, clients: [], totalClients: 0, completedClients: 0, missedClients: 0 }
        }

        if (isOnLeave) {
          const leaveEntry = leaves.find(l => {
            if (l.fromHour <= l.toHour) return hour >= l.fromHour && hour < l.toHour
            return hour >= l.fromHour || hour < l.toHour
          })
          return { hour, isOnLeave: true, leaveReason: leaveEntry?.reason || '', clients: [], totalClients: 0, completedClients: 0, missedClients: 0 }
        }

        // Distribution for this hour using locked assignments
        const scheduledEmps = getScheduledEmployeesAtHour(hour, leaveMap, overridesMap)
        const scheduledNames = scheduledEmps.map(e => e.name)
        const lockedAssignments = lockedByHour[hour] || {}

        const dist = distributeClientsForHour(hour, scheduledNames, vehicleMap, lockedAssignments)
        const assignedClients = dist[emp.name] || []

        // Add redistributed TO this employee (real reason + timestamp from Redistribution_Log)
        const redistToEmp = redistRows.slice(1)
          .filter(r => r[0] === date && r[3] === emp.name && parseInt(r[5]) === hour)
          .map(r => ({
            client: r[4],
            vehicleCount: vehicleMap[(r[4]||'').toLowerCase()]?.vehicleCount || 0,
            fromEmployee: r[2],
            isRedistributed: true,
            redistributedAt: r[1] || '',
            redistReason: r[6] || '',
          }))

        const allClients = [
          ...assignedClients.map(c => ({
            client: c.client,
            vehicleCount: c.vehicleCount || 0,
            isRedistributed: false,
          })),
          ...redistToEmp.filter(r => !assignedClients.some(c => c.client === r.client)),
        ]

        const empHourData = updateIdx[`${emp.name}__${hour}`] || {}
        const clientsWithStatus = allClients.map(c => ({
          ...c,
          filled:            !!(empHourData[c.client]?.filled),
          status:            empHourData[c.client]?.status    || '',
          updatedAt:         empHourData[c.client]?.updatedAt || '',
          alertCount:        parseInt(empHourData[c.client]?.alertCount) || 0,
          misalignVehicles:  parseInt(empHourData[c.client]?.misalignVehicles) || 0,
        }))

        return {
          hour,
          isOnLeave: false,
          clients: clientsWithStatus,
          totalClients:     clientsWithStatus.length,
          completedClients: clientsWithStatus.filter(c => c.filled).length,
          missedClients:    clientsWithStatus.filter(c => !c.filled).length,
        }
      })

      return {
        name:      emp.name,
        shiftStart: emp.start,
        shiftEnd:   emp.end,
        effectiveStart: effectiveEmp.start,
        effectiveEnd:   effectiveEmp.end,
        usedEarlyStart: !!empOverride?.usedEarlyStart,
        usedOT:         !!empOverride?.usedOT,
        isNight:    emp.isNight,
        loggedIn:   !!shiftLog,
        startTime:  shiftLog?.startTime || '',
        endTime:    shiftLog?.endTime   || '',
        duration:   shiftLog?.duration  || '',
        status:     shiftLog?.status    || 'not_started',
        leaves,
        hours,
        totalAssigned:  hours.reduce((s,h) => s + h.totalClients,     0),
        totalCompleted: hours.reduce((s,h) => s + h.completedClients, 0),
        totalMissed:    hours.reduce((s,h) => s + h.missedClients,    0),
        totalAlerts:    hours.reduce((s,h) => s + h.clients.reduce((a,c)=>a+(c.alertCount||0), 0), 0),
        totalMisalign:  hours.reduce((s,h) => s + h.clients.reduce((a,c)=>a+(c.misalignVehicles||0), 0), 0),
        totalRedistributed: hours.reduce((s,h) => s + h.clients.filter(c=>c.isRedistributed).length, 0),
      }
    })

    return res.status(200).json({ date, employees: empData })

  } catch (err) {
    console.error('Full day view error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
