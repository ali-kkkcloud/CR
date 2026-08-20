import { readSheetCached, CRM_SHEET_ID, TABS, TTL } from '../../../lib/sheets'
import { signToken } from '../../../lib/auth'
import { newSessionId, recordSignIn } from '../../../lib/session'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { empId, password } = req.body
  if (!empId || !password) return res.status(400).json({ error:'Missing fields' })
  try {
    // Cached: logging in is the first thing that has to work, and a whole
    // team arriving at a shift change was spending one fresh read each on a
    // tab that changes about once a month. Editing Credentials drops the
    // cache, so a new joiner can sign in within the minute.
    const rows = await readSheetCached(CRM_SHEET_ID, `${TABS.CREDENTIALS}!A:H`, TTL.ROSTER)
    const userRow = rows.slice(1).find(row =>
      (row[0]||'').toString().trim().toLowerCase() === empId.trim().toLowerCase() &&
      (row[2]||'').toString().trim() === password.trim()
    )
    if (!userRow) return res.status(401).json({ error:'Invalid credentials' })
    const user = {
      empId:      userRow[0],
      name:       userRow[1],
      role:       (userRow[3]||'employee').toLowerCase(),
      shiftStart: parseInt(userRow[4])||8,
      shiftEnd:   parseInt(userRow[5])||17,
      isNight:    (userRow[6]||'').toLowerCase()==='yes',
      isWeekOff:  (userRow[7]||'').toLowerCase()==='yes',
    }
    // ── One signed-in place per person ──────────────────────────────────
    // Signing in here ends every other session for this employee: the newest
    // sign-in is the machine somebody is actually sitting at. See
    // lib/session.js for why two live sessions caused trouble.
    const sid = newSessionId()
    await recordSignIn(user, sid, (req.headers['user-agent'] || '').toString())

    const token = signToken({ ...user, sid })
    res.setHeader('Set-Cookie', `cautio_token=${token}; Path=/; HttpOnly; Max-Age=86400; SameSite=Strict`)
    return res.status(200).json({ success:true, user })
  } catch(err) {
    console.error('Login error:', err)
    return res.status(500).json({ error:'Server error' })
  }
}
