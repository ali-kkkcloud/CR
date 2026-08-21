import { getUserFromReq } from '../../../lib/auth'
import { readSheetCached, CRM_SHEET_ID, TABS, todayStr, calcDurationMinutes, nowStr, TTL } from '../../../lib/sheets'
import { sweepAutoBreaks, findOpenBreaks, recentDates, isSupersededBreak, totalBreakMinutes } from '../../../lib/attendance'

// GET /api/admin/breaks?from=YYYY-MM-DD&to=YYYY-MM-DD  (both optional — defaults to today)
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden — admin only' })

  try {
    const today = todayStr()
    const fromISO = (req.query.from || '').toString()
    const toISO   = (req.query.to   || '').toString()

    // Build the set of ddmmyyyy date strings covered by the range (defaults to today only)
    let dateSet = null
    if (fromISO && toISO) {
      dateSet = new Set()
      const d = new Date(fromISO)
      const end = new Date(toISO)
      while (d <= end) {
        dateSet.add(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`)
        d.setDate(d.getDate()+1)
      }
    }

    // Catch anyone who has gone quiet, including employees who simply shut
    // the laptop — their own dashboard isn't polling to notice, so the admin
    // opening this view is what records the break, backdated to when they
    // stopped working.
    try {
      const credRows = await readSheetCached(CRM_SHEET_ID, `${TABS.CREDENTIALS}!A:H`, TTL.ROSTER)
      const staff = credRows.slice(1)
        .filter(r => (r[3] || '').toString().toLowerCase() !== 'admin')
        .map(r => ({ empId: r[0], name: r[1] }))
      await sweepAutoBreaks(staff)
    } catch (e) {
      // Never let the sweep take the whole page down — it is a side effect,
      // not the thing the admin asked for.
      console.error('Auto-break sweep failed:', e.message)
    }

    const rows = await readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, TTL.LIVE)
    const inRange = rows.slice(1).filter(r => dateSet ? dateSet.has(r[2]) : r[2] === today)

    // One break, one line. If two requests ever manage to open the same break
    // together, the pair share an employee, a date and a start time — showing
    // both would report one break as two and count its minutes twice.
    const seen = new Set()
    const relevant = inRange.filter(r => {
      const key = `${(r[0]||'').toString().trim()}|${r[2]}|${r[3]}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // ── Who is on a break RIGHT NOW ──
    //
    // Deliberately not derived from the rows above. Those are filtered to
    // whatever date range the admin picked, and "currently on break" is not a
    // question about a date range:
    //
    //   - picking "All time" made every stale Active row in the sheet's
    //     history mark that person as on a break this second;
    //   - picking "Today" hid a break that began before midnight on a night
    //     shift, which is exactly the one still running.
    //
    // It is the same definition the employee's own screen uses — an open row
    // across the two days a running shift can span — with one extra guard:
    // nobody can be on a break if they are not on a shift. A row left Active
    // by a shift that was never closed out is a leftover, not a person who
    // stepped away, and reporting it kept somebody "on break" long after they
    // had gone home.
    const shiftRows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE)
    const dates = recentDates()
    const onShiftIds = new Set(
      shiftRows.slice(1)
        .filter(r => dates.includes(r[2]) && (r[6] || '').toString().trim() === 'Active')
        .map(r => (r[0] || '').toString().trim())
    )

    const liveBreaks = {}   // name -> { since, isAuto }
    rows.slice(1).forEach(r => {
      const empId = (r[0] || '').toString().trim()
      if (!onShiftIds.has(empId)) return
      const open = findOpenBreaks(rows, empId, dates)[0]
      if (!open) return
      liveBreaks[r[1] || 'Unknown'] = { since: open.startTime, date: open.startDate, isAuto: open.isAuto }
    })

    // Rows the repair superseded are history at zero minutes. Listing them
    // would put hundreds of "0m" sessions on this screen and inflate every
    // session count with breaks nobody took.
    const real = relevant.filter(r => !isSupersededBreak(r))

    const byEmployee = {}
    const rowsOf = {}
    real.forEach(r => {
      const name = r[1] || 'Unknown'
      if (!byEmployee[name]) byEmployee[name] = { name, sessions: 0, autoSessions: 0, totalMinutes: 0, currentlyOnBreak: false, activeSince: null, activeIsAuto: false }
      byEmployee[name].sessions++
      if ((r[7] || '') === 'Auto') byEmployee[name].autoSessions = (byEmployee[name].autoSessions || 0) + 1
      ;(rowsOf[name] || (rowsOf[name] = [])).push(r)
    })

    // Counted the same way the employee's own screen counts it: the union of
    // the stretches, not the sum of the rows. Adding the rows up made two
    // overlapping breaks read as one long one twice over, and the admin's
    // figure then disagreed with what the employee was being shown for the
    // same day. The rows are already filtered to the chosen range and to the
    // one employee, so no further filtering is wanted here.
    Object.entries(rowsOf).forEach(([name, rs]) => {
      byEmployee[name].totalMinutes = totalBreakMinutes([null, ...rs], null, null)
    })

    // Somebody on a break right now may have no session inside the selected
    // range at all (a night shift's break began yesterday). They still belong
    // in the list, or the count and the list would disagree.
    Object.entries(liveBreaks).forEach(([name, live]) => {
      if (!byEmployee[name]) byEmployee[name] = { name, sessions: 0, autoSessions: 0, totalMinutes: 0 }
      byEmployee[name].currentlyOnBreak = true
      byEmployee[name].activeSince = live.since
      byEmployee[name].activeDate = live.date
      byEmployee[name].activeIsAuto = live.isAuto
    })

    const employees = Object.values(byEmployee).sort((a,b) => b.totalMinutes - a.totalMinutes)

    const sessions = real.map(r => ({
      name: r[1] || '', date: r[2] || '', startTime: r[3] || '', endTime: r[4] || '',
      minutes: r[6] === 'Active' ? calcDurationMinutes(r[2], r[3], r[2], nowStr()) : (parseInt(r[5]) || 0),
      status: r[6] || '',
      isAuto: (r[7] || '') === 'Auto',
    })).sort((a,b) => (a.date+a.startTime) < (b.date+b.startTime) ? 1 : -1)

    return res.status(200).json({
      employees,
      sessions,
      totalMinutes: employees.reduce((s,e)=>s+e.totalMinutes,0),
      onBreakNow: employees.filter(e=>e.currentlyOnBreak).length,
    })
  } catch (err) {
    console.error('Admin breaks error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
