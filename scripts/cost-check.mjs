// What one screen load costs Google, counted — and held to a budget.
//
// Google's Sheets quota is per MINUTE, so the number that decides whether the
// platform stays up under load is how many requests a screen sends, not how
// fast any one of them is. When the allowance runs out every screen fails at
// once, and the retry backoff turns a fast page into a seven-second one.
//
// This runs the real endpoints against a recorder standing in for the Sheets
// client and counts. RANGES asked for is what the same load used to cost, one
// request each; REQUESTS is what it costs now.
//
// The budgets are ceilings, not targets. Three separate spreadsheets are read
// — the CRM book, the Issue Tracker and the vehicle source — and a batch
// cannot span two books, so three is the floor for a screen that needs all of
// them.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/cost-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')

const overview = (await import('../pages/api/admin/overview.js')).default
const fullDay  = (await import('../pages/api/admin/full-day-view.js')).default
const board    = (await import('../pages/api/clients/current.js')).default
const myDay    = (await import('../pages/api/dashboard/my-day.js')).default
const summary  = (await import('../pages/api/dashboard/summary.js')).default
const footage  = (await import('../pages/api/footage/list.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const TODAY = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
const H = d.getHours()

const PEOPLE = [['E1','Mahesh'],['E2','Sunil'],['E3','Nikita']]
const CLIENTS = Array.from({ length: 46 }, (_, i) => `Client ${i + 1}`)
const vehicleRows = [['Client','Vehicle']]
CLIENTS.forEach((c, i) => { for (let v = 0; v < 6; v++) vehicleRows.push([c, `KA${i}-${v}`]) })

// A clock string for "just now", so the fixture's employees read as present.
// Without it every one of them is idle by hours, the sweep opens a break for
// each, and the measurement becomes "what a poll costs on the rare occasion it
// has work to do" rather than what it costs the rest of the time.
function nowClock() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  let h = d.getHours()
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12; if (h === 0) h = 12
  const p = (n) => String(n).padStart(2, '0')
  return `${p(h)}:${p(d.getMinutes())}:${p(d.getSeconds())} ${ampm}`
}

function floor() {
  reset()
  ;['crm-book','source-book','issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  globalThis.__cautioSheets.vehicle = { data: null, at: 0 }
  globalThis.__cautioRoster = { lastGood: null }
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ...PEOPLE.map(([id, n]) => [id, n, 'x', 'employee', String(H), String((H + 9) % 24), 'No', 'No'])],
    'Client_Timings!A:B': [['Client','Hours'], ...CLIENTS.map(c => [c, String(H)])],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status',''],
      ...PEOPLE.map(([id, n]) => [id, n, TODAY, '07:05:00 am', '', '', 'Active', nowClock()])],
    'CRM_Updates!A:L': [['Date','Time','Emp','Client','Hour','Status','','','','','','']],
    'Breaks!A:H': [['EmpID','Name','Date','Start','End','Mins','Type','']],
    'Leaves!A:H': [['EmpID','Name','Date','From','To','Reason','By','At']],
    'Shift_Overrides!A:H': [['EmpID','Name','Date','Start','End','Type','','']],
    'Redistribution_Log!A:G': [['Date','Time','From','To','Client','Hour','']],
    'Daily_Summary!A:N': [['Date','Employee']],
    'Footage_Followup!A:J': [['Date','Time','IssueId','Client','Veh','From','To','Status','','']],
    'Issues- Realtime!A:T': [new Array(20).fill('h')],
    'Infants!A:B': [['Client','Vehicle']],
    'Others!A:B': vehicleRows,
  }
}

async function run(handler, user, query = {}) {
  const req = { method: 'GET', query, cookies: { cautio_token: signToken(user) }, headers: {} }
  let code = 200, body = null
  const res = {
    status(c) { code = c; return res },
    json(p) { body = p; return res },
    end() { return res },
  }
  await handler(req, res)
  // A screen that 500s costs nothing, which would read as a wonderful score.
  if (code !== 200) throw new Error(`handler returned ${code}: ${JSON.stringify(body)}`)
}

const cost = () => ({
  ranges: calls.get.length + calls.batchGet.reduce((s, b) => s + b.length, 0),
  reqs:   calls.get.length + calls.batchGet.length,
})

const EMP   = { name: 'Mahesh', empId: 'E1', role: 'employee' }
const ADMIN = { name: 'Admin',  empId: 'A1', role: 'admin' }

const cases = [
  ['admin Dashboard', 7, async () => { await run(overview, ADMIN) }],
  ['admin Hour by hour', 7, async () => { await run(fullDay, ADMIN, { date: TODAY }) }],
  ['employee dashboard', 6, async () => {
    await Promise.all([
      run(board, EMP), run(myDay, EMP),
      run(summary, EMP, { range: 'month' }), run(footage, EMP),
    ])
  }],
  ['18 dashboards at once', 6, async () => {
    await Promise.all(Array.from({ length: 18 }, () => Promise.all([
      run(board, EMP), run(myDay, EMP), run(footage, EMP),
    ])))
  }],
]

console.log('\nOne cold screen load — requests sent to Google\n')
console.log('screen                     ranges   sent   saved   budget')
console.log('──────────────────────────────────────────────────────────')

for (const [label, budget, fn] of cases) {
  floor()
  await fn()
  const c = cost()
  const saved = c.reqs > 0 ? `${(c.ranges / c.reqs).toFixed(1)}x` : '—'
  console.log(
    `${label.padEnd(26)} ${String(c.ranges).padStart(5)}  ${String(c.reqs).padStart(5)}  ${saved.padStart(6)}   ${String(budget).padStart(6)}`
  )
  ok(c.reqs <= budget, `${label}: ${c.reqs} requests, budget is ${budget}`)
  // A screen that reads nothing at all has not been exercised — the budget
  // would pass for the wrong reason.
  ok(c.ranges > 0, `${label}: read nothing, so this measured nothing`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
