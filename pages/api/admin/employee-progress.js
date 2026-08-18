import { getUserFromReq } from '../../../lib/auth'
import { readSheetCached, ISSUE_SHEET_ID, CRM_SHEET_ID, TABS, todayStr } from '../../../lib/sheets'
import { employees } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { collapseSlotOwners } from '../../../lib/distribution'

const ISSUE_TAB = 'Issues- Realtime'

function toISTDate(d) {
  return d.toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })
}

function parseDDMMYYYY(str) {
  const [d, m, y] = str.split('/').map(Number)
  return new Date(y, m - 1, d)
}

function dateRangeArray(fromStr, toStr) {
  const from = parseDDMMYYYY(fromStr)
  const to   = parseDDMMYYYY(toStr)
  const dates = []
  const cur = new Date(from)
  while (cur <= to) {
    dates.push(toISTDate(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return dates
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    // Roster and client hours come from the sheet; this makes sure this
    // request is working from the current ones.
    await loadScheduleData()

    const today = todayStr()
    let fromDate = req.query.from || ''
    let toDate   = req.query.to   || ''

    function isoToDDMMYYYY(iso) {
      if (!iso) return null
      const [y, m, d] = iso.split('-')
      return `${d}/${m}/${y}`
    }

    const fromDDMMYYYY = isoToDDMMYYYY(fromDate) || today
    const toDDMMYYYY   = isoToDDMMYYYY(toDate)   || today

    const rangeDates = dateRangeArray(fromDDMMYYYY, toDDMMYYYY)

    const [shiftRows, updateRows, footageRows] = await Promise.all([
      readSheetCached(CRM_SHEET_ID,   `${TABS.SHIFT_LOG}!A:H`, 15000),
      readSheetCached(CRM_SHEET_ID,   `${TABS.CRM_UPDATES}!A:L`, 15000),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, 90000),
    ])

    // One owner per (date, client, hour). CRM_Updates keeps a placeholder for
    // every name a client passed through, so counting rows per employee
    // credited the same slot to two or three people and showed each of them
    // pending work that somebody else had picked up.
    const rangeSetAll = new Set(rangeDates)
    const ownedSlots = [...collapseSlotOwners(updateRows, r => rangeSetAll.has(r[0])).values()]
    const rowsByOwner = {}
    ownedSlots.forEach(s => { (rowsByOwner[s.owner] ||= []).push(s.row) })

    const progress = employees().map(emp => {
      const attendance = rangeDates.map(date => {
        const rowsForDate = shiftRows.slice(1).filter(r => r[1] === emp.name && r[2] === date)
        if (rowsForDate.length === 0) {
          return { date, status: 'absent', startTime: '', endTime: '', duration: '' }
        }
        const latest = rowsForDate[rowsForDate.length - 1]
        return {
          date,
          status:    latest[6] === 'Active' ? 'active' : latest[6] === 'Ended' ? 'completed' : 'absent',
          startTime: latest[3] || '',
          endTime:   latest[4] || '',
          duration:  latest[5] || '',
        }
      })

      const daysPresent = attendance.filter(a => a.status !== 'absent').length
      const daysAbsent   = attendance.filter(a => a.status === 'absent').length

      const rangeUpdates = rowsByOwner[emp.name] || []
      const rangeClients = [...new Set(rangeUpdates.map(r => r[3]))]
      const rangeCompletedUpdates = rangeUpdates.filter(r => (r[5]||'').toString().trim())
      const rangePendingUpdates   = rangeUpdates.length - rangeCompletedUpdates.length

      const myFootage = footageRows.slice(1).filter(r => {
        const sub = (r[9] || '').toString().toLowerCase()
        const by  = (r[7] || '').toString().trim().toLowerCase()
        return sub.includes('customer request for video') && by === emp.name.toLowerCase()
      })
      const footagePending = myFootage.filter(r => (r[17]||'').toString().toLowerCase() !== 'yes').length
      const footageCompletedInRange = myFootage.filter(r => {
        const resolvedAt = (r[18]||'').toString()
        if ((r[17]||'').toString().toLowerCase() !== 'yes') return false
        return rangeDates.some(d => resolvedAt.includes(d))
      }).length

      return {
        name: emp.name,
        shiftStart: emp.start,
        shiftEnd: emp.end,
        isNight: emp.isNight,
        attendance,
        daysPresent,
        daysAbsent,
        totalDaysInRange: rangeDates.length,
        rangeClientsCount: rangeClients.length,
        rangeAssignedCount: rangeUpdates.length,
        rangeUpdatesCount: rangeCompletedUpdates.length,
        rangePendingCount: rangePendingUpdates,
        rangeMisaligns: rangeUpdates.filter(r => r[6] && r[6] !== '—' && r[6] !== '').length,
        rangeAlerts: rangeUpdates.reduce((s,r)=>s+(parseInt(r[7])||0),0),
        footagePending,
        footageCompletedInRange,
      }
    })

    return res.status(200).json({ progress, dates: rangeDates, from: fromDDMMYYYY, to: toDDMMYYYY })

  } catch (err) {
    console.error('Employee progress error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
