import { getUserFromReq } from '../../../lib/auth'
import {
  readSheet, appendRows, CRM_SHEET_ID, TABS, todayStr, nowStr, nowIST,
  fetchClientVehicleCounts, getLeaveMapForDate, getShiftOverridesForDate,
} from '../../../lib/sheets'
import { getClientsForEmployeeAtHour, getScheduledEmployeesAtHour, distributeClientsForHour } from '../../../lib/schedule'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const hour  = nowIST().getHours()
    const today = todayStr()
    const now   = nowStr()

    // ── Leave map + today's Early Start/OT overrides ──
    const [leaveMap, overridesMap, updateRows] = await Promise.all([
      getLeaveMapForDate(today),
      getShiftOverridesForDate(today),
      readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`),
    ])

    // ── Scheduled employees for this hour (leave + override aware) ──
    const scheduledEmps = getScheduledEmployeesAtHour(hour, leaveMap, overridesMap)
    const scheduledNames = scheduledEmps.map(e => e.name)

    const vehicleMap = await fetchClientVehicleCounts()

    const existingForMeSet = new Set(
      updateRows.slice(1)
        .filter(r => r[0] === today && r[2] === user.name && parseInt(r[4]) === hour)
        .map(r => r[3])
    )

    // ── Detect a genuine "join mid-hour" event: an Early Start override
    // that makes THIS hour the employee's very first scheduled hour, and
    // they don't have any client rows yet for it. One-time redistribution:
    // move only STILL-UNFILLED clients from the currently-scheduled group
    // to include the new joiner, logged the same way leave-redistribution
    // is (so my-day.js's existing redistFromMe/redistToMe logic picks it
    // up automatically — no client is double-counted).
    const myOverride = overridesMap[user.name]
    const isJoiningThisHour = !!myOverride && myOverride.start === hour && existingForMeSet.size === 0
      && scheduledNames.includes(user.name)

    let updateRowsFresh = updateRows

    if (isJoiningThisHour) {
      const priorScheduledNames = scheduledNames.filter(n => n !== user.name)

      // Who owns what right now (before the join) — every existing row locks its client.
      const lockedAll = {}
      updateRows.slice(1)
        .filter(r => r[0] === today && parseInt(r[4]) === hour)
        .forEach(r => { lockedAll[r[3]] = r[2] })

      // For the NEW (post-join) distribution, only FILLED clients stay
      // locked — unfilled ones are eligible to move to the joiner.
      const lockedFilledOnly = {}
      updateRows.slice(1)
        .filter(r => r[0] === today && parseInt(r[4]) === hour && (r[5]||'').toString().trim())
        .forEach(r => { lockedFilledOnly[r[3]] = r[2] })

      const oldDist = distributeClientsForHour(hour, priorScheduledNames, vehicleMap, lockedAll)
      const newDist = distributeClientsForHour(hour, scheduledNames, vehicleMap, lockedFilledOnly)

      const redistRows = [], placeholderRows = []
      Object.entries(oldDist).forEach(([empName, clients]) => {
        clients.forEach(c => {
          if (lockedFilledOnly[c.client]) return // already completed — never moves
          let newOwner = null
          for (const [name, list] of Object.entries(newDist)) {
            if (list.some(x => x.client === c.client)) { newOwner = name; break }
          }
          if (!newOwner || newOwner === empName) return
          redistRows.push([today, now, empName, newOwner, c.client, String(hour), 'Early Start Join'])
          const exists = updateRows.slice(1).some(r => r[0]===today && r[2]===newOwner && r[3]===c.client && parseInt(r[4])===hour)
          if (!exists) placeholderRows.push([today, now, newOwner, c.client, String(hour), '', '', '', 'No', '', ''])
        })
      })
      if (redistRows.length)      await appendRows(CRM_SHEET_ID, TABS.REDISTRIB, redistRows)
      if (placeholderRows.length) {
        await appendRows(CRM_SHEET_ID, TABS.CRM_UPDATES, placeholderRows)
        updateRowsFresh = await readSheet(CRM_SHEET_ID, `${TABS.CRM_UPDATES}!A:K`)
      }
    }

    // ── Redistribution_Log — away/to filtering (parity with my-day.js) ──
    const redistRowsAll = await readSheet(CRM_SHEET_ID, `${TABS.REDISTRIB}!A:G`)
    const awayThisHour = redistRowsAll.slice(1)
      .filter(r => r[0] === today && r[2] === user.name && parseInt(r[5]) === hour)
      .map(r => ({ client: r[4], toEmployee: r[3] }))
    const toMeThisHour = redistRowsAll.slice(1)
      .filter(r => r[0] === today && r[3] === user.name && parseInt(r[5]) === hour)
      .map(r => ({ client: r[4], fromEmployee: r[2] }))

    // ── Locked assignments (already decided this hour) ──
    const lockedAssignments = {}
    updateRowsFresh.slice(1)
      .filter(r => r[0] === today && parseInt(r[4]) === hour)
      .forEach(r => { lockedAssignments[r[3]] = r[2] })

    let clients = getClientsForEmployeeAtHour(user.name, hour, scheduledNames, vehicleMap, lockedAssignments)

    // Drop anything redistributed away from me this hour; add anything redistributed to me
    const awaySet = new Set(awayThisHour.map(a => a.client))
    clients = clients.filter(c => !awaySet.has(c.client))
    toMeThisHour.forEach(r => {
      if (!clients.some(c => c.client === r.client)) {
        clients.push({ client: r.client, vehicleCount: vehicleMap[(r.client||'').toLowerCase()]?.vehicleCount || 0, isRedistributed: true, fromEmployee: r.fromEmployee })
      }
    })

    // ── Write placeholder rows for newly assigned clients ──
    const existingForMeFreshSet = new Set(
      updateRowsFresh.slice(1)
        .filter(r => r[0] === today && r[2] === user.name && parseInt(r[4]) === hour)
        .map(r => r[3])
    )
    const newRows = []
    clients.forEach(c => {
      if (c.isCustom) return
      if (!existingForMeFreshSet.has(c.client)) {
        newRows.push([today, now, user.name, c.client, String(hour), '', '', '', 'No', '', ''])
      }
    })
    if (newRows.length > 0) await appendRows(CRM_SHEET_ID, TABS.CRM_UPDATES, newRows)

    // ── Build filled map ──
    const allMyRows = [
      ...updateRowsFresh.slice(1).filter(r => r[0] === today && r[2] === user.name && parseInt(r[4]) === hour),
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

    return res.status(200).json({ hour, clients, filled, scheduledCount: scheduledNames.length })

  } catch (err) {
    console.error('Clients fetch error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
