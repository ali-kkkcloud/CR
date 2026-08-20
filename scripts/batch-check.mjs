// What the read layer costs, measured.
//
// Google's Sheets quota is counted in REQUESTS PER MINUTE, so the number that
// decides whether the platform stays up under load is not how fast a read is —
// it is how many the floor sends. This counts them, against a recorder that
// stands in for the Sheets client. No network, no credentials, no spreadsheet.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/batch-check.mjs
import { calls, behaviour, reset } from './fake-googleapis.mjs'
import { readSheetCached, invalidateSheetCache } from '../lib/sheets.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }
const SHEET = 'sheet-under-test'
const OTHER = 'a-different-sheet'

// Each run needs a cache with nothing in it, or the previous test's rows are
// simply handed back and nothing is measured.
const clearCache = () => {
  invalidateSheetCache(SHEET, '')
  invalidateSheetCache(OTHER, '')
}
const fresh = () => { reset(); clearCache() }

const requestCount = () => calls.get.length + calls.batchGet.length

// ── 1 · A screen's worth of tabs costs one request ─────────────────────
console.log('\n1  Six tabs, asked for at once')
{
  fresh()
  const want = ['Credentials!A:H', 'Shift_Log!A:H', 'Breaks!A:H',
                'CRM_Updates!A:L', 'Redistribution_Log!A:G', 'Leaves!A:H']
  const got = await Promise.all(want.map(r => readSheetCached(SHEET, r, 30000)))

  ok(requestCount() === 1, `six tabs cost ${requestCount()} requests, should be 1`)
  ok(calls.batchGet.length === 1 && calls.batchGet[0].length === 6,
     `expected one batch of six, got ${JSON.stringify(calls.batchGet)}`)
  // Every caller must get ITS OWN range back. Handing one tab's rows back as
  // another's would be worse than an error: nothing would look wrong.
  const mixedUp = want.filter((r, i) => got[i][1][0] !== `rows for ${r}`)
  ok(mixedUp.length === 0, `rows came back against the wrong range: ${mixedUp.join(', ')}`)
  console.log(`   6 tabs → ${requestCount()} request, each range correct`)
}

// ── 2 · Asking again inside the TTL costs nothing ──────────────────────
console.log('\n2  The same tabs again, a moment later')
{
  const before = requestCount()
  await Promise.all(['Credentials!A:H', 'Shift_Log!A:H', 'Breaks!A:L'].map(r => readSheetCached(SHEET, r, 30000)))
  // Breaks!A:L is a range nobody has asked for yet — one new request, and the
  // two already cached must cost nothing.
  ok(requestCount() - before === 1, `expected 1 new request for the one uncached range, got ${requestCount() - before}`)
  console.log(`   2 cached + 1 new → ${requestCount() - before} request`)
}

// ── 3 · Eighteen people polling at once still costs one ────────────────
// The floor is the real load: every dashboard asks for the same tabs within
// the same instant. They must share, not stampede.
console.log('\n3  The whole floor polling the same instant')
{
  fresh()
  const tabs = ['Shift_Log!A:H', 'CRM_Updates!A:L', 'Breaks!A:H']
  const floor = []
  for (let person = 0; person < 18; person++) {
    tabs.forEach(t => floor.push(readSheetCached(SHEET, t, 30000)))
  }
  await Promise.all(floor)
  ok(requestCount() === 1, `54 reads from 18 dashboards cost ${requestCount()} requests, should be 1`)
  console.log(`   18 dashboards × 3 tabs = 54 reads → ${requestCount()} request`)
}

// ── 4 · Two spreadsheets cannot be batched together ────────────────────
// batchGet takes one spreadsheet. The CRM sheet and the Issue Tracker are
// separate books and must stay separate calls — with each range still landing
// against the book it was asked from.
console.log('\n4  Two different spreadsheets')
{
  fresh()
  const [a, b] = await Promise.all([
    readSheetCached(SHEET, 'Shift_Log!A:H', 30000),
    readSheetCached(OTHER, 'Issues- Realtime!A:T', 30000),
  ])
  ok(requestCount() === 2, `two spreadsheets cost ${requestCount()} requests, should be 2`)
  ok(a[1][0] === 'rows for Shift_Log!A:H' && b[1][0] === 'rows for Issues- Realtime!A:T',
     'a range came back from the wrong spreadsheet')
  console.log(`   2 books → ${requestCount()} requests, one each`)
}

// ── 5 · One bad tab must not take down five good ones ──────────────────
console.log('\n5  A batch containing one unreadable tab')
{
  fresh()
  behaviour.broken = new Set(['Nonexistent_Tab!A:B'])
  const want = ['Shift_Log!A:H', 'Breaks!A:H', 'Nonexistent_Tab!A:B', 'CRM_Updates!A:L']
  const results = await Promise.allSettled(want.map(r => readSheetCached(SHEET, r, 30000)))

  const good = results.filter((r, i) => want[i] !== 'Nonexistent_Tab!A:B' && r.status === 'fulfilled')
  ok(good.length === 3, `${good.length} of the 3 healthy tabs survived a batch with one bad range`)
  ok(results[2].status === 'rejected', 'the unreadable tab should have raised, not returned empty')
  const correct = want.every((r, i) => r === 'Nonexistent_Tab!A:B' || results[i].value[1][0] === `rows for ${r}`)
  ok(correct, 'a healthy tab came back with the wrong rows after the fallback')
  console.log(`   3 healthy tabs served, 1 bad range raised`)
}

// ── 6 · A rate limit serves the last good copy, not a 500 ──────────────
// A read that gives up mid-shift is a screen full of nothing. What it had a
// moment ago is worth far more to the person looking at it.
console.log('\n6  A rate limit after something has already been read')
{
  fresh()
  const first = await readSheetCached(SHEET, 'Shift_Log!A:H', 1)   // TTL 1ms: always stale
  ok(first[1][0] === 'rows for Shift_Log!A:H', 'the first read did not come back')

  behaviour.rateLimited = new Set(['Shift_Log!A:H'])
  const second = await readSheetCached(SHEET, 'Shift_Log!A:H', 1)
  ok(second[1][0] === 'rows for Shift_Log!A:H',
     'a rate-limited refresh threw away the copy it already had')
  console.log(`   refresh rate-limited → last good copy served, no error`)
}

// ── 7 · A batch that fails outright still delivers ─────────────────────
console.log('\n7  The batch call itself fails')
{
  fresh()
  behaviour.failBatch = true
  const want = ['Shift_Log!A:H', 'Breaks!A:H', 'CRM_Updates!A:L']
  const got = await Promise.all(want.map(r => readSheetCached(SHEET, r, 30000)))
  ok(got.every((rows, i) => rows[1][0] === `rows for ${want[i]}`),
     'the single-read fallback did not deliver every range')
  ok(calls.get.length === 3, `expected 3 single reads after the batch failed, got ${calls.get.length}`)
  console.log(`   batch failed → 3 single reads, all ranges delivered`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
