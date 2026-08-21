import { getUserFromReq } from '../../../lib/auth'
import { readSheetCached, appendRow, updateRowCells, CRM_SHEET_ID, TABS, todayStr, yesterdayStr, nowStr, nowIST, TTL } from '../../../lib/sheets'

function ddmmyyyyFromDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error:'Unauthorized' })
  try {
    const { client, slot, status, misalignVehicles, alertCount, fatigue, fatigueCount, notes, liveVehicles } = req.body
    const today = todayStr(), now = nowStr(), hour = nowIST().getHours()
    const yesterday = yesterdayStr()

    // Every row this employee's shift produces is stamped with the date the
    // shift STARTED (see /api/clients/current), so a night shift's
    // post-midnight hours stay attached to the day it began. Saving under
    // today's date instead would write a row the reader never looks at:
    // the update would appear to vanish, the slot would still read as
    // unfilled, and a duplicate row would pile up on every save.
    // Both reads are briefly cached, and every save invalidates the tab it
    // writes to — so an employee's own previous save is always visible here
    // and a duplicate row can't slip through. What it stops is twenty-odd
    // people each spending two fresh reads per update through a busy hour.
    // Cached for a minute, not five seconds. This read only answers "which
    // operating day does this employee's shift belong to", and that cannot
    // change while they are working — but at five seconds it was a fresh read
    // of the whole attendance tab on almost every save. Thirty people saving
    // through a busy hour spent the shared read quota on a question with the
    // same answer every time, and then the SAVES started failing.
    const shiftLogRows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE)
    const mine = shiftLogRows.slice(1).filter(r => (r[0]||'').toString().trim() === user.empId.toString().trim())
    const startedToday    = mine.some(r => r[2] === today)
    const activeYesterday = mine.some(r => r[2] === yesterday && r[6] === 'Active')
    const shiftDate = (!startedToday && activeYesterday) ? yesterday : today

    // Likewise. Every save invalidates this tab's cache in the process that
    // made it, so an employee always sees their own previous save; the longer
    // window only saves re-reading the whole tab for somebody else's.
    const rows  = await readSheetCached(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:L`, TTL.LIVE)
    // If the same slot somehow has more than one row (two polls can each
    // append a placeholder), always edit the one that already holds data —
    // otherwise a second save would land on the blank twin and the earlier
    // update would be stranded on a row nothing reads back.
    let existingRowIndex = -1
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i]
      if (r[0]===shiftDate && r[2]===user.name && r[3]===client && r[4]===String(slot??hour)) {
        if ((r[5] || '').toString().trim()) { existingRowIndex = i+1; break }
        if (existingRowIndex === -1) existingRowIndex = i+1
      }
    }
    const rowData = [
      shiftDate, now, user.name, client, String(slot??hour),
      status||'', misalignVehicles||'',
      String(alertCount||0),
      fatigue||'No',
      String(fatigueCount||0),
      notes||'',
      // How many of the client's vehicles the employee actually watched this
      // hour. The client's fleet size is what it is; this is what was seen.
      String(liveVehicles ?? ''),
    ]
    // Applied to the cached copy of the tab rather than throwing the whole
    // tab away. This is the busiest write on the platform — a floor of
    // eighteen saves a client every few seconds — and dropping a 3,700-row
    // tab on each one meant the next save, and every dashboard poll behind
    // it, had to fetch all of it back from Google. See patchCachedRows.
    const cachedRange = `${TABS.CRM_UPDATES}!A:L`
    if (existingRowIndex > 0) await updateRowCells(CRM_SHEET_ID, TABS.CRM_UPDATES, existingRowIndex, 1, rowData, { cachedRange })
    else await appendRow(CRM_SHEET_ID, TABS.CRM_UPDATES, rowData, { cachedRange })
    return res.status(200).json({ success:true, updatedAt: now, shiftDate })
  } catch(err) {
    console.error('crm/update failed:', err?.message || err)
    // Tell the difference between "the spreadsheet is busy, this is worth
    // trying again" and "something is actually wrong". The first is what an
    // employee hits at the top of the hour when thirty people save at once,
    // and it must not read like their work was rejected.
    const code = err?.code ?? err?.response?.status
    const msg  = (err?.message || '').toLowerCase()
    const busy = code === 429 || code === 503 ||
                 msg.includes('quota') || msg.includes('rate limit') || msg.includes('try again later')
    if (busy) {
      return res.status(503).json({
        error: 'The spreadsheet is busy right now — your work has not been lost, try Save again in a moment.',
        retryable: true,
      })
    }
    return res.status(500).json({ error: 'Could not save. Your work is still on screen — try again.' })
  }
}
