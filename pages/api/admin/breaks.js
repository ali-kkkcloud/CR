import { getUserFromReq } from '../../../lib/auth'
import { readSheet, readSheetCached, CRM_SHEET_ID, TABS, todayStr, calcDurationMinutes, nowStr } from '../../../lib/sheets'
import { sweepAutoBreaks } from '../../../lib/attendance'

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
      const credRows = await readSheetCached(CRM_SHEET_ID, `${TABS.CREDENTIALS}!A:H`, 60000)
      const staff = credRows.slice(1)
        .filter(r => (r[3] || '').toString().toLowerCase() !== 'admin')
        .map(r => ({ empId: r[0], name: r[1] }))
      await sweepAutoBreaks(staff)
    } catch (e) {
      // Never let the sweep take the whole page down — it is a side effect,
      // not the thing the admin asked for.
      console.error('Auto-break sweep failed:', e.message)
    }

    const rows = await readSheet(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`)
    const relevant = rows.slice(1).filter(r => dateSet ? dateSet.has(r[2]) : r[2] === today)

    const byEmployee = {}
    relevant.forEach(r => {
      const name = r[1] || 'Unknown'
      if (!byEmployee[name]) byEmployee[name] = { name, sessions: 0, autoSessions: 0, totalMinutes: 0, currentlyOnBreak: false, activeSince: null, activeIsAuto: false }
      const minutes = r[6] === 'Active' ? calcDurationMinutes(r[2], r[3], r[2], nowStr()) : (parseInt(r[5]) || 0)
      byEmployee[name].sessions++
      byEmployee[name].totalMinutes += minutes
      if ((r[7] || '') === 'Auto') byEmployee[name].autoSessions = (byEmployee[name].autoSessions || 0) + 1
      if (r[6] === 'Active') {
        byEmployee[name].currentlyOnBreak = true
        byEmployee[name].activeSince = r[3]
        byEmployee[name].activeIsAuto = (r[7] || '') === 'Auto'
      }
    })

    const employees = Object.values(byEmployee).sort((a,b) => b.totalMinutes - a.totalMinutes)

    const sessions = relevant.map(r => ({
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
