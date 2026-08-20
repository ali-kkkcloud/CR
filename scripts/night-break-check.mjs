// The night shift's breaks, on invented data.
//
// Everything here happens between ten at night and seven in the morning —
// the only stretch where the operating day and the calendar day differ, and
// therefore the only stretch where reading one as the other goes wrong. It
// went wrong in four places at once, and the night shift bore all of it.
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

// The operating day that began at 07:00 on the 19th and runs to 07:00 on the
// 20th. Every row below is filed under 19/08/2026, whatever the clock said.
const OP_DAY = '19/08/2026'
const DATES  = [OP_DAY, '18/08/2026']
const at = (dd, h, mi, s = 0) => new Date(2026, 7, dd, h, mi, s, 0).getTime()

// 04:58 on the 20th — still the operating day that began on the 19th.
const NOW = at(20, 4, 58, 10)

const EMP = { empId: 'E9', name: 'Naveen' }
const shiftRow  = (inAt, heartbeat) => ['E9','Naveen',OP_DAY,inAt,'','','Active',heartbeat || '']
const breakRow  = (start, end, mins, status, type) =>
  ['E9','Naveen',OP_DAY,start,end || '',mins === null ? '' : mins,status,type || 'Auto']
const HEAD = ['h']

// ── 1 · A small-hours time is not twenty-four hours ago ────────────────
console.log('\n1  Reading a time recorded after midnight')
{
  const resumed = resolveMoment('12:05:52 am', DATES, NOW)
  ok(resumed === at(20, 0, 5, 52),
     `12:05:52 am on the operating day of the 19th read as ${resumed && new Date(resumed).toString()}`)

  const evening = resolveMoment('11:54:47 pm', DATES, NOW)
  ok(evening === at(19, 23, 54, 47),
     `11:54:47 pm should still be the evening of the 19th, got ${evening && new Date(evening).toString()}`)

  const hoursOut = resumed === null ? Infinity : (at(20, 0, 5, 52) - resumed) / 3600000
  console.log(`   12:05:52 am → ${new Date(resumed).toLocaleString('en-GB')} (was ${hoursOut ? hoursOut + 'h out' : 'correct'})`)
}

// ── 2 · The break timer on screen ──────────────────────────────────────
// The overlay counts from the row's own date. A break started sixteen
// seconds ago must not read as a day.
console.log('\n2  The overlay\'s elapsed clock')
{
  const start = parseISTStamp(OP_DAY, '04:57:54 am')
  ok(start && start.getDate() === 20,
     `04:57:54 am on the operating day of the 19th placed on the ${start && start.getDate()}th`)

  const evening = parseISTStamp(OP_DAY, '11:01:15 pm')
  ok(evening && evening.getDate() === 19,
     `11:01:15 pm should stay on the 19th, landed on the ${evening && evening.getDate()}th`)
  console.log(`   04:57:54 am → 20 Aug   ·   11:01:15 pm → 19 Aug`)
}

// ── 3 · Resuming actually resumes ──────────────────────────────────────
// The bug that held people all night: nothing recorded that Resume happened,
// so the next poll saw a long silence and opened a fresh break backdated to
// before the one just ended.
console.log('\n3  The moment after Resume')
{
  const ctx = {
    shiftRows:  [HEAD, shiftRow('10:02:00 pm', '11:54:47 pm')],
    updateRows: [HEAD],
    breakRows:  [HEAD, breakRow('11:54:47 pm', '12:05:52 am', 11, 'Completed')],
    dates: DATES,
    nowMs: at(20, 0, 6, 30),          // half a minute after resuming
    overridesMap: {},
  }
  const last = lastActivityAt(EMP, ctx)
  ok(last === at(20, 0, 5, 52), `the resume was read as ${last && new Date(last).toLocaleString('en-GB')}`)

  const idleMin = (ctx.nowMs - last) / 60000
  ok(idleMin < AUTO_BREAK_IDLE_MINUTES, `half a minute after resuming, the platform thinks it has been ${idleMin.toFixed(0)} minutes`)

  const opened = evaluateAutoBreak(EMP, ctx, OP_DAY)
  ok(opened === null, `a new break was opened straight after Resume, backdated to ${opened && opened[3]}`)
  console.log(`   resumed 12:05:52 am, checked 12:06:30 am → idle ${idleMin.toFixed(1)}m, no new break`)
}

// ── 4 · A closed break's open twin does not hold anybody ───────────────
console.log('\n4  A duplicate row left Active after the break was closed')
{
  const rows = [
    HEAD,
    breakRow('11:54:47 pm', '12:05:52 am', 11, 'Completed'),
    breakRow('11:54:47 pm', '', null, 'Active'),      // the twin nothing closed
  ]
  const open = findOpenBreaks(rows, 'E9', DATES)
  ok(open.length === 0, `${open.length} break(s) still read as open after the break was resumed`)
  console.log(`   same start time, one Completed → nothing reads as open`)
}

// ── 5 · A genuine open break is still found ────────────────────────────
// The orphan rule must not swallow a real one.
console.log('\n5  A break that really is running')
{
  const rows = [
    HEAD,
    breakRow('11:54:47 pm', '12:05:52 am', 11, 'Completed'),
    breakRow('04:57:54 am', '', null, 'Active'),
  ]
  const open = findOpenBreaks(rows, 'E9', DATES)
  ok(open.length === 1 && open[0].startTime === '04:57:54 am',
     `expected the 04:57:54 am break, got ${JSON.stringify(open.map(o => o.startTime))}`)

  const secs = elapsedSecondsIST(OP_DAY, '04:57:54 am')
  // Run at any hour, so only the sign and scale can be asserted: it must never
  // come out as a day.
  ok(secs < 24 * 3600, `a break started this operating day reads as ${(secs / 3600).toFixed(1)} hours`)
  console.log(`   1 open break found, elapsed reads as ${(secs / 3600).toFixed(1)}h — not 24`)
}

// ── 6 · Somebody who really did walk away still gets a break ───────────
// None of the above may switch the feature off.
console.log('\n6  A real idle stretch still opens a break')
{
  const ctx = {
    shiftRows:  [HEAD, shiftRow('10:02:00 pm', '02:00:00 am')],
    updateRows: [HEAD],
    breakRows:  [HEAD],
    dates: DATES,
    nowMs: at(20, 2, 41, 0),          // 41 minutes of silence
    overridesMap: {},
  }
  const opened = evaluateAutoBreak(EMP, ctx, OP_DAY)
  ok(opened !== null, 'forty-one minutes of silence did not open a break')
  ok(opened && opened[3] === '02:00:00 am',
     `the break should be backdated to when they stopped (02:00:00 am), got ${opened && opened[3]}`)
  ok(opened && opened[6] === 'Active' && opened[7] === 'Auto', 'the row is not an open automatic break')
  console.log(`   silent since 02:00 am, checked 02:41 am → break opened, backdated to ${opened[3]}`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
