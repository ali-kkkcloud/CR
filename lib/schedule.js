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

export function isEmployeeActive(emp, hour) {
  if (emp.isNight) return hour >= emp.start || hour < emp.end
  return hour >= emp.start && hour < emp.end
}

export function getActiveEmployeesAtHour(hour, weekOffEmployees = [], excludeEmployee = null) {
  return ALL_EMPLOYEES.filter(emp => {
    if (weekOffEmployees.includes(emp.name)) return false
    if (emp.name === excludeEmployee) return false
    return isEmployeeActive(emp, hour)
  })
}

export function getClientsForEmployeeAtHour(employeeName, hour, redistributedClients = []) {
  const customText = EMPLOYEE_CUSTOM_TEXT[employeeName]?.[hour]
  if (customText) return [{ client: customText, isCustom: true }]

  const clients = []
  const specificClients = EMPLOYEE_SPECIFIC_CLIENTS[employeeName]?.[hour] || []
  specificClients.forEach(c => clients.push({ client: c, isSpecific: true }))

  const activeEmps = ALL_EMPLOYEES.filter(e => isEmployeeActive(e, hour))
  const allClientsThisHour = Object.entries(CLIENT_TIMINGS)
    .filter(([, hours]) => hours.includes(hour))
    .map(([name]) => name)
    .filter(c => !specificClients.includes(c))

  allClientsThisHour.forEach((c, i) => {
    if (activeEmps[i % activeEmps.length]?.name === employeeName) {
      clients.push({ client: c, isSpecific: false })
    }
  })

  redistributedClients
    .filter(r => r.toEmployee === employeeName)
    .forEach(r => clients.push({
      client: r.client,
      isRedistributed: true,
      fromEmployee: r.fromEmployee
    }))

  return clients
}

export function redistributeClients(leavingEmployee, currentHour, activeEmployees) {
  const redistribution = []
  if (!activeEmployees.length) return redistribution

  const leavingEmp = ALL_EMPLOYEES.find(e => e.name === leavingEmployee)
  if (!leavingEmp) return redistribution

  const futureHours = []
  let h = (currentHour + 1) % 24
  let count = 0
  while (isEmployeeActive(leavingEmp, h) && count < 12) {
    futureHours.push(h)
    h = (h + 1) % 24
    count++
  }

  futureHours.forEach(hour => {
    const clients = getClientsForEmployeeAtHour(leavingEmployee, hour)
    clients.forEach((clientObj, idx) => {
      if (clientObj.isCustom) return
      const targetEmp = activeEmployees[idx % activeEmployees.length]
      redistribution.push({
        fromEmployee: leavingEmployee,
        toEmployee:   targetEmp.name,
        client:       clientObj.client,
        hour,
      })
    })
  })

  return redistribution
}
