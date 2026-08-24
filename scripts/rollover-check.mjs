// Seven in the morning: what starts again, and what must not carry over.
//
// The operating day runs 07:00 to 07:00. At seven the whole floor starts a
// fresh day — a new board, a fresh hour strip, a fresh score — and anything
// that quietly carries yesterday's figure into it is wrong in a way nobody
// would spot for weeks, because the number looks plausible all morning.
//
// Every date column in these sheets holds the operating day, so almost
// everything resets simply by being filtered on it. The exceptions are the
// places that deliberately look at TWO days — and they do that for a real
// reason: a shift that runs past 07:00 files its breaks under the new day
// while its shift row still carries the old one, and a break opened at 06:50
// is still running at 07:10.
//
// The distinction this file holds:
//
//   FINDING an open break must look at both days, or a break opened at 06:50
//   becomes invisible at 07:10 and can never be closed.
//
//   TOTALLING today's break must not. "Break time today" is today's.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/rollover-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')
const { totalBreakMinutes, findOpenBreaks } = await import('../lib/attendance.js')
const { computeDayPlan, staleClientsFrom } = await import('../lib/dayplan.js')
const { setScheduleData } = await import('../lib/schedule.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const YESTERDAY = '22/08/2026'
const TODAY     = '23/08/2026'
const HEAD = ['EmpID','Name','Date','Start','End','Mins','Status','Type']
const brk = (date, start, end, mins, status = 'Completed') =>
  ['E1', 'Sunil', date, start, end, mins == null ? '' : String(mins), status, 'Auto']

// ── 1 · Yesterday's break is not today's break ─────────────────────────
//
// Somebody was away for 95 minutes yesterday and 20 minutes today. At any
// point today their "Break time today" is twenty.
console.log('\n1  Break time today, the morning after a long day')
{
  const rows = [
    HEAD,
    brk(YESTERDAY, '11:00:00 am', '12:35:00 pm', 95),
    brk(TODAY,     '09:00:00 am', '09:20:00 am', 20),
  ]
  const todayOnly = totalBreakMinutes(rows, 'E1', [TODAY])
  ok(todayOnly === 20, `today reads ${todayOnly} minutes, expected 20`)

  const bothDays = totalBreakMinutes(rows, 'E1', [TODAY, YESTERDAY])
  ok(bothDays === 115, `sanity: both days together are ${bothDays}, expected 115`)
  ok(todayOnly !== bothDays,
     'yesterday is being added to today — "Break time today" would open the morning at 1h 55m')
  console.log(`   yesterday 95m + today 20m → today reads ${todayOnly}m, not ${bothDays}m`)
}

// ── 2 · A break running THROUGH seven o'clock ──────────────────────────
//
// The reason the open-break lookup covers both days, and why the total must
// not. Opened at 06:50 under yesterday's operating day; at 07:10 it is still
// the break the employee is sitting in.
console.log('\n2  A break opened at 06:50, looked for at 07:10')
{
  const rows = [HEAD, brk(YESTERDAY, '06:50:00 am', '', null, 'Active')]
  const open = findOpenBreaks(rows, 'E1', [TODAY, YESTERDAY])
  ok(open.length === 1, `the break running through seven was not found (${open.length})`)

  const onlyToday = findOpenBreaks(rows, 'E1', [TODAY])
  ok(onlyToday.length === 0,
     'sanity: searching today alone cannot see it — which is why the lookup covers both')
  console.log(`   found across both days · invisible if only today is searched`)
}

// ── 3 · The day's work starts again ────────────────────────────────────
//
// A plan for today never sees yesterday's rows, whatever hour it is asked
// about — every row carries its own operating day.
console.log('\n3  Yesterday\'s updates do not count towards today')
{
  const PEOPLE = [{ empId: 'E1', name: 'Sunil', start: 7, end: 16, isNight: false }]
  setScheduleData({ employees: PEOPLE, timings: { 'Zingbus': [8], 'Shatabdi': [8] }, employeeHours: {} })
  const shiftRows = [['h'], ['E1', 'Sunil', TODAY, '07:02:00 am', '', '', 'Active', '']]
  const upd = (date, client) =>
    [date, '08:10:00 am', 'Sunil', client, '8', 'No Misalignment', '', '0', 'No', '0', '', '5']

  const plan = computeDayPlan({
    date: TODAY, today: TODAY, nowHour: 11,
    shiftRows,
    // Both clients were done YESTERDAY. Today has nothing.
    updateRows: [['h'], upd(YESTERDAY, 'Zingbus'), upd(YESTERDAY, 'Shatabdi')],
    breakRows: [['h']], leaveMap: {}, overridesMap: {},
    vehicleMap: { zingbus: { vehicleCount: 261 }, shatabdi: { vehicleCount: 4 } },
    weekOffNames: new Set(),
  })
  const h8 = plan.hours.find(h => h.hour === 8)
  ok(h8 && h8.done === 0, `${h8?.done} clients counted as done today from yesterday's rows`)
  ok(h8 && h8.dueCount === 2, `${h8?.dueCount} due today, expected 2`)

  // And both are back on the "still not updated" list, because today nobody
  // has filled them.
  const stale = staleClientsFrom(plan, 11).map(c => c.client).sort()
  ok(stale.length === 2, `${stale.length} clients still waiting today, expected 2: ${stale.join(', ')}`)
  console.log(`   done yesterday, untouched today → ${h8.done}/${h8.dueCount} done, both back on the list`)
}

// ── 4 · At seven o'clock nothing is late yet ───────────────────────────
//
// The list only counts hours that have FINISHED. At 07:00 the operating day
// has none, so it is empty — and it fills up again as the morning goes on.
console.log('\n4  The list at seven, and at eleven')
{
  const PEOPLE = [{ empId: 'E1', name: 'Sunil', start: 7, end: 16, isNight: false }]
  setScheduleData({ employees: PEOPLE, timings: { 'Zingbus': [7, 8, 9] }, employeeHours: {} })
  const shiftRows = [['h'], ['E1', 'Sunil', TODAY, '07:02:00 am', '', '', 'Active', '']]
  const planAt = (nowHour) => computeDayPlan({
    date: TODAY, today: TODAY, nowHour,
    shiftRows, updateRows: [['h']], breakRows: [['h']],
    leaveMap: {}, overridesMap: {}, vehicleMap: { zingbus: { vehicleCount: 261 } },
    weekOffNames: new Set(),
  })

  const atSeven = staleClientsFrom(planAt(7), 7)
  ok(atSeven.length === 0, `${atSeven.length} clients called late at seven in the morning`)

  const atEleven = staleClientsFrom(planAt(11), 11)
  ok(atEleven.length === 1, `${atEleven.length} clients waiting by eleven, expected 1`)
  ok(atEleven[0]?.pending === 3, `${atEleven[0]?.pending} slots missed by eleven, expected 3`)
  console.log(`   07:00 → ${atSeven.length} waiting · 11:00 → ${atEleven.length} waiting, ${atEleven[0].pending} slots`)
}

// ── 5 · The endpoint the employee's screen actually reads ──────────────
//
// Everything above proves the LIBRARY resets when it is handed the right
// day. That is not the same as the screen resetting, and the difference is
// where the bug was: break/status and dashboard/summary were both handing
// totalBreakMinutes TWO days, so yesterday's minutes were added to today's
// and "Break time today" opened the new morning already showing an hour and
// a half. The library was right the whole time; its callers were not.
//
// endpoint-snapshot cannot catch this — it masks totalMinutesToday as
// <drifts>, because the figure moves by a minute between two runs while an
// open break is running. So the endpoint is driven directly here.
console.log('\n5  What /api/break/status reports the morning after')
{
  const clock = () => {
    const x = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    return x
  }
  const now = clock()
  const p2 = (n) => String(n).padStart(2, '0')
  const dstr = (x) => `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}`
  const hhmm = (x) => { let h = x.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12
    return `${p2(h)}:${p2(x.getMinutes())}:${p2(x.getSeconds())} ${a}` }
  const minsAgo = (m) => new Date(now.getTime() - m * 60000)

  // The operating day, not the calendar date — every date column holds it.
  const opToday = (() => { const x = new Date(now); if (x.getHours() < 7) x.setDate(x.getDate() - 1); return dstr(x) })()
  const opYest  = (() => { const x = new Date(now); if (x.getHours() < 7) x.setDate(x.getDate() - 1)
    x.setDate(x.getDate() - 1); return dstr(x) })()

  reset()
  ;['crm-book','source-book','issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  if (globalThis.__cautioAttendance) {
    globalThis.__cautioAttendance.recentOpenings.clear()
    globalThis.__cautioAttendance.lastFloorSweep = Date.now()
  }
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ['E1','Sunil','x','employee','7','16','No','No']],
    // At least one real client: the roster refuses to load with an empty
    // timings tab, and the score reads the day's plan.
    'Client_Timings!A:B': [['Client','Hours'], ['Zingbus','8']],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status','Seen'],
      ['E1','Sunil',opToday, hhmm(minsAgo(120)), '', '', 'Active', hhmm(minsAgo(1))]],
    'CRM_Updates!A:L': [['Date','Time','Emp','Client','Hour','Status','Mis','Alerts','Fatigue','FCount','Notes','Live']],
    'Breaks!A:H': [['EmpID','Name','Date','Start','End','Mins','Status','Type'],
      // A long stretch away YESTERDAY, and a short one today.
      ['E1','Sunil',opYest, '11:00:00 am','12:35:00 pm','95','Completed','Manual'],
      ['E1','Sunil',opToday, hhmm(minsAgo(60)), hhmm(minsAgo(40)),'20','Completed','Manual']],
    'Leaves!A:H': [['EmpID','Name','Date','From','To','Reason','By','At']],
    'Shift_Overrides!A:H': [['EmpID','Name','Date','Start','End','Type','','']],
    'Redistribution_Log!A:G': [['Date','Time','From','To','Client','Hour','']],
    'Daily_Summary!A:N': [['Date','Employee']],
    'Monthly_History!A:J': [['Label','From','To','Employee','Clients','Completed','Pending','Vehicles','Monitored','Source']],
    'Footage_Followup!A:J': [['Date','Time','IssueId','Client','Veh','From','To','Status','','']],
    'Issues- Realtime!A:T': [new Array(20).fill('h')],
    'Infants!A:B': [['Client','Vehicle']],
    'Others!A:B': [['Client','Vehicle']],
    'Sessions!A:E': [['EmpID','Name','SessionId','SignedInAt','Device']],
  }

  const handler = (await import('../pages/api/break/status.js')).default
  const req = { method:'GET', query:{}, body:{},
                cookies:{ cautio_token: signToken({ name:'Sunil', role:'employee', empId:'E1' }) },
                headers:{} }
  let body = null
  const res = { status(){ return res }, json(p){ body = p; return res },
                end(){ return res }, setHeader(){ return res } }
  await handler(req, res)

  ok(body != null, 'break/status returned nothing')
  ok(body?.totalMinutesToday === 20,
     `the screen reports ${body?.totalMinutesToday} minutes away today, expected 20 — ` +
     `yesterday's 95 are being carried into the new morning`)
  console.log(`   yesterday 95m on the sheet · the screen says ${body?.totalMinutesToday}m today`)

  // ── The same day, scored ─────────────────────────────────────────────
  //
  // The score docks twenty points for more than an hour away. 95 + 20 is
  // over the hour and 20 alone is well under it, so the identical fault in
  // summary.js took twenty points off this morning's score for time spent
  // away on a day that had already finished — the worst kind of wrong
  // number, because it is plausible and it is somebody's appraisal.
  const sumHandler = (await import('../pages/api/dashboard/summary.js')).default
  const sreq = { method:'GET', query:{ range:'today' }, body:{},
                 cookies:{ cautio_token: signToken({ name:'Sunil', role:'employee', empId:'E1' }) },
                 headers:{} }
  let sbody = null
  const sres = { status(){ return sres }, json(p){ sbody = p; return sres },
                 end(){ return sres }, setHeader(){ return sres } }
  await sumHandler(sreq, sres)

  const bp = sbody?.scoreBreakdown?.breakPenalty
  ok(bp != null, 'the score came back with no break-penalty working')
  ok(bp?.minutes === 20,
     `the score counts ${bp?.minutes} minutes away today, expected 20`)
  ok(bp?.applied === false,
     'twenty points docked this morning for a break taken yesterday')
  console.log(`   score counts ${bp?.minutes}m away → penalty ${bp?.applied ? 'applied' : 'not applied'}`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
