import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr,
  getShiftOverridesForDate, getLeaveMapForDate, getOnShiftNamesFromLog, getClockedOutNamesFromLog, yesterdayStr,
  hourHasPassed, whoWasOnShiftAtHour, businessHourOrder, DAY_START_HOUR,
  getAwayOnBreakNames, fetchClientVehicleCounts,
} from '../../../lib/sheets'
import { employees, isScheduledAtHour, distributeClientsForHour, clientTimings, getScheduledEmployeesAtHour, auditHourAssignment, specificClientsFor } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { buildHourPool, buildLockedAssignments, collapseSlotOwners } from '../../../lib/distribution'
import { sweepShiftAutoClose } from '../../../lib/attendance'

const ISSUE_TAB = 'Issues- Realtime'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const today       = todayStr()
    const currentHour = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours()

    // Close shifts left running past their window, before anything is read —
    // so this very response shows the floor as it now is rather than as it was
    // a refresh ago. Idempotent; a row already Ended is skipped.
    try { await sweepShiftAutoClose(employees()) }
    catch (e) { console.error('shift auto-close sweep failed:', e.message) }

    const [credRows, shiftRows, breakRows, updateRows, redistRows, footageRows, overridesMap, leaveMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID,   `${TABS.CREDENTIALS}!A:H`, 60000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.SHIFT_LOG}!A:H`, 15000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.BREAKS}!A:H`, 15000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.CRM_UPDATES}!A:L`, 15000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.REDISTRIB}!A:G`, 15000),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, 90000),
      getShiftOverridesForDate(today),
      getLeaveMapForDate(today),
    ])

    // Who is not coming in today.
    //
    // There are two ways an employee ends up off for the day and this screen
    // used to know only one of them. The Credentials sheet carries a standing
    // weekly week-off flag; the no-show sweep in /api/clients/current writes a
    // "Week Off" row into the Leaves tab when somebody never clocks in. Reading
    // only the first meant the same person showed as "Week off" on The day and
    // "Not started" on this screen — two answers to one question, which is
    // exactly what the admin opens the platform to avoid.
    const weekOffEmps = new Set(
      credRows.slice(1)
        .filter(r => (r[7] || '').toString().toLowerCase() === 'yes')
        .map(r => r[1])
    )
    Object.entries(leaveMap).forEach(([name, entries]) => {
      // Exactly "Week Off" — a row shortened to "Week Off (returned)" means the
      // employee did turn up, and the remaining leave hours already keep them
      // out of the hours they missed.
      if (entries.some(l => (l.reason || '').toString().trim() === 'Week Off')) weekOffEmps.add(name)
    })

    // ── People the roster cannot see ──────────────────────────────────────
    // Credentials is what lets somebody log in; the roster is built from the
    // same sheet but skips any row whose shift hours will not parse, because
    // guessing hours would quietly put a person on a shift they do not work.
    // The result is an employee who can sign in, is given no clients, appears
    // on no admin screen, and is counted in no total — invisible to everyone
    // including themselves. Rather than fix it by guessing, it is named here.
    const rosterNames = new Set(employees().map(e => e.name))
    const rosterIssues = credRows.slice(1)
      .filter(r => {
        const name = (r[1] || '').toString().trim()
        const role = (r[3] || 'employee').toString().trim().toLowerCase()
        return name && role !== 'admin' && !rosterNames.has(name)
      })
      .map(r => ({
        empId: (r[0] || '').toString().trim(),
        name:  (r[1] || '').toString().trim(),
        reason: (!Number.isFinite(parseInt(r[4], 10)) || !Number.isFinite(parseInt(r[5], 10)))
          ? 'no shift hours set in Credentials'
          : 'not on the roster',
      }))

    // ── Clients the schedule can never deliver ────────────────────────────
    // A row in Client_Timings with no usable hours is a client that reaches
    // nobody on any day: it is on no board, so no employee can miss it, and
    // every total on this platform is measured against the schedule — so it
    // does not even count as work that was not done. It is invisible, which is
    // the worst way for a client to be dropped. Named here so it is not.
    const clientIssues = Object.entries(clientTimings())
      .filter(([, hours]) => !hours || hours.length === 0)
      .map(([client]) => ({ client, reason: 'no hours set in Client_Timings' }))

    const todayShifts = shiftRows.slice(1).filter(r => r[2] === today)
    // Anyone who actually clocked in is here, whatever any flag says.
    todayShifts.forEach(r => { if (r[3]) weekOffEmps.delete(r[1]) })

    // ── One owner per slot, rather than one row per hand-over ──
    // For hours already gone this trail is the only record there is. For the
    // hour in progress it isn't good enough: a placeholder keeps the name of
    // whoever held the client when the row was written, and the split moves
    // every time somebody clocks in or out — so the current hour is taken
    // from the live split further down instead.
    const slotState = collapseSlotOwners(updateRows, r => r[0] === today)

    const workByEmp = {}
    slotState.forEach(({ owner, done, hour }) => {
      if (!workByEmp[owner]) workByEmp[owner] = { assigned: 0, completed: 0 }
      // Finished work counts wherever it happened. Unfinished work in the
      // hour in progress is left out here and replaced by the live split,
      // so the Command Center shows the same board the employee is looking
      // at rather than a stale trail of who held what earlier.
      if (done) { workByEmp[owner].assigned += 1; workByEmp[owner].completed += 1; return }
      if (parseInt(hour) === currentHour) return
      workByEmp[owner].assigned += 1
    })

    // Every hour of the day, audited against the schedule itself: is each
    // client due this hour actually on somebody's board?
    //
    // The one thing this platform must never do is lose a client, and a client
    // that reaches nobody is invisible by definition — it is on no board, so no
    // employee can miss it, and nothing would ever report it. This measures the
    // split against Client_Timings directly and names anything unplaced.
    let coverageGaps = []

    // A night shift is logged under the day it began, so both days count as
    // "clocked in right now".
    const yesterdayTop = yesterdayStr()
    // The same definition of "on shift" the employee's own screen uses: an
    // Active row, and not one left open so long that it is plainly forgotten.
    // The admin used to read the raw row instead, so somebody whose own
    // dashboard said "Not started" was listed here as on duty — two answers
    // about the same person on the same platform.
    const onShiftNamesTop = getOnShiftNamesFromLog(shiftRows, [today, yesterdayTop])
    const awayNamesTop    = getAwayOnBreakNames(breakRows, [today, yesterdayTop])

    // The hour in progress, worked out exactly as the employee's own board
    // works it out — same pool, same locks, same vehicle-count balancing.
    try {
      const vehicleMapForAudit = await fetchClientVehicleCounts()
      // Which clients already reached somebody's board, hour by hour. A row in
      // CRM_Updates is written the moment a client lands in front of an
      // employee, so for an hour that has finished this trail IS the record of
      // who had what — and it is the only honest one. Recomputing a finished
      // hour from who happens to be on shift now reported the entire day as
      // unassigned the moment the last person went home, which is both alarming
      // and false: those hours were worked.
      const seenByHour = {}
      updateRows.slice(1).filter(r => r[0] === today).forEach(r => {
        const h = parseInt(r[4])
        if (!Number.isFinite(h)) return
        if (!seenByHour[h]) seenByHour[h] = new Set()
        seenByHour[h].add(r[3])
      })

      const nowHour = currentHour
      for (let h = 0; h < 24; h++) {
        const due = Object.entries(clientTimings()).filter(([, hs]) => hs.includes(h)).map(([n]) => n)
        if (due.length === 0) continue

        let unassigned, reason, dueTotal = due.length
        if (hourHasPassed(h, nowHour)) {
          // Finished. Judged on who was ACTUALLY at work during that hour, read
          // back from the attendance log's own start and end times — not on who
          // is clocked in now, which by the evening is nobody and would report a
          // fully worked day as belonging to no one.
          //
          // A client counts as having reached somebody if it was placed by the
          // split for that hour, or if a row was written for it. The second is
          // what covers an hour whose staffing has since been edited.
          const wereHere = whoWasOnShiftAtHour(shiftRows, today, h, nowHour)
          const rostered = getScheduledEmployeesAtHour(h, leaveMap, overridesMap).map(e => e.name)
          const pool = rostered.filter(n => wereHere.has(n))
          const seen = seenByHour[h] || new Set()
          if (pool.length === 0) {
            unassigned = due.filter(c => !seen.has(c))
            reason = 'no-staff'
          } else {
            const audit = auditHourAssignment(
              h, pool, vehicleMapForAudit,
              buildLockedAssignments(updateRows, today, h), true
            )
            unassigned = audit.unassigned.filter(c => !seen.has(c))
            reason = audit.reason
            dueTotal = audit.due
          }
        } else if (h === nowHour) {
          // The hour in progress, split exactly as the employee's own board
          // splits it: who is actually clocked in, minus anyone away.
          const { poolNames } = buildHourPool({
            hour: h, leaveMap, overridesMap,
            onShiftNames: onShiftNamesTop,
            clockedOutNames: getClockedOutNamesFromLog(shiftRows, [today, yesterdayTop]),
            awayNames: awayNamesTop,
          })
          const audit = auditHourAssignment(
            h, poolNames, vehicleMapForAudit,
            buildLockedAssignments(updateRows, today, h), true
          )
          unassigned = audit.unassigned
          reason = audit.reason
          dueTotal = audit.due
        } else {
          // Still to come. Judged on the ROSTER, not on who happens to be at a
          // desk this minute — an hour tonight is covered by the night shift
          // whether or not the night shift has arrived yet.
          //
          // Reading live presence here raised a false alarm every morning: the
          // people who cover 6am had ended their shift a few hours earlier, so
          // they counted as "gone home", the pool for 6am came out empty, and
          // the screen announced ninety-six clients on nobody's board for an
          // hour that is twenty hours away and fully staffed. What this reading
          // is for is the genuine case — an hour the roster does not cover at
          // all — and the roster is the only thing that can answer it.
          const pool = getScheduledEmployeesAtHour(h, leaveMap, overridesMap)
            .map(e => e.name)
            .filter(n => !weekOffEmps.has(n))
          const audit = auditHourAssignment(h, pool, vehicleMapForAudit, {}, true)
          unassigned = audit.unassigned
          reason = audit.reason
          dueTotal = audit.due
        }

        if (unassigned.length > 0) {
          coverageGaps.push({
            hour: h,
            clients: unassigned.length,
            // From the same audit as the count above. Taking the numerator from
            // the audit (which counts named clients whose owner is absent as
            // work that is due) and the denominator from the schedule alone
            // produced "127 of 126 unassigned".
            due: dueTotal,
            reason,
            past: hourHasPassed(h, nowHour),
            sample: unassigned.slice(0, 6),
          })
        }
      }
      const vehicleMap = await fetchClientVehicleCounts()
      // A night shift is logged under the day it began, so both days count
      // as "clocked in right now".
      const yesterday = yesterdayTop
      const { poolNames } = buildHourPool({
        hour: currentHour, leaveMap, overridesMap, onShiftNames: onShiftNamesTop,
        clockedOutNames: getClockedOutNamesFromLog(shiftRows, [today, yesterday]),
        // Somebody on a long break is not working this hour, so the hour is
        // not theirs — the boards apply the same rule, and the two must never
        // disagree about who holds a client.
        awayNames: awayNamesTop,
      })
      const locked = buildLockedAssignments(updateRows, today, currentHour)
      const dist = distributeClientsForHour(currentHour, poolNames, vehicleMap, locked, true)
      Object.entries(dist).forEach(([name, clients]) => {
        if (!workByEmp[name]) workByEmp[name] = { assigned: 0, completed: 0 }
        // Anything already finished is counted above; this adds what is
        // still outstanding on their board right now.
        const outstanding = clients.filter(c => locked[c.client] !== name).length
        workByEmp[name].assigned += outstanding
      })
    } catch (e) {
      // The live split is an improvement on the row trail, not a
      // requirement — never take the whole Command Center down for it.
      console.error('overview: live split failed', e.message)
    }

    const empStatus = employees().map(emp => {
      const shiftLog   = todayShifts.find(r => r[1] === emp.name)
      const override   = overridesMap[emp.name]
      const effective  = override ? { ...emp, start: override.start, end: override.end } : emp
      const isActive   = isScheduledAtHour(effective, currentHour)
      const isWeekOff  = weekOffEmps.has(emp.name)
      const hasStarted = !!shiftLog?.[3]
      const hasEnded   = shiftLog?.[6] === 'Ended'
      // Row still says Active, but not recently enough to be believed — the
      // shift was never closed and the day has moved on. It is neither "on
      // duty" nor "ended"; it is a row somebody has to tidy up.
      const shiftStale = hasStarted && !hasEnded && !onShiftNamesTop.has(emp.name)

      const myWork = workByEmp[emp.name] || { assigned: 0, completed: 0 }
      const assignedCount  = myWork.assigned
      const completedCount = myWork.completed

      // What actually happened beats what was planned: somebody flagged week
      // off who turned up anyway is on the floor, and saying otherwise hides a
      // person who is doing work.
      let statusLabel = 'Not Started'
      if (hasEnded)         statusLabel = 'Ended'
      else if (shiftStale)  statusLabel = 'Left Open'
      else if (hasStarted)  statusLabel = 'Active'
      else if (isWeekOff)   statusLabel = 'Week Off'
      else if (isActive)    statusLabel = 'Not Started'
      else                  statusLabel = 'Off Shift'

      return {
        name:         emp.name,
        shiftStart:   emp.start,
        shiftEnd:     emp.end,
        // The window actually in force today — an Early/Late Start or OT
        // adjustment moves this away from the static roster hours, and the
        // admin needs to see the real one.
        effStart:     effective.start,
        effEnd:       effective.end,
        isAdjusted:   !!override,
        // Is this employee inside their shift window at this very hour?
        // Drives the live "right now" health reading.
        isScheduledNow: isActive,
        // Clocked in, but their window has already run out. Nothing closes a
        // shift on its own, so this is somebody the admin has to chase: the
        // attendance row has no end time and no duration until it is closed.
        shiftOverdue: statusLabel === 'Active' && !isActive,
        // A shift row still open from long enough ago that nobody is coming
        // back to it. Shown separately so it reads as data to clean up rather
        // than as somebody standing on the floor.
        shiftStale,
        onBreakLong:  awayNamesTop.has(emp.name),
        isNight:      emp.isNight,
        isWeekOff,
        statusLabel,
        startTime:    shiftLog?.[3] || '',
        endTime:      shiftLog?.[4] || '',
        duration:     shiftLog?.[5] || '',
        totalUpdates: completedCount,
        assignedCount,
        pendingCount: assignedCount - completedCount,
      }
    })

    const todayRedistrib = redistRows.slice(1)
      .filter(r => r[0] === today)
      .map(r => ({ from: r[2], to: r[3], client: r[4], hour: r[5] }))

    // Issue Tracker: J(9)=Sub-request, R(17)=Resolved Y/N
    const pendingFootage = footageRows.slice(1).filter(r => {
      const sub = (r[9] || '').toString().toLowerCase()
      const resolved = (r[17] || '').toString().toLowerCase()
      return sub.includes('customer request for video') && resolved !== 'yes'
    }).length

    const doneFootage = footageRows.slice(1).filter(r => {
      const sub = (r[9] || '').toString().toLowerCase()
      const resolved = (r[17] || '').toString().toLowerCase()
      return sub.includes('customer request for video') && resolved === 'yes'
    }).length

    // ══════════════════════════════════════════════════════════════════
    // The day, in numbers that grow as it happens
    //
    // Two questions the Command Center could not answer:
    //   - how much work is each person going to see today, and how much of it
    //     have they actually done;
    //   - how much of the whole day's work has been done SO FAR.
    //
    // Both are built from the schedule itself, hour by hour, and both are
    // cumulative: at noon they cover 7am through noon, and they grow with
    // every hour that opens. Nothing is estimated or extrapolated — an hour
    // that has not begun is not counted in "so far", and the full-day figures
    // are what the sheet says the day holds.
    //
    // The split each hour is the real one: named clients go to the employee
    // they are named against, custom-duty hours take no clients at all, and
    // everything else is shared by vehicle count between the people whose
    // roster covers that hour and who are not on leave.
    // ══════════════════════════════════════════════════════════════════
    let workload = null
    try {
      const vehicleMap = await fetchClientVehicleCounts()
      const vehiclesOf = (c) => vehicleMap[(c || '').toString().trim().toLowerCase()]?.vehicleCount || 0

      // What was actually recorded today, per employee and in total.
      const doneRows = updateRows.slice(1).filter(r => r[0] === today && (r[5] || '').toString().trim())
      const perEmp = {}
      const actualOf = (name) => (perEmp[name] ||= {
        clientsDone: 0, vehiclesChecked: 0, alerts: 0, fatigue: 0,
        footageRaised: 0, footageDone: 0,
      })
      let doneVehicles = 0, doneAlerts = 0, doneFatigue = 0
      const doneKeys = new Set()
      doneRows.forEach(r => {
        const a = actualOf(r[2])
        a.clientsDone      += 1
        a.vehiclesChecked  += parseInt(r[11]) || 0
        a.alerts           += parseInt(r[7])  || 0
        a.fatigue          += parseInt(r[9])  || 0
        doneVehicles  += parseInt(r[11]) || 0
        doneAlerts    += parseInt(r[7])  || 0
        doneFatigue   += parseInt(r[9])  || 0
        doneKeys.add(`${r[4]}|${r[3]}`)
      })
      // Footage each person raised TODAY, and how much of it was delivered
      // today. Column E(4) is when it was raised, H(7) who raised it, R(17)
      // whether it is resolved and S(18) when — the same mapping
      // /api/footage/list reads.
      //
      // Scoped to the operating day, like everything else on this screen. The
      // Issue Tracker goes back years, so counting every row ever raised told
      // an employee they had raised 283 requests "today"; and the operating day
      // is what makes a request raised at 3am belong to the night that is
      // ending rather than to the morning that is starting.
      const raisedOnOperatingDay = (stamp) => {
        const raw = (stamp || '').toString().trim()
        if (!raw) return false
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/)
        if (!m) return false
        const [, dd, mo, yyyy, hh] = m
        const d = new Date(+yyyy, +mo - 1, +dd, hh ? +hh : 12, 0, 0, 0)
        // Before 7am belongs to the previous operating day.
        if (hh !== undefined && +hh < DAY_START_HOUR) d.setDate(d.getDate() - 1)
        return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` === today
      }
      footageRows.slice(1).forEach(r => {
        const sub = (r[9] || '').toString().toLowerCase()
        if (!sub.includes('customer request for video')) return
        const raisedBy = (r[7] || '').toString().trim()
        if (!raisedBy) return
        const resolved = (r[17] || '').toString().toLowerCase() === 'yes'
        if (raisedOnOperatingDay(r[4])) actualOf(raisedBy).footageRaised += 1
        // Delivered today counts wherever it was raised — closing out
        // yesterday's queue is this shift's work, and hiding it would tell
        // somebody who cleared ten old requests that they did nothing.
        if (resolved && raisedOnOperatingDay(r[18])) actualOf(raisedBy).footageDone += 1
      })

      // What the day holds, hour by hour.
      const expected = {}
      const expectedOf = (name) => (expected[name] ||= { clients: 0, vehicles: 0, hours: 0 })
      let dueClientsSoFar = 0, dueVehiclesSoFar = 0
      let dueClientsAll   = 0, dueVehiclesAll   = 0
      // Filled, counted the same way as due — one client in one hour is one
      // slot — so "done" can never outrun "due" the way a raw row count could.
      let doneClientsSoFar = 0, doneClientsAll = 0
      const byHour = []

      for (const h of businessHourOrder()) {
        // Everything an employee will actually be handed this hour: the clients
        // Client_Timings schedules, PLUS any client named against an employee in
        // Employee_Hours that the schedule does not list. A named client always
        // reaches its employee whether or not the timings sheet mentions it, so
        // leaving it out of the day's total meant the totals here disagreed with
        // the boards by exactly those clients.
        const dueSet = new Set(
          Object.entries(clientTimings()).filter(([, hs]) => hs.includes(h)).map(([n]) => n)
        )
        employees().forEach(e => (specificClientsFor(e.name, h) || []).forEach(c => dueSet.add(c)))
        const dueNames = [...dueSet]
        if (dueNames.length === 0) continue
        const hourVehicles = dueNames.reduce((sum, c) => sum + vehiclesOf(c), 0)
        const passed = hourHasPassed(h, currentHour) || h === currentHour

        dueClientsAll  += dueNames.length
        dueVehiclesAll += hourVehicles
        if (passed) { dueClientsSoFar += dueNames.length; dueVehiclesSoFar += hourVehicles }

        // Who this hour is planned for: rostered, minus anyone on leave, minus
        // anyone off for the day. Not "who is clocked in" — this is what the
        // day holds for each person, not what they are holding this minute.
        //
        // Somebody who is not coming in cannot be given a share of the hour:
        // in reality their clients are split between the people who ARE here,
        // so counting them in would tell every one of their colleagues they
        // have less work than they are actually about to get.
        const pool = getScheduledEmployeesAtHour(h, leaveMap, overridesMap)
          .map(e => e.name)
          .filter(n => !weekOffEmps.has(n))
        // distributeClientsForHour already keeps anyone holding a named client
        // or a custom-duty hour out of the ordinary share for that hour — they
        // get their one fixed client, or nothing, and the rest of the hour is
        // divided by vehicle count between everybody else.
        const dist = distributeClientsForHour(h, pool, vehicleMap, {}, false)
        Object.entries(dist).forEach(([name, cs]) => {
          if (cs.length === 0) return
          const e = expectedOf(name)
          e.clients  += cs.length
          e.vehicles += cs.reduce((sum, c) => sum + (c.vehicleCount || 0), 0)
          e.hours    += 1
        })

        const doneThisHour = dueNames.filter(c => doneKeys.has(`${h}|${c}`)).length
        doneClientsAll += doneThisHour
        if (passed) doneClientsSoFar += doneThisHour

        byHour.push({
          hour: h, passed,
          clients: dueNames.length, vehicles: hourVehicles,
          done: doneThisHour,
        })
      }

      workload = {
        byHour,
        soFar: {
          // Counted as slots, the same unit the "due" figures use: one client
          // in one hour is one piece of work. Counting rows instead would
          // double anything that was written twice after a hand-over.
          clients: dueClientsSoFar, clientsDone: doneClientsSoFar,
          vehicles: dueVehiclesSoFar, vehiclesChecked: doneVehicles,
          alerts: doneAlerts, fatigue: doneFatigue, alertsTotal: doneAlerts + doneFatigue,
        },
        // 7am to 7am — the whole operating day, including the hours still to
        // come. The "done" side is the same live tally as above, so this block
        // fills in as the day is worked rather than only settling at the end.
        fullDay: {
          clients: dueClientsAll, clientsDone: doneClientsAll,
          vehicles: dueVehiclesAll, vehiclesChecked: doneVehicles,
          alerts: doneAlerts, fatigue: doneFatigue, alertsTotal: doneAlerts + doneFatigue,
        },
        perEmployee: employees().map(e => ({
          name: e.name,
          isWeekOff:        weekOffEmps.has(e.name),
          expectedClients:  expected[e.name]?.clients  || 0,
          expectedVehicles: expected[e.name]?.vehicles || 0,
          expectedHours:    expected[e.name]?.hours    || 0,
          clientsDone:      perEmp[e.name]?.clientsDone     || 0,
          vehiclesChecked:  perEmp[e.name]?.vehiclesChecked || 0,
          alerts:           perEmp[e.name]?.alerts          || 0,
          fatigue:          perEmp[e.name]?.fatigue         || 0,
          alertsTotal:     (perEmp[e.name]?.alerts || 0) + (perEmp[e.name]?.fatigue || 0),
          footageRaised:    perEmp[e.name]?.footageRaised   || 0,
          footageDone:      perEmp[e.name]?.footageDone     || 0,
        })),
      }
    } catch (e) {
      console.error('overview: workload failed', e.message)
    }

    return res.status(200).json({
      employees:      empStatus,
      workload,
      rosterIssues,
      clientIssues,
      coverageGaps,
      redistribution: todayRedistrib,
      footage: { pending: pendingFootage, done: doneFootage },
      kpis: {
        total:      employees().length,
        active:     empStatus.filter(e => e.statusLabel === 'Active').length,
        weekOff:    empStatus.filter(e => e.isWeekOff).length,
        notStarted: empStatus.filter(e => e.statusLabel === 'Not Started').length,
      },
    })

  } catch (err) {
    console.error('Admin overview error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
