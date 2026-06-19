// lib/schedule.js
// Core principle: distribution is based on SCHEDULED employees, not login status.
// Only admin "leave" action removes someone from distribution.

export const CLIENT_TIMINGS = {
  "APSARA TRAVELS": [11, 12, 15, 19, 22, 1, 3, 5],
  "Anand Tours and travels Pune": [7, 12, 15, 19, 22, 1, 3, 5],
  "Anand Bus Transport": [8, 12, 15, 19, 22, 1, 3, 5],
  "Rajkalpana Travels": [9, 12, 15, 19, 22, 1, 3, 5],
  "MEDIKONDA TRRAVELS": [10, 12, 15, 19, 22, 1, 3, 5],
  "Red Express": [11, 12, 15, 19, 22, 1, 3, 5],
  "KARTHIKEYA TOURS AND TRAVELS": [7, 12, 15, 19, 21, 0, 3, 6],
  "AVLT TRANS": [8, 12, 15, 19, 21, 0, 3, 6],
  "Guardian Travels": [9, 12, 15, 19, 21, 0, 3, 6],
  "JKS BUS SERVICE": [10, 12, 15, 19, 21, 0, 3, 6],
  "VVSR TOURS AND TRAVELS": [11, 12, 15, 19, 21, 0, 3, 6],
  "Krishna Travels Latur": [7, 12, 15, 19, 21, 0, 3, 6],
  "BARDE ROADLINES": [9, 12, 15, 19, 21, 0, 3, 6],
  "Sanvi Travels": [10, 12, 15, 19, 21, 0, 3, 6],
  "Iconic Travels and Holidays": [11, 12, 15, 19, 21, 0, 3, 6],
  "A1 Travels": [7, 12, 15, 19, 21, 0, 3, 6],
  "Nakoda Travels Kolhapur": [8, 12, 15, 19, 21, 0, 3, 6],
  "Nakoda Travels Sangli": [9, 12, 15, 19, 21, 0, 3, 6],
  "SRI SIDDHAN TRAVELS": [10, 12, 15, 19, 21, 0, 3, 6],
  "Friends motors": [11, 12, 14, 18, 20, 21, 0, 3, 6],
  "MAYILON TRANSPORTS": [7, 12, 14, 18, 20, 21, 0, 3, 6],
  "Jaspal Travels": [8, 12, 15, 19, 21, 0, 3, 6],
  "Indo Canadian Transport Co Private Limited": [9, 12, 14, 18, 20, 21, 0, 3, 6],
  "GLOBEHOPPER MOBILITY": [10, 12, 14, 18, 20, 21, 0, 3, 6],
  "INF_JPMC": [8, 11, 15],
  "INF_L&T CONSTRUCTION EQUIPMENT LTD": [8, 11, 15],
  "INF_LG": [8, 11, 15],
  "INF_RYAN YLK": [9, 13, 16],
}

export const EMPLOYEE_SPECIFIC_CLIENTS = {
  "BRINDA": {
    8: ["CF-Mumbai"], 9: ["CF-Chennai","CF-Delhi"],
    10: ["CF-Hyderabad"], 11: ["CF-Kolkata"],
  },
  "Hariprasad": {
    22: ["Kuehne Nagel","Zingbus"],
    23: ["Prasanna Purple Mobility Solutions","ABR Roadlines","Leafy Bus","Shree Sairam Travels"],
    0:  ["Kuehne Nagel","Zingbus","Mohit Travels"],
    1:  ["Prasanna Purple Mobility Solutions","ABR Roadlines","Leafy Bus","Shree Sairam Travels","Mohit Travels"],
    2:  ["Kuehne Nagel","Zingbus","INF_ONE CAMPUS","Mohit Travels"],
    3:  ["Prasanna Purple Mobility Solutions","ABR Roadlines","Leafy Bus","Shree Sairam Travels","Mohit Travels"],
    4:  ["Kuehne Nagel","Zingbus","Mohit Travels"],
    5:  ["Prasanna Purple Mobility Solutions","ABR Roadlines","Leafy Bus","INF_ONE CAMPUS","Zingbus","Mohit Travels"],
  },
}

export const EMPLOYEE_CUSTOM_TEXT = {
  "BRINDA": { 12:"CALL", 13:"CALL", 14:"CALL", 15:"CALL", 16:"CALL", 17:"CALL", 18:"CALL" },
  "Shashi": { 14:"Infants OFFLINE Calling" },
  "HARI":   { 20:"OFFLINE REPORTS" },
}

export const ALL_EMPLOYEES = [
  { name:"GUNASAGARI", start:8,  end:17, isNight:false },
  { name:"KIRAN",      start:12, end:21, isNight:false },
  { name:"Ritanjali",  start:8,  end:10, isNight:false },
  { name:"BRINDA",     start:8,  end:17, isNight:false },
  { name:"Nesiya",     start:8,  end:17, isNight:false },
  { name:"Rakesh",     start:18, end:21, isNight:false },
  { name:"HARI",       start:12, end:21, isNight:false },
  { name:"Sunil",      start:12, end:21, isNight:false },
  { name:"RISHI",      start:7,  end:16, isNight:false },
  { name:"Naveen",     start:12, end:21, isNight:false },
  { name:"Hariprasad", start:22, end:7,  isNight:true  },
  { name:"Shashi",     start:21, end:6,  isNight:true  },
  { name:"Mahesh",     start:21, end:6,  isNight:true  },
  { name:"MANTU",      start:22, end:7,  isNight:true  },
  { name:"CHANDAN",    start:22, end:7,  isNight:true  },
]

export function isScheduledAtHour(emp, hour) {
  if (emp.isNight) return hour >= emp.start || hour < emp.end
  return hour >= emp.start && hour < emp.end
}

// Get all employees SCHEDULED for this hour (regardless of login status)
// Subtract anyone admin has marked on leave for this hour
export function getScheduledEmployeesAtHour(hour, leaveMap = {}) {
  return ALL_EMPLOYEES.filter(emp => {
    if (!isScheduledAtHour(emp, hour)) return false
    const leaves = leaveMap[emp.name] || []
    // leaveMap[empName] = array of { fromHour, toHour } — exclude if this hour is covered
    for (const leave of leaves) {
      if (isHourInLeave(hour, leave.fromHour, leave.toHour)) return false
    }
    return true
  })
}

function isHourInLeave(hour, fromHour, toHour) {
  // fromHour inclusive, toHour exclusive (same-day range)
  if (fromHour <= toHour) return hour >= fromHour && hour < toHour
  // Crosses midnight
  return hour >= fromHour || hour < toHour
}

function getVehicleCountLocal(vehicleMap, clientName) {
  const key = (clientName || '').toString().trim().toLowerCase()
  return vehicleMap[key]?.vehicleCount || 0
}

// Core distribution — scheduled employees (admin-leave-aware), locked-assignment-aware
export function distributeClientsForHour(hour, scheduledEmployeeNames, vehicleMap = {}, lockedAssignments = {}) {
  const distribution = {}
  scheduledEmployeeNames.forEach(name => { distribution[name] = [] })
  if (scheduledEmployeeNames.length === 0) return distribution

  const sorted = [...scheduledEmployeeNames].sort((a, b) => a.localeCompare(b))
  const reservedClients = new Set()
  const customTextEmps  = new Set()

  sorted.forEach(name => {
    if (EMPLOYEE_CUSTOM_TEXT[name]?.[hour]) { customTextEmps.add(name); return }
    const specific = EMPLOYEE_SPECIFIC_CLIENTS[name]?.[hour]
    if (specific) {
      distribution[name].push(...specific.map(c => ({
        client: c, vehicleCount: getVehicleCountLocal(vehicleMap, c), isSpecific: true,
      })))
      specific.forEach(c => reservedClients.add(c))
    }
  })

  // Apply locked assignments (already decided this hour — don't reshuffle)
  Object.entries(lockedAssignments).forEach(([clientName, empName]) => {
    if (reservedClients.has(clientName)) return
    if (!distribution[empName]) return
    distribution[empName].push({
      client: clientName, vehicleCount: getVehicleCountLocal(vehicleMap, clientName),
      isSpecific: false, isLocked: true,
    })
    reservedClients.add(clientName)
  })

  const remainingClients = Object.entries(CLIENT_TIMINGS)
    .filter(([, hours]) => hours.includes(hour))
    .map(([name]) => name)
    .filter(c => !reservedClients.has(c))
    .sort((a, b) => getVehicleCountLocal(vehicleMap, b) - getVehicleCountLocal(vehicleMap, a))

  const eligibleEmps = sorted.filter(name => !customTextEmps.has(name))

  if (eligibleEmps.length > 0) {
    const load = {}
    eligibleEmps.forEach(name => {
      load[name] = distribution[name].reduce((s, c) => s + c.vehicleCount, 0)
    })
    remainingClients.forEach(client => {
      const vehicleCount = getVehicleCountLocal(vehicleMap, client)
      let minEmp = eligibleEmps[0]
      eligibleEmps.forEach(name => { if (load[name] < load[minEmp]) minEmp = name })
      distribution[minEmp].push({ client, vehicleCount, isSpecific: false })
      load[minEmp] += vehicleCount
    })
  }

  return distribution
}

export function getClientsForEmployeeAtHour(employeeName, hour, scheduledEmployeeNames, vehicleMap = {}, lockedAssignments = {}) {
  const customText = EMPLOYEE_CUSTOM_TEXT[employeeName]?.[hour]
  if (customText) return [{ client: customText, isCustom: true }]

  const dist = distributeClientsForHour(hour, scheduledEmployeeNames, vehicleMap, lockedAssignments)
  return (dist[employeeName] || []).map(c => ({
    client: c.client, vehicleCount: c.vehicleCount, isSpecific: c.isSpecific,
  }))
}

// For End Shift — only current hour's UNFILLED clients move to others
export function computeCurrentHourRedistribution(leavingEmployee, currentHour, unfilledClients, remainingScheduledNames, vehicleMap = {}) {
  const log = []
  if (!remainingScheduledNames.length || !unfilledClients.length) return log

  const sortedTargets = [...remainingScheduledNames].sort((a, b) => a.localeCompare(b))
  const load = {}
  sortedTargets.forEach(name => { load[name] = 0 })

  const sorted = [...unfilledClients].sort((a, b) =>
    getVehicleCountLocal(vehicleMap, b) - getVehicleCountLocal(vehicleMap, a)
  )

  sorted.forEach(client => {
    const vehicleCount = getVehicleCountLocal(vehicleMap, client)
    let minEmp = sortedTargets[0]
    sortedTargets.forEach(name => { if (load[name] < load[minEmp]) minEmp = name })
    log.push({ fromEmployee: leavingEmployee, toEmployee: minEmp, client, hour: currentHour })
    load[minEmp] += vehicleCount
  })

  return log
}
