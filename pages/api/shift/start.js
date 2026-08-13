// pages/api/shift/start.js
import { getUserFromReq } from '../../../lib/auth'
import { appendRow, readSheet, updateRowCells, CRM_SHEET_ID, TABS, todayStr, nowStr, nowIST, findOpenShiftRow } from '../../../lib/sheets'
import { getEmployeeShift, computeShiftWindow } from '../../../lib/schedule'

function ddmmyyyyFromDate(d) {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()
    const now   = nowStr()
    const rows  = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_LOG}!A:H`)

    // Already clocked in? Checked across yesterday too, so a night shift
    // running past midnight isn't handed a second, duplicate shift row
    // when the calendar date rolls over.
    const yesterday = ddmmyyyyFromDate(new Date(nowIST().getTime() - 24*3600000))
    const open = findOpenShiftRow(rows, user.empId, [today, yesterday])
    if (open) {
      return res.status(200).json({ success: true, alreadyStarted: true, startTime: open.row[3], shiftDate: open.date })
    }

    // Safety net: close out any orphaned Active break left over from a
    // previous day (e.g. shift ended without End Shift being clicked).
    const breakRows = await readSheet(CRM_SHEET_ID, `${TABS.BREAKS}!A:G`)
    for (let i = breakRows.length - 1; i >= 1; i--) {
      const r = breakRows[i]
      if ((r[0] || '').toString().trim() === user.empId.toString().trim() && r[6] === 'Active' && r[2] !== today) {
        await updateRowCells(CRM_SHEET_ID, TABS.BREAKS, i + 1, 4, [r[3], 0, 'Completed'])
        break
      }
    }

    // Work out the window this arrival earns, server-side — never trust the
    // client, so the maths is right even if the confirm dialog was skipped.
    const emp = getEmployeeShift(user.name)
    const arrival = emp ? computeShiftWindow(emp, nowIST()) : null

    // Arriving EARLY pulls the shift forward, which means finishing earlier,
    // so it stays opt-in. Everything else — on time or late — is applied
    // automatically, including the extra hour owed for arriving past the
    // half hour.
    const isEarly    = !!arrival?.isEarly
    const earlyStart = isEarly && req.body?.confirmEarlyStart ? arrival : null
    const lateStart  = !isEarly && arrival && !arrival.unchanged ? arrival : null

    if (earlyStart || lateStart) {
      const adj = earlyStart || lateStart
      const overrideRows = await readSheet(CRM_SHEET_ID, `${TABS.SHIFT_OVERRIDES}!A:H`)
      let overrideRowIndex = -1
      for (let i = overrideRows.length - 1; i >= 1; i--) {
        if (overrideRows[i][0] === today && overrideRows[i][2] === user.name) { overrideRowIndex = i + 1; break }
      }
      // Record WHICH kind of adjustment this was. Both paths used to write
      // "Yes" into the Early Start column, so a late arrival showed up in
      // the admin's Full Day View tagged as an early start.
      const earlyFlag = earlyStart ? 'Yes' : 'No'
      if (overrideRowIndex === -1) {
        await appendRow(CRM_SHEET_ID, TABS.SHIFT_OVERRIDES, [
          today, user.empId, user.name, adj.start, adj.end, earlyFlag, 'No', now,
        ])
      } else {
        await updateRowCells(CRM_SHEET_ID, TABS.SHIFT_OVERRIDES, overrideRowIndex, 4, [adj.start, adj.end, earlyFlag])
      }
    }

    if (lateStart) {
      // Shorten (or fully cancel) the auto "Week Off" leave the no-show
      // sweep marked while this employee was absent — from their actual
      // arrival hour onward, they're working again.
      //
      // EVERY such row has to be shortened, not just the first one found.
      // The sweep can leave more than one behind (it decides whether to
      // mark someone from a cached read of the Leaves tab, so two polls
      // landing together both append a row), and stopping at the first
      // match left the other one covering the whole shift — the employee
      // came back, was still excluded from distribution for the rest of
      // the day, and silently received no clients at all.
      //
      // Matching on the "Week Off" prefix rather than the exact string
      // also makes this idempotent: a row already shortened to
      // "Week Off (returned)" is picked up again instead of being treated
      // as a different kind of leave and skipped.
      const leaveRows = await readSheet(CRM_SHEET_ID, `${TABS.LEAVES}!A:H`)
      for (let i = leaveRows.length - 1; i >= 1; i--) {
        const r = leaveRows[i]
        if (r[1] === user.name && r[2] === today && (r[5] || '').toString().startsWith('Week Off')) {
          await updateRowCells(CRM_SHEET_ID, TABS.LEAVES, i + 1, 5, [lateStart.start, 'Week Off (returned)'])
        }
      }
    }

    // Shift_Log always records the REAL clock-in time (attendance truth) —
    // the effective scheduling window lives separately in Shift_Overrides.
    await appendRow(CRM_SHEET_ID, TABS.SHIFT_LOG, [user.empId, user.name, today, now, '', '', 'Active', ''])
    return res.status(200).json({ success: true, startTime: now, shiftDate: today, earlyStart, lateStart })

  } catch (err) {
    console.error('Shift start error:', err)
    return res.status(500).json({ error: `Start shift failed: ${err.message || 'unknown error'}` })
  }
}
