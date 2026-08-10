import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr, nowStr,
  fetchClientVehicleCounts, parseISTDateTime, getShiftOverridesForDate,
} from '../../../lib/sheets'
import { ALL_EMPLOYEES } from '../../../lib/schedule'

const ISSUE_TAB = 'Issues- Realtime'
// Same real column layout as pages/api/footage/list.js
const COL = {
  ISSUE_ID: 1, CLIENT: 2, VEHICLE: 3, RAISED_AT: 4, RAISED_BY: 7,
  SUB_REQUEST: 9, DETAILS: 10, RESOLVED: 17, RESOLVED_AT: 18,
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
    const range = (req.query.range || 'month').toString()
    const calendarToday = todayStr()
    const dates = rangeDates(range)
    const dateStrs = dates.map(ddmmyyyy)
    const dateStrSet = new Set(dateStrs)

    const emp = ALL_EMPLOYEES.find(e => e.name === user.name)

    // Resolve MY operating "shift date" — for a night shift that began
    // yesterday evening and is still running past midnight, everything
    // (attendance, today's targets, the active override) must stay
    // attached to the date the shift STARTED, not the new calendar date.
    const yesterdayDate = new Date(nowISTDate().getTime() - 24*3600000)
    const yesterday = ddmmyyyy(yesterdayDate)
    const shiftLogPeek = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000)
    const myToday     = shiftLogPeek.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===calendarToday)
    const myYesterday = shiftLogPeek.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===yesterday)
    const today = (myToday.length === 0 && myYesterday.some(r => r[6] === 'Active')) ? yesterday : calendarToday

    const todayOverride = await getShiftOverridesForDate(today)
    const myOverride = todayOverride[user.name]

    const [updateRows, footageRows, followupRows, redistRows, shiftRows, leaveRows, vehicleMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`, 15000),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, 30000),
      readSheetCached(CRM_SHEET_ID, `${TABS.FOOTAGE_FOLLOWUP}!A:J`, 15000),
      readSheetCached(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`, 15000),
      readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000),
      readSheetCached(CRM_SHEET_ID, `${TABS.LEAVES}!A:H`, 30000),
      fetchClientVehicleCounts(),
    ])

    const myUpdatesAll = updateRows.slice(1).filter(r => r[2] === user.name)
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
    const myFootageInRange = myFootage.filter(r => dateStrSet.has((r[COL.RAISED_AT]||'').split(',')[0].split(' ')[0]) || range==='today')
    const footageResolved = (r) => (r[COL.RESOLVED]||'').toString().toLowerCase() === 'yes'
    const footageTaken   = myFootageInRange.filter(footageResolved).length
    const footagePending = myFootage.filter(r => !footageResolved(r)).length // pending is "live", not range-scoped

    // ── Follow-ups ──
    const myFollowups = followupRows.slice(1).filter(r => r[5]===user.name || r[6]===user.name)
    const followupsClosed  = myFollowups.filter(r => (r[7]||'').toString().toLowerCase().startsWith('closed')).length
    const followupsPending = myFollowups.filter(r => !(r[7]||'').toString().toLowerCase().startsWith('closed')).length

    // ── Attendance (today) ──
    let attendanceStatus = null, loginTime = null, workingMinutes = 0
    const myShiftRowsToday = shiftRows.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===today)
    const latestShift = myShiftRowsToday[myShiftRowsToday.length-1]
    if (latestShift) {
      loginTime = latestShift[3] || null
      if (emp && loginTime) {
        const loginDate = parseISTDateTime(today, loginTime)
        if (loginDate) {
          const graceMinutes = 10
          const scheduledStart = new Date(loginDate)
          scheduledStart.setHours(emp.start, graceMinutes, 0, 0)
          attendanceStatus = loginDate <= scheduledStart ? 'On Time' : 'Late'
        }
      }
      if (latestShift[6] === 'Active' && loginTime) {
        const loginDate = parseISTDateTime(today, loginTime)
        if (loginDate) workingMinutes = Math.round((Date.now() - loginDate.getTime())/60000)
      } else if (latestShift[4]) {
        const endDate = parseISTDateTime(today, latestShift[4])
        const loginDate = parseISTDateTime(today, loginTime)
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

    // ── Performance score (0-100 heuristic) ──
    const completionPct = (totalUpdatesCompleted+totalUpdatesMissed) > 0
      ? (totalUpdatesCompleted/(totalUpdatesCompleted+totalUpdatesMissed))*100 : 100
    const footagePenalty   = Math.min(15, footagePending*3)
    const followupPenalty  = Math.min(15, followupsPending*3)
    const attendanceBonus  = attendanceStatus === 'On Time' ? 20 : attendanceStatus === 'Late' ? 10 : 15
    const performanceScore = Math.max(0, Math.min(100, Math.round(
      completionPct*0.5 + (15-footagePenalty) + (15-followupPenalty) + attendanceBonus
    )))
    const tier = performanceScore>=95?'Elite':performanceScore>=85?'Excellent':performanceScore>=70?'Good':performanceScore>=50?'Needs Improvement':'Critical'

    // ── TODAY's real assigned-vs-completed, independent of `range` ──
    // (My Targets is meant to be a daily target, per the spec — it must not
    // change when the person switches the Weekly/Monthly/Yearly trend filter.)
    const myUpdatesToday = updateRows.slice(1).filter(r => r[2]===user.name && r[0]===today)
    const todayCompleted = myUpdatesToday.filter(r => (r[5]||'').toString().trim())
    const todayClientSet = new Set(myUpdatesToday.map(r => r[3]))
    const todayCompletedClientSet = new Set(todayCompleted.map(r => r[3]))
    let todayVehicles = 0, todayVehiclesDone = 0
    todayClientSet.forEach(c => { todayVehicles += vehicleMap[(c||'').toLowerCase()]?.vehicleCount || 0 })
    todayCompletedClientSet.forEach(c => { todayVehiclesDone += vehicleMap[(c||'').toLowerCase()]?.vehicleCount || 0 })
    const todayFootage = footageRows.slice(1).filter(r => {
      const sub = (r[COL.SUB_REQUEST] || '').toString().toLowerCase()
      const by  = (r[COL.RAISED_BY]   || '').toString().trim().toLowerCase()
      return sub.includes('customer request for video') && by === user.name.toLowerCase() && (r[COL.RAISED_AT]||'').includes(today)
    })
    const todayFootageDone = todayFootage.filter(footageResolved).length
    const todayFollowups = myFollowups.filter(r => r[0] === today)
    const todayFollowupsClosed = todayFollowups.filter(r => (r[7]||'').toString().toLowerCase().startsWith('closed')).length

    const todayTargets = {
      clientsAssigned: todayClientSet.size, clientsCompleted: todayCompletedClientSet.size,
      vehiclesAssigned: todayVehicles, vehiclesCompleted: todayVehiclesDone,
      updatesAssigned: myUpdatesToday.length, updatesCompleted: todayCompleted.length,
      footageAssigned: todayFootage.length, footageCompleted: todayFootageDone,
      followupsAssigned: todayFollowups.length, followupsCompleted: todayFollowupsClosed,
    }

    return res.status(200).json({
      range,
      performanceScore, performanceTier: tier,
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
    })
  } catch (err) {
    console.error('Dashboard summary error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
