import { getUserFromReq } from '../../../lib/auth'
import {
  readSheetCached, ISSUE_SHEET_ID, CRM_SHEET_ID, TABS, todayStr, yesterdayStr,
  getShiftOverridesForDate, getLeaveMapForDate, fetchClientVehicleCounts, TTL, warmTogether, SHIFT_SCREEN_TABS,
} from '../../../lib/sheets'
import { employees } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { collapseSlotOwners } from '../../../lib/distribution'
import { computeDayPlan } from '../../../lib/dayplan'
import { readDailySummary, parseSummaryRow } from '../../../lib/rollup'
import { getHistory } from '../../../lib/history'

const ISSUE_TAB = 'Issues- Realtime'

function toISTDate(d) {
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })
}

function parseDDMMYYYY(str) {
  const [d, m, y] = str.split('/').map(Number)
  return new Date(y, m - 1, d)
}

function dateRangeArray(fromStr, toStr) {
  const from = parseDDMMYYYY(fromStr)
  const to   = parseDDMMYYYY(toStr)
  const dates = []
  const cur = new Date(from)
  while (cur <= to) {
    dates.push(toISTDate(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    // Every tab this screen needs, asked for in one go before anything else
    // runs — so they cost one request between them instead of one per stage.
    // See warmTogether in lib/sheets.
    await warmTogether(CRM_SHEET_ID, [...SHIFT_SCREEN_TABS, `${TABS.DAILY_SUMMARY}!A:N`])

    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const today = todayStr()
    let fromDate = req.query.from || ''
    let toDate   = req.query.to   || ''

    function isoToDDMMYYYY(iso) {
      if (!iso) return null
      const [y, m, d] = iso.split('-')
      return `${d}/${m}/${y}`
    }

    const fromDDMMYYYY = isoToDDMMYYYY(fromDate) || today
    const toDDMMYYYY   = isoToDDMMYYYY(toDate)   || today

    const rangeDates = dateRangeArray(fromDDMMYYYY, toDDMMYYYY)

    const [shiftRows, updateRows, footageRows, summaryRows] = await Promise.all([
      readSheetCached(CRM_SHEET_ID,   `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID,   `${TABS.CRM_UPDATES}!A:L`, TTL.LIVE),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, TTL.ISSUES),
      readDailySummary(),
    ])

    // ── Days that have been closed out, and days that have not ───────────
    //
    // A finished day is read from its summary — fourteen numbers per person
    // rather than a thousand rows — and that is also where work recorded
    // BEFORE this platform existed lives, imported in the same shape. So a
    // range that reaches back into the old spreadsheets reads exactly the same
    // way as one that covers this week, and a chart drawn across the join has
    // no gap in it.
    //
    // Days with no summary yet — today, and anything the roll-up has not
    // reached — are still read from the detail rows.
    const summaryByDateName = {}
    const summarised = new Set()
    ;(summaryRows || []).slice(1).forEach(row => {
      const s = parseSummaryRow(row)
      if (!s.date || !s.name) return
      summarised.add(s.date)
      const key = `${s.date}__${s.name}`
      // One row per person per day. If a day were ever summarised twice, the
      // figures must not be added together — the later row wins.
      summaryByDateName[key] = s
    })
    const summarisedInRange = rangeDates.filter(d => summarised.has(d))
    const liveDates = new Set(rangeDates.filter(d => !summarised.has(d)))

    // ── The day still in progress ────────────────────────────────────────
    //
    // A day that has not been closed out cannot be counted from its rows.
    // CRM_Updates now holds a row only where somebody actually recorded
    // something, so counting rows would report every live day as finished —
    // assigned equal to completed, nothing outstanding, on the one day where
    // outstanding work is the whole point.
    //
    // So the live day is read from computeDayPlan, exactly as the Dashboard
    // and Hour by hour read it, and the two screens cannot disagree. There is
    // normally at most one such day — the roll-up closes every earlier one —
    // and any others fall back to their rows rather than costing a read each.
    let livePlan = null
    if (liveDates.has(today)) {
      try {
        const [ovMap, lvMap, vehMap, breakRows, credRows] = await Promise.all([
          getShiftOverridesForDate(today),
          getLeaveMapForDate(today),
          fetchClientVehicleCounts(),
          readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, TTL.LIVE),
          readSheetCached(CRM_SHEET_ID, `${TABS.CREDENTIALS}!A:H`, TTL.ROSTER),
        ])
        livePlan = computeDayPlan({
          date: today, today,
          nowHour: new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })).getHours(),
          yesterday: yesterdayStr(),
          shiftRows, updateRows, breakRows,
          leaveMap: lvMap, overridesMap: ovMap, vehicleMap: vehMap,
          weekOffNames: new Set(
            credRows.slice(1).filter(r => (r[7] || '').toString().toLowerCase() === 'yes').map(r => r[1])
          ),
        })
      } catch (e) {
        console.error('progress: live day plan failed', e.message)
      }
    }

    // Any remaining unsummarised day is read from its rows. One owner per
    // (date, client, hour) — a client that passed through two people must not
    // be counted against both.
    const fromRowsDates = new Set([...liveDates].filter(d => !(livePlan && d === today)))
    const ownedSlots = [...collapseSlotOwners(updateRows, r => fromRowsDates.has(r[0])).values()]
    const rowsByOwner = {}
    ownedSlots.forEach(s => { (rowsByOwner[s.owner] ||= []).push(s.row) })

    const progress = employees().map(emp => {
      const attendance = rangeDates.map(date => {
        const rowsForDate = shiftRows.slice(1).filter(r => r[1] === emp.name && r[2] === date)
        if (rowsForDate.length === 0) {
          return { date, status: 'absent', startTime: '', endTime: '', duration: '' }
        }
        const latest = rowsForDate[rowsForDate.length - 1]
        return {
          date,
          status:    latest[6] === 'Active' ? 'active' : latest[6] === 'Ended' ? 'completed' : 'absent',
          startTime: latest[3] || '',
          endTime:   latest[4] || '',
          duration:  latest[5] || '',
        }
      })

      const daysPresent = attendance.filter(a => a.status !== 'absent').length
      const daysAbsent   = attendance.filter(a => a.status === 'absent').length

      const rangeUpdates = rowsByOwner[emp.name] || []
      const rangeClients = [...new Set(rangeUpdates.map(r => r[3]))]
      const rangeCompletedUpdates = rangeUpdates.filter(r => (r[5]||'').toString().trim())

      // Everything the summarised days contribute, added on top of the live
      // days' detail. Both halves measure the same things the same way, so a
      // range that straddles the join adds up rather than jumping.
      const mySummaries = summarisedInRange
        .map(d => summaryByDateName[`${d}__${emp.name}`])
        .filter(Boolean)
      const fromSummary = mySummaries.reduce((a, s) => ({
        assigned:  a.assigned  + s.clientsAssigned,
        completed: a.completed + s.clientsCompleted,
        vehicles:  a.vehicles  + s.vehiclesAssigned,
        checked:   a.checked   + s.vehiclesChecked,
        alerts:    a.alerts    + s.alerts,
        misaligns: a.misaligns + s.misaligns,
        imported:  a.imported  + (s.source === 'imported' ? 1 : 0),
      }), { assigned:0, completed:0, vehicles:0, checked:0, alerts:0, misaligns:0, imported:0 })

      // And the day in progress, from the same plan every other screen reads.
      const live = livePlan?.byEmployee?.[emp.name]
      const assignedTotal  = rangeUpdates.length + fromSummary.assigned + (live?.clients ?? 0)
      const completedTotal = rangeCompletedUpdates.length + fromSummary.completed + (live?.clientsDone ?? 0)
      const rangePendingUpdates = Math.max(0, assignedTotal - completedTotal)

      const myFootage = footageRows.slice(1).filter(r => {
        const sub = (r[9] || '').toString().toLowerCase()
        const by  = (r[7] || '').toString().trim().toLowerCase()
        return sub.includes('customer request for video') && by === emp.name.toLowerCase()
      })
      const footagePending = myFootage.filter(r => (r[17]||'').toString().toLowerCase() !== 'yes').length
      const footageCompletedInRange = myFootage.filter(r => {
        const resolvedAt = (r[18]||'').toString()
        if ((r[17]||'').toString().toLowerCase() !== 'yes') return false
        return rangeDates.some(d => resolvedAt.includes(d))
      }).length

      return {
        name: emp.name,
        shiftStart: emp.start,
        shiftEnd: emp.end,
        isNight: emp.isNight,
        attendance,
        daysPresent,
        daysAbsent,
        totalDaysInRange: rangeDates.length,
        rangeClientsCount: rangeClients.length,
        rangeAssignedCount: assignedTotal,
        rangeUpdatesCount: completedTotal,
        rangePendingCount: rangePendingUpdates,
        // Vehicles due is a property of the schedule, not of a row somebody
        // saved, so it exists only for days that have been summarised.
        rangeVehiclesAssigned: fromSummary.vehicles + (live?.vehicles ?? 0),
        rangeVehiclesChecked: rangeUpdates.reduce((s,r)=>s+(parseInt(r[11])||0),0) + fromSummary.checked + (live?.vehiclesChecked ?? 0),
        rangeMisaligns: rangeUpdates.filter(r => r[6] && r[6] !== '—' && r[6] !== '').length + fromSummary.misaligns,
        rangeAlerts: rangeUpdates.reduce((s,r)=>s+(parseInt(r[7])||0),0) + fromSummary.alerts + (live?.alerts ?? 0),
        // How much of this range is history the platform did not record itself.
        daysFromHistory: fromSummary.imported,
        footagePending,
        footageCompletedInRange,
      }
    })

    // The months worked before the platform existed, alongside — never folded
    // into the range, because a month is a lump sum and cannot be cut into
    // days. See lib/history.js.
    let history = { periods: [], byEmployee: {}, totals: null }
    try { history = await getHistory() }
    catch (e) { console.error('history read failed:', e.message) }

    return res.status(200).json({ progress, dates: rangeDates, from: fromDDMMYYYY, to: toDDMMYYYY, history })

  } catch (err) {
    console.error('Employee progress error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
