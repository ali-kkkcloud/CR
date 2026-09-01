// The order the work is handed out in, and who is told a client is waiting.
//
// Two reports from the floor, a day apart, both about the employee's own
// board:
//
//   · Looking back at an earlier day showed EVERY client as "Still not
//     updated", while the admin's Hour by hour showed the same clients plainly
//     done. Apple Bus on 29 August had two updates against it; the people who
//     had recorded them were being told on their own screen that nobody had.
//
//   · Pressing Submit opened whichever client came next IN THE SPREADSHEET,
//     not next in the list the person was looking at. The list was ordered and
//     the button was not, so the work arrived in an order nobody chose.
//
//   CAUTIO_FAKE_SHEETS=1 node --import ./scripts/test-hooks.mjs scripts/board-order-check.mjs
import fs from 'fs'
import { updateRank, RANK_NOT_UPDATED } from '../lib/updateline.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }
const src = f => fs.readFileSync(f, 'utf8')
const code = f => src(f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')

// The board's ordering, exactly as MyClientsTab applies it.
function inUpdateOrder(rows, { filled = {}, updatedToday = {} } = {}) {
  const rankOf = (c) => {
    const done = !!filled[c.client]
    return updateRank({
      mine: done,
      at: (filled[c.client]?.updatedAt || '').toString().trim(),
      elsewhere: done ? null : updatedToday[c.client],
    })
  }
  return rows
    .map(c => ({ c, r: rankOf(c) }))
    .sort((a, b) => (a.r - b.r) || a.c.client.localeCompare(b.c.client))
    .map(x => x.c)
}

const names = rows => rows.map(r => r.client)

// ══ 1 · The order itself ═══════════════════════════════════════════════
console.log('\n1  Untouched first, then oldest to newest')
{
  // Deliberately handed over in the sheet's order, which is none of the above.
  const rows = ['Apple Bus', 'Zingbus', 'Delta Fleet', 'Bharat Cabs', 'Coral Tours']
    .map(client => ({ client }))

  const updatedToday = {
    'Zingbus':     { at: '07:15:02 am', by: 'Sunil' },
    'Bharat Cabs': { at: '09:40:11 am', by: 'Afzal' },
    'Coral Tours': { at: '10:05:47 am', by: 'Nesiya' },
  }

  const got = names(inUpdateOrder(rows, { updatedToday }))
  ok(JSON.stringify(got) === JSON.stringify(
     ['Apple Bus', 'Delta Fleet', 'Zingbus', 'Bharat Cabs', 'Coral Tours']),
     `order came out as ${JSON.stringify(got)}`)

  ok(updateRank({ mine: false, at: '', elsewhere: null }) === RANK_NOT_UPDATED,
     'a client nobody has touched ranks above every updated one')
  console.log('   ' + got.join('  →  '))
}

// ══ 2 · Saving one moves it to the bottom ══════════════════════════════
console.log('\n2  The client just saved goes to the end, not somewhere random')
{
  const rows = ['Apple Bus', 'Zingbus', 'Delta Fleet', 'Bharat Cabs', 'Coral Tours']
    .map(client => ({ client }))
  const updatedToday = {
    'Zingbus':     { at: '07:15:02 am', by: 'Sunil' },
    'Bharat Cabs': { at: '09:40:11 am', by: 'Afzal' },
    'Coral Tours': { at: '10:05:47 am', by: 'Nesiya' },
  }

  // Apple Bus was at the top, untouched. The employee fills it at 10:31.
  const filled = { 'Apple Bus': { updatedAt: '10:31:09 am' } }
  const got = names(inUpdateOrder(rows, { filled, updatedToday }))

  ok(got[0] === 'Delta Fleet', 'the other untouched client is now at the top')
  ok(got[got.length - 1] === 'Apple Bus', 'the one just saved is last, being the newest')
  ok(JSON.stringify(got) === JSON.stringify(
     ['Delta Fleet', 'Zingbus', 'Bharat Cabs', 'Coral Tours', 'Apple Bus']),
     `order after saving came out as ${JSON.stringify(got)}`)
  console.log('   ' + got.join('  →  '))
}

// ══ 3 · A night shift's small hours belong at the end ═══════════════════
//
// The day runs 07:00 to 07:00, so 2 am is the LAST hour of it, not the first.
// Ranking on the clock alone would drag it to the top of a morning it is not
// part of.
console.log('\n3  2 am is the end of the day, not the start')
{
  const rows = ['Night Fleet', 'Dawn Cabs', 'Morning Bus'].map(client => ({ client }))
  const updatedToday = {
    'Morning Bus': { at: '08:12:00 am', by: 'Sunil' },
    'Night Fleet': { at: '11:40:00 pm', by: 'CHANDAN' },
    'Dawn Cabs':   { at: '02:15:00 am', by: 'KIRAN' },
  }
  const got = names(inUpdateOrder(rows, { updatedToday }))
  ok(JSON.stringify(got) === JSON.stringify(['Morning Bus', 'Night Fleet', 'Dawn Cabs']),
     `night order came out as ${JSON.stringify(got)}`)
  console.log('   ' + got.join('  →  '))
}

// ══ 4 · Submit walks the same order as the list ════════════════════════
console.log('\n4  Submit hands over the next one in the list, not in the sheet')
{
  const c = code('components/tabs/MyClientsTab.js')

  ok(/const inUpdateOrder = useCallback/.test(c),
     'the ordering is one function rather than a copy per caller')
  ok(/const pool = inUpdateOrder\(/.test(c),
     'the save-and-advance pool is ordered before "next" is taken from it')
  ok(!/const pool = realClients\.filter/.test(c),
     'nothing advances through the raw sheet order any more')
  ok(/return inUpdateOrder\(rows\)/.test(c),
     'the visible list asks the same function')
  console.log('   the list and the button read one order')
}

// ══ 5 · An earlier day answers about that day ══════════════════════════
console.log('\n5  Looking back asks the day being looked at')
{
  const myDay = code('pages/api/dashboard/my-day.js')
  ok(/updatedOn\[c\] = \{ at:/.test(myDay), 'my-day reports who updated each client that day')
  ok(/if \(r\[0\] !== date\) return/.test(myDay), 'and filters on the date being asked for')

  // Same shape as the live endpoint, or the board would read one and not the
  // other.
  const live = code('pages/api/clients/current.js')
  ok(/updatedToday\[c\] = \{ at: r\[1\] \|\| '', by: \(r\[2\] \|\| ''\)\.toString\(\)\.trim\(\) \}/.test(live) &&
     /updatedOn\[c\] = \{ at: r\[1\] \|\| '', by: \(r\[2\] \|\| ''\)\.toString\(\)\.trim\(\) \}/.test(myDay),
     'both build the same shape from the same columns')

  const dash = code('pages/dashboard.js')
  ok(/updatedToday=\{viewingPast \? \(pastDay\?\.updatedOn \|\| \{\}\) : updatedToday\}/.test(dash),
     'the board is handed the map for the day on screen')
  ok(!/updatedToday=\{updatedToday\}/.test(dash),
     "today's map is no longer passed for every day")
  console.log('   an earlier day no longer reports work nobody did as work nobody did')
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed\n`)
process.exit(fail === 0 ? 0 : 1)
