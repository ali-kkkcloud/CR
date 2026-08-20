import { getUserFromReq } from '../../../lib/auth'
import { readSheetCached, updateRowCells, CRM_SHEET_ID, TABS, todayStr, nowStr, calcDurationMinutes, TTL } from '../../../lib/sheets'
import { recentDates, findOpenBreaks, recordHeartbeat } from '../../../lib/attendance'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const now   = nowStr()
    const rows  = await readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, TTL.LIVE)

    // Close EVERY open break, not just the newest one. Auto-breaks are
    // written from two places (the employee's own poll and the admin view),
    // so two requests landing together can leave a duplicate open row behind.
    // Closing them all means resuming always actually resumes, instead of the
    // employee clicking Resume and staying stuck behind the overlay.
    // Across both days: a break opened at 23:52 is still the one running at
    // 00:05, and matching on today alone would leave it open forever — which
    // would also stop the employee ever being put on another break.
    const open = findOpenBreaks(rows, user.empId, recentDates())
    // Nothing open is not a failure — it is the state Resume is trying to
    // reach. Answering 404 put "Server error" on the screen and left the
    // overlay up, so the one button that gets somebody back to work looked
    // broken at the exact moment it had nothing left to do.
    if (open.length === 0) return res.status(200).json({ success: true, endTime: now, minutes: 0 })

    let minutes = 0
    let closed = 0
    const failures = []
    for (const b of open) {
      // Measured from the row's own date, so a break that ran through
      // midnight reports its real length rather than a negative.
      const m = calcDurationMinutes(b.startDate, b.startTime, today, now)
      // Only the earliest open row carries the real duration; any duplicate
      // is closed at zero so the day's break total isn't counted twice.
      const isPrimary = b.rowIndex === open[open.length - 1].rowIndex
      // Cols E=EndTime F=DurationMinutes G=Status (1-indexed start col 5 = 'E')
      try {
        await updateRowCells(CRM_SHEET_ID, TABS.BREAKS, b.rowIndex, 5, [now, isPrimary ? m : 0, 'Completed'])
        closed++
        if (isPrimary) minutes = m
      } catch (e) {
        // One row that will not write must not strand the employee behind the
        // overlay. Whatever closed, closed.
        failures.push(`${b.startTime}: ${e.message}`)
      }
    }
    if (failures.length) console.error('Break end: some rows would not close —', failures.join('; '))
    if (closed === 0) return res.status(503).json({ error: 'The sheet is busy — press Resume again.', retryable: true })

    // ── Resuming IS activity ──────────────────────────────────────────────
    //
    // Pressing Resume is somebody saying, deliberately, that they are back at
    // their desk. Until now nothing recorded that: the heartbeat is skipped
    // while a break is open, on purpose, so the moment the break closed the
    // most recent activity on file was still whatever had happened BEFORE it.
    // That reads as a long silence, and the very next poll opened a fresh
    // automatic break backdated to before the one just ended.
    //
    // The employee could not get out. Resume, overlay back. Resume again,
    // overlay back. All night.
    try { await recordHeartbeat(user, 0) }
    catch (e) { console.error('Break end: heartbeat not recorded —', e.message) }

    return res.status(200).json({ success: true, endTime: now, minutes })
  } catch (err) {
    console.error('Break end error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
