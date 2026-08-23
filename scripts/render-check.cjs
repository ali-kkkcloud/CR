// Renders the real screens in a real browser against CANNED data.
//
//   npx next build && npx next start -p 3100
//   node scripts/render-check.cjs
//
//
// Every /api/ request is answered inside the browser, so the spreadsheet is
// never contacted — this can be run while the floor is live. What it catches
// is the thing a server-side test cannot: a component that throws while
// rendering, which the user sees as "Application error: a client-side
// exception has occurred" and a white page.
const { chromium } = require('/opt/node22/lib/node_modules/playwright')

const BASE = process.env.BASE || 'http://localhost:3100'

// ── canned data, shaped like the real payloads ────────────────────────
const NAMES = ['Sunil','Mahesh','Nikita','BRINDA','Nesiya','Rakesh','GUNASAGARI','HARI','KIRAN','MANTU','CHANDAN','RISHI','Ritanjali','Shashi','Yunus','Afzal','Darshan','Naveen','NewJoiner']

const emp = (name, i) => ({
  name, shiftStart: 7 + (i % 3), shiftEnd: 16 + (i % 3),
  effStart: 7 + (i % 3), effEnd: 16 + (i % 3), isAdjusted: i % 5 === 0,
  isScheduledNow: i % 2 === 0, shiftOverdue: false, shiftStale: i === 3,
  onBreakLong: i === 4, isNight: i % 7 === 0, isWeekOff: i % 6 === 0,
  statusLabel: ['Active','Not Started','Ended','Week Off','Off Shift','Left Open'][i % 6],
  startTime: i % 6 === 1 ? '' : '07:0' + (i % 9) + ':00 am',
  endTime: i % 6 === 2 ? '04:00:00 pm' : '',
  duration: '9h 0m',
  totalUpdates: i * 2, assignedCount: i * 5, pendingCount: i * 3,
  breakMinutes: i * 4, breakSessions: i % 3, autoBreaks: i % 2,
  breakOpenSince: i === 4 ? '12:00:00 pm' : null,
})

const history = {
  periods: [
    { label:'June 2026', from:'01/06/2026', to:'30/06/2026', people:15, clients:78990, completed:29424, pending:49566, vehicles:1079335, monitored:155865 },
    { label:'July 2026', from:'01/07/2026', to:'31/07/2026', people:16, clients:84422, completed:31696, pending:52726, vehicles:1279173, monitored:197912 },
    { label:'August 2026 (1–18)', from:'01/08/2026', to:'18/08/2026', people:18, clients:47910, completed:19679, pending:28231, vehicles:702196, monitored:131024 },
  ],
  byEmployee: Object.fromEntries(NAMES.slice(0, 18).map((n, i) => [n, {
    name: n, onRoster: i < 17,
    months: [
      { label:'June 2026', from:'01/06/2026', to:'30/06/2026', name:n, onRoster:true, clients:6463, completed:3141, pending:3322, vehicles:88562, monitored:20575, source:'imported' },
      { label:'July 2026', from:'01/07/2026', to:'31/07/2026', name:n, onRoster:true, clients:6365, completed:2503, pending:3862, vehicles:104277, monitored:18751, source:'imported' },
    ],
    clients:12828, completed:5644, pending:7184, vehicles:192839, monitored:39326,
  }])),
  totals: { clients:211322, completed:80799, pending:130523, vehicles:3060704, monitored:484801 },
}

const HOURS = [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,0,1,2,3,4,5,6]
const clientsFor = (h, n) => Array.from({ length: n }, (_, i) => ({
  client: `Client ${h}-${i}`, vehicleCount: 10 + i, filled: i % 3 === 0,
  status: i % 3 === 0 ? 'All Good' : '', updatedAt: i % 3 === 0 ? '08:10:00 am' : '',
  alertCount: i % 4, misalignVehicles: 0, misalignList: '', fatigue: '', fatigueCount: 0,
  liveVehicles: i % 3 === 0 ? 12 : 0, isRedistributed: i === 1, fromEmployee: i === 1 ? 'Rakesh' : undefined,
}))

const overview = {
  employees: NAMES.map(emp),
  // Clients with no update against them all day — the 'Not updated' tab.
  staleClients: [
    { client:'Cityflo_Mumbai', vehicleCount:561, done:0, pending:3,
      slots:[{hour:16,owner:'Nesiya',done:false},{hour:12,owner:'BRINDA',done:false},{hour:8,owner:'Sunil',done:false}],
      lastOwner:'Nesiya', firstHour:8 },
    { client:'Shatabdi Travels', vehicleCount:12, done:0, pending:1,
      slots:[{hour:9,owner:'HARI',done:false}], lastOwner:'HARI', firstHour:9 },
  ],
  workload: {
    byHour: HOURS.map((h, i) => ({ hour: h, passed: i < 4, clients: 40 + i, vehicles: 500 + i * 7, done: i })),
    soFar:   { clients: 300, clientsDone: 120, vehicles: 4000, vehiclesChecked: 1500, alerts: 4, fatigue: 1, alertsTotal: 5 },
    fullDay: { clients: 2704, clientsDone: 120, vehicles: 30000, vehiclesChecked: 1500, alerts: 4, fatigue: 1, alertsTotal: 5 },
    perEmployee: NAMES.map((n, i) => ({
      name: n, isWeekOff: i % 6 === 0, expectedClients: i * 7, expectedVehicles: i * 90,
      expectedHours: 9, clientsDone: i, vehiclesChecked: i * 3, alerts: i % 3, fatigue: 0,
      alertsTotal: i % 3, footageRaised: i % 2, footageDone: 0,
    })),
  },
  rosterIssues: [{ empId:'EMP099', name:'Ghost', reason:'no shift hours set in Credentials' }],
  clientIssues: [{ client:'VARAHI TOURS AND TRAVELS', reason:'no hours set in Client_Timings' }],
  coverageGaps: [{ hour: 12, clients: 60, due: 160, reason: 'no-staff', past: true, sample: ['A','B','C'] }],
  redistribution: [{ from:'Rakesh', to:'Sunil', client:'Euro Cars', hour:8 }],
  history,
  footage: { pending: 12, done: 3 },
  kpis: { total: NAMES.length, active: 6, weekOff: 3, notStarted: 4, updatesToday: 120, pendingToday: 80 },
}

const fullDay = {
  date: '19/08/2026',
  employees: NAMES.map((n, i) => ({
    name: n, shiftStart: 7, shiftEnd: 16, effectiveStart: 7, effectiveEnd: 16,
    usedEarlyStart: false, usedOT: false, isNight: false, loggedIn: i % 3 !== 1,
    startTime: i % 3 === 1 ? '' : '07:05:00 am', endTime: '', duration: '', status: 'Working',
    shiftStale: false, leaves: [],
    hours: HOURS.slice(0, 9).map((h, k) => ({
      hour: h, isOnLeave: k === 8, leaveReason: k === 8 ? 'Week Off' : '',
      isCustom: k === 5, customText: k === 5 ? 'Night Fleet Update' : undefined,
      clients: k === 5 || k === 8 ? [] : clientsFor(h, 6),
      totalClients: k === 5 || k === 8 ? 0 : 6, completedClients: 2, missedClients: 4,
    })),
    totalAssigned: 48, totalCompleted: 16, totalMissed: 32, totalAlerts: 3,
    totalFatigue: 0, totalMisalign: 1, totalRedistributed: 2,
  })),
}

const summary = {
  range: 'month', performanceScore: 72, performanceTier: 'Good',
  clientsAssigned: 120, vehiclesCovered: 900, updatesCompleted: 80, updatesMissed: 40,
  misalignCount: 2, alertTotal: 5, footageTaken: 4, footagePending: 2,
  followupsClosed: 1, followupsPending: 0,
  trend: { labels: ['21 Jul','05 Aug','19 Aug'], completed: [3,8,5], missed: [1,0,2] },
  attendanceStatus: 'On Time', loginTime: '07:05:00 am', workingMinutes: 130,
  shiftStart: 7, shiftEnd: 16, scheduledStart: 7, scheduledEnd: 16,
  usedEarlyStart: false, usedOT: false, isNight: false,
  calendar: HOURS.slice(0, 20).map((h, i) => ({ date: `${(i % 28) + 1}/08/2026`, status: ['worked','leave','weekoff','upcoming'][i % 4] })),
  topClients: [{ client: 'Zingbus', count: 9 }],
  recentActivity: [{ time: '08:10 am', label: 'Client updated', client: 'Zingbus', detail: '12 vehicles', type: 'update' }],
  today: { clientsAssigned: 183, clientsCompleted: 12, vehiclesAssigned: 2470, vehiclesCompleted: 300, updatesAssigned: 183, updatesCompleted: 12, footageAssigned: 0, footageCompleted: 0, followupsAssigned: 0, followupsCompleted: 0 },
  history: history.byEmployee['Sunil'],
}

const myDay = {
  date: '19/08/2026',
  timeline: HOURS.slice(0, 9).map((h, k) => ({
    hour: h, isOnLeave: k === 8, leaveReason: k === 8 ? 'Week Off' : '',
    isCustom: k === 5, customText: k === 5 ? 'Night Fleet Update' : undefined,
    clients: k === 8 ? [] : (k === 5 ? [{ client: 'Night Fleet Update', isCustom: true, filled: false }] : clientsFor(h, 6)),
    totalClients: k === 5 || k === 8 ? 0 : 6, completedClients: 2, missedClients: 4,
  })),
  totalClients: 42, totalCompleted: 14, totalMissed: 28, totalPending: 28,
}

const ROUTES = {
  '/api/auth/me':                 () => ({ user: { name: 'Sunil', empId: 'EMP008', role: 'employee' } }),
  '/api/admin/overview':          () => overview,
  '/api/admin/full-day-view':     () => fullDay,
  '/api/admin/breaks':            () => ({ employees: NAMES.slice(0,5).map((n,i)=>({ name:n, sessions:i, autoSessions:i%2, totalMinutes:i*7, currentlyOnBreak:i===0, activeSince:'12:00:00 pm', activeDate:'19/08/2026', activeIsAuto:true })), onBreakNow: 1, sessions: [] }),
  '/api/admin/employee-progress': () => ({ progress: NAMES.map((n,i)=>({ name:n, shiftStart:7, shiftEnd:16, isNight:false, attendance:[{date:'19/08/2026',status:'active',startTime:'07:05:00 am',endTime:'',duration:''}], daysPresent:1, daysAbsent:0, totalDaysInRange:1, rangeClientsCount:i, rangeAssignedCount:i*4, rangeUpdatesCount:i, rangePendingCount:i*3, rangeVehiclesAssigned:i*50, rangeVehiclesChecked:i*10, rangeMisaligns:i%3, rangeAlerts:i%4, footagePending:i%2, footageCompletedInRange:0, daysFromHistory:2 })), dates:['19/08/2026'], from:'19/08/2026', to:'19/08/2026', history }),
  '/api/footage/list':            () => ({ pending: [{ issueId:'ISS1', client:'Zingbus', vehicle:'KA01AB1234', raisedAt:'19/08/2026, 08:00:00 am', raisedBy:'Sunil', details:'need clip' }], completed: [], followups: [] }),
  '/api/shift/status':            () => ({ status: 'active', startTime: '07:05:00 am', shiftDate: '19/08/2026' }),
  '/api/clients/current':         () => ({ hour: 8, clients: clientsFor(8, 21), filled: {} }),
  '/api/dashboard/my-day':        () => myDay,
  '/api/dashboard/summary':       () => summary,
  '/api/break/status':            () => ({ onBreak: false, startTime: null, history: [], totalMinutesToday: 12, isAuto: false, idleMinutes: 10 }),
  '/api/footage/followup-options':() => ({ active: [], others: [] }),
}

// ── the same screens, on data that is missing pieces ──────────────────
//
// A live floor produces shapes a happy-path fixture never will: a brand-new
// employee who is on no list yet, an hour with no clients array at all, a
// history that failed to load, a name in one payload and not in the next.
// This is where a white screen actually comes from, so it is worth asking for
// on purpose rather than waiting for somebody to hit it.
function hollow(x) {
  if (Array.isArray(x)) return x.map(hollow)
  if (x && typeof x === 'object') {
    const out = {}
    Object.entries(x).forEach(([k, v], i) => {
      // Drop roughly a third of the keys, and null a third of what is left.
      if (i % 3 === 0) return
      out[k] = i % 3 === 1 ? null : hollow(v)
    })
    return out
  }
  return x
}

const SPARSE = {
  '/api/auth/me':                 () => ({ user: { name: 'NewJoiner', empId: 'EMP099', role: 'employee' } }),
  '/api/admin/overview':          () => ({
    // A roster with a brand-new person nothing else knows about, an employee
    // row with no times at all, and no history.
    employees: [
      { name: 'NewJoiner', statusLabel: 'Not Started' },
      { name: 'Halfling', statusLabel: 'Active', startTime: null, endTime: null, effStart: null, effEnd: null },
      ...NAMES.slice(0, 3).map(emp),
    ],
    workload: { byHour: [], soFar: {}, fullDay: {}, perEmployee: [] },
    rosterIssues: [], clientIssues: [], coverageGaps: [], redistribution: [],
    staleClients: [],
    footage: { pending: 0, done: 0 }, kpis: {},
  }),
  '/api/admin/full-day-view':     () => ({ date: '19/08/2026', employees: [
    { name: 'NewJoiner', hours: [], leaves: [] },
    { name: 'Halfling', hours: [{ hour: 8 }], leaves: [] },
  ] }),
  '/api/admin/breaks':            () => ({ employees: [], onBreakNow: 0, sessions: [] }),
  '/api/admin/employee-progress': () => ({ progress: [{ name: 'NewJoiner' }], dates: [], from: '', to: '' }),
  '/api/footage/list':            () => ({ pending: [], completed: [], followups: [] }),
  '/api/shift/status':            () => ({ status: 'not_started' }),
  '/api/clients/current':         () => ({ hour: 8, clients: [] }),
  '/api/dashboard/my-day':        () => ({ date: '19/08/2026', timeline: [{ hour: 8 }], totalClients: 0 }),
  '/api/dashboard/summary':       () => ({
    range: 'month', trend: { labels: [], completed: [], missed: [] },
    today: {}, calendar: [], topClients: [], recentActivity: [],
    history: { name: 'NewJoiner' },     // no months array at all
  }),
  '/api/break/status':            () => ({ onBreak: false }),
  '/api/footage/followup-options':() => ({ active: [], others: [] }),
}

// ── The combined poll ──────────────────────────────────────────────────
//
// The dashboard's thirty-second refresh is one request now, not six — see
// pages/api/dashboard/tick.js. It is built here out of the SAME six fixtures
// the individual endpoints answer with, so the two can never disagree about
// what a payload looks like.
//
// The sparse pass deliberately drops three of the six. A section that could
// not be produced comes back as null, and the page has to keep whatever it
// already had on screen for that panel rather than blanking it.
ROUTES['/api/dashboard/tick'] = () => ({
  clients:     ROUTES['/api/clients/current'](),
  myDay:       ROUTES['/api/dashboard/my-day'](),
  summary:     ROUTES['/api/dashboard/summary'](),
  footage:     ROUTES['/api/footage/list'](),
  breakStatus: ROUTES['/api/break/status'](),
  shiftStatus: ROUTES['/api/shift/status'](),
})
SPARSE['/api/dashboard/tick'] = () => ({
  clients:     SPARSE['/api/clients/current'](),
  myDay:       null,
  summary:     SPARSE['/api/dashboard/summary'](),
  footage:     null,
  breakStatus: null,
  shiftStatus: SPARSE['/api/shift/status'](),
})

;(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
  let problems = 0

  const PASSES = [
    ['full',   ROUTES],
    ['sparse', SPARSE],
  ]

  for (const [passName, TABLE] of PASSES) {
  console.log(`\n── ${passName} data ──`)
  for (const [label, path, tabs] of [
    // 'Work moved' and 'Not updated' are sub-tabs under Hour by hour; naming
    // them here makes the check click into them too, which is where a panel
    // that throws on its own data would otherwise go unnoticed.
    ['ADMIN',    '/admin',     ['Dashboard','Hour by hour','Work moved','Not updated','Requests','Team','More']],
    ['EMPLOYEE', '/dashboard', ['Board','Dashboard','Footage','Follow-ups']],
  ]) {
    const page = await b.newPage({ viewport: { width: 1440, height: 1000 } })
    const errs = []
    page.on('pageerror', e => errs.push(String(e && e.stack ? e.stack.split('\n').slice(0,3).join(' | ') : e)))
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text().slice(0, 300)) })
    page.on('response', r => { if (r.status() === 404) errs.push('404: ' + new URL(r.url()).pathname) })

    await page.route('**/api/**', route => {
      const u = new URL(route.request().url())
      const fn = TABLE[u.pathname]
      if (!fn) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fn()) })
    })
    // The admin page checks role; serve an admin identity there.
    if (label === 'ADMIN') {
      await page.route('**/api/auth/me', route => route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ user: { name: 'Admin', empId: 'ADMIN', role: 'admin' } }),
      }))
    }

    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)

    for (const tab of tabs) {
      for (const el of await page.$$('a,button')) {
        const t = ((await el.innerText().catch(() => '')) || '').trim()
        if (t === tab || t.startsWith(tab + ' ')) { await el.click().catch(() => {}); break }
      }
      await page.waitForTimeout(2500)
      const body = await page.evaluate(() => document.body.innerText).catch(() => '')
      const broke = /Application error|client-side exception/i.test(body)
      const caught = /could not be drawn/i.test(body)
      const mine = [...new Set(errs)].filter(e => !/404|Failed to load resource/.test(e))
      errs.length = 0
      if (broke) { problems++; console.log(`  BROKEN  ${label} › ${tab}  — the page died`) }
      else if (caught || mine.length) {
        problems++
        console.log(`  THREW   ${label} › ${tab}${caught ? '  (caught by the boundary — page stayed up)' : ''}`)
        mine.slice(0, 2).forEach(e => console.log('            ' + e.split('\n')[0]))
      }
      else console.log(`  ok      ${label} › ${tab}`)
    }
    await page.close()
  }
  }

  await b.close()
  console.log(problems === 0 ? '\nPASS  every screen rendered, no exceptions' : `\nFAIL  ${problems} problem(s)`)
  process.exit(problems === 0 ? 0 : 1)
})()
