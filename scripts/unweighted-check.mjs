// An hour whose clients have no vehicle counts must still split evenly.
//
// Reported from a live night: one operator holding 89 clients of a 141-client
// hour, every one of them showing "0 vehicles", while the hours either side
// held a single client each.
//
// Both halves are the same fault. The split is balanced by vehicle count, and
// a client the vehicle source has never heard of counts as 0 — so the running
// load never moves, the person with the lowest load is the same person every
// time, and the entire hour lands on them.
//
// Reading the live sheet confirmed the cause: of 410 scheduled clients, 350
// have no vehicle record at all. That is a data problem and the admin's
// Dashboard names it — but missing data must degrade to "one client is one
// client", never to "this work is free".
//
//   node --import ./scripts/test-hooks.mjs scripts/unweighted-check.mjs
import { setScheduleData, distributeClientsForHour, computeCurrentHourRedistribution } from '../lib/schedule.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const employees = [
  { empId: 'E1', name: 'Hari',  start: 22, end: 7, isNight: true },
  { empId: 'E2', name: 'Mantu', start: 22, end: 7, isNight: true },
]
// The reported hour: 141 clients at 3am.
const timings = {}
for (let i = 1; i <= 141; i++) timings[`C${i}`] = [3]
setScheduleData({ employees, timings, employeeHours: {} })

const spread = (dist) => employees.map(e => (dist[e.name] || []).length)

// ── 1 · Nothing has a vehicle count ────────────────────────────────────
console.log('\n1  An hour where no client has a vehicle record')
{
  const dist = distributeClientsForHour(3, ['Hari', 'Mantu'], {}, {}, true)
  const [a, b] = spread(dist)
  ok(a + b === 141, `${a + b} of 141 clients were placed`)
  ok(Math.abs(a - b) <= 1, `the hour split ${a} / ${b} — with no vehicle counts it must still split by head count`)
  console.log(`   141 clients, no vehicle data: ${a} / ${b}`)
}

// ── 2 · Three people, still even ───────────────────────────────────────
console.log('\n2  A third person joins')
{
  const three = [...employees, { empId: 'E3', name: 'Naveen', start: 22, end: 7, isNight: true }]
  setScheduleData({ employees: three, timings, employeeHours: {} })
  const dist = distributeClientsForHour(3, ['Hari', 'Mantu', 'Naveen'], {}, {}, true)
  const counts = three.map(e => (dist[e.name] || []).length)
  ok(counts.reduce((s, n) => s + n, 0) === 141, `${counts.reduce((s,n)=>s+n,0)} of 141 placed`)
  ok(Math.max(...counts) - Math.min(...counts) <= 1, `split ${counts.join(' / ')} — should be even`)
  console.log(`   ${counts.join(' / ')}`)
  setScheduleData({ employees, timings, employeeHours: {} })
}

// ── 3 · Real vehicle counts still decide the split ──────────────────────
// The fix must not flatten a genuine imbalance: a client with 261 vehicles is
// still worth far more than one with 6.
console.log('\n3  With real vehicle counts, the weighting still rules')
{
  const heavy = {}
  for (let i = 1; i <= 141; i++) heavy[`c${i}`] = { vehicleCount: i <= 3 ? 300 : 5 }
  const dist = distributeClientsForHour(3, ['Hari', 'Mantu'], heavy, {}, true)
  const veh = employees.map(e => (dist[e.name] || []).reduce((s, c) => s + c.vehicleCount, 0))
  const [a, b] = spread(dist)
  ok(a + b === 141, `${a + b} of 141 placed`)
  ok(Math.abs(veh[0] - veh[1]) <= 320, `vehicles split ${veh[0]} / ${veh[1]} — should be close`)
  // The three heavy clients cannot all land on one person.
  ok(Math.abs(a - b) > 1, `counts came out ${a} / ${b}; with three 300-vehicle clients the HEAD counts should be uneven`)
  console.log(`   clients ${a} / ${b} · vehicles ${veh[0]} / ${veh[1]}`)
}

// ── 4 · A partly-known hour ────────────────────────────────────────────
//
// The real shape of the live sheet: a handful of clients carry a vehicle
// count, most carry none. The split is balanced BY VEHICLES, so this is the
// one case where a very uneven head count is the CORRECT answer — somebody
// holding a single 261-vehicle client is carrying more than a colleague
// holding a hundred and forty clients of unknown size.
//
// So the assertion is on the weighted load, which is the rule, and the head
// counts are only printed. It is worth being plain about what that means: an
// hour where most clients are unweighted cannot be shared out meaningfully,
// because the weights it is balancing are largely invented. The fix for that
// is the vehicle list, and the admin's Dashboard names every client missing
// from it.
console.log('\n4  A few clients have counts, most do not')
{
  const partial = { c1: { vehicleCount: 261 }, c2: { vehicleCount: 40 } }
  const dist = distributeClientsForHour(3, ['Hari', 'Mantu'], partial, {}, true)
  const [a, b] = spread(dist)
  const weight = employees.map(e =>
    (dist[e.name] || []).reduce((s, c) => s + Math.max(1, c.vehicleCount || 0), 0))
  ok(a + b === 141, `${a + b} of 141 placed`)
  ok(Math.abs(weight[0] - weight[1]) <= 261,
     `the weighted load came out ${weight[0]} / ${weight[1]} — no heavier than one client apart`)
  console.log(`   2 clients weighted, 139 not: ${a} / ${b} clients · ${weight[0]} / ${weight[1]} by weight`)
}

// ── 5 · The hand-over on End shift balances the same way ───────────────
console.log('\n5  Handing an unweighted hour back on the way out')
{
  const leftovers = Array.from({ length: 60 }, (_, i) => `C${i + 1}`)
  const log = computeCurrentHourRedistribution('Hari', 3, leftovers, ['Mantu', 'Naveen'], {})
  const to = {}
  log.forEach(r => { to[r.toEmployee] = (to[r.toEmployee] || 0) + 1 })
  const counts = ['Mantu', 'Naveen'].map(n => to[n] || 0)
  ok(counts.reduce((s, n) => s + n, 0) === 60, `${counts.reduce((s,n)=>s+n,0)} of 60 handed over`)
  ok(Math.abs(counts[0] - counts[1]) <= 1, `handed over ${counts.join(' / ')} — should be even`)
  console.log(`   60 unweighted clients handed back: ${counts.join(' / ')}`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
