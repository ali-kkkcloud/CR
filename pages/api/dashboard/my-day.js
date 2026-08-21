import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, TABS, todayStr, yesterdayStr, nowIST, fetchClientVehicleCounts,
  getLeaveMapForDate, getShiftOverridesForDate,
  getOnShiftNamesFromLog, getClockedOutNamesFromLog, getAwayOnBreakNames, hourHasPassed, whoWasOnShiftAtHour, TTL, warmTogether, SHIFT_SCREEN_TABS,
} from '../../../lib/sheets'
import { employees, distributeClientsForHour, customTextFor, getScheduledEmployeesAtHour } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { buildHourPool, buildLockedAssignments, collapseSlotOwners } from '../../../lib/distribution'
import { computeDayPlan, employeeDayHours } from '../../../lib/dayplan'

function ddmmyyyyFromDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// Whether an EFFECTIVE (possibly override-adjusted) start/end window wraps
// past midnight — derived from the actual hours, NOT the employee's static
// isNight flag (an Early/Late Start or OT can push a normally-day shift
// across midnight, or pull a night shift's wrap point earlier).
function wrapsPastMidnight(start, end) { return end <= start }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    // Every tab this screen needs, asked for in one go before anything else
    // runs — so they cost one request between them instead of one per stage.
    // See warmTogether in lib/sheets.
    await warmTogether(CRM_SHEET_ID, SHIFT_SCREEN_TABS)

    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const today = todayStr()
    const yesterday = yesterdayStr()
    const explicitDate = req.query.date ? req.query.date.toString() : null

    // If the caller asked for a specific date (e.g. admin), use it as-is.
    // Otherwise (the employee's own live "My Day"), resolve MY actual
    // operating shift date — which stays the day the shift started even
    // after midnight rolls the calendar date over.
    const shiftLogRows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE)
    let date = explicitDate || today
    if (!explicitDate) {
      const myToday     = shiftLogRows.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===today)
      const myYesterday = shiftLogRows.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===yesterday)
      if (myToday.length === 0 && myYesterday.some(r => r[6] === 'Active')) date = yesterday
    }
    // Who is clocked in right now — used to project hours that have no
    // rows yet, matching how the live current-hour view splits the work.
    const onShiftNames = getOnShiftNamesFromLog(shiftLogRows, [today, yesterday])
    const clockedOutNames = getClockedOutNamesFromLog(shiftLogRows, [today, yesterday])
    // Exactly the rule /api/clients/current uses — see the note there.
    const iAmOnShift = shiftLogRows.slice(1).some(r =>
      (r[0] || '').toString().trim() === user.empId.toString().trim() &&
      (r[2] === today || r[2] === yesterday) && r[6] === 'Active'
    )

    const [updateRows, redistRows, breakRows, vehicleMap, leaveMap, overridesMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:L`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, TTL.LIVE),
      fetchClientVehicleCounts(),
      getLeaveMapForDate(date),
      getShiftOverridesForDate(date),
    ])
    // Somebody away on a long break is not owed this hour's work — same rule
    // the live board and the Command Center apply.
    const awayNames = getAwayOnBreakNames(breakRows, [today, yesterday])
    // Nobody on a standing week off shares an hour that hasn't happened yet.
    const standingWeekOff = new Set(employees().filter(e => e.isWeekOff).map(e => e.name))
    // Nor does anybody who has already gone home for this operating day — the
    // same rule the admin's day view applies, so the two cannot disagree about
    // how much work an hour tonight is going to be shared between. Rows dated
    // yesterday are ignored: a night shift that ended at six this morning is
    // due back this evening.
    const shiftsTodayByName = {}
    shiftLogRows.slice(1).filter(r => r[2] === today).forEach(r => {
      const n = (r[1] || '').toString().trim()
      if (n) (shiftsTodayByName[n] ||= []).push(r)
    })
    const goneHomeToday = new Set(
      Object.entries(shiftsTodayByName)
        .filter(([, rows]) => !rows.some(r => r[6] === 'Active'))
        .map(([n]) => n)
    )

    // Find this employee's scheduled hours
    const emp = employees().find(e => e.name === user.name)
    if (!emp) return res.status(200).json({ date, timeline: [], totalClients:0, totalCompleted:0, totalMissed:0 })

    // This date's effective window — Early Start / OT overrides take
    // priority over the static employees() schedule when present.
    const myOverride = overridesMap[user.name]
    const effectiveEmp = myOverride ? { ...emp, start: myOverride.start, end: myOverride.end } : emp
    const isWrap = wrapsPastMidnight(effectiveEmp.start, effectiveEmp.end)

    // ── The day, worked out once ─────────────────────────────────────────
    // The very same computation the admin's Hour by hour and Dashboard read,
    // so my day, my board and what my supervisor sees can never disagree
    // about how many clients I have. See lib/dayplan.js.
    const plan = computeDayPlan({
      date, today, nowHour: nowIST().getHours(), yesterday,
      shiftRows: shiftLogRows, updateRows, breakRows, leaveMap, overridesMap, vehicleMap,
      weekOffNames: standingWeekOff,
    })
    const myPlan = plan.byEmployee[user.name] || { hours: {} }

    // My hours, in operating-day order (7am → 7am), including any hour I have
    // already recorded work in even if a late start has since moved my window.
    const scheduledHours = employeeDayHours(plan, emp, effectiveEmp)

    // Build CRM_Updates index for this employee+date — keyed by hour+client
    const updatesByHour = {}
    updateRows.slice(1)
      .filter(r => r[0] === date && r[2] === user.name)
      .forEach(r => {
        const h = parseInt(r[4])
        if (!updatesByHour[h]) updatesByHour[h] = {}
        const hasData = !!(r[5] || '').toString().trim()
        updatesByHour[h][r[3]] = {
          filled:    hasData,
          status:    r[5] || '',
          updatedAt: hasData ? (r[1] || '') : '',
          misalignVehicles: r[6] || '',
          alertCount: r[7] || '',
          fatigue: r[8] || '',
          fatigueCount: r[9] || '',
          liveVehicles: r[11] || '',
          notes: r[10] || '',
        }
      })

    // Redistributed TO me (added to my list from someone else)
    const redistToMe = redistRows.slice(1)
      .filter(r => r[0] === date && r[3] === user.name)
      .map(r => ({ hour: parseInt(r[5]), client: r[4], fromEmployee: r[2] }))

    // Redistributed AWAY from me (left my list)
    const redistFromMe = redistRows.slice(1)
      .filter(r => r[0] === date && r[2] === user.name)
      .map(r => ({ hour: parseInt(r[5]), client: r[4], toEmployee: r[3] }))

    // When each scheduled hour actually begins.
    //
    // scheduledHours is already in shift order, so walking it an hour at a
    // time gives the right moments even for a night shift whose later hours
    // fall on the next calendar day. This is what tells an hour that has
    // finished apart from one still to come — without it every hour of the
    // day was counted as "missed" from the moment the employee clocked in,
    // so somebody starting an eight-hour shift was greeted with 351 misses
    // for work that wasn't due yet.
    const [dd, mm, yyyy] = date.split('/').map(n => parseInt(n, 10))
    const hourStartsAt = {}
    let cursor = new Date(yyyy, mm - 1, dd, effectiveEmp.start, 0, 0, 0)
    scheduledHours.forEach(h => {
      hourStartsAt[h] = cursor.getTime()
      cursor = new Date(cursor.getTime() + 3600000)
    })
    const nowMs = nowIST().getTime()
    const nowHour = nowIST().getHours()

    // Never clocked in, and the grace hour has gone: every hour after it is a
    // no-show, said the same way here as on the admin's screen.
    const myGraceHour = plan.graceHourOnly?.[user.name]

    // Build timeline hour by hour
    const timeline = scheduledHours.map(hour => {
      // Check if on leave this hour
      const leaves = leaveMap[user.name] || []
      const missedGrace = myGraceHour !== undefined && myGraceHour !== hour
      const isOnLeave = missedGrace || leaves.some(l => {
        if (l.fromHour <= l.toHour) return hour >= l.fromHour && hour < l.toHour
        return hour >= l.fromHour || hour < l.toHour
      })

      // An hour you demonstrably worked is not an hour you were on leave.
      // The plan reads a finished hour from the rows written in it, and a row
      // is proof of presence — so if the split still holds work for this hour,
      // the leave label would be hiding it. Kept in step with the admin's day
      // view, which makes the same exception for the same reason.
      const planHasWork = (myPlan.hours[hour] || []).length > 0
      if (isOnLeave && !planHasWork) {
        return {
          hour, isOnLeave: true,
          leaveReason: missedGrace ? 'Week Off' : '',
          clients: [], totalClients: 0, completedClients: 0, missedClients: 0,
        }
      }

      // Custom text slot (e.g. BRINDA's CALL hours)
      const customText = customTextFor(user.name, hour)
      if (customText) {
        return {
          hour,
          isCustom: true,
          customText,
          clients: [{ client: customText, isCustom: true, filled: false }],
          totalClients: 0,
          completedClients: 0,
          missedClients: 0,
        }
      }

      // What is on my board this hour, straight from the shared plan.
      const myRowsThisHour = updatesByHour[hour] || {}
      let myClients = (myPlan.hours[hour] || []).map(c => ({
        client: c.client,
        vehicleCount: c.vehicleCount || 0,
        isSpecific: !!c.isSpecific,
        isRedistributed: false,
        fromEmployee: null,
        toEmployee: null,
      }))

      // A client the log says I handed on, that the split has given back to me.
      //
      // The log is an audit trail, not the board. If a client is still in my
      // list then the live split still has it as mine — I ended a shift, came
      // back, and it returned — so it counts as my work. It is only marked so
      // the hand-over is visible; discounting it made my own total one short of
      // what the admin, reading the same split, said I was holding.
      const awayThisHour = redistFromMe.filter(r => r.hour === hour)
      myClients = myClients.map(c => {
        const away = awayThisHour.find(a => a.client === c.client)
        if (away) return { ...c, handedOverTo: away.toEmployee }
        return c
      })

      // Mark clients that reached me because somebody handed them over.
      //
      // The log annotates; it never adds. It is an audit trail, and the live
      // split is what actually moves the work — pushing a log row onto the
      // board as well put the same client-hour on two people's days at once.
      const toMeThisHour = redistToMe.filter(r => r.hour === hour)
      myClients = myClients.map(c => {
        const moved = toMeThisHour.find(r => r.client === c.client)
        return moved ? { ...c, isRedistributed: true, fromEmployee: moved.fromEmployee } : c
      })

      // Merge with actual fill data
      const hourData = updatesByHour[hour] || {}
      const clientsWithStatus = myClients.map(c => ({
        ...c,
        filled:    !!(hourData[c.client]?.filled),
        status:    hourData[c.client]?.status || '',
        updatedAt: hourData[c.client]?.updatedAt || '',
        misalignVehicles: hourData[c.client]?.misalignVehicles || '',
        alertCount: hourData[c.client]?.alertCount || '',
        fatigue: hourData[c.client]?.fatigue || '',
        fatigueCount: hourData[c.client]?.fatigueCount || '',
        // Carried like every other field. These two were missing, and a save
        // rewrites the WHOLE row — so opening an earlier hour showed the live
        // vehicle count and the notes as blank, and saving that hour again
        // wrote the blanks back over what had been recorded.
        liveVehicles: hourData[c.client]?.liveVehicles || '',
        notes: hourData[c.client]?.notes || '',
      }))

      const realClients = clientsWithStatus
      const completed   = realClients.filter(c => c.filled).length
      const outstanding = realClients.filter(c => !c.filled).length

      // An hour that hasn't finished can't have been missed. Only once it is
      // behind the employee does unfinished work become a miss; until then it
      // is simply what's still to do.
      const startedAt = hourStartsAt[hour]
      const state = startedAt == null ? 'done'
        : nowMs >= startedAt + 3600000 ? 'done'
        : nowMs >= startedAt ? 'current' : 'upcoming'

      return {
        hour,
        state,
        clients: clientsWithStatus,
        totalClients:     realClients.length,
        completedClients: completed,
        missedClients:    state === 'done' ? outstanding : 0,
        pendingClients:   state === 'done' ? 0 : outstanding,
      }
    })

    const totalClients   = timeline.reduce((s, t) => s + (t.totalClients   || 0), 0)
    const totalCompleted = timeline.reduce((s, t) => s + (t.completedClients || 0), 0)
    const totalMissed    = timeline.reduce((s, t) => s + (t.missedClients  || 0), 0)

    return res.status(200).json({
      date, timeline, totalClients, totalCompleted, totalMissed,
      // Still to do — hours in progress or yet to come. Kept separate from
      // totalMissed so the day reads as work remaining, not work failed.
      totalPending: timeline.reduce((s, t) => s + (t.pendingClients || 0), 0),
    })

  } catch (err) {
    console.error('My day error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
