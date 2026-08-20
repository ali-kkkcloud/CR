// The footage queue, against a made-up Issue Tracker and follow-up tab.
//
// Runs the real /api/footage/list handler with the Sheets client replaced by
// the recorder in fake-googleapis.mjs. No network, no credentials, and nothing
// anywhere near the live spreadsheet.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/footage-check.mjs
process.env.CRM_SHEET_ID = process.env.CRM_SHEET_ID || 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = process.env.ISSUE_TRACKER_SHEET_ID || 'issue-book'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const { behaviour, reset } = await import('./fake-googleapis.mjs')
const { invalidateSheetCache } = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')
const handler = (await import('../pages/api/footage/list.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const ISSUE_RANGE = 'Issues- Realtime!A:T'
const FOLLOWUP_RANGE = 'Footage_Followup!A:J'

// One row of the Issue Tracker, in its real column order.
function issueRow({ id, client, vehicle, raisedBy, resolved = false }) {
  const r = new Array(20).fill('')
  r[1] = id; r[2] = client; r[3] = vehicle
  r[4] = '20/08/2026, 09:14:00 am'
  r[7] = raisedBy
  r[9] = 'Customer request for video'
  r[10] = 'Need the clip'
  r[17] = resolved ? 'Yes' : 'No'
  return r
}
// One row of Footage_Followup: date, time, issueId, client, vehicle, from, to, status
const followRow = (id, from, to, status = 'Pending') =>
  ['20/08/2026', '05:10:00 pm', id, `Client ${id}`, `KA01${id}`, from, to, status, '', '']

async function ask(user, { issues = [], followups = [] }) {
  reset()
  invalidateSheetCache('crm-book', '')
  invalidateSheetCache('issue-book', '')
  behaviour.data[ISSUE_RANGE]    = [['header'], ...issues]
  behaviour.data[FOLLOWUP_RANGE] = [['header'], ...followups]

  const req = { method: 'GET', cookies: { cautio_token: signToken(user) }, headers: {} }
  let body = null
  const res = {
    status() { return res },
    json(payload) { body = payload; return res },
    end() { return res },
  }
  await handler(req, res)
  return body
}

const NAVEEN = { name: 'Naveen', role: 'employee', empId: 'E1' }
const NESIYA = { name: 'Nesiya', role: 'employee', empId: 'E2' }
const SHASHI = { name: 'Shashi', role: 'employee', empId: 'E3' }
const ADMIN  = { name: 'Admin',  role: 'admin',    empId: 'A1' }

// ── 1 · A request handed on twice belongs to one person ────────────────
console.log('\n1  A request forwarded down a chain')
{
  const issues = [issueRow({ id: 'ISS1001', client: 'Shatabdi Travels', vehicle: 'KA01AB', raisedBy: 'Naveen' })]
  // Naveen handed it to Nesiya, who handed it to Shashi.
  const followups = [
    followRow('ISS1001', 'Naveen', 'Nesiya'),
    followRow('ISS1001', 'Nesiya', 'Shashi'),
  ]
  const naveen = await ask(NAVEEN, { issues, followups })
  const nesiya = await ask(NESIYA, { issues, followups })
  const shashi = await ask(SHASHI, { issues, followups })
  const admin  = await ask(ADMIN,  { issues, followups })

  ok(shashi.followups.length === 1, `Shashi holds it now and sees ${shashi.followups.length}`)
  ok(nesiya.followups.length === 0, `Nesiya passed it on and still sees ${nesiya.followups.length} — it is not hers any more`)
  ok(naveen.followups.length === 0, `Naveen sees ${naveen.followups.length} follow-ups`)
  ok(admin.followups.length === 1, `the admin sees the request ${admin.followups.length} times, should be once`)
  ok(admin.followups[0]?.forwardedTo === 'Shashi', `the admin's copy points at ${admin.followups[0]?.forwardedTo}, should be Shashi`)
  console.log(`   chain Naveen → Nesiya → Shashi: Shashi 1, Nesiya 0, Naveen 0, admin 1`)
}

// ── 2 · Closing it makes it go away ────────────────────────────────────
// The status written is "Closed — <reason>", never the bare word.
console.log('\n2  A follow-up the admin has closed')
{
  const issues = [issueRow({ id: 'ISS1002', client: 'Adapt Green', vehicle: 'KA02CD', raisedBy: 'Naveen' })]
  const followups = [followRow('ISS1002', 'Naveen', 'Nesiya', 'Closed — Footage shared')]
  const nesiya = await ask(NESIYA, { issues, followups })
  const admin  = await ask(ADMIN,  { issues, followups })
  ok(nesiya.followups.length === 0, `a closed follow-up is still on Nesiya's screen (${nesiya.followups.length})`)
  ok(admin.followups.length === 0, `a closed follow-up is still on the admin's screen (${admin.followups.length})`)
  console.log(`   "Closed — Footage shared" → gone from both screens`)
}

// ── 3 · Closing the last hand-off closes the request ───────────────────
console.log('\n3  A chain where only the latest row is closed')
{
  const issues = [issueRow({ id: 'ISS1003', client: 'Chahal', vehicle: 'KA03EF', raisedBy: 'Naveen' })]
  const followups = [
    followRow('ISS1003', 'Naveen', 'Nesiya'),
    followRow('ISS1003', 'Nesiya', 'Shashi', 'Closed — Done'),
  ]
  const admin = await ask(ADMIN, { issues, followups })
  ok(admin.followups.length === 0, `${admin.followups.length} rows of a closed request are still showing`)
  console.log(`   earlier rows still say Pending → request still counted as closed`)
}

// ── 4 · The same request twice in the Issue Tracker ────────────────────
console.log('\n4  A request that appears twice in the tracker')
{
  const issues = [
    issueRow({ id: 'ISS1004', client: 'Infants', vehicle: 'KA04GH', raisedBy: 'Naveen' }),
    issueRow({ id: 'ISS1004', client: 'Infants', vehicle: 'KA04GH', raisedBy: 'Naveen' }),
  ]
  const naveen = await ask(NAVEEN, { issues, followups: [] })
  ok(naveen.pending.length === 1, `one request listed ${naveen.pending.length} times in the queue`)
  console.log(`   duplicated row → 1 item in the queue`)
}

// ── 5 · Resolving it in the tracker takes it off the queue ─────────────
console.log('\n5  A forwarded request that gets resolved in the tracker')
{
  const issues = [issueRow({ id: 'ISS1005', client: 'Biocon', vehicle: 'KA05IJ', raisedBy: 'Naveen', resolved: true })]
  const followups = [followRow('ISS1005', 'Naveen', 'Nesiya')]
  const nesiya = await ask(NESIYA, { issues, followups })
  const naveen = await ask(NAVEEN, { issues, followups })
  ok(nesiya.followups.length === 0, `a resolved request is still queued with Nesiya`)
  ok(naveen.pending.length === 0 && naveen.completed.length === 1,
     `a resolved request should sit in completed, got pending ${naveen.pending.length} / completed ${naveen.completed.length}`)
  console.log(`   resolved in the tracker → off the follow-up queue, into completed`)
}

// ── 6 · An ordinary open request still reaches the right person ────────
console.log('\n6  Nothing has gone missing')
{
  const issues = [
    issueRow({ id: 'ISS1006', client: 'Varahi', vehicle: 'KA06KL', raisedBy: 'Naveen' }),
    issueRow({ id: 'ISS1007', client: 'Autoliv', vehicle: 'KA07MN', raisedBy: 'Nesiya' }),
  ]
  const followups = [followRow('ISS1007', 'Nesiya', 'Naveen')]
  const naveen = await ask(NAVEEN, { issues, followups })
  const admin  = await ask(ADMIN,  { issues, followups })
  ok(naveen.pending.length === 1 && naveen.pending[0].issueId === 'ISS1006',
     `Naveen's own open request is missing from his queue`)
  ok(naveen.followups.length === 1 && naveen.followups[0].issueId === 'ISS1007',
     `the request forwarded to Naveen did not reach him`)
  ok(admin.pending.length === 2, `the admin should see both open requests, sees ${admin.pending.length}`)
  console.log(`   Naveen: 1 own + 1 forwarded to him · admin: both`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
