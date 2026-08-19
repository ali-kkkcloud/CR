// A finished hour must never change hands.
//
// Reported from the floor: "Shatabdi Travels was on Naveen at 12, and the
// moment 1 o'clock arrived it was on Nesiya — in the 12 o'clock hour."
//
// Invented data only; no spreadsheet is contacted. The same day is planned
// over and over as the clock advances and as people clock in, out and save
// their work, and every past hour is compared against what it said when it
// was the hour in progress. Anything that moves is a bug.
import { setScheduleData } from '../lib/schedule.js'
import { computeDayPlan } from '../lib/dayplan.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const DATE = '19/08/2026'
const employees = [
  { empId: 'E1', name: 'Naveen', start: 12, end: 21, isNight: false },
  { empId: 'E2', name: 'Nesiya', start: 12, end: 21, isNight: false },
  { empId: 'E3', name: 'Shashi', start: 12, end: 21, isNight: false },
  { empId: 'E4', name: 'Latecomer', start: 12, end: 21, isNight: false },
]
const timings = {}
const HOURS = [12, 13, 14, 15]
HOURS.forEach(h => { for (let i = 1; i <= 40; i++) timings[`C${h}-${i}`] = [h] })
timings['Shatabdi Travels'] = [12, 13]
const vehicleMap = {}
Object.keys(timings).forEach((c, i) => { vehicleMap[c.toLowerCase()] = { vehicleCount: 5 + (i % 23) } })
setScheduleData({ employees, timings, employeeHours: {} })

const HEAD = ['h']
const shift = (id, name, inAt, outAt) => [id, name, DATE, inAt, outAt || '', '', outAt ? 'Ended' : 'Active', '']
const upd   = (name, client, hour) => [DATE, '12:30:00 pm', name, client, String(hour), 'All Good', '', '0', 'No', '0', '', '10']

const plan = (nowHour, shifts, updates) => computeDayPlan({
  date: DATE, today: DATE, nowHour,
  shiftRows: [HEAD, ...shifts], updateRows: [HEAD, ...updates], breakRows: [HEAD],
  leaveMap: {}, overridesMap: {
    Naveen: { start: 12, end: 21 }, Nesiya: { start: 12, end: 21 }, Shashi: { start: 12, end: 21 },
  },
  vehicleMap, weekOffNames: new Set(),
})

const ownerOf = (p, hour, client) => {
  for (const [name, e] of Object.entries(p.byEmployee)) {
    if ((e.hours[hour] || []).some(c => c.client === client)) return name
  }
  return null
}
const snapshot = (p, hour) => {
  const m = {}
  Object.entries(p.byEmployee).forEach(([name, e]) => {
    (e.hours[hour] || []).forEach(c => { m[c.client] = name })
  })
  return m
}

// ── The reported case, step by step ───────────────────────────────────
console.log('\nThe 12 o\'clock hour, watched as the day goes on')
{
  const inAt12 = [shift('E1', 'Naveen', '12:02:00 pm'), shift('E2', 'Nesiya', '12:04:00 pm'), shift('E3', 'Shashi', '12:06:00 pm')]

  // 12:30 — the hour in progress.
  const at1230 = plan(12, inAt12, [])
  const owner1230 = ownerOf(at1230, 12, 'Shatabdi Travels')
  const snap1230 = snapshot(at1230, 12)
  console.log(`   12:30  Shatabdi Travels → ${owner1230}`)

  // 12:50 — people have been saving work all through the hour. Each of them
  // saves clients that are actually on their OWN board, because that is the
  // only way a save can happen.
  const someSaves = []
  Object.entries(at1230.byEmployee).forEach(([name, e]) => {
    (e.hours[12] || []).slice(0, 3).forEach(c => someSaves.push(upd(name, c.client, 12)))
  })
  const at1250 = plan(12, inAt12, someSaves)
  ok(ownerOf(at1250, 12, 'Shatabdi Travels') === owner1230,
     `saving other clients moved Shatabdi Travels from ${owner1230} to ${ownerOf(at1250, 12, 'Shatabdi Travels')} inside the same hour`)

  // 13:30 — the hour is over.
  const at1330 = plan(13, inAt12, someSaves)
  ok(ownerOf(at1330, 12, 'Shatabdi Travels') === owner1230,
     `the hour ended and Shatabdi Travels moved from ${owner1230} to ${ownerOf(at1330, 12, 'Shatabdi Travels')}`)

  // …and nothing else in that hour moved either.
  const snap1330 = snapshot(at1330, 12)
  const moved = Object.keys(snap1230).filter(c => snap1330[c] && snap1330[c] !== snap1230[c])
  ok(moved.length === 0, `${moved.length} client(s) of the 12 o'clock hour changed hands after it ended — e.g. ${moved.slice(0,3).join(', ')}`)
  console.log(`   13:30  Shatabdi Travels → ${ownerOf(at1330, 12, 'Shatabdi Travels')}   ·   ${moved.length} of ${Object.keys(snap1230).length} clients moved`)

  // 15:30 — hours later, somebody has gone home and a latecomer has arrived.
  const laterShifts = [
    shift('E1', 'Naveen', '12:02:00 pm'),
    shift('E2', 'Nesiya', '12:04:00 pm', '02:30:00 pm'),
    shift('E3', 'Shashi', '12:06:00 pm'),
    shift('E4', 'Latecomer', '03:05:00 pm'),
  ]
  const at1530 = plan(15, laterShifts, someSaves)
  const snap1530 = snapshot(at1530, 12)
  const movedLate = Object.keys(snap1230).filter(c => snap1530[c] && snap1530[c] !== snap1230[c])
  ok(movedLate.length === 0,
     `${movedLate.length} client(s) of the 12 o'clock hour moved once somebody left and a latecomer arrived — e.g. ${movedLate.slice(0,3).join(', ')}`)
  console.log(`   15:30  after a leaver and a latecomer  ·   ${movedLate.length} of ${Object.keys(snap1230).length} clients moved`)
}

// ── Every hour, every step of the day ─────────────────────────────────
console.log('\nEvery past hour, at every point in the day')
{
  const shifts = [
    shift('E1', 'Naveen', '12:02:00 pm'),
    shift('E2', 'Nesiya', '12:04:00 pm'),
    shift('E3', 'Shashi', '12:06:00 pm'),
  ]
  let updates = []
  const firstSeen = {}          // hour -> snapshot taken while it was current
  let drift = 0

  for (const now of HOURS) {
    // a few saves land every hour, always from the person holding the client
    const before = plan(now, shifts, updates)
    Object.entries(before.byEmployee).forEach(([name, e]) => {
      (e.hours[now] || []).slice(0, 2).forEach(c => updates.push(upd(name, c.client, now)))
    })
    const p = plan(now, shifts, updates)
    for (const h of HOURS) {
      if (HOURS.indexOf(h) > HOURS.indexOf(now)) continue      // not reached yet
      const snap = snapshot(p, h)
      if (h === now && !firstSeen[h]) { firstSeen[h] = snap; continue }
      if (!firstSeen[h]) continue
      const moved = Object.keys(firstSeen[h]).filter(c => snap[c] && snap[c] !== firstSeen[h][c])
      if (moved.length) {
        drift += moved.length
        console.log(`   at ${now}:00, hour ${h} had ${moved.length} client(s) change hands — e.g. ${moved[0]} ${firstSeen[h][moved[0]]} → ${snap[moved[0]]}`)
      }
    }
  }
  ok(drift === 0, `${drift} client-hour(s) changed hands after their hour was over`)
  console.log(`   ${HOURS.length} hours replayed across the day · ${drift} clients changed hands`)
}

// ── The late arrival still owns the hour they missed ──────────────────
console.log('\nThe hour somebody was due for stays theirs')
{
  const shifts = [
    shift('E1', 'Naveen', '12:02:00 pm'),
    shift('E4', 'Latecomer', '03:05:00 pm'),   // rostered 12, arrived 15
  ]
  const p = plan(15, shifts, [])
  const held12 = (p.byEmployee['Latecomer']?.hours?.[12] || []).length
  const held13 = (p.byEmployee['Latecomer']?.hours?.[13] || []).length
  const held15 = (p.byEmployee['Latecomer']?.hours?.[15] || []).length
  ok(held12 > 0, `rostered from 12 and arrived at 15, but the 12 o'clock hour shows nothing against them — the fact that they were due has vanished`)
  ok(held13 === 0, `they hold ${held13} clients at 13, an hour they were absent for and is not their first`)
  ok(held15 > 0, `they arrived at 15 and hold ${held15} clients that hour`)
  console.log(`   Latecomer: ${held12} at 12 (was due, did not come), ${held13} at 13, ${held15} at 15`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
