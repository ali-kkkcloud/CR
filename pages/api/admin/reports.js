// ══════════════════════════════════════════════════════════════════════
// The Daily_Summary tab, over any stretch of days, with the score
//
// Daily_Summary is the platform's own record of finished days: one row per
// employee per operating day, written by the rollup once a day has closed
// (see lib/rollup.js). It exists because CRM_Updates cannot be kept for ever —
// the detail is trimmed, the summary is the memory of it. Until now nothing
// on any screen read it back, so the record was being written and never
// looked at.
//
// This reads it for a date range and answers three questions at once:
//
//   · what the sheet holds, day by day, as it is written
//   · the same rows added up per employee for the period
//   · what each person's PERFORMANCE was over that period
//
// ── Why footage is read from the Issue Tracker rather than the summary ──
//
// Daily_Summary carries vehicles checked and break minutes, which is two of
// the three things a score is made of. It does not carry footage — that lives
// in the Issue Tracker, another team's book. Adding a column to a live sheet
// to hold a figure that is already recorded elsewhere would create a second
// copy of it, and a second copy is how two screens start disagreeing. So the
// requests are counted from the tracker at read time, by the same
// raisedOperatingDay rule every other screen uses, which also means rows
// already written last month get today's correct answer.
//
// ── The period score is an AVERAGE of days, not a re-run of the formula ──
//
// See averageScore in lib/score.js. Every part of the score is defined per
// day, so a month's totals through the same formula would be meaningless.
// ══════════════════════════════════════════════════════════════════════
import { getUserFromReq } from '../../../lib/auth'
import {
  readSheetCached, CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr, TTL,
} from '../../../lib/sheets'
import { loadScheduleData } from '../../../lib/roster'
import { employees } from '../../../lib/schedule'
import { parseSummaryRow, SUMMARY_HEADER } from '../../../lib/rollup'
import { averageScore } from '../../../lib/score'
import { COL, raisedOperatingDay, isFootageRequest } from '../../../lib/issues'

const ISSUE_TAB = 'Issues- Realtime'

const VALID = /^\d{2}\/\d{2}\/\d{4}$/

// dd/mm/yyyy → a sortable number, so a range can be compared without parsing
// a Date for every row of a month.
function ord(d) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || '')
  return m ? Number(m[3] + m[2] + m[1]) : 0
}

// Which bucket a day belongs to, for the day / week / month switch.
//
// The week runs Monday to Sunday and is LABELLED by its Monday, so a report
// straddling a month boundary still groups the week as a week rather than
// splitting it in two.
function bucketOf(date, granularity) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(date || '')
  if (!m) return { key: date, label: date }
  const [, dd, mm, yyyy] = m
  if (granularity === 'month') {
    return { key: `${yyyy}-${mm}`, label: monthLabel(Number(mm), yyyy) }
  }
  if (granularity === 'week') {
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
    // getDay(): 0 is Sunday, so Sunday steps back six days, not none.
    const back = (d.getDay() + 6) % 7
    d.setDate(d.getDate() - back)
    const p = n => String(n).padStart(2, '0')
    const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    const end = new Date(d); end.setDate(end.getDate() + 6)
    return { key, label: `${p(d.getDate())} ${MON[d.getMonth()]} – ${p(end.getDate())} ${MON[end.getMonth()]}` }
  }
  return { key: date, label: date }
}

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const monthLabel = (mm, yyyy) => `${MON[mm - 1]} ${yyyy}`

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    const today = todayStr()
    const from = (req.query.from || '').toString().trim() || today
    const to   = (req.query.to   || '').toString().trim() || today
    // A malformed date matches no rows and reports a floor of zeros, which
    // reads exactly like a terrible month. Refuse it instead.
    if (!VALID.test(from) || !VALID.test(to)) {
      return res.status(400).json({ error: 'Dates must be dd/mm/yyyy' })
    }
    const granularity = ['day', 'week', 'month'].includes((req.query.granularity || '').toString())
      ? req.query.granularity.toString() : 'day'

    // Handed over the wrong way round is a slip, not a reason to show nothing.
    const lo = Math.min(ord(from), ord(to))
    const hi = Math.max(ord(from), ord(to))
    const inRange = (d) => { const o = ord(d); return o >= lo && o <= hi }

    await loadScheduleData()

    // Both books at once — see the comment in dashboard/summary.js. The Issue
    // Tracker is a different spreadsheet, so it can never share a batch with
    // the CRM book, but it can certainly share the wait.
    const [summaryRows, footageRows] = await Promise.all([
      readSheetCached(CRM_SHEET_ID, `${TABS.DAILY_SUMMARY}!A:N`, TTL.ROSTER).catch(() => []),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, TTL.ISSUES).catch(() => null),
    ])

    // ── Footage per person per operating day ──────────────────────────
    const footageByDay = {}          // 'name|dd/mm/yyyy' -> count
    ;(footageRows || []).slice(1).forEach(r => {
      if (!isFootageRequest(r)) return
      const day = raisedOperatingDay(r[COL.RAISED_AT])
      if (!day || !inRange(day)) return
      const who = (r[COL.RAISED_BY] || '').toString().trim()
      if (!who) return
      const k = `${who.toLowerCase()}|${day}`
      footageByDay[k] = (footageByDay[k] || 0) + 1
    })

    // ── The summary rows themselves, for the days asked about ─────────
    const rows = (summaryRows || []).slice(1)
      .map(parseSummaryRow)
      .filter(r => r.date && r.name && inRange(r.date))

    // The roster's spelling wins where the two differ, so a name typed one
    // way last month and another way this month is one person. Anybody no
    // longer on the roster is KEPT — their days happened.
    const canonical = new Map(employees().map(e => [e.name.toLowerCase(), e.name]))
    const nameOf = (n) => canonical.get((n || '').toLowerCase()) || n

    // ── Per employee, per day ─────────────────────────────────────────
    const byEmployee = new Map()
    rows.forEach(r => {
      const name = nameOf(r.name)
      if (!byEmployee.has(name)) {
        byEmployee.set(name, { name, empId: r.empId, onRoster: canonical.has((r.name || '').toLowerCase()), days: [] })
      }
      const e = byEmployee.get(name)
      if (!e.empId && r.empId) e.empId = r.empId
      const footage = footageByDay[`${name.toLowerCase()}|${r.date}`] || 0
      e.days.push({ ...r, name, footage })
    })

    const sumOf = (days, pick) => days.reduce((s, d) => s + (pick(d) || 0), 0)

    const people = [...byEmployee.values()].map(e => {
      const days = e.days.slice().sort((a, b) => ord(a.date) - ord(b.date))
      // Only the days this person actually has a row for. A week off is not a
      // zero — it is a day that does not belong in the average.
      const { score, tier, breakdown } = averageScore(days.map(d => ({
        footageCount: d.footage,
        vehiclesSeen: d.vehiclesChecked,
        breakMinutes: d.breakMinutes,
      })))
      return {
        name: e.name, empId: e.empId, onRoster: e.onRoster,
        daysWorked: days.length,
        clientsAssigned:  sumOf(days, d => d.clientsAssigned),
        clientsCompleted: sumOf(days, d => d.clientsCompleted),
        vehiclesAssigned: sumOf(days, d => d.vehiclesAssigned),
        vehiclesChecked:  sumOf(days, d => d.vehiclesChecked),
        alerts:           sumOf(days, d => d.alerts),
        fatigue:          sumOf(days, d => d.fatigue),
        misaligns:        sumOf(days, d => d.misaligns),
        breakMinutes:     sumOf(days, d => d.breakMinutes),
        footage:          sumOf(days, d => d.footage),
        score, tier, scoreBreakdown: breakdown,
        // Every day that fed the figures above, so the screen can open one
        // person and show the working rather than asserting a total.
        days: days.map(d => ({
          date: d.date,
          clientsAssigned: d.clientsAssigned, clientsCompleted: d.clientsCompleted,
          vehiclesAssigned: d.vehiclesAssigned, vehiclesChecked: d.vehiclesChecked,
          alerts: d.alerts, fatigue: d.fatigue, misaligns: d.misaligns,
          shiftStart: d.shiftStart, shiftEnd: d.shiftEnd,
          breakMinutes: d.breakMinutes, footage: d.footage, source: d.source,
        })),
      }
    }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name))

    // ── The same days grouped for the chart ───────────────────────────
    //
    // Day / week / month changes how the period is CUT UP for reading, not
    // which days are in it. Each bucket's score is the average of the daily
    // scores inside it, for the same reason the per-person one is.
    const buckets = new Map()
    rows.forEach(r => {
      const b = bucketOf(r.date, granularity)
      if (!buckets.has(b.key)) buckets.set(b.key, { key: b.key, label: b.label, days: [], dates: new Set() })
      const bucket = buckets.get(b.key)
      bucket.dates.add(r.date)
      bucket.days.push({
        footageCount: footageByDay[`${nameOf(r.name).toLowerCase()}|${r.date}`] || 0,
        vehiclesSeen: r.vehiclesChecked,
        breakMinutes: r.breakMinutes,
        clientsAssigned: r.clientsAssigned, clientsCompleted: r.clientsCompleted,
        vehiclesChecked: r.vehiclesChecked, alerts: r.alerts, misaligns: r.misaligns,
      })
    })

    const series = [...buckets.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map(b => {
        const { score } = averageScore(b.days)
        return {
          key: b.key, label: b.label,
          dates: b.dates.size,
          entries: b.days.length,
          clientsAssigned:  sumOf(b.days, d => d.clientsAssigned),
          clientsCompleted: sumOf(b.days, d => d.clientsCompleted),
          vehiclesChecked:  sumOf(b.days, d => d.vehiclesChecked),
          footage:          sumOf(b.days, d => d.footageCount),
          alerts:           sumOf(b.days, d => d.alerts),
          misaligns:        sumOf(b.days, d => d.misaligns),
          score,
        }
      })

    // The floor's own average for the period, worked out over every
    // (person, day) in it — not an average of the per-person averages, which
    // would weigh somebody who worked two days the same as somebody who
    // worked twenty.
    const allDays = people.flatMap(p => p.days.map(d => ({
      footageCount: d.footage, vehiclesSeen: d.vehiclesChecked, breakMinutes: d.breakMinutes,
    })))
    const floorScore = averageScore(allDays)

    return res.status(200).json({
      from, to, granularity,
      // What the tab holds for these days, so the screen can say "nothing has
      // been summarised yet" rather than "everybody scored nothing".
      hasData: rows.length > 0,
      dates: [...new Set(rows.map(r => r.date))].sort((a, b) => ord(a) - ord(b)),
      columns: SUMMARY_HEADER,
      people,
      series,
      floor: {
        score: floorScore.score, tier: floorScore.tier,
        entries: rows.length,
        people: people.length,
        clientsAssigned:  sumOf(people, p => p.clientsAssigned),
        clientsCompleted: sumOf(people, p => p.clientsCompleted),
        // Both halves. "9,720 vehicles checked" on its own is a number with
        // nothing to lean on — against the fleet size that was actually on
        // the boards it becomes a proportion somebody can act on.
        vehiclesAssigned: sumOf(people, p => p.vehiclesAssigned),
        vehiclesChecked:  sumOf(people, p => p.vehiclesChecked),
        footage:          sumOf(people, p => p.footage),
        alerts:           sumOf(people, p => p.alerts),
        misaligns:        sumOf(people, p => p.misaligns),
        breakMinutes:     sumOf(people, p => p.breakMinutes),
      },
    })
  } catch (err) {
    console.error('Admin reports error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
