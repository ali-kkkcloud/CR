// One signed-in place per person.
//
// Somebody steps away, the idle rule puts them on a break, and they come back
// at a different desk and sign in there. Nothing closed the first session, so
// two browsers were live under one name — both polling, both holding a board,
// both able to save the same client-hour, and the abandoned one still
// reporting a heartbeat from a desk nobody is at.
//
// Against a recorder standing in for Sheets. No network, no spreadsheet.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/session-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken, verifyToken } = await import('../lib/auth.js')
const { isCurrentSession, guardSession } = await import('../lib/session.js')
const loginHandler = (await import('../pages/api/auth/login.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const SESSIONS = 'Sessions!A:E'
const CREDS = 'Credentials!A:H'

function board(sessionRows = []) {
  reset()
  sheets.invalidateSheetCache('crm-book', '')
  behaviour.data = {
    [CREDS]: [
      ['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ['E1','Naveen','secret','employee','8','17','No','No'],
    ],
    [SESSIONS]: [['EmpID','Name','SessionId','SignedInAt','Device'], ...sessionRows],
  }
}

// The fake reports the Sessions tab as present, so nothing tries to create it.
behaviour.sheetTitles = ['Credentials', 'Sessions']

async function login(device) {
  const req = { method: 'POST', body: { empId: 'E1', password: 'secret' }, headers: { 'user-agent': device } }
  let body = null, code = 200, cookie = ''
  const res = {
    status(c) { code = c; return res },
    json(x) { body = x; return res },
    setHeader(k, v) { if (k === 'Set-Cookie') cookie = v },
    end() { return res },
  }
  await loginHandler(req, res)
  const token = (cookie.match(/cautio_token=([^;]+)/) || [])[1] || ''
  return { code, body, token, user: token ? verifyToken(token) : null }
}

// ── 1 · Signing in mints a session and carries it in the token ─────────
console.log('\n1  Signing in')
{
  board()
  const a = await login('laptop-A')
  ok(a.code === 200, `login answered ${a.code}`)
  ok(!!a.user?.sid, 'the token carries no session id, so nothing can be replaced later')
  ok(a.user?.name === 'Naveen', 'the token lost the user')
  console.log(`   signed in, session id issued`)
}

// ── 2 · The second sign-in ends the first ──────────────────────────────
console.log('\n2  Signing in at a second desk')
{
  board()
  const a = await login('laptop-A')
  // The recorder does not write back into the read fixture, so the second
  // sign-in's row is put in place by hand — which is exactly what
  // recordSignIn does to the sheet.
  const b = await login('laptop-B')
  behaviour.data[SESSIONS] = [
    ['EmpID','Name','SessionId','SignedInAt','Device'],
    ['E1','Naveen', b.user.sid, '20/08/2026 06:00:00 pm', 'laptop-B'],
  ]
  sheets.invalidateSheetCache('crm-book', 'Sessions')

  ok(a.user.sid !== b.user.sid, 'both sign-ins got the same session id')
  ok((await isCurrentSession(b.user)) === true,  'the desk they are actually at was signed out')
  ok((await isCurrentSession(a.user)) === false, 'the first desk is still live — two sessions under one name')
  console.log(`   laptop-B live, laptop-A signed out`)
}

// ── 3 · The abandoned session is answered 401, with a reason ───────────
console.log('\n3  What the abandoned browser gets')
{
  board()
  const a = await login('laptop-A')
  const b = await login('laptop-B')
  behaviour.data[SESSIONS] = [
    ['EmpID','Name','SessionId','SignedInAt','Device'],
    ['E1','Naveen', b.user.sid, '20/08/2026 06:00:00 pm', 'laptop-B'],
  ]
  sheets.invalidateSheetCache('crm-book', 'Sessions')

  let code = 0, body = null
  const res = { status(c) { code = c; return res }, json(x) { body = x; return res } }
  const allowed = await guardSession(a.user, res)
  ok(allowed === false, 'the abandoned session was allowed through')
  ok(code === 401, `expected 401, got ${code}`)
  ok(body?.reason === 'session-replaced', `the page cannot tell why it was signed out: ${JSON.stringify(body)}`)

  // And the live one sails through untouched.
  let code2 = 0
  const res2 = { status(c) { code2 = c; return res2 }, json() { return res2 } }
  ok((await guardSession(b.user, res2)) === true, 'the live session was blocked')
  ok(code2 === 0, 'the live session was answered an error status')
  console.log(`   laptop-A → 401 session-replaced · laptop-B → allowed`)
}

// ── 4 · Nobody is locked out by accident ───────────────────────────────
// Three ways this could go wrong, each of which would sign the whole floor
// out of their own platform.
console.log('\n4  The ways this must NOT lock people out')
{
  board()
  // A token issued before any of this existed has no session id at all.
  const old = verifyToken(signToken({ empId: 'E1', name: 'Naveen', role: 'employee' }))
  ok((await isCurrentSession(old)) === true,
     'a token issued before sessions existed was rejected — a deploy would sign everybody out mid-shift')

  // No row for this employee yet.
  const fresh = verifyToken(signToken({ empId: 'E1', name: 'Naveen', role: 'employee', sid: 'abc' }))
  ok((await isCurrentSession(fresh)) === true, 'an employee with no session row yet was locked out')

  // The tab will not read — a bad minute at Google, not an identity problem.
  behaviour.broken = new Set([SESSIONS])
  sheets.invalidateSheetCache('crm-book', 'Sessions')
  ok((await isCurrentSession(fresh)) === true,
     'an unreadable Sessions tab locked somebody out; a read failure must never read as "you are not who you say you are"')
  behaviour.broken = new Set()
  console.log(`   old token, no row, unreadable tab → all allowed through`)
}

// ── 5 · A sign-in still works if the session cannot be recorded ────────
console.log('\n5  When the session cannot be written')
{
  board()
  behaviour.broken = new Set([SESSIONS])
  const a = await login('laptop-A')
  ok(a.code === 200, `a sign-in failed because the session could not be recorded (${a.code})`)
  ok(!!a.user?.name, 'the sign-in came back without a user')
  behaviour.broken = new Set()
  console.log(`   Sessions unwritable → sign-in still succeeds`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
