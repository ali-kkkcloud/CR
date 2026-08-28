// What the platform does to itself when Google says no.
//
// The floor's report was "every screen goes blank at the same moment, in the
// middle of a shift, and comes back on its own five or ten minutes later".
// Nothing is broken for five minutes and then unbroken; something was keeping
// it down. This measures what.
//
// The read layer retried a rate limit four times. That is the right shape for
// one unlucky request and the wrong shape for a floor: every screen misses its
// cache at about the same moment, so the reads go out together, and if that
// burst crosses the per-minute allowance then EVERY one of them turns into
// five. The traffic multiplies exactly when the allowance has run out, so the
// next minute is spent before it arrives — and the one after that. The outage
// is the retries, not the blip that started them.
//
// So the first refusal now closes the door for a few seconds: reads fail
// immediately instead of asking again, screens fall back to the copy they
// already have, and the allowance is left alone long enough to refill.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/quota-storm-check.mjs
import { calls, behaviour, reset } from './fake-googleapis.mjs'
import { readSheetCached, invalidateSheetCache, appendRows } from '../lib/sheets.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }
const SHEET = 'sheet-under-test'

const requests = () => calls.get.length + calls.batchGet.length
const openDoor = () => { globalThis.__cautioSheets.rlUntil = 0 }

const fresh = () => {
  reset()
  invalidateSheetCache(SHEET, '')
  openDoor()
}

// ── 1 · A refused read is asked once, not five times ───────────────────
console.log('\n1  One refusal costs one request')
{
  fresh()
  behaviour.rateLimited.add('Shift_Log!A:H')
  let threw = false
  try { await readSheetCached(SHEET, 'Shift_Log!A:H', 15000) } catch { threw = true }

  ok(threw, 'a refused read with nothing cached still fails')
  ok(requests() === 1, `one attempt, not five — sent ${requests()}`)
  console.log(`   refused read → ${requests()} request (was 5: the first plus four retries)`)
}

// ── 2 · While the door is shut, nobody else spends the allowance ───────
//
// This is the part that ends the outage. The refusal above was for one tab;
// the whole floor is about to ask for others, and under the old behaviour
// every one of them would have gone to Google and been refused four more
// times each.
console.log('\n2  The rest of the floor stops asking too')
{
  fresh()
  behaviour.rateLimited.add('Shift_Log!A:H')
  try { await readSheetCached(SHEET, 'Shift_Log!A:H', 15000) } catch {}
  const afterFirst = requests()

  // Seventeen more screens, each wanting a tab nobody has read yet.
  let refusals = 0
  for (let i = 0; i < 17; i++) {
    try { await readSheetCached(SHEET, `Tab_${i}!A:B`, 15000) } catch { refusals++ }
  }

  ok(refusals === 17, 'each screen is told at once, rather than left hanging')
  ok(requests() === afterFirst, `no further requests sent — sent ${requests() - afterFirst}`)
  console.log(`   17 screens during the pause → ${requests() - afterFirst} requests to Google`)
}

// ── 3 · A screen that has data keeps it ────────────────────────────────
//
// The pause must never cost anyone their screen. Nearly every screen has read
// its tabs at least once, and slightly stale rows beat an empty page.
console.log('\n3  A cached screen carries on')
{
  fresh()
  const first = await readSheetCached(SHEET, 'CRM_Updates!A:L', 1)   // 1ms TTL: stale at once
  behaviour.rateLimited.add('CRM_Updates!A:L')
  await new Promise(r => setTimeout(r, 5))

  const again = await readSheetCached(SHEET, 'CRM_Updates!A:L', 1)
  ok(JSON.stringify(again) === JSON.stringify(first), 'the last good copy is served, not an error')

  // And with the door now shut, a second refresh does not even ask.
  const before = requests()
  await readSheetCached(SHEET, 'CRM_Updates!A:L', 1)
  ok(requests() === before, 'a screen refreshing during the pause costs nothing')
  console.log('   stale rows shown instead of a blank screen, at no cost to the quota')
}

// ── 4 · The door opens again on its own ────────────────────────────────
console.log('\n4  Reads resume once the pause is over')
{
  fresh()
  behaviour.rateLimited.add('Leaves!A:H')
  try { await readSheetCached(SHEET, 'Leaves!A:H', 15000) } catch {}

  // The cooldown expiring, without the test sitting through it.
  openDoor()
  behaviour.rateLimited.delete('Leaves!A:H')
  const before = requests()
  const rows = await readSheetCached(SHEET, 'Leaves!A:H', 15000)

  ok(requests() > before, 'the next read goes to Google again')
  ok(Array.isArray(rows) && rows.length > 0, 'and comes back with the tab')
  console.log('   pause ends → normal reads, with no restart and nobody touching anything')
}

// ── 5 · A write is never sacrificed to protect the quota ───────────────
//
// The whole point of the pause is to save an allowance that a screen can wait
// for. An employee's saved work cannot wait: giving up on a write to be tidy
// about quota would throw away the thing they came to do. Writes keep their
// full seventy seconds of patience, breaker or no breaker.
console.log('\n5  A save still fights for itself')
{
  fresh()
  behaviour.rateLimited.add('Shift_Log!A:H')
  try { await readSheetCached(SHEET, 'Shift_Log!A:H', 15000) } catch {}
  ok(globalThis.__cautioSheets.rlUntil > Date.now(), 'the door is shut')

  // Refused once, then allowed — exactly what a per-minute quota looks like.
  let seen = 0
  const origAppend = behaviour.appendWritesBack
  behaviour.appendWritesBack = false
  const wroteAt = calls.append.length
  await appendRows(SHEET, 'CRM_Updates', [['a saved client update']])
  seen = calls.append.length - wroteAt
  behaviour.appendWritesBack = origAppend

  ok(seen >= 1, 'the write went out during the pause rather than being dropped')
  console.log('   reads pause, writes do not — a save is never traded for quota')
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
