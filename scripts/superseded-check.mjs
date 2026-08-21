// The rows the repair left behind, and every screen that reads the Breaks tab.
//
// scripts/breaks-audit.cjs put one break back together out of the dozens of
// rows the operating-day faults had scattered it into. Nothing was deleted —
// somebody's attendance trail is not a thing to throw away — so the extras
// stay in the tab, marked "Duplicate — superseded" or "Duplicate — merged" at
// zero minutes.
//
// Which left a fault of my own making: nothing in the platform knew what that
// status meant. Every screen that lists breaks would have listed four hundred
// and fifty-four of them as "0m" sessions, and every session count on the
// floor would have read in the hundreds.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/superseded-check.mjs
process.env.CRM_SHEET_ID = process.env.CRM_SHEET_ID || 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = process.env.ISSUE_TRACKER_SHEET_ID || 'issue-book'
process.env.SOURCE_SHEET_ID = process.env.SOURCE_SHEET_ID || 'source-book'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret'

const { behaviour, reset } = await import('./fake-googleapis.mjs')
const { invalidateSheetCache } = await import('../lib/sheets.js')
const { signToken } = await import('../lib/auth.js')
const { isSupersededBreak, totalBreakMinutes } = await import('../lib/attendance.js')
const adminBreaks  = (await import('../pages/api/admin/breaks.js')).default
const breakStatus  = (await import('../pages/api/break/status.js')).default

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const p2 = (n) => String(n).padStart(2, '0')
const nowIST = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const NOW = nowIST()
// The operating day, which is what every date column in these sheets holds.
const opDayOf = (d) => { const x = new Date(d); if (x.getHours() < 7) x.setDate(x.getDate() - 1); return `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}` }
const clockOf = (d) => { let h = d.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${p2(h)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${a}` }
const minsAgo = (m) => new Date(NOW.getTime() - m * 60000)

const TODAY = opDayOf(NOW)

// One row of the Breaks tab: EmpID | Name | Date | Start | End | Mins | Status | Type
const brk = (start, end, mins, status, type = 'Auto', date = TODAY) =>
  ['E7', 'Mantu', date, clockOf(start), end ? clockOf(end) : '', mins === null ? '' : String(mins), status, type]

const BREAK_RANGE = 'Breaks!A:H'
const SHIFT_RANGE = 'Shift_Log!A:H'
const CRED_RANGE  = 'Credentials!A:H'
const MANTU = { name: 'Mantu', role: 'employee', empId: 'E7' }
const ADMIN = { name: 'Admin', role: 'admin', empId: 'A1' }

function floor(breakRows) {
  reset()
  invalidateSheetCache('crm-book', '')
  globalThis.__cautioAttendance?.recentOpenings?.clear()
  if (globalThis.__cautioAttendance) globalThis.__cautioAttendance.lastFloorSweep = Date.now()
  behaviour.data = {
    [BREAK_RANGE]: [['EmpID','Name','Date','Start','End','Mins','Status','Type'], ...breakRows],
    // On shift since this morning, seen a moment ago — so nothing here is put
    // on a break while the test is running.
    [SHIFT_RANGE]: [['EmpID','Name','Date','In','Out','','Status','Seen'],
      ['E7', 'Mantu', TODAY, clockOf(minsAgo(300)), '', '', 'Active', clockOf(minsAgo(1))]],
    [CRED_RANGE]:  [['EmpID','Name','Pass','Role'], ['E7', 'Mantu', 'x', 'employee']],
    'Sessions!A:E': [['EmpID','Name','SessionId','SignedInAt','Device']],
  }
}

async function ask(handler, user, query = {}) {
  const req = { method: 'GET', query, cookies: { cautio_token: signToken(user) }, headers: {} }
  let body = null, code = 200
  const res = {
    status(c) { code = c; return res },
    json(payload) { body = payload; return res },
    end() { return res },
  }
  await handler(req, res)
  return { body, code }
}

// ── 1 · What the status means, and what it does not ────────────────────
console.log('\n1  Reading the status')
{
  ok(isSupersededBreak([, , , , , , 'Duplicate — superseded']), '"Duplicate — superseded" should be history')
  ok(isSupersededBreak([, , , , , , 'Duplicate — merged into 07:31:00 pm']), '"Duplicate — merged …" should be history')
  ok(isSupersededBreak([, , , , , , '  Duplicate — merged ']), 'a padded status should still be read')
  ok(!isSupersededBreak([, , , , , , 'Completed']), 'a completed break is not history')
  ok(!isSupersededBreak([, , , , , , 'Active']), 'an open break is not history')
  ok(!isSupersededBreak([]), 'a row with no status at all must not throw')
  ok(!isSupersededBreak(null), 'no row at all must not throw')
  console.log('   only the two statuses the repair writes are treated as history')
}

// ── 2 · The total ignores them ─────────────────────────────────────────
console.log('\n2  Time away, counted')
{
  // The real break: twenty minutes. Beside it, four rows the repair
  // superseded, of the kind that used to read as an hour each.
  const rows = [
    brk(minsAgo(60), minsAgo(40), 20, 'Completed'),
    brk(minsAgo(59), minsAgo(39), 0, 'Duplicate — superseded'),
    brk(minsAgo(58), minsAgo(38), 0, 'Duplicate — merged into 07:31:00 pm'),
    brk(minsAgo(57), minsAgo(37), 0, 'Duplicate — superseded'),
    brk(minsAgo(56), minsAgo(36), 0, 'Duplicate — superseded'),
  ]
  const mins = totalBreakMinutes([null, ...rows], 'E7', [TODAY])
  ok(mins === 20, `twenty minutes away read as ${mins}`)
  console.log(`   1 real break + 4 superseded rows → ${mins}m`)
}

// ── 3 · An open row nobody ever closed ─────────────────────────────────
// Reported against a date range, an Active row from months back was being
// measured against today's clock — months of "break" for one forgotten row.
console.log('\n3  A leftover Active row from an old day')
{
  const old = new Date(NOW.getTime() - 40 * 24 * 3600000)
  const rows = [['E7', 'Mantu', opDayOf(old), clockOf(old), '', '', 'Active', 'Auto']]
  const mins = totalBreakMinutes([null, ...rows], 'E7', null)
  ok(mins <= 24 * 60, `a forty-day-old open row counted as ${mins} minutes — it should cap at a day`)
  ok(mins > 0, 'an open row should still count for something')
  console.log(`   open since 40 days ago → ${mins}m, capped at one day`)
}

// ── 4 · The employee's own screen ──────────────────────────────────────
console.log('\n4  What the employee sees on their own dashboard')
{
  floor([
    brk(minsAgo(120), minsAgo(105), 15, 'Completed', 'Manual'),
    brk(minsAgo(119), minsAgo(104), 0, 'Duplicate — superseded'),
    brk(minsAgo(118), minsAgo(103), 0, 'Duplicate — merged into 01:00:00 pm'),
    brk(minsAgo(60), minsAgo(50), 10, 'Completed'),
    brk(minsAgo(59), minsAgo(49), 0, 'Duplicate — superseded'),
  ])
  const { body } = await ask(breakStatus, MANTU)
  ok(body && body.history.length === 2, `${body && body.history.length} breaks listed, expected 2`)
  ok(body && body.history.every(h => !h.status.startsWith('Duplicate')), 'a superseded row was listed as a break')
  ok(body && body.totalMinutesToday === 25, `total read as ${body && body.totalMinutesToday}m, expected 25m`)
  console.log(`   5 rows in the tab → ${body.history.length} breaks, ${body.totalMinutesToday}m away`)
}

// ── 5 · The admin's Breaks screen ──────────────────────────────────────
console.log('\n5  What the admin sees')
{
  floor([
    brk(minsAgo(120), minsAgo(105), 15, 'Completed', 'Manual'),
    brk(minsAgo(119), minsAgo(104), 0, 'Duplicate — superseded'),
    brk(minsAgo(118), minsAgo(103), 0, 'Duplicate — merged into 01:00:00 pm'),
    brk(minsAgo(60), minsAgo(50), 10, 'Completed'),
    brk(minsAgo(59), minsAgo(49), 0, 'Duplicate — superseded'),
  ])
  const { body } = await ask(adminBreaks, ADMIN)
  ok(body && body.sessions.length === 2, `${body && body.sessions.length} sessions listed, expected 2`)
  const mantu = body && body.employees.find(e => e.name === 'Mantu')
  ok(mantu && mantu.sessions === 2, `Mantu credited with ${mantu && mantu.sessions} breaks, expected 2`)
  ok(mantu && mantu.totalMinutes === 25, `Mantu shown ${mantu && mantu.totalMinutes}m away, expected 25m`)
  console.log(`   5 rows in the tab → ${body.sessions.length} sessions, ${mantu.totalMinutes}m away`)
}

// ── 6 · The two screens agree ──────────────────────────────────────────
// Two breaks that OVERLAP — the shape that made the admin's figure and the
// employee's own figure disagree, because one summed the rows and the other
// took the union of the stretches.
console.log('\n6  Overlapping breaks, on both screens')
{
  const rows = [
    brk(minsAgo(90), minsAgo(60), 30, 'Completed'),
    brk(minsAgo(75), minsAgo(45), 30, 'Completed'),   // starts inside the first
  ]
  floor(rows)
  const mine = (await ask(breakStatus, MANTU)).body
  floor(rows)
  const theirs = (await ask(adminBreaks, ADMIN)).body
  const mantu = theirs.employees.find(e => e.name === 'Mantu')
  ok(mine.totalMinutesToday === 45, `the employee is shown ${mine.totalMinutesToday}m, expected 45m`)
  ok(mantu.totalMinutes === 45, `the admin is shown ${mantu.totalMinutes}m, expected 45m`)
  ok(mine.totalMinutesToday === mantu.totalMinutes, 'the two screens disagree about the same day')
  console.log(`   two 30m breaks overlapping by 15m → employee ${mine.totalMinutesToday}m, admin ${mantu.totalMinutes}m`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
