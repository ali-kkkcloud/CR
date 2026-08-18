import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, TABS, todayStr, yesterdayStr, nowIST, hourHasPassed, whoWasOnShiftAtHour, fetchClientVehicleCounts,
  getLeaveMapForDate, getShiftOverridesForDate,
  getOnShiftNamesFromLog, getClockedOutNamesFromLog, getAwayOnBreakNames,
} from '../../../lib/sheets'
import {
  employees, distributeClientsForHour, customTextFor, getScheduledEmployeesAtHour
} from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { buildHourPool, buildLockedAssignments, collapseSlotOwners } from '../../../lib/distribution'

function ddmmyyyyFromDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// "KA01AB1234, KA02CD5678" -> 2. Anything blank counts as none.
function countListed(cell) {
  return (cell || '').toString().split(/[,\n]+/).map(x => x.trim()).filter(Boolean).length
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const date = (req.query.date || todayStr()).toString()

    const [updateRows, shiftRows, breakRows, leaveMap, redistRows, vehicleMap, overridesMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:L`, 10000),
      readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000),
      readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, 15000),
      getLeaveMapForDate(date),
      readSheetCached(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`, 10000),
      fetchClientVehicleCounts(),
      getShiftOverridesForDate(date),
    ])

    // ── Who this day's hours are actually shared between ──────────────────
    //
    // This used to split every hour across everyone the ROSTER said should be
    // working, while the employees' boards split it across whoever is actually
    // clocked in. The two therefore disagreed on nearly every hour, and the
    // disagreement was not cosmetic: the admin would show a client sitting
    // PENDING against a named employee who had never been given it, and hand
    // fourteen clients at six in the evening to somebody who clocked out at
    // ten in the morning. An admin cannot chase work that the boards never
    // handed out.
    //
    // Both sides now answer it with the same function. That is the whole point
    // of lib/distribution — see the note at the top of it.
    const today = todayStr()
    const isToday = date === today
    const yesterday = yesterdayStr()
    const nowHour = nowIST().getHours()

    // For today, presence means "clocked in right now". For a day already
    // finished, nobody is Active any more, so presence means "turned up at all
    // that day" — otherwise the live rules would report a past day as though
    // the entire roster had been absent.
    const onShiftNames = isToday
      ? getOnShiftNamesFromLog(shiftRows, [today, yesterday])
      : new Set(shiftRows.slice(1).filter(r => r[2] === date).map(r => (r[1] || '').toString().trim()).filter(Boolean))
    const clockedOutNames = isToday
      ? getClockedOutNamesFromLog(shiftRows, [today, yesterday])
      : new Set()
    // Only meaningful for the live day: a break that is still open now.
    const awayNames = isToday
      ? getAwayOnBreakNames(breakRows, [today, yesterday])
      : new Set()

    // Index updates by emp+hour
    const updateIdx = {}
    updateRows.slice(1)
      .filter(r => r[0] === date)
      .forEach(r => {
        const key = `${r[2]}__${r[4]}`
        if (!updateIdx[key]) updateIdx[key] = {}
        const hasData = !!(r[5] || '').toString().trim()
        updateIdx[key][r[3]] = {
          filled:    hasData,
          status:    r[5] || '',
          updatedAt: hasData ? r[1] : '',
          misalignVehicles: r[6] || '',
          alertCount: r[7] || '',
          fatigue: r[8] || '',
          fatigueCount: r[9] || '',
          liveVehicles: r[11] || '',
        }
      })

    // Locked assignments per hour — from buildLockedAssignments, so only rows
    // carrying a REAL update pin a client. This used to key off every row
    // including the blank placeholders written whenever a board loads, which
    // froze each hour's split to whoever happened to open their page first and
    // is how one client at one hour ended up listed under two employees.
    const lockedByHour = {}
    const hoursSeen = new Set(
      updateRows.slice(1).filter(r => r[0] === date).map(r => parseInt(r[4]))
    )
    for (let h = 0; h < 24; h++) {
      if (hoursSeen.has(h)) lockedByHour[h] = buildLockedAssignments(updateRows, date, h)
    }

    // One owner per (client, hour) for every hour that has rows, grouped by
    // employee — see the note where this is used below.
    const settledOwners = {}
    collapseSlotOwners(updateRows, r => r[0] === date).forEach(({ owner, client, hour }) => {
      const h = parseInt(hour)
      if (!Number.isFinite(h)) return
      ;(settledOwners[h] ||= {})
      ;(settledOwners[h][owner] ||= []).push(client)
    })

    // ── Who owns an hour, chosen by where that hour sits in the day ──────
    //
    // Three different questions wear the same words. "Who has this hour" means
    // something different for an hour that is over, the one running now, and
    // one still to come, and answering all three with live presence is what
    // made this screen disagree with the Command Center by a hundred clients.
    //
    //   gone      — who was actually at work then, read back from the
    //               attendance log's own start and end times.
    //   now       — who is clocked in this minute, minus anyone away. Exactly
    //               what the employee's own board does.
    //   still due — the ROSTER. The night shift covers tonight whether or not
    //               it has arrived yet; judging tonight by who happens to be at
    //               a desk this morning handed the whole evening to the morning
    //               crew, and dropped the 6am hour entirely because everyone
    //               who covers it had gone home — ninety-six clients that
    //               simply vanished off this screen.
    const standingWeekOff = new Set(employees().filter(e => e.isWeekOff).map(e => e.name))
    const rosterPoolCache = {}
    const rosterPool = (hour) => (rosterPoolCache[hour] ||= (
      getScheduledEmployeesAtHour(hour, leaveMap, overridesMap)
        .map(e => e.name)
        .filter(n => !standingWeekOff.has(n))
    ))
    const hourPoolFor = (hour) => {
      if (!isToday) {
        return buildHourPool({ hour, leaveMap, overridesMap, onShiftNames, clockedOutNames, awayNames }).poolNames
      }
      if (hour === nowHour) {
        return buildHourPool({ hour, leaveMap, overridesMap, onShiftNames, clockedOutNames, awayNames }).poolNames
      }
      if (hourHasPassed(hour, nowHour)) {
        const wereHere = whoWasOnShiftAtHour(shiftRows, date, hour, nowHour)
        const pool = rosterPool(hour).filter(n => wereHere.has(n))
        // Nobody's attendance row covers that hour — fall back to the live
        // reading rather than reporting an hour that was worked as unowned.
        return pool.length > 0 ? pool
          : buildHourPool({ hour, leaveMap, overridesMap, onShiftNames, clockedOutNames, awayNames }).poolNames
      }
      return rosterPool(hour)
    }

    // Login map
    const loginMap = {}
    shiftRows.slice(1)
      .filter(r => r[2] === date)
      .forEach(r => { loginMap[r[1]] = { startTime:r[3], endTime:r[4], duration:r[5], status:r[6] } })

    const empData = employees().map(emp => {
      const shiftLog = loginMap[emp.name] || null
      const leaves   = leaveMap[emp.name] || []
      const empOverride = overridesMap[emp.name]
      const effectiveEmp = empOverride ? { ...emp, start: empOverride.start, end: empOverride.end } : emp

      // All scheduled hours for this employee (Early Start / OT aware),
      // built in CHRONOLOGICAL SHIFT ORDER starting from the actual start
      // hour — not ascending numeric order, which would put post-midnight
      // hours (0,1,2...) before the shift's real early hours for anyone
      // wrapping past midnight. Wraparound is derived from the EFFECTIVE
      // start/end (not the static isNight flag), since an Early/Late Start
      // or OT can push a normally-day shift across midnight too.
      const isWrap = effectiveEmp.end <= effectiveEmp.start
      const scheduledHours = []
      if (isWrap) {
        for (let h = effectiveEmp.start; h < 24; h++) scheduledHours.push(h)
        for (let h = 0; h < effectiveEmp.end; h++) scheduledHours.push(h)
      } else {
        for (let h = effectiveEmp.start; h < effectiveEmp.end; h++) scheduledHours.push(h)
      }

      const hours = scheduledHours.map(hour => {
        const isOnLeave = leaves.some(l => {
          if (l.fromHour <= l.toHour) return hour >= l.fromHour && hour < l.toHour
          return hour >= l.fromHour || hour < l.toHour
        })

        const customText = customTextFor(emp.name, hour)
        if (customText) {
          return { hour, isOnLeave: false, isCustom: true, customText, clients: [], totalClients: 0, completedClients: 0, missedClients: 0 }
        }

        if (isOnLeave) {
          const leaveEntry = leaves.find(l => {
            if (l.fromHour <= l.toHour) return hour >= l.fromHour && hour < l.toHour
            return hour >= l.fromHour || hour < l.toHour
          })
          return { hour, isOnLeave: true, leaveReason: leaveEntry?.reason || '', clients: [], totalClients: 0, completedClients: 0, missedClients: 0 }
        }

        // An hour that has rows in CRM_Updates is settled: a row is written the
        // moment a client lands in front of somebody, so those rows are the
        // record of what that employee actually held. Only an hour with no rows
        // yet — the one in progress, or one still to come — is worked out from
        // the live split.
        //
        // This is the same rule the employee's own day uses, and it is what
        // stops a finished morning being re-attributed every time somebody
        // clocks in or out: at the end of the day, when everyone has gone home,
        // a live recompute reported the entire day as belonging to nobody.
        // An hour settles as a WHOLE, not one employee at a time. Deciding it
        // per employee mixed two incompatible records in the same hour: the
        // people who had rows were read from the rows, while a colleague with
        // no rows was re-derived from the split — and the split handed that
        // colleague clients already recorded against the others. One client at
        // one hour then appeared on two boards, which is the same failure as
        // losing one, in the opposite direction. If the hour is over and
        // anybody has rows in it, the rows are the record for everybody, and
        // an employee with none simply held none.
        const empHourRows = updateIdx[`${emp.name}__${hour}`] || {}
        const settled = hoursSeen.has(hour) && (!isToday || hourHasPassed(hour, nowHour))

        let assignedClients
        if (settled) {
          // ONE owner per slot, not one row per hand-over. CRM_Updates is
          // append-only and a placeholder is written every time a client lands
          // in front of somebody, so a client shared between two people during
          // an hour leaves a row in each of their names. Reading each
          // employee's own rows therefore put the same client-hour on two
          // boards — 48 of them in a single hour — and inflated the day's total
          // by exactly that many. collapseSlotOwners settles it the way the
          // Command Center does: whoever actually did the work owns it, and
          // failing that the most recent person to hold it.
          assignedClients = (settledOwners[hour]?.[emp.name] || []).map(client => ({
            client, vehicleCount: vehicleMap[(client || '').toLowerCase()]?.vehicleCount || 0,
          }))
        } else {
          // reserveOffShiftLocks=true matches /api/clients/current: work somebody
          // finished before going home stays theirs instead of bouncing onto a
          // colleague.
          const poolNames = hourPoolFor(hour)
          const lockedAssignments = lockedByHour[hour] || {}
          assignedClients = (distributeClientsForHour(hour, poolNames, vehicleMap, lockedAssignments, true)[emp.name] || [])

          // Work this employee has already FINISHED this hour, when the split
          // no longer lists them — they stepped away on a break, or went home.
          // The split reserves those clients so nobody redoes them, but it only
          // returns lists for people in the pool, so the finished work fell off
          // the screen entirely: six completed clients at ten o'clock were on
          // no board and in no total, which reads exactly like six clients lost.
          // They belong to whoever did them.
          Object.entries(lockedAssignments).forEach(([client, owner]) => {
            if (owner !== emp.name) return
            if (assignedClients.some(c => c.client === client)) return
            assignedClients.push({
              client, vehicleCount: vehicleMap[(client || '').toLowerCase()]?.vehicleCount || 0,
              isSpecific: false, isLocked: true,
            })
          })
        }

        // Add redistributed TO this employee (real reason + timestamp from Redistribution_Log)
        const redistToEmp = redistRows.slice(1)
          .filter(r => r[0] === date && r[3] === emp.name && parseInt(r[5]) === hour)
          .map(r => ({
            client: r[4],
            vehicleCount: vehicleMap[(r[4]||'').toLowerCase()]?.vehicleCount || 0,
            fromEmployee: r[2],
            isRedistributed: true,
            redistributedAt: r[1] || '',
            redistReason: r[6] || '',
          }))

        const allClients = [
          ...assignedClients.map(c => ({
            client: c.client,
            vehicleCount: c.vehicleCount || 0,
            isRedistributed: false,
          })),
          ...redistToEmp.filter(r => !assignedClients.some(c => c.client === r.client)),
        ]

        const empHourData = updateIdx[`${emp.name}__${hour}`] || {}
        const clientsWithStatus = allClients.map(c => ({
          ...c,
          filled:            !!(empHourData[c.client]?.filled),
          status:            empHourData[c.client]?.status    || '',
          updatedAt:         empHourData[c.client]?.updatedAt || '',
          alertCount:        parseInt(empHourData[c.client]?.alertCount) || 0,
          // The sheet holds a LIST of vehicle numbers here, not a number.
          // parseInt("KA01AB1234, KA02CD5678") is NaN, so every misalignment
          // an employee recorded was reported to the admin as zero. What the
          // admin wants is how many vehicles were flagged.
          misalignVehicles:  countListed(empHourData[c.client]?.misalignVehicles),
          misalignList:      (empHourData[c.client]?.misalignVehicles || '').toString().trim(),
          // Fatigue never reached the admin at all, though it is exactly the
          // kind of thing they are watching for.
          fatigue:           (empHourData[c.client]?.fatigue || '').toString().trim(),
          fatigueCount:      parseInt(empHourData[c.client]?.fatigueCount) || 0,
          liveVehicles:      parseInt(empHourData[c.client]?.liveVehicles) || 0,
        }))

        return {
          hour,
          isOnLeave: false,
          clients: clientsWithStatus,
          totalClients:     clientsWithStatus.length,
          completedClients: clientsWithStatus.filter(c => c.filled).length,
          missedClients:    clientsWithStatus.filter(c => !c.filled).length,
        }
      })

      return {
        name:      emp.name,
        shiftStart: emp.start,
        shiftEnd:   emp.end,
        effectiveStart: effectiveEmp.start,
        effectiveEnd:   effectiveEmp.end,
        usedEarlyStart: !!empOverride?.usedEarlyStart,
        usedOT:         !!empOverride?.usedOT,
        isNight:    emp.isNight,
        loggedIn:   !!shiftLog,
        startTime:  shiftLog?.startTime || '',
        endTime:    shiftLog?.endTime   || '',
        duration:   shiftLog?.duration  || '',
        status:     shiftLog?.status    || 'not_started',
        // Clocked in and never clocked out, long enough ago that nobody is
        // coming back to it. The same rule the employee's own screen uses, so
        // the two cannot describe the same person differently.
        shiftStale: isToday
          && !!shiftLog?.startTime && !shiftLog?.endTime
          && !onShiftNames.has(emp.name),
        leaves,
        hours,
        totalAssigned:  hours.reduce((s,h) => s + h.totalClients,     0),
        totalCompleted: hours.reduce((s,h) => s + h.completedClients, 0),
        totalMissed:    hours.reduce((s,h) => s + h.missedClients,    0),
        // Fatigue is an alert too — the admin is watching for exactly this.
        totalAlerts:    hours.reduce((s,h) => s + h.clients.reduce((a,c)=>a+(c.alertCount||0)+(c.fatigueCount||0), 0), 0),
        totalFatigue:   hours.reduce((s,h) => s + h.clients.reduce((a,c)=>a+(c.fatigueCount||0), 0), 0),
        totalMisalign:  hours.reduce((s,h) => s + h.clients.reduce((a,c)=>a+(c.misalignVehicles||0), 0), 0),
        totalRedistributed: hours.reduce((s,h) => s + h.clients.filter(c=>c.isRedistributed).length, 0),
      }
    })

    return res.status(200).json({ date, employees: empData })

  } catch (err) {
    console.error('Full day view error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
