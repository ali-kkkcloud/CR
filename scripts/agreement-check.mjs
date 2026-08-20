// The board and the strip above it must say the same thing.
//
// "How many clients do I have this hour?" is answered on the employee's board
// (/api/clients/current), on their own day strip (/api/dashboard/my-day) and
// on the admin's day view (/api/admin/full-day-view). All three are supposed
// to read one computation. When they drift, the platform contradicts itself in
// front of the person doing the work — and worse, the board can hand somebody
// a client the plan has given to a colleague, so two people work the same one.
//
// Both real endpoints, run against an invented floor with the Sheets client
// replaced by a recorder. No network, no credentials, and no write can reach
// the live spreadsheet: the recorder has nowhere to send one.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/agreement-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')
const boardHandler = (await import('../pages/api/clients/current.js')).default
const myDayHandler = (await import('../pages/api/dashboard/my-day.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

// ── The invented floor ─────────────────────────────────────────────────
const TODAY = (() => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
})()
const NOW_HOUR = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours()

// Everyone works a window that certainly contains the hour running right now,
// whenever the test happens to be run.
const WINDOW_START = NOW_HOUR
const WINDOW_END   = (NOW_HOUR + 9) % 24

const PEOPLE = [
  { empId: 'E1', name: 'Mahesh' },
  { empId: 'E2', name: 'Sunil'  },
  { empId: 'E3', name: 'Nikita' },
]

// Credentials: EmpID | Name | Password | Role | Start | End | IsNight | WeekOff
const credentials = [
  ['EmpID','Name','Password','Role','ShiftStart','ShiftEnd','IsNight','WeekOff'],
  ...PEOPLE.map(p => [p.empId, p.name, 'x', 'employee', String(WINDOW_START), String(WINDOW_END), 'No', 'No']),
]

// 46 clients in the hour that is running now, so a three-way split is uneven
// and any disagreement in the pool shows up as a different count.
const CLIENTS = Array.from({ length: 46 }, (_, i) => `Client ${String(i + 1).padStart(2, '0')}`)
const timings = [['Client Name','Hours'], ...CLIENTS.map(c => [c, String(NOW_HOUR)])]

// Vehicle counts come from a second book, one row per vehicle.
const vehicleRows = [['Client','Vehicle']]
CLIENTS.forEach((c, i) => {
  for (let v = 0; v < 5 + (i % 9); v++) vehicleRows.push([c, `KA${i}-${v}`])
})

const shiftRow = (p, inAt, outAt, status) =>
  [p.empId, p.name, TODAY, inAt, outAt || '', '', status, '']

function loadFloor({ shifts, updates = [] }) {
  reset()
  // Every cached read and the vehicle map must go, or the previous case's
  // floor is simply handed back.
  sheets.invalidateSheetCache('crm-book', '')
  sheets.invalidateSheetCache('source-book', '')
  sheets.invalidateSheetCache('issue-book', '')
  globalThis.__cautioSheets.vehicle = { data: null, at: 0 }

  behaviour.data = {
    'Credentials!A:H':        credentials,
    'Client_Timings!A:B':     timings,
    'Employee_Hours!A:D':     [['Employee','Hour','Fixed Clients','Custom Text']],
    'Shift_Log!A:H':          [['EmpID','Name','Date','In','Out','','Status','']],
    'CRM_Updates!A:L':        [['Date','Time','Employee','Client','Hour','Status','','','','','','']],
    'Breaks!A:H':             [['EmpID','Name','Date','Start','End','Mins','Type','']],
    'Leaves!A:H':             [['EmpID','Name','Date','From','To','Reason','By','At']],
    'Shift_Overrides!A:H':    [['EmpID','Name','Date','Start','End','Type','','']],
    'Redistribution_Log!A:G': [['Date','Time','From','To','Client','Hour','']],
    'Infants!A:B':            [['Client','Vehicle']],
    'Others!A:B':             vehicleRows,
  }
  behaviour.data['Shift_Log!A:H'] = [behaviour.data['Shift_Log!A:H'][0], ...shifts]
  behaviour.data['CRM_Updates!A:L'] = [behaviour.data['CRM_Updates!A:L'][0], ...updates]
}

async function call(handler, person, query = {}) {
  const user = { name: person.name, empId: person.empId, role: 'employee' }
  const req = { method: 'GET', query, cookies: { cautio_token: signToken(user) }, headers: {} }
  let body = null, code = 200
  const res = {
    status(c) { code = c; return res },
    json(payload) { body = payload; return res },
    end() { return res },
  }
  await handler(req, res)
  if (code !== 200) throw new Error(`${person.name}: handler returned ${code} — ${JSON.stringify(body)}`)
  return body
}

const boardClients = (b) => (b.clients || []).map(c => c.client).sort()
const stripClients = (d, hour) => {
  const slot = (d.timeline || []).find(t => t.hour === hour)
  return (slot?.clients || []).map(c => c.client || c).sort()
}
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

// ── 1 · Everybody at work: the board and the strip agree ───────────────
console.log('\n1  Three people at work')
{
  loadFloor({ shifts: PEOPLE.map(p => shiftRow(p, '07:05:00 am', '', 'Active')) })
  const seen = {}
  for (const p of PEOPLE) {
    const board = await call(boardHandler, p)
    const strip = await call(myDayHandler, p)
    const b = boardClients(board), s = stripClients(strip, NOW_HOUR)
    ok(same(b, s), `${p.name}: board has ${b.length}, their own strip has ${s.length} — the two screens disagree`)
    seen[p.name] = b
  }
  const all = Object.values(seen).flat()
  ok(new Set(all).size === all.length,
     `${all.length - new Set(all).size} clients are on more than one person's board at the same hour`)
  ok(all.length === CLIENTS.length,
     `${all.length} of ${CLIENTS.length} clients reached a board — the rest reached nobody`)
  console.log(`   ${PEOPLE.map(p => `${p.name} ${seen[p.name].length}`).join(', ')} · ${all.length}/${CLIENTS.length} placed, no overlap`)
}

// ── 2 · One person has not clocked in yet ──────────────────────────────
// The case that was broken: the board split by "who has clocked in" while
// every other screen split by the roster, so they gave different answers for
// as long as anybody was running late.
console.log('\n2  One rostered person has not arrived')
{
  loadFloor({ shifts: [
    shiftRow(PEOPLE[0], '07:05:00 am', '', 'Active'),
    shiftRow(PEOPLE[1], '07:11:00 am', '', 'Active'),
  ]})
  const seen = {}
  for (const p of PEOPLE.slice(0, 2)) {
    const board = await call(boardHandler, p)
    const strip = await call(myDayHandler, p)
    const b = boardClients(board), s = stripClients(strip, NOW_HOUR)
    ok(same(b, s), `${p.name}: board ${b.length} vs strip ${s.length} while a colleague is late — this is the split that drifted`)
    seen[p.name] = b
  }
  const overlap = seen[PEOPLE[0].name].filter(c => seen[PEOPLE[1].name].includes(c))
  ok(overlap.length === 0, `${overlap.length} clients are on both boards at once: ${overlap.slice(0,3).join(', ')}`)
  console.log(`   Mahesh ${seen.Mahesh.length}, Sunil ${seen.Sunil.length}, Nikita not in · no client on two boards`)
}

// ── 3 · Nothing was written to the spreadsheet ─────────────────────────
// The platform is live. A test that appends a row is a test that corrupts
// somebody's day.
console.log('\n3  The test wrote nothing')
{
  ok(calls.append.length === 0, `${calls.append.length} rows were appended`)
  ok(calls.update.length === 0, `${calls.update.length} cells were updated`)
  console.log(`   0 appends, 0 updates`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
