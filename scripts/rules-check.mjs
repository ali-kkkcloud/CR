// The nine rules the floor runs on, checked one at a time.
//
// These were given as requirements, not as bug reports: "in 9 mese koi cheez
// skip nhi hona chahiye". Several have been broken and fixed more than once,
// and twice a fix for one quietly undid another. Anything only verified by
// reading the code gets broken again the next time somebody reads it
// differently.
//
// So each rule is checked here by name, against invented data. No network, no
// credentials, no spreadsheet.
//
//   node --import ./scripts/test-hooks.mjs scripts/rules-check.mjs
import { setScheduleData, computeShiftWindow, distributeClientsForHour } from '../lib/schedule.js'
import { computeDayPlan, employeeDayHours } from '../lib/dayplan.js'
import { evaluateAutoBreak, lastActivityAt, AUTO_BREAK_IDLE_MINUTES } from '../lib/attendance.js'

let pass = 0, fail = 0
const rules = {}
let current = null
function rule(n, title) { current = n; rules[n] = { title, pass: 0, fail: 0 }; console.log(`\n${n}  ${title}`) }
const ok = (c, m) => {
  if (c) { pass++; rules[current].pass++ }
  else { fail++; rules[current].fail++; console.log('  FAIL  ' + m) }
}

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

// ══ 1 · A finished hour keeps every client it held ═════════════════════
rule(1, 'A past hour shows what was due, not only what was done')
{
  const people = [{ empId:'E1', name:'Aisha', start:9, end:18, isNight:false }]
  const { vehicleMap } = makeFloor({ people, perHour: { 9: 15 } })
  const done = ['H9_C1','H9_C2','H9_C3','H9_C4','H9_C5']
  const p = planWith(vehicleMap, {
    nowHour: 11,
    shifts: [shiftRow('E1','Aisha','09:02:00 am','','Active')],
    updates: done.map(c => updRow('Aisha', c, 9)),
    overridesMap: { Aisha: { start: 9, end: 18 } },
  })
  const hour = p.hours.find(h => h.hour === 9)
  const mine = held(p, 'Aisha', 9)

  ok(mine.length === 15, `the finished hour shows ${mine.length} clients, should still be all 15`)
  ok(hour.done === 5, `${hour.done} recorded as done, should be 5`)
  ok(mine.length - hour.done === 10, `10 untouched clients should still be visible; ${mine.length - hour.done} are`)
  const missing = done.filter(c => !mine.includes(c))
  ok(missing.length === 0, `clients that WERE done fell off the hour: ${missing.join(', ')}`)
  console.log(`   9am: ${mine.length} due, ${hour.done} done, ${mine.length - hour.done} still open`)
}

// ══ 2 · The rostered-but-not-arrived, and the no-show ══════════════════
rule(2, 'An hour belongs to whoever the roster puts on it')
{
  const people = [
    { empId:'E1', name:'Seven', start:7, end:16, isNight:false },
    { empId:'E2', name:'Eight', start:8, end:17, isNight:false },
  ]
  const { vehicleMap } = makeFloor({ people, perHour: { 7: 50, 8: 70, 9: 30 } })
  const OVR = { Seven:{start:7,end:16}, Eight:{start:8,end:17} }
  const onlySeven = [shiftRow('E1','Seven','07:02:00 am','','Active')]

  // 8 o'clock, Eight rostered but not yet in: the hour must be shared.
  const at8 = planWith(vehicleMap, { nowHour: 8, shifts: onlySeven, overridesMap: OVR })
  const s8 = held(at8,'Seven',8).length, e8 = held(at8,'Eight',8).length
  ok(e8 > 0, `Eight is rostered from 8 and holds ${e8} — all 70 went to one person`)
  ok(Math.abs(s8 - e8) <= 3, `the 8 o'clock hour split ${s8} / ${e8}`)

  // 9 o'clock, still no Eight: past the grace hour, so the hour is Seven's…
  const at9 = planWith(vehicleMap, { nowHour: 9, shifts: onlySeven, overridesMap: OVR })
  ok(held(at9,'Eight',9).length === 0, `a no-show still holds ${held(at9,'Eight',9).length} clients past their grace hour`)
  ok(held(at9,'Seven',9).length === 30, `the 9 o'clock hour should fall to Seven, got ${held(at9,'Seven',9).length}`)

  // …but the hour they WERE due for stays against their name.
  const e8Later = held(at9,'Eight',8).length
  ok(e8Later > 0, `the hour Eight was due for has vanished — nobody can see they did not come`)
  ok(p2Visible(at9), 'the admin cannot see the missed hour either')
  function p2Visible(plan) { return (plan.byEmployee['Eight']?.hours?.[8] || []).length > 0 }
  console.log(`   8am shared ${s8}/${e8} before Eight logs in · at 9am Eight keeps ${e8Later} at 8, holds 0 at 9`)
}

// ══ 3 · Monthly history is readable ════════════════════════════════════
rule(3, 'The months worked before the platform are still readable')
{
  const { buildHistory } = await import('../lib/history.js')
  // Monthly_History: Label | From | To | Employee | Clients | Completed |
  // Pending | Vehicles | Monitored | Source
  setScheduleData({
    employees: [
      { empId:'E1', name:'Naveen', start:8, end:17, isNight:false },
      { empId:'E2', name:'Nesiya', start:8, end:17, isNight:false },
    ],
    timings: { X: [8] }, employeeHours: {},
  })
  const rows = [
    ['Month','From','To','Employee','Clients','Completed','Pending','Vehicles','Monitored','Source'],
    ['June 2026','01/06/2026','30/06/2026','Naveen','4500','4500','0','61000','9800','imported'],
    ['July 2026','01/07/2026','31/07/2026','naveen','4700','4700','0','63000','10100','imported'],
    ['June 2026','01/06/2026','30/06/2026','Nesiya','4300','4300','0','59000','9400','imported'],
  ]
  const h = buildHistory(rows)
  ok(!!h && Array.isArray(h.periods), 'the history did not come back in a shape the screens can read')
  ok(h.periods.length === 2, `expected two months, got ${h.periods?.length}`)
  ok(!!h.byEmployee?.Naveen, `an employee with history is missing: ${JSON.stringify(Object.keys(h.byEmployee||{}))}`)
  // "naveen" in the sheet must fold onto the rostered "Naveen", or a month of
  // somebody's work sits under a second name nobody recognises.
  ok((h.byEmployee?.Naveen?.clients || 0) === 9200,
     `Naveen's two months should total 9200 clients, got ${h.byEmployee?.Naveen?.clients}`)
  ok((h.byEmployee?.Naveen?.months || []).length === 2, `Naveen should have 2 months listed`)
  const june = h.periods.find(p => p.label === 'June 2026')
  ok(june && june.clients === 8800, `June should total 8800 clients across both people, got ${june?.clients}`)
  console.log(`   ${h.periods.length} months · ${Object.keys(h.byEmployee||{}).length} people · Naveen ${h.byEmployee?.Naveen?.clients} clients across ${h.byEmployee?.Naveen?.months?.length} months`)
}

// ══ 4 · A fixed-client holder is left out of the rotation ══════════════
rule(4, 'Somebody on fixed clients is not handed anybody else\'s work')
{
  const people = [
    { empId:'E1', name:'Fixed', start:8, end:17, isNight:false },
    { empId:'E2', name:'Bea',   start:8, end:17, isNight:false },
    { empId:'E3', name:'Cara',  start:8, end:17, isNight:false },
    { empId:'E4', name:'Dev',   start:8, end:17, isNight:false },
  ]
  const { vehicleMap } = makeFloor({
    people, perHour: { 8: 40 },
    employeeHours: { Fixed: { 8: { clients: ['H8_C1','H8_C2'], text: '' } } },
  })
  vehicleMap['h8_c1'] ||= { vehicleCount: 9 }
  vehicleMap['h8_c2'] ||= { vehicleCount: 9 }

  const dist = distributeClientsForHour(8, ['Fixed','Bea','Cara','Dev'], vehicleMap, {}, true)
  const fixed = (dist['Fixed'] || []).map(c => c.client)
  ok(fixed.length === 2 && fixed.includes('H8_C1') && fixed.includes('H8_C2'),
     `the fixed-client holder got ${JSON.stringify(fixed)} — should be exactly their two named clients`)

  // Now one of the others leaves. The rotation is the three ordinary holders,
  // and Fixed must not be among the people it lands on.
  const after = distributeClientsForHour(8, ['Fixed','Bea','Cara'], vehicleMap, {}, true)
  const fixedAfter = (after['Fixed'] || []).map(c => c.client)
  ok(fixedAfter.length === 2, `after a colleague left, the fixed-client holder was handed ${fixedAfter.length} clients`)
  console.log(`   Fixed keeps exactly ${fixedAfter.length}; the other ${40 - 2} split between the rest`)
}

// ══ 5 · The automatic break starts when they stopped ═══════════════════
rule(5, 'An automatic break is backdated to the last activity, not to the threshold')
{
  const nowIST = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const NOW = nowIST()
  const p2 = (n) => String(n).padStart(2,'0')
  const clockOf = (d) => { let h=d.getHours(); const a=h>=12?'pm':'am'; h=h%12||12; return `${p2(h)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${a}` }
  const opDayOf = (d) => { const x=new Date(d); if (x.getHours()<7) x.setDate(x.getDate()-1); return `${p2(x.getDate())}/${p2(x.getMonth()+1)}/${x.getFullYear()}` }
  const minsAgo = (m) => new Date(NOW.getTime() - m*60000)

  const clockIn = minsAgo(180), stopped = minsAgo(12)
  // Each row carries the operating day of ITS OWN moment, exactly as the
  // platform writes them — a clock-in at 06:45 belongs to the day that began
  // at 7am YESTERDAY. And the candidate dates are the ones recentDates()
  // produces, which are anchored to now, not to the clock-in: deriving them
  // from the clock-in left the current operating day off the list, so a
  // heartbeat recorded this morning could not resolve at all and the idle
  // calculation fell back to the start of the shift.
  const opDay = opDayOf(clockIn)
  const prevOfNow = new Date(NOW); prevOfNow.setDate(prevOfNow.getDate()-1)
  const dates = [opDayOf(NOW), opDayOf(prevOfNow)]
  const ctx = {
    shiftRows: [HEAD, ['E9','Naveen',opDay,clockOf(clockIn),'','','Active',clockOf(stopped)]],
    updateRows: [HEAD], breakRows: [HEAD],
    dates, nowMs: NOW.getTime(), overridesMap: {},
  }
  const opened = evaluateAutoBreak({ empId:'E9', name:'Naveen' }, ctx, opDay)
  ok(opened !== null, `twelve minutes of silence did not open a break`)
  ok(opened && opened[3] === clockOf(stopped),
     `the break should read from ${clockOf(stopped)} — when they stopped — not from the ten-minute mark; got ${opened && opened[3]}`)

  // Nine minutes is not a break.
  const ctx9 = { ...ctx, shiftRows: [HEAD, ['E9','Naveen',opDay,clockOf(clockIn),'','','Active',clockOf(minsAgo(9))]] }
  ok(evaluateAutoBreak({ empId:'E9', name:'Naveen' }, ctx9, opDay) === null,
     `nine minutes of quiet opened a break; the threshold is ${AUTO_BREAK_IDLE_MINUTES}`)
  console.log(`   stopped ${clockOf(stopped)} → break from ${opened[3]} (not from the threshold) · 9 min → no break`)
}

// ══ 6 · The shift window, and the make-up hour ═════════════════════════
rule(6, 'Login hour + 9 hours, plus one if past the half hour')
{
  const emp = { empId:'E1', name:'Win', start:8, end:17, isNight:false }
  const at = (h, mi) => new Date(2026, 7, 20, h, mi, 0, 0)
  const w = (h, mi) => computeShiftWindow(emp, at(h, mi))

  ok(w(8, 0).end === 17,  `08:00 → should end 17, got ${w(8,0).end}`)
  ok(w(8, 30).end === 17, `08:30 → still inside the half hour, should end 17, got ${w(8,30).end}`)
  ok(w(8, 31).end === 18, `08:31 → past the half hour, should end 18, got ${w(8,31).end}`)
  ok(w(8, 59).end === 18, `08:59 → should end 18, got ${w(8,59).end}`)

  ok(w(11, 0).start === 11 && w(11, 0).end === 20, `11:00 → should be 11–20, got ${w(11,0).start}–${w(11,0).end}`)
  ok(w(11, 30).end === 20, `11:30 → should end 20, got ${w(11,30).end}`)
  ok(w(11, 31).end === 21, `11:31 → should end 21, got ${w(11,31).end}`)
  ok(w(11, 59).end === 21, `11:59 → should end 21, got ${w(11,59).end}`)

  // Early counts the same way.
  ok(w(6, 45).start === 6 && w(6, 45).end === 16, `06:45 early → should be 6–16, got ${w(6,45).start}–${w(6,45).end}`)
  console.log(`   8:30→17 · 8:31→18 · 11:30→20 · 11:31→21 · 6:45→6–16`)
}

// ══ 7 · Equal by vehicles, and handed back on the way out ══════════════
rule(7, 'One person takes the lot; more people share it; a leaver gives it back')
{
  const people = [
    { empId:'E1', name:'One',   start:8, end:17, isNight:false },
    { empId:'E2', name:'Two',   start:8, end:17, isNight:false },
    { empId:'E3', name:'Three', start:8, end:17, isNight:false },
  ]
  const { vehicleMap } = makeFloor({ people, perHour: { 8: 80 } })
  const vehiclesOf = (list) => list.reduce((s,c) => s + (vehicleMap[c.toLowerCase()]?.vehicleCount || 0), 0)

  const d1 = distributeClientsForHour(8, ['One'], vehicleMap, {}, true)
  ok((d1['One']||[]).length === 80, `working alone should be all 80, got ${(d1['One']||[]).length}`)

  const d2 = distributeClientsForHour(8, ['One','Two'], vehicleMap, {}, true)
  const v2 = ['One','Two'].map(n => vehiclesOf((d2[n]||[]).map(c=>c.client)))
  const spread2 = Math.max(...v2) - Math.min(...v2)
  ok((d2['One']||[]).length + (d2['Two']||[]).length === 80, `two people should still cover all 80`)
  ok(spread2 <= Math.max(...v2) * 0.12, `two-way split is uneven by vehicles: ${v2.join(' / ')}`)

  const d3 = distributeClientsForHour(8, ['One','Two','Three'], vehicleMap, {}, true)
  const v3 = ['One','Two','Three'].map(n => vehiclesOf((d3[n]||[]).map(c=>c.client)))
  const spread3 = Math.max(...v3) - Math.min(...v3)
  ok(v3.reduce((a,b)=>a+b,0) === vehiclesOf(Object.keys(vehicleMap).map(k=>k)), 'a vehicle went missing in the three-way split') // total preserved
  ok(spread3 <= Math.max(...v3) * 0.12, `three-way split is uneven by vehicles: ${v3.join(' / ')}`)

  // And the hand-back, through the plan: Three goes home mid-hour.
  const OVR = { One:{start:8,end:17}, Two:{start:8,end:17}, Three:{start:8,end:17} }
  const after = planWith(vehicleMap, {
    nowHour: 8,
    shifts: [
      shiftRow('E1','One','08:01:00 am','','Active'),
      shiftRow('E2','Two','08:02:00 am','','Active'),
      shiftRow('E3','Three','08:03:00 am','08:20:00 am','Ended'),
    ],
    overridesMap: OVR,
  })
  ok(held(after,'Three',8).length === 0, `somebody who went home still holds ${held(after,'Three',8).length} clients`)
  ok(held(after,'One',8).length + held(after,'Two',8).length === 80,
     `after the leaver, ${held(after,'One',8).length + held(after,'Two',8).length} of 80 clients are on a board`)
  console.log(`   1 person: 80 · 2: ${(d2['One']||[]).length}/${(d2['Two']||[]).length} · 3: ${v3.map((v,i)=>(d3[['One','Two','Three'][i]]||[]).length).join('/')} · leaver hands back all 80`)
}

// ══ 8 · Two layers of the idle rule ════════════════════════════════════
rule(8, 'Cursor first; when the machine is off, the last update decides')
{
  const nowIST = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const NOW = nowIST()
  const p2 = (n) => String(n).padStart(2,'0')
  const clockOf = (d) => { let h=d.getHours(); const a=h>=12?'pm':'am'; h=h%12||12; return `${p2(h)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${a}` }
  const opDayOf = (d) => { const x=new Date(d); if (x.getHours()<7) x.setDate(x.getDate()-1); return `${p2(x.getDate())}/${p2(x.getMonth()+1)}/${x.getFullYear()}` }
  const minsAgo = (m) => new Date(NOW.getTime() - m*60000)
  const EMP = { empId:'E9', name:'Naveen' }

  const clockIn = minsAgo(200)
  // Per-row operating days, and candidate dates anchored to now — see rule 5.
  const opDay = opDayOf(clockIn)
  const prevOfNow = new Date(NOW); prevOfNow.setDate(prevOfNow.getDate()-1)
  const dates = [opDayOf(NOW), opDayOf(prevOfNow)]

  // Layer 1 — the browser's reading, passed in as the override.
  const base = {
    shiftRows: [HEAD, ['E9','Naveen',opDay,clockOf(clockIn),'','','Active','']],
    updateRows: [HEAD], breakRows: [HEAD], dates, nowMs: NOW.getTime(), overridesMap: {},
  }
  const moved9 = { ...base, heartbeatOverride: { E9: minsAgo(9).getTime() } }
  ok(evaluateAutoBreak(EMP, moved9, opDay) === null, 'the cursor moved nine minutes ago and a break was opened anyway')

  const moved12 = { ...base, heartbeatOverride: { E9: minsAgo(12).getTime() } }
  ok(evaluateAutoBreak(EMP, moved12, opDay) !== null, 'the cursor has not moved for twelve minutes and no break was opened')

  // Layer 2 — nothing from the browser at all, because the machine is off.
  // The decision falls to the last thing they recorded.
  const savedRecently = {
    ...base,
    updateRows: [HEAD, [opDayOf(minsAgo(4)), clockOf(minsAgo(4)), 'Naveen', 'X', '9', 'All Good', '', '0', 'No', '0', '', '5']],
  }
  ok(evaluateAutoBreak(EMP, savedRecently, opDay) === null,
     'they saved a client four minutes ago and were still put on a break')

  const savedLongAgo = {
    ...base,
    updateRows: [HEAD, [opDayOf(minsAgo(25)), clockOf(minsAgo(25)), 'Naveen', 'X', '9', 'All Good', '', '0', 'No', '0', '', '5']],
  }
  const opened = evaluateAutoBreak(EMP, savedLongAgo, opDay)
  ok(opened !== null, 'the machine is off and nothing has been recorded for 25 minutes — no break was opened')
  ok(opened && opened[3] === clockOf(minsAgo(25)),
     `the break should read from the last update (${clockOf(minsAgo(25))}), got ${opened && opened[3]}`)
  ok(opened && opened[7] === 'Auto', 'the break was not marked automatic')

  // And a resume counts as being back.
  const resumed = {
    ...base,
    breakRows: [HEAD, ['E9','Naveen',opDayOf(minsAgo(40)),clockOf(minsAgo(40)),clockOf(minsAgo(2)),38,'Completed','Auto']],
  }
  ok(lastActivityAt(EMP, resumed) === minsAgo(2).getTime(), 'resuming was not read as activity')
  ok(evaluateAutoBreak(EMP, resumed, opDay) === null, 'a break was re-opened two minutes after Resume')
  console.log(`   cursor 9m → no break, 12m → break · saved 4m ago → no break, 25m → break from the update · resume counts`)
}

// ══ 9 · The admin's attendance register ════════════════════════════════
// Run through the REAL admin endpoint, with the Sheets client replaced by a
// recorder — so this proves the whole chain the admin actually sees, not a
// helper that might not be the one the screen reads.
rule(9, 'In, out and total break, per employee, on the admin Dashboard')
{
  process.env.CRM_SHEET_ID = 'crm-book'
  process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
  process.env.SOURCE_SHEET_ID = 'source-book'
  process.env.JWT_SECRET = 'test-secret'

  const { behaviour, reset } = await import('./fake-googleapis.mjs')
  const sheetsLib = await import('../lib/sheets.js')
  const { signToken } = await import('../lib/auth.js')
  const overview = (await import('../pages/api/admin/overview.js')).default

  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const p2 = (n) => String(n).padStart(2, '0')
  const TODAY = `${p2(now.getDate())}/${p2(now.getMonth() + 1)}/${now.getFullYear()}`
  const H = now.getHours()

  reset()
  ;['crm-book','source-book','issue-book'].forEach(b => sheetsLib.invalidateSheetCache(b, ''))
  globalThis.__cautioSheets.vehicle = { data: null, at: 0 }
  globalThis.__cautioRoster = { lastGood: null }
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ['E1','Aisha','x','employee',String(H),String((H+9)%24),'No','No'],
      ['E2','Bilal','x','employee',String(H),String((H+9)%24),'No','No']],
    'Client_Timings!A:B': [['Client','Hours'], ['ClientA', String(H)], ['ClientB', String(H)]],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed','Custom']],
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status',''],
      ['E1','Aisha',TODAY,'09:02:00 am','06:04:00 pm','9h 2m','Ended',''],
      ['E2','Bilal',TODAY,'08:58:00 am','','','Active','']],
    'CRM_Updates!A:L': [['Date','Time','Emp','Client','Hour','Status','','','','','','']],
    'Breaks!A:H': [['EmpID','Name','Date','Start','End','Mins','Type',''],
      ['E1','Aisha',TODAY,'11:00:00 am','11:20:00 am','20','Completed','Manual'],
      ['E1','Aisha',TODAY,'03:00:00 pm','03:15:00 pm','15','Completed','Auto'],
      ['E2','Bilal',TODAY,'10:00:00 am','10:10:00 am','10','Completed','Auto']],
    'Leaves!A:H': [['EmpID','Name','Date','From','To','Reason','By','At']],
    'Shift_Overrides!A:H': [['EmpID','Name','Date','Start','End','Type','','']],
    'Redistribution_Log!A:G': [['Date','Time','From','To','Client','Hour','']],
    'Daily_Summary!A:N': [['Date','Employee']],
    'Footage_Followup!A:J': [['Date','Time','IssueId','Client','Veh','From','To','Status','','']],
    'Issues- Realtime!A:T': [new Array(20).fill('h')],
    'Infants!A:B': [['Client','Vehicle']],
    'Others!A:B': [['Client','Vehicle'], ['ClientA','KA1'], ['ClientB','KA2']],
  }

  const req = {
    method: 'GET', query: {},
    cookies: { cautio_token: signToken({ name: 'Admin', empId: 'A1', role: 'admin' }) },
    headers: {},
  }
  let body = null, code = 200
  const res = { status(c) { code = c; return res }, json(x) { body = x; return res }, end() { return res } }
  await overview(req, res)

  ok(code === 200, `the admin Dashboard answered ${code}`)
  const list = body?.employees || []
  const a = list.find(e => e.name === 'Aisha')
  const b = list.find(e => e.name === 'Bilal')

  ok(!!a, 'Aisha is missing from the admin Dashboard entirely')
  ok(a?.startTime === '09:02:00 am', `Aisha's clock-in reads ${a?.startTime}`)
  ok(a?.endTime === '06:04:00 pm', `Aisha's clock-out reads ${a?.endTime}`)
  ok(a?.breakMinutes === 35, `Aisha's break total reads ${a?.breakMinutes}, should be 35 (20 + 15)`)

  ok(!!b, 'Bilal is missing from the admin Dashboard entirely')
  ok(b?.startTime === '08:58:00 am', `Bilal's clock-in reads ${b?.startTime}`)
  ok(!b?.endTime, `Bilal is still on shift but shows a clock-out of ${b?.endTime}`)
  ok(b?.breakMinutes === 10, `Bilal's break total reads ${b?.breakMinutes}`)

  console.log(`   Aisha in ${a?.startTime} out ${a?.endTime} break ${a?.breakMinutes}m`)
  console.log(`   Bilal in ${b?.startTime} still on shift, break ${b?.breakMinutes}m`)
}

// ── Summary, rule by rule ──────────────────────────────────────────────
console.log('\n──────────────────────────────────────────────')
Object.entries(rules).forEach(([n, r]) => {
  console.log(`  ${r.fail === 0 ? '✓' : '✗'}  ${n}. ${r.title}${r.fail ? `  — ${r.fail} failed` : ''}`)
})
console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
