// Where the CPU actually goes.
//
// Vercel paused the platform mid-shift. Not for requests — 487K invocations
// against an allowance of 1M — but for FLUID ACTIVE CPU: twelve hours against
// four. Every other meter was comfortably inside its limit.
//
// 12h across 487K invocations is ~89ms of CPU each. That is the number to
// bring down, and there are only two ways to do it: fewer invocations, or
// less work in each one. This measures the second so the choice is informed
// rather than guessed at.
//
// Run against the fake Sheets client, so there is no network in the timing at
// all: what is left is compute, which is exactly what Vercel is charging for.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/cpu-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')
const { computeDayPlan } = await import('../lib/dayplan.js')

const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const p2 = (n) => String(n).padStart(2, '0')
const TODAY = (() => { const x = new Date(d); if (x.getHours() < 7) x.setDate(x.getDate() - 1)
  return `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}` })()
const H = d.getHours()
const clockOf = (x) => { let h = x.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12
  return `${p2(h)}:${p2(x.getMinutes())}:${p2(x.getSeconds())} ${a}` }
const minsAgo = (m) => new Date(d.getTime() - m * 60000)

// A floor the size of the real one: 18 people, 410 clients spread over the day.
const NAMES = ['Sunil','Mahesh','Nikita','BRINDA','Nesiya','Rakesh','HARI','KIRAN','MANTU',
               'CHANDAN','Afzal','Darshan','Naveen','Shashi','RISHI','Ritanjali','Yunus','Sonu']
const PEOPLE = NAMES.map((n, i) => [`E${i + 1}`, n])
const CLIENTS = Array.from({ length: 410 }, (_, i) => `Client ${i + 1}`)

const vehicleRows = [['Client','Vehicle']]
CLIENTS.forEach((c, i) => { for (let v = 0; v < (i % 40) + 1; v++) vehicleRows.push([c, `KA${i}-${v}`]) })

const updateRows = [['Date','Time','Emp','Client','Hour','Status','Mis','Alerts','Fatigue','FCount','Notes','Live']]
for (let k = 0; k < 8; k++) {
  const hour = (H - k + 24) % 24
  PEOPLE.forEach(([, name], i) => {
    for (let c = 0; c < 8; c++) {
      updateRows.push([TODAY, clockOf(minsAgo(30 + k * 30)), name,
        CLIENTS[(i * 8 + c + k * 3) % CLIENTS.length], String(hour),
        'No Misalignment', '', '1', 'No', '0', '', '25'])
    }
  })
}

function floor() {
  reset()
  ;['crm-book','source-book','issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  globalThis.__cautioSheets.vehicle = { data: null, at: 0 }
  globalThis.__cautioSheets.vehicleInflight = null
  globalThis.__cautioRoster = { lastGood: null }
  if (globalThis.__cautioAttendance) {
    globalThis.__cautioAttendance.recentOpenings.clear()
    globalThis.__cautioAttendance.lastFloorSweep = Date.now()
  }
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ...PEOPLE.map(([id, n], i) => [id, n, 'x', 'employee', String((7 + (i % 3) * 5) % 24),
        String((16 + (i % 3) * 5) % 24), i % 3 === 2 ? 'Yes' : 'No', 'No'])],
    'Client_Timings!A:B': [['Client','Hours'],
      ...CLIENTS.map((c, i) => [c, [(7 + i % 12), (13 + i % 9)].join(',')])],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status','Seen'],
      ...PEOPLE.map(([id, n]) => [id, n, TODAY, clockOf(minsAgo(240)), '', '', 'Active', clockOf(minsAgo(1))])],
    'CRM_Updates!A:L': updateRows,
    'Breaks!A:H': [['EmpID','Name','Date','Start','End','Mins','Status','Type']],
    'Leaves!A:H': [['EmpID','Name','Date','From','To','Reason','By','At']],
    'Shift_Overrides!A:H': [['EmpID','Name','Date','Start','End','Type','','']],
    'Redistribution_Log!A:G': [['Date','Time','From','To','Client','Hour','']],
    'Daily_Summary!A:N': [['Date','Employee']],
    'Monthly_History!A:J': [['Label','From','To','Employee','Clients','Completed','Pending','Vehicles','Monitored','Source']],
    'Footage_Followup!A:J': [['Date','Time','IssueId','Client','Veh','From','To','Status','','']],
    'Issues- Realtime!A:T': [new Array(20).fill('h')],
    'Infants!A:B': [['Client','Vehicle']],
    'Others!A:B': vehicleRows,
    'Sessions!A:E': [['EmpID','Name','SessionId','SignedInAt','Device']],
    'Break_Watchlist!A:D': [['Employee','Active','Added On','Note']],
  }
}

const USER  = { name: 'Sunil', role: 'employee', empId: 'E1' }
const ADMIN = { name: 'Admin', role: 'admin',    empId: 'A1' }

async function call(load, who, query = {}) {
  const handler = (await load()).default
  const req = { method:'GET', query, body:{}, cookies:{ cautio_token: signToken(who) }, headers:{} }
  const res = { status(){ return res }, json(){ return res }, end(){ return res }, setHeader(){ return res } }
  await handler(req, res)
}

// CPU, not wall clock. process.cpuUsage() is what Vercel is metering — a
// request that spends its time waiting on Google costs nothing here, and a
// request that spends it looping costs everything.
async function cpuOf(label, load, who, query = {}, runs = 5) {
  await call(load, who, query)                       // warm the module + caches
  const before = process.cpuUsage()
  for (let i = 0; i < runs; i++) await call(load, who, query)
  const after = process.cpuUsage(before)
  const ms = (after.user + after.system) / 1000 / runs
  return { label, ms }
}

console.log(`\nA floor of ${PEOPLE.length} people and ${CLIENTS.length} clients.`)
console.log('CPU per request, cached reads warm — this is what Vercel meters.\n')

floor()
const results = []
results.push(await cpuOf('dashboard/tick',    () => import('../pages/api/dashboard/tick.js'), USER, { range:'today' }))
results.push(await cpuOf('clients/current',   () => import('../pages/api/clients/current.js'), USER))
results.push(await cpuOf('dashboard/my-day',  () => import('../pages/api/dashboard/my-day.js'), USER))
results.push(await cpuOf('dashboard/summary', () => import('../pages/api/dashboard/summary.js'), USER, { range:'today' }))
results.push(await cpuOf('break/status',      () => import('../pages/api/break/status.js'), USER, { activeAgoMs:'1000' }))
results.push(await cpuOf('shift/status',      () => import('../pages/api/shift/status.js'), USER))
results.push(await cpuOf('admin/overview',    () => import('../pages/api/admin/overview.js'), ADMIN))

const pad = (s, n) => String(s).padEnd(n)
results.forEach(r => console.log(`  ${pad(r.label, 22)} ${r.ms.toFixed(1).padStart(7)} ms`))

// The one piece every screen runs. Called repeatedly with identical
// arguments, which is exactly the shape a tick produces — so what this
// measures now is the MEMO, not the computation. That is the point: the
// computation still costs what it always did the first time.
floor()
const rows = behaviour.data
const vehicleMap = await sheets.fetchClientVehicleCounts()
const { loadScheduleData } = await import('../lib/roster.js')
await loadScheduleData()
const planArgs = {
  date: TODAY, today: TODAY, nowHour: H,
  shiftRows: rows['Shift_Log!A:H'], updateRows: rows['CRM_Updates!A:L'],
  breakRows: rows['Breaks!A:H'], leaveMap: {}, overridesMap: {},
  vehicleMap, weekOffNames: new Set(),
}
computeDayPlan(planArgs)
const t0 = process.cpuUsage()
for (let i = 0; i < 10; i++) computeDayPlan(planArgs)
const planMs = ((x) => (x.user + x.system) / 1000 / 10)(process.cpuUsage(t0))

const tick = results.find(r => r.label === 'dashboard/tick').ms
console.log(`\n  computeDayPlan, repeat ${planMs.toFixed(1).padStart(7)} ms` +
            `   (a memo hit — it cost 6.7ms before the memo existed)`)

// What the month actually costs at this rate.
const PER_DAY = PEOPLE.length * 2 * 60 * 24
console.log(`\n${PEOPLE.length} people polling every 30s = ${PER_DAY.toLocaleString()} ticks/day`)
console.log(`  at ${tick.toFixed(0)}ms each → ${(PER_DAY * tick / 3600000).toFixed(1)} CPU hours/day` +
            ` · ${(PER_DAY * tick / 3600000 * 30).toFixed(0)} a month, against an allowance of 4`)
console.log(`  at 60s polling         → ${(PER_DAY / 2 * tick / 3600000 * 30).toFixed(0)} CPU hours/month`)
