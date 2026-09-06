// Client_Timings is the master list, and two things an admin can say about it.
//
// ── The bug this starts from ───────────────────────────────────────────
//
// Reported from the floor: Cityflo_Mumbai appeared on Nesiya's four o'clock
// board, and Client_Timings has NO hours against it at all. Traced live, the
// chain was four links long and only the first one was doing its job:
//
//   Client_Timings   hours cell blank → parsed as []  → not in 4pm's rotation
//   Employee_Hours   "Ritanjali | 16 | Cityflo_Mumbai" — a pin, and this route
//                    never consulted Client_Timings at all
//   Credentials      Ritanjali is on a week off, so she is not in the pool
//   the orphan rule  a pinned client whose owner is away joins the rotation so
//                    it is not lost — and it was handed to Nesiya
//
// Seven of the eight pinned clients on the live book had a blank or missing
// Client_Timings row. A pin now says WHO does a client at an hour; it does not
// say WHETHER the client runs. That is Client_Timings' answer alone.
//
// ── And two things built on top of it ─────────────────────────────────
//
//   HIDDEN  a client taken off particular DATES, future ones included. Off
//           every board, and out of the denominator — it was never due, so it
//           cannot have been missed.
//
//   NOTE    a note pinned to one client at one hour, with no date. Whoever
//           holds that client that hour sees it, and finds the client at the
//           top of their list.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/client-rules-check.mjs
import fs from 'fs'

process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')
const { loadScheduleData, parseHidden, parseClientNotes, parseTimings,
        duplicateTimingRows, unusableHourRows, readHourRow,
        parseEmployeeHours } = await import('../lib/roster.js')
const schedule = await import('../lib/schedule.js')
const rules = (await import('../pages/api/admin/client-rules.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }
const code = f => fs.readFileSync(f, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

const D4 = '04/08/2026', D5 = '05/08/2026'

// Dates the API will accept. A day that has already finished cannot be taken
// off — see check 17 — so anything POSTed has to be today or later, and
// hard-coding one would make this file pass now and fail next month. The
// operating day, because that is what the server compares against.
const opToday = () => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  if (d.getHours() < 7) d.setDate(d.getDate() - 1); return d }
const ahead = (n) => { const d = opToday(); d.setDate(d.getDate() + n)
  const p = x => String(x).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}` }
const F1 = ahead(1), F2 = ahead(2)

// Client_Timings: Client | Hours   ·   Employee_Hours: Employee | Hour | Fixed | Custom
// Client_Hidden: Date|Client|Reason|By|At|Status  ·  Client_Notes: Client|Hour|Note|By|At|Status
function floor({ timings = [], empHours = [], hidden = [], notes = [] } = {}) {
  reset()
  ;['crm-book', 'source-book', 'issue-book'].forEach(b => sheets.invalidateSheetCache(b, ''))
  globalThis.__cautioRoster = { lastGood: null }
  globalThis.__cautioPlanMemo = []
  // The "this tab does not exist" memory lives five minutes and is NOT part of
  // the read cache. Left standing, check 10 — which deliberately makes
  // Client_Hidden absent — silently emptied that tab for every check after it,
  // and three of them failed for a reason that had nothing to do with their
  // subject. A fixture has to start from nothing, including this.
  globalThis.__cautioSheets.missingTabs = new Map()
  globalThis.__cautioSheets.tabsSeen = new Set()
  behaviour.data = {
    'Credentials!A:H': [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
      ['E1','Nesiya',   'x','employee','8','17','No','No'],
      ['E2','Sunil',    'x','employee','8','17','No','No'],
      // On a week off — the exact state that orphaned the live pin.
      ['E3','Ritanjali','x','employee','8','17','No','Yes']],
    'Client_Timings!A:B': [['Client','Hours'], ...timings],
    'Employee_Hours!A:D': [['Employee','Hour','Fixed Clients','Custom Text'], ...empHours],
    'Client_Hidden!A:F': [['Date','Client','Reason','MarkedBy','MarkedAt','Status'], ...hidden],
    'Client_Notes!A:F':  [['Client','Hour','Note','MarkedBy','MarkedAt','Status'], ...notes],
  }
}

const ADMIN = { name: 'Boss', role: 'admin', empId: 'A1' }
async function api(method, body, query = {}) {
  const req = { method, query, body, cookies: { cautio_token: signToken(ADMIN) }, headers: {} }
  let status = 200, out = null
  const res = { status(c) { status = c; return res }, json(p) { out = p; return res }, end() { return res } }
  await rules(req, res)
  return { status, body: out }
}

// ══ 1 · A pin cannot conjure a client Client_Timings does not run ══════
console.log('\n1  Client_Timings is the master list')
{
  floor({
    timings: [['Zingbus', '9, 16'], ['Cityflo_Mumbai', ''], ['Bharat Cabs', '16']],
    empHours: [
      ['Ritanjali', '16', 'Cityflo_Mumbai', ''],   // blank hours  → must be ignored
      ['Ritanjali', '9',  'CF-Chennai', ''],       // not in the tab at all → ignored
      ['Sunil',     '9',  'Zingbus', ''],          // 9 IS in Zingbus's hours → kept
      ['Sunil',     '11', 'Zingbus', ''],          // 11 is NOT → ignored
    ],
  })
  await loadScheduleData()

  ok(schedule.specificClientsFor('Ritanjali', 16) === null,
     'a pin on a client with a blank hours cell must not be delivered — this is the live bug')
  ok(schedule.specificClientsFor('Ritanjali', 9) === null,
     'a pin on a client that is not in Client_Timings at all must not be delivered')
  ok(JSON.stringify(schedule.specificClientsFor('Sunil', 9)) === '["Zingbus"]',
     'a pin whose hour the timings sheet agrees with is still delivered')
  ok(schedule.specificClientsFor('Sunil', 11) === null,
     'a pin at an hour the client does not run in must not be delivered')

  // And the whole reason it mattered: the orphan rule handed it to somebody else.
  const dist = schedule.distributeClientsForHour(16, ['Nesiya'], {}, {}, true)
  const got = (dist['Nesiya'] || []).map(c => c.client)
  ok(!got.includes('Cityflo_Mumbai'),
     `Cityflo_Mumbai reached a board anyway: ${JSON.stringify(got)}`)
  ok(got.includes('Zingbus') && got.includes('Bharat Cabs'),
     `the hour's real clients went missing: ${JSON.stringify(got)}`)
  console.log(`   4pm board is ${JSON.stringify(got)} — Cityflo_Mumbai is not on it`)
}

// ══ 2 · The pins the sheet refuses are named, not silently dropped ═════
console.log('\n2  A pin that does nothing says so')
{
  const orphans = schedule.orphanedPins()
  const find = (c) => orphans.find(o => o.client === c)
  ok(find('Cityflo_Mumbai')?.reason === 'no hours set in Client_Timings', 'the blank-hours pin is reported')
  ok(find('CF-Chennai')?.reason === 'not in Client_Timings at all', 'the missing-client pin is reported')
  ok(/Client_Timings has it at/.test(find('Zingbus')?.reason || ''), 'the wrong-hour pin is reported')
  ok(!orphans.some(o => o.client === 'Zingbus' && o.hour === 9),
     'a pin that WORKS must not be reported as an orphan')
  console.log(`   ${orphans.length} pins the timings sheet refuses, each with a reason`)
}

// ══ 3 · Hidden: off the day, on every screen ═══════════════════════════
console.log('\n3  A client taken off a day')
{
  floor({
    timings: [['Zingbus', '16'], ['Bharat Cabs', '16'], ['Coral Tours', '16']],
    hidden: [[D4, 'Bharat Cabs', 'fleet off road', 'Boss', '', 'Hidden']],
  })
  await loadScheduleData()

  const off4 = schedule.hiddenClientsOn(D4)
  ok(off4.has('Bharat Cabs'), 'the hidden client is not in the day\'s hidden set')
  ok(schedule.hiddenClientsOn(D5).size === 0, 'hiding is per DATE — the next day must be untouched')

  const on4  = schedule.distributeClientsForHour(16, ['Nesiya'], {}, {}, true, off4).Nesiya.map(c => c.client)
  const on5  = schedule.distributeClientsForHour(16, ['Nesiya'], {}, {}, true, schedule.hiddenClientsOn(D5)).Nesiya.map(c => c.client)
  ok(!on4.includes('Bharat Cabs'), `hidden on the 4th but still on the board: ${JSON.stringify(on4)}`)
  ok(on5.includes('Bharat Cabs'), `not hidden on the 5th but missing anyway: ${JSON.stringify(on5)}`)
  ok(on4.length === 2 && on5.length === 3, 'the other clients must be untouched either day')

  // ── And it is not counted as work anybody missed ──────────────────
  //
  // This is the half that would have been easy to leave out. A client taken
  // off the day that stayed in the denominator would mark the floor down for
  // not doing something nobody asked them to do.
  const audit = schedule.auditHourAssignment(16, [], {}, {}, true, off4)
  ok(audit.due === 2, `${audit.due} clients counted as due, expected 2 — the hidden one is still in the total`)
  ok(!audit.unassigned.includes('Bharat Cabs'),
     'a hidden client is being reported as unassigned — it was never due')
  console.log(`   off on ${D4}, on again on ${D5}, and out of the day's total either way`)
}

// ══ 4 · Hiding beats a pin ═════════════════════════════════════════════
//
// Otherwise "not today" would be true for everybody except the one person
// whose name the client is written against — which is the worst possible
// half-measure, because that person is the one who would work it.
console.log('\n4  A hidden client is off the pinned board too')
{
  floor({
    timings: [['Zingbus', '9'], ['Bharat Cabs', '9']],
    empHours: [['Sunil', '9', 'Zingbus', '']],
    hidden: [[D4, 'Zingbus', '', 'Boss', '', 'Hidden']],
  })
  await loadScheduleData()
  const off = schedule.hiddenClientsOn(D4)
  const dist = schedule.distributeClientsForHour(9, ['Sunil', 'Nesiya'], {}, {}, true, off)
  const all = Object.values(dist).flat().map(c => c.client)
  ok(!all.includes('Zingbus'), `the pinned client is hidden but still delivered: ${JSON.stringify(all)}`)
  ok(all.includes('Bharat Cabs'), 'the rest of the hour must still be handed out')
  console.log('   a pin does not exempt a client from being off for the day')
}

// ══ 5 · Notes travel with the client ═══════════════════════════════════
console.log('\n5  A note pinned to one hour')
{
  floor({
    timings: [['Zingbus', '9, 13'], ['Bharat Cabs', '9']],
    notes: [['Zingbus', '13', 'Driver camera blurred — check carefully', 'Boss', '', 'Active']],
  })
  await loadScheduleData()

  ok(schedule.noteFor('Zingbus', 13) === 'Driver camera blurred — check carefully', 'the note is not being read back')
  ok(schedule.noteFor('Zingbus', 9) === null, 'the note belongs to ONE hour, not to the client')
  ok(schedule.noteFor('Bharat Cabs', 13) === null, 'the note belongs to ONE client')

  const at13 = schedule.distributeClientsForHour(13, ['Nesiya'], {}, {}, true).Nesiya
  ok(at13.find(c => c.client === 'Zingbus')?.note === 'Driver camera blurred — check carefully',
     'the note must travel with the client, so every screen shows the same one')
  const at9 = schedule.distributeClientsForHour(9, ['Nesiya'], {}, {}, true).Nesiya
  ok(at9.every(c => !c.note), 'no note at an hour that has none')
  console.log('   one client, one hour, and the note rides along with it')
}

// ══ 6 · A noted client is first, until it is done ══════════════════════
//
// The board's own ordering, exactly as MyClientsTab applies it.
console.log('\n6  The noted client sorts to the top')
{
  const { updateRank } = await import('../lib/updateline.js')
  const isDone = (filled, c) => !!(filled[c]?.status || '').toString().trim()
  const inUpdateOrder = (rows, { filled = {}, updatedToday = {} } = {}) => {
    const rankOf = (c) => updateRank({
      mine: isDone(filled, c.client),
      at: (filled[c.client]?.updatedAt || '').toString().trim(),
      elsewhere: isDone(filled, c.client) ? null : updatedToday[c.client],
    })
    const noted = (c) => (c.note && !isDone(filled, c.client) ? 0 : 1)
    return rows.map(c => ({ c, n: noted(c), r: rankOf(c) }))
      .sort((a, b) => (a.n - b.n) || (a.r - b.r) || a.c.client.localeCompare(b.c.client))
      .map(x => x.c)
  }

  const rows = [
    { client: 'Apple Bus' },                                  // untouched
    { client: 'Zingbus', note: 'Driver camera blurred' },      // noted
    { client: 'Delta Fleet' },                                 // untouched
  ]
  const first = inUpdateOrder(rows).map(c => c.client)
  ok(first[0] === 'Zingbus', `the noted client is not first: ${JSON.stringify(first)}`)
  ok(JSON.stringify(first) === '["Zingbus","Apple Bus","Delta Fleet"]',
     `order came out as ${JSON.stringify(first)}`)

  // Once it is done it stops holding the top slot — the place where the next
  // thing to do belongs.
  const after = inUpdateOrder(rows, { filled: { Zingbus: { status: 'Updated', updatedAt: '01:31:00 pm' } } })
    .map(c => c.client)
  ok(after[0] !== 'Zingbus', `a finished noted client is still pinned to the top: ${JSON.stringify(after)}`)
  ok(after[after.length - 1] === 'Zingbus', 'once done it takes its place in the ordinary order')

  const src = code('components/tabs/MyClientsTab.js')
  ok(/const noted = \(c\) => \(c\.note && !isDone\(filled, c\.client\) \? 0 : 1\)/.test(src),
     'the board applies the same rule this check does')
  ok(/\{c\.note && \(/.test(src), 'and shows the note on the row, before the client is opened')
  console.log(`   ${JSON.stringify(first)} → after saving it: ${JSON.stringify(after)}`)
}

// ══ 7 · Reading the two tabs back ══════════════════════════════════════
//
// Nothing is ever deleted from either — a removal is an appended row marked
// Removed, because deleting by row index on a live book is a race. So the LAST
// row for a key is the one that counts.
console.log('\n7  Removed rows, and last-row-wins')
{
  const h = parseHidden([['Date','Client','Reason','By','At','Status'],
    [D4, 'Zingbus', '', 'Boss', '', 'Hidden'],
    [D4, 'Coral Tours', '', 'Boss', '', 'Hidden'],
    [D4, 'Zingbus', '', 'Boss', '', 'Removed'],     // put back
    [D4, 'Zingbus', '', 'Boss', '', 'Hidden'],      // and taken off again
    [D5, 'Coral Tours', '', 'Boss', '', 'Removed'], // never hidden on the 5th
  ])
  ok(h[D4].has('Zingbus'), 'hidden → removed → hidden again must read as hidden')
  ok(h[D4].has('Coral Tours'), 'the other client on the same day must be untouched')
  ok(!h[D5] || !h[D5].has('Coral Tours'), 'a Removed row must never hide anything')

  const n = parseClientNotes([['Client','Hour','Note','By','At','Status'],
    ['Zingbus', '13', 'first note', 'Boss', '', 'Active'],
    ['Zingbus', '13', 'second note', 'Boss', '', 'Active'],   // edited
    ['Coral Tours', '9', 'gone', 'Boss', '', 'Removed'],
    ['Bad', 'xx', 'no hour', 'Boss', '', 'Active'],           // unparseable hour
    ['Blank', '9', '', 'Boss', '', 'Active'],                 // no text left
  ])
  ok(n['Zingbus'][13] === 'second note', 'the latest note wins')
  ok(!n['Coral Tours'], 'a Removed note is gone')
  ok(!n['Bad'], 'a row with no usable hour is skipped')
  ok(!n['Blank'], 'a note with no text is nothing to show')
  console.log('   append-only, last row wins, Removed means gone')
}

// ══ 8 · The admin endpoint refuses what cannot work ════════════════════
console.log('\n8  What the Command Center will not save')
{
  floor({ timings: [['Zingbus', '9, 13'], ['Cityflo_Mumbai', '']] })
  await loadScheduleData()

  const read = await api('GET', null)
  ok(read.status === 200, `GET returned ${read.status}`)
  ok(read.body.clients.find(c => c.client === 'Zingbus').hours.join(',') === '9,13',
     'the screen is told which hours a client actually runs, to offer those and no others')
  ok(read.body.clients.find(c => c.client === 'Cityflo_Mumbai').hours.length === 0,
     'and is told plainly when a client has none')

  const badDate = await api('POST', { kind:'hidden', action:'add', clients:['Zingbus'], dates:['2026-08-04'] })
  ok(badDate.status === 400, 'an ISO date must be refused — it would hide nothing and look like a broken feature')

  const ghost = await api('POST', { kind:'hidden', action:'add', clients:['Nope Ltd'], dates:[F1] })
  ok(ghost.status === 400 && /Not in Client_Timings/.test(ghost.body.error),
     'a client the timings sheet has never heard of cannot be hidden')

  const offHour = await api('POST', { kind:'note', action:'add', clients:['Zingbus'], hours:[11], note:'x' })
  ok(offHour.status === 400 && /does not run these at that hour/.test(offHour.body.error),
     'a note at an hour the client does not run in must be refused, not written where nobody will see it')

  const noText = await api('POST', { kind:'note', action:'add', clients:['Zingbus'], hours:[13], note:'   ' })
  ok(noText.status === 400, 'an empty note must be refused')

  const good = await api('POST', { kind:'note', action:'add', clients:['Zingbus'], hours:[9, 13], note:'Check carefully' })
  ok(good.status === 200 && good.body.written === 2, `two hours should write two rows, got ${JSON.stringify(good.body)}`)

  const multi = await api('POST', { kind:'hidden', action:'add', clients:['Zingbus','Cityflo_Mumbai'], dates:[F1, F2] })
  ok(multi.status === 200 && multi.body.written === 4,
     `two clients over two days is four rows, got ${JSON.stringify(multi.body)}`)
  console.log('   bad dates, unknown clients and unreachable hours are all turned away')
}

// ══ 9 · The tabs are created rather than failing the first save ════════
console.log('\n9  A book that has never had these tabs')
{
  const src = code('pages/api/admin/client-rules.js')
  ok(/ensureTab\(CRM_SHEET_ID, TABS\.CLIENT_HIDDEN/.test(src), 'the hidden tab is created before the first write')
  ok(/ensureTab\(CRM_SHEET_ID, TABS\.CLIENT_NOTES/.test(src), 'and so is the notes tab')

  const sh = code('lib/sheets.js')
  ok(/addSheet:/.test(sh), 'ensureTab adds a sheet')
  ok(!/deleteSheet|deleteDimension|clear\(/.test(sh),
     'nothing in the sheet layer may delete or clear — a live book is not the place for it')

  const rs = code('lib/roster.js')
  ok(/CLIENT_HIDDEN\}!A:F`, TTL\.ROSTER\)\.catch\(\(\) => null\)/.test(rs),
     'a book without the tab must read as "nothing hidden", not fail the roster')
  ok(/hidden: hiddenRows \? parseHidden\(hiddenRows\) : \{\}/.test(rs),
     'and a failed read must NOT fall back to a stale copy — a stale hiding takes a client off a board it belongs on')
  console.log('   created on demand, and a missing tab means "nothing hidden"')
}

// ══ 10 · An absent tab must not cost every screen a round trip ═════════
//
// These two ranges are warmed with the rest, so on a book where the tabs do
// not exist yet Google fails the WHOLE batchGet — one absent range dragging
// eleven healthy ones into the single-read fallback, and every screen on the
// platform going from one request to a dozen. Seen the moment the ranges were
// added: "Unable to parse range: Client_Hidden!A:F", then a fallback, on every
// request. So an absent OPTIONAL tab is remembered and resolves as empty
// without being asked for again.
//
// ── And the list of what counts as optional is the whole safety of it ──
//
// "Missing tab means empty" is only true where empty is an ANSWER. For the
// vehicle source it would mean "no vehicles", which moves clients between
// people and shrinks every total — a silent wrong answer, and shuffle-check
// exists to make sure that case still FAILS. Both faults were caught by the
// existing suite when this rule was first written too broadly; this pins the
// narrow version.
console.log('\n10 A tab that is not there, and the ones that must still raise')
{
  const sh = code('lib/sheets.js')
  ok(/const OPTIONAL_TABS = new Set\(\[TABS\.CLIENT_HIDDEN, TABS\.CLIENT_NOTES\]\)/.test(sh),
     'the "absent means empty" rule must be a named short list, never a rule about missing tabs in general')
  ok(/if \(!OPTIONAL_TABS\.has\(\(range \|\| ''\)\.split\('!'\)\[0\]\)\) return false/.test(sh),
     'and it must be checked before anything else, so no other tab can fall into it')
  ok(/if \(tabIsMissing\(spreadsheetId, range\)\) return \[\]/.test(sh),
     'a tab already known absent must never reach a batch again')
  ok(/forgetMissingTab\(spreadsheetId, tab\)/.test(sh),
     'creating the tab must forget it immediately, or the first save would appear to do nothing')
  ok(/MISSING_TAB_MS = 300000/.test(sh),
     'and it is forgotten after a while anyway, so a tab created by hand needs no deploy')

  // Behaviourally: the second read of an absent optional tab costs nothing.
  //
  // `broken` is what makes the fake answer the way Google does for a range
  // whose tab does not exist — "Unable to parse range". Simply leaving the
  // range out of behaviour.data is NOT the same thing: the fake hands back
  // placeholder rows, the read succeeds, and this check passed for a reason
  // that had nothing to do with what it claims to test.
  reset()
  sheets.invalidateSheetCache('crm-book', '')
  behaviour.data = { 'Credentials!A:H': [['EmpID','Name']] }
  behaviour.broken.add('Client_Hidden!A:F')
  await sheets.readSheetCached('crm-book', 'Client_Hidden!A:F', 1).catch(() => null)
  const before = calls.get.length + calls.batchGet.length
  await sheets.readSheetCached('crm-book', 'Client_Hidden!A:F', 1)
  await sheets.readSheetCached('crm-book', 'Client_Hidden!A:F', 1)
  ok(calls.get.length + calls.batchGet.length === before,
     'an absent optional tab was asked for again — every screen would pay for it')

  // And a tab that is NOT optional must still raise, every time. This is the
  // half that matters: "missing means empty" on the vehicle source would mean
  // "no vehicles", which moves clients between people and shrinks every total.
  behaviour.broken.add('Others!A:B')
  let raised = 0
  for (let i = 0; i < 2; i++) {
    try { await sheets.readSheetCached('source-book', 'Others!A:B', 1) } catch { raised++ }
  }
  ok(raised === 2, `a non-optional missing tab raised ${raised} times out of 2 — it must never be treated as empty`)
  console.log('   asked once, then treated as empty; every other tab still raises')
}

// ══ 11 · One spelling of a client's name ═══════════════════════════════
//
// Found by going looking, not by anybody reporting it — and it would have been
// the worst of the lot. Four sheets name the same client and people type them
// by hand, so "Zingbus", "zingbus" and " Zingbus " all occur. Once
// Client_Timings decides whether a pin is honoured, an exact-match lookup
// means a stray capital in Employee_Hours SILENTLY DROPS a pinned client: it
// stops reaching anybody, and nothing anywhere says so.
//
// That is the one outcome this platform must never produce, and the change
// that was meant to prevent a client appearing wrongly would have introduced
// it. Matched on a normalised key now, and returned in Client_Timings' own
// spelling so everything downstream speaks one name for one client.
console.log('\n11 A name typed with a different capital is the same client')
{
  floor({
    timings: [['Zingbus', '9'], ['Bharat Cabs', '9']],
    empHours: [['Sunil', '9', ' zingbus ', '']],          // lower case, padded
    hidden:  [[D4, 'BHARAT CABS', '', 'Boss', '', 'Hidden']],
    notes:   [['  zingbus', '9', 'read this', 'Boss', '', 'Active']],
  })
  await loadScheduleData()

  ok(JSON.stringify(schedule.specificClientsFor('Sunil', 9)) === '["Zingbus"]',
     'a pin typed in a different case must still be delivered, in the timings sheet\'s spelling')
  ok(schedule.canonicalClient('  ZiNgBuS  ') === 'Zingbus', 'the canonical name is the timings sheet\'s own')
  ok(schedule.canonicalClient('Nope Ltd') === null, 'a client the timings sheet does not have has no canonical name')
  ok(schedule.hiddenClientsOn(D4).has('Bharat Cabs'),
     'a hiding typed in a different case must still hide — as the sheet spells it')
  ok(schedule.noteFor('Zingbus', 9) === 'read this', 'and a note must still be found')

  // Returned in one spelling, so a Set built from clientTimings can match it.
  const dist = schedule.distributeClientsForHour(9, ['Sunil', 'Nesiya'], {}, {}, true, schedule.hiddenClientsOn(D4))
  const all = Object.values(dist).flat().map(c => c.client)
  ok(all.includes('Zingbus'), `the pinned client went missing: ${JSON.stringify(all)}`)
  ok(!all.includes('Bharat Cabs'), `the hidden client is still on a board: ${JSON.stringify(all)}`)
  console.log('   " zingbus " and "BHARAT CABS" both resolve to the sheet\'s spelling')

  // The stored set is module state. Handing out the real one lets any caller
  // quietly change what every other screen believes is hidden.
  const a = schedule.hiddenClientsOn(D4)
  a.add('Zingbus')
  ok(!schedule.hiddenClientsOn(D4).has('Zingbus'),
     'hiddenClientsOn returned the live set — one screen can now hide clients on every other')
  console.log('   and the set handed out is a copy, not the live one')
}

// ══ 12 · The audit must not raise an alarm for cancelled work ══════════
//
// A client on no board is invisible, and the Command Center shouts about it —
// correctly, because that is the worst way for work to go missing. But a
// client an admin deliberately took off the day is not missing, and the audit
// was measuring the hour against a list the split was never given.
//
// Seen with an empty pool: all three clients came back as unassigned INCLUDING
// the hidden one. The loudest alarm on the platform, firing for work that was
// cancelled on purpose.
console.log('\n12 A hidden client is not "reaching no board"')
{
  const { computeDayPlan } = await import('../lib/dayplan.js')
  floor({
    timings: [['Zingbus', '9'], ['Bharat Cabs', '9'], ['Coral Tours', '9']],
    hidden: [[D4, 'Coral Tours', '', 'Boss', '', 'Hidden']],
  })
  await loadScheduleData()

  // Nobody on shift — which is exactly when the audit reports unassigned work.
  const plan = computeDayPlan({
    date: D4, today: D4, nowHour: 11, yesterday: '03/08/2026',
    shiftRows: [['EmpID','Name','Date','In','Out','','Status','']],
    updateRows: [['Date','Time','Emp','Client','Hour','Status','','','','','','']],
    breakRows: [['h']], leaveMap: {}, overridesMap: {}, vehicleMap: {}, weekOffNames: new Set(),
  })
  const h9 = plan.hours.find(h => h.hour === 9)
  ok(!h9.unassigned.includes('Coral Tours'),
     `the hidden client is reported as reaching no board: ${JSON.stringify(h9.unassigned)}`)
  ok(h9.unassigned.includes('Zingbus') && h9.unassigned.includes('Bharat Cabs'),
     'the genuinely uncovered clients must still be reported — this alarm has to keep working')
  console.log(`   nobody on shift → ${JSON.stringify(h9.unassigned)}, and Coral Tours is not among them`)
}

// ══ 13 · Work already done on a client that is then hidden ═════════════
//
// An admin can hide a client half way through the day, after somebody has
// already worked it. The record of that work must survive — finished work
// stays with whoever finished it — without the day's totals going incoherent.
console.log('\n13 Hidden after the work was already done')
{
  const { computeDayPlan } = await import('../lib/dayplan.js')
  floor({
    timings: [['Zingbus', '9'], ['Bharat Cabs', '9']],
    hidden: [[D4, 'Zingbus', '', 'Boss', '', 'Hidden']],
  })
  await loadScheduleData()

  const plan = computeDayPlan({
    date: D4, today: D4, nowHour: 11, yesterday: '03/08/2026',
    shiftRows: [['EmpID','Name','Date','In','Out','','Status',''],
                ['E1','Nesiya', D4, '08:00:00 am', '', '', 'Active', '']],
    updateRows: [['Date','Time','Emp','Client','Hour','Status','Mis','Alerts','Fat','FC','Notes','Live'],
                 [D4, '09:15:00 am', 'Nesiya', 'Zingbus', '9', 'Updated', '', '0', 'No', '0', '', '50']],
    breakRows: [['h']], leaveMap: {}, overridesMap: {}, vehicleMap: {}, weekOffNames: new Set(),
  })
  const me = plan.byEmployee['Nesiya']
  const at9 = (me.hours[9] || []).map(c => c.client)
  ok(at9.includes('Zingbus'), 'work already recorded must not vanish when the client is hidden')
  ok(me.clientsDone <= me.clients,
     `${me.clientsDone} done against ${me.clients} assigned — a hidden client left the total incoherent`)
  console.log(`   ${me.clientsDone} of ${me.clients} done, and the finished Zingbus is still on the record`)
}

// ══ 14 · Two admins creating the same tab at once ══════════════════════
console.log('\n14 The tab race, and the write path')
{
  const sh = code('lib/sheets.js')
  ok(/if \(!\/already exists\/i\.test\(e\?\.message \|\| ''\)\) throw e/.test(sh),
     'two admins saving together both create the tab; the loser must not have their save fail for it')

  const red = code('pages/api/admin/apply-leave-redistribution.js')
  ok(/const hidden = hiddenClientsOn\(date\)/.test(red),
     'marking leave must not hand a hidden client to somebody, or write a redistribution row for it')
  ok(/distributeClientsForHour\(hour, withThem, vehicleMap, \{\}, false, hidden\)/.test(red) &&
     /distributeClientsForHour\(hour, withoutThem, vehicleMap, lockedWithoutEmp, false, hidden\)/.test(red),
     'both sides of the redistribution have to see the same day')

  const dp = code('lib/dayplan.js')
  ok(/auditHourAssignment\(hour, pool, vehicleMap, \{\}, true, hidden\)/.test(dp),
     'the audit inside the day plan must be given the same hidden set as the split')
  console.log('   the three places that could still have disagreed with the day')
}

// ══ 15 · "Put back" must work whatever case it was typed in ════════════
//
// The nastiest of the lot, and the same fault as check 11 wearing different
// clothes. Check 11 fixed the LOOKUP; this is the COLLAPSE that happens
// before it.
//
// Both tabs are append-only: removing something appends a row marked Removed
// and the parser keeps the last row per key. Keyed on the raw name, a "Hidden"
// row for "Zingbus" and a "Removed" row for "zingbus" are two different keys.
// Both survive, both canonicalise to the same client, and Hidden wins.
//
// The admin presses "Put back", is told it worked, and the client stays off
// every board — and out of the denominator, so no alarm fires either. The tab
// is hand-editable and this platform runs on spreadsheets people type into, so
// the two spellings genuinely occur.
console.log('\n15 Removing something that was typed in another case')
{
  floor({
    timings: [['Zingbus', '9'], ['Bharat Cabs', '9']],
    hidden: [
      [D4, 'Zingbus', '', 'Boss', '', 'Hidden'],
      [D4, 'zingbus', '', 'Boss', '', 'Removed'],     // put back, lower case
    ],
    notes: [
      ['Zingbus', '9', 'check driver cam', 'Boss', '', 'Active'],
      ['  ZINGBUS ', '9', '', 'Boss', '', 'Removed'], // removed, padded + upper
    ],
  })
  await loadScheduleData()

  ok(schedule.hiddenClientsOn(D4).size === 0,
     `"Put back" typed in another case did not put it back: ${JSON.stringify([...schedule.hiddenClientsOn(D4)])}`)
  ok(schedule.noteFor('Zingbus', 9) === null,
     'a note removed under a different capital is still in force')

  const on = schedule.distributeClientsForHour(9, ['Nesiya'], {}, {}, true, schedule.hiddenClientsOn(D4))
    .Nesiya.map(c => c.client)
  ok(on.includes('Zingbus'), `the client is still off every board: ${JSON.stringify(on)}`)

  // The collapse itself, directly — this is where the fault lived.
  const h = parseHidden([['Date','Client','Reason','By','At','Status'],
    [D4, 'Coral Tours', '', 'B', '', 'Hidden'],
    [D4, ' coral tours ', '', 'B', '', 'Removed'],
  ])
  ok(!h[D4] || !h[D4].size, 'parseHidden must collapse the two spellings onto one key')
  // One entry, not two — and it is the later row's text. The key it comes
  // back under is that row's own spelling; turning it into Client_Timings'
  // spelling is setScheduleData's job, checked above.
  const n = parseClientNotes([['Client','Hour','Note','By','At','Status'],
    ['Coral Tours', '9', 'first', 'B', '', 'Active'],
    ['CORAL TOURS', '9', 'second', 'B', '', 'Active'],
  ])
  ok(Object.keys(n).length === 1, `two spellings collapsed to ${Object.keys(n).length} entries, expected 1`)
  ok(Object.values(n)[0][9] === 'second', 'and the later note must win across spellings')
  console.log('   the last row wins whatever capital it was typed in')
}

// ══ 16 · The header, and the row that would have been eaten ════════════
//
// Both tabs are created on demand, and the parsers all skip row 1. A data row
// that lands there is not corrupted, it is INVISIBLE — the admin is told the
// client is off for the day and it never is.
//
// Two ways in, and the second needs no error at all:
//   · the loser of the create race returns early, appends onto row 1 of an
//     empty sheet, and the winner's header write to A1 overwrites it
//   · an admin arriving a moment AFTER the sheet was created but before its
//     header was written sees the tab in the listing, returns straight away,
//     and appends onto row 1 just the same
//
// Closed by making the header part of what "ensured" means: nobody leaves
// ensureTab until row one is on the sheet.
console.log('\n16 Nobody leaves ensureTab before the header is written')
{
  const sh = code('lib/sheets.js')
  const fn = (sh.match(/export async function ensureTab[\s\S]*?\n\}/) || [''])[0]

  ok(/values\.get\(\{ spreadsheetId, range: `\$\{tab\}!A1:A1` \}/.test(fn),
     'the header must be CHECKED, not assumed — an existing tab may have been created a moment ago')
  ok(!/if \(!\/already exists\/i\.test\(e\?\.message \|\| ''\)\) throw e\s*\n\s*seen\.add/.test(fn),
     'the "already exists" branch must not return before the header check')
  // The header write comes after the existence check, and both paths reach it.
  const iCheck = fn.indexOf('A1:A1')
  const iWrite = fn.indexOf('values.update')
  const iSeen  = fn.lastIndexOf('seen.add')
  ok(iCheck > 0 && iWrite > iCheck && iSeen > iWrite,
     'the order must be: exists → check header → write header → done')
  ok(/if \(!firstRow\.length \|\| !\(firstRow\[0\] \|\| ''\)\.toString\(\)\.trim\(\)\)/.test(fn),
     'and the header is only written when row one is genuinely empty, so it can never clobber data')
  console.log('   exists → check row 1 → write it if empty → only then return')
}

// ══ 17 · Dates that are not days, and days that have gone ══════════════
console.log('\n17 A date that cannot be hidden')
{
  floor({ timings: [['Zingbus', '9']] })
  await loadScheduleData()

  const nonsense = await api('POST', { kind:'hidden', action:'add', clients:['Zingbus'], dates:['99/99/2026'] })
  ok(nonsense.status === 400,
     '"99/99/2026" matches the pattern and is not a day — it would be written, hide nothing, and look like it worked')

  // The screen offers today and forward, but it works out "today" once when it
  // is opened, and this floor runs through the seven o'clock rollover. A tab
  // left open across it would let an admin change a day already settled.
  const past = await api('POST', { kind:'hidden', action:'add', clients:['Zingbus'], dates:['01/01/2020'] })
  ok(past.status === 400 && /already finished/.test(past.body.error || ''),
     'a day that has already finished cannot be taken off')

  // Undoing an old mistake must still be possible.
  const undo = await api('POST', { kind:'hidden', action:'remove', clients:['Zingbus'], dates:['01/01/2020'] })
  ok(undo.status === 200, 'removing an entry on a past day must still work, or an old mistake is permanent')

  const panel = code('components/tabs/ClientRulesPanel.js')
  ok(/setInterval\(\(\) => setFloorToday\(isoOf\(operatingToday\(\)\)\), 60000\)/.test(panel),
     'the screen re-checks the operating day, so a tab left open across 7am stops offering yesterday')
  // Compared as ISO, and the helper that does it EXISTS. Asserting only that
  // the call is written was worse than useless — see check 20.
  ok(/setDates\(ds => ds\.filter\(d => toISO\(d\) >= floorToday\)\)/.test(panel),
     'and dates already picked are compared as ISO — dd/mm/yyyy strings do not sort')
  ok(/const toISO = \(d\) =>/.test(panel), 'toISO must be defined in the file that calls it')
  console.log('   99/99 refused, a finished day refused, and undoing one still allowed')
}

// ══ 18 · A pin that does nothing reaches the Command Center ════════════
//
// The behaviour is right and silent: fourteen pins stopped working on the live
// book the day this landed, and the person who typed them had no way to find
// out. A row somebody wrote that quietly does nothing is its own kind of
// invisible — the same fault, one level up.
console.log('\n18 The refused pins are shown to somebody')
{
  const ov = code('pages/api/admin/overview.js')
  ok(/pinIssues: \[\s*\n\s*\.\.\.orphanedPins\(\),/.test(ov), 'the overview must report them')
  ok(/orphanedPins/.test(ov.split('\n')[8] || '') || /import \{[^}]*orphanedPins/.test(ov),
     'and import it')

  const ad = code('pages/admin.js')
  ok(/const pinIssues\s+= overview\?\.pinIssues \|\| \[\]/.test(ad), 'the screen must read it')
  ok(/title:'Fixed-client rows that do nothing'/.test(ad), 'and raise it beside the other things the sheet cannot deliver')
  ok(/rows: pinIssues\.map/.test(ad), 'listing each one by name, with its reason')
  console.log('   Employee_Hours rows that are ignored are named on the Command Center')
}

// ══ 19 · A tab has to be registered in BOTH maps ═══════════════════════
//
// Reported from the floor within a day of the last release: clicking "Client
// rules" showed the panel under a heading that said "Dashboard", and the row
// of section tabs vanished, so there was no way back.
//
// Neither is a rendering fault. A tab needs an entry in TAB_SECTION (which
// sidebar section it belongs to) and in TAB_META (its heading). Both fall back
// silently — TAB_SECTION to 'live', TAB_META to overview — so a tab with
// neither renders its content correctly under every signpost pointing
// somewhere else.
//
// This has happened before. The comment above TAB_SECTION says so, by name:
// "'stale' was missing". Adding a tab and forgetting the two maps is clearly
// the easy mistake, so it is checked rather than remembered.
console.log('\n19 Every tab knows which section and heading it belongs to')
{
  const fs = await import('fs')
  const adminSrc = fs.readFileSync('pages/admin.js', 'utf8')
  const sideSrc  = fs.readFileSync('components/Sidebar.js', 'utf8')

  // Any identifier, not just lowercase letters. `[a-z]+` quietly skipped
  // `clientRules`, `tab2` and `client_rules` — and the length guard below
  // would not have noticed, because twelve tabs is still more than eight. A
  // check written to stop exactly this bug cannot have its own scope depend
  // on how somebody spells the next tab.
  const tabs = [...(adminSrc.match(/const SECTION_TABS = \{[\s\S]*?\n\}/) || [''])[0]
    .matchAll(/value:\s*'([A-Za-z0-9_]+)'/g)].map(m => m[1])
  ok(tabs.length > 8, `only ${tabs.length} tabs found — this check is scanning nothing`)

  const meta    = (adminSrc.match(/const TAB_META = \{[\s\S]*?\n\}/) || [''])[0]
  const section = (sideSrc.match(/export const TAB_SECTION = \{[\s\S]*?\n\}/) || [''])[0]
  for (const t of tabs) {
    ok(new RegExp(`\\b${t}\\s*:`).test(meta),    `${t} has no TAB_META entry — its heading will say "Dashboard"`)
    ok(new RegExp(`\\b${t}\\s*:`).test(section), `${t} has no TAB_SECTION entry — the section tabs will vanish and strand it`)
  }
  console.log(`   ${tabs.length} tabs, each with a section and a heading`)
}

// ══ 20 · A function that is called must exist ══════════════════════════
//
// Check 17 asserted that a line CONTAINING `toISO(d)` was present in the
// panel. The line was present. The function was not — it exists in two other
// panels as a module-local const, exported from neither. The check passed
// BECAUSE the bug was there.
//
// It would have thrown at seven in the morning, and only then: the effect
// re-runs when the operating day changes and at no other time, and only if the
// admin had a date staged. ClientRulesPanel sits outside every ErrorBoundary
// on that page, so a ReferenceError there takes the whole Command Center to a
// blank screen — during night-shift handover.
//
// A source scan cannot tell whether a name resolves. So this one reads the
// file properly: every name called as a function must be imported, declared,
// a JS builtin or a CSS function. Verified by putting the fault back — it
// reports `toISO` by name.
console.log('\n20 Nothing calls a function that does not exist')
{
  const fs = await import('fs')
  const BUILTIN = new Set(['require','parseInt','parseFloat','String','Number','Boolean','Array','Object',
    'Set','Map','Date','JSON','Math','Promise','isNaN','isFinite','encodeURIComponent','decodeURIComponent',
    'setTimeout','clearTimeout','setInterval','clearInterval','fetch','alert','confirm','console','Error',
    'URLSearchParams','Blob','FormData','RegExp','Symbol','BigInt','structuredClone','queueMicrotask',
    'if','for','while','switch','catch','return','function','typeof','await','super','new','of','in',
    'async','else','do','try','yield','delete','void',
    // CSS function names, which appear in style strings
    'minmax','repeat','calc','translateX','translateY','rotate','scale','url','var','rgba','linear'])

  const undefinedCalls = (file) => {
    const raw = fs.readFileSync(file, 'utf8')
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
      .filter(l => !l.trim().startsWith('//')).join('\n')
    // Strings hold prose and CSS, and prose contains things like "the server
    // (…)". Scanning them for calls finds words, not code.
    //
    // But a template literal is BOTH. Blanking it whole threw away every call
    // inside a ${…}, and this codebase puts a lot of them there — including
    // one on pages/admin.js that a recent commit added. So the literal text is
    // dropped and the interpolations are kept, which is exactly the split
    // between prose and code.
    const bare = src
      .replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, '``')            // no interpolation: drop it all
      .replace(/`((?:[^`\\]|\\.)*)`/g, (_, body) =>              // otherwise keep only ${…}
        (body.match(/\$\{[^{}]*\}/g) || []).join(';'))
      .replace(/"(?:\\.|[^"\\])*"/g, '""')
      .replace(/'(?:\\.|[^'\\])*'/g, "''")
    const known = new Set(BUILTIN)
    for (const m of src.matchAll(/import\s+(?:([A-Za-z_$][\w$]*)\s*,?\s*)?(?:\{([^}]*)\})?\s*from/g)) {
      if (m[1]) known.add(m[1])
      ;(m[2] || '').split(',').forEach(x => { const n = x.split(/\s+as\s+/).pop().trim(); if (n) known.add(n) })
    }
    for (const m of src.matchAll(/(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1])
    for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1])
    for (const m of src.matchAll(/(?:const|let|var)\s*[\{\[]([^}\]]*)[\}\]]/g))
      m[1].split(',').forEach(x => { const n = x.split(':').pop().trim().replace(/^\.\.\./, ''); if (/^[A-Za-z_$][\w$]*$/.test(n)) known.add(n) })
    for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g))
      m[1].split(',').forEach(x => { const n = x.split('=')[0].trim().replace(/^\.\.\./, ''); if (/^[A-Za-z_$][\w$]*$/.test(n)) known.add(n) })
    for (const m of src.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^()]*)\)/g))
      m[1].split(',').forEach(x => { const n = x.split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) known.add(n) })
    for (const m of src.matchAll(/\(\s*\{([^}]*)\}\s*\)/g))
      m[1].split(',').forEach(x => { const n = x.split(/[:=]/)[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) known.add(n) })
    // Method definitions — a class's constructor(), render(), or an object's
    // shorthand method. These LOOK like calls at the start of a line and are
    // declarations; ErrorBoundary.js reported all four of React's lifecycle
    // methods as undefined until they were counted.
    for (const m of src.matchAll(/(?:^|\n)\s*(?:static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/g)) known.add(m[1])
    const bad = new Set()
    // Capitalised names as well. A helper called Fmt() is exactly as undefined
    // as one called fmt(), and JSX component names resolve the same way. The
    // known-set already carries every import and declaration, so this costs
    // nothing but catches a whole shape the lowercase-only scan let through.
    for (const m of bare.matchAll(/(^|[^.\w$\'"`])([A-Za-z][A-Za-z0-9_$]*)\s*\(/g))
      if (!known.has(m[2])) bad.add(m[2])
    return [...bad]
  }

  // Every screen, not a hand-picked seven. The list left out pages/dashboard.js
  // — the whole employee side — and components/Sidebar.js, which the commit
  // that introduced this check had itself edited.
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const path = `${dir}/${e.name}`
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(path)
    return e.name.endsWith('.js') && !path.includes('/api/') ? [path] : []
  })
  const screens = [...walk('components'), ...walk('pages')]
  for (const f of screens) {
    const bad = undefinedCalls(f)
    ok(bad.length === 0, `${f} calls ${bad.join(", ")} — not imported and not declared in the file`)
  }
  console.log(`   ${screens.length} screens read for names that do not resolve`)
}

// ══ 21 · Two rows for one client, and six unwatched hours ══════════════
//
// Found on the live book by going looking. "KARTHIKEYA TOURS AND TRAVELS" is
// written on two rows with DIFFERENT hours — "7, 12, 15, 19, 21, 0, 3, 5" and
// "10, 12, 14, 18, 22, 0, 2, 4, 6". Assigned by name, the second silently
// replaced the first, and six hours somebody had typed in were on nobody's
// board. Nothing said so: the client appeared on boards all day, so it looked
// entirely healthy.
//
// The union is the only reading where no typed hour is lost. It can be wrong
// the other way — a row meant to REPLACE and never deleted now adds hours — so
// the duplicate is reported rather than merged in silence.
console.log('\n21 One client on two rows loses nothing')
{
  const rows = [['Client','Hours'],
    ['KARTHIKEYA TOURS AND TRAVELS', '7, 12, 15, 19, 21, 0, 3, 5'],
    ['Zingbus', '9'],
    ['KARTHIKEYA TOURS AND TRAVELS', '10, 12, 14, 18, 22, 0, 2, 4, 6'],
    ['  zingbus  ', '13'],                       // same client, different case
  ]
  const t = parseTimings(rows)
  const k = t['KARTHIKEYA TOURS AND TRAVELS']
  ok(JSON.stringify(k) === JSON.stringify([0,2,3,4,5,6,7,10,12,14,15,18,19,21,22]),
     `hours came out as ${JSON.stringify(k)} — the second row is still overwriting the first`)
  ok(k.includes(7) && k.includes(15) && k.includes(19) && k.includes(21) && k.includes(3),
     'the hours only the FIRST row had are the ones that were being lost')

  ok(JSON.stringify(t['Zingbus']) === JSON.stringify([9, 13]),
     `a client written twice in different cases must merge, got ${JSON.stringify(t['Zingbus'])}`)
  ok(t['  zingbus  '] === undefined, 'and must not become a second client under the other spelling')

  const dups = duplicateTimingRows(rows)
  ok(dups.length === 2, `${dups.length} duplicates reported, expected 2`)
  ok(dups.find(d => /KARTHIKEYA/.test(d.client))?.rows === 2, 'the duplicate is named with how many rows it has')
  ok(duplicateTimingRows([['Client','Hours'], ['Zingbus', '9']]).length === 0,
     'a client on one row is not a duplicate')
  console.log(`   15 hours from two rows, and both rows reported so the sheet can be tidied`)
}

// ══ 22 · The EMPLOYEE column has the same name fault ═══════════════════
//
// The client names were fixed; the employee column was not. Found live:
// Employee_Hours rows 23 and 24 say "Kiran" while Credentials says "KIRAN", so
// both of that person's pins were doing nothing at all — stored under one
// spelling, looked up under another.
//
// It matters more for a custom duty than for a pin. A pinned client still
// reaches somebody through the ordinary rotation, but an hour set aside for
// training or calls that is not recognised hands that person a full board
// instead — the exact opposite of the instruction.
console.log('\n22 An employee name typed in another case is the same person')
{
  floor({
    timings: [['Zingbus', '5, 23'], ['Bharat Cabs', '5']],
    empHours: [
      ['Kiran', '5',  'Zingbus', ''],       // roster says KIRAN
      ['Kiran', '23', 'Zingbus', ''],
      [' nesiya ', '9', '', 'OFFLINE REPORTS'],
    ],
  })
  behaviour.data['Credentials!A:H'] = [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
    ['E1','KIRAN',  'x','employee','0','9','Yes','No'],
    ['E2','Nesiya', 'x','employee','8','17','No','No']]
  await loadScheduleData()

  ok(JSON.stringify(schedule.specificClientsFor('KIRAN', 5)) === '["Zingbus"]',
     'a pin typed as "Kiran" must reach the roster\'s "KIRAN"')
  ok(JSON.stringify(schedule.specificClientsFor('KIRAN', 23)) === '["Zingbus"]', 'both hours')
  ok(schedule.customTextFor('Nesiya', 9) === 'OFFLINE REPORTS',
     'a custom duty must be recognised too — unrecognised, the hour hands them a full board instead')

  // And a name the roster genuinely does not have is named, not guessed at.
  floor({ timings: [['Zingbus', '5']], empHours: [['Ghost Person', '5', 'Zingbus', '']] })
  await loadScheduleData()
  const orph = schedule.orphanedPins()
  ok(orph.some(o => o.name === 'Ghost Person' && /not on the roster/.test(o.reason)),
     'a row against somebody who is not on the roster must be reported')
  console.log('   "Kiran" reaches KIRAN, " nesiya " keeps her custom duty, a stranger is named')
}

// ══ 23 · Rows the parser cannot use at all ═════════════════════════════
//
// These never reach orphanedPins, because they are dropped before the
// schedule ever sees them — so they were the one kind of dead row nothing
// reported. Found live: a row naming two clients for "Nesiya" with the hour
// column left blank, doing nothing since the day it was typed.
console.log('\n23 A row with no usable hour is named, not dropped')
{
  const bad = unusableHourRows([['Employee','Hour','Fixed Clients','Custom Text'],
    ['Nesiya', '',   'INF_SSRVM NORTH, INF_SSRVM East', ''],   // the live one
    ['Sunil',  '9',  'Zingbus', ''],                            // fine
    ['',       '9',  'Zingbus', ''],                            // no name
    ['Mahesh', '99', 'Zingbus', ''],                            // not an hour
    ['Afzal',  '9',  '', ''],                                   // nothing to do
    ['',       '',   '', ''],                                   // an empty row is just empty
  ])
  ok(bad.length === 4, `${bad.length} unusable rows, expected 4 — ${JSON.stringify(bad.map(b => b.row))}`)
  ok(bad.find(b => b.name === 'Nesiya')?.reason.includes('must be 0-23'), 'the blank hour is named')
  ok(bad.find(b => b.reason === 'no employee name'), 'a row with no name is named')
  ok(bad.find(b => b.name === 'Mahesh'), 'an hour outside 0-23 is named')
  ok(bad.find(b => b.name === 'Afzal')?.reason === 'no clients and no custom text', 'a row that asks for nothing is named')
  ok(!bad.some(b => b.name === 'Sunil'), 'a usable row must not be reported')
  ok(bad.every(b => b.row >= 2), 'the row numbers are the ones the admin sees in the sheet')

  const ov = code('pages/api/admin/overview.js')
  ok(/unusableHourRows\(hourRows \|\| \[\]\)/.test(ov), 'and the Command Center reports them')
  ok(/duplicateTimingRows\(timingRows \|\| \[\]\)/.test(ov), 'along with the duplicated client rows')
  console.log('   four dead rows, each with the sheet row number and why')
}

// ══ 24 · The parser and the reporter read a row the same way ═══════════
//
// They measured "is this row usable" differently, and the gap was exactly the
// kind of row that most needed reporting. The parser splits the clients cell
// on commas and drops the blanks, so " , , " gives it nothing and the row is
// discarded. The reporter only trimmed the cell, and " , , " is not empty, so
// it called the row healthy.
//
// A row with the client names deleted but the commas left behind therefore did
// nothing AND was reported nowhere — the invisible dead row this reporter
// exists to abolish. One function decides now and both read its answer.
console.log('\n24 One reading of a row, for the parser and the reporter')
{
  const rows = [['Employee','Hour','Fixed Clients','Custom Text'],
    ['Nesiya', '9', ' , , ', ''],          // commas left behind
    ['Sunil',  '9', 'Zingbus', ''],
  ]
  const kept = parseEmployeeHours(rows)
  const said = unusableHourRows(rows)
  ok(!kept['Nesiya'], 'the parser still drops a row whose clients cell is only commas')
  ok(said.some(u => u.name === 'Nesiya'),
     'and the reporter must now name it — it was silent, which is the whole fault')
  ok(!said.some(u => u.name === 'Sunil'), 'a usable row is still not reported')

  // The shared reading, directly.
  ok(readHourRow(['Nesiya','9',' , , ','']).problem === 'no clients and no custom text',
     'readHourRow is the one place that decides')
  ok(readHourRow(['Sunil','9','Zingbus','']).problem === null, 'and passes a good row')
  ok(readHourRow(['','','','']).problem === 'empty', 'an empty row is empty, not a fault to report')

  // Every row the parser drops must be a row the reporter names, and vice
  // versa. That equality IS the fix; anything else is the same gap again.
  const mixed = [['Employee','Hour','Fixed','Custom'],
    ['A','9','X',''], ['B','','X',''], ['C','9',' , ',''], ['','9','X',''],
    ['D','99','X',''], ['E','9','','TRAINING'], ['','','',''],
  ]
  const parsedNames = new Set(Object.keys(parseEmployeeHours(mixed)))
  const namedRows   = new Set(unusableHourRows(mixed).map(u => u.row))
  mixed.slice(1).forEach((r, i) => {
    const rowNo = i + 2
    const usable = readHourRow(r).problem === null
    const isEmpty = readHourRow(r).problem === 'empty'
    if (isEmpty) return
    ok(usable ? !namedRows.has(rowNo) : namedRows.has(rowNo),
       `row ${rowNo} is ${usable ? 'usable but reported' : 'dropped but not reported'}`)
  })
  ok(parsedNames.has('A') && parsedNames.has('E'), 'the good rows are still parsed')
  console.log('   every dropped row is named, and every named row was dropped')
}

// ══ 25 · One person under two spellings, on the same hour ══════════════
//
// The roster matching was right, but the merge was not: spreading the hour
// maps replaced the whole cell, so the loser's clients vanished and nothing
// said so. Worse where the loser held a CUSTOM DUTY — "TRAINING" simply
// disappeared and the person was handed a full board for an hour that had been
// set aside, which is the exact opposite of the instruction, and the case this
// matching was fixed for in the first place.
console.log('\n25 Nothing is dropped when two spellings meet on one hour')
{
  floor({
    timings: [['Zingbus', '9'], ['Shatabdi', '9']],
    empHours: [['Kiran', '9', 'Zingbus', ''], ['KIRAN', '9', 'Shatabdi', '']],
  })
  behaviour.data['Credentials!A:H'] = [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
    ['E1','KIRAN','x','employee','0','9','Yes','No']]
  await loadScheduleData()

  const both = schedule.specificClientsFor('KIRAN', 9) || []
  ok(both.includes('Zingbus') && both.includes('Shatabdi'),
     `one of the two pins was dropped: ${JSON.stringify(both)}`)
  ok(schedule.nameClashes().some(c => c.name === 'KIRAN' && c.hour === 9),
     'and the clash must be reported, so the sheet gets tidied')

  // The custom duty, which is the case that actually costs somebody their hour.
  floor({
    timings: [['Zingbus', '9']],
    empHours: [['Kiran', '9', '', 'TRAINING'], ['KIRAN', '9', 'Zingbus', '']],
  })
  behaviour.data['Credentials!A:H'] = [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
    ['E1','KIRAN','x','employee','0','9','Yes','No']]
  await loadScheduleData()
  ok(schedule.customTextFor('KIRAN', 9) === 'TRAINING',
     'the custom duty must survive — losing it hands somebody a full board for an hour set aside')

  // Two roster entries that are the same name to the platform. Nobody loses a
  // client, but a pin written for one reaches the other, so it is named.
  floor({ timings: [['Zingbus', '9']], empHours: [['Kiran', '9', 'Zingbus', '']] })
  behaviour.data['Credentials!A:H'] = [['EmpID','Name','Pw','Role','Start','End','Night','WeekOff'],
    ['E1','Kiran','x','employee','0','9','Yes','No'],
    ['E2','KIRAN','x','employee','0','9','Yes','No']]
  await loadScheduleData()
  ok(schedule.nameClashes().some(c => /Credentials also has/.test(c.reason)),
     'two roster names that differ only in case must be reported')

  const ov = code('pages/api/admin/overview.js')
  ok(/\.\.\.nameClashes\(\)\.map/.test(ov), 'and the Command Center shows them')
  console.log('   both pins kept, TRAINING kept, and both kinds of clash named')
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
