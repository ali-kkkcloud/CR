// ══════════════════════════════════════════════════════════════════════
// One signed-in place per person.
//
// An operator steps away, the idle rule puts them on a break, and they come
// back at a different desk and sign in there. Nothing closed the first
// session, so two browsers were live under one name — both polling, both
// holding a board, both able to save the same client-hour. The first machine
// carries on reporting a person who is not at it: its heartbeat keeps their
// shift looking alive from a desk they have left, and a break opened on one
// can be resumed from the other.
//
// Signing in anywhere now ends every other session for that employee. The
// newest sign-in is the real one — it is the machine somebody is actually
// sitting at.
//
// How it works: each sign-in mints a random id, writes it against the
// employee, and carries it inside their token. A request whose token holds an
// id that is no longer the recorded one is answered 401, and the page sends
// them to the login screen.
//
// Deliberately forgiving in two places, because getting this wrong locks the
// floor out of their own platform:
//
//   - a token with no id at all is accepted. Tokens issued before this
//     existed have none, and a deploy must not sign everybody out mid-shift.
//   - if the Sessions tab cannot be read, or has no row for this employee,
//     the request is allowed. An unreadable tab is a bad minute at Google, and
//     it must never read as "you are not who you say you are".
// ══════════════════════════════════════════════════════════════════════
import { randomUUID } from 'crypto'
import {
  readSheetCached, readSheet, appendRow, updateRowCells, invalidateSheetCache,
  getSheetsClient, CRM_SHEET_ID, TABS, todayStr, nowStr, TTL,
} from './sheets'

export function newSessionId() {
  return randomUUID()
}

// Cols: EmpID | Name | SessionId | SignedInAt | Device
const RANGE = `${TABS.SESSIONS}!A:E`

// Once this instance has seen the tab, it exists. Nothing deletes it, so
// asking the book about its tabs on every single sign-in is a request spent
// to be told the same thing again.
const _S = globalThis.__cautioSessions || (globalThis.__cautioSessions = { tabKnown: false })

async function ensureTab() {
  if (_S.tabKnown) return
  // Adding a tab is additive — it cannot touch a row of anybody's work — but
  // it is still a change to somebody's live spreadsheet, so it happens once,
  // only when the tab is genuinely missing, and it is logged.
  const sheetsApi = await getSheetsClient()
  const meta = await sheetsApi.spreadsheets.get({ spreadsheetId: CRM_SHEET_ID, fields: 'sheets.properties.title' })
  const titles = (meta.data.sheets || []).map(s => s.properties.title)
  if (titles.includes(TABS.SESSIONS)) { _S.tabKnown = true; return }
  console.warn(`sessions: creating the ${TABS.SESSIONS} tab`)
  await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId: CRM_SHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: TABS.SESSIONS } } }] },
  })
  await appendRow(CRM_SHEET_ID, TABS.SESSIONS, ['EmpID', 'Name', 'SessionId', 'SignedInAt', 'Device'])
  _S.tabKnown = true
}

// Record this sign-in as the only live one for the employee.
export async function recordSignIn(user, sessionId, device = '') {
  try {
    await ensureTab()
    const rows = await readSheet(CRM_SHEET_ID, RANGE)
    const wanted = (user.empId || '').toString().trim()
    let rowIndex = -1
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][0] || '').toString().trim() === wanted) { rowIndex = i + 1; break }
    }
    const values = [wanted, user.name || '', sessionId, `${todayStr()} ${nowStr()}`, device.slice(0, 120)]
    if (rowIndex > 0) await updateRowCells(CRM_SHEET_ID, TABS.SESSIONS, rowIndex, 1, values)
    else await appendRow(CRM_SHEET_ID, TABS.SESSIONS, values)
    invalidateSheetCache(CRM_SHEET_ID, TABS.SESSIONS)
    return true
  } catch (e) {
    // A sign-in must succeed even if this does not. Losing the single-session
    // guarantee for one login is a far smaller problem than a person who
    // cannot get into the platform at all.
    console.error('sessions: could not record sign-in —', e.message)
    return false
  }
}

// Is the token's session still the live one for this employee?
export async function isCurrentSession(user) {
  if (!user) return false
  if (!user.sid) return true                       // issued before this existed
  try {
    const rows = await readSheetCached(CRM_SHEET_ID, RANGE, TTL.LIVE)
    const wanted = (user.empId || '').toString().trim()
    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][0] || '').toString().trim() !== wanted) continue
      const recorded = (rows[i][2] || '').toString().trim()
      if (!recorded) return true
      return recorded === user.sid
    }
    return true                                     // no row yet — nothing to contradict
  } catch (e) {
    console.error('sessions: could not check —', e.message)
    return true                                     // never lock somebody out on a read failure
  }
}

// For an API route: answers 401 and returns false when this session has been
// replaced, so the caller can simply `if (!(await guardSession(user, res))) return`.
export async function guardSession(user, res) {
  if (await isCurrentSession(user)) return true
  res.status(401).json({
    error: 'Signed in on another device',
    reason: 'session-replaced',
  })
  return false
}
