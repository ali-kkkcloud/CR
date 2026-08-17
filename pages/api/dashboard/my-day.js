import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, TABS, todayStr, nowIST, fetchClientVehicleCounts,
  getLeaveMapForDate, getShiftOverridesForDate,
  getOnShiftNamesFromLog, getClockedOutNamesFromLog, getAwayOnBreakNames,
} from '../../../lib/sheets'
import { employees, distributeClientsForHour, customTextFor } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { buildHourPool, buildLockedAssignments } from '../../../lib/distribution'

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
    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const today = todayStr()
    const yesterday = ddmmyyyyFromDate(new Date(nowIST().getTime() - 24*3600000))
    const explicitDate = req.query.date ? req.query.date.toString() : null

    // If the caller asked for a specific date (e.g. admin), use it as-is.
    // Otherwise (the employee's own live "My Day"), resolve MY actual
    // operating shift date — which stays the day the shift started even
    // after midnight rolls the calendar date over.
    const shiftLogRows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000)
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

    const [updateRows, redistRows, breakRows, vehicleMap, leaveMap, overridesMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`, 8000),
      readSheetCached(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`, 8000),
      readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, 15000),
      fetchClientVehicleCounts(),
      getLeaveMapForDate(date),
      getShiftOverridesForDate(date),
    ])
    // Somebody away on a long break is not owed this hour's work — same rule
    // the live board and the Command Center apply.
    const awayNames = getAwayOnBreakNames(breakRows, [today, yesterday])

    // Find this employee's scheduled hours
    const emp = employees().find(e => e.name === user.name)
    if (!emp) return res.status(200).json({ date, timeline: [], totalClients:0, totalCompleted:0, totalMissed:0 })

    // This date's effective window — Early Start / OT overrides take
    // priority over the static employees() schedule when present.
    const myOverride = overridesMap[user.name]
    const effectiveEmp = myOverride ? { ...emp, start: myOverride.start, end: myOverride.end } : emp
    const isWrap = wrapsPastMidnight(effectiveEmp.start, effectiveEmp.end)

    // Build all hours this employee is scheduled for, IN CHRONOLOGICAL
    // SHIFT ORDER (starting from their actual start hour) — not ascending
    // numeric order, which would put post-midnight hours (0, 1, 2...)
    // before the shift's real early-evening hours for a wrapping shift.
    const scheduledHours = []
    if (isWrap) {
      for (let h = effectiveEmp.start; h < 24; h++) scheduledHours.push(h)
      for (let h = 0; h < effectiveEmp.end; h++) scheduledHours.push(h)
    } else {
      for (let h = effectiveEmp.start; h < effectiveEmp.end; h++) scheduledHours.push(h)
    }

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

    // Build timeline hour by hour
    const timeline = scheduledHours.map(hour => {
      // Check if on leave this hour
      const leaves = leaveMap[user.name] || []
      const isOnLeave = leaves.some(l => {
        if (l.fromHour <= l.toHour) return hour >= l.fromHour && hour < l.toHour
        return hour >= l.fromHour || hour < l.toHour
      })

      if (isOnLeave) {
        return { hour, isOnLeave: true, clients: [], totalClients: 0, completedClients: 0, missedClients: 0 }
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

      // What was actually on my board that hour.
      //
      // Once an hour has rows in CRM_Updates those rows ARE the record —
      // a row is written for every client put in front of me — so the
      // timeline reports them directly instead of re-deriving the split.
      // Re-deriving was what made the counts drift: the live split
      // depends on who was clocked in at the time, which can't be
      // reconstructed after the fact, so a past hour would be recomputed
      // against the current roster and show a different set of clients
      // than the employee was actually given.
      const myRowsThisHour = updatesByHour[hour] || {}
      const rowClients = Object.keys(myRowsThisHour)

      let myClients
      if (rowClients.length > 0) {
        myClients = rowClients.map(client => ({
          client,
          vehicleCount: vehicleMap[(client || '').toLowerCase()]?.vehicleCount || 0,
          isSpecific: false,
          isRedistributed: false,
          fromEmployee: null,
          toEmployee: null,
        }))
      } else {
        // No rows yet (an hour still ahead of me, or one I never opened):
        // fall back to a projection using the same rules as the live view —
        // literally the same function, rather than a fourth hand-rolled copy of
        // it. This one had drifted: it never excluded anybody who had gone home,
        // and it applied System-marked leave to people who were clocked in, so
        // the hour strip could promise clients the live board would not give.
        const { poolNames } = buildHourPool({
          hour, leaveMap, overridesMap, onShiftNames, clockedOutNames, awayNames,
        })

        // Only genuinely completed work is pinned — see /api/clients/current.
        const lockedAssignments = buildLockedAssignments(updateRows, date, hour)

        const dist = distributeClientsForHour(hour, poolNames, vehicleMap, lockedAssignments, true)
        myClients = (dist[user.name] || []).map(c => ({
          client: c.client,
          vehicleCount: c.vehicleCount,
          isSpecific: c.isSpecific,
          isRedistributed: false,
          fromEmployee: null,
          toEmployee: null,
        }))
      }

      // Mark clients redistributed AWAY from me this hour
      const awayThisHour = redistFromMe.filter(r => r.hour === hour)
      myClients = myClients.map(c => {
        const away = awayThisHour.find(a => a.client === c.client)
        if (away) return { ...c, redistributedAway: true, toEmployee: away.toEmployee }
        return c
      })

      // Add clients redistributed TO me this hour
      const toMeThisHour = redistToMe.filter(r => r.hour === hour)
      toMeThisHour.forEach(r => {
        if (!myClients.some(c => c.client === r.client)) {
          myClients.push({ client: r.client, isRedistributed: true, fromEmployee: r.fromEmployee })
        }
      })

      // Merge with actual fill data
      const hourData = updatesByHour[hour] || {}
      const clientsWithStatus = myClients.map(c => ({
        ...c,
        filled:    !c.redistributedAway && !!(hourData[c.client]?.filled),
        status:    hourData[c.client]?.status || '',
        updatedAt: hourData[c.client]?.updatedAt || '',
        misalignVehicles: hourData[c.client]?.misalignVehicles || '',
        alertCount: hourData[c.client]?.alertCount || '',
        fatigue: hourData[c.client]?.fatigue || '',
        fatigueCount: hourData[c.client]?.fatigueCount || '',
      }))

      const realClients = clientsWithStatus.filter(c => !c.redistributedAway)
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
