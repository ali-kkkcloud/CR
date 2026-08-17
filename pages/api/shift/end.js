import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, readSheetCached, appendRow, appendRows, updateRowCells,
  CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr, yesterdayStr, nowStr, nowIST, calcDuration, calcDurationMinutes, parseISTDateTime,
  fetchClientVehicleCounts, getLeaveMapForDate, getShiftOverridesForDate, getOnShiftNamesFromLog, getClockedOutNamesFromLog,
  getAwayOnBreakNames, findOpenShiftRow
} from '../../../lib/sheets'
import { getScheduledEmployeesAtHour, computeCurrentHourRedistribution, distributeClientsForHour } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { buildHourPool, buildLockedAssignments } from '../../../lib/distribution'

const ISSUE_TAB = 'Issues- Realtime'

function ddmmyyyyFromDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const today       = todayStr()
    const now         = nowStr()
    const nowTime     = nowIST()
    const currentHour = nowTime.getHours()

    // ── 1. Update shift log ──
    // A night shift that began yesterday evening is still logged under
    // YESTERDAY's date once the clock passes midnight, so the open row has
    // to be looked for across both days — matching on today alone meant
    // ending such a shift silently failed to close it out, leaving the
    // employee "Active" forever.
    const yesterday = yesterdayStr()
    const shiftRows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 5000)
    const open = findOpenShiftRow(shiftRows, user.empId, [today, yesterday])
    const shiftRowIndex = open ? open.rowNumber : -1
    const startTimeStr  = open ? open.row[3] : ''
    const shiftDate     = open ? open.date : today
    const duration = startTimeStr ? calcDuration(shiftDate, startTimeStr, today, now) : '—'
    if (shiftRowIndex > 0) {
      await updateRowCells(CRM_SHEET_ID, TABS.SHIFT_LOG, shiftRowIndex, 5, [now, duration, 'Ended'])
    }

    // ── 1b. Auto-close any lingering Active break (including orphaned ones
    // from a previous day that were never resumed) — a shift ending should
    // never leave a break "ongoing" forever. ──
    const breakRows = await readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:G`, 5000)
    // Every open row is closed, not just the newest. An employee should only
    // ever have one break running, but two writers landing together can leave
    // a duplicate behind, and any row still marked Active would block the
    // next shift's breaks entirely.
    for (let i = breakRows.length - 1; i >= 1; i--) {
      const r = breakRows[i]
      if ((r[0] || '').toString().trim() !== user.empId.toString().trim()) continue
      if (r[6] !== 'Active') continue
      // A break belonging to this shift is measured properly, including one
      // that started before midnight on a night shift — calcDurationMinutes
      // works off the row's own date, so it reports 13 minutes rather than a
      // negative. Anything older is a genuine orphan from a shift that was
      // never closed out, so it is simply zeroed rather than credited.
      const belongsToThisShift = r[2] === today || r[2] === yesterday
      const minutes = belongsToThisShift ? calcDurationMinutes(r[2], r[3], today, now) : 0
      const endTimeToWrite = belongsToThisShift ? now : r[3]
      // Cols E=EndTime F=DurationMinutes G=Status. Writing from column D
      // instead overwrote StartTime and left Status on Active, so the break
      // was never actually closed — which then blocked every later break.
      await updateRowCells(CRM_SHEET_ID, TABS.BREAKS, i + 1, 5, [endTimeToWrite, minutes, 'Completed'])
    }

    // ── 2. Redistribute only THIS HOUR's unfilled clients ──
    const updateRows = await readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`, 5000)
    const leaveMap = await getLeaveMapForDate(today)
    const overridesMap = await getShiftOverridesForDate(today)
    // Hand the leftovers to people who are actually still clocked in —
    // handing them to whoever the roster lists just parks them with
    // someone who may never log in and never update them.
    const onShiftNames = getOnShiftNamesFromLog(shiftRows, [today, yesterday])
    // Away on a long break counts as not there. Handing the leaver's unfinished
    // clients to somebody who has been on an auto-break since the morning is
    // the same failure redistribution exists to prevent, one step removed.
    //
    // The leaver themselves is never "away" for this purpose: their own break
    // was closed a few lines above, and they have to stay in the pool for the
    // split below to work out what they are still holding.
    const awayNames = new Set(
      [...getAwayOnBreakNames(breakRows, [today, yesterday])].filter(n => n !== user.name)
    )
    const stillWorking = getScheduledEmployeesAtHour(currentHour, leaveMap, overridesMap)
      .map(e => e.name)
      .filter(n => n !== user.name && onShiftNames.has(n) && !awayNames.has(n))
    const vehicleMap = await fetchClientVehicleCounts()

    // What this employee is actually still holding, taken from the live
    // split rather than from their CRM_Updates rows.
    //
    // Those rows are append-only and keep a placeholder for every client the
    // employee held at any point in the hour — including ones handed on when
    // somebody else clocked in. Counting them meant an employee who had been
    // working alone and then shared the hour with two colleagues was reported
    // as handing over 51 clients on the way out when they were holding 11,
    // and the audit log grew by the same wrong number.
    const { poolNames } = buildHourPool({
      hour: currentHour, leaveMap, overridesMap, onShiftNames,
      clockedOutNames: getClockedOutNamesFromLog(shiftRows, [today, yesterday]),
      awayNames,
      alwaysInclude: user.name,
    })
    const locked = buildLockedAssignments(updateRows, shiftDate, currentHour)
    const dist = distributeClientsForHour(currentHour, poolNames, vehicleMap, locked, true)
    const unfilledClients = (dist[user.name] || [])
      .map(c => c.client)
      .filter(c => locked[c] !== user.name)   // already finished — stays theirs

    const redistribution = computeCurrentHourRedistribution(
      user.name, currentHour, unfilledClients, stillWorking, vehicleMap
    )

    // Audit trail only. The live split is recomputed from who is clocked
    // in (see /api/clients/current), so this employee dropping out of the
    // pool is what actually moves their unfinished clients across — no
    // placeholder rows are written here, since writing them would pin the
    // work to a name the recomputed split may not agree with.
    if (redistribution.length > 0) {
      const redistRows = redistribution.map(r => [
        shiftDate, now, r.fromEmployee, r.toEmployee, r.client, r.hour, 'Early End'
      ])
      await appendRows(CRM_SHEET_ID, TABS.REDISTRIB, redistRows)
    }

    // ── 3. CRM summary ──
    // Only rows carrying a real status count as work done. CRM_Updates also
    // holds a placeholder for every client that was ever on this employee's
    // board, so counting every row told somebody who had completed two
    // clients that they had handled thirty-four.
    const myUpdates = updateRows.slice(1)
      .filter(r => r[0] === shiftDate && r[2] === user.name)
      .filter(r => (r[5] || '').toString().trim())

    // ── 4. Footage summary ──
    // Issue Tracker layout: B=IssueId C=Client D=Vehicle E=RaisedAt H=RaisedBy
    // J=SubRequest K=Details R=Resolved(Y/N) S=ResolvedAt
    const footageRows = await readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, 90000)
    const myFootage = footageRows.slice(1).filter(r => {
      const sub = (r[9] || '').toString().toLowerCase()
      const by  = (r[7] || '').toString().trim().toLowerCase()
      return sub.includes('customer request for video') && by === user.name.toLowerCase()
    })
    const pendingFootageAll = myFootage.filter(r => (r[17] || '').toString().toLowerCase() !== 'yes')
    // Only surface what was raised during THIS shift (today, at/after
    // clock-in) — the hand-off prompt at shift end is about work created
    // during the shift, not every historical pending request ever raised.
    const shiftStartDate = parseISTDateTime(shiftDate, startTimeStr)
    const pendingFootage = pendingFootageAll.filter(r => {
      const raisedRaw = (r[4] || '').toString()
      if (!raisedRaw.includes(shiftDate)) return false
      if (!shiftStartDate) return true
      const timePart = raisedRaw.split(',').map(s => s.trim()).slice(1).join(' ') || raisedRaw
      const raisedAt = parseISTDateTime(shiftDate, timePart)
      return !raisedAt || raisedAt >= shiftStartDate
    })
    // A night shift closes out on the far side of midnight, so anything
    // resolved on either calendar day still belongs to this shift.
    const footageCompletedToday = myFootage.filter(r => {
      if ((r[17] || '').toString().toLowerCase() !== 'yes') return false
      const resolvedRaw = (r[18] || '').toString()
      return resolvedRaw.includes(shiftDate) || resolvedRaw.includes(today)
    }).length

    const report = {
      employee: user.name, date: shiftDate,
      shiftStart: startTimeStr, shiftEnd: now, duration,
      clientsHandled:  [...new Set(myUpdates.map(r => r[3]))].length,
      totalUpdates:    myUpdates.length,
      misalignCount:   myUpdates.filter(r => r[6] && r[6] !== '—' && r[6] !== '').length,
      alertTotal:      myUpdates.reduce((s, r) => s + (parseInt(r[7]) || 0), 0),
      fatigueCount:    myUpdates.filter(r => (r[8] || '').toLowerCase() === 'yes').length,
      redistributed:   redistribution.length,
      redistributedTo: redistribution.map(r => r.toEmployee),
      footageCompletedToday,
      footagePending: pendingFootage.length,
      pendingFootageItems: pendingFootage.map(r => ({
        issueId: r[1] || '', client: r[2] || '', vehicle: r[3] || '',
        raisedAt: r[4] || '', details: r[10] || '',
      })),
    }

    return res.status(200).json({ success: true, report })
  } catch (err) {
    console.error('Shift end error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
