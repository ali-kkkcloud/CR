// The list and the detail pane must say the same thing about one client.
//
// Reported with a screenshot: the row read "Updated at 08:30:52 am by Nesiya"
// while the pane beside it, for the SAME client at the SAME moment, said
// "still not updated".
//
// Both were rendering the same idea from their own copy of the logic, and
// only the list had been fixed. The pane read `selDone` — this employee's own
// work in this slot — and never looked at updatedToday at all. So a client a
// colleague had already filled was announced as untouched.
//
// One function now, in lib/updateline.js, called by both. Two things are
// worth pinning: what the function says, and that the component still has no
// second copy of it — because the duplication IS the bug. Testing the
// function alone would have passed happily the whole time the screen was
// contradicting itself.
//
//   node --import ./scripts/test-hooks.mjs scripts/updateline-check.mjs
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  updateLine, updateChip, shortClock, updateRank, clockRank,
  RANK_NOT_UPDATED, RANK_NO_TIME,
} from '../lib/updateline.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const TAB  = join(HERE, '..', 'components', 'tabs', 'MyClientsTab.js')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

console.log('\n1  The reported case: filled by Nesiya at 08:30, now with somebody else')
{
  const elsewhere = { at: '08:30:52 am', by: 'Nesiya' }
  const line = updateLine({ mine: false, at: '', elsewhere, upcoming: false })
  ok(!/still not updated/i.test(line.text),
     `a client filled at 08:30 is still being called "${line.text}"`)
  ok(line.text === 'Updated at 08:30:52 am by Nesiya', `got "${line.text}"`)
  console.log(`   "${line.text}"`)
}

console.log('\n2  The four states, each said once')
{
  const mine = updateLine({ mine: true, at: '3:14:02 pm', elsewhere: null, upcoming: false })
  ok(mine.text === 'Updated at 3:14:02 pm' && mine.tone === 'done', `got "${mine.text}"`)

  const other = updateLine({ mine: false, at: '', elsewhere: { at: '9:05:00 am', by: 'Afzal' }, upcoming: false })
  ok(other.tone === 'elsewhere', `somebody else's update is toned "${other.tone}"`)

  // Somebody filled it but the sheet has no name against it. Still updated.
  const nameless = updateLine({ mine: false, at: '', elsewhere: { at: '9:05:00 am', by: '' }, upcoming: false })
  ok(nameless.text === 'Updated at 9:05:00 am', `got "${nameless.text}"`)

  const soon = updateLine({ mine: false, at: '', elsewhere: null, upcoming: true })
  ok(soon.text === 'Not started yet', `got "${soon.text}"`)

  // The only case that earns the red words.
  const late = updateLine({ mine: false, at: '', elsewhere: null, upcoming: false })
  ok(late.text === 'Still not updated' && late.tone === 'late', `got "${late.text}"`)
  console.log(`   mine · somebody else's · unnamed · not started · still not updated`)
}

console.log('\n3  My own work wins over anybody else\'s')
{
  // If I filled it in this slot, that is the newer fact and the one I need.
  const both = updateLine({
    mine: true, at: '11:20:00 am',
    elsewhere: { at: '08:30:52 am', by: 'Nesiya' }, upcoming: false,
  })
  ok(both.text === 'Updated at 11:20:00 am', `got "${both.text}"`)
  console.log(`   filled by me at 11:20 → mine shown, not Nesiya's 08:30`)
}

console.log('\n4  The board keeps no second copy of the rule')
{
  const src = readFileSync(TAB, 'utf8')
  // Comments are allowed to name the words — they explain the bug. Only code
  // may not.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  // The words themselves may only be written in one file. If they reappear
  // here, somebody has grown a second copy and the two halves can drift.
  ok(!/still not updated/i.test(code),
     'MyClientsTab.js writes "still not updated" itself instead of asking updateLine')
  ok(!/not started yet/i.test(code),
     'MyClientsTab.js writes "not started yet" itself instead of asking updateLine')

  // And both halves must actually ask: the list row (short) and the detail
  // pane (long). Different wording, same decision, neither made here.
  const calls = (src.match(/updateLine\(/g) || []).length
              + (src.match(/updateChip\(/g) || []).length
  ok(calls >= 2, `only ${calls} call site(s) — the pane and the list should both ask lib/updateline`)
  ok(/import \{ updateLine, updateChip, updateRank \} from '\.\.\/\.\.\/lib\/updateline'/.test(src),
     'MyClientsTab.js no longer imports the status helpers from lib')

  // The list row is two lines deep, not three: the vehicle count and the
  // status share ONE meta line. Split them again and the noise comes back.
  // Proved by position — the chip has to sit inside the same block as the
  // count, not in a block of its own further down.
  const chipAt  = code.indexOf('updateChip(')
  const countAt = code.lastIndexOf('vehicles', chipAt)
  ok(chipAt > 0 && countAt > 0 && chipAt - countAt < 400,
     'the status has moved out of the vehicle-count line into a row of its own')

  // Colour is part of the same rule. Hard-coded colours beside a status line
  // are how the list and the pane painted the same tone two different ways.
  ok(!/color:\s*done\s*\?/.test(code) && !/tone\s*===\s*'elsewhere'\s*\?/.test(code),
     'a status line is picking its own colour instead of using TONE_COLOUR')
  const tones = src.match(/TONE_COLOUR\[/g) || []
  ok(tones.length >= 2, `only ${tones.length} use(s) of TONE_COLOUR — both halves should use it`)

  // The pane's "somebody else" fact has to be derived, or it will fall
  // through to the red words no matter how good the helper is.
  ok(/selElsewhere/.test(src),
     'the detail pane never works out whether somebody else filled this client')
  console.log(`   one file owns the words · ${calls} call sites · one meta line · pane derives selElsewhere`)
}

console.log('\n4b The list says the same thing in fewer characters')
{
  const elsewhere = { at: '03:30:52 pm', by: 'Nesiya' }
  const long  = updateLine({ mine:false, at:'', elsewhere, upcoming:false })
  const short = updateChip({ mine:false, at:'', elsewhere, upcoming:false })

  ok(short.text === 'Updated 03:30 pm · Nesiya', `got "${short.text}"`)
  ok(short.tone === long.tone, `the two formatters disagree on tone: ${short.tone} vs ${long.tone}`)
  ok(short.text.length < long.text.length, 'the short form is not shorter')

  // Shorter, but it still has to SAY what happened at that time. A bare
  // "03:30 pm · Nesiya" beside a client is just a number on the screen.
  ok(/^Updated /.test(short.text), `the line no longer says it is an update: "${short.text}"`)

  // My own work, in the list.
  ok(updateChip({ mine:true, at:'11:20:00 am', elsewhere:null, upcoming:false }).text === 'Updated 11:20 am',
     'my own update is not being shortened')

  // The one line that must NOT be shortened — it is the point of the board.
  const late = updateChip({ mine:false, at:'', elsewhere:null, upcoming:false })
  ok(late.text === 'Still not updated' && late.tone === 'late', `got "${late.text}"`)
  ok(updateChip({ mine:false, at:'', elsewhere:null, upcoming:true }).text === 'Not started yet',
     'the not-started line was shortened')

  // Filled, but the sheet gave no name or no time. Still says "updated".
  ok(updateChip({ mine:false, at:'', elsewhere:{ at:'09:05:00 am', by:'' }, upcoming:false }).text === 'Updated 09:05 am',
     'a nameless update lost its time')
  ok(updateChip({ mine:false, at:'', elsewhere:{ at:'', by:'Hari' }, upcoming:false }).text === 'Updated · Hari',
     'an update with no time lost its name')
  ok(updateChip({ mine:false, at:'', elsewhere:{ at:'', by:'' }, upcoming:false }).text === 'Updated',
     'an update with neither time nor name is being called untouched')

  // shortClock hands back anything that isn't a clock, rather than mangling it.
  ok(shortClock('7:04:09 am') === '7:04 am', `got "${shortClock('7:04:09 am')}"`)
  ok(shortClock('later') === 'later' && shortClock('') === '', 'shortClock mangled a non-time')
  console.log(`   "${long.text}" → "${short.text}" · late line left alone`)
}

// ── the order the list is read in ───────────────────────────────────────
const order = (rows) => rows
  .map(r => ({ r, k: updateRank(r) }))
  .sort((a, b) => (a.k - b.k) || a.r.client.localeCompare(b.r.client))
  .map(x => x.r.client)

console.log('\n5  The case as it was asked for: five clients, two untouched')
{
  const rows = [
    { client:'C-noon',  mine:false, at:'', elsewhere:{ at:'12:04:00 pm', by:'Nikita' } },
    { client:'C-ten',   mine:false, at:'', elsewhere:{ at:'10:15:00 am', by:'Afzal'  } },
    { client:'C-open2', mine:false, at:'', elsewhere:null },
    { client:'C-eight', mine:false, at:'', elsewhere:{ at:'08:02:00 am', by:'Sunil'  } },
    { client:'C-open1', mine:false, at:'', elsewhere:null },
  ]
  const got = order(rows)
  ok(JSON.stringify(got) === JSON.stringify(
       ['C-open1','C-open2','C-eight','C-ten','C-noon']),
     `wrong order: ${got.join(' → ')}`)
  console.log(`   ${got.join(' → ')}`)
}

console.log('\n6  Untouched always outranks any update')
{
  ok(updateRank({ mine:false, at:'', elsewhere:null }) === RANK_NOT_UPDATED, 'untouched is not the top rank')
  // Earliest possible update of the operating day still sorts below it.
  ok(RANK_NOT_UPDATED < clockRank('07:00:00 am'), 'a 7 am update outranks an untouched client')
  // My own work is ranked by MY time, not by whoever touched it earlier.
  const mine = updateRank({ mine:true, at:'11:20:00 am', elsewhere:{ at:'08:30:52 am', by:'Nesiya' } })
  ok(mine === clockRank('11:20:00 am'), 'my own update is being ranked by somebody else’s time')
  console.log('   untouched → 7 am → … · mine ranked by my time')
}

console.log('\n7  The operating day, not the clock face')
{
  // 07:00 is the start of the day; everything before it belongs to the tail.
  ok(clockRank('07:00:00 am') < clockRank('11:00:00 pm'), '7 am should come before 11 pm')
  ok(clockRank('11:00:00 pm') < clockRank('02:00:00 am'),
     'a night shift 2 am is sorting to the top of the morning instead of the end of the day')
  ok(clockRank('12:00:00 am') > clockRank('11:59:00 pm'), 'midnight is sorting before the minute before it')
  ok(clockRank('12:30:00 pm') > clockRank('11:30:00 am'), 'half past noon is sorting before half past eleven')

  // Junk must not be read as a time and quietly ranked as 00:00.
  ok(clockRank('') === null && clockRank('later') === null && clockRank('25:00:00 am') === null,
     'a non-time is being parsed as a clock')
  ok(updateRank({ mine:true, at:'', elsewhere:null }) === RANK_NO_TIME,
     'an update with no time recorded is not sorting to the bottom')
  console.log('   7 am ‹ 11 pm ‹ 2 am · midnight and noon right way round · junk rejected')
}

console.log('\n8  Order does not change what an employee has')
{
  const rows = [
    { client:'B', mine:true,  at:'09:00:00 am', elsewhere:null },
    { client:'A', mine:false, at:'', elsewhere:null },
    { client:'C', mine:false, at:'', elsewhere:{ at:'09:00:00 am', by:'Hari' } },
  ]
  const got = order(rows)
  ok(got.length === rows.length, `${rows.length} clients went in, ${got.length} came out`)
  ok(new Set(got).size === rows.length, 'a client was duplicated or lost by the sort')
  // Same rank, so the name decides — and decides the same way every time.
  ok(order(rows).join() === order(rows.slice().reverse()).join(),
     'the order depends on what the sheet handed over, not on the rule')
  console.log('   nothing added, nothing lost, same order every time')
}

console.log('\n9  A follow-up keeps asking, from every tab')
{
  // A follow-up is somebody else's unfinished work, handed over at the end of
  // their shift. It has to be visible from wherever the person is working —
  // not only on the tab it lives on — and it has to still be visible an hour
  // later, which a badge that never moves is not.
  const dash  = readFileSync(join(HERE, '..', 'pages', 'dashboard.js'), 'utf8')
  const shell = readFileSync(join(HERE, '..', 'components', 'Shell.js'), 'utf8')
  const css   = readFileSync(join(HERE, '..', 'styles', 'globals.css'), 'utf8')

  // The header the bell sits in must stay pinned, or "every tab" is a lie the
  // moment somebody scrolls.
  ok(/position:'sticky'/.test(dash), 'the header is no longer sticky — the bell scrolls away')

  ok(/ring=\{footage\.followups\.length > 0\}/.test(dash),
     'the bell no longer rings when follow-ups are waiting')
  ok(/followups\.length > 0 \? 'followup'/.test(dash),
     'the bell no longer opens Follow-ups when follow-ups are waiting')
  // Nothing was taken away to make room: the count still covers both queues.
  ok(/count=\{footage\.pending\.length \+ footage\.followups\.length\}/.test(dash),
     'the bell stopped counting one of the two queues')

  ok(/className=\{ring \? 'bell-ring' : undefined\}/.test(shell), 'NotifyButton lost its ring')
  ok(/@keyframes bellRing/.test(css) && /\.bell-ring\b/.test(css), 'the bellRing animation is missing')
  ok(/prefers-reduced-motion[\s\S]{0,120}bell-ring[\s\S]{0,60}animation:\s*none/.test(css),
     'the bell shakes even for people who asked their system for less motion')
  console.log('   sticky header · rings on follow-ups · opens Follow-ups · both queues counted')
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
