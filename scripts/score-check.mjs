// The performance score, and the trend that was reading zero.
//
// ── The score ──────────────────────────────────────────────────────────
// Three parts, given as a requirement:
//
//   FOOTAGE   40 points — (my footage ÷ everybody's footage today) × 40
//   VEHICLES  60 points — min(vehicles seen ÷ 800, 1) × 60
//   BREAK    −20 points — if the day's total break runs past an hour
//
// ── The trend ──────────────────────────────────────────────────────────
// Reported from the floor as "mostly 0". It was built from CRM_Updates
// alone, and that tab only holds the last few days — a finished day is
// summarised into Daily_Summary. Measured on the live book: CRM_Updates held
// five days while the month asked for twenty-three, so eighteen points were
// zero. Daily_Summary now answers for the days the detail no longer covers.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/score-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')
const summary = (await import('../pages/api/dashboard/summary.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const p2 = (n) => String(n).padStart(2, '0')
const NOW = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const opDayOf = (d) => { const x = new Date(d); if (x.getHours() < 7) x.setDate(x.getDate() - 1); return `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}` }
const clockOf = (d) => { let h = d.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${p2(h)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${a}` }
const minsAgo = (m) => new Date(NOW.getTime() - m * 60000)
const daysAgo = (n) => { const x = new Date(NOW); x.setDate(x.getDate() - n); return opDayOf(x) }
const TODAY = opDayOf(NOW)
const H = NOW.getHours()
const SHIFT_START = (H + 21) % 24

const EMP = { name: 'Afzal', role: 'employee', empId: 'E1' }

// CRM_Updates: Date|Time|Emp|Client|Hour|Status|Mis|Alerts|Fatigue|FCount|Notes|Live
const upd = (date, client, hour, status, live) =>
  [date, '09:00:00 am', 'Afzal', client, String(hour), status, '', '0', 'No', '0', '', String(live)]
// Issue Tracker row: index 4 raisedAt, 7 raisedBy, 9 subRequest, 17 resolved
const issue = (by, date) => { const r = new Array(20).fill('')
  r[1] = 'ISS' + Math.random().toString(36).slice(2, 7); r[4] = `${date}, 09:14:00 am`
  r[7] = by; r[9] = 'Customer request for video'; r[17] = 'No'; return r }
const brk = (startMins, endMins, mins) =>
  ['E1', 'Afzal', TODAY, clockOf(minsAgo(startMins)), clockOf(minsAgo(endMins)), String(mins), 'Completed', 'Auto']

function floor({ updates = [], issues = [], breaks = [], daily = [] } = {}) {
  reset()
  ;['crm-book','source-book','issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  globalThis.__cautioSheets.vehicle = { data: null, at: 0 }
  globalThis.__cautioRoster = { lastGood: null }
  globalThis.__cautioHistory = { rows: null, at: 0 }
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ['E1','Afzal','x','employee',String(SHIFT_START),String((SHIFT_START + 9) % 24),'No','No']],
    'Client_Timings!A:B': [['Client','Hours'], ['Client A', String(H)]],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status','Seen'],
      ['E1','Afzal',TODAY, clockOf(minsAgo(180)), '', '', 'Active', clockOf(minsAgo(1))]],
    'CRM_Updates!A:L': [['Date','Time','Emp','Client','Hour','Status','Mis','Alerts','Fat','FC','Notes','Live'], ...updates],
    'Breaks!A:H': [['EmpID','Name','Date','Start','End','Mins','Status','Type'], ...breaks],
    'Leaves!A:H': [['EmpID','Name','Date','From','To','Reason','By','At']],
    'Shift_Overrides!A:H': [['EmpID','Name','Date','Start','End','Type','','']],
    'Redistribution_Log!A:G': [['Date','Time','From','To','Client','Hour','']],
    'Daily_Summary!A:N': [['Date','EmpID','Employee','Clients_Assigned','Clients_Completed',
      'Vehicles_Assigned','Vehicles_Checked','Alerts','Fatigue','Misaligns','Shift_Start','Shift_End','Break_Minutes','Source'], ...daily],
    'Monthly_History!A:J': [['Label','From','To','Employee','Clients','Completed','Pending','Vehicles','Monitored','Source']],
    'Footage_Followup!A:J': [['Date','Time','IssueId','Client','Veh','From','To','Status','','']],
    'Issues- Realtime!A:T': [new Array(20).fill('h'), ...issues],
    'Infants!A:B': [['Client','Vehicle']],
    'Others!A:B': [['Client','Vehicle'], ['Client A', 'KA01']],
    'Sessions!A:E': [['EmpID','Name','SessionId','SignedInAt','Device']],
  }
}

async function ask(query = { range: 'today' }) {
  const req = { method: 'GET', query, body: {}, cookies: { cautio_token: signToken(EMP) }, headers: {} }
  let body = null
  const res = { status() { return res }, json(p) { body = p; return res },
                end() { return res }, setHeader() { return res } }
  await summary(req, res)
  return body
}

// ── 1 · Vehicles: the 800 floor ────────────────────────────────────────
console.log('\n1  Vehicles seen, against a floor of 800')
{
  // 400 vehicles = half the target = 30 of the 60 points.
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 400)] })
  const half = await ask()
  ok(half.scoreBreakdown.vehicles.seen === 400, `${half.scoreBreakdown.vehicles.seen} vehicles counted, expected 400`)
  ok(half.scoreBreakdown.vehicles.points === 30, `${half.scoreBreakdown.vehicles.points} points for half the target, expected 30`)

  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 800)] })
  const full = await ask()
  ok(full.scoreBreakdown.vehicles.points === 60, `${full.scoreBreakdown.vehicles.points} points at the target, expected 60`)

  // Past the target earns no more — the sixty points are full.
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 3000)] })
  const over = await ask()
  ok(over.scoreBreakdown.vehicles.points === 60, `${over.scoreBreakdown.vehicles.points} points past the target, expected 60`)
  console.log(`   400 → 30 pts · 800 → 60 pts · 3000 → 60 pts (no extra credit)`)
}

// ── 2 · Footage: share of the day's requests ───────────────────────────
console.log('\n2  Footage, as a share of the whole day')
{
  // Ten requests today, four of them mine → 40% → 16 of the 40 points.
  const issues = [
    ...Array.from({ length: 4 }, () => issue('Afzal', TODAY)),
    ...Array.from({ length: 6 }, () => issue('Nesiya', TODAY)),
  ]
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 0)], issues })
  const s = await ask()
  const f = s.scoreBreakdown.footage
  ok(f.total === 10, `${f.total} footage requests counted for the day, expected 10`)
  ok(f.mine === 4, `${f.mine} of them mine, expected 4`)
  ok(f.sharePct === 40, `share read as ${f.sharePct}%, expected 40%`)
  ok(f.points === 16, `${f.points} points, expected 16`)
  console.log(`   4 of 10 requests → 40% → ${f.points} of 40 points`)
}

// ── 3 · A day with no footage at all is nobody's failure ───────────────
console.log('\n3  A day when no footage came in')
{
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 800)] })
  const s = await ask()
  ok(s.scoreBreakdown.footage.total === 0, 'there should be no footage today')
  ok(s.scoreBreakdown.footage.points === 40,
     `${s.scoreBreakdown.footage.points} points on a day with no footage — the whole floor would drop to 60 for a quiet morning`)
  ok(s.performanceScore === 100, `score ${s.performanceScore}, expected 100`)
  console.log(`   no footage anywhere → full 40 points, score ${s.performanceScore}`)
}

// ── 4 · Break past an hour costs twenty ────────────────────────────────
console.log('\n4  The break penalty')
{
  const done = [upd(TODAY, 'Client A', H, 'Completed', 800)]
  floor({ updates: done, breaks: [brk(90, 45, 45)] })          // 45 minutes
  const under = await ask()
  ok(under.scoreBreakdown.breakPenalty.applied === false, `45 minutes should not be penalised`)
  ok(under.performanceScore === 100, `score ${under.performanceScore} with a 45m break, expected 100`)

  floor({ updates: done, breaks: [brk(150, 60, 90)] })         // 90 minutes
  const over = await ask()
  ok(over.scoreBreakdown.breakPenalty.applied === true, `90 minutes should be penalised`)
  ok(over.scoreBreakdown.breakPenalty.minutes === 90, `${over.scoreBreakdown.breakPenalty.minutes} minutes counted, expected 90`)
  ok(over.performanceScore === 80, `score ${over.performanceScore} with a 90m break, expected 80`)
  console.log(`   45m → no penalty, score ${under.performanceScore} · 90m → −20, score ${over.performanceScore}`)
}

// ── 5 · The three parts add up, and the working is shown ───────────────
console.log('\n5  The whole score, and its working')
{
  const issues = [issue('Afzal', TODAY), issue('Nesiya', TODAY)]   // half of two
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 600)], issues, breaks: [brk(200, 100, 100)] })
  const s = await ask()
  const b = s.scoreBreakdown
  // footage 50% → 20 · vehicles 600/800 → 45 · break 100m → −20 · = 45
  ok(b.footage.points === 20,  `footage ${b.footage.points}, expected 20`)
  ok(b.vehicles.points === 45, `vehicles ${b.vehicles.points}, expected 45`)
  ok(b.breakPenalty.points === -20, `break ${b.breakPenalty.points}, expected -20`)
  ok(s.performanceScore === 45, `score ${s.performanceScore}, expected 45`)
  ok(b.total === s.performanceScore, 'the breakdown disagrees with the score it explains')
  ok(b.vehicles.target === 800, 'the target is not reported to the screen')
  console.log(`   20 + 45 − 20 = ${s.performanceScore} · every number returned for the screen to show`)
}

// ── 6 · The trend that read zero ───────────────────────────────────────
//
// A day whose detail has been summarised away must still appear. Two days
// ago has no CRM_Updates rows at all, only a Daily_Summary line.
console.log('\n6  A day that is only in Daily_Summary')
{
  const older = daysAgo(2)
  floor({
    updates: [upd(TODAY, 'Client A', H, 'Completed', 100)],
    daily: [[older, 'E1', 'Afzal', '40', '31', '500', '420', '2', '0', '1', '', '', '20', 'rollup']],
  })
  const s = await ask({ range: 'month' })
  const i = s.trend.labels.length - 3          // two days back, labels end at today
  ok(s.trend.completed[i] === 31,
     `the day held only in Daily_Summary reads ${s.trend.completed[i]} completed, expected 31 — this is the "trend shows 0"`)
  ok(s.trend.missed[i] === 9, `${s.trend.missed[i]} missed, expected 9 (40 assigned − 31 done)`)
  console.log(`   summarised day → ${s.trend.completed[i]} done / ${s.trend.missed[i]} missed, instead of 0`)
}

// ── 7 · The detail always wins over the summary ────────────────────────
console.log('\n7  A day that is in BOTH')
{
  floor({
    updates: [upd(TODAY, 'Client A', H, 'Completed', 100), upd(TODAY, 'Client B', H, 'Completed', 50)],
    // A summary line for today that disagrees — the detail must win.
    daily: [[TODAY, 'E1', 'Afzal', '999', '999', '0', '0', '0', '0', '0', '', '', '0', 'rollup']],
  })
  const s = await ask({ range: 'month' })
  const last = s.trend.completed.length - 1
  ok(s.trend.completed[last] === 2,
     `today reads ${s.trend.completed[last]} from the summary; the detail says 2 and the detail is the truth`)
  console.log(`   detail 2, summary 999 → trend shows ${s.trend.completed[last]}`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
