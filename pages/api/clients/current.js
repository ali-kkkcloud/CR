import { getUserFromReq } from '../../../lib/auth'
import {
  readSheetCached, appendRows, CRM_SHEET_ID, TABS, todayStr, yesterdayStr, nowStr, nowIST,
  fetchClientVehicleCounts, getLeaveMapForDate, getShiftOverridesForDate,
  getOnShiftNamesFromLog, TTL, warmSheetCache, SHIFT_SCREEN_TABS,
} from '../../../lib/sheets'
import { getScheduledEmployeesAtHour, employees, isScheduledAtHour, customTextFor } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { computeDayPlan } from '../../../lib/dayplan'
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
    // Every tab this screen needs, asked for in one go before anything else
    // runs — so they cost one request between them instead of one per stage.
    // See warmSheetCache in lib/sheets.
    await warmSheetCache(CRM_SHEET_ID, SHIFT_SCREEN_TABS)

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
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:L`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, TTL.LIVE),
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

    const myShiftRows = shiftLogRows.slice(1).filter(r =>
      (r[0] || '').toString().trim() === user.empId.toString().trim() &&
      (r[2] === today || r[2] === yesterday)
    )
    const iHaveClockedOut = myShiftRows.length > 0 && !myShiftRows.some(r => r[6] === 'Active')

    // ── What this hour holds for me ────────────────────────────────────
    //
    // Read from computeDayPlan — the same computation the employee's own day,
    // the admin's Dashboard and the admin's Hour by hour all read.
    //
    // This screen used to work its own split out, and it was the ONE screen
    // that did. The pool it built was "who has clocked in"; the plan's pool is
    // "who the roster puts on this hour, minus anyone demonstrably not here".
    // Those two differ for exactly as long as somebody rostered on an hour has
    // not arrived yet — which is every shift change, every single morning.
    //
    // The result was not a cosmetic disagreement between panels. This is the
    // screen people RECORD WORK ON. It handed out clients the plan had given
    // to somebody else, so two people could each be shown the same client in
    // the same hour and both work it, while the count on the board did not
    // match the count on the strip directly above it — 13 against 12, for the
    // same hour of the same day.
    //
    // One computation, one answer. The screen the work is done on does not get
    // to be the exception to it.
    const vehicleMap = await fetchClientVehicleCounts()
    const plan = computeDayPlan({
      date: myShiftDate, today, nowHour: hour, yesterday,
      shiftRows: shiftLogRows, updateRows, breakRows,
      leaveMap, overridesMap, vehicleMap,
      weekOffNames: new Set(employees().filter(e => e.isWeekOff).map(e => e.name)),
    })

    // A custom duty replaces the client list outright — it is what this person
    // is doing this hour instead of watching clients.
    const customText = customTextFor(user.name, hour)
    const clients = customText
      ? [{ client: customText, isCustom: true }]
      : (plan.byEmployee[user.name]?.hours?.[hour] || [])

    const poolNames = plan.hours.find(h => h.hour === hour)?.pool || []
    const scheduledNames = getScheduledEmployeesAtHour(hour, leaveMap, overridesMap).map(e => e.name)

    // ── No placeholder rows ────────────────────────────────────────────
    //
    // Loading a board used to append one blank row per client, so opening the
    // screen at the top of an hour wrote a hundred and nineteen rows before
    // anybody had done a thing. One day of that came to 1,274 rows of which
    // exactly ONE carried real work — and CRM_Updates is the tab every screen
    // re-reads on every request, so the whole platform paid for them forever.
    //
    // They were never load-bearing. Nothing locks on a blank row (see
    // buildLockedAssignments), the idle sweep skips them by name, and every
    // screen reads its clients from computeDayPlan and only decorates them
    // with a row if one exists — a client with no row simply reads as not yet
    // done, which is exactly what a blank row said.
    //
    // A row is written now when, and only when, somebody records something.
    const allMyRows = updateRows.slice(1)
      .filter(r => r[0] === myShiftDate && r[2] === user.name && parseInt(r[4]) === hour)
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
