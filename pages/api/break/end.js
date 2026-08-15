import { getUserFromReq } from '../../../lib/auth'
import { readSheet, updateRowCells, CRM_SHEET_ID, TABS, todayStr, nowStr, calcDurationMinutes } from '../../../lib/sheets'
import { recentDates, findOpenBreaks } from '../../../lib/attendance'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const now   = nowStr()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`)

    // Close EVERY open break, not just the newest one. Auto-breaks are
    // written from two places (the employee's own poll and the admin view),
    // so two requests landing together can leave a duplicate open row behind.
    // Closing them all means resuming always actually resumes, instead of the
    // employee clicking Resume and staying stuck behind the overlay.
    // Across both days: a break opened at 23:52 is still the one running at
    // 00:05, and matching on today alone would leave it open forever — which
    // would also stop the employee ever being put on another break.
    const open = findOpenBreaks(rows, user.empId, recentDates())
    if (open.length === 0) return res.status(404).json({ error: 'No active break found' })

    let minutes = 0
    for (const b of open) {
      // Measured from the row's own date, so a break that ran through
      // midnight reports its real length rather than a negative.
      const m = calcDurationMinutes(b.startDate, b.startTime, today, now)
      // Only the earliest open row carries the real duration; any duplicate
      // is closed at zero so the day's break total isn't counted twice.
      const isPrimary = b.rowIndex === open[open.length - 1].rowIndex
      if (isPrimary) minutes = m
      // Cols E=EndTime F=DurationMinutes G=Status (1-indexed start col 5 = 'E')
      await updateRowCells(CRM_SHEET_ID, TABS.BREAKS, b.rowIndex, 5, [now, isPrimary ? m : 0, 'Completed'])
    }

    return res.status(200).json({ success: true, endTime: now, minutes })
  } catch (err) {
    console.error('Break end error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
