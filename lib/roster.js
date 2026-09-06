import { readSheetCached, CRM_SHEET_ID, TABS, TTL } from './sheets'
import { setScheduleData, nameKey } from './schedule'

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
//
// Held on globalThis, not in a module variable, because Next compiles each API
// route separately and each copy of this module would otherwise keep its own.
// That defeated the whole point: with Google's read quota exhausted, a route
// that happened not to have read successfully yet threw "Roster unavailable"
// and returned a 500 — while another route in the same process was serving the
// same page from a perfectly good cached roster. Full Day View and Employee
// Progress both failed this way under load. One store, shared by every route
// in the instance.
const STORE = globalThis.__cautioRoster || (globalThis.__cautioRoster = { lastGood: null })

export function parseRoster(rows) {
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
      // The standing weekly day off. Anyone carrying it is not coming in, so
      // projections of what a future hour holds must leave them out — their
      // share of that hour really does go to the people who are there.
      isWeekOff: (r[7] || '').toString().trim().toLowerCase() === 'yes',
    })
  })
  return out
}

// Hours are a plain list — "7, 13, 21, 23, 1, 4" — so they can be typed and
// read at a glance. Anything that isn't a number 0-23 is ignored.
export function parseHourList(cell) {
  return (cell || '').toString()
    .split(/[,\s]+/)
    .map(h => parseInt(h, 10))
    .filter(h => Number.isInteger(h) && h >= 0 && h <= 23)
}

// ── Two rows for one client are UNIONED, not one silently overwriting ──
//
// Found on the live book: "KARTHIKEYA TOURS AND TRAVELS" has two rows with
// different hours — "7, 12, 15, 19, 21, 0, 3, 5" on row 93 and
// "10, 12, 14, 18, 22, 0, 2, 4, 6" on row 145. Assigning by name, the second
// silently replaced the first, and six hours somebody had typed in were not
// being watched by anybody. Nothing said so: the client was on boards, so it
// looked entirely healthy.
//
// The union is the only reading where no typed hour is lost, which is the
// rule this platform is built on. It can be wrong the other way — a row
// somebody meant to REPLACE and forgot to delete now adds hours — so the
// duplicate is reported on the Command Center rather than merged in silence.
//
// Keyed case- and space-insensitively for the same reason as everything else,
// and the FIRST spelling is kept as the client's name.
export function parseTimings(rows) {
  const out = {}
  const byKey = new Map()          // normalised -> the spelling we keep
  rows.slice(1).forEach(r => {
    const client = (r[0] || '').toString().trim()
    if (!client) return
    const k = nameKey(client)
    const name = byKey.get(k) || (byKey.set(k, client), client)
    // A client with no hours isn't an error — it's one parked without
    // deleting the row. It simply never comes up in a slot.
    const hours = parseHourList(r[1])
    out[name] = out[name] ? [...new Set([...out[name], ...hours])].sort((a, b) => a - b) : hours
  })
  return out
}

// Clients written on more than one row, so the sheet can be tidied. Reported
// rather than guessed at — see parseTimings.
export function duplicateTimingRows(rows) {
  const seen = new Map()
  ;(rows || []).slice(1).forEach(r => {
    const client = (r[0] || '').toString().trim()
    if (!client) return
    const k = nameKey(client)
    if (!seen.has(k)) seen.set(k, { client, rows: 0, hours: [] })
    const e = seen.get(k)
    e.rows++
    e.hours.push((r[1] || '').toString().trim() || '(blank)')
  })
  return [...seen.values()].filter(e => e.rows > 1)
}

// ── Client_Hidden: Date | Client | Reason | MarkedBy | MarkedAt | Status ──
//
// Returns { 'dd/mm/yyyy': Set(client) }. A row marked Removed is history, not
// a hiding — the tab is append-only so that taking something off a day and
// putting it back leaves a trail, and so that no row index can race with a
// concurrent write. Only the LAST row for a (date, client) counts, so a client
// hidden, restored and hidden again reads as hidden.
export function parseHidden(rows) {
  const latest = new Map()
  ;(rows || []).slice(1).forEach(r => {
    const date   = (r[0] || '').toString().trim()
    const client = (r[1] || '').toString().trim()
    if (!date || !client) return
    // ── The key is NORMALISED, and that is the whole point of it ──────
    //
    // Keyed on the raw name, a "Hidden" row for "Zingbus" and a "Removed" row
    // for "zingbus" are two different keys: both survive the collapse, and
    // once they are canonicalised the Hidden one wins. The admin presses "Put
    // back", is told it worked, and the client stays off every board — and
    // out of the denominator, so no alarm fires either. Silent, and it is
    // exactly the outcome this platform must never produce.
    //
    // The tab is hand-editable and the platform runs on spreadsheets people
    // type into, so the two spellings genuinely occur. Collapsed on the same
    // key the rest of the platform uses, the later row wins whatever case it
    // was typed in.
    latest.set(`${date}|${nameKey(client)}`, {
      date, client,
      removed: (r[5] || '').toString().trim().toLowerCase() === 'removed',
    })
  })
  const out = {}
  latest.forEach(({ date, client, removed }) => {
    if (removed) return
    if (!out[date]) out[date] = new Set()
    out[date].add(client)
  })
  return out
}

// ── Client_Notes: Client | Hour | Note | MarkedBy | MarkedAt | Status ──
//
// Returns { client: { hour: note } }. No date: a note stands until it is
// removed. Same last-row-wins, same Removed convention.
export function parseClientNotes(rows) {
  const latest = new Map()
  ;(rows || []).slice(1).forEach(r => {
    const client = (r[0] || '').toString().trim()
    const hour   = parseInt(r[1], 10)
    const note   = (r[2] || '').toString().trim()
    if (!client || !Number.isInteger(hour) || hour < 0 || hour > 23) return
    // Normalised for the same reason as parseHidden above — a note removed
    // under a different capital would otherwise stay in force for ever.
    latest.set(`${nameKey(client)}|${hour}`, {
      client, hour, note,
      removed: (r[5] || '').toString().trim().toLowerCase() === 'removed',
    })
  })
  const out = {}
  latest.forEach(({ client, hour, note, removed }) => {
    // A note with no text left is nothing to show, whatever its status says.
    if (removed || !note) return
    if (!out[client]) out[client] = {}
    out[client][hour] = note
  })
  return out
}

// ── One reading of a row, for the parser AND the reporter ─────────────
//
// They used to measure "is this row usable" differently, and the gap was
// exactly the kind of row that needed reporting most. The parser splits the
// clients cell on commas and drops the blanks, so " , , " gives it nothing and
// it discards the row. The reporter only trimmed the cell, and " , , " is not
// empty, so it called the row healthy. A row with the client names deleted but
// the commas left behind therefore did nothing AND was reported nowhere — the
// invisible dead row this reporter exists to abolish.
//
// One function decides now, and both read its answer.
//
//   Employee | Hour | Fixed Clients | Custom Text
export function readHourRow(r) {
  const name    = (r?.[0] || '').toString().trim()
  const rawHour = (r?.[1] || '').toString().trim()
  const hour    = parseInt(rawHour, 10)
  const clients = (r?.[2] || '').toString().split(',').map(c => c.trim()).filter(Boolean)
  const text    = (r?.[3] || '').toString().trim()

  let problem = null
  if (!name && !clients.length && !text && !rawHour) problem = 'empty'   // just an empty row
  else if (!name) problem = 'no employee name'
  else if (!Number.isInteger(hour) || hour < 0 || hour > 23)
    problem = `hour is ${JSON.stringify(rawHour)} — must be 0-23`
  else if (!clients.length && !text) problem = 'no clients and no custom text'

  return { name, hour, clients, text, problem }
}

export function parseEmployeeHours(rows) {
  const out = {}
  rows.slice(1).forEach(r => {
    const { name, hour, clients, text, problem } = readHourRow(r)
    if (problem) return
    if (!out[name]) out[name] = {}
    // Two rows for the same person AND the same hour — the ordinary "typed it
    // twice" mistake, which needs no case difference at all. Assigning would
    // drop the first row's clients, and its custom text with them.
    const had = out[name][hour]
    out[name][hour] = had
      ? { clients: [...new Set([...had.clients, ...clients])], text: had.text || text }
      : { clients, text }
  })
  return out
}

// Rows in Employee_Hours that the parser cannot use, so they can be named
// rather than vanishing. Found live: a row naming two clients for "Nesiya"
// with the hour column left blank, which has been doing nothing since it was
// typed and said so nowhere.
export function unusableHourRows(rows) {
  const out = []
  ;(rows || []).slice(1).forEach((r, i) => {
    const { name, problem } = readHourRow(r)
    if (!problem || problem === 'empty') return
    out.push({ row: i + 2, name, reason: problem })
  })
  return out
}

// Call once at the top of any request that schedules or distributes.
//
// All three reads are cached for a minute, so calling it on every request
// costs nothing after the first — and the cache drops whenever the tab is
// written, so an edit in the sheet is live within a minute without a deploy.
export async function loadScheduleData() {
  const [credRows, timingRows, hourRows, hiddenRows, noteRows] = await Promise.all([
    readSheetCached(CRM_SHEET_ID, `${TABS.CREDENTIALS}!A:H`, TTL.ROSTER).catch(e => {
      console.error('roster: Credentials read failed —', e.message); return null
    }),
    readSheetCached(CRM_SHEET_ID, `${TABS.CLIENT_TIMINGS}!A:B`, TTL.ROSTER).catch(e => {
      console.error('roster: Client_Timings read failed —', e.message); return null
    }),
    // This tab is optional: most operations have no fixed clients and no
    // custom slots at all, and an empty or absent tab simply means none.
    readSheetCached(CRM_SHEET_ID, `${TABS.EMPLOYEE_HOURS}!A:D`, TTL.ROSTER).catch(() => null),
    // Both optional in the same way, and on a book where they have never been
    // created the read simply fails and means "nothing hidden, no notes".
    readSheetCached(CRM_SHEET_ID, `${TABS.CLIENT_HIDDEN}!A:F`, TTL.ROSTER).catch(() => null),
    readSheetCached(CRM_SHEET_ID, `${TABS.CLIENT_NOTES}!A:F`,  TTL.ROSTER).catch(() => null),
  ])

  const employees     = credRows   ? parseRoster(credRows)        : null
  const timings       = timingRows ? parseTimings(timingRows)     : null
  const employeeHours = hourRows   ? parseEmployeeHours(hourRows) : null

  const data = {
    employees:     employees && employees.length            ? employees     : STORE.lastGood?.employees,
    timings:       timings && Object.keys(timings).length   ? timings       : STORE.lastGood?.timings,
    employeeHours: employeeHours ?? STORE.lastGood?.employeeHours ?? {},
    // Deliberately NOT falling back to the last good copy when the read fails.
    // A stale hiding takes a client off a board it belongs on, which is the
    // one thing this platform must never do; an empty map only means the
    // client is shown, which is the safe direction to be wrong in.
    hidden: hiddenRows ? parseHidden(hiddenRows) : {},
    notes:  noteRows   ? parseClientNotes(noteRows) : {},
  }

  if (!data.employees?.length) {
    throw new Error('Roster unavailable: the Credentials tab could not be read and nothing is cached yet')
  }
  if (!data.timings || !Object.keys(data.timings).length) {
    throw new Error('Client hours unavailable: the Client_Timings tab could not be read and nothing is cached yet')
  }

  STORE.lastGood = data
  setScheduleData(data)
  return data
}
