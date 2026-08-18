// pages/api/shift/start.js
import { getUserFromReq } from '../../../lib/auth'
import { appendRow, readSheet, readSheetCached, updateRowCells, invalidateSheetCache, CRM_SHEET_ID, TABS, todayStr, yesterdayStr, nowStr, nowIST, findOpenShiftRow } from '../../../lib/sheets'
import { getEmployeeShift, computeShiftWindow } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'

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

    const today = todayStr()
    const now   = nowStr()
    // Briefly cached. A shift change puts a dozen people through here inside
    // a minute, and an uncached read each was most of Google's per-minute
    // quota on its own. Clocking in appends to this tab, which drops the
    // cache, so the next person always reads the row the last one wrote.
    const rows  = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 5000)

    // Already clocked in? Checked across yesterday too, so a night shift
    // running past midnight isn't handed a second, duplicate shift row
    // when the calendar date rolls over.
    const yesterday = yesterdayStr()
    const open = findOpenShiftRow(rows, user.empId, [today, yesterday])
    if (open) {
      return res.status(200).json({ success: true, alreadyStarted: true, startTime: open.row[3], shiftDate: open.date })
    }

    // Safety net: close out every orphaned Active break before the new shift
    // begins (e.g. a shift that ended without End Shift being clicked).
    // Nobody can be on a break at the moment they clock in, so any row still
    // marked Active is stale — and leaving even one behind would put the
    // employee straight back behind the break overlay and stop the idle
    // check ever firing again for the whole shift.
    const breakRows = await readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:G`, 5000)
    for (let i = breakRows.length - 1; i >= 1; i--) {
      const r = breakRows[i]
      if ((r[0] || '').toString().trim() !== user.empId.toString().trim()) continue
      if (r[6] !== 'Active') continue
      // The real end time is unknowable — the shift it belonged to was never
      // closed — so it is zeroed rather than credited as break time.
      // Cols E=EndTime F=DurationMinutes G=Status. Writing from column D
      // instead put "Completed" in the duration cell and left Status on
      // Active, so the row was corrupted AND still counted as an open break.
      await updateRowCells(CRM_SHEET_ID, TABS.BREAKS, i + 1, 5, [r[3], 0, 'Completed'])
    }

    // Work out the window this arrival earns, server-side — never trust the
    // client, so the maths is right even if the confirm dialog was skipped.
    const emp = getEmployeeShift(user.name)
    const arrival = emp ? computeShiftWindow(emp, nowIST()) : null

    // One rule, whichever end of the roster you arrive at: the shift starts
    // at the hour you turned up, runs its usual length, and owes an extra
    // hour at the end if you arrived past the half hour.
    //
    // Arriving early used to be opt-in, on the reasoning that pulling the
    // shift forward also pulls the finish forward. That was the wrong call:
    // an employee who has logged in wants to work, and holding their board
    // empty until their rostered hour leaves them sitting idle with nothing
    // on screen — which is exactly what nobody would do. The choice is gone;
    // the window is applied and the employee is told what it now is.
    const isEarly    = !!arrival?.isEarly
    // Signed in after the shift was already over. No window is invented for
    // them — see computeShiftWindow — so nothing is written and they are told
    // plainly rather than being handed a phantom night shift.
    const tooLate    = !!arrival?.tooLate
    const adjusted   = arrival && !arrival.unchanged ? arrival : null
    const earlyStart = adjusted && isEarly  ? adjusted : null
    const lateStart  = adjusted && !isEarly ? adjusted : null

    if (earlyStart || lateStart) {
      const adj = earlyStart || lateStart
      const overrideRows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_OVERRIDES}!A:H`, 5000)
      let overrideRowIndex = -1
      for (let i = overrideRows.length - 1; i >= 1; i--) {
        if (overrideRows[i][0] === today && overrideRows[i][2] === user.name) { overrideRowIndex = i + 1; break }
      }
      // Record WHICH kind of adjustment this was. Both paths used to write
      // "Yes" into the Early Start column, so a late arrival showed up in
      // the admin's Full Day View tagged as an early start.
      const earlyFlag = earlyStart ? 'Yes' : 'No'
      if (overrideRowIndex === -1) {
        await appendRow(CRM_SHEET_ID, TABS.SHIFT_OVERRIDES, [
          today, user.empId, user.name, adj.start, adj.end, earlyFlag, 'No', now,
        ])
      } else {
        await updateRowCells(CRM_SHEET_ID, TABS.SHIFT_OVERRIDES, overrideRowIndex, 4, [adj.start, adj.end, earlyFlag])
      }
    }

    if (adjusted) {
      // Shorten (or fully cancel) the auto "Week Off" leave the no-show
      // sweep marked while this employee was absent — from their actual
      // arrival hour onward, they're working again.
      //
      // EVERY such row has to be shortened, not just the first one found.
      // The sweep can leave more than one behind (it decides whether to
      // mark someone from a cached read of the Leaves tab, so two polls
      // landing together both append a row), and stopping at the first
      // match left the other one covering the whole shift — the employee
      // came back, was still excluded from distribution for the rest of
      // the day, and silently received no clients at all.
      //
      // Matching on the "Week Off" prefix rather than the exact string
      // also makes this idempotent: a row already shortened to
      // "Week Off (returned)" is picked up again instead of being treated
      // as a different kind of leave and skipped.
      const leaveRows = await readSheetCached(CRM_SHEET_ID, `${TABS.LEAVES}!A:H`, 5000)
      for (let i = leaveRows.length - 1; i >= 1; i--) {
        const r = leaveRows[i]
        if (r[1] === user.name && r[2] === today && (r[5] || '').toString().startsWith('Week Off')) {
          await updateRowCells(CRM_SHEET_ID, TABS.LEAVES, i + 1, 5, [adjusted.start, 'Week Off (returned)'])
        }
      }
    }

    // Shift_Log always records the REAL clock-in time (attendance truth) —
    // the effective scheduling window lives separately in Shift_Overrides.
    await appendRow(CRM_SHEET_ID, TABS.SHIFT_LOG, [user.empId, user.name, today, now, '', '', 'Active', ''])
    // The board, the employee's own day and the Command Center all decide who
    // holds an hour from this tab. Dropping the cached copy means the very next
    // read sees this arrival instead of a snapshot taken seconds ago — which is
    // what lets the split include somebody the moment they start, without any
    // screen having to make an exception for the person looking at it.
    invalidateSheetCache(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!`)
    return res.status(200).json({
      success: true, startTime: now, shiftDate: today, earlyStart, lateStart,
      // Their attendance is recorded, but the shift they were rostered for has
      // already finished, so there is no work to give them.
      shiftAlreadyOver: tooLate,
      rosteredWindow: emp ? { start: emp.start, end: emp.end } : null,
    })

  } catch (err) {
    console.error('Shift start error:', err)
    return res.status(500).json({ error: `Start shift failed: ${err.message || 'unknown error'}` })
  }
}
