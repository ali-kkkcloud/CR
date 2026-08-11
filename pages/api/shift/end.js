import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, appendRow, appendRows, updateRowCells,
  CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr, nowStr, nowIST, calcDuration, calcDurationMinutes, parseISTDateTime,
  fetchClientVehicleCounts, getLeaveMapForDate, getShiftOverridesForDate, getOnShiftNamesFromLog
} from '../../../lib/sheets'
import { getScheduledEmployeesAtHour, computeCurrentHourRedistribution } from '../../../lib/schedule'

const ISSUE_TAB = 'Issues- Realtime'

function ddmmyyyyFromDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
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
    const yesterday = ddmmyyyyFromDate(new Date(nowTime.getTime() - 24*3600000))
    const shiftRows = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)
    let shiftRowIndex = -1, startTimeStr = '', shiftDate = today
    for (let i = shiftRows.length - 1; i >= 1; i--) {
      const r = shiftRows[i]
      if ((r[0] || '').toString().trim() === user.empId.toString().trim()
          && (r[2] === today || r[2] === yesterday) && r[6] === 'Active') {
        shiftRowIndex = i + 1; startTimeStr = r[3]; shiftDate = r[2]; break
      }
    }
    const duration = startTimeStr ? calcDuration(shiftDate, startTimeStr, today, now) : '—'
    if (shiftRowIndex > 0) {
      await updateRowCells(CRM_SHEET_ID, TABS.SHIFT_LOG, shiftRowIndex, 5, [now, duration, 'Ended'])
    }

    // ── 1b. Auto-close any lingering Active break (including orphaned ones
    // from a previous day that were never resumed) — a shift ending should
    // never leave a break "ongoing" forever. ──
    const breakRows = await readSheet(CRM_SHEET_ID, `${TABS.BREAKS}!A:G`)
    for (let i = breakRows.length - 1; i >= 1; i--) {
      const r = breakRows[i]
      if ((r[0] || '').toString().trim() === user.empId.toString().trim() && r[6] === 'Active') {
        const isFromToday = r[2] === today
        const minutes = isFromToday ? calcDurationMinutes(r[2], r[3], today, now) : 0
        const endTimeToWrite = isFromToday ? now : r[3] // orphaned from a prior day — can't know real end, just close it out
        await updateRowCells(CRM_SHEET_ID, TABS.BREAKS, i + 1, 4, [endTimeToWrite, minutes, 'Completed'])
        break // an employee should only ever have one Active break at a time
      }
    }

    // ── 2. Redistribute only THIS HOUR's unfilled clients ──
    const updateRows = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)
    const myHourRows = updateRows.slice(1)
      .filter(r => r[0] === shiftDate && r[2] === user.name && parseInt(r[4]) === currentHour)
    const unfilledClients = myHourRows
      .filter(r => !(r[5] || '').toString().trim())
      .map(r => r[3])

    const leaveMap = await getLeaveMapForDate(today)
    const overridesMap = await getShiftOverridesForDate(today)
    // Hand the leftovers to people who are actually still clocked in —
    // handing them to whoever the roster lists just parks them with
    // someone who may never log in and never update them.
    const onShiftNames = getOnShiftNamesFromLog(shiftRows, [today, yesterday])
    const stillWorking = getScheduledEmployeesAtHour(currentHour, leaveMap, overridesMap)
      .map(e => e.name)
      .filter(n => n !== user.name && onShiftNames.has(n))
    const vehicleMap = await fetchClientVehicleCounts()

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
    const myUpdates = updateRows.slice(1).filter(r => r[0] === shiftDate && r[2] === user.name)

    // ── 4. Footage summary ──
    // Issue Tracker layout: B=IssueId C=Client D=Vehicle E=RaisedAt H=RaisedBy
    // J=SubRequest K=Details R=Resolved(Y/N) S=ResolvedAt
    const footageRows = await readSheet(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`)
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
