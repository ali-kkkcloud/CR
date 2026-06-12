import { getUserFromReq } from '../../../lib/auth'
import { updateRowCells, ISSUE_SHEET_ID, nowStr, todayStr } from '../../../lib/sheets'

const ISSUE_TAB = 'Issues- Realtime'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })
  try {
    const { rowIndex } = req.body
    if (!rowIndex) return res.status(400).json({ error: 'rowIndex required' })
    await updateRowCells(ISSUE_SHEET_ID, ISSUE_TAB, rowIndex, 14, ['Yes', `${todayStr()} ${nowStr()}`])
    return res.status(200).json({ success: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: 'Server error' })
  }
}
