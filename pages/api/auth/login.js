import { readSheet, CRM_SHEET_ID, TABS } from '../../../lib/sheets'
import { signToken } from '../../../lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const { empId, password } = req.body
  if (!empId || !password) return res.status(400).json({ error: 'Missing fields' })
  try {
    const rows = await readSheet(CRM_SHEET_ID, `${TABS.CREDENTIALS}!A:H`)
    const userRow = rows.slice(1).find(row =>
      (row[0]||'').toString().trim().toLowerCase() === empId.trim().toLowerCase() &&
      (row[2]||'').toString().trim() === password.trim()
    )
    if (!userRow) return res.status(401).json({ error: 'Invalid credentials' })
    const user = {
      empId: userRow[0], name: userRow[1],
      role: (userRow[3]||'employee').toLowerCase(),
      shiftStart: parseInt(userRow[4])||8,
      shiftEnd:   parseInt(userRow[5])||17,
      isNight:    (userRow[6]||'').toLowerCase()==='yes',
      isWeekOff:  (userRow[7]||'').toLowerCase()==='yes',
    }
    const token = signToken(user)
    res.setHeader('Set-Cookie', `cautio_token=${token}; Path=/; HttpOnly; Max-Age=86400; SameSite=Strict`)
    return res.status(200).json({ success: true, user })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Server error' })
  }
}
