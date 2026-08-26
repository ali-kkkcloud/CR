// "Still not updated" — one question about the CLIENT, across the whole floor.
//
// Reported with a screenshot, 23 August. Zingbus was on the admin's list as
// "no update since 7am" while its own timeline showed three updates against
// it: 7am by Nesiya, 5pm by Afzal, 11pm by CHANDAN.
//
// ── Why ────────────────────────────────────────────────────────────────
//
// The list read `isLocked` as "this slot was updated". It is not. isLocked
// means "this was taken off whoever the split gave it to and put with the
// person who recorded it" — so when the split had ALREADY given the client to
// the person who then recorded it, nothing moved, nothing was locked, and a
// finished slot read as untouched. All three of Zingbus's updates were by
// people the split had already given it to.
//
// ── The rule ───────────────────────────────────────────────────────────
//
// Given as a requirement: it is a question about the client, not about who is
// looking at it. Five clients due in the morning and again at night; if
// ANYBODY fills three of them at ANY hour, those three are off the list for
// EVERYBODY. The two nobody filled stay on it, for everybody.
//
// ── Why the plan is built by hand here ─────────────────────────────────
//
// The first version of this file drove the admin endpoint, which reads the
// real clock — so at seven in the morning the operating day has no finished
// hours at all, the list is legitimately empty, and every case failed for a
// reason that had nothing to do with the rule. The rule is exported now and
// is given a day and an hour, so it can be asked the same question at any
// time of day.
//
//   node --import ./scripts/test-hooks.mjs scripts/stale-check.mjs
import { setScheduleData } from '../lib/schedule.js'
import { computeDayPlan, staleClientsFrom } from '../lib/dayplan.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const DATE = '20/08/2026'
const HEAD = ['h']
// The day is fixed, and so is "now": eleven in the morning, with the eight
// and nine o'clock hours behind it and ten still running.
const NOW_HOUR = 11
const HOUR_A = 8, HOUR_B = 9

const CLIENTS = ['Zingbus', 'Shatabdi', 'Turbotork', 'Sarathi', 'Jai Vishnu']
const PEOPLE = [
  { empId: 'E1', name: 'Nesiya',  start: 7, end: 16, isNight: false },
  { empId: 'E2', name: 'Afzal',   start: 7, end: 16, isNight: false },
  { empId: 'E3', name: 'CHANDAN', start: 7, end: 16, isNight: false },
]
const vehicleMap = {}
CLIENTS.forEach((c, i) => { vehicleMap[c.toLowerCase()] = { vehicleCount: c === 'Zingbus' ? 261 : 3 + i } })

const shiftRow = (p) => [p.empId, p.name, DATE, '07:02:00 am', '', '', 'Active', '']
// Date | Time | Employee | Client | Hour | Status | …
const upd = (name, client, hour, at = '09:10:00 am') =>
  [DATE, at, name, client, String(hour), 'No Misalignment', '', '0', 'No', '0', '', '5']

// Every client is due in BOTH hours — the shape the requirement describes.
function planWith(updates) {
  const timings = {}
  CLIENTS.forEach(c => { timings[c] = [HOUR_A, HOUR_B] })
  setScheduleData({ employees: PEOPLE, timings, employeeHours: {} })
  return computeDayPlan({
    date: DATE, today: DATE, nowHour: NOW_HOUR,
    shiftRows: [HEAD, ...PEOPLE.map(shiftRow)],
    updateRows: [HEAD, ...updates],
    breakRows: [HEAD], leaveMap: {}, overridesMap: {},
    vehicleMap, weekOffNames: new Set(),
  })
}
const stale = (updates) => staleClientsFrom(planWith(updates), NOW_HOUR)
const names = (list) => list.map(c => c.client).sort()

// Who the split gives a client to in a given hour — so a case can have the
// RIGHT person record it, which is the shape that used to read as untouched.
function holderOf(plan, client, hour) {
  const h = plan.hours.find(x => x.hour === hour)
  const found = Object.entries(h?.owners || {}).find(([, cs]) => cs.some(c => c.client === client))
  return found ? found[0] : null
}

// ── 1 · The reported case ──────────────────────────────────────────────
console.log('\n1  Recorded by the very people the split gave it to')
{
  const base = planWith([])
  const a = holderOf(base, 'Zingbus', HOUR_A)
  const b = holderOf(base, 'Zingbus', HOUR_B)
  ok(!!a && !!b, `Zingbus should be on somebody in both finished hours (${a} / ${b})`)

  // Nothing has to MOVE for these — which is exactly why they went unnoticed.
  const after = stale([upd(a, 'Zingbus', HOUR_A), upd(b, 'Zingbus', HOUR_B)])
  ok(!names(after).includes('Zingbus'),
     'Zingbus is still listed as never updated after its own holders recorded it')
  console.log(`   ${a} at ${HOUR_A}:00 and ${b} at ${HOUR_B}:00 → Zingbus off the list`)
}

// ── 2 · The rule, as it was given ──────────────────────────────────────
console.log('\n2  Three of five filled, by three different people')
{
  const list = stale([
    upd('Nesiya',  'Zingbus',   HOUR_A),
    upd('Afzal',   'Shatabdi',  HOUR_B),
    upd('CHANDAN', 'Turbotork', HOUR_A),
  ])
  const n = names(list)
  ok(!n.includes('Zingbus'),   'Zingbus was filled by Nesiya and is still listed')
  ok(!n.includes('Shatabdi'),  'Shatabdi was filled by Afzal and is still listed')
  ok(!n.includes('Turbotork'), 'Turbotork was filled by CHANDAN and is still listed')
  ok(n.includes('Sarathi'),    'Sarathi was filled by nobody and is missing from the list')
  ok(n.includes('Jai Vishnu'), 'Jai Vishnu was filled by nobody and is missing from the list')
  ok(n.length === 2, `${n.length} clients listed, expected 2: ${n.join(', ')}`)
  console.log(`   3 of 5 filled by 3 different people → ${n.join(' and ')} still waiting`)
}

// ── 3 · One update anywhere is enough ──────────────────────────────────
//
// A client due in two hours and filled in one of them has been updated. The
// other hour is still an outstanding SLOT, and the board says so hour by
// hour — this list is the separate, day-wide fact.
console.log('\n3  Filled in one of its two hours')
{
  const list = stale([upd('Nesiya', 'Zingbus', HOUR_A)])
  ok(!names(list).includes('Zingbus'),
     'a client filled in one of its two hours is still being called "never updated"')
  console.log(`   filled at ${HOUR_A}:00 only → off the list`)
}

// ── 4 · Somebody else's update counts ──────────────────────────────────
//
// The person who held it at nine did nothing; the person who held it at
// eight did. It is updated.
console.log('\n4  Filled by the OTHER hour\'s holder')
{
  const base = planWith([])
  const eight = holderOf(base, 'Sarathi', HOUR_A)
  const nine  = holderOf(base, 'Sarathi', HOUR_B)
  const list = stale([upd(eight, 'Sarathi', HOUR_A)])
  ok(!names(list).includes('Sarathi'),
     `Sarathi was filled by ${eight} at ${HOUR_A}:00 and is still listed against ${nine}`)
  console.log(`   ${eight} filled it at ${HOUR_A}:00 → not listed against ${nine} either`)
}

// ── 5 · Nothing filled at all ──────────────────────────────────────────
console.log('\n5  A morning nobody has touched')
{
  const list = stale([])
  ok(list.length === CLIENTS.length, `${list.length} of ${CLIENTS.length} listed when none were filled`)
  ok(list[0].client === 'Zingbus', `biggest fleet should be first, got ${list[0].client}`)
  ok(list[0].vehicleCount === 261, `Zingbus reports ${list[0].vehicleCount} vehicles, expected 261`)
  const z = list[0]
  ok(z.pending === 2, `${z.pending} missed slots, expected 2 (both hours)`)
  ok(z.slots.length === 2, `${z.slots.length} slots listed, expected 2`)
  ok(z.slots[0].hour === HOUR_B, `newest slot first: expected ${HOUR_B}, got ${z.slots[0].hour}`)
  ok(z.firstHour === HOUR_A, `due since ${z.firstHour}, expected ${HOUR_A}`)
  ok(!!z.lastOwner, 'nobody is named as having held it last')
  console.log(`   all ${list.length} listed · ${z.client} ${z.vehicleCount} vehicles, ` +
              `${z.pending} slots, due since ${z.firstHour}:00, last with ${z.lastOwner}`)
}

// ── 6 · The hour in progress is not late ───────────────────────────────
console.log('\n6  The hour that is still running')
{
  const timings = {}
  CLIENTS.forEach(c => { timings[c] = [NOW_HOUR] })      // due ONLY in this hour
  setScheduleData({ employees: PEOPLE, timings, employeeHours: {} })
  const plan = computeDayPlan({
    date: DATE, today: DATE, nowHour: NOW_HOUR,
    shiftRows: [HEAD, ...PEOPLE.map(shiftRow)], updateRows: [HEAD],
    breakRows: [HEAD], leaveMap: {}, overridesMap: {}, vehicleMap, weekOffNames: new Set(),
  })
  const list = staleClientsFrom(plan, NOW_HOUR)
  ok(list.length === 0, `${list.length} clients called late in the hour that is still running`)
  console.log(`   nothing due only in the current hour is listed`)
}

// ── 7 · Filled during the hour that is still running ───────────────────
//
// The rule is "seven this morning until NOW", and now includes the hour in
// progress. A client due at eight and again at eleven, filled at 11:15, has
// been filled — it must come off the list straight away rather than at noon.
//
// This is where the admin and the employee disagreed. The employee's panel
// tests the whole day (updatedToday, built from every row of the operating
// day), so the client vanished from their list the moment it was filled. The
// admin's tested each client-HOUR, so the outstanding eight o'clock slot kept
// it listed — one person looking at a client somebody had just done.
console.log('\n7  Filled in the hour that is still running')
{
  const timings = { 'Zingbus': [HOUR_A, NOW_HOUR] }
  setScheduleData({ employees: PEOPLE, timings, employeeHours: {} })
  const build = (updates) => computeDayPlan({
    date: DATE, today: DATE, nowHour: NOW_HOUR,
    shiftRows: [HEAD, ...PEOPLE.map(shiftRow)], updateRows: [HEAD, ...updates],
    breakRows: [HEAD], leaveMap: {}, overridesMap: {}, vehicleMap, weekOffNames: new Set(),
  })

  // Nothing filled: the finished eight o'clock slot puts it on the list.
  const before = staleClientsFrom(build([]), NOW_HOUR).map(c => c.client)
  ok(before.includes('Zingbus'), 'a client with a missed 8:00 slot should be listed')

  // Filled at 11:15 — inside the hour that has not finished yet.
  const plan = build([upd('Nesiya', 'Zingbus', NOW_HOUR, '11:15:00 am')])
  const after = staleClientsFrom(plan, NOW_HOUR).map(c => c.client)
  ok(!after.includes('Zingbus'),
     'filled at 11:15 and still listed as never updated — the running hour is not being counted')

  // And the day-wide record the employee's board reads is the same one.
  ok(plan.filledToday?.get('Zingbus') === '11:15:00 am',
     `the day-wide record says ${plan.filledToday?.get('Zingbus')}, expected 11:15:00 am`)
  console.log(`   listed before · filled at 11:15 in the running hour → off the list at once`)
}

// ── 8 · A client that never comes at seven ─────────────────────────────
//
// Not every client is due first thing. One that only ever appears at eleven
// cannot be "not updated since seven" while eleven is still running, and it
// must not be listed before its hour has come round either.
console.log('\n8  A client whose first hour is late in the day')
{
  const timings = { 'Zingbus': [HOUR_B] }          // due at 9 only
  setScheduleData({ employees: PEOPLE, timings, employeeHours: {} })
  const at = (nowHour, updates = []) => computeDayPlan({
    date: DATE, today: DATE, nowHour,
    shiftRows: [HEAD, ...PEOPLE.map(shiftRow)], updateRows: [HEAD, ...updates],
    breakRows: [HEAD], leaveMap: {}, overridesMap: {}, vehicleMap, weekOffNames: new Set(),
  })

  // At eight its hour has not arrived — nothing is owed yet.
  ok(staleClientsFrom(at(HOUR_A), HOUR_A).length === 0,
     'a client due at nine is being called late at eight')

  // At eleven, nine has passed and nobody filled it.
  const late = staleClientsFrom(at(NOW_HOUR), NOW_HOUR)
  ok(late.some(c => c.client === 'Zingbus'), 'nine has passed unfilled and the client is not listed')
  ok(late.find(c => c.client === 'Zingbus')?.firstHour === HOUR_B,
     'the list should say it has been due since nine')

  // Filled at nine by anybody: gone, whatever hour it is now.
  const filled = staleClientsFrom(at(NOW_HOUR, [upd('CHANDAN', 'Zingbus', HOUR_B)]), NOW_HOUR)
  ok(!filled.some(c => c.client === 'Zingbus'), 'filled at nine and still listed at eleven')
  console.log(`   not listed at ${HOUR_A}:00 · listed at ${NOW_HOUR}:00 · filled at ${HOUR_B}:00 → gone`)
}


// ── 9 · The admin's number and the employee's number ───────────────────
//
// Reported with two screenshots: the employee was shown 102 clients "nobody
// has filled since 7am" while the admin, looking at the WHOLE FLOOR, was
// shown 89. One person's share cannot exceed the floor's total.
//
// The page had its own copy of this rule and the copy had drifted by one
// word: it skipped the hour in progress but counted every hour still to
// COME, so clients due later in the day were being called overdue. The
// employee's list is built on the server now, from this same function.
console.log('\n9  One person\'s share cannot exceed the whole floor')
{
  // Due in a finished hour AND in an hour still ahead, so a rule that counts
  // future hours reports more than a rule that does not.
  const AHEAD = 15
  const timings = {}
  CLIENTS.forEach(c => { timings[c] = [HOUR_A, AHEAD] })
  setScheduleData({ employees: PEOPLE, timings, employeeHours: {} })
  const plan = computeDayPlan({
    date: DATE, today: DATE, nowHour: NOW_HOUR,
    shiftRows: [HEAD, ...PEOPLE.map(shiftRow)], updateRows: [HEAD],
    breakRows: [HEAD], leaveMap: {}, overridesMap: {}, vehicleMap, weekOffNames: new Set(),
  })
  const floor = staleClientsFrom(plan, NOW_HOUR)

  // The employee's list, built the way my-day builds it: the same rows,
  // narrowed to the slots that were theirs.
  const shareOf = (who) => floor
    .map(c => ({ client: c.client, mine: c.slots.filter(s => s.owner === who) }))
    .filter(c => c.mine.length > 0)

  const shares = PEOPLE.map(p => shareOf(p.name))
  shares.forEach((share, i) => {
    ok(share.length <= floor.length,
       `${PEOPLE[i].name} sees ${share.length} clients where the whole floor has ${floor.length}`)
  })

  // Every client on somebody's list is on the floor's list, and the reverse:
  // nothing on the floor's list is on nobody's.
  const named = new Set(shares.flat().map(c => c.client))
  ok(named.size === floor.length,
     `${floor.length} clients on the floor's list but only ${named.size} appear on anybody's`)

  // And the hour still ahead is not being counted as late by either.
  const aheadOnly = floor.filter(c => c.slots.every(s => s.hour === AHEAD))
  ok(aheadOnly.length === 0,
     `${aheadOnly.length} clients called overdue for an hour that has not happened yet`)
  console.log(`   floor ${floor.length} · biggest share ${Math.max(...shares.map(s => s.length))} · nothing from ${AHEAD}:00 counted`)
}


// ── 10 · What the NEXT employee sees on a client somebody already did ──
//
// The rule, as the floor states it: "Still not updated" means exactly one
// thing — nobody has filled this client since seven this morning. The moment
// anybody fills it, everyone who sees it afterwards sees WHEN, and by whom.
//
// The board was not doing the second half. Its status line read `done`, which
// is this employee's own work in this slot, so a client filled at seven by
// Nesiya still said "Still not updated" when it reached Afzal at eleven —
// the same words used for a client nobody had touched all day. Two very
// different facts, one sentence.
//
// The list and the board now answer from the same record: staleClientsFrom
// uses plan.filledToday, and the board is handed updatedToday, both of which
// are "filled by anybody, at any hour today".
console.log('\n10  Filled at seven, handed on at eleven')
{
  const timings = { 'Zingbus': [HOUR_A, NOW_HOUR] }
  setScheduleData({ employees: PEOPLE, timings, employeeHours: {} })
  const plan = computeDayPlan({
    date: DATE, today: DATE, nowHour: NOW_HOUR,
    shiftRows: [HEAD, ...PEOPLE.map(shiftRow)],
    updateRows: [HEAD, upd('Nesiya', 'Zingbus', HOUR_A, '08:12:00 am')],
    breakRows: [HEAD], leaveMap: {}, overridesMap: {}, vehicleMap, weekOffNames: new Set(),
  })

  // Off the list, for everybody — not just for Nesiya.
  const listed = staleClientsFrom(plan, NOW_HOUR).map(c => c.client)
  ok(!listed.includes('Zingbus'),
     'a client filled at 8am is still on the "nobody has filled this" list')

  // And the record the board reads carries the time, so whoever holds it next
  // is told when it was done rather than being told nobody has done it.
  const when = plan.filledToday?.get('Zingbus')
  ok(when === '08:12:00 am',
     `the board would show "${when}" as the last update, expected 08:12:00 am`)
  console.log(`   filled 08:12 by Nesiya → off the list · next holder sees "Updated at 08:12:00 am"`)

  // And when a client is filled MORE than once in a day, the time shown is
  // the most recent one — not the first, which would tell somebody a client
  // had been sitting untouched since morning when it was done minutes ago.
  //
  // It is the last row that wins, and that is correct because CRM_Updates is
  // append-only: rows arrive in the order they were written. Nothing should
  // ever re-sort that tab.
  const many = computeDayPlan({
    date: DATE, today: DATE, nowHour: NOW_HOUR,
    shiftRows: [HEAD, ...PEOPLE.map(shiftRow)],
    updateRows: [HEAD,
      upd('Nesiya',  'Zingbus', HOUR_A, '08:12:00 am'),
      upd('Afzal',   'Zingbus', HOUR_B, '09:40:00 am'),
      upd('CHANDAN', 'Zingbus', HOUR_B, '10:55:00 am'),
    ],
    breakRows: [HEAD], leaveMap: {}, overridesMap: {}, vehicleMap, weekOffNames: new Set(),
  })
  const latest = many.filledToday?.get('Zingbus')
  ok(latest === '10:55:00 am',
     `three updates in a day should report the newest (10:55:00 am), got ${latest}`)
  console.log(`   filled 08:12, 09:40, 10:55 → reports 10:55, the most recent`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
