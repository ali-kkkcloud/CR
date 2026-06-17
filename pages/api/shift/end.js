import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, appendRow, updateRowCells,
  CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr, nowStr, nowIST, calcDuration,
  fetchClientVehicleCounts
} from '../../../lib/sheets'
import { computeRedistributionLog } from '../../../lib/schedule'

const ISSUE_TAB = 'Issues- Realtime'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today   = todayStr()
    const now     = nowStr()
    const nowTime = nowIST()
    const currentHour = nowTime.getHours()

    const shiftRows = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)
    let shiftRowIndex = -1, startTimeStr = ''
    for (let i = shiftRows.length - 1; i >= 1; i--) {
      if (shiftRows[i][0] === user.empId && shiftRows[i][2] === today && shiftRows[i][6] === 'Active') {
        shiftRowIndex = i + 1
        startTimeStr  = shiftRows[i][3]
        break
      }
    }
    const duration = startTimeStr ? calcDuration(today, startTimeStr, today, now) : '—'
    if (shiftRowIndex > 0) {
      await updateRowCells(CRM_SHEET_ID, TABS.SHIFT_LOG, shiftRowIndex, 5, [now, duration, 'Ended'])
    }

    const activeMap = {}
    for (let i = 1; i < shiftRows.length; i++) {
      const r = shiftRows[i]
      if (r[2] === today) activeMap[r[1]] = r[6]
    }
    activeMap[user.name] = 'Ended'
    const remainingActive = Object.entries(activeMap)
      .filter(([name, status]) => status === 'Active' && name !== user.name)
      .map(([name]) => name)

    const vehicleMap = await fetchClientVehicleCounts()
    const redistribution = computeRedistributionLog(user.name, currentHour, remainingActive, vehicleMap)

    for (const r of redistribution) {
      await appendRow(CRM_SHEET_ID, TABS.REDISTRIB, [today, now, user.name, r.toEmployee, r.client, r.hour, 'Auto - Early End'])
    }

    const updateRows = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)
    const myUpdates  = updateRows.slice(1).filter(r => r[0] === today && r[2] === user.name)

    const footageRows = await readSheet(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:S`)
    const myFootage = footageRows.slice(1).filter(r => {
      const sub = (r[5]  || '').toString().toLowerCase()
      const by  = (r[10] || '').toString().trim().toLowerCase()
      return sub.includes('customer request for video') && by === user.name.toLowerCase()
    })
    const footageCompletedToday = myFootage.filter(r => {
      const resolvedAt = (r[14] || '').toString()
      return (r[13] || '').toString().toLowerCase() === 'yes' && resolvedAt.includes(today)
    }).length
    const footagePending = myFootage.filter(r => (r[13] || '').toString().toLowerCase() !== 'yes').length

    const report = {
      employee:       user.name,
      date:           today,
      shiftStart:     startTimeStr,
      shiftEnd:       now,
      duration,
      clientsHandled: [...new Set(myUpdates.map(r => r[3]))].length,
      totalUpdates:   myUpdates.length,
      misalignCount:  myUpdates.filter(r => r[6] && r[6] !== '—' && r[6] !== '').length,
      alertTotal:     myUpdates.reduce((s, r) => s + (parseInt(r[7]) || 0), 0),
      fatigueCount:   myUpdates.filter(r => (r[8] || '').toLowerCase() === 'yes').length,
      fatigueTotal:   myUpdates.reduce((s, r) => s + (parseInt(r[9]) || 0), 0),
      redistributed:    redistribution.length,
      redistributedTo:  redistribution.map(r => r.toEmployee),
      footageCompletedToday,
      footagePending,
    }

    return res.status(200).json({ success: true, report })

  } catch (err) {
    console.error('Shift end error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
