import {
  readSheetCached, appendRows, updateRowCells, CRM_SHEET_ID, TABS,
  todayStr, nowIST, parseISTDateTime, findOpenShiftRow, getShiftOverridesForDate,
} from './sheets'
import { getEmployeeShift } from './schedule'

// Go idle for this long with nothing recorded and the platform puts you on a
// break by itself, backdated to the moment the idle stretch began.
export const AUTO_BREAK_IDLE_MINUTES = 10

// Shift_Log column H, otherwise unused, holds the last moment the employee
// was seen touching the screen. Keeping it on the open shift row means no new
// tab and no new sheet to maintain.
const HEARTBEAT_COL = 8

// Don't rewrite the heartbeat on every poll — only once it has meaningfully
// moved on. Each write costs Sheets quota that the whole app shares, and with
// a dozen dashboards polling every 30s that adds up fast. Lagging by a couple
// of minutes costs nothing, because the employee's OWN request passes its
// fresh reading straight into the decision (see heartbeatOverride); the
// stored value only has to serve the laptop-shut case, where the person has
// been gone far longer than the lag.
const HEARTBEAT_WRITE_GAP_MS = 120000

function ddmmyyyy(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// The dates a running shift can span. A night shift that began yesterday
// evening is still the current shift after midnight, and so is any break
// opened during it — every lookup has to cover both days or a break started
// at 23:52 becomes invisible at 00:05 and can never be closed.
export function recentDates() {
  const nowMs = nowIST().getTime()
  return [todayStr(), ddmmyyyy(new Date(nowMs - 24 * 3600000))]
}

// Every open break for this employee, newest first.
//
// One definition, shared by the status endpoint, the resume endpoint and the
// idle sweep. They previously each had their own copy of this filter and the
// copies disagreed about which dates to search, which is exactly how a break
// opened before midnight became invisible — and, because the sweep could
// still see it, silently switched the whole feature off for that employee.
export function findOpenBreaks(breakRows, empId, dates) {
  const wanted = (empId || '').toString().trim()
  const out = []
  for (let i = breakRows.length - 1; i >= 1; i--) {
    const r = breakRows[i]
    if ((r[0] || '').toString().trim() !== wanted) continue
    if (!dates.includes(r[2])) continue
    if ((r[6] || '').toString().trim() !== 'Active') continue
    out.push({ rowIndex: i + 1, startTime: r[3], startDate: r[2], isAuto: (r[7] || '') === 'Auto', row: r })
  }
  return out
}

// "hh:mm:ss am/pm", matching nowStr() so every time in the Breaks tab reads
// and parses the same way.
function fmtClock(ms) {
  const d = new Date(ms)
  let h = d.getHours()
  const mi = String(d.getMinutes()).padStart(2, '0')
  const se = String(d.getSeconds()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12; if (h === 0) h = 12
  return `${String(h).padStart(2, '0')}:${mi}:${se} ${ampm}`
}

// A time-of-day string in these sheets carries no date of its own — the row's
// date column is the SHIFT date, which for a night shift is the day the shift
// began rather than the day the entry actually happened. Resolve the string
// against every candidate date and keep the most recent moment that isn't in
// the future, so 02:00 on a shift that started yesterday reads as this
// morning and not as yesterday morning.
export function resolveMoment(timeStr, dates, nowMs) {
  if (!timeStr) return null
  let best = null
  for (const d of dates) {
    const parsed = parseISTDateTime(d, timeStr)
    if (!parsed) continue
    const t = parsed.getTime()
    if (t > nowMs + 120000) continue          // tolerate a little clock skew
    if (best === null || t > best) best = t
  }
  return best
}

// The last moment this employee actually did something.
//
// Four things count, and the most recent wins:
//   - being at the screen         (mouse, keys, scroll — reported by the browser)
//   - starting the shift          (you've just arrived)
//   - saving a client update      (the work itself)
//   - resuming from a break       (you're back at the desk)
//
// Being at the screen is what stops a quiet hour from reading as absence: an
// employee who has finished every client and is waiting for the next hour is
// still present, and their mouse says so. When the browser stops reporting —
// laptop shut, tab closed — that source simply goes stale and the other three
// carry the decision, which is what catches somebody who walked away.
//
// Placeholder rows deliberately do NOT count. They are written whenever the
// dashboard loads an hour's clients, so counting them would hand every idle
// employee a free reset at the top of each hour.
export function lastActivityAt(emp, ctx) {
  const { shiftRows, updateRows, breakRows, dates, nowMs } = ctx
  const empId = (emp.empId || '').toString().trim()
  let best = null
  const consider = (t) => { if (t != null && (best === null || t > best)) best = t }

  const open = findOpenShiftRow(shiftRows, empId, dates)
  if (open) {
    consider(resolveMoment(open.row[3], dates, nowMs))                    // shift start
    consider(resolveMoment(open.row[HEARTBEAT_COL - 1], dates, nowMs))    // last seen, as stored
  }
  // The employee's own request carries a reading taken a moment ago, which is
  // newer than anything on the sheet. Using it keeps the threshold exact for
  // whoever is actually at the screen, so the stored copy can lag to save
  // writes without making breaks fire early.
  if (ctx.heartbeatOverride && ctx.heartbeatOverride[empId] != null) {
    consider(ctx.heartbeatOverride[empId])
  }

  updateRows.slice(1).forEach(r => {
    if (r[2] !== emp.name) return
    if (!dates.includes(r[0])) return
    if (!(r[5] || '').toString().trim()) return   // placeholder, not real work
    consider(resolveMoment(r[1], dates, nowMs))
  })

  breakRows.slice(1).forEach(r => {
    if ((r[0] || '').toString().trim() !== empId) return
    if (!dates.includes(r[2])) return
    if (r[4]) consider(resolveMoment(r[4], dates, nowMs))   // a resume
  })

  return best
}

// Two requests can decide to open the same break at the same moment — the
// employee's own dashboard poll and an admin opening the Command Center both
// run the sweep, and each reads the sheet before the other has written to it.
// Remembering who was just opened stops the pair of them appending two rows
// for one break. Resuming closes every open row regardless, so a duplicate
// that slips through a cold start is tidied up rather than left running.
const RECENT_OPENINGS = new Map()
const REOPEN_GUARD_MS = 60000
function claimOpening(empId) {
  const now = Date.now()
  const last = RECENT_OPENINGS.get(empId)
  if (last != null && now - last < REOPEN_GUARD_MS) return false
  RECENT_OPENINGS.set(empId, now)
  // The map only ever holds one entry per employee, but prune anything long
  // finished so a long-lived instance doesn't hold names it no longer needs.
  for (const [k, t] of RECENT_OPENINGS) if (now - t > REOPEN_GUARD_MS * 10) RECENT_OPENINGS.delete(k)
  return true
}

// When this shift opens and when it is due to finish.
//
// Both ends matter to the idle check. A break must not outlive the shift it
// belongs to — somebody who goes quiet at ten to six and never comes back
// should read as "on break until six", not as still sitting on a break the
// next morning, so the sweep needs the end even when nobody clicked End
// Shift. And nothing before the shift opens counts as idling: an employee
// who arrives at 07:42 for an eight o'clock start has no clients yet.
//
// The adjusted window wins where there is one: arriving after the half hour
// adds an hour to the end, taking OT pushes it further, and confirming an
// early start pulls the opening forward — all three are recorded in
// Shift_Overrides. Otherwise the roster's own hours apply.
export function shiftWindow(empName, shiftDate, startTimeStr, overridesMap) {
  const ov  = overridesMap ? overridesMap[empName] : null
  const emp = getEmployeeShift(empName)
  const startHour = ov && Number.isFinite(ov.start) ? ov.start : (emp ? emp.start : null)
  const endHour   = ov && Number.isFinite(ov.end)   ? ov.end   : (emp ? emp.end   : null)

  const clockIn = parseISTDateTime(shiftDate, startTimeStr)
  if (!clockIn || endHour == null) return { startMs: null, endMs: null }

  const end = new Date(clockIn)
  end.setHours(endHour, 0, 0, 0)
  // A night shift finishes on the far side of midnight, so an end hour that
  // lands at or before the clock-in belongs to the next day.
  if (end <= clockIn) end.setDate(end.getDate() + 1)

  let startMs = null
  if (startHour != null) {
    const begin = new Date(clockIn)
    begin.setHours(startHour, 0, 0, 0)
    // Arriving before the hour the shift begins is the only way clock-in can
    // precede the window; anything else means the window opened earlier.
    startMs = begin.getTime()
  }
  return { startMs, endMs: end.getTime() }
}

export function shiftEndMoment(empName, shiftDate, startTimeStr, overridesMap) {
  return shiftWindow(empName, shiftDate, startTimeStr, overridesMap).endMs
}

// The employee's most recent shift row across these dates, in any state.
function latestShiftRow(shiftLogRows, empId, dates) {
  const wanted = (empId || '').toString().trim()
  for (let i = shiftLogRows.length - 1; i >= 1; i--) {
    const r = shiftLogRows[i]
    if ((r[0] || '').toString().trim() !== wanted) continue
    if (!dates.includes(r[2])) continue
    return { row: r, date: r[2] }
  }
  return null
}

// When a hand-ended shift actually finished. The row stores a time of day
// against the shift's date, so a night shift's 06:00 finish belongs to the
// following morning rather than nine hours before it started.
function shiftEndFromRow(shift) {
  const startAt = parseISTDateTime(shift.date, shift.row[3])
  const endAt   = parseISTDateTime(shift.date, shift.row[4])
  if (!endAt) return null
  if (startAt && endAt <= startAt) return endAt.getTime() + 24 * 3600000
  return endAt.getTime()
}

// Breaks that should no longer be running, with the moment each one ends.
//
// Two ways a break outstays its welcome:
//   - the shift finished and nobody clicked End Shift, so the break was never
//     closed — it ends when the shift was due to end;
//   - the shift row is gone or forgotten entirely, leaving no end to measure
//     to — the break is closed at zero rather than credited.
//
// Without this an auto-break opened near the end of a shift would still read
// as running the next morning, and the admin's break totals would grow all
// night for somebody who simply went home.
export function evaluateBreakClosures(emp, ctx, overridesMap) {
  const { shiftRows, breakRows, dates, nowMs } = ctx
  const empId = (emp.empId || '').toString().trim()
  if (!empId || !emp.name) return []

  const open = findOpenBreaks(breakRows, empId, dates)
  if (open.length === 0) return []

  // The employee's own shift row, whatever state it is in — deliberately not
  // findOpenShiftRow, which discards a row left Active for longer than any
  // real shift. That row is exactly the one needed here: it carries the start
  // time the shift's end is measured from, and the whole point is to settle a
  // break belonging to a shift nobody ever closed.
  const shift = latestShiftRow(shiftRows, empId, dates)
  let endMs = null
  if (shift) {
    // Ended by hand: the recorded end time is the truth. Otherwise fall back
    // to when the shift was due to finish.
    const endedAt = shift.row[6] === 'Ended' ? shiftEndFromRow(shift) : null
    endMs = endedAt != null ? endedAt : shiftEndMoment(emp.name, shift.date, shift.row[3], overridesMap)
    // Still mid-shift — the break is genuinely running, leave it alone.
    if (endMs == null || nowMs < endMs) return []
  }

  return open.map(b => {
    const startAt = parseISTDateTime(b.startDate, b.startTime)
    const startMs = startAt ? startAt.getTime() : null
    // No shift end to measure to, or a break that somehow began after it:
    // close the row without crediting time that can't be accounted for.
    const usable = endMs != null && startMs != null && endMs > startMs
    return {
      rowIndex: b.rowIndex,
      endTime:  usable ? fmtClock(endMs) : b.startTime,
      minutes:  usable ? Math.round((endMs - startMs) / 60000) : 0,
    }
  })
}

// Put anyone who has gone quiet onto a break, and report who is on one.
//
// This is deliberately evaluated from the sheets rather than from a heartbeat
// the browser sends, so it still fires when somebody simply closes the laptop:
// the idle stretch is measured from their last recorded activity, and the
// break is backdated to where that stretch crossed the threshold. Whoever
// looks next — the employee coming back, or an admin opening the Command
// Center — is what triggers the write, so the away time is captured either way.
//
// `employees` is [{ empId, name }]. Returns the rows it created.
export async function sweepAutoBreaks(employees, heartbeatOverride = null) {
  const now   = nowIST()
  const nowMs = now.getTime()
  const today = todayStr()
  const dates = [today, ddmmyyyy(new Date(nowMs - 24 * 3600000))]

  // Cached reads on purpose. Every employee's dashboard polls break status on
  // a 30s loop, and three uncached reads per poll per person would push the
  // whole app past Google's Sheets quota — which is what the read cache exists
  // to prevent. Saving an update invalidates the cache for that tab, so a
  // fresh save is always visible here and can never trigger a false break.
  const [shiftRows, updateRows, breakRows, overridesToday, overridesYesterday] = await Promise.all([
    readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000),
    readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`, 8000),
    readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, 8000),
    getShiftOverridesForDate(dates[0]),
    getShiftOverridesForDate(dates[1]),
  ])
  // A night shift's adjusted window is filed under the day it began, so both
  // days are needed; today wins where an employee appears on both.
  const overridesMap = { ...overridesYesterday, ...overridesToday }
  const ctx = { shiftRows, updateRows, breakRows, dates, nowMs, heartbeatOverride, overridesMap }

  // Close first, open second. A break that has outlived its shift is settled
  // before anyone is considered for a new one, and because a finished shift
  // can't earn a new break either, the two can't chase each other.
  const closures = employees.flatMap(emp => evaluateBreakClosures(emp, ctx, overridesMap))
  for (const c of closures) {
    // Cols E=EndTime F=DurationMinutes G=Status
    await updateRowCells(CRM_SHEET_ID, TABS.BREAKS, c.rowIndex, 5, [c.endTime, c.minutes, 'Completed'])
  }

  const created = employees
    .map(emp => evaluateAutoBreak(emp, ctx, today))
    .filter(Boolean)
    .filter(row => claimOpening(row[0]))

  if (created.length) await appendRows(CRM_SHEET_ID, TABS.BREAKS, created)
  return created
}

// Record that the employee was at their screen just now.
//
// The browser reports how long ago it last saw real input — a mouse move, a
// key, a scroll — rather than a timestamp, so a wrong clock on the employee's
// machine can't move the mark. Anything implausible is ignored.
//
// Returns the moment stored (or already on file), or null if there was
// nothing to record.
export async function recordHeartbeat(user, activeAgoMs) {
  const ago = Number(activeAgoMs)
  if (!Number.isFinite(ago) || ago < 0 || ago > 12 * 3600000) return null

  const nowMs = nowIST().getTime()
  const today = todayStr()
  const dates = [today, ddmmyyyy(new Date(nowMs - 24 * 3600000))]
  const seenAt = nowMs - ago

  const shiftRows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000)
  const open = findOpenShiftRow(shiftRows, user.empId, dates)
  if (!open) return null                       // not on shift — nothing to mark

  // Someone sitting on the break overlay is not working, so their mouse
  // shouldn't keep the shift looking alive. Resuming is what restarts it.
  const breakRows = await readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, 8000)
  if (findOpenBreaks(breakRows, user.empId, dates).length > 0) return null

  const stored = resolveMoment(open.row[HEARTBEAT_COL - 1], dates, nowMs)
  // Never move the mark backwards, and don't spend a write until it has
  // actually moved on. Either way the caller gets the newer of the two, so
  // the decision uses the fresh reading even when nothing was written.
  if (stored != null && seenAt - stored < HEARTBEAT_WRITE_GAP_MS) {
    return Math.max(stored, seenAt)
  }

  await updateRowCells(CRM_SHEET_ID, TABS.SHIFT_LOG, open.rowNumber, HEARTBEAT_COL, [fmtClock(seenAt)])
  return seenAt
}

// The decision on its own, with no reads or writes, so it can be exercised
// directly. Returns the Breaks row to append, or null to leave them alone.
export function evaluateAutoBreak(emp, ctx, today) {
  const { shiftRows, breakRows, dates, nowMs } = ctx
  const empId = (emp.empId || '').toString().trim()
  if (!empId || !emp.name) return null

  // Only somebody mid-shift can be idle. Not started, or already gone home,
  // and there is nothing to record.
  const shift = findOpenShiftRow(shiftRows, empId, dates)
  if (!shift) return null

  // Past the end of the shift, quiet time is just the day being over. Their
  // row may still say Active because End Shift was never clicked, but no new
  // break is owed — and this is what stops a break being opened and closed
  // over and over once the closing rule above has settled the last one.
  const { startMs: windowStart, endMs } = shiftWindow(emp.name, shift.date, shift.row[3], ctx.overridesMap)
  if (endMs != null && nowMs >= endMs) return null

  // Arriving before the shift opens is not idling. Somebody who clocks in at
  // 07:42 for an eight o'clock start has no clients yet — there is nothing
  // for them to be doing, so the quiet stretch before eight cannot count
  // against them, and once the shift does open the ten minutes are measured
  // from the hour it began rather than from the early arrival.
  if (windowStart != null && nowMs < windowStart) return null

  // Already on a break — manual or automatic. Nothing to do until they resume.
  if (findOpenBreaks(breakRows, empId, dates).length > 0) return null

  let last = lastActivityAt(emp, ctx)
  if (last == null) return null
  if (windowStart != null && last < windowStart) last = windowStart

  const idleMinutes = (nowMs - last) / 60000
  if (idleMinutes <= AUTO_BREAK_IDLE_MINUTES) return null

  const breakStartMs = last + AUTO_BREAK_IDLE_MINUTES * 60000
  // Cols: EmpId | Name | Date | Start | End | Minutes | Status | Type
  return [empId, emp.name, today, fmtClock(breakStartMs), '', '', 'Active', 'Auto']
}
