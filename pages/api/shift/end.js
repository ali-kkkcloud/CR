import { getUserFromReq } from '../../../lib/auth'
import { readSheet, appendRow, updateRowCells, CRM_SHEET_ID, TABS, todayStr, nowStr, nowIST } from '../../../lib/sheets'
import { redistributeClients, getActiveEmployeesAtHour } from '../../../lib/schedule'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const today = todayStr(), now = nowStr(), nowTime = nowIST()
    const currentHour = nowTime.getHours()
    const shiftRows = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)
    let shiftRowIndex = -1, startTimeStr = ''
    for (let i = 1; i < shiftRows.length; i++) {
      if (shiftRows[i][0]===user.empId && shiftRows[i][2]===today && shiftRows[i][6]==='Active') {
        shiftRowIndex = i+1; startTimeStr = shiftRows[i][3]; break
      }
    }
    let duration = ''
    if (startTimeStr) {
      const diffMs = nowTime - new Date(`${today} ${startTimeStr}`)
      duration = `${Math.floor(diffMs/3600000)}h ${Math.floor((diffMs%3600000)/60000)}m`
    }
    if (shiftRowIndex > 0) await updateRowCells(CRM_SHEET_ID, TABS.SHIFT_LOG, shiftRowIndex, 5, [now, duration, 'Ended'])
    const activeEmps = getActiveEmployeesAtHour(currentHour, [], user.name)
    const redistribution = redistributeClients(user.name, currentHour, activeEmps)
    for (const r of redistribution) {
      await appendRow(CRM_SHEET_ID, TABS.REDISTRIB, [today, now, user.name, r.toEmployee, r.client, r.hour, 'Auto - Early End'])
    }
    const updateRows = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)
    const myUpdates  = updateRows.slice(1).filter(r => r[0]===today && r[2]===user.name)
    const report = {
      employee: user.name, date: today, shiftStart: startTimeStr, shiftEnd: now, duration,
      clientsHandled: [...new Set(myUpdates.map(r=>r[3]))].length,
      totalUpdates:   myUpdates.length,
      misalignCount:  myUpdates.filter(r=>r[6]&&r[6]!=='—').length,
      alertTotal:     myUpdates.reduce((s,r)=>s+(parseInt(r[7])||0),0),
      fatigueCount:   myUpdates.filter(r=>(r[8]||'').toLowerCase()==='yes').length,
      redistributed:  redistribution.length,
      redistributedTo: redistribution.map(r=>r.toEmployee),
      updates: myUpdates,
    }
    return res.status(200).json({ success: true, report })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Server error' })
  }
}
