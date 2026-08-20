// The floor as it was actually reported this morning, on INVENTED data.
// Nothing here reads or writes a spreadsheet.
//
//   Mahesh  rostered 7–16, clocked in 07:44
//   Sunil   rostered 7–16, clocked in 07:12
//   Nikita  rostered 8–17, has NOT clocked in
//   it is 8 o'clock
//
// What was on screen: Mahesh and Sunil saw their 7 o'clock hour and then a row
// of dashes — nothing for the rest of the day. Nikita, who was not there,
// held all 333 clients of hours 8 through 16.
import { setScheduleData } from '/home/user/CR/lib/schedule.js'
import { computeDayPlan } from '/home/user/CR/lib/dayplan.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const DATE = '20/08/2026'
const employees = [
  { empId: 'E1', name: 'Mahesh', start: 7, end: 16, isNight: false },
  { empId: 'E2', name: 'Sunil',  start: 7, end: 16, isNight: false },
  { empId: 'E3', name: 'Nikita', start: 8, end: 17, isNight: false },
]
// A day shaped like the real one: clients in every hour from 7 to 16.
const PER_HOUR = { 7: 26, 8: 54, 9: 62, 10: 39, 11: 43, 12: 32, 13: 33, 14: 30, 15: 26, 16: 14 }
const timings = {}
Object.entries(PER_HOUR).forEach(([h, n]) => {
  for (let i = 1; i <= n; i++) timings[`H${h}_C${i}`] = [parseInt(h)]
})
const vehicleMap = {}
Object.keys(timings).forEach((c, i) => { vehicleMap[c.toLowerCase()] = { vehicleCount: 8 + (i % 11) } })

setScheduleData({ employees, timings, employeeHours: {} })

const shiftRow = (id, name, inAt, outAt, status) => [id, name, DATE, inAt, outAt || '', '', status, '']
const HEAD = ['h']

const plan = (opts) => computeDayPlan({
  date: DATE, today: DATE, nowHour: opts.nowHour,
  shiftRows: [HEAD, ...(opts.shifts || [])],
  updateRows: [HEAD, ...(opts.updates || [])],
  breakRows: [HEAD], leaveMap: {}, overridesMap: opts.overridesMap || {},
  vehicleMap, weekOffNames: new Set(),
})

const OVR = { Mahesh: { start: 7, end: 16 }, Sunil: { start: 7, end: 16 }, Nikita: { start: 8, end: 17 } }
const held = (p, name, hour) => (p.byEmployee[name]?.hours?.[hour] || []).length
const total = (p, name) => p.byEmployee[name]?.clients || 0

// ── 1 · The day ahead belongs to the people who are at their desks ─────
console.log('\n1  Two people at work, one not in yet, at 8 o\'clock')
{
  const p = plan({
    nowHour: 8,
    shifts: [
      shiftRow('E1', 'Mahesh', '07:44:54 am', '', 'Active'),
      shiftRow('E2', 'Sunil',  '07:12:28 am', '', 'Active'),
    ],
    overridesMap: OVR,
  })

  const laterHours = [9, 10, 11, 12, 13, 14, 15]
  const mahBlank = laterHours.filter(h => held(p, 'Mahesh', h) === 0)
  const sunBlank = laterHours.filter(h => held(p, 'Sunil', h) === 0)

  ok(mahBlank.length === 0, `Mahesh is at work and holds nothing at ${mahBlank.join(', ')} — the rest of his day is blank`)
  ok(sunBlank.length === 0, `Sunil is at work and holds nothing at ${sunBlank.join(', ')} — the rest of his day is blank`)

  // Nikita is inside her grace hour, so she is still counted on — but she
  // must take a SHARE, not the lot.
  const nik = total(p, 'Nikita')
  const mah = total(p, 'Mahesh')
  const sun = total(p, 'Sunil')
  ok(nik < 200, `Nikita has not clocked in and holds ${nik} clients — she has been given the floor's whole day`)
  ok(mah > 0 && sun > 0, `Mahesh ${mah}, Sunil ${sun} — somebody at work has nothing`)

  const spread = Math.max(mah, sun, nik) - Math.min(mah, sun, nik)
  ok(spread <= Math.max(mah, sun, nik) * 0.5, `the day split ${mah} / ${sun} / ${nik} — that is not a share`)
  console.log(`   whole day:  Mahesh ${mah}, Sunil ${sun}, Nikita ${nik}`)
  console.log(`   Mahesh's strip: ${[7,8,9,10,11,12,13,14,15].map(h => held(p,'Mahesh',h)).join(' ')}`)

  // Every hour must still reach somebody.
  const orphaned = p.hours.filter(h => h.unassigned.length > 0)
  ok(orphaned.length === 0, `${orphaned.map(h => `${h.hour}:${h.unassigned.length}`).join(', ')} clients reached nobody`)
}

// ── 2 · Going home hands the rest of the day back ──────────────────────
console.log('\n2  Somebody clocks out — their remaining hours go to the floor')
{
  const before = plan({
    nowHour: 10,
    shifts: [
      shiftRow('E1', 'Mahesh', '07:44:54 am', '', 'Active'),
      shiftRow('E2', 'Sunil',  '07:12:28 am', '', 'Active'),
      shiftRow('E3', 'Nikita', '08:03:00 am', '', 'Active'),
    ],
    overridesMap: OVR,
  })
  const after = plan({
    nowHour: 10,
    shifts: [
      shiftRow('E1', 'Mahesh', '07:44:54 am', '10:00:00 am', 'Ended'),
      shiftRow('E2', 'Sunil',  '07:12:28 am', '', 'Active'),
      shiftRow('E3', 'Nikita', '08:03:00 am', '', 'Active'),
    ],
    overridesMap: OVR,
  })

  ok(held(before, 'Mahesh', 14) > 0, `Mahesh is on shift at 10 but holds nothing at 2pm`)
  ok(held(after, 'Mahesh', 14) === 0, `Mahesh went home and still holds ${held(after,'Mahesh',14)} clients at 2pm`)
  ok(held(after, 'Sunil', 14) + held(after, 'Nikita', 14) === PER_HOUR[14],
     `2pm has ${held(after,'Sunil',14) + held(after,'Nikita',14)} of ${PER_HOUR[14]} clients after Mahesh left`)
  console.log(`   2pm before: Mahesh ${held(before,'Mahesh',14)}, Sunil ${held(before,'Sunil',14)}, Nikita ${held(before,'Nikita',14)}`)
  console.log(`   2pm after:  Mahesh ${held(after,'Mahesh',14)}, Sunil ${held(after,'Sunil',14)}, Nikita ${held(after,'Nikita',14)}`)
}

// ── 3 · A finished hour still does not move ────────────────────────────
// The whole point of the previous fix. Adding the day ahead back must not
// reopen it.
console.log('\n3  A finished hour still does not change hands')
{
  const shifts = [
    shiftRow('E1', 'Mahesh', '07:44:54 am', '', 'Active'),
    shiftRow('E2', 'Sunil',  '07:12:28 am', '', 'Active'),
    shiftRow('E3', 'Nikita', '08:03:00 am', '', 'Active'),
  ]
  const at11 = plan({ nowHour: 11, shifts, overridesMap: OVR })
  const at15 = plan({ nowHour: 15, shifts, overridesMap: OVR })

  const ownerAt = (p, hour) => {
    const m = {}
    Object.entries(p.byEmployee).forEach(([name, e]) => {
      (e.hours?.[hour] || []).forEach(c => { m[c.client] = name })
    })
    return m
  }
  let moved = 0, checked = 0
  ;[7, 8, 9, 10].forEach(hour => {
    const a = ownerAt(at11, hour), b = ownerAt(at15, hour)
    Object.entries(a).forEach(([client, who]) => { checked++; if (b[client] !== who) moved++ })
  })
  ok(moved === 0, `${moved} of ${checked} clients in finished hours changed hands between 11am and 3pm`)
  console.log(`   hours 7–10 replayed at 11am and at 3pm: ${moved} of ${checked} clients moved`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
