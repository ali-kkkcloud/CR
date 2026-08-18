import { getUserFromReq } from '../../../lib/auth'
import {
  readSheetCached, appendRows, CRM_SHEET_ID, TABS, todayStr, yesterdayStr, nowStr, nowIST,
  fetchClientVehicleCounts, getLeaveMapForDate, getShiftOverridesForDate,
  getOnShiftNamesFromLog, getClockedOutNamesFromLog, getAwayOnBreakNames,
} from '../../../lib/sheets'
import { getClientsForEmployeeAtHour, getScheduledEmployeesAtHour, employees, isScheduledAtHour } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { buildHourPool, buildLockedAssignments } from '../../../lib/distribution'
import { sweepShiftAutoClose } from '../../../lib/attendance'

function ddmmyyyyFromDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// Whether an EFFECTIVE (possibly override-adjusted) start/end window wraps
// past midnight — derived from the actual hours, NOT the employee's static
// isNight flag. A day-shift employee whose Early/Late Start or OT pushes
// their window across midnight (e.g. 17:00-02:00) still needs wraparound
// handling even though their default schedule never crosses midnight.
function wrapsPastMidnight(start, end) { return end <= start }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    // ── Close shifts that ran past their window and were never ended ──
    // Half an hour's grace, then the row is closed at the time the shift was
    // due to finish. It runs from here because this is the request that fires
    // every thirty seconds for anybody still working, so a colleague who has
    // gone home is tidied up by the people still on the floor. Before the
    // reads below, so this response already reflects it.
    try { await sweepShiftAutoClose(employees()) }
    catch (e) { console.error('shift auto-close sweep failed:', e.message) }

    const hour  = nowIST().getHours()
    const today = todayStr()
    const now   = nowStr()
    const yesterday = yesterdayStr()

    // ── Leave map + Early Start/OT overrides — fetched for TODAY and
    // YESTERDAY and merged (today wins). This is what makes a night shift
    // that started yesterday evening still resolve correctly after
    // midnight, when the calendar date has already rolled over. ──
    const [leaveMapToday, leaveMapYesterday, overridesToday, overridesYesterday, updateRows, shiftLogRows, breakRows] = await Promise.all([
      getLeaveMapForDate(today),
      getLeaveMapForDate(yesterday),
      getShiftOverridesForDate(today),
      getShiftOverridesForDate(yesterday),
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:L`, 8000),
      readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000),
      readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, 15000),
    ])

    // ── Resolve MY operating "shift date" — the date my shift actually
    // started, which stays constant even after midnight rolls the
    // calendar date over. Falls back to today if I haven't started, or
    // started fresh today. ──
    let myShiftDate = today
    const myShiftRowsToday = shiftLogRows.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===today)
    const myShiftRowsYesterday = shiftLogRows.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===yesterday)
    if (myShiftRowsToday.length === 0 && myShiftRowsYesterday.some(r => r[6] === 'Active')) {
      myShiftDate = yesterday
    }
    const myLeaveMap = myShiftDate === yesterday ? leaveMapYesterday : leaveMapToday
    const myOverridesMap = myShiftDate === yesterday ? overridesYesterday : overridesToday

    // Merge everyone's leave/override maps (today takes priority, filled
    // in by yesterday for anyone not present today) — used for the sweep
    // and for scheduling, since OTHER employees may also be mid-night-shift.
    // Scheduling for the CURRENT calendar day must use today's leave and
    // override data only. Merging yesterday's in wholesale meant anyone
    // marked Week Off yesterday stayed excluded today, and their client
    // list came back empty. Yesterday's maps are consulted solely for the
    // caller when their own shift began yesterday and is still running.
    const leaveMap = { ...leaveMapToday }
    const overridesMap = { ...overridesToday }
    if (myShiftDate === yesterday) {
      if (myLeaveMap[user.name]) leaveMap[user.name] = myLeaveMap[user.name]
      else delete leaveMap[user.name]
      if (myOverridesMap[user.name]) overridesMap[user.name] = myOverridesMap[user.name]
      else delete overridesMap[user.name]
    }

    // ── No-show sweep: anyone who has missed their grace hour entirely
    // (no Shift_Log row at all today) gets auto-marked "Week Off" from the
    // hour after their scheduled start onward. Idempotent. ──
    const onShiftNames = getOnShiftNamesFromLog(shiftLogRows, [today, yesterday])
    const startedToday = new Set(shiftLogRows.slice(1).filter(r => r[2] === today).map(r => r[1]))
    const newLeaveRows = []
    employees().forEach(emp => {
      if (startedToday.has(emp.name)) return
      // A night shift that began yesterday evening has no row dated today,
      // so "no row today" alone would brand someone absent in the middle of
      // the shift they are currently working. Anyone clocked in is present
      // by definition, whichever day their shift started on.
      if (onShiftNames.has(emp.name)) return
      // Prefix match, so an already-shortened "Week Off (returned)" row
      // still counts as "this employee has been swept today". Comparing
      // the exact string meant a returning employee could be marked absent
      // all over again on the next poll.
      const already = (leaveMap[emp.name] || []).some(l => (l.reason || '').startsWith('Week Off'))
      if (already) return
      const override = overridesMap[emp.name]
      const effStart = override ? override.start : emp.start
      const effEnd   = override ? override.end   : emp.end
      const effective = { ...emp, start: effStart, end: effEnd }

      // Only mark a no-show while the shift is ACTUALLY running. Without
      // this guard a night-shift employee (e.g. 22:00–07:00) gets marked
      // Week Off at 10:00 the previous morning, because the wraparound
      // maths reports them as "12 hours late" when their shift hasn't
      // even started yet.
      if (!isScheduledAtHour(effective, hour)) return

      const isWrap = wrapsPastMidnight(effStart, effEnd)
      const hoursSinceStart = isWrap ? (hour - effStart + 24) % 24 : hour - effStart
      if (hoursSinceStart >= 1) {
        const fromHour = (effStart + 1) % 24
        newLeaveRows.push([emp.empId || emp.name, emp.name, today, fromHour, effEnd, 'Week Off', 'System', now])
        if (!leaveMap[emp.name]) leaveMap[emp.name] = []
        // markedBy mirrors what was just written to the sheet, so the
        // pool's "ignore System absences for anyone clocked in" rule sees
        // this entry the same way it will on the next request.
        leaveMap[emp.name].push({ fromHour, toHour: effEnd, reason: 'Week Off', markedBy: 'System' })
      }
    })
    if (newLeaveRows.length) await appendRows(CRM_SHEET_ID, TABS.LEAVES, newLeaveRows)

    // ── Who this hour's clients get shared between ─────────────────────
    // The roster says who COULD be on this hour; Shift_Log says who
    // actually is. Distribution follows the second one. Splitting by
    // roster meant an hour rostered to six people was still carved six
    // ways when only one had clocked in, so that one employee saw (and
    // could update) barely a sixth of the clients due that hour, and
    // anyone who had already gone home kept being handed new work.
    //
    // Deriving the pool from who is clocked in makes the split
    // self-correcting: a lone employee covers the whole hour, and every
    // start or end reshuffles the remainder on the next refresh.
    //
    // The pool is built by lib/distribution, shared with the Command Center,
    // so the split an employee is shown and the split an admin is shown can
    // never be worked out two different ways.
    //
    // Somebody who has clocked out is done for the day and must not be given
    // work again. They were still being handed a full client list they could
    // go on updating, which pinned those clients to a name that had gone home
    // and took them off the board of whoever was still working.
    const myShiftRows = shiftLogRows.slice(1).filter(r =>
      (r[0] || '').toString().trim() === user.empId.toString().trim() &&
      (r[2] === today || r[2] === yesterday)
    )
    const iHaveClockedOut = myShiftRows.length > 0 && !myShiftRows.some(r => r[6] === 'Active')
    // Am I actually clocked in? Not "am I not clocked out" — those differ for
    // the person who never started at all, and the difference mattered: with no
    // Shift_Log row whatsoever they were force-added to the pool and handed the
    // entire hour, seventy-seven clients, without ever pressing Start Shift.
    // Their own day and the admin both showed zero for the same hour, because
    // only this screen was bending the rule. Start Shift clears the cached
    // attendance read, so a genuine arrival is in the pool on the next poll
    // rather than waiting out a stale cache — which is all the exception was
    // ever for.
    const iAmOnShift = myShiftRows.some(r => r[6] === 'Active')

    // Anyone away on a long break is left out of the split. Their clients had
    // been sitting on a board nobody was looking at — invisible to every
    // colleague, and only discovered as a missed hour after the fact.
    const awayNames = getAwayOnBreakNames(breakRows, [today, yesterday])

    const { poolNames, scheduledNames } = buildHourPool({
      hour, leaveMap, overridesMap, onShiftNames,
      clockedOutNames: getClockedOutNamesFromLog(shiftLogRows, [today, yesterday]),
      awayNames,
      alwaysInclude: iAmOnShift ? user.name : null,
    })

    const vehicleMap = await fetchClientVehicleCounts()
    const lockedAssignments = buildLockedAssignments(updateRows, myShiftDate, hour)

    // reserveOffShiftLocks=true: every lock here is finished work, so a
    // client someone completed before going home stays done instead of
    // bouncing back onto a colleague's board.
    const clients = getClientsForEmployeeAtHour(user.name, hour, poolNames, vehicleMap, lockedAssignments, true)

    // ── Write placeholder rows — always dated with MY shift date, so a
    // night shift's post-midnight hours stay attached to the day it
    // started, not the calendar day they literally occurred on. ──
    const existingForMeSet = new Set(
      updateRows.slice(1)
        .filter(r => r[0] === myShiftDate && r[2] === user.name && parseInt(r[4]) === hour)
        .map(r => r[3])
    )
    const newRows = []
    clients.forEach(c => {
      if (c.isCustom) return
      if (!existingForMeSet.has(c.client)) {
        newRows.push([myShiftDate, now, user.name, c.client, String(hour), '', '', '', 'No', '', ''])
      }
    })
    if (newRows.length > 0) await appendRows(CRM_SHEET_ID, TABS.CRM_UPDATES, newRows)

    // ── Build filled map ──
    const allMyRows = [
      ...updateRows.slice(1).filter(r => r[0] === myShiftDate && r[2] === user.name && parseInt(r[4]) === hour),
      ...newRows,
    ]
    const filled = {}
    allMyRows.forEach(r => {
      const hasRealData = !!(r[5] || '').toString().trim()
      // Never let a blank row shadow a saved one. Two polls landing
      // together can each append a placeholder for the same client, and if
      // the blank one sorts last the employee's saved update would read
      // back as unfilled and look lost.
      if (!hasRealData && filled[r[3]] && filled[r[3]].status) return
      filled[r[3]] = {
        status: r[5] || '', misalignVehicles: r[6] || '', alertCount: r[7] || '',
        fatigue: r[8] || '', fatigueCount: r[9] || '', notes: r[10] || '',
        liveVehicles: r[11] || '',
        updatedAt: hasRealData ? (r[1] || '') : '',
      }
    })

    // Why the list might be empty. An employee who clocks in before their
    // shift opens — arriving at 07:42 for an eight o'clock start and choosing
    // to keep their normal time — has no clients until eight, which is
    // correct but looks exactly like a broken page unless the screen says so.
    const myWindow = overridesMap[user.name]
      ? { start: overridesMap[user.name].start, end: overridesMap[user.name].end }
      : (() => { const e = employees().find(x => x.name === user.name); return e ? { start: e.start, end: e.end } : null })()

    return res.status(200).json({
      hour, clients, filled,
      // How many people this hour is actually being shared between, so the
      // UI can explain why a list is long (working solo) or short.
      scheduledCount: poolNames.length,
      rosteredCount:  scheduledNames.length,
      shiftDate: myShiftDate,
      scheduledThisHour: scheduledNames.includes(user.name),
      clockedOut: iHaveClockedOut,
      myWindow,
    })

  } catch (err) {
    console.error('Clients fetch error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
