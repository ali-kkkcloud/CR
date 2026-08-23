// A whole floor, polling, counted against Google's allowance.
//
// The complaint is that saving takes thirty seconds. It is not the save: a
// save is two reads and one write. It is that the allowance those three
// requests need has already been spent, so every one of them is refused and
// retried on a backoff that runs to seventy seconds before it gives up.
//
// Google allows 60 READ REQUESTS PER MINUTE PER USER, and "user" here is the
// one service account the whole platform signs in as. Sixty a minute, for the
// entire floor, forever. Measured against the live book on 21 August: the
// allowance was gone. A single read from outside the platform was refused
// again and again, for minutes at a time.
//
// ── Why this spawns processes ──────────────────────────────────────────
//
// On Vercel every API route is its OWN serverless function, with its own
// process and its own memory. The read cache in lib/sheets can only collapse
// reads INSIDE one process, so six polled endpoints means six separate caches
// each fetching the same tabs. Running the whole floor inside one node
// process would share one cache between all six routes and measure a platform
// that does not exist.
//
// So each route is simulated in its own child process, exactly as Vercel runs
// it, and the requests they send are added up.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/floor-load-check.mjs
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'

const SELF = fileURLToPath(import.meta.url)
const RUN_SECONDS = parseInt(process.env.SECONDS || '20', 10)
const ALLOWANCE = 60

// ── The child: one route, the whole floor hitting it ───────────────────
if (process.env.ROUTE) {
  process.env.CRM_SHEET_ID = 'crm-book'
  process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
  process.env.SOURCE_SHEET_ID = 'source-book'
  process.env.JWT_SECRET = 'test-secret'

  const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
  const sheets = await import('../lib/sheets.js')
  const { signToken } = await import('../lib/auth.js')

  const HANDLERS = {
    'clients/current':   () => import('../pages/api/clients/current.js'),
    'dashboard/my-day':  () => import('../pages/api/dashboard/my-day.js'),
    'dashboard/summary': () => import('../pages/api/dashboard/summary.js'),
    'footage/list':      () => import('../pages/api/footage/list.js'),
    'break/status':      () => import('../pages/api/break/status.js'),
    'shift/status':      () => import('../pages/api/shift/status.js'),
    'dashboard/tick':    () => import('../pages/api/dashboard/tick.js'),
    'admin/overview':    () => import('../pages/api/admin/overview.js'),
    'admin/full-day-view': () => import('../pages/api/admin/full-day-view.js'),
    'crm/update':        () => import('../pages/api/crm/update.js'),
  }
  const handler = (await HANDLERS[process.env.ROUTE]()).default

  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const p2 = (n) => String(n).padStart(2, '0')
  // The OPERATING day, which is what every date column in these sheets holds.
  // NOT the calendar date: the operating day runs 07:00 to 07:00, so between
  // midnight and seven the two differ, and a fixture filed under the calendar
  // date puts its rows where the platform never looks — every screen then reads
  // "shift not started, no clients" and the file fails only at night.
  const TODAY = (() => { const x = new Date(d); if (x.getHours() < 7) x.setDate(x.getDate() - 1)
    return `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}` })()
  const H = d.getHours()
  const nowClock = () => { let h = d.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${p2(h)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${a}` }
  const clockOf = (x) => { let h = x.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${p2(h)}:${p2(x.getMinutes())}:${p2(x.getSeconds())} ${a}` }
  // The shift opened three hours ago and runs nine, so it is comfortably in
  // progress WHATEVER time this is run.
  //
  // It used to start at the current hour with everybody clocked in at 07:05,
  // which is a shift three hours past its end if you run this in the evening —
  // so the auto-close swept the whole floor on every single request and the
  // measurement read 584 writes a minute. That was the fixture, not the
  // platform. Anchored to now, the way every other fixture here is.
  const SHIFT_START = (H + 21) % 24
  const CLOCK_IN = clockOf(new Date(d.getTime() - 3 * 3600000))

  const NAMES = ['Sunil','Mahesh','Nikita','BRINDA','Nesiya','Rakesh','GUNASAGARI','HARI','KIRAN','MANTU',
                 'CHANDAN','RISHI','Ritanjali','Shashi','Yunus','Afzal','Darshan','Naveen']
  const PEOPLE = NAMES.map((n, i) => [`E${i + 1}`, n])
  const CLIENTS = Array.from({ length: 46 }, (_, i) => `Client ${i + 1}`)
  const vehicleRows = [['Client','Vehicle']]
  CLIENTS.forEach((c, i) => { for (let v = 0; v < 6; v++) vehicleRows.push([c, `KA${i}-${v}`]) })

  // A day's worth of CRM_Updates. The live tab held 3,767 rows when this was
  // measured, so this is the right order of magnitude for the tab every
  // screen reads.
  const updateRows = [['Date','Time','Emp','Client','Hour','Status','Mis','Alerts','Fatigue','FCount','Notes','Live']]
  for (let h = 7; h < 7 + 12; h++) {
    PEOPLE.forEach(([, name], i) => {
      for (let c = 0; c < 12; c++) {
        updateRows.push([TODAY, '09:00:00 am', name, CLIENTS[(i * 3 + c) % CLIENTS.length], String(h % 24),
                         'Completed', '', '0', 'No', '0', '', '5'])
      }
    })
  }

  reset()
  ;['crm-book','source-book','issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  if (globalThis.__cautioAttendance) {
    globalThis.__cautioAttendance.recentOpenings.clear()
    // A floor sweep is not what this measures, and it only runs once every
    // 45 seconds in any case.
    globalThis.__cautioAttendance.lastFloorSweep = Date.now()
  }
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ...PEOPLE.map(([id, n]) => [id, n, 'x', 'employee', String(SHIFT_START), String((SHIFT_START + 9) % 24), 'No', 'No'])],
    'Client_Timings!A:B': [['Client','Hours'], ...CLIENTS.map(c => [c, String(H)])],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status','Seen'],
      ...PEOPLE.map(([id, n]) => [id, n, TODAY, CLOCK_IN, '', '', 'Active', nowClock()])],
    'CRM_Updates!A:L': updateRows,
    'Breaks!A:H': [['EmpID','Name','Date','Start','End','Mins','Status','Type']],
    'Leaves!A:H': [['EmpID','Name','Date','From','To','Reason','By','At']],
    'Shift_Overrides!A:H': [['EmpID','Name','Date','Start','End','Type','','']],
    'Redistribution_Log!A:G': [['Date','Time','From','To','Client','Hour','']],
    'Daily_Summary!A:N': [['Date','Employee']],
    'Footage_Followup!A:J': [['Date','Time','IssueId','Client','Veh','From','To','Status','','']],
    'Issues- Realtime!A:T': [new Array(20).fill('h')],
    'Infants!A:B': [['Client','Vehicle']],
    'Others!A:B': vehicleRows,
    'Sessions!A:E': [['EmpID','Name','SessionId','SignedInAt','Device']],
  }

  // What a request to Google actually costs in wall-clock time, so the save
  // timings below mean something. Measured live: a values.get of Shift_Log
  // takes a little over 400ms when the allowance is not exhausted.
  behaviour.latencyMs = parseInt(process.env.LATENCY_MS || '400', 10)
  // A save that appends really does make the tab longer, and whether the
  // cached copy stays in step with the sheet is part of what decides how
  // many requests the next save costs. A recorder that swallowed appends
  // would make every save look like it had to re-read the whole tab.
  behaviour.appendWritesBack = true

  const users = PEOPLE.map(([empId, name]) => ({ name, role: 'employee', empId }))
  const admins = [{ name: 'Admin1', role: 'admin', empId: 'A1' }, { name: 'Admin2', role: 'admin', empId: 'A2' }]
  const isAdminRoute = process.env.ROUTE.startsWith('admin/')
  const isSave = process.env.ROUTE === 'crm/update'
  const who = isAdminRoute ? admins : users

  async function hit(user, opts = {}) {
    const req = {
      method: opts.method || 'GET',
      query: opts.query || {},
      body: opts.body || {},
      cookies: { cautio_token: signToken(user) },
      headers: {},
    }
    const res = { status() { return res }, json() { return res }, end() { return res }, setHeader() { return res } }
    try { await handler(req, res) } catch { /* a failed request still cost what it sent */ }
  }

  const timers = []
  let stopped = false
  const saveTimes = []
  const started = Date.now()

  if (isSave) {
    // Somebody saves a client every four seconds, roughly what a floor of
    // eighteen produces through a working hour.
    let i = 0
    timers.push(setInterval(async () => {
      if (stopped) return
      const u = users[i++ % users.length]
      const t = Date.now()
      await hit(u, { method: 'POST', body: {
        client: CLIENTS[i % CLIENTS.length], slot: H, status: 'Completed',
        alertCount: 0, fatigue: 'No', fatigueCount: 0, notes: '', liveVehicles: 5,
      } })
      saveTimes.push(Date.now() - t)
    }, 4000))
  } else {
    // Staggered across the poll window — eighteen people do not press reload
    // at the same instant.
    const POLL_MS = isAdminRoute ? 30000 : 30000
    who.forEach((u, i) => {
      timers.push(setTimeout(function tick() {
        if (stopped) return
        hit(u, { query: { activeAgoMs: '1000', range: 'today' } })
        timers.push(setTimeout(tick, POLL_MS))
      }, (i * POLL_MS) / who.length))
    })
  }

  await new Promise(r => setTimeout(r, RUN_SECONDS * 1000))
  stopped = true
  timers.forEach(t => { clearTimeout(t); clearInterval(t) })
  await new Promise(r => setTimeout(r, 800))

  const minutes = (Date.now() - started) / 60000
  const reads  = calls.get.length + calls.batchGet.length
  const writes = calls.append.length + calls.update.length
  const median = saveTimes.length ? [...saveTimes].sort((a, b) => a - b)[Math.floor(saveTimes.length / 2)] : 0
  const slowest = saveTimes.length ? Math.max(...saveTimes) : 0
  // DUMP=1 lists what actually went to Google, so a route that is sending
  // more than it should can be looked at rather than guessed about.
  if (process.env.DUMP) {
    const tally = new Map()
    calls.batchGet.forEach(b => { const k = 'batch: ' + b.join(', '); tally.set(k, (tally.get(k) || 0) + 1) })
    calls.get.forEach(g => { const k = 'get:   ' + g; tally.set(k, (tally.get(k) || 0) + 1) })
    calls.append.forEach(g => { const k = 'APPEND ' + g; tally.set(k, (tally.get(k) || 0) + 1) })
    calls.update.forEach(g => { const k = 'UPDATE ' + g; tally.set(k, (tally.get(k) || 0) + 1) })
    ;[...tally.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([k, n]) => console.error(`  ×${String(n).padStart(3)}  ${k}`))
  }
  console.log('RESULT ' + JSON.stringify({
    route: process.env.ROUTE,
    reads: Math.round(reads / minutes),
    writes: Math.round(writes / minutes),
    saves: saveTimes.length, median, slowest,
  }))
  process.exit(0)
}

// ── The parent: run every route side by side and add it up ─────────────
function runRoute(route) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', './scripts/test-hooks.mjs', SELF], {
      env: { ...process.env, ROUTE: route, SECONDS: String(RUN_SECONDS) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', d => { out += d.toString() })
    child.stderr.on('data', () => {})
    child.on('close', () => {
      const line = out.split('\n').find(l => l.startsWith('RESULT '))
      resolve(line ? JSON.parse(line.slice(7)) : { route, reads: 0, writes: 0, saves: 0, median: 0, slowest: 0 })
    })
  })
}

async function scenario(title, routes) {
  const results = await Promise.all(routes.map(runRoute))
  const reads  = results.reduce((s, r) => s + r.reads, 0)
  const writes = results.reduce((s, r) => s + r.writes, 0)
  const save   = results.find(r => r.saves > 0) || { median: 0, slowest: 0, saves: 0 }
  console.log(`\n${title}`)
  console.log('  route                        reads/min   writes/min')
  results.forEach(r => console.log(`  ${r.route.padEnd(26)} ${String(r.reads).padStart(7)} ${String(r.writes).padStart(12)}`))
  console.log(`  ${'TOTAL'.padEnd(26)} ${String(reads).padStart(7)} ${String(writes).padStart(12)}`)
  console.log(`  Google's allowance: ${ALLOWANCE} reads/min for the whole floor`)
  if (save.saves) console.log(`  a save takes: ${save.median}ms at the median, ${save.slowest}ms at worst (${save.saves} measured)`)
  return { reads, writes, save }
}

console.log(`\nA floor of 18 employees and 2 admins, ${RUN_SECONDS}s of real traffic per route.`)
console.log('Each route in its own process, because that is how Vercel runs them.')

const BEFORE = ['clients/current', 'dashboard/my-day', 'dashboard/summary',
                'footage/list', 'break/status', 'shift/status',
                'admin/overview', 'admin/full-day-view', 'crm/update']
const AFTER  = ['dashboard/tick', 'admin/overview', 'admin/full-day-view', 'crm/update']

const before = await scenario('SIX POLLED ENDPOINTS — what the dashboard used to ask for', BEFORE)
const after  = await scenario('ONE POLLED ENDPOINT — /api/dashboard/tick', AFTER)

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

console.log(`\n  ${before.reads} reads/min → ${after.reads} reads/min` +
            (after.reads ? `  (${(before.reads / Math.max(1, after.reads)).toFixed(1)}× fewer)` : ''))

ok(after.reads <= ALLOWANCE,
   `${after.reads} read requests a minute — the allowance is ${ALLOWANCE}, and past it every screen AND every save starts being refused`)
ok(after.reads < before.reads, `the combined poll sends ${after.reads}, the six endpoints sent ${before.reads}`)
ok(after.save.median <= 1500, `a save takes ${after.save.median}ms at the median; it should be about a second`)

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
