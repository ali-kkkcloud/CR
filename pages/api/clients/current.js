import { getUserFromReq } from '../../../lib/auth'
import {
  readSheetCached, appendRows, CRM_SHEET_ID, TABS, todayStr, nowStr, nowIST,
  fetchClientVehicleCounts, getLeaveMapForDate, getShiftOverridesForDate, getOnShiftNamesFromLog,
} from '../../../lib/sheets'
import { getClientsForEmployeeAtHour, getScheduledEmployeesAtHour, ALL_EMPLOYEES, isScheduledAtHour } from '../../../lib/schedule'

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
    const hour  = nowIST().getHours()
    const today = todayStr()
    const now   = nowStr()
    const yesterday = ddmmyyyyFromDate(new Date(nowIST().getTime() - 24*3600000))

    // ── Leave map + Early Start/OT overrides — fetched for TODAY and
    // YESTERDAY and merged (today wins). This is what makes a night shift
    // that started yesterday evening still resolve correctly after
    // midnight, when the calendar date has already rolled over. ──
    const [leaveMapToday, leaveMapYesterday, overridesToday, overridesYesterday, updateRows, shiftLogRows] = await Promise.all([
      getLeaveMapForDate(today),
      getLeaveMapForDate(yesterday),
      getShiftOverridesForDate(today),
      getShiftOverridesForDate(yesterday),
      readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`, 8000),
      readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000),
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
    ALL_EMPLOYEES.forEach(emp => {
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
    // Somebody who is clocked in is, by definition, not absent. The
    // no-show sweep writes "Week Off" rows automatically, and a stale one
    // left over from before an employee arrived would otherwise keep them
    // out of the split for the rest of their shift — clocked in, sitting
    // on the dashboard, and handed no clients at all. Auto rows are
    // ignored for anyone on shift; leave an admin marked by hand always
    // stands.
    const leaveMapForPool = {}
    Object.entries(leaveMap).forEach(([name, entries]) => {
      leaveMapForPool[name] = onShiftNames.has(name)
        ? entries.filter(l => (l.markedBy || '') !== 'System')
        : entries
    })

    const scheduledEmps  = getScheduledEmployeesAtHour(hour, leaveMapForPool, overridesMap)
    const scheduledNames = scheduledEmps.map(e => e.name)

    let poolNames = scheduledNames.filter(n => onShiftNames.has(n))
    // Nobody clocked in yet (start of day, or everyone still to arrive):
    // fall back to the roster so the hour still has owners and no client
    // silently drops off the board.
    if (poolNames.length === 0) poolNames = scheduledNames
    // The caller is looking at this screen because they're working, so
    // keep them in the pool even if their own Shift_Log row is a beat
    // behind the read cache.
    if (!poolNames.includes(user.name) && scheduledNames.includes(user.name)) {
      poolNames = [...poolNames, user.name]
    }

    const vehicleMap = await fetchClientVehicleCounts()

    // ── Locked assignments ─────────────────────────────────────────────
    // ONLY slots that already carry a real update stay pinned to whoever
    // did that work — nobody's finished update should ever jump to
    // another name. Empty placeholder rows are deliberately NOT locked:
    // pinning those froze the hour's split to whoever happened to open
    // the page first, which is what stopped the workload rebalancing
    // when somebody else started or ended their shift.
    const lockedAssignments = {}
    updateRows.slice(1)
      .filter(r => r[0] === myShiftDate && parseInt(r[4]) === hour && (r[5] || '').toString().trim())
      .forEach(r => { lockedAssignments[r[3]] = r[2] })

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
        updatedAt: hasRealData ? (r[1] || '') : '',
      }
    })

    return res.status(200).json({
      hour, clients, filled,
      // How many people this hour is actually being shared between, so the
      // UI can explain why a list is long (working solo) or short.
      scheduledCount: poolNames.length,
      rosteredCount:  scheduledNames.length,
      shiftDate: myShiftDate,
    })

  } catch (err) {
    console.error('Clients fetch error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
