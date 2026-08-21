// The eleven rules, carried one step further than rules-check.mjs takes them.
//
// rules-check pins each rule at the moment it first matters. Re-reading the
// requirements against it, four of them have a SECOND half that nothing
// covered — and in every case the second half is the part somebody on the
// floor would actually notice:
//
//   2  A no-show finally signs in at noon. rules-check stops at nine o'clock,
//      before they arrive. What happens to the eight o'clock hour they were
//      due for once they DO arrive is the whole point of keeping it.
//
//   6  Arriving at 11:45 owes an extra hour — checked. That the same arrival
//      also collects what is left of the eleven o'clock hour was not.
//
//   1  A past hour keeps its untouched clients — checked. That an employee can
//      still go back and RECORD one is why it matters, and nothing said so.
//
//   4  A leaver's unfinished work goes back to the floor — checked. That it
//      must not go back to somebody on fixed clients was checked only for the
//      ordinary split, not for the hand-back.
//
//   node --import ./scripts/test-hooks.mjs scripts/rules-detail-check.mjs
import { setScheduleData, computeShiftWindow, distributeClientsForHour } from '../lib/schedule.js'
import { computeDayPlan, employeeDayHours } from '../lib/dayplan.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const DATE = '20/08/2026'
const HEAD = ['h']
const shiftRow = (id, name, inAt, outAt, status) => [id, name, DATE, inAt, outAt || '', '', status, '']
const updRow = (name, client, hour) =>
  [DATE, '09:10:00 am', name, client, String(hour), 'All Good', '', '0', 'No', '0', '', '10']

function makeFloor({ people, perHour, employeeHours = {} }) {
  const timings = {}
  Object.entries(perHour).forEach(([h, n]) => {
    for (let i = 1; i <= n; i++) timings[`H${h}_C${i}`] = [parseInt(h)]
  })
  const vehicleMap = {}
  Object.keys(timings).forEach((c, i) => { vehicleMap[c.toLowerCase()] = { vehicleCount: 6 + (i % 11) } })
  setScheduleData({ employees: people, timings, employeeHours })
  return { vehicleMap, timings }
}

const planWith = (vehicleMap, opts) => computeDayPlan({
  date: DATE, today: DATE, nowHour: opts.nowHour,
  shiftRows: [HEAD, ...(opts.shifts || [])],
  updateRows: [HEAD, ...(opts.updates || [])],
  breakRows: [HEAD, ...(opts.breaks || [])],
  leaveMap: opts.leaveMap || {}, overridesMap: opts.overridesMap || {},
  vehicleMap, weekOffNames: opts.weekOffNames || new Set(),
})
const held = (p, name, hour) => (p.byEmployee[name]?.hours?.[hour] || []).map(c => c.client)

// ══ 2 (continued) · The no-show turns up at noon ═══════════════════════
//
// "agr kuch hour baad usne login kra, suppose 12 pm pr … lekin wo jo usne
//  clients nhii kre the wo gayab nhi hona chahiye, wo usi hour me dikhe and
//  admin ko bhi dikhe."
console.log('\n2  A no-show signs in at noon — what happens to the hour they missed')
{
  const people = [
    { empId:'E1', name:'Seven', start:7, end:16, isNight:false },
    { empId:'E2', name:'Eight', start:8, end:17, isNight:false },
  ]
  const { vehicleMap } = makeFloor({ people, perHour: { 7: 50, 8: 70, 9: 30, 10: 30, 11: 30, 12: 40, 13: 40 } })
  const OVR = { Seven:{start:7,end:16}, Eight:{start:12,end:21} }   // Eight's window follows their arrival

  const shifts = [
    shiftRow('E1','Seven','07:02:00 am','','Active'),
    shiftRow('E2','Eight','12:04:00 pm','','Active'),        // arrived four hours late
  ]
  const p = planWith(vehicleMap, { nowHour: 13, shifts, overridesMap: OVR })

  // The hour they were due for is still theirs, and still unfinished.
  const missed = held(p, 'Eight', 8)
  ok(missed.length > 0, `the 8 o'clock hour Eight was due for has vanished now that they have arrived`)
  const h8 = p.hours.find(h => h.hour === 8)
  ok(h8.done === 0, `${h8.done} clients recorded in an hour nobody worked`)
  ok(h8.dueCount === 70, `the 8 o'clock hour should still be 70 clients, it is ${h8.dueCount}`)

  // The hours in between were not theirs — those belong to whoever was here.
  ok(held(p, 'Eight', 9).length === 0,  `Eight holds ${held(p,'Eight',9).length} clients at 9, an hour they were absent for`)
  ok(held(p, 'Eight', 10).length === 0, `Eight holds clients at 10, an hour they were absent for`)
  ok(held(p, 'Eight', 11).length === 0, `Eight holds clients at 11, an hour they were absent for`)
  ok(held(p, 'Seven', 9).length === 30, `the 9 o'clock hour should all be Seven's, they hold ${held(p,'Seven',9).length}`)

  // From the hour they arrived, they are back in the split.
  ok(held(p, 'Eight', 12).length > 0, `Eight arrived at noon and holds nothing at noon`)
  ok(held(p, 'Eight', 13).length > 0, `Eight holds nothing in the hour after arriving`)

  // And the admin sees the missed hour on the employee's own strip.
  const strip = employeeDayHours(p, { name:'Eight', start:8, end:17 }, { start:12, end:21 })
  ok(strip.includes(8), `the 8 o'clock hour is missing from Eight's own day: ${strip.join(',')}`)
  console.log(`   8am: ${missed.length} clients still against Eight, 0 done · 9,10,11 held 0 · noon ${held(p,'Eight',12).length} · strip has 8am`)
}

// ══ 6 (continued) · Arriving at 11:45 collects the rest of that hour ═══
//
// "agr 11:30 k baad hua … uski shift till 9 pm tk rhegi and client bhi each
//  hour me aaynge … us hour k jo nhi hue hinge wo clients aaynge."
console.log('\n6  Arriving at 11:45 — the extra hour AND that hour\'s clients')
{
  const emp = { empId:'E2', name:'Late', start:8, end:17, isNight:false }
  const at1145 = new Date('2026-08-20T11:45:00')
  const w = computeShiftWindow(emp, at1145)
  ok(w.start === 11, `the window should open at 11, it opens at ${w.start}`)
  ok(w.end === 21,   `past the half hour owes an extra hour: expected to 21, got ${w.end}`)
  ok(w.extraHour === 1, 'the make-up hour was not owed')

  // 11:30 exactly is NOT past the half hour.
  const at1130 = new Date('2026-08-20T11:30:00')
  const w2 = computeShiftWindow(emp, at1130)
  ok(w2.end === 20, `11:30 exactly should end at 20, got ${w2.end}`)
  ok(w2.extraHour === 0, '11:30 exactly should owe no extra hour')

  // And the clients: arriving mid-hour must still hand them that hour.
  const people = [
    { empId:'E1', name:'Early', start:8, end:17, isNight:false },
    { empId:'E2', name:'Late',  start:8, end:17, isNight:false },
  ]
  const { vehicleMap } = makeFloor({ people, perHour: { 11: 40, 12: 40 } })
  const p = planWith(vehicleMap, {
    nowHour: 11,
    shifts: [
      shiftRow('E1','Early','08:01:00 am','','Active'),
      shiftRow('E2','Late', '11:45:00 am','','Active'),
    ],
    overridesMap: { Early:{start:8,end:17}, Late:{start:11,end:21} },
  })
  const lateAt11 = held(p, 'Late', 11).length
  ok(lateAt11 > 0, `somebody who signed in at 11:45 holds ${lateAt11} clients in the 11 o'clock hour`)
  ok(held(p, 'Late', 12).length > 0, 'they hold nothing in the hour after arriving')
  // Their day must not start before they arrived.
  ok(held(p, 'Late', 8).length === 0, 'they were handed an hour from before they arrived')
  console.log(`   11:45 → window 11–21 (+1h) · holds ${lateAt11} at 11am · nothing at 8am · 11:30 → 11–20 (+0)`)
}

// ══ 1 (continued) · A past hour's untouched client can still be recorded ══
//
// "isme ek fayda ye bhi h k employees ko maloom hoga konse pending h taake wo
//  baadme bhi fill kr ske."
console.log('\n1  Going back to finish an hour that has passed')
{
  const people = [{ empId:'E1', name:'Aisha', start:9, end:18, isNight:false }]
  const { vehicleMap } = makeFloor({ people, perHour: { 9: 15 } })

  const before = planWith(vehicleMap, {
    nowHour: 11,
    shifts: [shiftRow('E1','Aisha','09:02:00 am','','Active')],
    updates: ['H9_C1','H9_C2','H9_C3','H9_C4','H9_C5'].map(c => updRow('Aisha', c, 9)),
    overridesMap: { Aisha: { start: 9, end: 18 } },
  })
  const h9before = before.hours.find(h => h.hour === 9)
  ok(h9before.dueCount === 15 && h9before.done === 5, `the past hour reads ${h9before.done}/${h9before.dueCount}, expected 5/15`)

  // Now they go back at 11 o'clock and record three more into the 9 o'clock
  // hour. The hour must still be 15 due, now 8 done — not 8/8.
  const after = planWith(vehicleMap, {
    nowHour: 11,
    shifts: [shiftRow('E1','Aisha','09:02:00 am','','Active')],
    updates: ['H9_C1','H9_C2','H9_C3','H9_C4','H9_C5','H9_C6','H9_C7','H9_C8'].map(c => updRow('Aisha', c, 9)),
    overridesMap: { Aisha: { start: 9, end: 18 } },
  })
  const h9after = after.hours.find(h => h.hour === 9)
  ok(h9after.dueCount === 15, `after filling in three more the hour reads ${h9after.dueCount} due — it must stay 15`)
  ok(h9after.done === 8, `${h9after.done} done, expected 8`)
  ok(held(after, 'Aisha', 9).length === 15, `the employee should still see all 15, they see ${held(after,'Aisha',9).length}`)
  console.log(`   9am was 5/15, filled three more → 8/15, still 15 on the board`)
}

// ══ 4 (continued) · A leaver's work never lands on fixed clients ═══════
console.log('\n4  Somebody goes home — where their unfinished work goes')
{
  const people = [
    { empId:'E1', name:'Goer',  start:8, end:17, isNight:false },
    { empId:'E2', name:'Stay1', start:8, end:17, isNight:false },
    { empId:'E3', name:'Stay2', start:8, end:17, isNight:false },
    { empId:'E4', name:'Fixed', start:8, end:17, isNight:false },
  ]
  // Fixed has two named clients in the 14 o'clock hour and works only those.
  const { vehicleMap } = makeFloor({
    people, perHour: { 14: 60 },
    employeeHours: { Fixed: { 14: { clients: ['H14_C1','H14_C2'] } } },
  })

  const OVR = { Goer:{start:8,end:17}, Stay1:{start:8,end:17}, Stay2:{start:8,end:17}, Fixed:{start:8,end:17} }
  const allIn = [
    shiftRow('E1','Goer', '08:01:00 am','','Active'),
    shiftRow('E2','Stay1','08:02:00 am','','Active'),
    shiftRow('E3','Stay2','08:03:00 am','','Active'),
    shiftRow('E4','Fixed','08:04:00 am','','Active'),
  ]
  const before = planWith(vehicleMap, { nowHour: 14, shifts: allIn, overridesMap: OVR })
  const fixedBefore = held(before, 'Fixed', 14)
  ok(fixedBefore.length === 2, `Fixed should hold exactly their 2 named clients, they hold ${fixedBefore.length}`)
  const goerBefore = held(before, 'Goer', 14).length
  ok(goerBefore > 0, 'the leaver held nothing to hand back')

  // Goer clocks out mid-hour, having recorded nothing.
  const afterLeave = planWith(vehicleMap, {
    nowHour: 14,
    shifts: [
      shiftRow('E1','Goer', '08:01:00 am','02:05:00 pm','Ended'),
      ...allIn.slice(1),
    ],
    overridesMap: OVR,
  })
  const fixedAfter = held(afterLeave, 'Fixed', 14)
  ok(fixedAfter.length === 2,
     `the leaver's work was handed to somebody on fixed clients — Fixed now holds ${fixedAfter.length}, was 2`)
  ok(held(afterLeave, 'Goer', 14).length === 0, `the leaver still holds ${held(afterLeave,'Goer',14).length} clients in the hour they left`)

  const s1 = held(afterLeave, 'Stay1', 14).length, s2 = held(afterLeave, 'Stay2', 14).length
  ok(s1 + s2 === 58, `the 58 ordinary clients should be shared by the two still here, they hold ${s1} + ${s2}`)
  // Shared by VEHICLES, so the counts need not match — the weight must.
  const wt = (n) => (afterLeave.byEmployee[n]?.hours?.[14] || []).reduce((s, c) => s + Math.max(1, c.vehicleCount || 0), 0)
  const w1 = wt('Stay1'), w2 = wt('Stay2')
  ok(Math.abs(w1 - w2) <= Math.max(w1, w2) * 0.15,
     `the hand-back is not balanced by vehicles: ${w1} vs ${w2}`)
  console.log(`   Goer left holding ${goerBefore} · Stay1 ${s1} (${w1} veh) Stay2 ${s2} (${w2} veh) · Fixed still ${fixedAfter.length}`)
}

// ══ 7 (continued) · One, then two, then three, then one leaves ════════
console.log('\n7  The floor grows and shrinks around one hour')
{
  const people = [
    { empId:'E1', name:'A', start:8, end:17, isNight:false },
    { empId:'E2', name:'B', start:8, end:17, isNight:false },
    { empId:'E3', name:'C', start:8, end:17, isNight:false },
  ]
  const { vehicleMap } = makeFloor({ people, perHour: { 15: 80 } })
  const OVR = { A:{start:8,end:17}, B:{start:8,end:17}, C:{start:8,end:17} }
  const row = (id, n, out, st) => shiftRow(id, n, '08:00:00 am', out, st)

  const one = planWith(vehicleMap, { nowHour: 15, overridesMap: OVR,
    shifts: [row('E1','A','','Active'), row('E2','B','','Ended'), row('E3','C','','Ended')] })
  ok(held(one,'A',15).length === 80, `one person alone should hold all 80, holds ${held(one,'A',15).length}`)

  const two = planWith(vehicleMap, { nowHour: 15, overridesMap: OVR,
    shifts: [row('E1','A','','Active'), row('E2','B','','Active'), row('E3','C','','Ended')] })
  const wt = (p, n) => (p.byEmployee[n]?.hours?.[15] || []).reduce((s, c) => s + Math.max(1, c.vehicleCount || 0), 0)
  ok(held(two,'A',15).length + held(two,'B',15).length === 80, 'two people do not hold 80 between them')
  ok(Math.abs(wt(two,'A') - wt(two,'B')) <= Math.max(wt(two,'A'), wt(two,'B')) * 0.15,
     `two-way split is not balanced by vehicles: ${wt(two,'A')} vs ${wt(two,'B')}`)

  const three = planWith(vehicleMap, { nowHour: 15, overridesMap: OVR,
    shifts: [row('E1','A','','Active'), row('E2','B','','Active'), row('E3','C','','Active')] })
  const t = ['A','B','C'].map(n => held(three,n,15).length)
  ok(t[0] + t[1] + t[2] === 80, `three people hold ${t.join('+')} = ${t[0]+t[1]+t[2]}, expected 80`)
  const wts = ['A','B','C'].map(n => wt(three, n))
  ok(Math.max(...wts) - Math.min(...wts) <= Math.max(...wts) * 0.2,
     `three-way split is not balanced by vehicles: ${wts.join(' / ')}`)
  console.log(`   1 person 80 · 2 people ${held(two,'A',15).length}/${held(two,'B',15).length} · 3 people ${t.join('/')} (vehicles ${wts.join('/')})`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
