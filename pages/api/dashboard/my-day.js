import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, TABS, todayStr, yesterdayStr, nowIST, fetchClientVehicleCounts,
  getLeaveMapForDate, getShiftOverridesForDate,
  getOnShiftNamesFromLog, getClockedOutNamesFromLog, getAwayOnBreakNames, hourHasPassed, whoWasOnShiftAtHour,
} from '../../../lib/sheets'
import { employees, distributeClientsForHour, customTextFor, getScheduledEmployeesAtHour } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { buildHourPool, buildLockedAssignments, collapseSlotOwners } from '../../../lib/distribution'

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
    const yesterday = yesterdayStr()
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
    // Exactly the rule /api/clients/current uses — see the note there.
    const iAmOnShift = shiftLogRows.slice(1).some(r =>
      (r[0] || '').toString().trim() === user.empId.toString().trim() &&
      (r[2] === today || r[2] === yesterday) && r[6] === 'Active'
    )

    const [updateRows, redistRows, breakRows, vehicleMap, leaveMap, overridesMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:L`, 8000),
      readSheetCached(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`, 8000),
      readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, 15000),
      fetchClientVehicleCounts(),
      getLeaveMapForDate(date),
      getShiftOverridesForDate(date),
    ])
    // Somebody away on a long break is not owed this hour's work — same rule
    // the live board and the Command Center apply.
    const awayNames = getAwayOnBreakNames(breakRows, [today, yesterday])
    // Nobody on a standing week off shares an hour that hasn't happened yet.
    const standingWeekOff = new Set(employees().filter(e => e.isWeekOff).map(e => e.name))

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
          liveVehicles: r[11] || '',
        }
      })

    // Which hours today already have rows written for ANYBODY — the test for
    // whether an hour is settled has to look at the whole floor, not just at
    // this employee.
    // One owner per (client, hour), then just the ones that are mine.
    //
    // My own rows are not the answer on their own: CRM_Updates is append-only
    // and a placeholder is written every time a client lands in front of
    // somebody, so a client I held for ten minutes before a colleague clocked
    // in still carries a row in my name. Counting those told me I had held
    // clients that were finished by someone else, and put the same client-hour
    // on two people's days at once.
    const settledMine = {}
    collapseSlotOwners(updateRows, r => r[0] === date).forEach(({ owner, client, hour }) => {
      if (owner !== user.name) return
      const h = parseInt(hour)
      if (!Number.isFinite(h)) return
      ;(settledMine[h] ||= []).push(client)
    })

    const hoursWithRows = new Set(
      updateRows.slice(1)
        .filter(r => r[0] === date)
        .map(r => parseInt(r[4]))
        .filter(h => Number.isFinite(h))
    )

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
      // An hour settles as a WHOLE, not one employee at a time. If the hour is
      // behind us and rows exist for it, those rows are the record — including
      // for somebody who holds none, because holding none is what happened. The
      // old test looked only at MY rows, so an hour I sat out (away on a break,
      // or never opened) was re-derived from the split and showed me clients
      // that had gone to a colleague and were already recorded in their name.
      const myRowsThisHour = updatesByHour[hour] || {}
      const rowClients = Object.keys(myRowsThisHour)
      const hourSettled = hoursWithRows.has(hour) && (date !== today || hourHasPassed(hour, nowHour))

      // Only a FINISHED hour is read from its rows. The hour in progress is
      // recomputed, because CRM_Updates is append-only: every time the split
      // moves — somebody clocks in, somebody steps away — a placeholder is
      // written, and the rows end up holding the union of everyone who has
      // held the client this hour rather than who holds it now. Reading them
      // told an employee they had 22 clients this hour while their own board,
      // two tabs away, showed 16. Work already completed stays theirs either
      // way: buildLockedAssignments pins it.
      let myClients
      if (hourSettled) {
        myClients = (settledMine[hour] || []).map(client => ({
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
        //
        // An hour still ahead is projected from the ROSTER, not from who is at
        // a desk right now. Colleagues who have not arrived yet still cover
        // their own hours, and splitting the afternoon between only the people
        // already logged in told somebody at nine in the morning that they were
        // due 234 clients when their real day holds 178.
        // alwaysInclude mirrors /api/clients/current exactly. Without it an
        // employee looking at their own day saw an empty current hour while
        // their board, one tab away, showed seventy-seven clients — the board
        // keeps the person reading it in the pool, and the two screens have to
        // answer the same question the same way.
        const livePool = () => buildHourPool({
          hour, leaveMap, overridesMap, onShiftNames, clockedOutNames, awayNames,
          alwaysInclude: iAmOnShift ? user.name : null,
        }).poolNames
        let poolNames
        if (date === today && hour !== nowHour && !hourHasPassed(hour, nowHour)) {
          poolNames = getScheduledEmployeesAtHour(hour, leaveMap, overridesMap)
            .map(e => e.name)
            .filter(n => !standingWeekOff.has(n))
        } else if (date === today && hourHasPassed(hour, nowHour)) {
          // A finished hour with no rows at all. Judged on who was actually at
          // work then, from the attendance log — not on who is at a desk now.
          const wereHere = whoWasOnShiftAtHour(shiftLogRows, date, hour, nowHour)
          const past = getScheduledEmployeesAtHour(hour, leaveMap, overridesMap)
            .map(e => e.name)
            .filter(n => wereHere.has(n) && !standingWeekOff.has(n))
          poolNames = past.length > 0 ? past : livePool()
        } else {
          poolNames = livePool()
        }

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
        // Work I have already finished this hour but which the split no longer
        // lists against me — I stepped away on a break, so the hour moved to
        // whoever is at their desk. The clients stay reserved so nobody redoes
        // them, but without this they disappeared off my own day too, and
        // finished work should never stop being mine.
        Object.entries(lockedAssignments).forEach(([client, owner]) => {
          if (owner !== user.name) return
          if (myClients.some(c => c.client === client)) return
          myClients.push({
            client,
            vehicleCount: vehicleMap[(client || '').toLowerCase()]?.vehicleCount || 0,
            isSpecific: false, isRedistributed: false, fromEmployee: null, toEmployee: null,
          })
        })
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
