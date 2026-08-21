// The break that went invisible, and the six rows that piled up behind it.
//
// From the live Breaks tab, 21 August, EMP006 Rakesh:
//
//   02:37:03 pm → 09:06:08 pm   389   Completed   Auto
//   02:37:03 pm → 02:37:03 pm     0   Completed   Auto
//   02:37:03 pm → 09:06:08 pm   389   Completed   Auto
//   02:37:03 pm → 09:06:08 pm   389   Completed   Auto
//   02:37:03 pm → 09:06:08 pm   389   Completed   Auto
//   02:37:03 pm → 09:06:08 pm   389   Completed   Auto
//   03:05:37 pm → 03:16:35 pm    11   Completed   Auto      ← real
//   03:18:25 pm → 03:31:43 pm    13   Completed   Auto      ← real
//   … five more real breaks, taken and resumed normally …
//   08:24:47 pm → 09:05:39 pm    41   Completed   Auto      ← real
//
// Six and a half hours of "break" for a man who was at his desk working, with
// seven ordinary breaks sitting on top of a stretch he was supposedly away for.
//
// The chain, in order:
//
//   1. Two instances open the same automatic break. The start time is
//      backdated to the last activity, so the two rows are identical.
//   2. The duplicate sweep collapses the extra by writing END = START and
//      status Completed. That row now carries the SAME start time as the row
//      still running.
//   3. findOpenBreaks hid any Active row that had a Completed row with the
//      same start time. The real break became invisible — to Resume, to the
//      overlay, and to the idle sweep.
//   4. The idle sweep, reading "no open break", opened another one. And
//      another. All afternoon.
//   5. Ending the shift closed every Active row and credited each of them the
//      full 389 minutes.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/ghost-break-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')
const { setScheduleData } = await import('../lib/schedule.js')
const {
  findOpenBreaks, totalBreakMinutes, isSupersededBreak, sweepAutoBreaks,
} = await import('../lib/attendance.js')
const breakEnd    = (await import('../pages/api/break/end.js')).default
const breakStatus = (await import('../pages/api/break/status.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const p2 = (n) => String(n).padStart(2, '0')
const NOW = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const clockOf = (d) => { let h = d.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${p2(h)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${a}` }
const opDayOf = (d) => { const x = new Date(d); if (x.getHours() < 7) x.setDate(x.getDate() - 1); return `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}` }
const minsAgo = (m) => new Date(NOW.getTime() - m * 60000)
const TODAY = opDayOf(NOW)
const SHIFT_START = (NOW.getHours() + 21) % 24

const EMP = { name: 'Rakesh', role: 'employee', empId: 'EMP006' }
const HEAD = ['EmpID','Name','Date','Start','End','Mins','Status','Type']
// EmpID | Name | Date | Start | End | Mins | Status | Type
const brk = (startMins, endMins, mins, status, type = 'Auto') => [
  'EMP006', 'Rakesh', TODAY, clockOf(minsAgo(startMins)),
  endMins == null ? '' : clockOf(minsAgo(endMins)),
  mins == null ? '' : String(mins), status, type,
]

function floor(breakRows, { lastSeenMins = 1 } = {}) {
  reset()
  sheets.invalidateSheetCache('crm-book', '')
  if (globalThis.__cautioAttendance) {
    globalThis.__cautioAttendance.recentOpenings.clear()
    globalThis.__cautioAttendance.lastFloorSweep = Date.now()
  }
  setScheduleData({
    employees: [{ empId: 'EMP006', name: 'Rakesh', start: SHIFT_START, end: (SHIFT_START + 9) % 24, isNight: false }],
    timings: { 'Client A': [NOW.getHours()] },
    employeeHours: {},
  })
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ['EMP006','Rakesh','x','employee',String(SHIFT_START),String((SHIFT_START + 9) % 24),'No','No']],
    'Client_Timings!A:B': [['Client','Hours'], ['Client A', String(NOW.getHours())]],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status','Seen'],
      ['EMP006','Rakesh',TODAY, clockOf(minsAgo(400)), '', '', 'Active', clockOf(minsAgo(lastSeenMins))]],
    'CRM_Updates!A:L': [['Date','Time','Emp','Client','Hour','Status','','','','','','']],
    'Breaks!A:H': [HEAD, ...breakRows],
    'Shift_Overrides!A:H': [['EmpID','Name','Date','Start','End','Type','','']],
    'Sessions!A:E': [['EmpID','Name','SessionId','SignedInAt','Device']],
  }
}

async function call(handler, method = 'GET', query = {}) {
  const req = { method, query, body: {}, cookies: { cautio_token: signToken(EMP) }, headers: {} }
  let body = null, code = 200
  const res = { status(c) { code = c; return res }, json(p) { body = p; return res },
                end() { return res }, setHeader() { return res } }
  await handler(req, res)
  return { code, body }
}

const DATES = [TODAY, (() => { const y = new Date(NOW); y.setDate(y.getDate() - 1); return opDayOf(y) })()]

// ── 1 · A collapsed duplicate must not hide the real break ─────────────
//
// The exact shape step 2 leaves behind: one row still running, one row closed
// at its own start time. The running one must still be found.
console.log('\n1  A duplicate closed at its own start time')
{
  const rows = [
    brk(389, null, null, 'Active'),                 // the real break, still open
    brk(389, 389, 0, 'Duplicate — merged'),         // the collapsed twin
  ]
  const open = findOpenBreaks([HEAD, ...rows], 'EMP006', DATES)
  ok(open.length === 1, `the running break was hidden by its own collapsed twin — findOpenBreaks returned ${open.length}`)
  ok(open[0]?.startTime === clockOf(minsAgo(389)), 'the wrong row came back as the open one')

  // And the shape as it was written BEFORE this fix — status 'Completed'.
  const oldShape = [brk(389, null, null, 'Active'), brk(389, 389, 0, 'Completed')]
  const open2 = findOpenBreaks([HEAD, ...oldShape], 'EMP006', DATES)
  ok(open2.length === 1, `an Active row is still invisible when a Completed row shares its start time (${open2.length} found)`)
  console.log(`   Active row found alongside its collapsed twin, both shapes`)
}

// ── 2 · Resume closes it, and the employee is free ─────────────────────
console.log('\n2  Resume, with a ghost row present')
{
  floor([
    brk(389, null, null, 'Active'),
    brk(389, 389, 0, 'Duplicate — merged'),
    brk(30, 20, 10, 'Completed'),
  ])
  const before = await call(breakStatus)
  ok(before.body.onBreak === true, 'the employee is on a break and the overlay does not show it')

  floor([
    brk(389, null, null, 'Active'),
    brk(389, 389, 0, 'Duplicate — merged'),
    brk(30, 20, 10, 'Completed'),
  ])
  const r = await call(breakEnd, 'POST')
  ok(r.body?.success === true, `Resume answered ${JSON.stringify(r.body)}`)
  ok(calls.update.length >= 1, 'Resume wrote nothing — the break is still open')
  console.log(`   overlay shown, Resume closed it (${calls.update.length} rows written)`)
}

// ── 3 · An open break stops another being opened ───────────────────────
//
// Step 4 of the chain: the sweep read "no open break" and opened one more.
// With the real row visible again, it must not.
console.log('\n3  The idle sweep, with a break already running')
{
  floor([brk(389, null, null, 'Active'), brk(389, 389, 0, 'Duplicate — merged')],
        { lastSeenMins: 40 })                       // long past the threshold
  const created = await sweepAutoBreaks([{ empId: 'EMP006', name: 'Rakesh' }])
  ok(created.length === 0,
     `${created.length} more breaks opened for somebody who already has one running — this is how six rows piled up`)
  console.log(`   already on a break → the sweep opened ${created.length} more`)
}

// ── 4 · Ending the shift credits ONE break, not five ───────────────────
console.log('\n4  Ending a shift with five stale rows open')
{
  const rows = [
    brk(389, null, null, 'Active'),
    brk(389, null, null, 'Active'),
    brk(389, null, null, 'Active'),
    brk(389, null, null, 'Active'),
    brk(389, null, null, 'Active'),
  ]
  // What the old code did: every open row credited the full stretch.
  const oldTotal = rows.length * 389
  ok(oldTotal === 1945, 'sanity')

  // The rule now: the earliest is the break, the rest are duplicates at zero.
  const open = findOpenBreaks([HEAD, ...rows], 'EMP006', DATES)
  ok(open.length === 5, `${open.length} open rows found, expected 5`)
  const primary = open[open.length - 1]
  const credited = open.filter(b => b.rowIndex === primary.rowIndex).length
  ok(credited === 1, `${credited} rows would be credited the full duration, expected 1`)
  console.log(`   5 open rows → 1 credited, 4 marked duplicate (was ${oldTotal}m, now 389m)`)
}

// ── 5 · What the day actually totals ───────────────────────────────────
//
// The whole afternoon as the sheet held it, put back together the way the
// screens now read it.
console.log('\n5  Rakesh\'s afternoon, counted')
{
  const rows = [
    brk(389, 0, 389, 'Duplicate — merged'),
    brk(389, 389, 0, 'Duplicate — merged'),
    brk(389, 0, 389, 'Duplicate — merged'),
    brk(389, 0, 389, 'Duplicate — merged'),
    brk(389, 0, 389, 'Duplicate — merged'),
    brk(389, 0, 389, 'Completed'),              // the one real stretch… if it were real
    brk(360, 349, 11, 'Completed'),
    brk(347, 334, 13, 'Completed'),
    brk(300, 286, 14, 'Completed'),
  ]
  const dupes = rows.filter(isSupersededBreak).length
  ok(dupes === 5, `${dupes} rows recognised as duplicates, expected 5`)

  // Only the real breaks count. The stretch that swallowed the afternoon is
  // one row now, not six — and the union stops even that being added six times.
  const mins = totalBreakMinutes([HEAD, ...rows], 'EMP006', DATES)
  ok(mins <= 389 + 40, `the day totals ${mins}m — the duplicates are still being counted`)
  console.log(`   9 rows, ${dupes} duplicates → ${mins}m total (the sheet read 6h 29m)`)
}

// ── 6 · The leftover row after a genuine Resume is CLOSED ──────────────
//
// The other half of the problem, and the one the night shift reported.
// Resume closes what it can see; a duplicate appended a second earlier by
// another instance is not in the copy it read, and stays Active. The overlay
// comes back, they press Resume again, it comes back again.
//
// Hiding it — which is what used to happen — left the sheet wrong and is what
// caused everything above. It is closed instead, within one sweep.
console.log('\n6  A row left Active after the break was genuinely resumed')
{
  floor([
    brk(50, 39, 11, 'Completed'),                // resumed properly: real end, real minutes
    brk(50, null, null, 'Active'),               // the twin Resume never saw
  ], { lastSeenMins: 1 })

  const before = findOpenBreaks(
    [HEAD, brk(50, 39, 11, 'Completed'), brk(50, null, null, 'Active')], 'EMP006', DATES)
  ok(before.length === 1, 'the leftover row should be visible so that it can be closed')

  await sweepAutoBreaks([{ empId: 'EMP006', name: 'Rakesh' }])
  ok(calls.update.length >= 1, 'the sweep left the row Active — the employee stays stuck behind the overlay')
  const wrote = calls.update.length
  console.log(`   leftover row found and settled by the sweep (${wrote} row written)`)
}

// ── 7 · A collapsed duplicate is NOT read as "the break ended" ─────────
//
// The distinction the whole fix turns on. A twin closed at its own start
// time, zero minutes, says nothing about whether the break ended — it is a
// duplicate that was merged. Treating it as a resume is what made the real
// break vanish.
console.log('\n7  Telling a merged duplicate from a real resume')
{
  floor([
    brk(200, null, null, 'Active'),                     // the real break, running
    brk(200, 200, 0, 'Duplicate — merged'),             // merged twin, end == start
  ], { lastSeenMins: 1 })

  await sweepAutoBreaks([{ empId: 'EMP006', name: 'Rakesh' }])
  ok(calls.update.length === 0,
     `the running break was settled as though it had been resumed (${calls.update.length} rows written)`)
  const st = await call(breakStatus)
  ok(st.body?.onBreak === true, 'the employee is on a break and the platform says they are not')
  console.log(`   merged twin ignored, the running break left alone and still shown`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
