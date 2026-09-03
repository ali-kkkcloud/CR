// The Reports screen: Daily_Summary read back, and the score over a period.
//
// Two things are being pinned here, and they are the two that were easy to
// get wrong.
//
// ── The period score is an AVERAGE of days, not the formula re-run ──────
//
// Every part of the score is defined per DAY: 800 vehicles a day, an hour's
// break a day. Adding a month's totals up and putting them through the same
// formula would measure twenty days of vehicles against one day's target —
// everybody pinned at the ceiling — while the break penalty went the other
// way and became unavoidable, since a month's breaks pass sixty minutes on
// day two. The number would look like a score and mean nothing.
//
// ── A day off is not a zero ────────────────────────────────────────────
//
// Only the days somebody actually has a summary row for go into their
// average. Counting an absent day as zero would punish people for their own
// roster, and the person with the most week-offs would come last.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/reports-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')
const { averageScore, computeScore } = await import('../lib/score.js')
const reports = (await import('../pages/api/admin/reports.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const p2 = (n) => String(n).padStart(2, '0')

// Fixed dates on purpose. This file is about arithmetic over a range, and a
// range anchored to "now" would silently change shape at seven each morning.
// 04–08 August 2026 is a Tuesday to a Saturday, all in one week and one month.
const D = (n) => `${p2(n)}/08/2026`
const [D4, D5, D6, D7, D8] = [4, 5, 6, 7, 8].map(D)

// Daily_Summary: Date|EmpID|Employee|Cl_Assigned|Cl_Completed|Veh_Assigned|
//                Veh_Checked|Alerts|Fatigue|Misaligns|Start|End|Break|Source
const day = (date, name, id, { assigned = 40, completed = 38, vehAssigned = 900,
                               vehChecked = 800, alerts = 0, misaligns = 0,
                               brk = 0 } = {}) =>
  [date, id, name, String(assigned), String(completed), String(vehAssigned),
   String(vehChecked), String(alerts), '0', String(misaligns), '09:00:00 am',
   '06:00:00 pm', String(brk), 'rollup']

// Issue Tracker row: 4 raisedAt, 7 raisedBy, 9 subRequest, 17 resolved
const issue = (by, date) => { const r = new Array(20).fill('')
  r[1] = 'ISS' + Math.random().toString(36).slice(2, 7)
  r[4] = `${date}, 09:14:00 am`
  r[7] = by; r[9] = 'Customer request for video'; r[17] = 'No'; return r }

function floor({ daily = [], issues = [] } = {}) {
  reset()
  ;['crm-book', 'source-book', 'issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  globalThis.__cautioRoster = { lastGood: null }
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ['E1','Afzal', 'x','employee','9','18','No','No'],
      ['E2','Nesiya','x','employee','9','18','No','No']],
    'Client_Timings!A:B': [['Client','Hours'], ['Client A', '9']],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Daily_Summary!A:N': [['Date','EmpID','Employee','Clients_Assigned','Clients_Completed',
      'Vehicles_Assigned','Vehicles_Checked','Alerts','Fatigue','Misaligns',
      'Shift_Start','Shift_End','Break_Minutes','Source'], ...daily],
    'Issues- Realtime!A:T': [new Array(20).fill('h'), ...issues],
  }
}

const ADMIN = { name: 'Boss', role: 'admin', empId: 'A1' }
async function ask(query = {}) {
  const req = { method: 'GET', query, cookies: { cautio_token: signToken(ADMIN) }, headers: {} }
  let status = 200, body = null
  const res = { status(c) { status = c; return res }, json(p) { body = p; return res }, end() { return res } }
  await reports(req, res)
  if (status !== 200) throw new Error(`reports returned ${status}: ${JSON.stringify(body)}`)
  return body
}

// ══ 1 · The tab comes back, day by day ═════════════════════════════════
console.log('\n1  Daily_Summary, read back for a range')
{
  floor({ daily: [
    day(D4, 'Afzal', 'E1', { completed: 38, vehChecked: 800 }),
    day(D5, 'Afzal', 'E1', { completed: 30, vehChecked: 400 }),
    day(D4, 'Nesiya', 'E2', { completed: 40, vehChecked: 900 }),
  ] })

  const r = await ask({ from: D4, to: D5 })
  ok(r.hasData === true, 'the range should have data')
  ok(r.people.length === 2, `${r.people.length} people, expected 2`)

  const afzal = r.people.find(p => p.name === 'Afzal')
  ok(afzal.daysWorked === 2, `Afzal worked ${afzal.daysWorked} days, expected 2`)
  ok(afzal.clientsCompleted === 68, `${afzal.clientsCompleted} completed, expected 68 (38+30)`)
  ok(afzal.vehiclesChecked === 1200, `${afzal.vehiclesChecked} vehicles, expected 1200`)
  ok(afzal.days.length === 2, 'the days behind the total should come back too')
  ok(afzal.days[0].date === D4 && afzal.days[1].date === D5, 'the days should be in order')

  // One day out of the range must not leak in.
  const only4 = await ask({ from: D4, to: D4 })
  ok(only4.people.find(p => p.name === 'Afzal').daysWorked === 1,
     'a one-day range picked up a day outside it')
  console.log(`   2 people · Afzal 68 of 80 clients over 2 days · a 1-day range stays 1 day`)
}

// ══ 2 · The score is the average of the days ═══════════════════════════
console.log('\n2  Performance over a period')
{
  // Day one: 800 vehicles (70) + 2 footage (10) = 80.
  // Day two: 400 vehicles (35) + 0 footage       = 35.
  // The average is 57.5 → 58. Adding the days up instead would give 1200
  // vehicles — past the target — and 2 footage: a flat 80, for a period that
  // contained a poor day.
  floor({
    daily: [
      day(D4, 'Afzal', 'E1', { vehChecked: 800 }),
      day(D5, 'Afzal', 'E1', { vehChecked: 400 }),
    ],
    issues: [issue('Afzal', D4), issue('Afzal', D4)],
  })

  const r = await ask({ from: D4, to: D5 })
  const afzal = r.people.find(p => p.name === 'Afzal')

  ok(afzal.footage === 2, `${afzal.footage} footage counted, expected 2`)
  ok(afzal.score === 58, `period score ${afzal.score}, expected 58 — the mean of 80 and 35`)
  ok(afzal.score !== 80, 'the period was scored by re-running the formula on the totals')

  // Each day still scores on its own terms.
  ok(computeScore({ footageCount: 2, vehiclesSeen: 800 }).score === 80, 'day one should be 80')
  ok(computeScore({ footageCount: 0, vehiclesSeen: 400 }).score === 35, 'day two should be 35')
  console.log(`   80 and 35 → ${afzal.score} for the period, not 80`)
}

// ══ 3 · A day off is not a zero ════════════════════════════════════════
console.log('\n3  Days nobody worked stay out of the average')
{
  // Afzal worked all three days at 800. Nesiya worked ONE, also at 800, and
  // had the other two off. Both should score the same: a week off is not a
  // performance.
  floor({ daily: [
    day(D4, 'Afzal',  'E1', { vehChecked: 800 }),
    day(D5, 'Afzal',  'E1', { vehChecked: 800 }),
    day(D6, 'Afzal',  'E1', { vehChecked: 800 }),
    day(D5, 'Nesiya', 'E2', { vehChecked: 800 }),
  ] })

  const r = await ask({ from: D4, to: D6 })
  const afzal  = r.people.find(p => p.name === 'Afzal')
  const nesiya = r.people.find(p => p.name === 'Nesiya')

  ok(afzal.daysWorked === 3 && nesiya.daysWorked === 1, 'the days worked are wrong')
  ok(nesiya.score === 70, `Nesiya scored ${nesiya.score} for her one full day, expected 70`)
  ok(afzal.score === nesiya.score,
     `the same day's work scored ${afzal.score} over three days and ${nesiya.score} over one`)
  console.log(`   one 800-vehicle day and three of them both read ${nesiya.score}`)
}

// ══ 4 · The break penalty is per day, not per period ═══════════════════
console.log('\n4  Break, counted a day at a time')
{
  // 40 minutes on each of two days. That is 80 minutes over the period — past
  // the hour — but the allowance is a DAILY one and neither day broke it.
  floor({ daily: [
    day(D4, 'Afzal', 'E1', { vehChecked: 800, brk: 40 }),
    day(D5, 'Afzal', 'E1', { vehChecked: 800, brk: 40 }),
  ] })
  const kept = (await ask({ from: D4, to: D5 })).people[0]
  ok(kept.breakMinutes === 80, `${kept.breakMinutes} minutes reported for the period, expected 80`)
  ok(kept.score === 70, `score ${kept.score}, expected 70 — neither day passed the hour`)
  ok(kept.scoreBreakdown.breakPenalty.daysApplied === 0, 'no day should be penalised')

  // 90 on one day and 10 on the other: the same 100 minutes, but one day did
  // break the allowance, so one day is penalised and the average moves.
  floor({ daily: [
    day(D4, 'Afzal', 'E1', { vehChecked: 800, brk: 90 }),
    day(D5, 'Afzal', 'E1', { vehChecked: 800, brk: 10 }),
  ] })
  const hit = (await ask({ from: D4, to: D5 })).people[0]
  ok(hit.scoreBreakdown.breakPenalty.daysApplied === 1, 'exactly one day should be penalised')
  ok(hit.score === 60, `score ${hit.score}, expected 60 — the mean of 50 and 70`)
  console.log(`   40+40 → no penalty, 70 · 90+10 → one day penalised, ${hit.score}`)
}

// ══ 5 · Footage lands on the operating day it belongs to ═══════════════
console.log('\n5  Footage raised after midnight')
{
  // Raised at 01:14 on the 5th. The day runs 07:00 to 07:00, so that belongs
  // to the 4th — the shift that was actually working.
  const afterMidnight = (by, calDate) => { const r = new Array(20).fill('')
    r[1] = 'ISS' + Math.random().toString(36).slice(2, 7)
    r[4] = `${calDate}, 01:14:00 am`
    r[7] = by; r[9] = 'Customer request for video'; r[17] = 'No'; return r }

  floor({
    daily: [day(D4, 'Afzal', 'E1', { vehChecked: 0 })],
    issues: [afterMidnight('Afzal', D5)],
  })
  const r = await ask({ from: D4, to: D4 })
  const afzal = r.people.find(p => p.name === 'Afzal')
  ok(afzal.footage === 1, `${afzal.footage} counted on the 4th, expected 1`)
  ok(afzal.days[0].footage === 1, 'the day row should carry it too')
  ok(afzal.score === 5, `score ${afzal.score}, expected 5 — one request, no vehicles`)
  console.log(`   raised ${D5} 01:14 am → counted under operating day ${D4}`)
}

// ══ 6 · Day, week and month cut the same days up ═══════════════════════
console.log('\n6  The granularity switch groups without dropping anything')
{
  const daily = [D4, D5, D6, D7, D8].map(d => day(d, 'Afzal', 'E1', { vehChecked: 800 }))
  floor({ daily })

  const byDay  = await ask({ from: D4, to: D8, granularity: 'day' })
  const byWeek = await ask({ from: D4, to: D8, granularity: 'week' })

  ok(byDay.series.length === 5,  `${byDay.series.length} day buckets, expected 5`)
  ok(byWeek.series.length === 1, `${byWeek.series.length} week buckets, expected 1 — the 4th to the 8th is one week`)

  // However it is cut up, it is the same days underneath.
  const sum = (s, k) => s.reduce((a, x) => a + x[k], 0)
  ok(sum(byDay.series, 'vehiclesChecked') === sum(byWeek.series, 'vehiclesChecked'),
     'grouping changed the totals — days are being dropped or double-counted')
  ok(byDay.people[0].score === byWeek.people[0].score,
     'the granularity changed somebody\'s score, which it must never do')
  console.log(`   5 days → 5 day buckets or 1 week bucket · ${sum(byWeek.series, 'vehiclesChecked')} vehicles either way`)
}

// ══ 7 · Nothing to report says so ══════════════════════════════════════
console.log('\n7  A range with no summarised days')
{
  floor({ daily: [day(D4, 'Afzal', 'E1')] })
  const r = await ask({ from: D7, to: D8 })
  ok(r.hasData === false, 'a range with no rows should say it has no data')
  ok(r.people.length === 0, 'and carry nobody')
  ok(r.floor.score === null, `the floor score should be null, not ${r.floor.score} — nobody scored nothing`)
  console.log('   no rows → hasData false and a null score, never a floor of zeros')
}

// ══ 8 · Bad input is refused, not answered with zeros ══════════════════
console.log('\n8  A malformed date is refused')
{
  floor({ daily: [day(D4, 'Afzal', 'E1')] })
  let refused = false
  try { await ask({ from: '2026-08-04', to: D8 }) } catch (e) { refused = /400/.test(e.message) }
  ok(refused, 'an ISO date should be refused — it would match no rows and read as a terrible month')

  // Handed over backwards is a slip, not a reason to show nothing.
  const swapped = await ask({ from: D8, to: D4 })
  ok(swapped.people.find(p => p.name === 'Afzal')?.daysWorked === 1,
     'a range given the wrong way round returned nothing')
  console.log('   ISO refused · a reversed range still answers')
}

// ══ 9 · averageScore on its own ════════════════════════════════════════
console.log('\n9  The period average, directly')
{
  const empty = averageScore([])
  ok(empty.score === null, `no days should score null, got ${empty.score}`)
  ok(empty.days === 0, 'and report zero days')

  const one = averageScore([{ footageCount: 2, vehiclesSeen: 800, breakMinutes: 0 }])
  ok(one.score === 80 && one.days === 1, `a single day should read as itself, got ${one.score}`)

  const two = averageScore([
    { footageCount: 0, vehiclesSeen: 800, breakMinutes: 0 },   // 70
    { footageCount: 0, vehiclesSeen: 0,   breakMinutes: 0 },   //  0
  ])
  ok(two.score === 35, `70 and 0 should average 35, got ${two.score}`)
  ok(two.breakdown.vehicles.seen === 800, 'the period total should still be the sum')
  ok(two.breakdown.vehicles.points === 35, 'the points shown should be the per-day average')
  console.log('   totals are summed, points are averaged, and an empty period is null')
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
