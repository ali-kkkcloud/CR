import { readSheetCached, CRM_SHEET_ID, TABS } from './sheets'
import { setScheduleData } from './schedule'

// Everything the scheduler needs, read from the spreadsheet.
//
// The roster, the client hours, and the per-employee fixed clients and custom
// slots all used to be literals in lib/schedule.js. For an operation where
// clients come and go and shifts move around, that meant a code change and a
// deploy to do routine work — and a copy in code that silently disagreed with
// the sheet the moment either was edited. None of it is in code any more.
//
//   Credentials     EmpID | Name | Password | Role | ShiftStart | ShiftEnd | IsNight | WeekOff
//   Client_Timings  Client Name | Hours              e.g. "7, 13, 21, 23, 1, 4"
//   Employee_Hours  Employee | Hour | Fixed Clients | Custom Text
//
// There is no built-in copy to fall back on, deliberately — a stale copy is
// worse than none, because it looks like it is working. What there is instead
// is the last set that read cleanly, held in memory. A momentary Sheets
// failure carries on with what this instance last saw; a cold instance that
// has never had a good read fails loudly rather than quietly scheduling
// nobody.
let _lastGood = null

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
      // empId travels with the roster so anything writing a row for this
      // employee can put their real ID in the ID column. The old built-in
      // roster had no IDs, so the no-show sweep fell back to writing the
      // name into the Leaves tab's EmpID column.
      empId: (r[0] || '').toString().trim(),
      name, start, end,
      isNight: (r[6] || '').toString().trim().toLowerCase() === 'yes',
    })
  })
  return out
}

// Hours are a plain list — "7, 13, 21, 23, 1, 4" — so they can be typed and
// read at a glance. Anything that isn't a number 0-23 is ignored.
function parseHourList(cell) {
  return (cell || '').toString()
    .split(/[,\s]+/)
    .map(h => parseInt(h, 10))
    .filter(h => Number.isInteger(h) && h >= 0 && h <= 23)
}

function parseTimings(rows) {
  const out = {}
  rows.slice(1).forEach(r => {
    const client = (r[0] || '').toString().trim()
    if (!client) return
    // A client with no hours isn't an error — it's one parked without
    // deleting the row. It simply never comes up in a slot.
    out[client] = parseHourList(r[1])
  })
  return out
}

// Employee | Hour | Fixed Clients | Custom Text
function parseEmployeeHours(rows) {
  const out = {}
  rows.slice(1).forEach(r => {
    const name = (r[0] || '').toString().trim()
    const hour = parseInt(r[1], 10)
    if (!name || !Number.isInteger(hour)) return
    const clients = (r[2] || '').toString().split(',').map(c => c.trim()).filter(Boolean)
    const text    = (r[3] || '').toString().trim()
    if (!clients.length && !text) return
    if (!out[name]) out[name] = {}
    out[name][hour] = { clients, text }
  })
  return out
}

// Call once at the top of any request that schedules or distributes.
//
// All three reads are cached for a minute, so calling it on every request
// costs nothing after the first — and the cache drops whenever the tab is
// written, so an edit in the sheet is live within a minute without a deploy.
export async function loadScheduleData() {
  const [credRows, timingRows, hourRows] = await Promise.all([
    readSheetCached(CRM_SHEET_ID, `${TABS.CREDENTIALS}!A:H`, 60000).catch(e => {
      console.error('roster: Credentials read failed —', e.message); return null
    }),
    readSheetCached(CRM_SHEET_ID, `${TABS.CLIENT_TIMINGS}!A:B`, 60000).catch(e => {
      console.error('roster: Client_Timings read failed —', e.message); return null
    }),
    // This tab is optional: most operations have no fixed clients and no
    // custom slots at all, and an empty or absent tab simply means none.
    readSheetCached(CRM_SHEET_ID, `${TABS.EMPLOYEE_HOURS}!A:D`, 60000).catch(() => null),
  ])

  const employees     = credRows   ? parseRoster(credRows)        : null
  const timings       = timingRows ? parseTimings(timingRows)     : null
  const employeeHours = hourRows   ? parseEmployeeHours(hourRows) : null

  const data = {
    employees:     employees && employees.length            ? employees     : _lastGood?.employees,
    timings:       timings && Object.keys(timings).length   ? timings       : _lastGood?.timings,
    employeeHours: employeeHours ?? _lastGood?.employeeHours ?? {},
  }

  if (!data.employees?.length) {
    throw new Error('Roster unavailable: the Credentials tab could not be read and nothing is cached yet')
  }
  if (!data.timings || !Object.keys(data.timings).length) {
    throw new Error('Client hours unavailable: the Client_Timings tab could not be read and nothing is cached yet')
  }

  _lastGood = data
  setScheduleData(data)
  return data
}
