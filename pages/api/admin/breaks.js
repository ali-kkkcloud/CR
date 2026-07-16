import { getUserFromReq } from '../../../lib/auth'
import { readSheet, CRM_SHEET_ID, TABS, todayStr, calcDurationMinutes, nowStr } from '../../../lib/sheets'

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

    const rows = await readSheet(CRM_SHEET_ID, `${TABS.BREAKS}!A:G`)
    const relevant = rows.slice(1).filter(r => dateSet ? dateSet.has(r[2]) : r[2] === today)

    const byEmployee = {}
    relevant.forEach(r => {
      const name = r[1] || 'Unknown'
      if (!byEmployee[name]) byEmployee[name] = { name, sessions: 0, totalMinutes: 0, currentlyOnBreak: false, activeSince: null }
      const minutes = r[6] === 'Active' ? calcDurationMinutes(r[2], r[3], r[2], nowStr()) : (parseInt(r[5]) || 0)
      byEmployee[name].sessions++
      byEmployee[name].totalMinutes += minutes
      if (r[6] === 'Active') { byEmployee[name].currentlyOnBreak = true; byEmployee[name].activeSince = r[3] }
    })

    const employees = Object.values(byEmployee).sort((a,b) => b.totalMinutes - a.totalMinutes)

    const sessions = relevant.map(r => ({
      name: r[1] || '', date: r[2] || '', startTime: r[3] || '', endTime: r[4] || '',
      minutes: r[6] === 'Active' ? calcDurationMinutes(r[2], r[3], r[2], nowStr()) : (parseInt(r[5]) || 0),
      status: r[6] || '',
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
