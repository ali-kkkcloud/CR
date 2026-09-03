// The performance score, and the trend that was reading zero.
//
// ── The score ──────────────────────────────────────────────────────────
// Three parts, given as a requirement:
//
//   FOOTAGE    5 points a request — uncapped, and nothing lost for raising none
//   VEHICLES  70 points — min(vehicles seen ÷ 800, 1) × 70
//   BREAK    −20 points — if the day's total break runs past an hour
//
// Footage used to be 40 points of SHARE — mine divided by the whole floor's.
// Share is zero-sum, so two people doing identical work scored differently
// depending on how busy everybody else was, a busy day for the floor pushed
// every individual score down, and a morning with no requests at all was
// undefined and therefore scored in FULL. Counting the requests themselves
// removes all three faults, and the checks below pin each of them.
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
// Where a given operating day sits in the trend.
//
// NOT "the last point". The trend's labels are CALENDAR days, and between
// midnight and seven the operating day is the calendar day before — so
// assuming today is the last point made this file pass in the afternoon and
// fail at one in the morning, which is the exact hour a night shift is using
// it. Found by the label the endpoint actually builds.
const labelFor = (opDayStr) => {
  const [d, m, y] = opDayStr.split('/').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
const pointFor = (trend, opDayStr) => trend.labels.indexOf(labelFor(opDayStr))
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

// ── 1 · Vehicles: the 800 floor, now worth 70 ──────────────────────────
console.log('\n1  Vehicles seen, against a floor of 800')
{
  // 400 vehicles = half the target = 35 of the 70 points.
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 400)] })
  const half = await ask()
  ok(half.scoreBreakdown.vehicles.seen === 400, `${half.scoreBreakdown.vehicles.seen} vehicles counted, expected 400`)
  ok(half.scoreBreakdown.vehicles.points === 35, `${half.scoreBreakdown.vehicles.points} points for half the target, expected 35`)
  ok(half.scoreBreakdown.vehicles.weight === 70, `vehicles weight reported as ${half.scoreBreakdown.vehicles.weight}, expected 70`)

  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 800)] })
  const full = await ask()
  ok(full.scoreBreakdown.vehicles.points === 70, `${full.scoreBreakdown.vehicles.points} points at the target, expected 70`)

  // Past the target earns no more — the seventy points are full.
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 3000)] })
  const over = await ask()
  ok(over.scoreBreakdown.vehicles.points === 70, `${over.scoreBreakdown.vehicles.points} points past the target, expected 70`)
  console.log(`   400 → 35 pts · 800 → 70 pts · 3000 → 70 pts (no extra credit)`)
}

// ── 2 · Footage: five a request, and only mine ─────────────────────────
console.log('\n2  Footage, counted one request at a time')
{
  // Four mine and six somebody else's. Under the old rule that was a 40%
  // share worth 16; now the other six are none of my business and my four
  // are worth 20.
  const issues = [
    ...Array.from({ length: 4 }, () => issue('Afzal', TODAY)),
    ...Array.from({ length: 6 }, () => issue('Nesiya', TODAY)),
  ]
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 0)], issues })
  const s = await ask()
  const f = s.scoreBreakdown.footage
  ok(f.count === 4, `${f.count} of my requests counted, expected 4`)
  ok(f.perRequest === 5, `${f.perRequest} points a request, expected 5`)
  ok(f.points === 20, `${f.points} points, expected 20`)
  ok(f.total === undefined && f.sharePct === undefined,
     'the floor total and the share are still being reported — they no longer mean anything')
  console.log(`   4 raised × 5 = ${f.points}, and the floor's other 6 change nothing`)

  // The zero-sum fault, pinned: the SAME four requests must score the same
  // whether the rest of the floor was busy or idle.
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 0)],
          issues: Array.from({ length: 4 }, () => issue('Afzal', TODAY)) })
  const alone = await ask()
  ok(alone.scoreBreakdown.footage.points === 20,
     `same four requests scored ${alone.scoreBreakdown.footage.points} on a quiet floor and 20 on a busy one`)
  console.log('   a busy floor no longer pushes everybody else down')
}

// ── 3 · Raising none costs nothing, and earns nothing ──────────────────
//
// The old rule scored an undefined share IN FULL, so a quiet morning handed
// forty points to people who had raised nothing. The requirement is the plain
// reading: do one and you are five better off, do none and nothing happens.
console.log('\n3  A day when no footage came in')
{
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 800)] })
  const s = await ask()
  ok(s.scoreBreakdown.footage.count === 0, 'there should be no footage today')
  ok(s.scoreBreakdown.footage.points === 0,
     `${s.scoreBreakdown.footage.points} points for raising nothing — that is the old free-marks bug`)
  ok(s.performanceScore === 70, `score ${s.performanceScore}, expected 70 — the vehicles alone`)
  console.log(`   no footage → 0 points, nothing taken off, score ${s.performanceScore}`)
}

// ── 3b · Uncapped, as asked for ────────────────────────────────────────
console.log('\n3b Every further request is another five')
{
  const { computeScore } = await import('../lib/score.js')
  ok(computeScore({ footageCount: 1 }).breakdown.footage.points === 5,  'one request should be 5')
  ok(computeScore({ footageCount: 6 }).breakdown.footage.points === 30, 'six requests should be 30')
  ok(computeScore({ footageCount: 14 }).breakdown.footage.points === 70,
     'fourteen requests should be 70 — footage itself has no ceiling')
  // The only ceiling is the score's own.
  ok(computeScore({ footageCount: 40, vehiclesSeen: 800 }).score === 100,
     'the score itself must still stop at 100')
  ok(computeScore({ footageCount: 0, vehiclesSeen: 0, breakMinutes: 200 }).score === 0,
     'and must never go below 0')
  console.log('   1 → 5 · 6 → 30 · 14 → 70 · score still clamped to 0…100')
}

// ── 4 · Break past an hour costs twenty ────────────────────────────────
console.log('\n4  The break penalty')
{
  const done = [upd(TODAY, 'Client A', H, 'Completed', 800)]
  floor({ updates: done, breaks: [brk(90, 45, 45)] })          // 45 minutes
  const under = await ask()
  ok(under.scoreBreakdown.breakPenalty.applied === false, `45 minutes should not be penalised`)
  ok(under.performanceScore === 70, `score ${under.performanceScore} with a 45m break, expected 70`)

  floor({ updates: done, breaks: [brk(150, 60, 90)] })         // 90 minutes
  const over = await ask()
  ok(over.scoreBreakdown.breakPenalty.applied === true, `90 minutes should be penalised`)
  ok(over.scoreBreakdown.breakPenalty.minutes === 90, `${over.scoreBreakdown.breakPenalty.minutes} minutes counted, expected 90`)
  ok(over.performanceScore === 50, `score ${over.performanceScore} with a 90m break, expected 50`)
  console.log(`   45m → no penalty, score ${under.performanceScore} · 90m → −20, score ${over.performanceScore}`)
}

// ── 5 · The three parts add up, and the working is shown ───────────────
console.log('\n5  The whole score, and its working')
{
  const issues = [issue('Afzal', TODAY), issue('Nesiya', TODAY)]   // one mine, one not
  floor({ updates: [upd(TODAY, 'Client A', H, 'Completed', 600)], issues, breaks: [brk(200, 100, 100)] })
  const s = await ask()
  const b = s.scoreBreakdown
  // footage 1 × 5 → 5 · vehicles 600/800 → 52.5 · break 100m → −20 · = 38
  ok(b.footage.points === 5,     `footage ${b.footage.points}, expected 5`)
  ok(b.vehicles.points === 52.5, `vehicles ${b.vehicles.points}, expected 52.5`)
  ok(b.breakPenalty.points === -20, `break ${b.breakPenalty.points}, expected -20`)
  ok(s.performanceScore === 38, `score ${s.performanceScore}, expected 38`)
  ok(b.total === s.performanceScore, 'the breakdown disagrees with the score it explains')
  ok(b.vehicles.target === 800, 'the target is not reported to the screen')
  console.log(`   5 + 52.5 − 20 = ${s.performanceScore} · every number returned for the screen to show`)
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
  const i = pointFor(s.trend, older)
  ok(i >= 0, `the day ${older} is not in the trend at all`)
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
  const i = pointFor(s.trend, TODAY)
  ok(i >= 0, `today (${TODAY}) is not in the trend at all`)
  ok(s.trend.completed[i] === 2,
     `today reads ${s.trend.completed[i]} from the summary; the detail says 2 and the detail is the truth`)
  ok(!s.trend.completed.includes(999), 'the summary overwrote a day the detail still holds')
  console.log(`   detail 2, summary 999 → trend shows ${s.trend.completed[i]}`)
}

// ── 8 · A night shift's footage, raised after midnight ─────────────────
//
// The Issue Tracker stamps a request with the calendar moment it was raised.
// A night shift's operating day does NOT roll at midnight, so a request
// raised at 01:14 carries tomorrow's calendar date while belonging to the
// shift that began last evening.
//
// Compared directly, such a request counted for nobody: it was missing from
// the day's footage total AND from the employee's own share, so a night
// shift's score was worked out from a number that did not include their work.
console.log('\n8  Footage raised after midnight, on a night shift')
{
  // Yesterday's operating day, with a request stamped with TODAY's calendar
  // date at 01:14 am — which is what the tracker really writes at that hour.
  const opDay = TODAY
  // 01:14 am on operating day TODAY falls on the CALENDAR day after it —
  // derived from the operating day itself, not from the clock, or this only
  // holds when the test happens to run before seven in the morning.
  const tomorrowCal = (() => {
    const [d, m, y] = TODAY.split('/').map(Number)
    const x = new Date(y, m - 1, d); x.setDate(x.getDate() + 1)
    return `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}`
  })()
  const afterMidnight = (by) => { const r = new Array(20).fill('')
    r[1] = 'ISS' + Math.random().toString(36).slice(2, 7)
    r[4] = `${tomorrowCal}, 01:14:00 am`
    r[7] = by; r[9] = 'Customer request for video'; r[17] = 'No'; return r }

  floor({
    updates: [upd(opDay, 'Client A', H, 'Completed', 400)],
    issues: [afterMidnight('Afzal'), afterMidnight('Nesiya')],
  })
  const s = await ask()
  const f = s.scoreBreakdown.footage
  ok(f.count === 1, `${f.count} of my requests counted for the operating day, expected 1 — one raised after midnight was dropped`)
  ok(f.points === 5, `${f.points} points, expected 5`)
  console.log(`   raised ${tomorrowCal} 01:14 am → counted under operating day ${opDay}: ${f.count} × 5 = ${f.points}`)
}


// ── The night shift that has gone home ─────────────────────────────────
//
// Reported: at eight in the morning the night shift's cards were still on
// today's board, carrying a score. Two things were wrong at once.
//
// Their work belongs to the operating day their shift BEGAN — a shift that
// ran 22:00 to 07:00 is filed under yesterday — so once seven passes they
// have done nothing today. Under the old share rule the card was not even
// empty: an undefined share scored IN FULL, so somebody who had gone home
// showed forty free points. Counting requests has retired that particular
// flattery — the free points are now zero — but a card for a day somebody
// did not work is still a number about nothing, so the filter stays and is
// checked here.
console.log('\n9  The night shift, after seven in the morning')
{
  const { whoWorkedOn, computeScore } = await import('../lib/score.js')
  const TODAY = '24/08/2026', YESTERDAY = '23/08/2026'
  const H = ['h']

  // CHANDAN worked 22:00 → 07:00; his row and his updates are dated
  // yesterday. Sunil is on the day shift and clocked in this morning.
  const shiftRows = [H,
    ['E3','CHANDAN', YESTERDAY, '09:58:00 pm', '07:01:00 am', '9h 3m', 'Ended', ''],
    ['E1','Sunil',   TODAY,     '07:04:00 am', '',            '',      'Active', ''],
  ]
  const updateRows = [H,
    [YESTERDAY,'11:20:00 pm','CHANDAN','Zingbus','23','No Misalignment','','0','No','0','','120'],
    [TODAY,    '07:40:00 am','Sunil',  'Zingbus','7', 'No Misalignment','','0','No','0','','30'],
  ]

  const todaysPeople = whoWorkedOn(TODAY, shiftRows, updateRows)
  ok(!todaysPeople.has('CHANDAN'),
     'the night shift that ended at 07:01 is still counted as working today')
  ok(todaysPeople.has('Sunil'), 'the day shift that clocked in at 07:04 is missing from today')

  // And they ARE on the day they actually worked.
  const yesterdaysPeople = whoWorkedOn(YESTERDAY, shiftRows, updateRows)
  ok(yesterdaysPeople.has('CHANDAN'), "the night shift is missing from the day it actually worked")

  // Nothing done at all now scores nothing at all — the free forty is gone
  // with the share it came from.
  const free = computeScore({ footageCount: 0, vehiclesSeen: 0, breakMinutes: 0 })
  ok(free.breakdown.footage.points === 0,
     `a day with nothing raised should score 0 for footage, got ${free.breakdown.footage.points}`)
  ok(free.score === 0, `a day with nothing done should score 0, got ${free.score}`)
  console.log(`   CHANDAN filed under ${YESTERDAY}, off today's board ` +
              `· and an empty day is now worth ${free.score}, not a free 40`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
