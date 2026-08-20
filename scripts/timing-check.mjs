// How long a screen takes to answer, in milliseconds.
//
// Request counts say what a screen costs Google's quota. They do not say what
// the person waiting actually experiences, and that is the question worth
// answering. This measures wall-clock time through the real endpoints, with
// every call to Sheets given a fixed, realistic delay.
//
// The delay is the point. A Sheets request from a serverless function is a
// couple of hundred milliseconds, and it dominates everything else a screen
// does — so what decides how long a screen takes is how many round trips it
// makes IN SERIES. Requests fired together cost one delay between them;
// requests separated by an `await` cost one each.
//
// Run the same file against a checkout of `main` to compare against what the
// floor is using today.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/timing-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const LATENCY_MS = Number(process.env.LATENCY_MS || 220)
const ROUNDS = Number(process.env.ROUNDS || 3)

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')

const overview = (await import('../pages/api/admin/overview.js')).default
const fullDay  = (await import('../pages/api/admin/full-day-view.js')).default
const board    = (await import('../pages/api/clients/current.js')).default
const myDay    = (await import('../pages/api/dashboard/my-day.js')).default
const summary  = (await import('../pages/api/dashboard/summary.js')).default
const footage  = (await import('../pages/api/footage/list.js')).default

const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const TODAY = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
const H = d.getHours()

const PEOPLE = [['E1','Mahesh'],['E2','Sunil'],['E3','Nikita']]
const CLIENTS = Array.from({ length: 46 }, (_, i) => `Client ${i + 1}`)
const vehicleRows = [['Client','Vehicle']]
CLIENTS.forEach((c, i) => { for (let v = 0; v < 6; v++) vehicleRows.push([c, `KA${i}-${v}`]) })

function floor() {
  reset()
  behaviour.latencyMs = LATENCY_MS
  ;['crm-book','source-book','issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  globalThis.__cautioSheets.vehicle = { data: null, at: 0 }
  globalThis.__cautioRoster = { lastGood: null }
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ...PEOPLE.map(([id, n]) => [id, n, 'x', 'employee', String(H), String((H + 9) % 24), 'No', 'No'])],
    'Client_Timings!A:B': [['Client','Hours'], ...CLIENTS.map(c => [c, String(H)])],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status',''],
      ...PEOPLE.map(([id, n]) => [id, n, TODAY, '07:05:00 am', '', '', 'Active', ''])],
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
  // A screen that 500s is instant, which would read as a wonderful score.
  if (code !== 200) throw new Error(`handler returned ${code}: ${JSON.stringify(body)}`)
}

const EMP   = { name: 'Mahesh', empId: 'E1', role: 'employee' }
const ADMIN = { name: 'Admin',  empId: 'A1', role: 'admin' }

const cases = [
  ['admin Dashboard', async () => { await run(overview, ADMIN) }],
  ['admin Hour by hour', async () => { await run(fullDay, ADMIN, { date: TODAY }) }],
  ['employee opening the app', async () => {
    await Promise.all([
      run(board, EMP), run(myDay, EMP),
      run(summary, EMP, { range: 'month' }), run(footage, EMP),
    ])
  }],
]

console.log(`\nCold screen load, every Sheets call taking ${LATENCY_MS}ms\n`)
console.log('screen                        time     round trips in series')
console.log('────────────────────────────────────────────────────────────')

const results = {}
for (const [label, fn] of cases) {
  let best = Infinity
  for (let i = 0; i < ROUNDS; i++) {
    floor()
    const t0 = Date.now()
    await fn()
    best = Math.min(best, Date.now() - t0)
  }
  // Time spent waiting, divided by what one wait costs: how many round trips
  // the screen made one after another rather than together.
  const inSeries = (best / LATENCY_MS).toFixed(1)
  results[label] = best
  console.log(`${label.padEnd(28)} ${String(best + 'ms').padStart(7)}     ${inSeries}`)
}

console.log(`\n(best of ${ROUNDS} runs; a lower "in series" number is a faster screen)`)
console.log(JSON.stringify(results))
