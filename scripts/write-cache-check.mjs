// Writing to a tab without throwing the whole tab away.
//
// Every write used to drop the cached copy of the tab it touched, so the next
// reader fetched all of it back from Google. On CRM_Updates that is the hot
// path of the platform: a floor of eighteen saves a client every few seconds,
// and each save discarded a 3,700-row tab that the very next save — and every
// dashboard poll behind it — then had to fetch again. Against an allowance of
// 60 read requests a minute for the whole floor, that is most of it.
//
// We know exactly what changed, because we changed it. So it is applied to the
// copy in memory instead.
//
// The danger this has to be held to is precise. Callers find a row by its
// POSITION in the cached copy and then write to that row NUMBER — see
// /api/crm/update. A cached copy that is short by one row does not merely go
// stale: it aims a write at the wrong row, and the wrong row is somebody
// else's work. So the patch has to refuse whenever the copy is out of step.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/write-cache-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, calls, reset } = await import('./fake-googleapis.mjs')
const {
  readSheetCached, appendRow, updateRowCells, invalidateSheetCache, TTL,
} = await import('../lib/sheets.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const RANGE = 'CRM_Updates!A:L'
const row = (n) => ['21/08/2026', '09:00:00 am', 'Mantu', `Client ${n}`, '9', 'Completed', '', '0', 'No', '0', '', '5']

function floor(rows = 3) {
  reset()
  invalidateSheetCache('crm-book', '')
  behaviour.data = {
    [RANGE]: [['Date','Time','Emp','Client','Hour','Status','Mis','Alerts','Fat','FCount','Notes','Live'],
              ...Array.from({ length: rows }, (_, i) => row(i + 1))],
  }
}

const readsSent = () => calls.get.length + calls.batchGet.length

// ── 1 · An append leaves the tab usable ────────────────────────────────
console.log('\n1  Appending a row')
{
  floor()
  const before = await readSheetCached('crm-book', RANGE, TTL.LIVE)
  const readsAfterFirst = readsSent()
  ok(before.length === 4, `${before.length} rows read, expected 4`)

  await appendRow('crm-book', 'CRM_Updates', row(99), { cachedRange: RANGE })

  const after = await readSheetCached('crm-book', RANGE, TTL.LIVE)
  ok(readsSent() === readsAfterFirst, `reading after the append cost ${readsSent() - readsAfterFirst} more requests; it should cost none`)
  ok(after.length === 5, `${after.length} rows after the append, expected 5`)
  ok(after[4][3] === 'Client 99', `the appended row is not the one that was written: ${after[4][3]}`)
  console.log(`   3 rows → append → 4 rows, and no second trip to Google`)
}

// ── 2 · An update lands on the row it was aimed at ─────────────────────
console.log('\n2  Updating a row in place')
{
  floor()
  await readSheetCached('crm-book', RANGE, TTL.LIVE)
  const readsBefore = readsSent()

  // Sheet row 3 is the second data row — index 2 of the cached copy.
  const changed = row(2); changed[5] = 'All Good'; changed[7] = '4'
  await updateRowCells('crm-book', 'CRM_Updates', 3, 1, changed, { cachedRange: RANGE })

  const after = await readSheetCached('crm-book', RANGE, TTL.LIVE)
  ok(readsSent() === readsBefore, `reading after the update cost ${readsSent() - readsBefore} more requests; it should cost none`)
  ok(after[2][5] === 'All Good', `row 3 reads "${after[2][5]}", expected "All Good"`)
  ok(after[1][5] === 'Completed' && after[3][5] === 'Completed', 'a neighbouring row was changed')
  console.log(`   sheet row 3 updated in place, rows 2 and 4 untouched`)
}

// ── 3 · Only the named columns move ────────────────────────────────────
console.log('\n3  Updating part of a row')
{
  floor()
  await readSheetCached('crm-book', RANGE, TTL.LIVE)
  // Columns E and F only (startCol 5), the shape the break and shift writes use.
  await updateRowCells('crm-book', 'CRM_Updates', 2, 5, ['17', 'Reopened'], { cachedRange: RANGE })
  const after = await readSheetCached('crm-book', RANGE, TTL.LIVE)
  ok(after[1][4] === '17' && after[1][5] === 'Reopened', `columns E,F read ${after[1][4]},${after[1][5]}`)
  ok(after[1][0] === '21/08/2026' && after[1][3] === 'Client 1', 'a column outside the write was changed')
  console.log(`   columns E and F written, A–D and G–L untouched`)
}

// ── 4 · A copy that is out of step is thrown away, not repaired ────────
//
// THE one that matters. Another process appends a row we cannot see. Our
// cached copy is now short, and the position of a row in it no longer matches
// its row number in the sheet. Patching would leave a copy that aims the next
// write at the wrong row — which is somebody else's work.
console.log('\n4  Another process got there first')
{
  floor()
  await readSheetCached('crm-book', RANGE, TTL.LIVE)
  const readsBefore = readsSent()

  // The sheet has grown behind our back: our copy has 4 rows, so we would
  // predict the append lands on sheet row 5 — it lands on row 7.
  behaviour.data[RANGE] = [...behaviour.data[RANGE], row(50), row(51)]
  await appendRow('crm-book', 'CRM_Updates', row(99), { cachedRange: RANGE })

  const after = await readSheetCached('crm-book', RANGE, TTL.LIVE)
  ok(readsSent() > readsBefore, 'the stale copy was patched instead of being thrown away — the next write would land on the wrong row')
  // Six, not seven: the recorder does not write an append back into the sheet
  // it is standing in for (see fake-googleapis), so what comes back is the
  // header, the three rows we started with, and the two the other process
  // added. The point is that it came from the sheet rather than from a copy
  // that had quietly stopped matching it.
  ok(after.length === 6, `${after.length} rows after re-reading, expected 6 — the tab as the recorder holds it`)
  ok(after[4][3] === 'Client 50' && after[5][3] === 'Client 51', 'the rows the other process added are missing')
  console.log(`   the sheet moved underneath us → the copy was dropped and re-read`)
}

// ── 5 · Aiming outside the copy is refused ─────────────────────────────
console.log('\n5  Updating a row the copy does not have')
{
  floor()
  await readSheetCached('crm-book', RANGE, TTL.LIVE)
  const readsBefore = readsSent()
  // Sheet row 900 — far beyond the four rows in the cached copy.
  await updateRowCells('crm-book', 'CRM_Updates', 900, 1, row(900), { cachedRange: RANGE })
  await readSheetCached('crm-book', RANGE, TTL.LIVE)
  ok(readsSent() > readsBefore, 'a write outside the cached copy left the copy in place; it should have been dropped')
  console.log(`   row 900 is outside the copy → the copy was dropped and re-read`)
}

// ── 6 · A write does not extend how long the rest is trusted ───────────
//
// A write tells us about ONE row. If it refreshed the whole tab's clock,
// everybody else's rows would be trusted for another full window each time
// anybody saved — and on a busy floor somebody saves every few seconds, so
// the tab would never age out at all.
console.log('\n6  A write is not a read')
{
  floor()
  await readSheetCached('crm-book', RANGE, 120)   // a very short window
  const readsBefore = readsSent()
  await appendRow('crm-book', 'CRM_Updates', row(99), { cachedRange: RANGE })
  await new Promise(r => setTimeout(r, 200))      // past the window
  await readSheetCached('crm-book', RANGE, 120)
  ok(readsSent() > readsBefore, 'the tab was still being served from memory after its window had passed')
  console.log(`   the window expired on schedule despite the write`)
}

// ── 7 · Without being asked, nothing changes ───────────────────────────
console.log('\n7  A caller that does not opt in')
{
  floor()
  await readSheetCached('crm-book', RANGE, TTL.LIVE)
  const readsBefore = readsSent()
  await appendRow('crm-book', 'CRM_Updates', row(99))      // no cachedRange
  await readSheetCached('crm-book', RANGE, TTL.LIVE)
  ok(readsSent() > readsBefore, 'a write with no cachedRange should still drop the tab, as it always did')
  console.log(`   no cachedRange → the tab is dropped, exactly as before`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
