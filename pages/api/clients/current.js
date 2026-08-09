import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, appendRow, appendRows, CRM_SHEET_ID, TABS, todayStr, nowStr, nowIST,
  fetchClientVehicleCounts, getLeaveMapForDate, getShiftOverridesForDate,
} from '../../../lib/sheets'
import { getClientsForEmployeeAtHour, getScheduledEmployeesAtHour, distributeClientsForHour, ALL_EMPLOYEES } from '../../../lib/schedule'

function ddmmyyyyFromDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// Whether an EFFECTIVE (possibly override-adjusted) start/end window wraps
// past midnight — derived from the actual hours, NOT the employee's static
// isNight flag. A day-shift employee whose Early/Late Start or OT pushes
// their window across midnight (e.g. 17:00-02:00) still needs wraparound
// handling even though their default schedule never crosses midnight.
function wrapsPastMidnight(start, end) { return end <= start }

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const hour  = nowIST().getHours()
    const today = todayStr()
    const now   = nowStr()
    const yesterday = ddmmyyyyFromDate(new Date(nowIST().getTime() - 24*3600000))

    // ── Leave map + Early Start/OT overrides — fetched for TODAY and
    // YESTERDAY and merged (today wins). This is what makes a night shift
    // that started yesterday evening still resolve correctly after
    // midnight, when the calendar date has already rolled over. ──
    const [leaveMapToday, leaveMapYesterday, overridesToday, overridesYesterday, updateRows, shiftLogRows] = await Promise.all([
      getLeaveMapForDate(today),
      getLeaveMapForDate(yesterday),
      getShiftOverridesForDate(today),
      getShiftOverridesForDate(yesterday),
      readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`),
      readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`),
    ])

    // ── Resolve MY operating "shift date" — the date my shift actually
    // started, which stays constant even after midnight rolls the
    // calendar date over. Falls back to today if I haven't started, or
    // started fresh today. ──
    let myShiftDate = today
    const myShiftRowsToday = shiftLogRows.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===today)
    const myShiftRowsYesterday = shiftLogRows.slice(1).filter(r => (r[0]||'').toString().trim()===user.empId.toString().trim() && r[2]===yesterday)
    if (myShiftRowsToday.length === 0 && myShiftRowsYesterday.some(r => r[6] === 'Active')) {
      myShiftDate = yesterday
    }
    const myLeaveMap = myShiftDate === yesterday ? leaveMapYesterday : leaveMapToday
    const myOverridesMap = myShiftDate === yesterday ? overridesYesterday : overridesToday

    // Merge everyone's leave/override maps (today takes priority, filled
    // in by yesterday for anyone not present today) — used for the sweep
    // and for scheduling, since OTHER employees may also be mid-night-shift.
    const leaveMap = { ...leaveMapYesterday, ...leaveMapToday }
    const overridesMap = { ...overridesYesterday, ...overridesToday }
    // My own entry always comes from MY resolved shift date specifically
    if (myLeaveMap[user.name]) leaveMap[user.name] = myLeaveMap[user.name]
    if (myOverridesMap[user.name]) overridesMap[user.name] = myOverridesMap[user.name]

    // ── No-show sweep: anyone who has missed their grace hour entirely
    // (no Shift_Log row at all today) gets auto-marked "Week Off" from the
    // hour after their scheduled start onward. Idempotent. ──
    const startedToday = new Set(shiftLogRows.slice(1).filter(r => r[2] === today).map(r => r[1]))
    const newLeaveRows = []
    ALL_EMPLOYEES.forEach(emp => {
      if (startedToday.has(emp.name)) return
      const already = (leaveMap[emp.name] || []).some(l => l.reason === 'Week Off')
      if (already) return
      const override = overridesMap[emp.name]
      const effStart = override ? override.start : emp.start
      const effEnd   = override ? override.end   : emp.end
      const isWrap = wrapsPastMidnight(effStart, effEnd)
      const hoursSinceStart = isWrap ? (hour - effStart + 24) % 24 : hour - effStart
      if (hoursSinceStart >= 1 && hoursSinceStart < 24) {
        const fromHour = (effStart + 1) % 24
        newLeaveRows.push([emp.empId || '', emp.name, today, fromHour, effEnd, 'Week Off', 'System', now])
        if (!leaveMap[emp.name]) leaveMap[emp.name] = []
        leaveMap[emp.name].push({ fromHour, toHour: effEnd, reason: 'Week Off' })
      }
    })
    if (newLeaveRows.length) await appendRows(CRM_SHEET_ID, TABS.LEAVES, newLeaveRows)

    // ── Scheduled employees for this hour (leave + override aware) ──
    const scheduledEmps = getScheduledEmployeesAtHour(hour, leaveMap, overridesMap)
    const scheduledNames = scheduledEmps.map(e => e.name)

    const vehicleMap = await fetchClientVehicleCounts()

    const existingForMeSet = new Set(
      updateRows.slice(1)
        .filter(r => r[0] === myShiftDate && r[2] === user.name && parseInt(r[4]) === hour)
        .map(r => r[3])
    )

    // ── Detect a genuine "join mid-hour" event (Early/Late Start) ──
    const myOverride = overridesMap[user.name]
    const isJoiningThisHour = !!myOverride && myOverride.start === hour && existingForMeSet.size === 0
      && scheduledNames.includes(user.name)

    let updateRowsFresh = updateRows

    if (isJoiningThisHour) {
      const priorScheduledNames = scheduledNames.filter(n => n !== user.name)

      const lockedAll = {}
      updateRows.slice(1)
        .filter(r => r[0] === myShiftDate && parseInt(r[4]) === hour)
        .forEach(r => { lockedAll[r[3]] = r[2] })

      const lockedFilledOnly = {}
      updateRows.slice(1)
        .filter(r => r[0] === myShiftDate && parseInt(r[4]) === hour && (r[5]||'').toString().trim())
        .forEach(r => { lockedFilledOnly[r[3]] = r[2] })

      const oldDist = distributeClientsForHour(hour, priorScheduledNames, vehicleMap, lockedAll)
      const newDist = distributeClientsForHour(hour, scheduledNames, vehicleMap, lockedFilledOnly)

      const redistRows = [], placeholderRows = []
      Object.entries(oldDist).forEach(([empName, clients]) => {
        clients.forEach(c => {
          if (lockedFilledOnly[c.client]) return
          let newOwner = null
          for (const [name, list] of Object.entries(newDist)) {
            if (list.some(x => x.client === c.client)) { newOwner = name; break }
          }
          if (!newOwner || newOwner === empName) return
          redistRows.push([myShiftDate, now, empName, newOwner, c.client, String(hour), 'Early Start Join'])
          const exists = updateRows.slice(1).some(r => r[0]===myShiftDate && r[2]===newOwner && r[3]===c.client && parseInt(r[4])===hour)
          if (!exists) placeholderRows.push([myShiftDate, now, newOwner, c.client, String(hour), '', '', '', 'No', '', ''])
        })
      })
      if (redistRows.length)      await appendRows(CRM_SHEET_ID, TABS.REDISTRIB, redistRows)
      if (placeholderRows.length) {
        await appendRows(CRM_SHEET_ID, TABS.CRM_UPDATES, placeholderRows)
        updateRowsFresh = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)
      }
    }

    // ── Redistribution_Log — away/to filtering ──
    const redistRowsAll = await readSheet(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`)
    const awayThisHour = redistRowsAll.slice(1)
      .filter(r => r[0] === myShiftDate && r[2] === user.name && parseInt(r[5]) === hour)
      .map(r => ({ client: r[4], toEmployee: r[3] }))
    const toMeThisHour = redistRowsAll.slice(1)
      .filter(r => r[0] === myShiftDate && r[3] === user.name && parseInt(r[5]) === hour)
      .map(r => ({ client: r[4], fromEmployee: r[2] }))

    // ── Locked assignments (already decided this hour) ──
    const lockedAssignments = {}
    updateRowsFresh.slice(1)
      .filter(r => r[0] === myShiftDate && parseInt(r[4]) === hour)
      .forEach(r => { lockedAssignments[r[3]] = r[2] })

    let clients = getClientsForEmployeeAtHour(user.name, hour, scheduledNames, vehicleMap, lockedAssignments)

    const awaySet = new Set(awayThisHour.map(a => a.client))
    clients = clients.filter(c => !awaySet.has(c.client))
    toMeThisHour.forEach(r => {
      if (!clients.some(c => c.client === r.client)) {
        clients.push({ client: r.client, vehicleCount: vehicleMap[(r.client||'').toLowerCase()]?.vehicleCount || 0, isRedistributed: true, fromEmployee: r.fromEmployee })
      }
    })

    // ── Write placeholder rows — always dated with MY shift date, so a
    // night shift's post-midnight hours stay attached to the day it
    // started, not the calendar day they literally occurred on. ──
    const existingForMeFreshSet = new Set(
      updateRowsFresh.slice(1)
        .filter(r => r[0] === myShiftDate && r[2] === user.name && parseInt(r[4]) === hour)
        .map(r => r[3])
    )
    const newRows = []
    clients.forEach(c => {
      if (c.isCustom) return
      if (!existingForMeFreshSet.has(c.client)) {
        newRows.push([myShiftDate, now, user.name, c.client, String(hour), '', '', '', 'No', '', ''])
      }
    })
    if (newRows.length > 0) await appendRows(CRM_SHEET_ID, TABS.CRM_UPDATES, newRows)

    // ── Build filled map ──
    const allMyRows = [
      ...updateRowsFresh.slice(1).filter(r => r[0] === myShiftDate && r[2] === user.name && parseInt(r[4]) === hour),
      ...newRows.map(r => r),
    ]
    const filled = {}
    allMyRows.forEach(r => {
      const hasRealData = !!(r[5] || '').toString().trim()
      filled[r[3]] = {
        status: r[5] || '', misalignVehicles: r[6] || '', alertCount: r[7] || '',
        fatigue: r[8] || '', fatigueCount: r[9] || '', notes: r[10] || '',
        updatedAt: hasRealData ? (r[1] || '') : '',
      }
    })

    return res.status(200).json({ hour, clients, filled, scheduledCount: scheduledNames.length, shiftDate: myShiftDate })

  } catch (err) {
    console.error('Clients fetch error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
