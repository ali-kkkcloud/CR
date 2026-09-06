import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr,
  getShiftOverridesForDate, getLeaveMapForDate, getOnShiftNamesFromLog, getClockedOutNamesFromLog, yesterdayStr,
  hourHasPassed, whoWasOnShiftAtHour, businessHourOrder, DAY_START_HOUR,
  getAwayOnBreakNames, fetchClientVehicleCounts, calcDurationMinutes, nowStr, nowIST, getWatchlistNames, TTL, warmTogether, SHIFT_SCREEN_TABS,
  vehicleKey, vehicleMapHealth,
} from '../../../lib/sheets'
import { employees, weekOffNamesFor, orphanedPins, nameClashes, isScheduledAtHour, distributeClientsForHour, clientTimings, getScheduledEmployeesAtHour, auditHourAssignment, specificClientsFor } from '../../../lib/schedule'
import { loadScheduleData, duplicateTimingRows, unusableHourRows } from '../../../lib/roster'
import { buildHourPool, buildLockedAssignments, collapseSlotOwners } from '../../../lib/distribution'
import { computeDayPlan, staleClientsFrom } from '../../../lib/dayplan'
import { computeScore, whoWorkedOn } from '../../../lib/score'
import { COL, raisedOperatingDay, isFootageRequest } from '../../../lib/issues'
import { sweepShiftAutoClose, totalBreakMinutes, isSupersededBreak, activityClocks, resolveMoment } from '../../../lib/attendance'
import { assessEmployee } from '../../../lib/integrity'
import { sweepDailySummary } from '../../../lib/rollup'
import { getHistory } from '../../../lib/history'

const ISSUE_TAB = 'Issues- Realtime'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    // ── Every book at once, not one after the other ──────────────────
    //
    // A batch cannot span two spreadsheets, so the CRM book, the Issue Tracker
    // and the vehicle source are always separate requests. What matters is
    // that they are not separate requests IN SERIES: warming only the CRM book
    // left the other two waiting behind it, and the screen took three round
    // trips to answer data that needed one. Fired together, the slowest is
    // what the admin waits for.
    //
    // Failures are swallowed — this is a prefetch, and the real read further
    // down decides whether a missing tab matters.
    await Promise.all([
      warmTogether(CRM_SHEET_ID, [
        ...SHIFT_SCREEN_TABS,
        `${TABS.DAILY_SUMMARY}!A:N`,
      ]).catch(() => null),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, TTL.ISSUES).catch(() => null),
      fetchClientVehicleCounts().catch(() => null),
      getHistory().catch(() => null),
      // A dozen names, changed about once a week, and it was being fetched
      // four hundred lines below in a request of its own — a whole round trip
      // for a tab that fits on a postcard. Asked for here it rides the CRM
      // batch that is leaving anyway and costs nothing. It keeps its own ten
      // minute life; this only decides which request carries it.
      getWatchlistNames().catch(() => null),
    ])

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

    // Close out any finished day that has not been summarised yet. Idempotent
    // and free after the first time — a day already rolled up is skipped
    // without reading anything else. See lib/rollup.js for why the detail
    // cannot be the thing the month screens read.
    try { await sweepDailySummary() }
    catch (e) { console.error('daily summary sweep failed:', e.message) }

    const [credRows, shiftRows, breakRows, updateRows, redistRows, footageRows, overridesMap, leaveMap] = await Promise.all([
      readSheetCached(CRM_SHEET_ID,   `${TABS.CREDENTIALS}!A:H`, TTL.ROSTER),
      readSheetCached(CRM_SHEET_ID,   `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID,   `${TABS.BREAKS}!A:H`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID,   `${TABS.CRM_UPDATES}!A:L`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID,   `${TABS.REDISTRIB}!A:G`, TTL.LIVE),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, TTL.ISSUES),
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
    // The union of the two, worked out in one place so Hour by hour and
    // Employee Progress cannot answer differently. See weekOffNamesFor.
    const weekOffEmps = weekOffNamesFor(leaveMap)

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

    // ── One client written on two rows ────────────────────────────────
    //
    // The hours are unioned rather than one row silently replacing the other,
    // because losing an hour somebody typed is the worse mistake. But the
    // union can be wrong the other way — a row meant to REPLACE and never
    // deleted now adds hours — so the duplicate is named here and the admin
    // decides. Both tabs are already warmed, so this costs nothing.
    //
    // Found live: KARTHIKEYA TOURS AND TRAVELS on two rows with different
    // hours, six of which nobody had been watching.
    const [timingRows, hourRows] = await Promise.all([
      readSheetCached(CRM_SHEET_ID, `${TABS.CLIENT_TIMINGS}!A:B`, TTL.ROSTER).catch(() => null),
      readSheetCached(CRM_SHEET_ID, `${TABS.EMPLOYEE_HOURS}!A:D`, TTL.ROSTER).catch(() => null),
    ])
    duplicateTimingRows(timingRows || []).forEach(d => clientIssues.push({
      client: d.client,
      reason: `written on ${d.rows} rows — hours merged from ${d.hours.join('  |  ')}`,
    }))

    const todayShifts = shiftRows.slice(1).filter(r => r[2] === today)
    // Anyone who actually clocked in is here, whatever any flag says.
    todayShifts.forEach(r => { if (r[3]) weekOffEmps.delete(r[1]) })

    // Gone home for this operating day: they have a row today and none of them
    // is still Active. Hours still to come are not theirs. Rows dated
    // yesterday are deliberately ignored — a night-shift employee who finished
    // at six this morning is due back tonight.
    const shiftsByNameToday = {}
    todayShifts.forEach(r => {
      const n = (r[1] || '').toString().trim()
      if (n) (shiftsByNameToday[n] ||= []).push(r)
    })
    const goneHomeToday = new Set(
      Object.entries(shiftsByNameToday)
        .filter(([, rows]) => !rows.some(r => r[6] === 'Active'))
        .map(([n]) => n)
    )

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

    // ── The day, worked out once ─────────────────────────────────────────
    // Every number below — what each hour holds, who holds it, what has been
    // recorded against it, and anything that reaches nobody — comes from one
    // computation shared with Hour by hour and with every employee's own day.
    // They used to be worked out separately and gave four different answers
    // about the same person on the same afternoon.
    const yesterdayTop = yesterdayStr()
    const onShiftNamesTop = getOnShiftNamesFromLog(shiftRows, [today, yesterdayTop])
    const awayNamesTop    = getAwayOnBreakNames(breakRows, [today, yesterdayTop])

    // ── Attendance: in, out, and how long away ──
    //
    // The three facts a supervisor checks first every morning and could not
    // get from this screen: when each person clocked in, when they clocked
    // out, and how much break they took in between. Break minutes lived only
    // in the Breaks tab, which meant opening a second screen and reading it
    // against a third to line it up with the shift row.
    //
    // A running break counts too, from its start to this minute — otherwise
    // somebody who walked away an hour ago and never came back reads as
    // having taken no break at all, which is the exact opposite of the truth.
    // Rows are de-duplicated the same way the Breaks tab does it (employee +
    // date + start time), so a break opened twice is never counted twice.
    const breakTotals = {}
    {
      // The roster is where an employee's ID lives, so that is where this
      // takes it from. It used to be scraped out of the Breaks tab instead —
      // first row wins, across the sheet's whole history — so a name whose
      // oldest break carried a blank or a since-changed ID was looked up under
      // the wrong ID from then on, and their break total quietly read zero
      // while the floor beside it showed them away. A number nobody can
      // explain is worse than no number at all.
      const empIdByName = {}
      employees().forEach(e => { if (e.name) empIdByName[e.name] = (e.empId || '').toString().trim() })
      // Anyone with break rows but no roster entry — a leaver, or a name typed
      // differently — still needs an ID, or their history disappears from this
      // screen the day they come off the roster.
      breakRows.slice(1).forEach(r => {
        const nm = (r[1] || '').toString().trim()
        const id = (r[0] || '').toString().trim()
        if (nm && id && !empIdByName[nm]) empIdByName[nm] = id
      })
      const seen = new Set()
      breakRows.slice(1).forEach(r => {
        if (r[2] !== today) return
        // A row the repair superseded is history at zero minutes, not a break
        // somebody took. Counting them put hundreds of extra "sessions"
        // against names that had taken two.
        if (isSupersededBreak(r)) return
        const name = (r[1] || '').toString().trim()
        if (!name) return
        const key = `${(r[0] || '').toString().trim()}|${r[2]}|${r[3]}`
        if (seen.has(key)) return
        seen.add(key)
        const open = (r[6] || '').toString().trim() === 'Active'
        const mins = open ? calcDurationMinutes(r[2], r[3], r[2], nowStr()) : (parseInt(r[5]) || 0)
        const t = breakTotals[name] || (breakTotals[name] = { minutes: 0, sessions: 0, autoSessions: 0, openSince: null })
        t.sessions++
        if ((r[7] || '') === 'Auto') t.autoSessions++
        if (open) t.openSince = r[3] || null
      })
      // The minutes are the UNION of each person's break stretches rather than
      // the sum of their rows. Two automatic breaks can overlap — one opened
      // while another was still running, because nothing was polling for the
      // person whose machine was off — and adding them together reported six
      // hours away for a stretch of under three.
      Object.keys(breakTotals).forEach(name => {
        const id = (empIdByName[name] || '').toString().trim()
        breakTotals[name].minutes = id ? totalBreakMinutes(breakRows, id, [today]) : 0
      })
    }

    let plan = null
    let coverageGaps = []
    // Clients nobody has touched all day — see where it is built, below.
    let staleOut = []
    try {
      const vehicleMap = await fetchClientVehicleCounts()
      plan = computeDayPlan({
        date: today, today, nowHour: currentHour, yesterday: yesterdayTop,
        shiftRows, updateRows, breakRows, leaveMap, overridesMap, vehicleMap,
        weekOffNames: weekOffEmps,
      })

      // Scheduled clients that are in no vehicle list. They are handed out and
      // worked on, but they weigh nothing in the split and count for nothing in
      // the vehicle totals, so a fleet of forty reads as a fleet of none. The
      // schedule and the vehicle source disagree about them, and only a person
      // can decide which one is right.
      // Same key the map is built under — see vehicleKey in lib/sheets.
      Object.keys(clientTimings()).forEach(client => {
        const known = vehicleMap[vehicleKey(client)]
        if (!known) clientIssues.push({ client, reason: 'not in the vehicle list — counts as 0 vehicles' })
      })

      // A vehicle list that did not finish loading is indistinguishable from
      // "nobody has any vehicles" everywhere downstream: every client reads 0,
      // and the split — which is balanced BY vehicles — has nothing to balance
      // on. The floor saw exactly this one night, a whole hour of clients at
      // "0 vehicles". Said out loud rather than left to be inferred from a
      // screen full of zeros.
      const vh = vehicleMapHealth()
      if (!vh.complete) {
        clientIssues.unshift({
          client: 'The vehicle list did not load completely',
          reason: `only ${vh.clients} clients have vehicle counts — every other client is being treated as 0, which also flattens the split`,
        })
      }

      // Work that reaches nobody. The one failure nothing else would report:
      // a client on no board cannot be missed by any employee, so without this
      // it is simply absent from the platform.
      coverageGaps = plan.hours
        .filter(h => h.unassigned.length > 0)
        .map(h => ({
          hour: h.hour,
          clients: h.unassigned.length,
          due: h.dueCount,
          reason: h.reason,
          past: h.passed && h.hour !== currentHour,
          sample: h.unassigned.slice(0, 6),
        }))

      // ── Clients nobody has touched since seven this morning ────────────
      //
      // Different from a coverage gap, and worse in a quieter way. A coverage
      // gap is work that reached no board — nobody could have done it. This
      // is work that DID reach somebody's board, in one hour or in six, and
      // still has not a single update against it all day.
      //
      // Every hour is treated on its own everywhere else on this platform,
      // which is right: a client scheduled at eleven and again at five is two
      // pieces of work. But it means a client that has gone untouched from
      // one end of the day to the other never appears as one fact anywhere —
      // it is just a pending slot on six different screens, and no single
      // screen says "this client has been waiting since seven".
      //
      // The hour in progress is left out of the reckoning. Nothing in it is
      // late yet.
      staleOut = staleClientsFrom(plan, currentHour)

      // What each person is holding right now, for the floor list: finished
      // work wherever it happened, plus what is still open on their board.
      Object.entries(plan.byEmployee).forEach(([name, e]) => {
        if (!workByEmp[name]) workByEmp[name] = { assigned: 0, completed: 0 }
      })
      const nowHourEntry = plan.hours.find(h => h.hour === currentHour)
      if (nowHourEntry) {
        const locked = buildLockedAssignments(updateRows, today, currentHour)
        Object.entries(nowHourEntry.owners).forEach(([name, clients]) => {
          if (!workByEmp[name]) workByEmp[name] = { assigned: 0, completed: 0 }
          workByEmp[name].assigned += clients.filter(c => locked[c.client] !== name).length
        })
      }
    } catch (e) {
      // A missing plan must never take the whole Command Center down.
      console.error('overview: day plan failed', e.message)
    }

    const empStatus = employees().map(emp => {
      // The row that describes them NOW, not the first one of the day. An
      // employee can have more than one attendance row today — they ended a
      // shift and came back, or a forgotten row was auto-closed before they
      // started again — and reading the first one showed somebody who was at
      // their desk as "Ended". A live row wins; otherwise the most recent.
      const myRowsToday = todayShifts.filter(r => r[1] === emp.name)
      const shiftLog   = myRowsToday.find(r => r[6] === 'Active') || myRowsToday[myRowsToday.length - 1]
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

      // Their whole day, from the shared plan — the same figures the table
      // further down prints, so the floor list and the table cannot disagree.
      const myPlan = plan?.byEmployee?.[emp.name]
      const assignedCount  = myPlan?.clients ?? (workByEmp[emp.name]?.assigned || 0)
      const completedCount = myPlan?.clientsDone ?? (workByEmp[emp.name]?.completed || 0)

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
        // How long they were away from the desk today, and whether a break is
        // running right now. A break still open is counted up to this minute.
        breakMinutes:    breakTotals[emp.name]?.minutes || 0,
        breakSessions:   breakTotals[emp.name]?.sessions || 0,
        autoBreaks:      breakTotals[emp.name]?.autoSessions || 0,
        breakOpenSince:  breakTotals[emp.name]?.openSince || null,
        totalUpdates: completedCount,
        assignedCount,
        pendingCount: assignedCount - completedCount,
      }
    })

    // The months worked before the platform existed. Held in memory for half
    // an hour with a last-good copy (see lib/history.js), so putting it on the
    // screen the admin actually opens costs a sheet read about twice an hour.
    let history = { periods: [], byEmployee: {}, totals: null }
    try { history = await getHistory() }
    catch (e) { console.error('history read failed:', e.message) }

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
    // Browsers claiming attention that the sheet does not support
    //
    // An employee was found running an extension built to stop the automatic
    // break firing: it forces the idle reading to zero on every poll, fakes
    // mouse and key events, and clicks Resume if a break slips through.
    //
    // None of that can be blocked from inside the page — an extension has the
    // page's own privileges. What the server can do is notice that one clock
    // disagrees with the other: the browser reporting constant attention
    // while nothing at all has been recorded for hours. That divergence is
    // stated here and left to a person to judge. See lib/integrity.js.
    const integrityNowMs = nowIST().getTime()
    const integrityDates = [today, yesterdayStr()]
    const integrityCtx = { shiftRows, updateRows, breakRows, dates: integrityDates, nowMs: integrityNowMs }

    // Automatic breaks that ended within seconds of opening — nobody read
    // that overlay, something clicked it.
    const autoBreaksByName = {}
    breakRows.slice(1).forEach(r => {
      if ((r[7] || '') !== 'Auto') return
      if (!integrityDates.includes(r[2])) return
      if (isSupersededBreak(r)) return
      const name = (r[1] || '').toString().trim()
      if (!name || !r[4]) return
      const s = resolveMoment(r[3], integrityDates, integrityNowMs)
      const e = resolveMoment(r[4], integrityDates, integrityNowMs)
      if (s == null || e == null) return
      ;(autoBreaksByName[name] ||= []).push({ seconds: Math.round((e - s) / 1000) })
    })

    // ── Who is on the watchlist, and does the spelling match ──────────
    //
    // The list is typed by hand into a tab, and a name that matches nobody
    // watches nobody and says nothing — the exact kind of silence that gets
    // discovered weeks later. Both halves are reported.
    const watchNames = await getWatchlistNames()
    const rosterLower = new Map(employees().map(e => [e.name.toLowerCase(), e.name]))
    const watchlist = {
      watched:   [...watchNames].filter(n => rosterLower.has(n)).map(n => rosterLower.get(n)),
      unmatched: [...watchNames].filter(n => !rosterLower.has(n)),
    }

    // Credentials is the authority on who an employee ID belongs to; the
    // Breaks tab only knows the people who have taken one.
    const idOf = {}
    credRows.slice(1).forEach(r => {
      const n = (r[1] || '').toString().trim()
      if (n && !idOf[n]) idOf[n] = (r[0] || '').toString().trim()
    })

    const integrityFlags = employees().map(e => {
      const clocks = activityClocks({ empId: idOf[e.name] || '', name: e.name }, integrityCtx)
      return assessEmployee({
        name: e.name,
        onShift: onShiftNamesTop.has(e.name),
        nowMs: integrityNowMs,
        autoBreaks: autoBreaksByName[e.name] || [],
        ...clocks,
      })
    }).filter(Boolean)
      .sort((a, b) => (b.severity === 'high') - (a.severity === 'high') ||
                      (b.minutesSinceWork || 0) - (a.minutesSinceWork || 0))

    // ══════════════════════════════════════════════════════════════════
    // Everybody's performance score, worked out the way theirs is
    //
    // The admin had no score at all: it was written inside the employee's own
    // summary endpoint, so this screen had nowhere to read one from. The sums
    // now live in lib/score.js and both callers use them, which is the only
    // way the number beside a name here can be trusted to be the number that
    // person is looking at.
    //
    // Counted per person, at 5 points each. There is no denominator any
    // more — the old rule divided by the whole floor's requests, which made
    // one person's score depend on how busy everybody else had been.
    const dayFootage = footageRows.slice(1).filter(r =>
      isFootageRequest(r) && raisedOperatingDay(r[COL.RAISED_AT]) === today)
    const footageByName = {}
    dayFootage.forEach(r => {
      const who = (r[COL.RAISED_BY] || '').toString().trim().toLowerCase()
      if (who) footageByName[who] = (footageByName[who] || 0) + 1
    })

    // VEHICLES SEEN, summed across everything they recorded today.
    const vehiclesSeenByName = {}
    updateRows.slice(1).forEach(r => {
      if (r[0] !== today) return
      const name = (r[2] || '').toString().trim()
      if (!name) return
      vehiclesSeenByName[name] = (vehiclesSeenByName[name] || 0) + (parseInt(r[11], 10) || 0)
    })

    // Only the people this operating day belongs to — see whoWorkedOn. The
    // night shift that finished at seven is filed under yesterday and has no
    // business on today's board.
    const workedToday = whoWorkedOn(today, shiftRows, updateRows)
    const scores = employees().filter(e => workedToday.has(e.name)).map(e => {
      const { score, tier, breakdown } = computeScore({
        footageCount: footageByName[(e.name || '').toLowerCase()] || 0,
        vehiclesSeen: vehiclesSeenByName[e.name] || 0,
        breakMinutes: breakTotals[e.name]?.minutes || 0,
      })
      return { name: e.name, score, tier, breakdown }
    }).sort((a, b) => b.score - a.score)

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
      // Footage raised TODAY by each person, and how much of it they closed.
      //
      // Scoped to the operating day like everything else on this screen, and
      // "delivered" is counted only among what they raised today. Counting
      // every delivery of anything they had ever raised showed "1 / 0" against
      // an employee whose shift had not even started — one request from days
      // ago, closed by somebody else, reported as today's work.
      const perEmpFootage = {}
      const footageOf = (name) => (perEmpFootage[name] ||= { raised: 0, done: 0 })
      const onOperatingDay = (stamp) => {
        const raw = (stamp || '').toString().trim()
        if (!raw) return false
        const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2}))?/)
        if (!m) return false
        const [, dd, mo, yyyy, hh] = m
        const d = new Date(+yyyy, +mo - 1, +dd, hh ? +hh : 12, 0, 0, 0)
        if (hh !== undefined && +hh < DAY_START_HOUR) d.setDate(d.getDate() - 1)
        return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` === today
      }
      footageRows.slice(1).forEach(r => {
        const sub = (r[9] || '').toString().toLowerCase()
        if (!sub.includes('customer request for video')) return
        const raisedBy = (r[7] || '').toString().trim()
        if (!raisedBy || !onOperatingDay(r[4])) return
        const f = footageOf(raisedBy)
        f.raised += 1
        if ((r[17] || '').toString().toLowerCase() === 'yes') f.done += 1
      })

      const t = plan.totals
      workload = {
        byHour: plan.hours.map(h => ({
          hour: h.hour, passed: h.passed,
          clients: h.dueCount, vehicles: h.dueVehicles, done: h.done,
        })),
        soFar: {
          clients: t.dueClientsSoFar, clientsDone: t.doneClientsSoFar,
          vehicles: t.dueVehiclesSoFar, vehiclesChecked: t.doneVehicles,
          alerts: t.doneAlerts, fatigue: t.doneFatigue, alertsTotal: t.doneAlerts + t.doneFatigue,
        },
        // 7am to 7am — the whole operating day, filling in as it is worked.
        fullDay: {
          clients: t.dueClients, clientsDone: t.doneClients,
          vehicles: t.dueVehicles, vehiclesChecked: t.doneVehicles,
          alerts: t.doneAlerts, fatigue: t.doneFatigue, alertsTotal: t.doneAlerts + t.doneFatigue,
        },
        // Straight off the shared plan, so this table and Hour by hour cannot
        // print two different numbers for the same person.
        perEmployee: employees().map(e => {
          const p = plan.byEmployee[e.name]
          const f = perEmpFootage[e.name] || { raised: 0, done: 0 }
          return {
            name: e.name,
            isWeekOff:        weekOffEmps.has(e.name),
            expectedClients:  p?.clients  || 0,
            expectedVehicles: p?.vehicles || 0,
            expectedHours:    p?.hoursWithClients || 0,
            clientsDone:      p?.clientsDone     || 0,
            vehiclesChecked:  p?.vehiclesChecked || 0,
            alerts:           p?.alerts          || 0,
            fatigue:          p?.fatigue         || 0,
            alertsTotal:     (p?.alerts || 0) + (p?.fatigue || 0),
            footageRaised:    f.raised,
            footageDone:      f.done,
          }
        }),
      }
    } catch (e) {
      console.error('overview: workload failed', e.message)
    }

    return res.status(200).json({
      employees:      empStatus,
      workload,
      rosterIssues,
      clientIssues,
      // ── Pins Client_Timings refuses ──────────────────────────────────
      //
      // Employee_Hours used to deliver a named client whether or not the
      // timings sheet scheduled it. It no longer does — which is correct, and
      // silent: on the live book fourteen pins stopped working the day that
      // landed, and the person who typed them had no way to find out. A row
      // somebody wrote that quietly does nothing is its own kind of invisible.
      pinIssues: [
        ...orphanedPins(),
        // One person under two spellings, and roster names that collide.
        // Both are only answerable by editing the sheet.
        ...nameClashes().map(c => ({ name: c.name, hour: c.hour, client: '—', reason: c.reason })),
        // Rows the parser cannot use at all — a blank hour, a missing name.
        // These never reach orphanedPins because they are dropped before the
        // schedule ever sees them, so they would be the one kind of dead row
        // nothing reported.
        ...unusableHourRows(hourRows || []).map(u => ({
          name: u.name || '(no name)', hour: null, client: `row ${u.row}`, reason: u.reason,
        })),
      ],
      coverageGaps,
      // Clients with not one update against them since seven this morning.
      staleClients: staleOut,
      // The operating day these figures belong to — 07:00 to 07:00, which is
      // why they start again at seven without anything resetting them.
      operatingDate: today,
      scores,
      integrityFlags,
      watchlist,
      redistribution: todayRedistrib,
      history,
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
