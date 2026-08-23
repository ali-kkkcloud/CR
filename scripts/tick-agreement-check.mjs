// The combined poll must answer EXACTLY what the six endpoints answer.
//
// /api/dashboard/tick was added so the dashboard's thirty-second refresh
// costs one request instead of six. It runs the same six handlers rather than
// reimplementing them — but "same handlers" is a claim, and the thing the
// floor actually cares about is whether their clients, their hours, their
// breaks and their shift come back unchanged.
//
// So: run the six on their own against a fixture, run the tick against the
// same fixture, and compare the answers field by field. Anything that differs
// is a behaviour change, whether it was meant or not.
//
// Clock strings are normalised before comparing. Both runs call nowStr() at
// slightly different moments, and a second ticking over between them is not a
// difference in behaviour.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/tick-agreement-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')

const board   = (await import('../pages/api/clients/current.js')).default
const myDay   = (await import('../pages/api/dashboard/my-day.js')).default
const summary = (await import('../pages/api/dashboard/summary.js')).default
const footage = (await import('../pages/api/footage/list.js')).default
const brkStat = (await import('../pages/api/break/status.js')).default
const shiftSt = (await import('../pages/api/shift/status.js')).default
const tick    = (await import('../pages/api/dashboard/tick.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

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
// The shift opened three hours ago, so nothing in these fixtures is sitting
// in the grace period before a shift starts.
const SHIFT_START = (H + 21) % 24

const NAMES = ['Sunil','Mahesh','Nikita','BRINDA','Nesiya','Rakesh','HARI','KIRAN','MANTU','CHANDAN']
const PEOPLE = NAMES.map((n, i) => [`E${i + 1}`, n])
const CLIENTS = Array.from({ length: 40 }, (_, i) => `Client ${i + 1}`)
const vehicleRows = [['Client','Vehicle']]
CLIENTS.forEach((c, i) => { for (let v = 0; v < 6; v++) vehicleRows.push([c, `KA${i}-${v}`]) })

const updateRows = [['Date','Time','Emp','Client','Hour','Status','Mis','Alerts','Fatigue','FCount','Notes','Live']]
PEOPLE.forEach(([, name], i) => {
  for (let c = 0; c < 6; c++) {
    updateRows.push([TODAY, '09:00:00 am', name, CLIENTS[(i * 4 + c) % CLIENTS.length], String(H),
                     c % 2 ? 'Completed' : '', '', String(c % 3), 'No', '0', '', String(c)])
  }
})

// Everyone seen a moment ago, so no sweep writes anything and both runs are
// pure reads — otherwise the first run would open a break and the second
// would not, and the two would differ for a reason that is not a fault.
function fixture({ breaks = [], lastSeenMins = 1 } = {}) {
  return {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ...PEOPLE.map(([id, n]) => [id, n, 'x', 'employee', String(SHIFT_START), String((SHIFT_START + 9) % 24), 'No', 'No'])],
    'Client_Timings!A:B': [['Client','Hours'], ...CLIENTS.map(c => [c, String(H)])],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status','Seen'],
      ...PEOPLE.map(([id, n]) => [id, n, TODAY, clockOf(minsAgo(180)), '', '', 'Active', clockOf(minsAgo(lastSeenMins))])],
    'CRM_Updates!A:L': updateRows,
    'Breaks!A:H': [['EmpID','Name','Date','Start','End','Mins','Status','Type'], ...breaks],
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
}

function floor(opts) {
  reset()
  ;['crm-book','source-book','issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  globalThis.__cautioSheets.vehicle = { data: null, at: 0 }
  globalThis.__cautioRoster = { lastGood: null }
  if (globalThis.__cautioAttendance) {
    globalThis.__cautioAttendance.recentOpenings.clear()
    globalThis.__cautioAttendance.lastFloorSweep = Date.now()
  }
  behaviour.data = fixture(opts)
}

async function call(handler, user, query = {}) {
  const req = { method: 'GET', query, body: {}, cookies: { cautio_token: signToken(user) }, headers: {} }
  let body = null, code = 200
  const res = { status(c) { code = c; return res }, json(p) { body = p; return res },
                end() { return res }, setHeader() { return res } }
  await handler(req, res)
  return { code, body }
}

// A second ticking over between two runs is not a behaviour change.
const CLOCK = /\b\d{1,2}:\d{2}:\d{2}\s?(am|pm)\b/gi
const norm = (x) => JSON.stringify(x, (k, v) =>
  typeof v === 'string' ? v.replace(CLOCK, '<clock>') : v)

const EMP   = { name: 'MANTU', role: 'employee', empId: 'E9' }
const OTHER = { name: 'Sunil', role: 'employee', empId: 'E1' }

// ── 1 · The six, and the one, on a full floor ──────────────────────────
console.log('\n1  A working floor: do the answers match?')
{
  floor()
  const six = {
    clients:     (await call(board,   EMP)).body,
    myDay:       (await call(myDay,   EMP)).body,
    summary:     (await call(summary, EMP, { range: 'today' })).body,
    footage:     (await call(footage, EMP)).body,
    breakStatus: (await call(brkStat, EMP, { activeAgoMs: '1000' })).body,
    shiftStatus: (await call(shiftSt, EMP)).body,
  }

  floor()
  const one = (await call(tick, EMP, { range: 'today', activeAgoMs: '1000' })).body

  for (const key of Object.keys(six)) {
    ok(norm(one[key]) === norm(six[key]), `"${key}" differs between the six endpoints and the combined poll`)
  }
  console.log(`   clients ${six.clients.clients.length}, my day ${six.myDay.timeline.length} hours, ` +
              `shift ${six.shiftStatus.status} — all six sections identical`)
}

// ── 2 · The clients themselves, named ──────────────────────────────────
// The one thing that must never change: who holds which client.
console.log('\n2  The board, client by client')
{
  floor()
  const alone = (await call(board, EMP)).body
  floor()
  const viaTick = (await call(tick, EMP)).body.clients

  const a = alone.clients.map(c => c.client).sort()
  const b = viaTick.clients.map(c => c.client).sort()
  ok(a.length === b.length && a.every((n, i) => n === b[i]),
     `the board holds different clients: ${a.length} alone vs ${b.length} through the tick`)
  ok(alone.hour === viaTick.hour, `the hour differs: ${alone.hour} vs ${viaTick.hour}`)
  ok(norm(alone.filled) === norm(viaTick.filled), 'what is already filled in differs')
  console.log(`   ${a.length} clients, same names, same hour, same saved work`)
}

// ── 3 · Everybody's day, not just the caller's ─────────────────────────
console.log('\n3  A second employee sees their own day')
{
  floor()
  const alone = (await call(myDay, OTHER)).body
  floor()
  const viaTick = (await call(tick, OTHER)).body.myDay
  ok(norm(alone) === norm(viaTick), 'the second employee gets a different day through the tick')
  ok(alone.totalClients === viaTick.totalClients, `${alone.totalClients} vs ${viaTick.totalClients} clients`)
  console.log(`   ${alone.totalClients} clients across ${alone.timeline.length} hours — identical`)
}

// ── 4 · Breaks, through both routes ────────────────────────────────────
console.log('\n4  Somebody on a break')
{
  const open = ['E9', 'MANTU', TODAY, clockOf(minsAgo(20)), '', '', 'Active', 'Manual']
  const done = ['E9', 'MANTU', TODAY, clockOf(minsAgo(90)), clockOf(minsAgo(75)), '15', 'Completed', 'Auto']

  floor({ breaks: [done, open] })
  const alone = (await call(brkStat, EMP, { activeAgoMs: '1000' })).body
  floor({ breaks: [done, open] })
  const viaTick = (await call(tick, EMP, { activeAgoMs: '1000' })).body.breakStatus

  ok(norm(alone) === norm(viaTick), 'the break state differs through the tick')
  ok(viaTick.onBreak === true, 'the open break was not reported')
  ok(viaTick.history.length === 2, `${viaTick.history.length} breaks in today's history, expected 2`)
  ok(viaTick.totalMinutesToday === alone.totalMinutesToday,
     `time away differs: ${alone.totalMinutesToday}m vs ${viaTick.totalMinutesToday}m`)
  console.log(`   on break: ${viaTick.onBreak}, ${viaTick.history.length} today, ${viaTick.totalMinutesToday}m away — identical`)
}

// ── 5 · The idle rule still opens a break through the tick ─────────────
// The layer that matters most, and the one that was reported broken. An
// employee who has touched nothing for twenty-five minutes must get a break
// whether the poll goes through break/status or through the combined one.
console.log('\n5  Twenty-five minutes of silence, through the combined poll')
{
  floor({ lastSeenMins: 25 })
  await call(brkStat, EMP)                       // no activeAgoMs: the browser is gone
  const aloneOpened = calls.append.length

  floor({ lastSeenMins: 25 })
  await call(tick, EMP)
  const tickOpened = calls.append.length

  ok(aloneOpened === 1, `break/status on its own opened ${aloneOpened} breaks, expected 1`)
  ok(tickOpened === aloneOpened, `the tick opened ${tickOpened} breaks where break/status opened ${aloneOpened}`)
  console.log(`   silent 25 minutes → 1 break opened, either way`)
}

// ── 6 · Somebody at their screen is still left alone ───────────────────
console.log('\n6  An employee who is working')
{
  floor({ lastSeenMins: 1 })
  await call(tick, EMP, { activeAgoMs: '2000' })
  ok(calls.append.length === 0, `somebody seen a moment ago was put on a break by the tick`)
  console.log(`   active now → no break`)
}

// ── 7 · One broken section does not take the others down ───────────────
console.log('\n7  When one section cannot be produced')
{
  floor()
  // The Issue Tracker is a separate book; break it and the footage queue
  // fails while everything else still has what it needs.
  behaviour.broken = new Set(['Issues- Realtime!A:T'])
  const { code, body } = await call(tick, EMP)
  ok(code === 200, `the whole request failed (${code}) because one section did`)
  ok(body.clients && body.clients.clients.length > 0, 'the board was lost along with the footage queue')
  ok(body.shiftStatus && body.shiftStatus.status, 'the shift was lost along with the footage queue')
  ok(body.myDay && Array.isArray(body.myDay.timeline), 'the day was lost along with the footage queue')
  console.log(`   footage unavailable → board, day and shift all still answered`)
}

// ── 8 · Signing in elsewhere still ends this session ────────────────────
console.log('\n8  A session replaced on another laptop')
{
  floor()
  behaviour.data['Sessions!A:E'] = [
    ['EmpID','Name','SessionId','SignedInAt','Device'],
    ['E9', 'MANTU', 'a-different-session', `${TODAY} 09:00:00 am`, 'other laptop'],
  ]
  const req = { method: 'GET', query: {}, body: {},
                cookies: { cautio_token: signToken({ ...EMP, sid: 'my-session' }) }, headers: {} }
  let body = null, code = 200
  const res = { status(c) { code = c; return res }, json(p) { body = p; return res },
                end() { return res }, setHeader() { return res } }
  await tick(req, res)
  ok(code === 401, `the replaced session got ${code}, expected 401`)
  ok(body?.reason === 'session-replaced', `reason was "${body?.reason}"`)
  console.log(`   401 session-replaced — the page sends them to the login screen`)
}

// ── 9 · An admin is not given an employee's board ───────────────────────
console.log('\n9  An admin calling the employee poll')
{
  floor()
  const { code } = await call(tick, { name: 'Admin', role: 'admin', empId: 'A1' })
  ok(code === 200, `the tick answered ${code} for an admin`)
  console.log(`   answered without throwing`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
