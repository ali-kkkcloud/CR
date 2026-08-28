// Two screens, one answer.
//
// Both of these were the same failure wearing different clothes: a rule that
// existed in more than one place, fixed in one of them, and left to drift in
// the others. The floor sees it as the platform contradicting itself — the
// same person, the same minute, two numbers.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/one-answer-check.mjs
import fs from 'fs'
import { liveBreakMinutes } from '../lib/breakclock.js'
import { weekOffNamesFor } from '../lib/schedule.js'
import { setScheduleData } from '../lib/schedule.js'
import { nowIST } from '../lib/clock.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }
const src = f => fs.readFileSync(f, 'utf8')
// Comments describe the bugs at length; scanning them would find every phrase
// this file is checking has gone.
const code = f => src(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

// A stamp `n` minutes before now, written the way the sheets write one.
//
// The date is the OPERATING day, not the calendar day — the platform's day
// runs 07:00 to 07:00, so at two in the morning the rows still carry
// yesterday's date. Building it the obvious way puts a fixture a full day out
// and the elapsed time comes back as zero.
function agoIST(mins) {
  const d = new Date(nowIST().getTime() - mins * 60000)
  const op = new Date(d.getTime() - (d.getHours() < 7 ? 24 * 3600000 : 0))
  const p = n => String(n).padStart(2, '0')
  const h = d.getHours(), h12 = h % 12 === 0 ? 12 : h % 12
  return {
    date: `${p(op.getDate())}/${p(op.getMonth() + 1)}/${op.getFullYear()}`,
    time: `${p(h12)}:${p(d.getMinutes())}:${p(d.getSeconds())} ${h >= 12 ? 'pm' : 'am'}`,
  }
}

// ══ 1 · Break minutes ══════════════════════════════════════════════════
//
// Shashi, 28 August, from the sheet itself: 14:37–15:01, 15:24–15:34,
// 15:34–15:46, and 18:39 still running at 20:49. The union of those is 176
// minutes, which is the 2h 56m the attendance table showed. The floor showed
// 6h 10m — 370 minutes, counted from 14:39, the first break of her day.
console.log('\n1  The floor and the table read the same break')
{
  const shashi = { name: 'Shashi', totalMinutes: 176, currentlyOnBreak: true }

  ok(liveBreakMinutes(shashi, agoIST(0)) === 176,
     "the server's figure is shown as it stands")
  ok(liveBreakMinutes(shashi, agoIST(3)) === 179,
     'three minutes later it reads three minutes more')

  // The old shape: the browser had activeSince and rebuilt the total from it.
  // Those fields can still arrive; nothing here may use them.
  const withStrayFields = { ...shashi, activeSince: '02:37:36 pm', activeDate: agoIST(0).date }
  ok(liveBreakMinutes(withStrayFields, agoIST(0)) === 176,
     'an open break that began hours ago cannot inflate the figure')
  console.log('   176 → 2h 56m, and 2h 59m three minutes on — the table\'s number, ticking')

  // Nobody on a break: the total stands still whatever the clock says.
  const nesiya = { name: 'Nesiya', totalMinutes: 99, currentlyOnBreak: false }
  ok(liveBreakMinutes(nesiya, agoIST(240)) === 99,
     'someone who is not away does not accrue break time')
  ok(liveBreakMinutes(shashi, null) === 176,
     'a response without asOf falls back to the plain total rather than guessing')
  console.log('   a finished shift stops counting; a missing stamp never invents time')
}

// ══ 2 · Where the figure is worked out ═════════════════════════════════
console.log('\n2  It is worked out once, on the server')
{
  const clock = code('lib/breakclock.js')
  ok(!/activeSince/.test(clock), 'the browser no longer reads the open row\'s start time')
  ok(!/Math\.max\(\s*e\.totalMinutes/.test(clock), 'and no longer picks the larger of two answers')

  const api = src('pages/api/admin/breaks.js')
  ok(/asOf:\s*\{\s*date:/.test(api), 'the API says when its figures were true')

  // Every screen that shows this must pass the stamp, or it silently reverts
  // to a frozen number and the drift comes back by another road.
  for (const f of ['components/tabs/FloorPanel.js', 'components/tabs/BreaksTab.js', 'pages/admin.js']) {
    const uses = code(f).match(/liveBreakMinutes\([^)]*\)/g) || []
    ok(uses.length > 0 && uses.every(u => /asOf/.test(u)), `${f} passes asOf everywhere`)
  }
  console.log('   one calculation, and every screen ticks from it')
}

// ══ 3 · Week off ═══════════════════════════════════════════════════════
//
// CHANDAN, 28 August: no standing flag on the roster, but the no-show sweep
// wrote a "Week Off" row into Leaves at 10:00 pm. The Dashboard read Leaves
// and showed Week Off. Hour by hour read only the roster flag and showed Not
// Started. Both fed computeDayPlan, so the two screens were building two
// different days — and a person wrongly counted as present holds clients that
// should have gone to somebody who is actually there.
console.log('\n3  Week off means the same thing on every screen')
{
  setScheduleData({
    employees: [
      { empId: 'EMP015', name: 'CHANDAN', start: 21, end: 6, isNight: true,  isWeekOff: false },
      { empId: 'EMP009', name: 'Mahesh',  start: 7,  end: 16, isNight: false, isWeekOff: true  },
      { empId: 'EMP012', name: 'Shashi',  start: 11, end: 21, isNight: false, isWeekOff: false },
      { empId: 'EMP005', name: 'Nesiya',  start: 8,  end: 17, isNight: false, isWeekOff: false },
    ],
    timings: { 'A client': [9] },
  })

  const leaveMap = {
    CHANDAN: [{ fromHour: 22, toHour: 6, reason: 'Week Off', markedBy: 'System' }],
    // Came in after all: the row was shortened, and they are not off.
    Nesiya:  [{ fromHour: 9,  toHour: 17, reason: 'Week Off (returned)', markedBy: 'System' }],
  }
  const off = weekOffNamesFor(leaveMap)

  ok(off.has('Mahesh'),   'the standing weekly day off still counts')
  ok(off.has('CHANDAN'),  "the sweep's Week Off row counts too — this is the one that was missed")
  ok(!off.has('Nesiya'),  '"Week Off (returned)" means they turned up, so they are not off')
  ok(!off.has('Shashi'),  'somebody at work is not marked off')
  ok(weekOffNamesFor({}).size === 1, 'with no leave rows at all, only the standing flag remains')
  console.log('   roster flag ∪ today\'s Week Off rows, minus anyone who came back')
}

// ══ 4 · Nobody keeps a private copy of the rule ════════════════════════
console.log('\n4  All three screens ask the same function')
{
  const screens = [
    'pages/api/admin/overview.js',
    'pages/api/admin/full-day-view.js',
    'pages/api/admin/employee-progress.js',
  ]
  for (const f of screens) {
    const c = code(f)
    ok(/weekOffNamesFor\(/.test(c), `${f} calls the shared rule`)
    // The two shapes it used to be written out by hand.
    ok(!/employees\(\)\.filter\(e => e\.isWeekOff\)/.test(c), `${f} keeps no roster-only copy`)
    ok(!/\[7\]\s*\|\|\s*''\)\.toString\(\)\.toLowerCase\(\) === 'yes'/.test(c), `${f} keeps no Credentials-column copy`)
  }
  console.log('   one rule, one place — the three cannot drift apart again')
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
