// What happens to an hour when somebody goes home in the middle of it.
//
// Reported from the floor: an employee's own board showed twenty clients in
// the six o'clock hour, and the admin's hand-over log said forty had moved off
// her. Two numbers for one hour of one person's day, and no way to tell which
// was real.
//
// On invented data. No network, no spreadsheet.
//
//   node --import ./scripts/test-hooks.mjs scripts/leaver-check.mjs
import { setScheduleData } from '../lib/schedule.js'
import { computeDayPlan, employeeDayHours } from '../lib/dayplan.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const DATE = '20/08/2026'
// Rostered long enough that the six o'clock hour is inside everybody's window,
// including an OT extension that runs to nine.
const employees = [
  { empId: 'E1', name: 'Nesiya', start: 8, end: 21, isNight: false },
  { empId: 'E2', name: 'Rahul',  start: 8, end: 21, isNight: false },
]
const PER_HOUR = { 16: 22, 17: 22, 18: 40, 19: 24, 20: 19 }
const timings = {}
Object.entries(PER_HOUR).forEach(([h, n]) => {
  for (let i = 1; i <= n; i++) timings[`H${h}_C${i}`] = [parseInt(h)]
})
const vehicleMap = {}
Object.keys(timings).forEach((c, i) => { vehicleMap[c.toLowerCase()] = { vehicleCount: 7 + (i % 9) } })
setScheduleData({ employees, timings, employeeHours: {} })

const HEAD = ['h']
const shiftRow = (id, name, inAt, outAt, status) => [id, name, DATE, inAt, outAt || '', '', status, '']
const updRow   = (name, client, hour) =>
  [DATE, '06:10:00 pm', name, client, String(hour), 'All Good', '', '0', 'No', '0', '', '10']

const OVR = { Nesiya: { start: 8, end: 21 }, Rahul: { start: 8, end: 21 } }
const plan = (opts) => computeDayPlan({
  date: DATE, today: DATE, nowHour: opts.nowHour,
  shiftRows: [HEAD, ...(opts.shifts || [])],
  updateRows: [HEAD, ...(opts.updates || [])],
  breakRows: [HEAD], leaveMap: {}, overridesMap: OVR,
  vehicleMap, weekOffNames: new Set(),
})
const held = (p, name, hour) => (p.byEmployee[name]?.hours?.[hour] || []).map(c => c.client)

const BOTH_IN = [
  shiftRow('E1', 'Nesiya', '08:33:50 am', '', 'Active'),
  shiftRow('E2', 'Rahul',  '08:05:00 am', '', 'Active'),
]

// ── 1 · Leaving mid-hour hands the rest of that hour back ──────────────
console.log('\n1  Somebody clocks out five past six')
{
  const before = plan({ nowHour: 18, shifts: BOTH_IN })
  const nBefore = held(before, 'Nesiya', 18).length

  const after = plan({
    nowHour: 18,
    shifts: [
      shiftRow('E1', 'Nesiya', '08:33:50 am', '06:05:00 pm', 'Ended'),
      shiftRow('E2', 'Rahul',  '08:05:00 am', '', 'Active'),
    ],
  })
  const nAfter = held(after, 'Nesiya', 18).length
  const rahul  = held(after, 'Rahul', 18).length

  ok(nBefore > 0, `Nesiya held nothing at six before she left`)
  ok(nAfter === 0, `Nesiya has gone home and still holds ${nAfter} clients in the hour she left in`)
  ok(rahul === PER_HOUR[18], `the six o'clock hour has ${rahul} of ${PER_HOUR[18]} clients after she left`)
  console.log(`   6pm before: Nesiya ${nBefore}, Rahul ${held(before,'Rahul',18).length}`)
  console.log(`   6pm after:  Nesiya ${nAfter}, Rahul ${rahul}  (all ${PER_HOUR[18]} placed)`)
}

// ── 2 · What she finished stays hers ───────────────────────────────────
console.log('\n2  The clients she did finish')
{
  const mine = ['H18_C1', 'H18_C2', 'H18_C3']
  const after = plan({
    nowHour: 18,
    shifts: [
      shiftRow('E1', 'Nesiya', '08:33:50 am', '06:05:00 pm', 'Ended'),
      shiftRow('E2', 'Rahul',  '08:05:00 am', '', 'Active'),
    ],
    updates: mine.map(c => updRow('Nesiya', c, 18)),
  })
  const hers = held(after, 'Nesiya', 18)
  ok(hers.length === 3 && mine.every(c => hers.includes(c)),
     `her finished work should stay hers, got ${JSON.stringify(hers)}`)
  const rahul = held(after, 'Rahul', 18)
  ok(!rahul.some(c => mine.includes(c)), `a client she completed was handed to Rahul as well`)
  ok(hers.length + rahul.length === PER_HOUR[18],
     `${hers.length + rahul.length} of ${PER_HOUR[18]} clients placed`)
  console.log(`   Nesiya keeps her 3 done · Rahul takes the other ${rahul.length}`)
}

// ── 3 · It does not flip back when the hour passes ─────────────────────
// The whole point. Anchored to when she left, not to what time it is now.
console.log('\n3  Two hours later, the same hour')
{
  const shifts = [
    shiftRow('E1', 'Nesiya', '08:33:50 am', '06:05:00 pm', 'Ended'),
    shiftRow('E2', 'Rahul',  '08:05:00 am', '', 'Active'),
  ]
  const at18 = plan({ nowHour: 18, shifts })
  const at20 = plan({ nowHour: 20, shifts })

  const ownerAt = (p, hour) => {
    const m = {}
    Object.entries(p.byEmployee).forEach(([name, e]) => {
      (e.hours?.[hour] || []).forEach(c => { m[c.client] = name })
    })
    return m
  }
  const a = ownerAt(at18, 18), b = ownerAt(at20, 18)
  const moved = Object.entries(a).filter(([c, who]) => b[c] !== who)
  ok(moved.length === 0, `${moved.length} clients in the six o'clock hour changed hands once it was over`)
  ok(held(at20, 'Nesiya', 18).length === 0, `Nesiya got the hour back after it finished`)
  console.log(`   6pm at 6pm and at 8pm: ${moved.length} of ${Object.keys(a).length} clients moved`)
}

// ── 4 · Her earlier hours are untouched ────────────────────────────────
console.log('\n4  The hours she actually worked')
{
  const shifts = [
    shiftRow('E1', 'Nesiya', '08:33:50 am', '06:05:00 pm', 'Ended'),
    shiftRow('E2', 'Rahul',  '08:05:00 am', '', 'Active'),
  ]
  const p = plan({ nowHour: 20, shifts })
  ok(held(p, 'Nesiya', 16).length > 0, `her four o'clock hour is empty — she worked it`)
  ok(held(p, 'Nesiya', 17).length > 0, `her five o'clock hour is empty — she worked it`)
  console.log(`   4pm ${held(p,'Nesiya',16).length}, 5pm ${held(p,'Nesiya',17).length} — still hers`)
}

// ── 5 · Her strip stops where she stopped ──────────────────────────────
// Her window runs to nine because of an OT extension. Printing seven and
// eight o'clock against her after she has gone reads as work she failed to do.
console.log('\n5  The hour strip after clocking out')
{
  const shifts = [
    shiftRow('E1', 'Nesiya', '08:33:50 am', '06:05:00 pm', 'Ended'),
    shiftRow('E2', 'Rahul',  '08:05:00 am', '', 'Active'),
  ]
  const p = plan({ nowHour: 20, shifts })
  const emp = employees[0]
  const hours = employeeDayHours(p, emp, { start: 8, end: 21 })
  ok(!hours.includes(19) && !hours.includes(20),
     `her strip still shows ${hours.filter(h => h >= 19).join(', ')} — hours after she went home`)
  ok(hours.includes(16) && hours.includes(17), `her strip has lost hours she actually worked`)

  // Rahul is still working, so his strip still runs to the end of the window.
  const rahulHours = employeeDayHours(p, employees[1], { start: 8, end: 21 })
  ok(rahulHours.includes(20), `Rahul is still on shift and his strip stops early`)
  console.log(`   Nesiya's strip ends at ${Math.max(...hours)}, Rahul's at ${Math.max(...rahulHours)}`)
}

// ══ NIGHT SHIFT ═══════════════════════════════════════════════════════
//
// The hand-back rule is anchored to the hour somebody clocked out in, and
// hours are compared by their position in the OPERATING day — 7am first,
// through midnight, to 6am last. Compared as plain numbers instead, 2am
// would sort before 10pm and a night worker who left at two would be judged
// to have missed their entire shift.
//
// This is the run that would catch it. Everything below happens on the far
// side of midnight.
console.log('\n── Night shift ──')

const NIGHT = [
  { empId: 'N1', name: 'Imran', start: 22, end: 7, isNight: true },
  { empId: 'N2', name: 'Farah', start: 22, end: 7, isNight: true },
]
const NIGHT_HOURS = { 22: 20, 23: 22, 0: 18, 1: 24, 2: 30, 3: 21, 4: 19, 5: 17, 6: 12 }
const nightTimings = {}
Object.entries(NIGHT_HOURS).forEach(([h, n]) => {
  for (let i = 1; i <= n; i++) nightTimings[`N${h}_C${i}`] = [parseInt(h)]
})
const nightVehicles = {}
Object.keys(nightTimings).forEach((c, i) => { nightVehicles[c.toLowerCase()] = { vehicleCount: 6 + (i % 9) } })
const NIGHT_OVR = { Imran: { start: 22, end: 7 }, Farah: { start: 22, end: 7 } }

const nightPlan = (opts) => {
  setScheduleData({ employees: NIGHT, timings: nightTimings, employeeHours: {} })
  return computeDayPlan({
    date: DATE, today: DATE, nowHour: opts.nowHour,
    shiftRows: [HEAD, ...(opts.shifts || [])],
    updateRows: [HEAD, ...(opts.updates || [])],
    breakRows: [HEAD], leaveMap: {}, overridesMap: NIGHT_OVR,
    vehicleMap: nightVehicles, weekOffNames: new Set(),
  })
}

// ── 6 · Leaving at 2am hands back 2am onwards, and nothing before ──────
console.log('\n6  A night worker clocks out at ten past two')
{
  const both = [
    shiftRow('N1', 'Imran', '10:02:00 pm', '', 'Active'),
    shiftRow('N2', 'Farah', '10:05:00 pm', '', 'Active'),
  ]
  const before = nightPlan({ nowHour: 2, shifts: both })
  const after = nightPlan({
    nowHour: 2,
    shifts: [
      shiftRow('N1', 'Imran', '10:02:00 pm', '02:10:00 am', 'Ended'),
      shiftRow('N2', 'Farah', '10:05:00 pm', '', 'Active'),
    ],
  })

  ok(held(before, 'Imran', 2).length > 0, `Imran held nothing at 2am before he left`)
  ok(held(after, 'Imran', 2).length === 0, `Imran went home and still holds ${held(after,'Imran',2).length} clients at 2am`)
  ok(held(after, 'Farah', 2).length === NIGHT_HOURS[2],
     `2am has ${held(after,'Farah',2).length} of ${NIGHT_HOURS[2]} clients after he left`)

  // The hours he DID work, all of them on the other side of midnight, are
  // untouched. This is the assertion that fails if hours are compared as
  // plain numbers: 22 and 23 sort ABOVE 2, so he would lose the whole evening.
  ok(held(after, 'Imran', 22).length > 0, `his 10pm hour is empty — he worked it`)
  ok(held(after, 'Imran', 23).length > 0, `his 11pm hour is empty — he worked it`)
  ok(held(after, 'Imran', 0).length > 0, `his midnight hour is empty — he worked it`)
  ok(held(after, 'Imran', 1).length > 0, `his 1am hour is empty — he worked it`)
  ok(held(after, 'Imran', 4).length === 0, `he holds ${held(after,'Imran',4).length} clients at 4am, two hours after going home`)

  const kept = [22, 23, 0, 1].map(h => held(after, 'Imran', h).length)
  console.log(`   Imran keeps 10pm–1am: ${kept.join(', ')} · holds 0 from 2am on · Farah takes all ${NIGHT_HOURS[2]} at 2am`)
}

// ── 7 · It still does not flip once those hours pass ───────────────────
console.log('\n7  Checked again at six in the morning')
{
  const shifts = [
    shiftRow('N1', 'Imran', '10:02:00 pm', '02:10:00 am', 'Ended'),
    shiftRow('N2', 'Farah', '10:05:00 pm', '', 'Active'),
  ]
  const at2 = nightPlan({ nowHour: 2, shifts })
  const at6 = nightPlan({ nowHour: 6, shifts })
  const ownerAt = (p, hour) => {
    const m = {}
    Object.entries(p.byEmployee).forEach(([name, e]) => {
      (e.hours?.[hour] || []).forEach(c => { m[c.client] = name })
    })
    return m
  }
  let moved = 0, checked = 0
  ;[22, 23, 0, 1, 2].forEach(hour => {
    const a = ownerAt(at2, hour), b = ownerAt(at6, hour)
    Object.entries(a).forEach(([c, who]) => { checked++; if (b[c] !== who) moved++ })
  })
  ok(moved === 0, `${moved} of ${checked} clients across the night changed hands between 2am and 6am`)
  ok(held(at6, 'Imran', 2).length === 0, `Imran got the 2am hour back once it was over`)
  console.log(`   10pm–2am replayed at 2am and at 6am: ${moved} of ${checked} clients moved`)
}

// ── 8 · His strip covers the night he worked, and stops ────────────────
console.log('\n8  The night strip after clocking out')
{
  const shifts = [
    shiftRow('N1', 'Imran', '10:02:00 pm', '02:10:00 am', 'Ended'),
    shiftRow('N2', 'Farah', '10:05:00 pm', '', 'Active'),
  ]
  const p = nightPlan({ nowHour: 6, shifts })
  const hours = employeeDayHours(p, NIGHT[0], { start: 22, end: 7 })
  ok(hours.includes(22) && hours.includes(23) && hours.includes(0) && hours.includes(1),
     `his strip is missing hours he worked: ${hours.join(', ')}`)
  ok(!hours.includes(3) && !hours.includes(4) && !hours.includes(5),
     `his strip runs past when he went home: ${hours.join(', ')}`)
  // In operating-day order, so the evening comes first and the small hours last.
  ok(hours[0] === 22, `the strip starts at ${hours[0]} — the night should read from 10pm, not from midnight`)
  console.log(`   Imran's strip: ${hours.join(' ')}`)

  const farah = employeeDayHours(p, NIGHT[1], { start: 22, end: 7 })
  ok(farah.includes(6), `Farah is still on shift and her strip stops at ${Math.max(...farah)}`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
