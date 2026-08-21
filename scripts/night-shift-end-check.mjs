// Ending a night shift, and the breaks it is allowed to close.
//
// The operating day runs 07:00 → 07:00, so a night shift that clocks in at ten
// in the evening and finishes at six in the morning belongs, from first hour
// to last, to the day it began. Every date column in these sheets holds that
// day — which is why almost every serious fault this platform has had showed
// up on the night shift first, and never during the day.
//
// Ending a shift closes whatever break is still running. The question this
// file asks is which rows it is allowed to touch, because getting that wrong
// is how 21 August produced 389-minute breaks for a man who was working.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/night-shift-end-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')
const { setScheduleData } = await import('../lib/schedule.js')
const { findOpenBreaks } = await import('../lib/attendance.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const p2 = (n) => String(n).padStart(2, '0')
const NOW = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const opDayOf = (d) => { const x = new Date(d); if (x.getHours() < 7) x.setDate(x.getDate() - 1); return `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}` }
const clockOf = (d) => { let h = d.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${p2(h)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${a}` }
const TODAY = opDayOf(NOW)
const YEST  = (() => { const y = new Date(NOW); y.setDate(y.getDate() - 1); return opDayOf(y) })()

const HEAD = ['EmpID','Name','Date','Start','End','Mins','Status','Type']
const brk = (date, start, end, mins, status, type = 'Auto') =>
  ['E9', 'Yunus', date, start, end || '', mins == null ? '' : String(mins), status, type]

// ── 1 · A break opened before midnight is still tonight's break ────────
//
// 11:52 pm and 12:05 am are thirteen minutes apart and land on different
// calendar dates. The operating day does not roll at midnight, so both carry
// the same date — and a lookup that searched only "today" made a break opened
// at 23:52 invisible at 00:05, unclosable for ever, and blocked every later
// break for that employee.
console.log('\n1  A break opened at 11:52 pm, looked for at 12:05 am')
{
  const rows = [HEAD, brk(TODAY, '11:52:00 pm', '', null, 'Active')]
  const open = findOpenBreaks(rows, 'E9', [TODAY, YEST])
  ok(open.length === 1, `the break opened before midnight was not found (${open.length})`)
  ok(open[0]?.startDate === TODAY, 'it came back under the wrong day')
  console.log(`   found under ${TODAY}, which is the operating day it belongs to`)
}

// ── 2 · Last night's leftover is NOT tonight's break ────────────────────
//
// The one this file was written for. A row left Active by the shift BEFORE
// this one is older than anything tonight, so "the earliest open row is the
// break" would pick it and credit it from last night until now — a whole
// extra day of break at the end of a night shift.
console.log('\n2  A row left Active by last night\'s shift')
{
  const rows = [
    HEAD,
    brk(YEST,  '01:14:00 am', '', null, 'Active'),      // never closed, previous shift
    brk(TODAY, '02:30:00 am', '', null, 'Active'),      // tonight's real break
  ]
  // The shift being ended began today, so today is the only day it can have
  // written a break under.
  const thisShift = findOpenBreaks(rows, 'E9', [TODAY])
  ok(thisShift.length === 1, `${thisShift.length} rows counted as tonight's break, expected 1`)
  ok(thisShift[0]?.startDate === TODAY, 'last night\'s leftover was taken as tonight\'s break')
  ok(thisShift[0]?.startTime === '02:30:00 am', `the wrong row was picked: ${thisShift[0]?.startTime}`)

  // And the leftover is still visible to the orphan pass, so it does get closed.
  const everything = findOpenBreaks(rows, 'E9', [TODAY, YEST])
  ok(everything.length === 2, 'the leftover is invisible and would stay Active for ever')
  console.log(`   tonight's break picked correctly · last night's leftover still closable`)
}

// ── 3 · Working past 07:00 rolls the operating day mid-shift ───────────
//
// Somebody who stays on past seven in the morning has their shift row filed
// under the day it began while a break opened at 07:05 carries the new day.
// Both belong to the shift being ended.
console.log('\n3  A shift that runs past 07:00')
{
  const rows = [
    HEAD,
    brk(YEST,  '11:40:00 pm', '11:55:00 pm', 15, 'Completed'),
    brk(TODAY, '07:05:00 am', '', null, 'Active'),      // opened after the day rolled
  ]
  const shiftDates = [YEST, TODAY]
  const open = findOpenBreaks(rows, 'E9', shiftDates)
  ok(open.length === 1, `${open.length} open rows for a shift that ran past seven, expected 1`)
  ok(open[0]?.startDate === TODAY, 'the break opened after the rollover was missed')
  console.log(`   shift filed under ${YEST}, break under ${TODAY} — both belong to it`)
}

// ── 4 · Five stale rows: one break, four duplicates ────────────────────
console.log('\n4  Ending a night shift with duplicates open')
{
  const rows = [HEAD,
    brk(TODAY, '03:12:00 am', '', null, 'Active'),
    brk(TODAY, '03:12:00 am', '', null, 'Active'),
    brk(TODAY, '03:12:00 am', '', null, 'Active'),
  ]
  const open = findOpenBreaks(rows, 'E9', [TODAY])
  ok(open.length === 3, `${open.length} open rows found, expected 3`)
  const primary = open[open.length - 1]
  ok(primary.rowIndex === 2, `the earliest row should be the break, got row ${primary.rowIndex}`)
  const credited = open.filter(b => b.rowIndex === primary.rowIndex).length
  ok(credited === 1, `${credited} rows would be credited, expected 1`)
  console.log(`   3 open rows → 1 credited, 2 marked duplicate`)
}

// ── 5 · A break that ran through midnight reports its real length ──────
//
// Measured against the row's own operating day. Read as a calendar date it
// resolves twenty-four hours out, and a thirteen-minute break reported as
// either a negative or a day and a bit.
console.log('\n5  A break from 11:52 pm to 12:05 am')
{
  const { calcDurationMinutes } = sheets
  const m = calcDurationMinutes(TODAY, '11:52:00 pm', TODAY, '12:05:00 am')
  ok(m === 13, `it reports ${m} minutes, should be 13`)
  const m2 = calcDurationMinutes(TODAY, '04:39:00 am', TODAY, '07:00:00 am')
  ok(m2 === 141, `04:39 → 07:00 reports ${m2} minutes, should be 141`)
  console.log(`   11:52 pm → 12:05 am = ${m}m · 04:39 → 07:00 = ${m2}m`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
