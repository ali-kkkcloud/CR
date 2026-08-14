import {
  readSheetCached, appendRows, CRM_SHEET_ID, TABS,
  todayStr, nowIST, parseISTDateTime, findOpenShiftRow,
} from './sheets'

// Go idle for this long with nothing recorded and the platform puts you on a
// break by itself, backdated to the moment the idle stretch began.
export const AUTO_BREAK_IDLE_MINUTES = 10

function ddmmyyyy(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
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
// Three things count, and the most recent wins:
//   - starting the shift          (you've just arrived)
//   - saving a client update      (the work itself)
//   - resuming from a break       (you're back at the desk)
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
  if (open) consider(resolveMoment(open.row[3], dates, nowMs))

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
export async function sweepAutoBreaks(employees) {
  const now   = nowIST()
  const nowMs = now.getTime()
  const today = todayStr()
  const dates = [today, ddmmyyyy(new Date(nowMs - 24 * 3600000))]

  // Cached reads on purpose. Every employee's dashboard polls break status on
  // a 30s loop, and three uncached reads per poll per person would push the
  // whole app past Google's Sheets quota — which is what the read cache exists
  // to prevent. Saving an update invalidates the cache for that tab, so a
  // fresh save is always visible here and can never trigger a false break.
  const [shiftRows, updateRows, breakRows] = await Promise.all([
    readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 15000),
    readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`, 8000),
    readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, 8000),
  ])
  const ctx = { shiftRows, updateRows, breakRows, dates, nowMs }

  const created = employees
    .map(emp => evaluateAutoBreak(emp, ctx, today))
    .filter(Boolean)

  if (created.length) await appendRows(CRM_SHEET_ID, TABS.BREAKS, created)
  return created
}

// The decision on its own, with no reads or writes, so it can be exercised
// directly. Returns the Breaks row to append, or null to leave them alone.
export function evaluateAutoBreak(emp, ctx, today) {
  const { shiftRows, breakRows, dates, nowMs } = ctx
  const empId = (emp.empId || '').toString().trim()
  if (!empId || !emp.name) return null

  // Only somebody mid-shift can be idle. Not started, or already gone home,
  // and there is nothing to record.
  if (!findOpenShiftRow(shiftRows, empId, dates)) return null

  // Already on a break — manual or automatic. Nothing to do until they resume.
  const alreadyOnBreak = breakRows.slice(1).some(r =>
    (r[0] || '').toString().trim() === empId && dates.includes(r[2]) && r[6] === 'Active'
  )
  if (alreadyOnBreak) return null

  const last = lastActivityAt(emp, ctx)
  if (last == null) return null

  const idleMinutes = (nowMs - last) / 60000
  if (idleMinutes <= AUTO_BREAK_IDLE_MINUTES) return null

  const startMs = last + AUTO_BREAK_IDLE_MINUTES * 60000
  // Cols: EmpId | Name | Date | Start | End | Minutes | Status | Type
  return [empId, emp.name, today, fmtClock(startMs), '', '', 'Active', 'Auto']
}
