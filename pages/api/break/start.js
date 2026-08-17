import { getUserFromReq } from '../../../lib/auth'
import {
  appendRow, readSheetCached, CRM_SHEET_ID, TABS, todayStr, nowStr, nowIST,
  findOpenShiftRow, getShiftOverridesForDate,
} from '../../../lib/sheets'
import { recentDates, findOpenBreaks, shiftEndMoment } from '../../../lib/attendance'
import { loadScheduleData } from '../../../lib/roster'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const now   = nowStr()
    const rows  = await readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, 5000)

    // Don't allow two overlapping breaks. Searched across both days, since a
    // break opened at 23:52 is still the one running at 00:05 — matching on
    // today alone would open a second row alongside it.
    const open = findOpenBreaks(rows, user.empId, recentDates())
    if (open.length > 0) {
      return res.status(200).json({ success: true, alreadyOnBreak: true, startTime: open[0].startTime, startDate: open[0].startDate, isAuto: open[0].isAuto })
    }

    // Not once the shift window has closed.
    //
    // Nothing stopped this before, and the result was baffling: the break was
    // written, the overlay appeared, and twenty seconds later the closure rule
    // — which settles any break still open past the end of its shift — closed
    // it again underneath the employee. Pressing a button and having it
    // silently undo itself is worse than being told no.
    try {
      await loadScheduleData()
      const dates = recentDates()
      const shiftRows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, 5000)
      const open = findOpenShiftRow(shiftRows, user.empId, dates)
      if (open) {
        const overridesMap = await getShiftOverridesForDate(open.date)
        const endMs = shiftEndMoment(user.name, open.date, open.row[3], overridesMap)
        if (endMs != null && nowIST().getTime() >= endMs) {
          return res.status(409).json({
            error: 'Your shift window has already ended — end your shift rather than starting a break.',
          })
        }
      }
    } catch (e) {
      // A guard, not the point of the request. If the roster can't be read,
      // let the break through rather than blocking somebody mid-shift.
      console.error('break/start: shift-window check skipped —', e.message)
    }

    // Cols: EmpId | Name | Date | StartTime | EndTime | DurationMinutes | Status | Type
    await appendRow(CRM_SHEET_ID, TABS.BREAKS, [user.empId, user.name, today, now, '', '', 'Active', 'Manual'])
    // startDate travels with it: the overlay's timer is measured against the
    // day the break began, which for a night shift is not today.
    return res.status(200).json({ success: true, startTime: now, startDate: today, isAuto: false })
  } catch (err) {
    console.error('Break start error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
