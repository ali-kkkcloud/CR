// The idle sweep, and the guard that stopped it working at all.
//
// Reported live, twice, with somebody watching: an employee touched nothing
// for ten minutes and got no break; another switched their laptop off, came
// back after ten, and had none either.
//
// The guard that stops two requests opening the same break was being spent on
// merely CONSIDERING somebody, and never handed back. Anything that failed
// afterwards — above all the uncached read that guards the append, on a
// minute when the quota was gone — left the claim burnt, and for the next
// sixty seconds no sweep could open that person's break. With the sweep
// running on every request to the busiest endpoint, the claim was re-burnt
// before it could expire, so the break never appeared at all.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/sweep-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { setScheduleData } = await import('../lib/schedule.js')
const { sweepAutoBreaks, shouldSweepFloor } = await import('../lib/attendance.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const nowIST = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const NOW = nowIST()
const p2 = (n) => String(n).padStart(2, '0')
const clockOf = (d) => { let h = d.getHours(); const a = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return `${p2(h)}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${a}` }
const opDayOf = (d) => { const x = new Date(d); if (x.getHours() < 7) x.setDate(x.getDate() - 1); return `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}` }
const minsAgo = (m) => new Date(NOW.getTime() - m * 60000)

const EMP = [{ empId: 'E9', name: 'Naveen' }]
setScheduleData({
  employees: [{ empId: 'E9', name: 'Naveen', start: NOW.getHours(), end: (NOW.getHours() + 9) % 24, isNight: false }],
  timings: { X: [NOW.getHours()] },
  employeeHours: {},
})

// Clocked in three hours ago, last seen twenty-five minutes ago — well past
// the ten-minute threshold, and nothing else has happened since.
function floor() {
  reset()
  sheets.invalidateSheetCache('crm-book', '')
  // Cleared IN PLACE. lib/attendance captured this object when it loaded, so
  // replacing it here would leave the module holding the old one and every
  // claim from the previous case still standing.
  globalThis.__cautioAttendance.recentOpenings.clear()
  globalThis.__cautioAttendance.lastFloorSweep = 0
  const clockIn = minsAgo(180), lastSeen = minsAgo(25)
  behaviour.data = {
    'Shift_Log!A:H': [['EmpID','Name','Date','In','Out','','Status','Seen'],
      ['E9', 'Naveen', opDayOf(clockIn), clockOf(clockIn), '', '', 'Active', clockOf(lastSeen)]],
    'CRM_Updates!A:L': [['Date','Time','Emp','Client','Hour','Status','','','','','','']],
    'Breaks!A:H': [['EmpID','Name','Date','Start','End','Mins','Type','']],
    'Shift_Overrides!A:H': [['EmpID','Name','Date','Start','End','Type','','']],
  }
  return { clockIn, lastSeen }
}

// ── 1 · Twenty-five minutes of silence opens a break ───────────────────
console.log('\n1  Nothing recorded, nothing touched')
{
  const { lastSeen } = floor()
  const created = await sweepAutoBreaks(EMP)
  ok(created.length === 1, `${created.length} breaks opened, expected 1`)
  ok(created[0] && created[0][3] === clockOf(lastSeen),
     `the break should read from ${clockOf(lastSeen)}, got ${created[0] && created[0][3]}`)
  console.log(`   silent since ${clockOf(lastSeen)} → break opened, backdated to ${created[0][3]}`)
}

// ── 2 · A failed read must not cost the next attempt ───────────────────
// This is the reported fault. The read that guards the append fails; the
// break is not opened. The very next sweep must open it.
console.log('\n2  The guarding read fails, then succeeds')
{
  floor()
  // Only the UNCACHED read fails — the one taken immediately before the
  // append, to guard against two instances writing the same break. That is
  // the read that goes on a busy minute, and the one the claim was being
  // spent ahead of.
  behaviour.rateLimitedSingle = new Set(['Breaks!A:H'])
  let threw = false
  try { await sweepAutoBreaks(EMP) } catch { threw = true }
  ok(threw, 'a rate-limited read should surface, not be swallowed here')

  // The quota recovers. Nothing else has changed.
  behaviour.rateLimitedSingle = new Set()
  const created = await sweepAutoBreaks(EMP)
  ok(created.length === 1,
     `after a failed attempt the next sweep opened ${created.length} breaks — the claim was spent on a break that was never created`)
  console.log(`   read failed, then recovered → break opened on the next sweep`)
}

// ── 3 · The guard still stops a double ─────────────────────────────────
// The fix must not turn the guard off: two sweeps in a row, nothing changed
// in between, must not produce two rows.
console.log('\n3  Two sweeps in a row')
{
  floor()
  const first = await sweepAutoBreaks(EMP)
  ok(first.length === 1, `the first sweep opened ${first.length}`)
  // The fake does not write back, so the sheet still shows no open break —
  // exactly the window the in-memory guard exists to cover.
  const second = await sweepAutoBreaks(EMP)
  ok(second.length === 0, `the second sweep opened ${second.length} more — the guard is not holding`)
  console.log(`   first sweep 1 break, second sweep 0`)
}

// ── 4 · The floor-wide sweep is throttled, not constant ────────────────
console.log('\n4  How often the whole floor is swept')
{
  globalThis.__cautioAttendance.recentOpenings.clear()
  globalThis.__cautioAttendance.lastFloorSweep = 0
  const allowed = Array.from({ length: 40 }, () => shouldSweepFloor()).filter(Boolean).length
  ok(allowed === 1, `${allowed} of 40 back-to-back requests would sweep the whole floor; expected 1`)
  console.log(`   40 requests in the same instant → ${allowed} floor sweep`)
}

// ── 5 · Somebody at their screen is not put on a break ──────────────────
console.log('\n5  An employee who is actually working')
{
  floor()
  behaviour.data['Shift_Log!A:H'][1][7] = clockOf(minsAgo(2))   // seen two minutes ago
  sheets.invalidateSheetCache('crm-book', '')
  const created = await sweepAutoBreaks(EMP)
  ok(created.length === 0, `somebody seen two minutes ago was put on a break`)
  console.log(`   last seen 2 minutes ago → no break`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
