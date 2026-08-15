import { getUserFromReq } from '../../../lib/auth'
import { readSheet, appendRow, updateRowCells, CRM_SHEET_ID, TABS, todayStr, nowStr } from '../../../lib/sheets'
import { getEmployeeShift, computeOTExtension } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'

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
    const emp = getEmployeeShift(user.name)
    if (!emp) return res.status(400).json({ error: 'Employee schedule not found' })

    const overrideRows = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_OVERRIDES}!A:H`)
    let overrideRowIndex = -1, existing = null
    for (let i = overrideRows.length - 1; i >= 1; i--) {
      if (overrideRows[i][0] === today && overrideRows[i][2] === user.name) { overrideRowIndex = i + 1; existing = overrideRows[i]; break }
    }

    if (existing && (existing[6]||'').toLowerCase() === 'yes') {
      return res.status(400).json({ error: 'Overtime has already been used today.' })
    }

    // Extend from today's current effective end (early-start-adjusted if
    // one exists) rather than always the static schedule.
    const currentStart = existing ? parseInt(existing[3]) : emp.start
    const currentEnd   = existing ? parseInt(existing[4]) : emp.end
    const ot = computeOTExtension(currentStart, currentEnd)

    if (overrideRowIndex === -1) {
      await appendRow(CRM_SHEET_ID, TABS.SHIFT_OVERRIDES, [
        today, user.empId, user.name, ot.start, ot.end, 'No', 'Yes', now,
      ])
    } else {
      await updateRowCells(CRM_SHEET_ID, TABS.SHIFT_OVERRIDES, overrideRowIndex, 4, [ot.start, ot.end, existing[5]||'No', 'Yes'])
    }

    return res.status(200).json({ success: true, newStart: ot.start, newEnd: ot.end })
  } catch (err) {
    console.error('OT error:', err)
    return res.status(500).json({ error: `OT failed: ${err.message || 'unknown error'}. If this keeps happening, make sure the 'Shift_Overrides' tab exists in the sheet with the exact columns Date, EmpId, Name, NewStart, NewEnd, UsedEarlyStart, UsedOT, UpdatedAt.` })
  }
}
