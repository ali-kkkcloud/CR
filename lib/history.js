// ══════════════════════════════════════════════════════════════════════
// The months worked before this platform existed.
//
// The team recorded its work in spreadsheets for months before any of this
// was built, and that history is not disposable: it is what a supervisor
// compares this month against, and what an employee has to show for their
// year. Left out, every screen would begin on the day the platform switched
// on and imply nothing happened before it.
//
// It arrives at a coarser grain than the platform records — one row per
// employee per MONTH, not per client per hour — and that is fine, because the
// questions asked of a finished month are the same five: how many clients did
// they get, how many did they finish, how many were left, how many vehicles
// were theirs, and how many did they actually watch.
//
// Deliberately kept as its OWN thing rather than blended into date ranges. A
// month is a lump sum and cannot be cut into days, so folding it into an
// arbitrary range would either overstate a short range or silently drop a
// long one. It is shown as history, labelled as history, next to the figures
// the platform recorded itself — which is both honest and what somebody
// actually wants to look at.
//
// Names are matched to the roster case-insensitively: the old sheets spell
// the same person MAHESH one month and Mahesh the next, and they are one
// person. Anyone no longer on the roster is kept and marked, never dropped —
// their months happened.
// ══════════════════════════════════════════════════════════════════════
import { readSheetCached, CRM_SHEET_ID, TABS } from './sheets'
import { employees } from './schedule'

export const HISTORY_TAB = 'Monthly_History'

// Label | From_Date | To_Date | Employee | Total_Clients | Total_Completed |
// Total_Pending | Total_Vehicles | Vehicles_Monitored | Source
export const HISTORY_HEADER = [
  'Label', 'From_Date', 'To_Date', 'Employee',
  'Total_Clients', 'Total_Completed', 'Total_Pending',
  'Total_Vehicles', 'Vehicles_Monitored', 'Source',
]

const num = (v) => {
  // The old sheets write "25,961". Read as a number, not as 25.
  const n = parseInt((v ?? '').toString().replace(/[^0-9-]/g, ''), 10)
  return Number.isFinite(n) ? n : 0
}

const key = (s) => (s || '').toString().trim().toLowerCase()

// Held on globalThis with a long life and a LAST-GOOD copy.
//
// This table changes about once a month, so re-reading it per request is pure
// waste — and worse than waste: the platform shares one Sheets quota with
// every screen, and when the floor is busy a read can simply fail. Returning
// an empty list on that failure is how months of work vanish off the
// dashboards for minutes at a time, which looks exactly like the data never
// having been imported at all. Once read, it is kept; a later failure serves
// the last good copy rather than nothing.
const _H = globalThis.__cautioHistory || (globalThis.__cautioHistory = { rows: null, at: 0 })
const HISTORY_TTL_MS = 30 * 60 * 1000

export async function readMonthlyHistory() {
  const now = Date.now()
  if (_H.rows && now - _H.at < HISTORY_TTL_MS) return _H.rows
  try {
    const rows = await readSheetCached(CRM_SHEET_ID, `${HISTORY_TAB}!A:J`, HISTORY_TTL_MS)
    _H.rows = rows
    _H.at = now
    return rows
  } catch (e) {
    if (_H.rows) {
      console.error('history: read failed, serving the last good copy —', e.message)
      return _H.rows
    }
    // Never read successfully. The tab may genuinely not exist, which is not
    // an error — it means this operation has no history yet.
    console.error('history: read failed and there is no earlier copy —', e.message)
    return []
  }
}

// Sorts oldest period first, by the date the period starts.
function periodStartMs(from) {
  const [d, m, y] = (from || '').split('/').map(n => parseInt(n, 10))
  if (!d || !m || !y) return 0
  return new Date(y, m - 1, d).getTime()
}

// ── The history, per period and per employee ───────────────────────────
//
// Returns { periods, byEmployee, totals } where periods are oldest first and
// byEmployee is keyed by the ROSTER's spelling of the name where one exists.
export function buildHistory(rows) {
  const roster = new Map(employees().map(e => [key(e.name), e.name]))

  const periods = new Map()
  const byEmployee = {}
  const totals = { clients: 0, completed: 0, pending: 0, vehicles: 0, monitored: 0 }

  ;(rows || []).slice(1).forEach(r => {
    const rawName = (r[3] || '').toString().trim()
    if (!rawName) return
    const label = (r[0] || '').toString().trim() || 'Earlier'
    const name  = roster.get(key(rawName)) || rawName

    const entry = {
      label,
      from: (r[1] || '').toString().trim(),
      to:   (r[2] || '').toString().trim(),
      name,
      // Kept so a name that has left the roster is visibly historical rather
      // than looking like somebody who simply did no work.
      onRoster: roster.has(key(rawName)),
      clients:   num(r[4]),
      completed: num(r[5]),
      pending:   num(r[6]),
      vehicles:  num(r[7]),
      monitored: num(r[8]),
      source: (r[9] || 'imported').toString().trim().toLowerCase(),
    }

    if (!periods.has(label)) {
      periods.set(label, { label, from: entry.from, to: entry.to, people: 0, clients: 0, completed: 0, pending: 0, vehicles: 0, monitored: 0 })
    }
    const p = periods.get(label)
    p.people++
    p.clients += entry.clients; p.completed += entry.completed; p.pending += entry.pending
    p.vehicles += entry.vehicles; p.monitored += entry.monitored

    const b = (byEmployee[name] ||= { name, onRoster: entry.onRoster, months: [], clients: 0, completed: 0, pending: 0, vehicles: 0, monitored: 0 })
    b.months.push(entry)
    b.clients += entry.clients; b.completed += entry.completed; b.pending += entry.pending
    b.vehicles += entry.vehicles; b.monitored += entry.monitored

    totals.clients += entry.clients; totals.completed += entry.completed; totals.pending += entry.pending
    totals.vehicles += entry.vehicles; totals.monitored += entry.monitored
  })

  const ordered = [...periods.values()].sort((a, b) => periodStartMs(a.from) - periodStartMs(b.from))
  Object.values(byEmployee).forEach(b => {
    b.months.sort((x, y) => periodStartMs(x.from) - periodStartMs(y.from))
  })

  return { periods: ordered, byEmployee, totals }
}

export async function getHistory() {
  return buildHistory(await readMonthlyHistory())
}

// One employee's own history, in the shape their dashboard wants.
export async function getHistoryFor(name) {
  const { byEmployee } = await getHistory()
  return byEmployee[name] || null
}
