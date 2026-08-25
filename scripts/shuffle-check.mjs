// "Clients shuffle by themselves, and nobody started or ended a shift."
//
// Reported by the floor: mid-hour, clients move between people. Some
// disappear from a board, some appear on it, and the two events that are
// SUPPOSED to cause that — somebody clocking in, somebody clocking out —
// did not happen.
//
// ── What the split is actually built from ─────────────────────────────
//
// distributeClientsForHour is deterministic given its inputs: names are
// sorted, clients are sorted by fleet size, and the greedy always hands the
// next client to the least-loaded person. Same inputs, same answer, every
// time. So something was feeding it different inputs.
//
// It is the VEHICLE MAP. Fleet size decides both the sort order and the load
// balancing, so a client whose vehicle count is missing weighs 1 instead of
// 261 — and one client's weight changing moves work between people all the
// way down the hour.
//
// fetchClientVehicleCounts reads two tabs. If one failed it used to return
// the half-built map, and it needed no cache to do it: on Vercel every route
// is its own process, so a cold instance's first request has nothing cached
// and a transient failure there reshuffles the floor.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/shuffle-check.mjs
process.env.CRM_SHEET_ID = 'crm-book'
process.env.SOURCE_SHEET_ID = 'source-book'
process.env.ISSUE_TRACKER_SHEET_ID = 'issue-book'
process.env.JWT_SECRET = 'test-secret'

const { behaviour, reset } = await import('./fake-googleapis.mjs')
const sheets = await import('../lib/sheets.js')
const { setScheduleData, distributeClientsForHour } = await import('../lib/schedule.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const HOUR = 11
const PEOPLE = ['Afzal', 'CHANDAN', 'Nesiya', 'Sunil']
// Fleets of very different sizes: this is what makes the split lopsided, and
// what makes a missing count so damaging.
const FLEETS = {
  'Zingbus': 261, 'Shatabdi': 140, 'Turbotork': 96, 'Sarathi': 61,
  'Jai Vishnu': 40, 'Cityflo': 22, 'Nuego': 12, 'Rajdhani': 7,
}
const CLIENTS = Object.keys(FLEETS)

const timings = {}
CLIENTS.forEach(c => { timings[c] = [HOUR] })
setScheduleData({
  employees: PEOPLE.map((n, i) => ({ empId: `E${i+1}`, name: n, start: 7, end: 16, isNight: false })),
  timings, employeeHours: {},
})

const mapFrom = (names) => {
  const m = {}
  names.forEach(c => { m[sheets.vehicleKey(c)] = { originalName: c, vehicleCount: FLEETS[c] } })
  return m
}
// Who holds what, as a comparable string.
const shape = (dist) => Object.entries(dist)
  .map(([who, cs]) => `${who}: ${cs.map(c => c.client).sort().join(',')}`)
  .sort().join(' | ')

// ── 1 · The same inputs always give the same split ─────────────────────
//
// Before blaming anything else, rule out the distribution itself.
console.log('\n1  The split is deterministic')
{
  const full = mapFrom(CLIENTS)
  const first = shape(distributeClientsForHour(HOUR, PEOPLE, full, {}))
  let stable = true
  for (let i = 0; i < 50; i++) {
    if (shape(distributeClientsForHour(HOUR, PEOPLE, full, {})) !== first) stable = false
  }
  ok(stable, 'the same inputs produced two different splits — the greedy is not deterministic')
  console.log(`   50 runs, identical every time`)
}

// ── 2 · One missing vehicle count moves the whole hour ─────────────────
//
// The damage, measured. This is what the floor was seeing.
console.log('\n2  What a half-read vehicle map does')
{
  const full = mapFrom(CLIENTS)
  // The "Others" tab failed: everything it held now weighs 1.
  const half = mapFrom(CLIENTS.slice(0, 3))

  const a = distributeClientsForHour(HOUR, PEOPLE, full, {})
  const b = distributeClientsForHour(HOUR, PEOPLE, half, {})

  ok(shape(a) !== shape(b),
     'a half-read vehicle map produced the same split — this test proves nothing')

  // How many clients actually changed hands.
  const ownerOf = (dist) => {
    const o = {}
    Object.entries(dist).forEach(([who, cs]) => cs.forEach(c => { o[c.client] = who }))
    return o
  }
  const oa = ownerOf(a), ob = ownerOf(b)
  const moved = CLIENTS.filter(c => oa[c] !== ob[c])
  ok(moved.length > 0, 'nothing moved')
  console.log(`   ${moved.length} of ${CLIENTS.length} clients changed hands: ${moved.join(', ')}`)
  console.log(`   nobody clocked in, nobody clocked out — only the map differed`)
}

// ── 3 · A half-read map is never served ────────────────────────────────
//
// The fix. One tab unreadable and nothing cached: this must fail loudly
// rather than hand back a map that will quietly reshuffle the floor.
console.log('\n3  One source tab unreadable, nothing cached')
{
  const floor = () => {
    reset()
    sheets.invalidateSheetCache('source-book', '')
    globalThis.__cautioSheets.vehicle = { data: null, at: 0 }
    behaviour.data = {
      'Infants!A:B': [['Client','Vehicle'], ['Zingbus','KA-1'], ['Zingbus','KA-2']],
      'Others!A:B':  [['Client','Vehicle'], ['Shatabdi','KA-3']],
    }
    // The Others tab will not read at all — the shape a real failure takes.
    behaviour.broken = new Set(['Others!A:B'])
  }

  floor()
  let threw = null, got = null
  try { got = await sheets.fetchClientVehicleCounts() } catch (e) { threw = e }
  ok(threw !== null, `a half-read map was returned instead of failing: ${JSON.stringify(got)}`)
  ok(/unavailable/i.test(threw?.message || ''),
     `the error should say the counts are unavailable, got "${threw?.message}"`)
  console.log(`   refused: ${threw.message}`)
}

// ── 4 · A good map already in hand is served instead ────────────────────
//
// Failing is only right when there is nothing better. Once a complete map
// has been read, a later failure serves that rather than breaking a screen.
console.log('\n4  The same failure, with a good map already cached')
{
  reset()
  sheets.invalidateSheetCache('source-book', '')
  globalThis.__cautioSheets.vehicle = { data: null, at: 0 }
  behaviour.data = {
    'Infants!A:B': [['Client','Vehicle'], ['Zingbus','KA-1'], ['Zingbus','KA-2']],
    'Others!A:B':  [['Client','Vehicle'], ['Shatabdi','KA-3']],
  }
  const good = await sheets.fetchClientVehicleCounts()
  ok(Object.keys(good).length === 2, `expected 2 clients in the good map, got ${Object.keys(good).length}`)

  // Now the Others tab stops reading, and the cached map has expired.
  sheets.invalidateSheetCache('source-book', '')
  globalThis.__cautioSheets.vehicle = { ...globalThis.__cautioSheets.vehicle, at: 0 }
  behaviour.broken = new Set(['Others!A:B'])

  const served = await sheets.fetchClientVehicleCounts()
  ok(Object.keys(served).length === 2,
     `the last good map should still be served; got ${Object.keys(served).length} clients`)
  ok(served[sheets.vehicleKey('Shatabdi')]?.vehicleCount === 1,
     'the client from the failed tab lost its count — the split would move')
  console.log(`   last good map served · Shatabdi still weighs 1 vehicle, not zero`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
