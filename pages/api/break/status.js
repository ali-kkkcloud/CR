import { getUserFromReq } from '../../../lib/auth'
import { readSheet, CRM_SHEET_ID, TABS, todayStr, calcDurationMinutes, nowStr } from '../../../lib/sheets'
import { sweepAutoBreaks, AUTO_BREAK_IDLE_MINUTES } from '../../../lib/attendance'

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
      await sweepAutoBreaks([{ empId: user.empId, name: user.name }])
    }

    const rows = await readSheet(CRM_SHEET_ID, `${TABS.BREAKS}!A:H`)

    const myToday = rows.slice(1).filter(r =>
      (r[0] || '').toString().trim() === user.empId.toString().trim() && r[2] === today
    )

    const active = myToday.find(r => r[6] === 'Active')
    const history = myToday.map(r => ({
      startTime: r[3] || '',
      endTime:   r[4] || '',
      minutes:   r[6] === 'Active' ? calcDurationMinutes(today, r[3], today, nowStr()) : (parseInt(r[5]) || 0),
      status:    r[6] || '',
      isAuto:    (r[7] || '') === 'Auto',
    }))

    const totalMinutesToday = history.reduce((s,h) => s + (h.minutes||0), 0)

    return res.status(200).json({
      onBreak: !!active,
      startTime: active ? active[3] : null,
      // Lets the overlay explain itself when the break wasn't asked for.
      isAuto: active ? (active[7] || '') === 'Auto' : false,
      idleMinutes: AUTO_BREAK_IDLE_MINUTES,
      history,
      totalMinutesToday,
    })
  } catch (err) {
    console.error('Break status error:', err)
    return res.status(500).json({ error: 'Server error' })
  }
}
