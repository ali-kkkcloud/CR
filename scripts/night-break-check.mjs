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

// Dates a running shift can span, as the code builds them.
const datesFor = (d) => {
  const prev = new Date(d); prev.setDate(prev.getDate() - 1)
  return [opDayOf(d), opDayOf(prev)]
}

const EMP = { empId: 'E9', name: 'Naveen' }
const HEAD = ['h']
const shiftRow = (opDay, inAt, heartbeat) => ['E9','Naveen',opDay,inAt,'','','Active',heartbeat || '']
const breakRow = (opDay, start, end, mins, status, type) =>
  ['E9','Naveen',opDay,start,end || '',mins === null ? '' : mins,status,type || 'Auto']

// ── 1 · A small-hours time is not twenty-four hours ago ────────────────
console.log('\n1  Reading a time recorded after midnight')
{
  const dates = datesFor(SMALL_HOURS)
  const got = resolveMoment(clockOf(SMALL_HOURS), dates, NOW.getTime())
  const hoursOut = got === null ? null : (SMALL_HOURS.getTime() - got) / 3600000
  ok(got === SMALL_HOURS.getTime(),
     `${clockOf(SMALL_HOURS)} on operating day ${opDayOf(SMALL_HOURS)} read ${hoursOut}h early`)

  const ev = resolveMoment(clockOf(EVENING), datesFor(EVENING), NOW.getTime())
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
    dates: datesFor(clockIn),
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
  const open = findOpenBreaks(rows, 'E9', datesFor(started))
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
  const open = findOpenBreaks(rows, 'E9', datesFor(liveStart))
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
    dates: datesFor(clockIn),
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

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
