import { getUserFromReq } from '../../../lib/auth'
import { readSheetCached, CRM_SHEET_ID, TABS, todayStr, calcDurationMinutes, nowStr, TTL } from '../../../lib/sheets'
import { sweepAutoBreaks, recordHeartbeat, recentDates, findOpenBreaks, AUTO_BREAK_IDLE_MINUTES } from '../../../lib/attendance'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const today = todayStr()

    // Before reporting, check whether this employee has gone quiet long
    // enough to be put on a break. The dashboard polls this endpoint, so a
    // stretch of inactivity is picked up within about half a minute of
    // crossing the threshold — and if they closed the laptop instead, it is
    // picked up the moment they come back, backdated to when they stopped.
    if (user.role !== 'admin') {
      // The browser tells us how long ago it last saw real input. Mark that
      // first, so somebody sitting at their screen through a quiet hour is
      // counted as present even when there is nothing left to update.
      let seenAt = null
      if (req.query.activeAgoMs != null) {
        try {
          seenAt = await recordHeartbeat(user, req.query.activeAgoMs)
        } catch (e) {
          // A failed heartbeat must never block the status the page is asking
          // for — worst case the employee looks idle for one more poll.
          console.error('Heartbeat failed:', e.message)
        }
      }
      const override = seenAt != null ? { [user.empId.toString().trim()]: seenAt } : null
      await sweepAutoBreaks([{ empId: user.empId, name: user.name }], override)
    }

    // Cached briefly. Opening or closing a break writes to this tab and drops
    // the cache, so the overlay still appears and clears immediately — but a
    // dozen dashboards polling every 30s no longer each cost a read.
    const rows = await readSheetCached(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`, TTL.LIVE)

    const mine = rows.slice(1).filter(r =>
      (r[0] || '').toString().trim() === user.empId.toString().trim()
    )
    // One break, one line. Two writers landing together can leave an
    // identical pair behind, and listing both showed the same break twice and
    // added its minutes to the day's total twice — a 42-minute break reading
    // as "Total 1h 24m". The sweep now closes duplicates, but the reader
    // should never be able to double-count one either.
    const seenBreak = new Set()
    const myToday = mine.filter(r => {
      if (r[2] !== today) return false
      const key = `${r[2]}|${r[3]}`
      if (seenBreak.has(key)) return false
      seenBreak.add(key)
      return true
    })

    // An open break is looked for across both days. One started just before
    // midnight still belongs to the shift in progress, and searching only
    // today would leave the employee free to carry on while the row stayed
    // open forever — which would also stop any further break being opened.
    const dates  = recentDates()
    const active = findOpenBreaks(rows, user.empId, dates)[0] || null
    const history = myToday.map(r => ({
      startTime: r[3] || '',
      endTime:   r[4] || '',
      minutes:   r[6] === 'Active' ? calcDurationMinutes(today, r[3], today, nowStr()) : (parseInt(r[5]) || 0),
      status:    r[6] || '',
      isAuto:    (r[7] || '') === 'Auto',
    }))
    // A break that began before midnight is dated to the day it started, so
    // it isn't in today's rows — but it is the break the employee is sitting
    // in right now, and the list would otherwise say they were on a break
    // while showing nothing at all.
    if (active && active.startDate !== today) {
      history.unshift({
        startTime: active.startTime || '',
        endTime:   '',
        minutes:   calcDurationMinutes(active.startDate, active.startTime, today, nowStr()),
        status:    'Active',
        isAuto:    active.isAuto,
      })
    }

    const totalMinutesToday = history.reduce((s,h) => s + (h.minutes||0), 0)

    return res.status(200).json({
      onBreak: !!active,
      startTime: active ? active.startTime : null,
      // The day the open break began, so the page can measure elapsed time
      // correctly when it started before midnight.
      startDate: active ? active.startDate : null,
      // Lets the overlay explain itself when the break wasn't asked for.
      isAuto: active ? active.isAuto : false,
      idleMinutes: AUTO_BREAK_IDLE_MINUTES,
      history,
      totalMinutesToday,
    })
  } catch (err) {
    console.error('Break status error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
