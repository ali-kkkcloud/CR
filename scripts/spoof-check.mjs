// A browser extension built to stop the automatic break from ever firing.
//
// Found on the floor. Its own description lists what it does: intercept
// fetch and force activeAgoMs to 0, synthesise mousemove/keydown/scroll,
// patch the page's React ref so the idle timer never advances, and click
// Resume automatically if a break fires anyway.
//
// Every one of those happens inside the browser, where nothing we write can
// win — an extension's content script has the page's own privileges and runs
// after our code. So the question this file asks is not "can we block it"
// but "does the SERVER still reach the right answer while the browser lies
// about everything it controls".
//
// The shape of the lie is precise and worth stating: the browser claims
// perfect, continuous attention, and the sheet shows no work at all. An
// honest quiet stretch looks identical for ten minutes and nothing like it
// after an hour.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/spoof-check.mjs
import {
  clampClaim, assessEmployee, HEARTBEAT_TRUST_MINUTES, SUSPICIOUS_AFTER_MINUTES,
} from '../lib/integrity.js'
import { activityClocks, lastActivityAt, evaluateAutoBreak, AUTO_BREAK_IDLE_MINUTES } from '../lib/attendance.js'
import { nowIST, todayStr, yesterdayStr } from '../lib/sheets.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const MIN = 60000

// ── The clock these tests must keep ───────────────────────────────────
//
// The library works in an IST-SHIFTED epoch: nowIST() returns a Date whose
// fields read as Indian time, and every clock string on the sheet is
// resolved against it. A fixture that builds its own epoch from a real
// timestamp is in a different space entirely, and every assertion here came
// out roughly nineteen and a half hours wrong.
//
// So "now" is the library's own now, and every time below is measured back
// from it with the same getters the library uses to render one.
// Enforcement is opt-in, so these cases set it explicitly. Case 10 checks
// the default — believe the browser, exactly as the platform does today.
const TRUST = HEARTBEAT_TRUST_MINUTES
process.env.CAUTIO_HEARTBEAT_TRUST_MINUTES = String(TRUST)

const NOW  = nowIST().getTime()
const DATE = todayStr()
const HEAD = ['h']

const p2 = (n) => String(n).padStart(2, '0')
const clockOf = (ms) => {
  const d = new Date(ms)
  let h = d.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12
  return `${p2(h)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${a}`
}
const agoM = (m) => NOW - m * MIN
// Minutes between a clock string on the sheet and now, in the same space.
const minutesAgoOf = (clock) => {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i.exec((clock || '').trim())
  if (!m) return null
  let h = parseInt(m[1], 10) % 12
  if (/pm/i.test(m[4])) h += 12
  const d = new Date(NOW)
  d.setHours(h, parseInt(m[2], 10), parseInt(m[3], 10), 0)
  // A time that resolves ahead of now belonged to yesterday.
  if (d.getTime() > NOW) d.setDate(d.getDate() - 1)
  return Math.round((NOW - d.getTime()) / MIN)
}

// EmpID | Name | Date | In | Out | Dur | Status | Seen
const shiftRow = (inAgo, seenAgo) =>
  ['E1', 'Sunil', DATE, clockOf(agoM(inAgo)), '', '', 'Active',
   seenAgo == null ? '' : clockOf(agoM(seenAgo))]
// Date | Time | Employee | Client | Hour | Status | …
const updRow = (agoMin) =>
  [DATE, clockOf(agoM(agoMin)), 'Sunil', 'Zingbus', '11', 'No Misalignment', '', '0', 'No', '0', '', '5']

const ctxWith = ({ inAgo = 240, seenAgo = 0, updates = [], breaks = [] } = {}) => ({
  shiftRows: [HEAD, shiftRow(inAgo, seenAgo)],
  updateRows: [HEAD, ...updates],
  breakRows: [HEAD, ...breaks],
  dates: [DATE, yesterdayStr()],
  nowMs: NOW,
  heartbeatOverride: null,
  overridesMap: {},
})
const EMP = { empId: 'E1', name: 'Sunil' }

// ── 1 · The two clocks are actually separate ───────────────────────────
console.log('\n1  What the server watched, and what the browser claimed')
{
  const ctx = ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(90)] })
  const { workAt, claimedAt } = activityClocks(EMP, ctx)
  const workMin   = Math.round((NOW - workAt) / MIN)
  const claimMin  = Math.round((NOW - claimedAt) / MIN)
  ok(workMin === 90,  `last verified work reads ${workMin}m ago, expected 90`)
  ok(claimMin === 0,  `browser claim reads ${claimMin}m ago, expected 0`)
  console.log(`   work 90m ago · browser claims 0m ago — the gap is the evidence`)
}

// ── 2 · The extension, exactly as advertised ───────────────────────────
//
// activeAgoMs forced to 0 on every poll, so the stored heartbeat is always
// "just now". Four hours on shift, one client filled at the start, nothing
// since. Before this change the claim was the newest fact here and the break
// never fired at all.
console.log('\n2  activeAgoMs = 0 on every poll, and no work for two hours')
{
  const ctx = ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(120)] })
  const row = evaluateAutoBreak(EMP, ctx, DATE)
  ok(!!row, 'no break opened for a browser claiming constant attention with nothing recorded for 2h')

  const idle = Math.round((NOW - lastActivityAt(EMP, ctx)) / MIN)
  ok(idle > AUTO_BREAK_IDLE_MINUTES,
     `effective idle is ${idle}m, which is inside the ${AUTO_BREAK_IDLE_MINUTES}m threshold`)
  ok(idle === 120 - HEARTBEAT_TRUST_MINUTES,
     `idle measured from the ceiling should be ${120 - HEARTBEAT_TRUST_MINUTES}m, got ${idle}m`)
  console.log(`   claim clamped at ${HEARTBEAT_TRUST_MINUTES}m past the last real work → break opens`)
}

// ── 3 · The honest employee is untouched ───────────────────────────────
//
// The whole risk of this change is breaking somebody who is genuinely
// working. Someone filling clients steadily never comes near the ceiling.
console.log('\n3  Somebody actually working')
{
  const ctx = ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(30), updRow(12), updRow(4)] })
  ok(evaluateAutoBreak(EMP, ctx, DATE) === null,
     'an employee who filled a client four minutes ago was put on a break')

  const { clamped } = clampClaim(...Object.values(activityClocks(EMP, ctx)))
  ok(clamped === false, 'an honest claim was clamped')
  ok(assessEmployee({ name:'Sunil', onShift:true, nowMs:NOW, ...activityClocks(EMP, ctx) }) === null,
     'an employee working normally was flagged')
  console.log(`   filled a client 4m ago → no break, no clamp, no flag`)
}

// ── 4 · A quiet stretch is not an accusation ───────────────────────────
//
// Watching feeds with nothing to record is real, and it is the reason the
// heartbeat exists at all. Twenty minutes of it changes nothing.
console.log('\n4  A quiet twenty minutes at the desk')
{
  const ctx = ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(20)] })
  ok(evaluateAutoBreak(EMP, ctx, DATE) === null,
     'somebody at their desk through a quiet twenty minutes was put on a break')
  ok(assessEmployee({ name:'Sunil', onShift:true, nowMs:NOW, ...activityClocks(EMP, ctx) }) === null,
     'a quiet twenty minutes was flagged as suspicious')
  console.log(`   20m without recording → believed, not flagged (trust window is ${HEARTBEAT_TRUST_MINUTES}m)`)
}

// ── 5 · The claim is believed right up to the ceiling ──────────────────
console.log('\n5  Where the ceiling actually falls')
{
  const just = ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(HEARTBEAT_TRUST_MINUTES - 1)] })
  ok(evaluateAutoBreak(EMP, just, DATE) === null,
     `a claim ${HEARTBEAT_TRUST_MINUTES - 1}m past the last work should still be believed`)

  const past = ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(HEARTBEAT_TRUST_MINUTES + AUTO_BREAK_IDLE_MINUTES + 2)] })
  ok(!!evaluateAutoBreak(EMP, past, DATE),
     `a claim well past the ceiling should no longer hold the break off`)
  console.log(`   believed at ${HEARTBEAT_TRUST_MINUTES - 1}m · break at ` +
              `${HEARTBEAT_TRUST_MINUTES + AUTO_BREAK_IDLE_MINUTES + 2}m`)
}

// ── 6 · The break is backdated to the ceiling, not to now ──────────────
//
// It matters that the recorded break covers the unworked time rather than
// starting when the sweep happened to notice.
console.log('\n6  The break covers the time, not the moment it was noticed')
{
  const ctx = ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(120)] })
  const row = evaluateAutoBreak(EMP, ctx, DATE)
  ok(!!row, 'no break row produced')
  ok(row[7] === 'Auto', `break type is ${row[7]}, expected Auto`)
  const startedAgo = minutesAgoOf(row[3])
  ok(startedAgo === 120 - HEARTBEAT_TRUST_MINUTES,
     `break backdated to ${startedAgo}m ago, expected ${120 - HEARTBEAT_TRUST_MINUTES}m (the ceiling)`)
  console.log(`   opened backdated ${startedAgo}m — the unworked stretch is recorded, not lost`)
}

// ── 7 · What the admin is told ─────────────────────────────────────────
console.log('\n7  The evidence, in words somebody can act on')
{
  const ctx = ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(150)] })
  const flag = assessEmployee({
    name: 'Sunil', onShift: true, nowMs: NOW, ...activityClocks(EMP, ctx),
    autoBreaks: [{ seconds: 1 }, { seconds: 2 }, { seconds: 0 }, { seconds: 1 }],
  })
  ok(!!flag, 'no flag raised for a browser claiming 2.5h of attention with nothing recorded')
  ok(flag.severity === 'high', `severity ${flag?.severity}, expected high with several signals`)
  ok(flag.reasons.length >= 2, `only ${flag?.reasons.length} reason(s) given`)
  ok(flag.instantResumes === 4, `${flag?.instantResumes} instant resumes counted, expected 4`)
  console.log(`   ${flag.severity} · ${flag.reasons.join(' · ')}`)
}

// ── 8 · Somebody off shift is nobody's business ────────────────────────
console.log('\n8  Not on shift')
{
  const ctx = ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(200)] })
  ok(assessEmployee({ name:'Sunil', onShift:false, nowMs:NOW, ...activityClocks(EMP, ctx) }) === null,
     'somebody who is not on shift was flagged for not working')
  console.log(`   off shift → no flag`)
}

// ── 9 · A browser that says nothing at all ─────────────────────────────
//
// Laptop shut, tab closed. There is no claim to clamp, and the ordinary rule
// has to go on working exactly as before.
console.log('\n9  No heartbeat at all')
{
  const ctx = ctxWith({ inAgo: 240, seenAgo: null, updates: [updRow(25)] })
  const { claimedAt } = activityClocks(EMP, ctx)
  ok(claimedAt === null, 'a browser that said nothing still produced a claim')
  ok(!!evaluateAutoBreak(EMP, ctx, DATE),
     'a shut laptop idle for 25 minutes did not get a break')
  console.log(`   no claim · idle 25m → break opens on the work clock alone`)
}


// ── 10 · With enforcement off, nothing changes for anybody ─────────────
//
// The ceiling is opt-in, and this is the promise that makes it safe to ship:
// unset, the platform behaves exactly as it does today. A fresh heartbeat
// still vouches for an employee indefinitely, so no honest person is put on
// a break by this change landing.
console.log('\n10  Enforcement off — the default')
{
  const saved = process.env.CAUTIO_HEARTBEAT_TRUST_MINUTES
  delete process.env.CAUTIO_HEARTBEAT_TRUST_MINUTES

  // The spoofed browser: believed again, because nothing is enforcing.
  const ctx = ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(180)] })
  ok(evaluateAutoBreak(EMP, ctx, DATE) === null,
     'the ceiling applied even though enforcement is off — honest employees would be broken')

  // But the evidence is still produced. Detection never depends on the switch.
  const flag = assessEmployee({ name:'Sunil', onShift:true, nowMs:NOW, ...activityClocks(EMP, ctx) })
  ok(!!flag, 'no flag raised with enforcement off — detection must not depend on it')
  console.log(`   no break enforced · still flagged: ${flag.reasons[0]}`)

  if (saved != null) process.env.CAUTIO_HEARTBEAT_TRUST_MINUTES = saved
}


// ── 11 · The watchlist ─────────────────────────────────────────────────
//
// The floor knows who is running the extension. Rather than a rule applied
// to everybody — which would eventually catch an honest person on a slow
// hour — a name goes on a tab in the sheet, and for that person the browser
// is simply not listened to: their idle time is measured from what they have
// actually recorded.
//
// Fake mouse movement buys nothing, because nothing is listening to it.
console.log('\n11  A name on the watchlist')
{
  const saved = process.env.CAUTIO_HEARTBEAT_TRUST_MINUTES
  delete process.env.CAUTIO_HEARTBEAT_TRUST_MINUTES     // floor-wide rule OFF

  const watched = new Set(['sunil'])
  // The extension in full voice: heartbeat forced to "just now", every poll.
  const spoof = (lastWorkMin) => ({
    ...ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(lastWorkMin)] }),
    watchlist: watched,
  })

  // Eleven minutes since the last update. Past the threshold.
  const row = evaluateAutoBreak(EMP, spoof(11), DATE)
  ok(!!row, 'a watched employee with no update for 11m was not put on a break')
  ok(minutesAgoOf(row?.[3]) === 11,
     `the break should start when they stopped working (11m ago), got ${minutesAgoOf(row?.[3])}m`)
  ok(row?.[7] === 'Auto', `break type ${row?.[7]}, expected Auto`)

  // Nine minutes is still inside the allowance — the threshold does not move
  // for the watchlist, only the question of who is believed.
  ok(evaluateAutoBreak(EMP, spoof(9), DATE) === null,
     'nine minutes since the last update opened a break; the threshold is still 10')

  // The very same browser, same lie, for somebody NOT on the list: believed,
  // exactly as before. This is the whole point of a list.
  const others = { ...spoof(180), watchlist: new Set(['yunus', 'mahesh']) }
  ok(evaluateAutoBreak(EMP, others, DATE) === null,
     'an employee who is NOT on the watchlist was affected by it')

  // A watched employee who is genuinely working is not touched either.
  ok(evaluateAutoBreak(EMP, spoof(3), DATE) === null,
     'a watched employee who filled a client three minutes ago was put on a break')

  console.log(`   watched: 11m since last update → break backdated 11m · 9m → none`)
  console.log(`   unwatched, same spoofed browser, 180m → believed, as before`)

  if (saved != null) process.env.CAUTIO_HEARTBEAT_TRUST_MINUTES = saved
}

// ── 12 · Names on the tab that match nobody ────────────────────────────
//
// The list is typed by hand, so a typo watches nobody and says nothing. The
// comparison is on a trimmed, lowercased name for that reason.
console.log('\n12  Spelling')
{
  delete process.env.CAUTIO_HEARTBEAT_TRUST_MINUTES
  const ctx = { ...ctxWith({ inAgo: 240, seenAgo: 0, updates: [updRow(60)] }),
                watchlist: new Set(['  SUNIL  '.trim().toLowerCase()]) }
  ok(!!evaluateAutoBreak(EMP, ctx, DATE),
     'a name with different case or stray spaces did not match')
  console.log(`   "  SUNIL  " matches Sunil`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
