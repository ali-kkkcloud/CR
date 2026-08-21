// The night shift's breaks, on invented data.
//
// Everything here concerns times between midnight and seven in the morning —
// the only stretch where the operating day and the calendar day differ, and
// therefore the only stretch where reading one as the other goes wrong. It
// went wrong in four places at once, and the night shift bore all of it.
//
// The whole timeline is built RELATIVE TO NOW, not from fixed dates. Several
// of the functions under test consult the real clock — findOpenShiftRow drops
// a shift more than sixteen hours old, elapsedSecondsIST measures against this
// moment — so a scenario pinned to hard-coded dates passes at five in the
// morning and fails by nine. A test that only holds at certain hours is worse
// than no test: it gets ignored, and then it gets deleted.
//
// No network, no credentials, no spreadsheet.
//
//   node --import ./scripts/test-hooks.mjs scripts/night-break-check.mjs
import {
  resolveMoment, findOpenBreaks, lastActivityAt, evaluateAutoBreak,
  AUTO_BREAK_IDLE_MINUTES,
} from '../lib/attendance.js'
import { parseISTStamp, elapsedSecondsIST } from '../lib/clock.js'
import { calcDuration, calcDurationMinutes } from '../lib/sheets.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

// ── The clock, exactly as the code under test reads it ─────────────────
const nowIST = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const NOW = nowIST()

const pad = (n) => String(n).padStart(2, '0')
const ddmmyyyy = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`

// The operating day a moment belongs to: the 07:00→07:00 window containing it.
function opDayOf(d) {
  const x = new Date(d)
  if (x.getHours() < 7) x.setDate(x.getDate() - 1)
  return ddmmyyyy(x)
}
// "hh:mm:ss am/pm", matching what the sheets hold.
function clockOf(d) {
  let h = d.getHours()
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12; if (h === 0) h = 12
  return `${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`
}
const minsAgo  = (m) => new Date(NOW.getTime() - m * 60000)
const hoursAgo = (h) => minsAgo(h * 60)

// A moment that is definitely in the SMALL HOURS and definitely in the past —
// the most recent 02:00 that has already happened. Its operating day is the
// previous calendar date, which is the whole point.
const SMALL_HOURS = (() => {
  const d = new Date(NOW)
  d.setHours(2, 0, 0, 0)
  if (d.getTime() > NOW.getTime()) d.setDate(d.getDate() - 1)
  return d
})()
// And one in the EVENING, where the operating day and calendar day agree.
const EVENING = (() => {
  const d = new Date(NOW)
  d.setHours(23, 0, 0, 0)
  if (d.getTime() > NOW.getTime()) d.setDate(d.getDate() - 1)
  return d
})()

// The dates a running shift can span, exactly as recentDates() builds them:
// the operating day in progress NOW, and the one before it.
//
// Deriving them from the row's own moment instead left the current operating
// day off the list, so a time recorded this morning could not resolve against
// any candidate — and the idle calculation silently fell back to the start of
// the shift. It only shows up when the clock is on one side of 07:00 and the
// fixture's times are on the other, which is why it passed for hours and then
// did not.
const PREV_OF_NOW = (() => { const d = new Date(NOW); d.setDate(d.getDate() - 1); return d })()
const datesFor = () => [opDayOf(NOW), opDayOf(PREV_OF_NOW)]

const EMP = { empId: 'E9', name: 'Naveen' }
const HEAD = ['h']
const shiftRow = (opDay, inAt, heartbeat) => ['E9','Naveen',opDay,inAt,'','','Active',heartbeat || '']
const breakRow = (opDay, start, end, mins, status, type) =>
  ['E9','Naveen',opDay,start,end || '',mins === null ? '' : mins,status,type || 'Auto']

// ── 1 · A small-hours time is not twenty-four hours ago ────────────────
console.log('\n1  Reading a time recorded after midnight')
{
  const dates = datesFor()
  const got = resolveMoment(clockOf(SMALL_HOURS), dates, NOW.getTime())
  const hoursOut = got === null ? null : (SMALL_HOURS.getTime() - got) / 3600000
  ok(got === SMALL_HOURS.getTime(),
     `${clockOf(SMALL_HOURS)} on operating day ${opDayOf(SMALL_HOURS)} read ${hoursOut}h early`)

  const ev = resolveMoment(clockOf(EVENING), datesFor(), NOW.getTime())
  ok(ev === EVENING.getTime(),
     `an evening time should be unaffected; ${clockOf(EVENING)} came out ${ev === null ? 'null' : ((EVENING - ev) / 3600000) + 'h'} out`)
  console.log(`   ${clockOf(SMALL_HOURS)} on ${opDayOf(SMALL_HOURS)} → ${new Date(got).toLocaleString('en-GB')}`)
}

// ── 2 · The break timer on screen ──────────────────────────────────────
console.log('\n2  The overlay\'s elapsed clock')
{
  const t = parseISTStamp(opDayOf(SMALL_HOURS), clockOf(SMALL_HOURS))
  ok(t && t.getTime() === SMALL_HOURS.getTime(),
     `a small-hours break placed on ${t && ddmmyyyy(t)}, should be ${ddmmyyyy(SMALL_HOURS)}`)

  const e = parseISTStamp(opDayOf(EVENING), clockOf(EVENING))
  ok(e && e.getTime() === EVENING.getTime(), `an evening time moved to ${e && ddmmyyyy(e)}`)

  // A break that started five minutes ago must read as five minutes.
  const recent = minsAgo(5)
  const secs = elapsedSecondsIST(opDayOf(recent), clockOf(recent))
  ok(secs >= 280 && secs <= 320, `a break started five minutes ago reads as ${(secs / 3600).toFixed(1)} hours`)
  console.log(`   small hours → ${ddmmyyyy(SMALL_HOURS)} · evening → ${ddmmyyyy(EVENING)} · 5 min ago → ${secs}s`)
}

// ── 3 · Resuming actually resumes ──────────────────────────────────────
// The bug that held people all night: nothing recorded that Resume happened,
// so the next poll saw a long silence and opened a fresh break backdated to
// before the one just ended.
console.log('\n3  The moment after Resume')
{
  const clockIn   = hoursAgo(5)
  const breakFrom = minsAgo(40)
  const resumedAt = minsAgo(1)
  const opDay = opDayOf(clockIn)
  const ctx = {
    shiftRows:  [HEAD, shiftRow(opDay, clockOf(clockIn), clockOf(breakFrom))],
    updateRows: [HEAD],
    breakRows:  [HEAD, breakRow(opDay, clockOf(breakFrom), clockOf(resumedAt), 39, 'Completed')],
    dates: datesFor(),
    nowMs: NOW.getTime(),
    overridesMap: {},
  }
  const last = lastActivityAt(EMP, ctx)
  ok(last === resumedAt.getTime(),
     `the resume was read as ${last === null ? 'nothing at all' : new Date(last).toLocaleString('en-GB')}, should be ${resumedAt.toLocaleString('en-GB')}`)

  const idleMin = last === null ? Infinity : (ctx.nowMs - last) / 60000
  ok(idleMin < AUTO_BREAK_IDLE_MINUTES,
     `a minute after resuming, the platform thinks it has been ${idleMin.toFixed(0)} minutes`)

  const opened = evaluateAutoBreak(EMP, ctx, opDay)
  ok(opened === null, `a new break was opened straight after Resume, backdated to ${opened && opened[3]}`)
  console.log(`   resumed ${clockOf(resumedAt)}, checked a minute later → idle ${idleMin.toFixed(1)}m, no new break`)
}

// ── 4 · A closed break's open twin does not hold anybody ───────────────
console.log('\n4  A duplicate row left Active after the break was closed')
{
  const started = minsAgo(50), ended = minsAgo(39)
  const opDay = opDayOf(started)
  const rows = [
    HEAD,
    breakRow(opDay, clockOf(started), clockOf(ended), 11, 'Completed'),
    breakRow(opDay, clockOf(started), '', null, 'Active'),   // the twin nothing closed
  ]
  const open = findOpenBreaks(rows, 'E9', datesFor())
  ok(open.length === 0, `${open.length} break(s) still read as open after the break was resumed`)
  console.log(`   same start time, one Completed → nothing reads as open`)
}

// ── 5 · A genuine open break is still found ────────────────────────────
// The orphan rule must not swallow a real one.
console.log('\n5  A break that really is running')
{
  const oldStart = minsAgo(50), oldEnd = minsAgo(39), liveStart = minsAgo(6)
  const opDay = opDayOf(oldStart)
  const rows = [
    HEAD,
    breakRow(opDay, clockOf(oldStart), clockOf(oldEnd), 11, 'Completed'),
    breakRow(opDayOf(liveStart), clockOf(liveStart), '', null, 'Active'),
  ]
  const open = findOpenBreaks(rows, 'E9', datesFor())
  ok(open.length === 1 && open[0].startTime === clockOf(liveStart),
     `expected the ${clockOf(liveStart)} break, got ${JSON.stringify(open.map(o => o.startTime))}`)

  const secs = elapsedSecondsIST(opDayOf(liveStart), clockOf(liveStart))
  ok(secs >= 300 && secs <= 420, `a break six minutes old reads as ${(secs / 60).toFixed(0)} minutes`)
  console.log(`   1 open break found, elapsed reads as ${(secs / 60).toFixed(0)}m — not 24 hours`)
}

// ── 6 · Somebody who really did walk away still gets a break ───────────
// None of the above may switch the feature off.
console.log('\n6  A real idle stretch still opens a break')
{
  const clockIn = hoursAgo(4)
  const stopped = minsAgo(41)
  const opDay = opDayOf(clockIn)
  const ctx = {
    shiftRows:  [HEAD, shiftRow(opDay, clockOf(clockIn), clockOf(stopped))],
    updateRows: [HEAD],
    breakRows:  [HEAD],
    dates: datesFor(),
    nowMs: NOW.getTime(),
    overridesMap: {},
  }
  const opened = evaluateAutoBreak(EMP, ctx, opDay)
  ok(opened !== null, 'forty-one minutes of silence did not open a break')
  ok(opened && opened[3] === clockOf(stopped),
     `the break should be backdated to when they stopped (${clockOf(stopped)}), got ${opened && opened[3]}`)
  ok(opened && opened[6] === 'Active' && opened[7] === 'Auto', 'the row is not an open automatic break')
  console.log(`   silent since ${clockOf(stopped)} → break opened, backdated to ${opened && opened[3]}`)
}

// ── 7 · The reported night, exactly as it happened ─────────────────────
//
// The checks above are anchored to now, so at two in the afternoon they
// exercise the idle rules without ever crossing midnight — which is the one
// thing that was broken. This one is pinned to the reported times and asks
// the question with an explicit `nowMs`, so it reproduces that night at any
// hour of any day.
//
// The times are from the report: an auto-break at 11:54:47 pm, resumed at
// 12:05:52 am. Half a minute later the platform opened another one, backdated
// to 11:54:47 pm — before the break that had just been ended.
console.log('\n7  The reported night, replayed')
{
  const OP = '19/08/2026'
  const DATES = [OP, '18/08/2026']
  const moment = (dd, h, mi, s) => new Date(2026, 7, dd, h, mi, s, 0).getTime()

  const resumedAt = resolveMoment('12:05:52 am', DATES, moment(20, 0, 6, 30))
  ok(resumedAt === moment(20, 0, 5, 52),
     `the resume read as ${resumedAt === null ? 'nothing' : new Date(resumedAt).toLocaleString('en-GB')}` +
     `, should be 20/08 00:05:52`)

  // What the idle calculation would have concluded half a minute later.
  const idleMin = resumedAt === null ? Infinity : (moment(20, 0, 6, 30) - resumedAt) / 60000
  ok(idleMin < AUTO_BREAK_IDLE_MINUTES,
     `half a minute after resuming, the platform saw ${idleMin.toFixed(0)} minutes of silence ` +
     `— which is what re-opened the break, all night`)

  // The evening half of the same night must be unaffected.
  const wentQuiet = resolveMoment('11:54:47 pm', DATES, moment(20, 0, 6, 30))
  ok(wentQuiet === moment(19, 23, 54, 47),
     `11:54:47 pm read as ${wentQuiet === null ? 'nothing' : new Date(wentQuiet).toLocaleString('en-GB')}`)

  // And the overlay's clock on the 04:57 break from the screenshot.
  const started = parseISTStamp(OP, '04:57:54 am')
  ok(started && started.getTime() === moment(20, 4, 57, 54),
     `the 04:57:54 am break was placed at ${started && started.toLocaleString('en-GB')}, should be 20/08 04:57:54`)

  console.log(`   resumed 12:05:52 am → idle ${idleMin.toFixed(1)}m (was 29h)`)
  console.log(`   11:54:47 pm → 19/08 evening · 04:57:54 am → 20/08 morning`)
}

// ── 9 · How long a night break actually lasted ─────────────────────────
//
// Reported from the floor, with the numbers on screen: a break recorded as
// 04:39:09 am → 07:00:14 am, listed as 1581 minutes. That is 26 hours and 21
// minutes for a break that lasted 141.
//
// 07:00 is where the operating day turns over. The break opened at 04:39, so
// it is filed under the day that began at 7am the morning BEFORE; the sweep
// closed it at 07:00:14, by which time "today" is the new day. Both ends read
// as calendar dates put a full day between them.
console.log('\n9  The length of a break that ends at seven in the morning')
{
  const DAY_A = '19/08/2026'   // the operating day that began 7am on the 19th
  const DAY_B = '20/08/2026'   // and the one that began 7am on the 20th

  const m1 = calcDurationMinutes(DAY_A, '04:39:09 am', DAY_B, '07:00:14 am')
  ok(m1 === 141, `04:39:09 am → 07:00:14 am came out as ${m1} minutes, should be 141`)

  const m2 = calcDurationMinutes(DAY_A, '04:05:31 am', DAY_B, '07:00:23 am')
  ok(m2 === 175, `04:05:31 am → 07:00:23 am came out as ${m2} minutes, should be 175`)

  // Wholly inside one operating day, on the far side of midnight.
  const m3 = calcDurationMinutes(DAY_A, '02:50:12 am', DAY_A, '03:57:13 am')
  ok(m3 === 67, `02:50:12 am → 03:57:13 am came out as ${m3} minutes, should be 67`)

  // Across midnight, one operating day.
  const m4 = calcDurationMinutes(DAY_A, '11:54:00 pm', DAY_A, '12:05:00 am')
  ok(m4 === 11, `11:54 pm → 12:05 am came out as ${m4} minutes, should be 11`)

  // An ordinary daytime break, which was never affected.
  const m5 = calcDurationMinutes(DAY_A, '02:10:00 pm', DAY_A, '02:32:00 pm')
  ok(m5 === 22, `an afternoon break came out as ${m5} minutes, should be 22`)

  // And a whole night shift's duration, which had the same fault.
  const d1 = calcDuration(DAY_A, '10:02:00 pm', DAY_B, '07:00:00 am')
  ok(d1 === '8h 58m', `a 10pm–7am shift measured ${d1}, should be 8h 58m`)

  console.log(`   141m, 175m, 67m, 11m across midnight, 22m in the afternoon · night shift ${d1}`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
