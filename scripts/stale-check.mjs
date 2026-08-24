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

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
