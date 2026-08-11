// pages/api/shift/status.js
import { getUserFromReq } from '../../../lib/auth'
import { readSheet, CRM_SHEET_ID, TABS, todayStr, nowIST, findOpenShiftRow } from '../../../lib/sheets'

function ddmmyyyyFromDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const yesterday = ddmmyyyyFromDate(new Date(nowIST().getTime() - 24*3600000))
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)

    // A night shift that began yesterday evening is still running after
    // midnight, but its row is filed under yesterday's date. Looking only
    // at today told everyone on nights their shift had not started — the
    // dashboard dropped into read-only mode mid-shift and offered them a
    // Start Shift button that would have opened a second, duplicate shift.
    const open = findOpenShiftRow(rows, user.empId, [today, yesterday])
    if (open) {
      return res.status(200).json({ status: 'active', startTime: open.row[3], shiftDate: open.date })
    }

    // No shift open — report today's most recent row so a finished shift
    // still reads as "ended" rather than "not started".
    let todayRow = null
    for (let i = rows.length - 1; i >= 1; i--) {
      const r = rows[i]
      if ((r[0] || '').toString().trim() === user.empId.toString().trim() && r[2] === today) {
        todayRow = r
        break
      }
    }
    if (todayRow && todayRow[6] === 'Ended') {
      return res.status(200).json({ status: 'ended', startTime: todayRow[3], endTime: todayRow[4], shiftDate: today })
    }
    return res.status(200).json({ status: 'not_started' })

  } catch (err) {
    console.error('Shift status error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
