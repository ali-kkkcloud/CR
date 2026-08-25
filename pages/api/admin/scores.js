// Everybody's performance score, for any operating day.
//
// The dashboard already carries today's — it comes down with the rest of the
// Command Center on the thirty-second poll, so today costs nothing extra.
// This exists for the other question: what did yesterday look like, or last
// Tuesday.
//
// Deliberately a separate endpoint rather than a date parameter on
// /api/admin/overview. Overview is the polled one; giving it a date would
// have meant either re-reading the whole floor on every poll or letting a
// past date leak into the live screen. This is asked for only when somebody
// actually moves the date, and it reads four tabs.
//
// The DAY here is the operating day, 07:00 to 07:00 — the same day every
// date column in these sheets holds. That is what makes the score reset at
// seven each morning without anything having to reset it: at 07:00 the date
// rolls, and every figure below is filtered on it.
import { getUserFromReq } from '../../../lib/auth'
import {
  readSheetCached, CRM_SHEET_ID, ISSUE_SHEET_ID, TABS, todayStr, TTL,
} from '../../../lib/sheets'
import { employees } from '../../../lib/schedule'
import { loadScheduleData } from '../../../lib/roster'
import { totalBreakMinutes } from '../../../lib/attendance'
import { computeScore, whoWorkedOn } from '../../../lib/score'
import { COL, raisedOperatingDay, isFootageRequest } from '../../../lib/issues'

const ISSUE_TAB = 'Issues- Realtime'

// dd/mm/yyyy, and nothing else. A malformed date would silently match no
// rows and report a floor of zeros, which reads exactly like a bad day.
const VALID = /^\d{2}\/\d{2}\/\d{4}$/

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

  try {
    const date = (req.query.date || '').toString().trim() || todayStr()
    if (!VALID.test(date)) return res.status(400).json({ error: 'Date must be dd/mm/yyyy' })

    await loadScheduleData()

    const [breakRows, updateRows, credRows, footageRows, shiftRows] = await Promise.all([
      readSheetCached(CRM_SHEET_ID,   `${TABS.BREAKS}!A:H`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID,   `${TABS.CRM_UPDATES}!A:L`, TTL.LIVE),
      readSheetCached(CRM_SHEET_ID,   `${TABS.CREDENTIALS}!A:H`, TTL.ROSTER),
      readSheetCached(ISSUE_SHEET_ID, `${ISSUE_TAB}!A:T`, TTL.ISSUES).catch(() => null),
      readSheetCached(CRM_SHEET_ID,   `${TABS.SHIFT_LOG}!A:H`, TTL.LIVE),
    ])

    const idOf = {}
    credRows.slice(1).forEach(r => {
      const n = (r[1] || '').toString().trim()
      if (n && !idOf[n]) idOf[n] = (r[0] || '').toString().trim()
    })

    // The whole day's footage requests, so everybody's share is measured
    // against the same denominator. A request raised after midnight belongs
    // to the shift that began the previous evening — see raisedOperatingDay.
    const dayFootage = (footageRows || []).slice(1).filter(r =>
      isFootageRequest(r) && raisedOperatingDay(r[COL.RAISED_AT]) === date)
    const footageByName = {}
    dayFootage.forEach(r => {
      const who = (r[COL.RAISED_BY] || '').toString().trim().toLowerCase()
      if (who) footageByName[who] = (footageByName[who] || 0) + 1
    })

    const vehiclesSeenByName = {}
    updateRows.slice(1).forEach(r => {
      if (r[0] !== date) return
      const name = (r[2] || '').toString().trim()
      if (!name) return
      vehiclesSeenByName[name] = (vehiclesSeenByName[name] || 0) + (parseInt(r[11], 10) || 0)
    })

    // Only the people this operating day belongs to — see whoWorkedOn.
    const workedThen = whoWorkedOn(date, shiftRows, updateRows)
    const scores = employees().filter(e => workedThen.has(e.name)).map(e => {
      const id = idOf[e.name] || ''
      const { score, tier, breakdown } = computeScore({
        footageMine:  footageByName[(e.name || '').toLowerCase()] || 0,
        footageTotal: dayFootage.length,
        vehiclesSeen: vehiclesSeenByName[e.name] || 0,
        breakMinutes: id ? totalBreakMinutes(breakRows, id, [date]) : 0,
      })
      return { name: e.name, score, tier, breakdown }
    }).sort((a, b) => b.score - a.score)

    return res.status(200).json({ date, scores })
  } catch (err) {
    console.error('Admin scores error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
