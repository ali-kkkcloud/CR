import { getUserFromReq } from '../../../lib/auth'
import { readSheet, appendRow, updateRowCells, CRM_SHEET_ID, TABS, todayStr, nowStr, nowIST } from '../../../lib/sheets'

function ddmmyyyyFromDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error:'Unauthorized' })
  try {
    const { client, slot, status, misalignVehicles, alertCount, fatigue, fatigueCount, notes } = req.body
    const today = todayStr(), now = nowStr(), hour = nowIST().getHours()
    const yesterday = ddmmyyyyFromDate(new Date(nowIST().getTime() - 24*3600000))

    // Every row this employee's shift produces is stamped with the date the
    // shift STARTED (see /api/clients/current), so a night shift's
    // post-midnight hours stay attached to the day it began. Saving under
    // today's date instead would write a row the reader never looks at:
    // the update would appear to vanish, the slot would still read as
    // unfilled, and a duplicate row would pile up on every save.
    const shiftLogRows = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)
    const mine = shiftLogRows.slice(1).filter(r => (r[0]||'').toString().trim() === user.empId.toString().trim())
    const startedToday    = mine.some(r => r[2] === today)
    const activeYesterday = mine.some(r => r[2] === yesterday && r[6] === 'Active')
    const shiftDate = (!startedToday && activeYesterday) ? yesterday : today

    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)
    let existingRowIndex = -1
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0]===shiftDate && rows[i][2]===user.name && rows[i][3]===client && rows[i][4]===String(slot??hour)) {
        existingRowIndex = i+1; break
      }
    }
    const rowData = [
      shiftDate, now, user.name, client, String(slot??hour),
      status||'', misalignVehicles||'',
      String(alertCount||0),
      fatigue||'No',
      String(fatigueCount||0),
      notes||'',
    ]
    if (existingRowIndex > 0) await updateRowCells(CRM_SHEET_ID, TABS.CRM_UPDATES, existingRowIndex, 1, rowData)
    else await appendRow(CRM_SHEET_ID, TABS.CRM_UPDATES, rowData)
    return res.status(200).json({ success:true, updatedAt: now, shiftDate })
  } catch(err) {
    console.error(err)
    return res.status(500).json({ error:'Server error' })
  }
}
