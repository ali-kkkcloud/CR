// ══════════════════════════════════════════════════════════════════════
// The day, closed and put away.
//
// CRM_Updates carries one row per client, per hour, per employee. That is the
// right grain while a day is being worked — it is what the board reads, what
// the hand-over reads, and what proves who did what — and it is the wrong
// grain to keep for a year. A single day of a full floor is around 2,700 rows,
// so a month is 80,000 and the tab every screen reads on every request grows
// without limit until Sheets simply stops.
//
// A finished day does not need that detail to answer the questions anybody
// actually asks of it: how many clients did each person get, how many did they
// finish, how many vehicles were theirs, and how many did they watch. That is
// FOURTEEN NUMBERS PER PERSON PER DAY — eighteen rows instead of two thousand
// seven hundred.
//
// So each finished operating day is summarised once, here, and the summary is
// what the range and month screens read from then on. The detail stays where
// it is until somebody decides to archive it; nothing is deleted by this file.
//
// The same table is the home for the years of work recorded before this
// platform existed. A row imported from the old spreadsheets is the same
// fourteen numbers with Source set to "imported", so the history reads back
// through exactly the same screens as the days the platform recorded itself —
// no second code path, no second format, no gap in the middle of a chart.
// ══════════════════════════════════════════════════════════════════════
import {
  readSheetCached, appendRows, invalidateSheetCache,
  CRM_SHEET_ID, TABS, todayStr,
  getShiftOverridesForDate, getLeaveMapForDate, fetchClientVehicleCounts, TTL,
} from './sheets'
import { employees } from './schedule'
import { computeDayPlan } from './dayplan'

// Date | EmpID | Employee | Clients_Assigned | Clients_Completed |
// Vehicles_Assigned | Vehicles_Checked | Alerts | Fatigue | Misaligns |
// Shift_Start | Shift_End | Break_Minutes | Source
export const SUMMARY_HEADER = [
  'Date', 'EmpID', 'Employee',
  'Clients_Assigned', 'Clients_Completed',
  'Vehicles_Assigned', 'Vehicles_Checked',
  'Alerts', 'Fatigue', 'Misaligns',
  'Shift_Start', 'Shift_End', 'Break_Minutes',
  'Source',
]

// How a summary row reads back. Everything numeric is a number, so a row the
// platform wrote and a row somebody imported add up together without anyone
// having to know which was which.
export function parseSummaryRow(r) {
  const n = (v) => parseInt(v, 10) || 0
  return {
    date:              (r[0] || '').toString().trim(),
    empId:             (r[1] || '').toString().trim(),
    name:              (r[2] || '').toString().trim(),
    clientsAssigned:   n(r[3]),
    clientsCompleted:  n(r[4]),
    vehiclesAssigned:  n(r[5]),
    vehiclesChecked:   n(r[6]),
    alerts:            n(r[7]),
    fatigue:           n(r[8]),
    misaligns:         n(r[9]),
    shiftStart:        (r[10] || '').toString().trim(),
    shiftEnd:          (r[11] || '').toString().trim(),
    breakMinutes:      n(r[12]),
    source:            (r[13] || 'platform').toString().trim().toLowerCase(),
  }
}

export async function readDailySummary() {
  try {
    return await readSheetCached(CRM_SHEET_ID, `${TABS.DAILY_SUMMARY}!A:N`, TTL.ROSTER)
  } catch (e) {
    // The tab may not exist yet on a sheet that has never been rolled up.
    // That is not an error — it means there is no history to read.
    return []
  }
}

// Which operating days already have a summary.
export function summarisedDates(summaryRows) {
  const s = new Set()
  ;(summaryRows || []).slice(1).forEach(r => {
    const d = (r[0] || '').toString().trim()
    if (d) s.add(d)
  })
  return s
}

// ── Summarise one finished operating day ───────────────────────────────
//
// Read from the same computeDayPlan every screen reads, so the summary can
// never disagree with what Hour by hour showed on the day itself.
export async function summariseDay(date, { shiftRows, updateRows, breakRows, weekOffNames }) {
  const [overridesMap, leaveMap, vehicleMap] = await Promise.all([
    getShiftOverridesForDate(date),
    getLeaveMapForDate(date),
    fetchClientVehicleCounts(),
  ])

  const plan = computeDayPlan({
    date, today: todayStr(), nowHour: 23,
    shiftRows, updateRows, breakRows,
    leaveMap, overridesMap, vehicleMap,
    weekOffNames: weekOffNames || new Set(),
  })

  // Misalignments are the one figure the plan does not carry — it is a list of
  // vehicle numbers in the sheet, not a count — so it is read straight from
  // the day's rows.
  const misalignBy = {}
  updateRows.slice(1).forEach(r => {
    if (r[0] !== date) return
    const flagged = (r[6] || '').toString().trim()
    if (!flagged || flagged === '—') return
    const name = (r[2] || '').toString().trim()
    if (name) misalignBy[name] = (misalignBy[name] || 0) + 1
  })

  // Attendance and time away, from the day's own rows.
  const attendance = {}
  shiftRows.slice(1).filter(r => r[2] === date).forEach(r => {
    const name = (r[1] || '').toString().trim()
    if (!name) return
    const a = (attendance[name] ||= { first: '', last: '' })
    if (!a.first) a.first = r[3] || ''
    if (r[4]) a.last = r[4]
  })
  const breakBy = {}
  ;(breakRows || []).slice(1).forEach(r => {
    if (r[2] !== date) return
    const name = (r[1] || '').toString().trim()
    if (!name) return
    const mins = parseInt(r[5], 10) || 0
    breakBy[name] = (breakBy[name] || 0) + Math.max(0, mins)
  })

  const rows = []
  employees().forEach(emp => {
    const e = plan.byEmployee[emp.name]
    const att = attendance[emp.name]
    const assigned  = e?.clients ?? 0
    const completed = e?.clientsDone ?? 0
    // A person who was given nothing and did nothing on a day they never
    // turned up leaves no row. Fourteen zeroes against a name is not history,
    // it is noise, and it is the difference between eighteen rows a day and
    // eighteen rows a day forever whether anybody worked or not.
    if (assigned === 0 && completed === 0 && !att) return
    rows.push([
      date, emp.empId || '', emp.name,
      String(assigned), String(completed),
      String(e?.vehicles ?? 0), String(e?.vehiclesChecked ?? 0),
      String(e?.alerts ?? 0), String(e?.fatigue ?? 0),
      String(misalignBy[emp.name] || 0),
      att?.first || '', att?.last || '',
      String(breakBy[emp.name] || 0),
      'platform',
    ])
  })
  return rows
}

// Two requests can both notice the same day is unsummarised. Held on
// globalThis because Next compiles every API route into its own bundle, so a
// module-level guard would be one guard per route and guard nothing.
const _G = globalThis.__cautioRollup || (globalThis.__cautioRollup = { inFlight: new Set() })

// ── Close out any finished day that has not been summarised ────────────
//
// Runs from the Command Center. Only days that are OVER are touched — the day
// in progress is read live and must not be frozen half-written — and only
// those with no summary rows yet, so this is idempotent and costs nothing on
// every request after the first.
export async function sweepDailySummary({ daysBack = 7 } = {}) {
  const summaryRows = await readDailySummary()
  const already = summarisedDates(summaryRows)

  const today = todayStr()
  const [dd, mm, yyyy] = today.split('/').map(n => parseInt(n, 10))
  const cursor = new Date(yyyy, mm - 1, dd)

  const wanted = []
  for (let i = 1; i <= daysBack; i++) {
    const d = new Date(cursor)
    d.setDate(d.getDate() - i)
    const label = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
    if (!already.has(label)) wanted.push(label)
  }
  if (wanted.length === 0) return []

  const [shiftRows, updateRows, breakRows, credRows] = await Promise.all([
    readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE),
    readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:L`, TTL.LIVE),
    readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, TTL.LIVE),
    readSheetCached(CRM_SHEET_ID, `${TABS.CREDENTIALS}!A:H`, TTL.ROSTER),
  ])
  const weekOffNames = new Set(
    credRows.slice(1).filter(r => (r[7] || '').toString().toLowerCase() === 'yes').map(r => r[1])
  )

  // A day with no attendance and no updates at all was never worked. Writing
  // a summary for it would be inventing a record of a day nobody was here.
  const hasAnything = (date) =>
    shiftRows.slice(1).some(r => r[2] === date) || updateRows.slice(1).some(r => r[0] === date)

  const done = []
  for (const date of wanted) {
    if (!hasAnything(date)) continue
    if (_G.inFlight.has(date)) continue
    _G.inFlight.add(date)
    try {
      const rows = await summariseDay(date, { shiftRows, updateRows, breakRows, weekOffNames })
      if (rows.length === 0) continue
      // Re-read immediately before writing: another request may have closed
      // this same day out while this one was computing it, and two summaries
      // for one day would double every figure that reads them.
      const fresh = summarisedDates(await readDailySummary())
      if (fresh.has(date)) continue
      await appendRows(CRM_SHEET_ID, TABS.DAILY_SUMMARY, rows)
      invalidateSheetCache(CRM_SHEET_ID, `${TABS.DAILY_SUMMARY}!`)
      done.push({ date, rows: rows.length })
    } catch (e) {
      console.error(`daily summary for ${date} failed:`, e.message)
    } finally {
      _G.inFlight.delete(date)
    }
  }
  return done
}
