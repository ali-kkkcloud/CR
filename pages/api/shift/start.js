// pages/api/shift/start.js
import { getUserFromReq } from '../../../lib/auth'
import { appendRow, readSheet, updateRowCells, CRM_SHEET_ID, TABS, todayStr, nowStr } from '../../../lib/sheets'
import { getEmployeeShift, computeEarlyStart } from '../../../lib/schedule'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const now   = nowStr()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)

    // Check most recent row for this employee+today
    let latestRow = null
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i]
      if ((r[0] || '').toString().trim() === user.empId.toString().trim() && r[2] === today) {
        latestRow = r
        break
      }
    }

    if (latestRow && latestRow[6] === 'Active') {
      return res.status(200).json({ success: true, alreadyStarted: true, startTime: latestRow[3] })
    }

    // Recompute Early Start server-side (never trust the client) so
    // scheduling stays correct even if the confirm dialog was skipped.
    const emp = getEmployeeShift(user.name)
    let earlyStart = null
    if (emp && req.body?.confirmEarlyStart) {
      earlyStart = computeEarlyStart(emp, new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })))
    }

    if (earlyStart) {
      const overrideRows = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_OVERRIDES}!A:H`)
      let overrideRowIndex = -1
      for (let i = overrideRows.length - 1; i >= 1; i--) {
        if (overrideRows[i][0] === today && overrideRows[i][2] === user.name) { overrideRowIndex = i + 1; break }
      }
      if (overrideRowIndex === -1) {
        await appendRow(CRM_SHEET_ID, TABS.SHIFT_OVERRIDES, [
          today, user.empId, user.name, earlyStart.start, earlyStart.end, 'Yes', 'No', now,
        ])
      } else {
        await updateRowCells(CRM_SHEET_ID, TABS.SHIFT_OVERRIDES, overrideRowIndex, 4, [earlyStart.start, earlyStart.end, 'Yes'])
      }
    }

    // Shift_Log always records the REAL clock-in time (attendance truth) —
    // the effective scheduling window lives separately in Shift_Overrides.
    await appendRow(CRM_SHEET_ID, TABS.SHIFT_LOG, [user.empId, user.name, today, now, '', '', 'Active', ''])
    return res.status(200).json({ success: true, startTime: now, earlyStart })

  } catch (err) {
    console.error('Shift start error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
