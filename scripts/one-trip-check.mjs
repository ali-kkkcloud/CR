// Every screen answers in ONE round trip's wait.
//
// What decides how long a screen takes is not how many rows it reads — it is
// how many times it waits for Google ONE AFTER ANOTHER. A Sheets call from a
// serverless function is roughly a fifth of a second, and that dwarfs
// everything else a request does. Two waits in series is twice the wait,
// whatever else is optimised.
//
// The platform reads THREE separate books — the CRM workbook, the Issue
// Tracker and the vehicle source — and a batch can never span two of them. So
// three requests is the floor and there is no getting under it. But three
// requests fired together cost ONE wait; three requests separated by an
// `await` cost three. That is the whole difference, and it is entirely a
// matter of where they are asked for.
//
// Each of these four screens was asking for one book at the top, awaiting it,
// and only then — sometimes four hundred lines further down — asking for the
// next. The measurements below are what that cost:
//
//     screen                    before        after
//     ─────────────────────────────────────────────
//     admin Dashboard        462ms  2.1     235ms  1.1
//     admin Hour by hour     231ms  1.1     231ms  1.1
//     employee refresh       463ms  2.1     237ms  1.1
//     employee, the six      463ms  2.1     235ms  1.1
//
// Half, on three of the four, for moving where a read is asked for and
// changing nothing about what is read. Hour by hour was already right, which
// is where the pattern came from.
//
// This file exists so it stays that way. A read added further down the file,
// in the ordinary way, silently puts a screen back to two waits — nothing
// fails, nothing errors, the floor just waits twice as long again and nobody
// can point at the line that did it.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/one-trip-check.mjs
import fs from 'fs'

process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

// Big enough that a stray wait cannot hide in ordinary CPU time, small enough
// that the file finishes quickly.
const LATENCY_MS = 200
// One extra wait is 1.0 on this scale, so anything at or above this made a
// second round trip in series. The slack is for the handler's own work.
const CEILING = 1.6
const ROUNDS = 3

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')

const overview = (await import('../pages/api/admin/overview.js')).default
const fullDay  = (await import('../pages/api/admin/full-day-view.js')).default
const board    = (await import('../pages/api/clients/current.js')).default
const myDay    = (await import('../pages/api/dashboard/my-day.js')).default
const summary  = (await import('../pages/api/dashboard/summary.js')).default
const footage  = (await import('../pages/api/footage/list.js')).default
const tick     = (await import('../pages/api/dashboard/tick.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }
const code = f => fs.readFileSync(f, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

// ── The fixture ────────────────────────────────────────────────────────
//
// The operating day, not the calendar day. The platform's day runs 07:00 to
// 07:00, so before seven in the morning the rows still carry yesterday's
// date; a fixture filed under the calendar date puts its work where nothing
// looks, every screen reads as "shift not started", and the file passes all
// day and fails through the night shift.
const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const TODAY = (() => {
  const x = new Date(d); if (x.getHours() < 7) x.setDate(x.getDate() - 1)
  const q = n => String(n).padStart(2, '0')
  return `${q(x.getDate())}/${q(x.getMonth() + 1)}/${x.getFullYear()}`
})()
const H = d.getHours()
// How far `d`'s epoch sits from the real one, so a stamp can be built for
// "now" as the sheets would write it at any moment during the run.
const IST_SKEW = d.getTime() - Date.now()

const PEOPLE = [['E1', 'Mahesh'], ['E2', 'Sunil'], ['E3', 'Nikita']]
const CLIENTS = Array.from({ length: 46 }, (_, i) => `Client ${i + 1}`)
const vehicleRows = [['Client', 'Vehicle']]
CLIENTS.forEach((c, i) => { for (let v = 0; v < 6; v++) vehicleRows.push([c, `KA${i}-${v}`]) })

// Takes an IST-SHIFTED epoch — `d.getTime()` above, not `Date.now()`.
//
// `d` is built from an IST string, so its plain getHours() reads as IST and
// its epoch is shifted by the offset. Feeding the real epoch in here instead
// stamps every row five and a half hours in the past, the platform decides
// the heartbeat is stale, and it spends a WRITE refreshing it on every single
// request — so the file ends up timing a heartbeat write rather than the page
// load it is meant to be measuring.
const clockAt = (istMs) => {
  const x = new Date(istMs), p = n => String(n).padStart(2, '0')
  let h = x.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12
  return `${p(h)}:${p(x.getMinutes())}:${p(x.getSeconds())} ${a}`
}
// Three hours in, and expressed against the clock rather than hard-coded: a
// shift pinned to 07:05 has long finished if this runs in the evening, and the
// auto-close sweep then fires on every request — so the file would measure a
// sweep instead of a poll, and pass in the morning while failing at night.
const SHIFT_START = (H + 21) % 24
const CLOCK_IN = clockAt(d.getTime() - 3 * 3600000)

function floor() {
  reset()
  behaviour.latencyMs = LATENCY_MS
  ;['crm-book', 'source-book', 'issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  globalThis.__cautioSheets.vehicle = { data: null, at: 0 }
  globalThis.__cautioRoster = { lastGood: null }
  // The long-lived caches too, or the first screen measured warms them for
  // every screen after it and the rest read as free.
  globalThis.__cautioHistory = { rows: null, at: 0 }
  behaviour.data = {
    'Credentials!A:H': [['EmpID', 'Name', 'Pw', 'Role', 'Start', 'End', 'Night', 'WeekOff'],
      ...PEOPLE.map(([id, n]) => [id, n, 'x', 'employee', String(SHIFT_START), String((SHIFT_START + 9) % 24), 'No', 'No'])],
    'Client_Timings!A:B': [['Client', 'Hours'], ...CLIENTS.map(c => [c, String(H)])],
    'Employee_Hours!A:D': [['Employee', 'Hour', 'Fixed', 'Custom']],
    'Shift_Log!A:H': [['EmpID', 'Name', 'Date', 'In', 'Out', '', 'Status', ''],
      // Column H is the heartbeat: last seen a moment ago, so nobody reads as
      // idle and the sweep has nothing to do.
      ...PEOPLE.map(([id, n]) => [id, n, TODAY, CLOCK_IN, '', '', 'Active', clockAt(Date.now() + IST_SKEW)])],
    'CRM_Updates!A:L': [['Date', 'Time', 'Emp', 'Client', 'Hour', 'Status', '', '', '', '', '', '']],
    'Breaks!A:H': [['EmpID', 'Name', 'Date', 'Start', 'End', 'Mins', 'Type', '']],
    'Leaves!A:H': [['EmpID', 'Name', 'Date', 'From', 'To', 'Reason', 'By', 'At']],
    'Shift_Overrides!A:H': [['EmpID', 'Name', 'Date', 'Start', 'End', 'Type', '', '']],
    'Redistribution_Log!A:G': [['Date', 'Time', 'From', 'To', 'Client', 'Hour', '']],
    'Daily_Summary!A:N': [['Date', 'Employee']],
    'Footage_Followup!A:J': [['Date', 'Time', 'IssueId', 'Client', 'Veh', 'From', 'To', 'Status', '', '']],
    'Issues- Realtime!A:T': [new Array(20).fill('h')],
    'Infants!A:B': [['Client', 'Vehicle']],
    'Others!A:B': vehicleRows,
    'Monthly_History!A:J': [['Label', 'From', 'To', 'Employee', 'Clients', 'Completed', 'Pending', 'Vehicles', 'Monitored', 'Source']],
    'Break_Watchlist!A:D': [['Name', 'Active', 'Reason', 'Added']],
  }
}

async function call(handler, user, query = {}) {
  const req = { method: 'GET', query, cookies: { cautio_token: signToken(user) }, headers: {} }
  let status = 200, body = null
  const res = { status(c) { status = c; return res }, json(p) { body = p; return res }, end() { return res } }
  await handler(req, res)
  // A screen that 500s is instant, which would read as a wonderful score.
  if (status !== 200) throw new Error(`handler returned ${status}: ${JSON.stringify(body)}`)
}

const EMP   = { name: 'Mahesh', empId: 'E1', role: 'employee' }
const ADMIN = { name: 'Admin',  empId: 'A1', role: 'admin' }

const screens = [
  ['admin Dashboard',        () => call(overview, ADMIN)],
  ['admin Hour by hour',     () => call(fullDay, ADMIN, { date: TODAY })],
  ['employee refresh (tick)', () => call(tick, EMP, { range: 'month', activeAgoMs: '1000' })],
  ['employee, the old six',  () => Promise.all([
    call(board, EMP), call(myDay, EMP), call(summary, EMP, { range: 'month' }), call(footage, EMP),
  ])],
]

// ── Counting the waits, rather than inferring them from the clock ──────
//
// Wall time is the honest measure of what the floor feels, but it answers a
// slightly different question from the one this file asks. A poll also writes
// the heartbeat once every couple of minutes, and that write is a round trip
// nobody can remove: you cannot write a row you have not read. Timed on the
// clock, a run that happened to include one would fail here for a reason that
// is not a fault.
//
// So the reads are counted directly. Every call to Google is stamped, and
// calls that START while an earlier one is still out are one WAVE — they were
// fired together and cost one wait between them. A second wave means
// something was asked for only after an earlier answer came back, which is
// the fault this file is looking for.
function waves(stamps) {
  if (!stamps.length) return 0
  let n = 1, cut = stamps[0] + LATENCY_MS / 2
  for (const at of stamps) if (at >= cut) { n++; cut = at + LATENCY_MS / 2 }
  return n
}

console.log('\n1  Every screen asks for everything in one wave')
for (const [label, fn] of screens) {
  let bestWaves = Infinity, bestMs = Infinity, bestReads = 0
  for (let i = 0; i < ROUNDS; i++) {
    floor()
    const t0 = Date.now()
    const stamps = []
    for (const k of ['get', 'batchGet']) {
      const arr = calls[k], push = arr.push.bind(arr)
      arr.push = (...a) => { stamps.push(Date.now() - t0); return push(...a) }
    }
    await fn()
    const ms = Date.now() - t0
    const w = waves(stamps)
    if (w < bestWaves || (w === bestWaves && ms < bestMs)) { bestWaves = w; bestMs = ms; bestReads = stamps.length }
    // `reset()` at the top of floor() hands back plain arrays, so the wrappers
    // do not stack across rounds.
  }
  ok(bestWaves <= 1,
     `${label} read in ${bestWaves} waves — something is asked for only after an earlier read came back`)
  console.log(`   ${label.padEnd(26)} ${String(bestMs + 'ms').padStart(6)}   ${bestWaves} wave${bestWaves === 1 ? '' : 's'}, ${bestReads} requests`)
  // The clock has to agree, or the wave count is measuring the wrong thing.
  ok(bestMs / LATENCY_MS < CEILING,
     `${label} took ${(bestMs / LATENCY_MS).toFixed(1)} round trips on the clock (${bestMs}ms) despite reading in one wave`)
}

// ══ 2 · Where the books are asked for ══════════════════════════════════
//
// The measurement above is the real test; this says WHY when it fails, and
// catches the case a fixture happens not to exercise. Each of these reads more
// than one book, and every one of them must be named before the first await.
console.log('\n2  All three books are named on the same tick')
{
  const files = [
    'pages/api/admin/overview.js',
    'pages/api/dashboard/summary.js',
    'pages/api/dashboard/tick.js',
  ]
  for (const f of files) {
    const c = code(f)
    // The opening Promise.all — everything up to its closing `])`.
    //
    // The closer must be the whole line. warmTogether takes an array of its
    // own, so the block contains a nested `])` — matched lazily without the
    // end-of-line anchor, this stops at `]).catch(() => null),` four lines in
    // and then reports the other books as missing when they are right there.
    const opening = (c.match(/await Promise\.all\(\[[\s\S]*?\n[ \t]*\]\)[ \t]*$/m) || [''])[0]
    ok(opening, `${f}: an opening Promise.all was found at all`)
    ok(/warmTogether\(CRM_SHEET_ID/.test(opening), `${f}: the CRM book is warmed in the opening batch`)
    ok(/ISSUE_SHEET_ID/.test(opening), `${f}: the Issue Tracker goes out with it, not after it`)
    ok(/fetchClientVehicleCounts\(\)/.test(opening), `${f}: the vehicle source goes out with it too`)
    // The one that is easy to forget, because it is read hundreds of lines
    // below and is nearly always a cache hit — until the function is cold.
    ok(/getWatchlistNames\(\)|getHistory\(\)|readMonthlyHistory\(\)/.test(opening),
       `${f}: the long-lived tabs ride the same batch rather than going alone`)
  }
  console.log('   one Promise.all at the top of each, and no book left behind it')
}

// ══ 3 · Asking for them together must not cost more ════════════════════
//
// Moving a read earlier is only worth doing if it does not turn one request
// into two. These tabs keep their own long lifetimes — the watchlist ten
// minutes, the history half an hour — so naming them at the top puts them in a
// batch that was leaving anyway rather than re-fetching them every poll.
console.log('\n3  Nothing is fetched more often than before')
{
  const s = code('lib/sheets.js')
  ok(/WATCHLIST:\s*600000/.test(s), 'the watchlist still lives ten minutes')
  ok(/readSheetCached\(CRM_SHEET_ID, `\$\{TABS\.WATCHLIST\}!A:D`, TTL\.WATCHLIST\)/.test(s),
     'and is read on that life, not on the shift tabs\' fifteen seconds')

  const h = code('lib/history.js')
  ok(/HISTORY_TTL_MS = 30 \* 60 \* 1000/.test(h), 'the monthly history still lives half an hour')

  // The shift tabs are warmed on one short window ON PURPOSE, so they age
  // together and come due in the same batch. A long-lived tab must not be put
  // in that list — it would be re-fetched four times a minute to be told
  // nothing had changed.
  const t = code('pages/api/dashboard/tick.js')
  const everyTab = (t.match(/const EVERY_TAB = \[[\s\S]*?\]/) || [''])[0]
  ok(!/WATCHLIST/.test(everyTab), 'the watchlist is not in the fifteen-second warm list')
  ok(!/HISTORY/.test(everyTab), 'nor is the monthly history')
  console.log('   they ride the batch, they do not shorten their own lives to do it')
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
