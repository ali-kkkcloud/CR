import { getUserFromReq } from '../../../lib/auth'
import { getHistoryFor } from '../../../lib/history'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr, nowStr,
  fetchClientVehicleCounts, parseISTDateTime, parseOperatingDateTime, getShiftOverridesForDate,
  getLeaveMapForDate, getOnShiftNamesFromLog, getClockedOutNamesFromLog, getAwayOnBreakNames, yesterdayStr, TTL, warmTogether, SHIFT_SCREEN_TABS,
  businessDate,
} from '../../../lib/sheets'
import { employees, distributeClientsForHour } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { collapseSlotOwners, buildHourPool, buildLockedAssignments } from '../../../lib/distribution'
import { computeDayPlan } from '../../../lib/dayplan'
import { totalBreakMinutes } from '../../../lib/attendance'

const ISSUE_TAB = 'Issues- Realtime'
// Same real column layout as pages/api/footage/list.js
const COL = {
  ISSUE_ID: 1, CLIENT: 2, VEHICLE: 3, RAISED_AT: 4, RAISED_BY: 7,
  SUB_REQUEST: 9, DETAILS: 10, RESOLVED: 17, RESOLVED_AT: 18,
}

// ── Which OPERATING day a footage request belongs to ─────────────────
//
// The Issue Tracker stamps a request with the calendar moment it was raised:
// "23/08/2026, 01:14:00 am". Every date this platform files work under is the
// OPERATING day, 07:00 to 07:00 — so a request raised at one in the morning
// carries tomorrow's calendar date while belonging to the shift that began
// last evening.
//
// Comparing the two directly is the mistake that has caused nearly every
// night-shift fault here, and it did it again: a request raised after
// midnight counted for nobody in the day's footage total, so a night shift's
// score was worked out from a share of a number that did not include their
// own work.
function raisedOperatingDay(raisedAt) {
  const s = (raisedAt || '').toString().trim()
  if (!s) return ''
  const [datePart, ...rest] = s.split(',')
  const timePart = rest.join(',').trim()
  const d = parseISTDateTime((datePart || '').trim(), timePart || '12:00:00 pm')
  // Unparseable — fall back to the bare date rather than dropping the row.
  if (!d) return (datePart || '').trim().split(' ')[0]
  return businessDate(d)
}

function ddmmyyyy(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// Returns a Date object representing "now" as IST wall-clock time (so
// getDate()/getMonth()/getHours() etc. reflect IST, not the server's own
// timezone — Vercel's serverless functions run in UTC, which silently
// shifted date boundaries versus todayStr()'s explicit Asia/Kolkata calc).
function nowISTDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

function rangeDates(range) {
  const today = nowISTDate()
  let days
  if (range === 'today') days = 1
  else if (range === 'week') days = 7
  else if (range === 'year') days = 365
  else days = 30 // 'month' default
  const dates = []
  for (let i = 0; i < days; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    dates.push(d)
  }
  return dates.reverse()
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    // Every tab this screen needs, asked for in one go before anything else
    // runs — so they cost one request between them instead of one per stage.
    // See warmTogether in lib/sheets.
    await warmTogether(CRM_SHEET_ID, [...SHIFT_SCREEN_TABS, `${TABS.FOOTAGE_FOLLOWUP}!A:J`, `${TABS.DAILY_SUMMARY}!A:N`])

    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const range = (req.query.range || 'month').toString()
    const calendarToday = todayStr()
    const dates = rangeDates(range)
    const dateStrs = dates.map(ddmmyyyy)
    const dateStrSet = new Set(dateStrs)

    const emp = employees().find(e => e.name === user.name)

    // Resolve MY operating "shift date" — for a night shift that began
    // yesterday evening and is still running past midnight, everything
    // (attendance, today's targets, the active override) must stay
    // attached to the date the shift STARTED, not the new calendar date.
    const yesterday = yesterdayStr()
    const shiftLogPeek = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE)
    const myToday     = shiftLogPeek.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===calendarToday)
    const myYesterday = shiftLogPeek.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===yesterday)
    const today = (myToday.length === 0 && myYesterday.some(r => r[6] === 'Active')) ? yesterday : calendarToday

    const todayOverride = await getShiftOverridesForDate(today)
    const myOverride = todayOverride[user.name]

    const [updateRows, footageRows, followupRows, redistRows, shiftRows, breakRows, leaveRows, vehicleMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:L`, TTL.LIVE),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, TTL.ISSUES),
      readSheetCached(CRM_SHEET_ID, `${TABS.FOOTAGE_FOLLOWUP}!A:J`, TTL.QUEUE),
      readSheetCached(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID, `${TABS.LEAVES}!A:H`, TTL.DAY),
      fetchClientVehicleCounts(),
    ])

    // Each (date, client, hour) counts once, for whoever ended up owning it.
    // Without this an employee who covered an hour alone and then shared it
    // when colleagues clocked in was shown every client they briefly held as
    // one they had "missed", which dragged their completion rate down for
    // work somebody else went on to do.
    // Collapsed across everybody first — ownership of a slot is decided
    // between all the names on it, then the winner's rows are picked out.
    const ownedSlots = collapseSlotOwners(updateRows)
    const currentHourStr = String(nowISTDate().getHours())
    const myUpdatesAll = [...ownedSlots.values()]
      .filter(s => s.owner === user.name)
      // The hour in progress isn't finished, so nothing in it can have been
      // missed yet. Anything already done there still counts; what's left is
      // simply outstanding, and counting it as a miss would push somebody's
      // completion rate down for work they still have time to do.
      .filter(s => s.done || !(s.date === today && s.hour === currentHourStr))
      .map(s => s.row)
    const myUpdatesInRange = myUpdatesAll.filter(r => dateStrSet.has(r[0]))

    // ── Trend: Completed vs Missed per day (a CRM_Updates row exists the
    // moment a client is assigned — see clients/current.js — so "missed" is
    // simply an assigned row whose status column is still blank) ──
    const byDate = {}
    dateStrs.forEach(d => { byDate[d] = { completed: 0, missed: 0 } })
    myUpdatesInRange.forEach(r => {
      if (!byDate[r[0]]) return
      if ((r[5]||'').toString().trim()) byDate[r[0]].completed++
      else byDate[r[0]].missed++
    })
    // ── Days that are no longer in CRM_Updates ───────────────────────────
    //
    // The trend was built from CRM_Updates alone, and that tab only holds the
    // last few days: a finished day is summarised into Daily_Summary and the
    // detail is not kept for ever (see lib/rollup.js). Measured on the live
    // book — CRM_Updates held five days while the month asked for twenty-
    // three, so eighteen of the twenty-three points were zero. That is the
    // "trend mostly shows 0" the floor reported. Nothing was lost; the trend
    // was simply reading the one source that could not answer for those days.
    //
    // Daily_Summary is exactly the record for them. Used ONLY where
    // CRM_Updates has nothing for that date, so a day still held in full
    // always wins — the detail is the truth, the summary is the memory of it.
    let summaryRows = []
    try { summaryRows = await readSheetCached(CRM_SHEET_ID, `${TABS.DAILY_SUMMARY}!A:N`, TTL.ROSTER) }
    catch (e) { console.error('daily summary read failed:', e.message) }
    const daysWithDetail = new Set(myUpdatesInRange.map(r => r[0]))
    // Date | EmpID | Employee | Clients_Assigned | Clients_Completed | …
    summaryRows.slice(1).forEach(r => {
      const d = (r[0] || '').toString().trim()
      if (!byDate[d] || daysWithDetail.has(d)) return
      if ((r[2] || '').toString().trim() !== user.name) return
      const assigned  = parseInt(r[3], 10) || 0
      const completed = parseInt(r[4], 10) || 0
      byDate[d].completed = completed
      byDate[d].missed    = Math.max(0, assigned - completed)
      byDate[d].fromSummary = true
    })

    const trendLabels = range === 'today' ? ['Today'] : dates.map(d => d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'}))
    // For readability, collapse >31 points (year view) into weekly buckets
    let trendCompleted, trendMissed, trendLabelsFinal
    if (range === 'year') {
      const weeks = []
      for (let i=0;i<dateStrs.length;i+=7) weeks.push(dateStrs.slice(i,i+7))
      trendLabelsFinal = weeks.map((_,i) => `W${i+1}`)
      trendCompleted = weeks.map(w => w.reduce((s,d)=>s+byDate[d].completed,0))
      trendMissed = weeks.map(w => w.reduce((s,d)=>s+byDate[d].missed,0))
    } else {
      trendLabelsFinal = trendLabels
      trendCompleted = dateStrs.map(d => byDate[d].completed)
      trendMissed = dateStrs.map(d => byDate[d].missed)
    }

    const totalUpdatesCompleted = myUpdatesInRange.filter(r => (r[5]||'').toString().trim()).length
    const totalUpdatesMissed    = myUpdatesInRange.length - totalUpdatesCompleted
    const clientsAssigned = new Set(myUpdatesInRange.map(r => r[3])).size
    const misalignCount = myUpdatesInRange.filter(r => r[6] && r[6] !== '—').length
    const alertTotal = myUpdatesInRange.reduce((s,r) => s + (parseInt(r[7]) || 0), 0)

    let vehiclesCovered = 0
    const clientSet = new Set(myUpdatesInRange.map(r => r[3]))
    clientSet.forEach(c => { vehiclesCovered += vehicleMap[(c||'').toLowerCase()]?.vehicleCount || 0 })

    // ── Footage (real Issue Tracker layout — see footage/list.js) ──
    const myFootage = footageRows.slice(1).filter(r => {
      const sub = (r[COL.SUB_REQUEST] || '').toString().toLowerCase()
      const by  = (r[COL.RAISED_BY]   || '').toString().trim().toLowerCase()
      return sub.includes('customer request for video') && by === user.name.toLowerCase()
    })
    const myFootageInRange = myFootage.filter(r => dateStrSet.has(raisedOperatingDay(r[COL.RAISED_AT])) || range==='today')
    const footageResolved = (r) => (r[COL.RESOLVED]||'').toString().toLowerCase() === 'yes'
    const footageTaken   = myFootageInRange.filter(footageResolved).length
    const footagePending = myFootage.filter(r => !footageResolved(r)).length // pending is "live", not range-scoped

    // ── Follow-ups ──
    // Counted per REQUEST, not per row. The follow-up tab appends a row for
    // every hand-off, so a request passed on twice appeared as two pending
    // items — two on the count, and twice the penalty on the day's score, for
    // one piece of work. The last row for a request is where it stands.
    const latestFollowup = new Map()
    followupRows.slice(1).forEach(r => {
      const id = (r[2] || '').toString().trim()
      if (id) latestFollowup.set(id, r)
    })
    const myFollowups = [...latestFollowup.values()].filter(r => r[5]===user.name || r[6]===user.name)
    const followupsClosed  = myFollowups.filter(r => (r[7]||'').toString().toLowerCase().startsWith('closed')).length
    const followupsPending = myFollowups.filter(r => !(r[7]||'').toString().toLowerCase().startsWith('closed')).length

    // ── Attendance (today) ──
    let attendanceStatus = null, loginTime = null, workingMinutes = 0
    const myShiftRowsToday = shiftRows.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===today)
    const latestShift = myShiftRowsToday[myShiftRowsToday.length-1]
    if (latestShift) {
      loginTime = latestShift[3] || null
      if (emp && loginTime) {
        const loginDate = parseOperatingDateTime(today, loginTime)
        if (loginDate) {
          const graceMinutes = 10
          const scheduledStart = new Date(loginDate)
          scheduledStart.setHours(emp.start, graceMinutes, 0, 0)
          attendanceStatus = loginDate <= scheduledStart ? 'On Time' : 'Late'
        }
      }
      if (latestShift[6] === 'Active' && loginTime) {
        // Operating-day aware. The date column is the operating day, so a
        // clock-in in the small hours belongs to the calendar day after it —
        // read literally, somebody who started at 00:21 had been "working"
        // for twenty-four hours before they touched a client.
        const loginDate = parseOperatingDateTime(today, loginTime)
        // nowISTDate(), not Date.now(): parseISTDateTime builds its Date from
        // IST wall-clock components, so it only lines up with a "now" built
        // the same way. Comparing it against the real epoch subtracted the
        // whole IST offset and reported an employee who had been working
        // half an hour as having worked minus thirty minutes.
        if (loginDate) workingMinutes = Math.round((nowISTDate().getTime() - loginDate.getTime())/60000)
      } else if (latestShift[4]) {
        // Both resolved the same way, so a night shift clocking in at 22:00
        // and out at 06:00 reads as eight hours rather than as minus sixteen.
        const endDate = parseOperatingDateTime(today, latestShift[4])
        const loginDate = parseOperatingDateTime(today, loginTime)
        if (loginDate && endDate) workingMinutes = Math.round((endDate.getTime()-loginDate.getTime())/60000)
      }
    }

    // ── Leave map for the whole range (for calendar) ──
    const leavesByDate = {}
    leaveRows.slice(1).filter(r => r[1]===user.name).forEach(r => {
      if (!leavesByDate[r[2]]) leavesByDate[r[2]] = []
      leavesByDate[r[2]].push(r)
    })

    // ── Monthly calendar — Week Off / Leave / Worked / Upcoming ONLY.
    // No performance grading here (that lives in Updates Trend / Performance
    // Score) — this calendar is purely an attendance-style view. Week Off is
    // inferred as "no clients were assigned that day" (only knowable for
    // past dates — there's no recurring weekly-off schedule stored per
    // employee, so future Week Offs can't be predicted, only future Leaves
    // that an admin has already marked in advance).
    const now = nowISTDate()
    const calMonthDates = []
    for (let d=1; d<=31; d++) {
      const dt = new Date(now.getFullYear(), now.getMonth(), d)
      if (dt.getMonth() !== now.getMonth()) break
      calMonthDates.push(dt)
    }
    const calendar = calMonthDates.map(dt => {
      const ds = ddmmyyyy(dt)
      const isFuture = dt > now && ds !== today
      const onLeave = !!leavesByDate[ds]
      const dayRows = updateRows.slice(1).filter(r => r[2]===user.name && r[0]===ds)
      const total = dayRows.length
      const completed = dayRows.filter(r => (r[5]||'').toString().trim()).length
      let status
      if (onLeave) status = 'leave'               // leave can be marked in advance, so check before "future"
      else if (isFuture) status = 'upcoming'
      else if (total === 0) status = 'weekoff'
      else status = 'worked'
      return { date: ds, day: dt.getDate(), status, completed, total }
    })

    // ── Top clients (in range) ──
    const clientAgg = {}
    myUpdatesInRange.forEach(r => {
      const c = r[3]
      if (!clientAgg[c]) clientAgg[c] = { name:c, total:0, completed:0 }
      clientAgg[c].total++
      if ((r[5]||'').toString().trim()) clientAgg[c].completed++
    })
    const topClients = Object.values(clientAgg).map(c => ({
      ...c,
      vehicleCount: vehicleMap[(c.name||'').toLowerCase()]?.vehicleCount || 0,
      completionPct: c.total ? Math.round((c.completed/c.total)*100) : 0,
    })).sort((a,b) => b.vehicleCount-a.vehicleCount).slice(0,5)

    // ── Recent activity (last ~8 events, best-effort chronological) ──
    const events = []
    myUpdatesInRange.filter(r => (r[5]||'').toString().trim()).forEach(r => {
      const t = parseISTDateTime(r[0], r[1])
      events.push({ t, time:r[1], label:'CRM Updated', client:r[3], detail:r[3], type:'update' })
    })
    myFootageInRange.filter(footageResolved).forEach(r => {
      const [d,tm] = (r[COL.RESOLVED_AT]||'').split(',').map(s=>s?.trim())
      events.push({ t: d&&tm ? parseISTDateTime(d,tm) : null, time:tm||r[COL.RESOLVED_AT], label:'Footage Uploaded', client:r[COL.CLIENT], detail:`${r[COL.VEHICLE]}`, type:'footage' })
    })
    myFollowups.filter(r => (r[7]||'').toLowerCase().startsWith('closed') && dateStrSet.has(r[0])).forEach(r => {
      events.push({ t: parseISTDateTime(r[0], r[9]?.split(' ').slice(-3).join(' ')||r[1]), time:r[1], label:'Follow-up Closed', client:r[3], detail:`Issue #${r[2]}`, type:'followup' })
    })
    redistRows.slice(1).filter(r => r[3]===user.name && dateStrSet.has(r[0])).forEach(r => {
      events.push({ t: parseISTDateTime(r[0], r[1]), time:r[1], label:'Redistribution Received', client:r[4], detail:`From ${r[2]}`, type:'redistribution' })
    })
    const recentActivity = events
      .filter(e => e.t)
      .sort((a,b) => b.t - a.t)
      .slice(0, 8)
      .map(({t, ...rest}) => rest)

    // ══ Performance score ══════════════════════════════════════════════
    //
    // Three parts, and every number behind them is returned alongside the
    // score so the employee can see how it was arrived at rather than being
    // handed a figure to argue with.
    //
    //   FOOTAGE   40 points. Share of the day's footage requests that came in
    //             under this employee's name:
    //                 (my footage ÷ everybody's footage) × 100 × 40%
    //             The heaviest single weight, because a footage request is a
    //             customer waiting.
    //
    //   VEHICLES  60 points. Against a floor of 800 vehicles seen — the count
    //             typed into VEHICLES SEEN on each client, which is what the
    //             employee actually watched:
    //                 min(vehicles seen ÷ 800, 1) × 60
    //             At 800 the sixty points are full; there is no extra credit
    //             for going past it, and no cliff for being just short.
    //
    //   BREAK     −20 points if the day's total break runs past an hour.
    //             Counted the way every other screen counts it: the union of
    //             the stretches, so overlapping rows are one absence.
    //
    // The old score mixed a completion percentage with penalties for pending
    // footage and follow-ups and a bonus for turning up on time. It is
    // replaced, not extended — two scoring systems for one number is how
    // nobody trusts either.
    const dayFootageRows = footageRows.slice(1).filter(r => {
      const sub = (r[COL.SUB_REQUEST] || '').toString().toLowerCase()
      if (!sub.includes('customer request for video')) return false
      return raisedOperatingDay(r[COL.RAISED_AT]) === today
    })
    const footageTotalToday = dayFootageRows.length
    const footageMineToday  = dayFootageRows.filter(r =>
      (r[COL.RAISED_BY] || '').toString().trim().toLowerCase() === user.name.toLowerCase()).length
    // No footage at all today is nobody's failure. Scoring a share of zero as
    // zero would put the whole floor on 60 for a quiet morning.
    const footageSharePct = footageTotalToday > 0
      ? (footageMineToday / footageTotalToday) * 100
      : null
    const footagePoints = footageSharePct === null ? 40 : (footageSharePct / 100) * 40

    const VEHICLE_TARGET = 800
    const vehiclesSeenToday = myUpdatesAll
      .filter(r => r[0] === today)
      .reduce((s, r) => s + (parseInt(r[11], 10) || 0), 0)
    const vehiclePoints = Math.min(vehiclesSeenToday / VEHICLE_TARGET, 1) * 60

    const BREAK_ALLOWANCE_MIN = 60
    const BREAK_PENALTY = 20
    // ONE day, not two. `today` above is already resolved to the employee's
    // own shift date, so this is the break taken during the shift being
    // scored. Passing [today, yesterday] added YESTERDAY's break to it — a
    // 95-minute day followed by a quiet one opened the new morning already
    // past the hour's allowance, and took twenty points off a score for time
    // away on a day that had ended.
    const breakMinutesToday = totalBreakMinutes(breakRows, user.empId, [today])
    const breakPenalty = breakMinutesToday > BREAK_ALLOWANCE_MIN ? BREAK_PENALTY : 0

    const performanceScore = Math.max(0, Math.min(100,
      Math.round(footagePoints + vehiclePoints - breakPenalty)))
    const tier = performanceScore>=95?'Elite':performanceScore>=85?'Excellent':performanceScore>=70?'Good':performanceScore>=50?'Needs Improvement':'Critical'

    // Everything the score was built from, so the screen can show the working.
    const scoreBreakdown = {
      footage: {
        weight: 40,
        mine: footageMineToday,
        total: footageTotalToday,
        sharePct: footageSharePct === null ? null : Math.round(footageSharePct * 10) / 10,
        points: Math.round(footagePoints * 10) / 10,
      },
      vehicles: {
        weight: 60,
        seen: vehiclesSeenToday,
        target: VEHICLE_TARGET,
        pct: Math.round(Math.min(vehiclesSeenToday / VEHICLE_TARGET, 1) * 1000) / 10,
        points: Math.round(vehiclePoints * 10) / 10,
      },
      breakPenalty: {
        weight: -BREAK_PENALTY,
        minutes: breakMinutesToday,
        allowanceMinutes: BREAK_ALLOWANCE_MIN,
        applied: breakPenalty > 0,
        points: -breakPenalty,
      },
      total: performanceScore,
    }

    // ── TODAY's real assigned-vs-completed, independent of `range` ──
    // (My Targets is meant to be a daily target, per the spec — it must not
    // change when the person switches the Weekly/Monthly/Yearly trend filter.)
    // Same collapse — the daily target must count the clients that are
    // actually this employee's, not every one that passed through their board.
    const myUpdatesToday = myUpdatesAll.filter(r => r[0] === today)

    // The hour in progress is left out of the collapse above, because nothing
    // in it can have been missed yet — but the daily target still has to show
    // ── Today's targets, from the shared day plan ────────────────────────
    // The same computation the employee's own day, their board and the admin's
    // two screens read, so the five figures in "My targets" cannot disagree
    // with the hour strip six inches above them. They used to be counted here
    // as DISTINCT CLIENT NAMES over the rows written so far, which is a
    // different question with a different answer: 69 here against 207 on the
    // admin's screen for the same person on the same afternoon.
    //
    // Counted in slots — one client in one hour is one piece of work — over
    // the whole operating day, 7am to 7am.
    let todayTargets = {
      clientsAssigned: 0, clientsCompleted: 0,
      vehiclesAssigned: 0, vehiclesCompleted: 0,
      updatesAssigned: 0, updatesCompleted: 0,
      footageAssigned: 0, footageCompleted: 0,
      followupsAssigned: 0, followupsCompleted: 0,
    }
    try {
      const plan = computeDayPlan({
        date: today, today, nowHour: nowISTDate().getHours(), yesterday,
        shiftRows, updateRows, breakRows,
        leaveMap: await getLeaveMapForDate(today),
        overridesMap: todayOverride,
        vehicleMap,
        weekOffNames: new Set(employees().filter(e => e.isWeekOff).map(e => e.name)),
      })
      const mine = plan.byEmployee[user.name]
      todayTargets.clientsAssigned  = mine?.clients  || 0
      todayTargets.vehiclesAssigned = mine?.vehicles || 0
      todayTargets.clientsCompleted = mine?.clientsDone || 0
      // Vehicles actually watched — what the employee typed into "Live
      // vehicles checked", not the fleet size of whatever they happened to
      // finish. Those are different numbers and only one of them is measured.
      todayTargets.vehiclesCompleted = mine?.vehiclesChecked || 0
      todayTargets.updatesAssigned   = mine?.clients || 0
      todayTargets.updatesCompleted  = mine?.clientsDone || 0
    } catch (e) {
      console.error('summary: day plan failed', e.message)
    }

    const todayFootage = footageRows.slice(1).filter(r => {
      const sub = (r[COL.SUB_REQUEST] || '').toString().toLowerCase()
      const by  = (r[COL.RAISED_BY]   || '').toString().trim().toLowerCase()
      return sub.includes('customer request for video') && by === user.name.toLowerCase() && raisedOperatingDay(r[COL.RAISED_AT]) === today
    })
    todayTargets.footageAssigned  = todayFootage.length
    todayTargets.footageCompleted = todayFootage.filter(footageResolved).length
    const todayFollowups = myFollowups.filter(r => r[0] === today)
    todayTargets.followupsAssigned  = todayFollowups.length
    todayTargets.followupsCompleted = todayFollowups.filter(r => (r[7]||'').toString().toLowerCase().startsWith('closed')).length


    // Their own history, read once. A failure here must never take the
    // dashboard down — it is a record of the past, not of the shift.
    let myHistory = null
    try { myHistory = await getHistoryFor(user.name) }
    catch (e) { console.error('history read failed:', e.message) }

    return res.status(200).json({
      range,
      performanceScore, performanceTier: tier,
      // How that score was arrived at, number by number — see the comment
      // above it. The screen shows this so nobody is handed a figure they
      // cannot check.
      scoreBreakdown,
      clientsAssigned, vehiclesCovered,
      updatesCompleted: totalUpdatesCompleted, updatesMissed: totalUpdatesMissed,
      misalignCount, alertTotal,
      footageTaken, footagePending,
      followupsClosed, followupsPending,
      trend: { labels: trendLabelsFinal, completed: trendCompleted, missed: trendMissed },
      attendanceStatus, loginTime, workingMinutes,
      shiftStart: myOverride?.start ?? emp?.start,
      shiftEnd:   myOverride?.end   ?? emp?.end,
      scheduledStart: emp?.start, scheduledEnd: emp?.end,
      usedEarlyStart: !!myOverride?.usedEarlyStart, usedOT: !!myOverride?.usedOT,
      isNight: emp?.isNight || false,
      calendar,
      topClients,
      recentActivity,
      today: todayTargets,
      // Their own months from before the platform existed. Shown separately
      // on their dashboard rather than blended into any range — a month is a
      // lump sum and cannot be cut into days. See lib/history.js.
      history: myHistory,
    })
  } catch (err) {
    console.error('Dashboard summary error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
