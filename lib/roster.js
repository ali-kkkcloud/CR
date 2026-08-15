import { readSheetCached, CRM_SHEET_ID, TABS } from './sheets'
import { setScheduleData } from './schedule'

// The roster and the client hours, read from the spreadsheet.
//
// Both used to live in lib/schedule.js as literals, which meant adding a
// client or moving somebody's shift was a code change and a deploy — for a
// fleet where clients come and go and shifts move around, that is the wrong
// place for them. They belong where every other operational fact already
// lives: the sheet.
//
// The literals are still in schedule.js and still work. They are the safety
// net: if a tab is missing, empty, or unreadable, the platform runs on them
// rather than on nothing. So a mistake in the sheet degrades to yesterday's
// behaviour instead of leaving an hour with no owners.

// Shifts come from the Credentials tab, which already carries them —
// EmpID | Name | Password | Role | ShiftStart | ShiftEnd | IsNight | WeekOff.
// Keeping them there means one row per employee, not two places to update.
function parseRoster(rows) {
  const out = []
  rows.slice(1).forEach(r => {
    const name = (r[1] || '').toString().trim()
    const role = (r[3] || 'employee').toString().trim().toLowerCase()
    if (!name || role === 'admin') return
    const start = parseInt(r[4], 10)
    const end   = parseInt(r[5], 10)
    // A row without usable hours is skipped rather than defaulted — guessing
    // would quietly put somebody on a shift they don't work.
    if (!Number.isFinite(start) || !Number.isFinite(end)) return
    out.push({
      name, start, end,
      isNight: (r[6] || '').toString().trim().toLowerCase() === 'yes',
    })
  })
  return out
}

// Client_Timings tab: Client Name | Hours
// Hours is a plain list — "7, 13, 21, 23, 1, 4" — so it can be typed and read
// at a glance. Anything that isn't a number 0-23 is ignored.
function parseTimings(rows) {
  const out = {}
  rows.slice(1).forEach(r => {
    const client = (r[0] || '').toString().trim()
    if (!client) return
    const hours = (r[1] || '').toString()
      .split(/[,\s]+/)
      .map(h => parseInt(h, 10))
      .filter(h => Number.isInteger(h) && h >= 0 && h <= 23)
    // A client with no hours is not an error — it's one that has been parked
    // without deleting the row. It simply never comes up in a slot.
    out[client] = hours
  })
  return out
}

// Call once at the top of any request that schedules or distributes.
//
// Both reads are cached, so calling it on every request costs nothing after
// the first — and the cache drops whenever the tab is written, so an edit in
// the sheet is live within seconds without a deploy.
export async function loadScheduleData() {
  let employees = null
  let timings   = null

  try {
    const rows = await readSheetCached(CRM_SHEET_ID, `${TABS.CREDENTIALS}!A:H`, 60000)
    const parsed = parseRoster(rows)
    if (parsed.length) employees = parsed
  } catch (e) {
    console.error('roster: Credentials read failed, using built-in roster —', e.message)
  }

  try {
    const rows = await readSheetCached(CRM_SHEET_ID, `${TABS.CLIENT_TIMINGS}!A:B`, 60000)
    const parsed = parseTimings(rows)
    if (Object.keys(parsed).length) timings = parsed
  } catch (e) {
    // A missing tab lands here too, which is exactly right: the platform
    // carries on with the built-in list until somebody creates it.
    console.error('roster: Client_Timings read failed, using built-in list —', e.message)
  }

  setScheduleData({ employees, timings })
  return { employees, timings }
}
