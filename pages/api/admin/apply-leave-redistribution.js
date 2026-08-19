import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, appendRows, CRM_SHEET_ID, TABS, todayStr, nowStr, nowIST,
  hourHasPassed, fetchClientVehicleCounts, getLeaveMapForDate
} from '../../../lib/sheets'
import { getScheduledEmployeesAtHour, distributeClientsForHour, employees } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'

const nowISTHour = () => nowIST().getHours()

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const { empName, date, fromHour, toHour } = req.body
    if (!empName || !date || fromHour === undefined) {
      return res.status(400).json({ error: 'empName, date, fromHour required' })
    }

    const now = nowStr()
    const leaveMap   = await getLeaveMapForDate(date)
    const vehicleMap = await fetchClientVehicleCounts()
    const updateRows = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:L`)

    const emp = employees().find(e => e.name === empName)
    if (!emp) return res.status(400).json({ error: 'Employee not found' })

    const end = toHour !== undefined ? parseInt(toHour) : 24
    const affectedHours = []
    for (let h = parseInt(fromHour); h < end; h++) {
      let inShift = emp.isNight
        ? (h >= emp.start || h < emp.end)
        : (h >= emp.start && h < emp.end)
      if (inShift) affectedHours.push(h)
    }

    // ── Only hours that have not happened yet ────────────────────────────
    //
    // You cannot redistribute an hour that is already over. The work either
    // happened or it did not, and the rows already written are the record of
    // which — moving it now rewrites history for a shift that has finished.
    //
    // Marking somebody on leave used to walk their WHOLE window, so a leave
    // entered at six in the evening reached back and touched every hour from
    // seven that morning: 299 hand-over entries and four hundred placeholder
    // rows, all stamped 6pm, for hours nobody could still be working. Those
    // rows then made each of those hours look "settled" — settled from
    // records of work that never happened — and pinned the whole morning to
    // whoever the split happened to name at six o'clock.
    const nowHour = nowISTHour()
    const stillToCome = date !== todayStr()
      ? []
      : affectedHours.filter(h => h === nowHour || !hourHasPassed(h, nowHour))
    const skippedPast = affectedHours.length - stillToCome.length

    const redistRows      = []

    for (const hour of stillToCome) {
      const withThem    = getScheduledEmployeesAtHour(hour, {}).map(e => e.name)
      const withoutThem = getScheduledEmployeesAtHour(hour, leaveMap).map(e => e.name)
      if (!withThem.includes(empName)) continue

      const lockedAll = {}
      updateRows.slice(1)
        .filter(r => r[0] === date && parseInt(r[4]) === hour)
        .forEach(r => { lockedAll[r[3]] = r[2] })

      const lockedWithoutEmp = Object.fromEntries(
        Object.entries(lockedAll).filter(([, v]) => v !== empName)
      )

      const oldDist      = distributeClientsForHour(hour, withThem, vehicleMap, {})
      const theirClients = (oldDist[empName] || [])
        .map(c => c.client)
        .filter(c => !lockedAll[c] || lockedAll[c] === empName)

      if (!theirClients.length) continue

      const newDist = distributeClientsForHour(hour, withoutThem, vehicleMap, lockedWithoutEmp)

      theirClients.forEach(client => {
        let newOwner = null
        for (const [name, clients] of Object.entries(newDist)) {
          if (clients.some(c => c.client === client)) { newOwner = name; break }
        }
        if (!newOwner || newOwner === empName) return

        redistRows.push([date, now, empName, newOwner, client, String(hour), 'Admin Leave'])

      })
    }

    // Audit trail only — no placeholder rows.
    //
    // The live split is what actually moves the work: the employee on leave
    // drops out of the pool and their clients land on whoever is still there,
    // on the next refresh. Writing rows as well pins the work to a name the
    // recomputed split may not agree with, and makes an hour look worked when
    // nobody has touched it. /api/shift/end has followed this rule for a while
    // and this is the same reasoning.
    if (redistRows.length > 0) await appendRows(CRM_SHEET_ID, TABS.REDISTRIB, redistRows)

    return res.status(200).json({
      success: true,
      redistributed: redistRows.length,
      hours: stillToCome.length,
      // Named so the admin knows the morning was left alone on purpose.
      skippedPastHours: skippedPast,
    })

  } catch (err) {
    console.error('Apply leave redistribution error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
