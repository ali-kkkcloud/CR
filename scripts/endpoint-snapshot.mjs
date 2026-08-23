// Every read endpoint's answer, on one fixed floor, printed.
//
// Not a test on its own — a photograph. Run it on two versions of the code
// against the same fixture and compare the two photographs, and you have an
// answer to the only question that matters after a change made for speed:
// did anything anybody looks at come out different?
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/endpoint-snapshot.mjs
//
// Clock strings are replaced with <clock> before printing. Two runs a moment
// apart will always disagree about the second, and that is not a difference
// in behaviour.
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')

const ENDPOINTS = [
  ['clients/current',        () => import('../pages/api/clients/current.js'),        'emp',   {}],
  ['dashboard/my-day',       () => import('../pages/api/dashboard/my-day.js'),       'emp',   {}],
  ['dashboard/summary?today',() => import('../pages/api/dashboard/summary.js'),      'emp',   { range: 'today' }],
  ['dashboard/summary?month',() => import('../pages/api/dashboard/summary.js'),      'emp',   { range: 'month' }],
  ['footage/list',           () => import('../pages/api/footage/list.js'),           'emp',   {}],
  ['break/status',           () => import('../pages/api/break/status.js'),           'emp',   { activeAgoMs: '1000' }],
  ['shift/status',           () => import('../pages/api/shift/status.js'),           'emp',   {}],
  ['clients/current (2nd)',  () => import('../pages/api/clients/current.js'),        'emp2',  {}],
  ['dashboard/my-day (2nd)', () => import('../pages/api/dashboard/my-day.js'),       'emp2',  {}],
  ['break/status (2nd)',     () => import('../pages/api/break/status.js'),           'emp2',  { activeAgoMs: '1000' }],
  ['admin/overview',         () => import('../pages/api/admin/overview.js'),         'admin', {}],
  ['admin/full-day-view',    () => import('../pages/api/admin/full-day-view.js'),    'admin', {}],
  ['admin/breaks',           () => import('../pages/api/admin/breaks.js'),           'admin', {}],
  ['admin/employee-progress',() => import('../pages/api/admin/employee-progress.js'),'admin', {}],
]

const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const p2 = (n) => String(n).padStart(2, '0')
// The OPERATING day, which is what every date column in these sheets holds.
//
// NOT the calendar date. The operating day runs 07:00 to 07:00, so between
// midnight and seven the two differ — and a fixture that files its rows under
// the calendar date puts them where the platform never looks. Every screen
// then reads as "shift not started, no clients", and the file fails for the
// six hours of the night shift while passing all day.
//
// This is the fifth fixture here to have had that exact fault, so it is
// spelled out rather than left as a one-liner.
const TODAY = (() => { const x = new Date(d); if (x.getHours() < 7) x.setDate(x.getDate() - 1)
  const q = (n) => String(n).padStart(2, '0')
  return `${q(x.getDate())}/${q(x.getMonth() + 1)}/${x.getFullYear()}` })()
const H = d.getHours()
const clockOf = (x) => { let h = x.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${p2(h)}:${p2(x.getMinutes())}:${p2(x.getSeconds())} ${a}` }
const minsAgo = (m) => new Date(d.getTime() - m * 60000)
const SHIFT_START = (H + 21) % 24

const NAMES = ['Sunil','Mahesh','Nikita','BRINDA','Nesiya','Rakesh','HARI','KIRAN','MANTU','CHANDAN']
const PEOPLE = NAMES.map((n, i) => [`E${i + 1}`, n])
const CLIENTS = Array.from({ length: 40 }, (_, i) => `Client ${i + 1}`)
const vehicleRows = [['Client','Vehicle']]
CLIENTS.forEach((c, i) => { for (let v = 0; v < 6; v++) vehicleRows.push([c, `KA${i}-${v}`]) })

// Clients spread across the whole day, so the hour strip, the full-day view
// and the month trend all have something real to answer with.
const updateRows = [['Date','Time','Emp','Client','Hour','Status','Mis','Alerts','Fatigue','FCount','Notes','Live']]
for (let k = 0; k < 9; k++) {
  const hour = (SHIFT_START + k) % 24
  PEOPLE.forEach(([, name], i) => {
    for (let c = 0; c < 4; c++) {
      updateRows.push([TODAY, '09:00:00 am', name, CLIENTS[(i * 4 + c + k) % CLIENTS.length], String(hour),
                       (c + k) % 2 ? 'Completed' : '', '', String(c % 3), c === 2 ? 'Yes' : 'No', '0', '', String(c)])
    }
  })
}

const breaks = [
  ['E9', 'MANTU',  TODAY, clockOf(minsAgo(90)), clockOf(minsAgo(75)), '15', 'Completed', 'Auto'],
  ['E9', 'MANTU',  TODAY, clockOf(minsAgo(20)), '', '', 'Active', 'Manual'],
  ['E1', 'Sunil',  TODAY, clockOf(minsAgo(200)), clockOf(minsAgo(180)), '20', 'Completed', 'Manual'],
  // A row the repair superseded — it must appear in no count anywhere.
  ['E1', 'Sunil',  TODAY, clockOf(minsAgo(199)), clockOf(minsAgo(179)), '0', 'Duplicate — superseded', 'Manual'],
]

function floor() {
  reset()
  ;['crm-book','source-book','issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  globalThis.__cautioSheets.vehicle = { data: null, at: 0 }
  globalThis.__cautioRoster = { lastGood: null }
  if (globalThis.__cautioAttendance) {
    globalThis.__cautioAttendance.recentOpenings.clear()
    globalThis.__cautioAttendance.lastFloorSweep = Date.now()
  }
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ...PEOPLE.map(([id, n], i) => [id, n, 'x', 'employee', String(SHIFT_START), String((SHIFT_START + 9) % 24), 'No', i === 7 ? 'Yes' : 'No'])],
    'Client_Timings!A:B': [['Client','Hours'],
      ...CLIENTS.map((c, i) => [c, String((SHIFT_START + (i % 9)) % 24)])],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status','Seen'],
      ...PEOPLE.map(([id, n], i) => i === 7
        ? null                                            // week off: no row at all
        : [id, n, TODAY, clockOf(minsAgo(180)), i === 6 ? clockOf(minsAgo(30)) : '', '',
           i === 6 ? 'Ended' : 'Active', clockOf(minsAgo(1))]).filter(Boolean)],
    'CRM_Updates!A:L': updateRows,
    'Breaks!A:H': [['EmpID','Name','Date','Start','End','Mins','Status','Type'], ...breaks],
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
  }
}

const USERS = {
  emp:   { name: 'MANTU', role: 'employee', empId: 'E9' },
  emp2:  { name: 'Sunil', role: 'employee', empId: 'E1' },
  admin: { name: 'Admin', role: 'admin',    empId: 'A1' },
}

const CLOCK = /\b\d{1,2}:\d{2}:\d{2}\s?(am|pm)\b/gi
// Anything measured against the clock rather than the fixture: how long a
// break has been running, how long ago somebody was seen. These move by a
// minute between two runs and say nothing about behaviour.
const DRIFTY = new Set(['minutes','totalMinutesToday','breakMinutes','totalMinutes','duration',
                        'activeSince','loadedAt','elapsed','idleSeconds','sinceMinutes'])
function stable(x) {
  return JSON.stringify(x, (k, v) => {
    if (DRIFTY.has(k)) return '<drifts>'
    return typeof v === 'string' ? v.replace(CLOCK, '<clock>') : v
  })
}

for (const [label, load, who, query] of ENDPOINTS) {
  floor()
  const handler = (await load()).default
  const req = { method: 'GET', query, body: {}, cookies: { cautio_token: signToken(USERS[who]) }, headers: {} }
  let body = null, code = 200
  const res = { status(c) { code = c; return res }, json(p) { body = p; return res },
                end() { return res }, setHeader() { return res } }
  try { await handler(req, res) } catch (e) { body = { threw: e.message }; code = 500 }
  console.log(`### ${label}  [${code}]`)
  console.log(stable(body))
}
