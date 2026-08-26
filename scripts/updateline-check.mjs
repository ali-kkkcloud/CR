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
import { updateLine } from '../lib/updateline.js'

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

  // And both halves must actually call it: the list row and the detail pane.
  const calls = src.match(/updateLine\(/g) || []
  ok(calls.length >= 2,
     `only ${calls.length} call site(s) to updateLine — the pane and the list should both use it`)
  ok(/import \{ updateLine \} from '\.\.\/\.\.\/lib\/updateline'/.test(src),
     'MyClientsTab.js no longer imports updateLine from lib')

  // The pane's "somebody else" fact has to be derived, or it will fall
  // through to the red words no matter how good the helper is.
  ok(/selElsewhere/.test(src),
     'the detail pane never works out whether somebody else filled this client')
  console.log(`   one file owns the words · ${calls.length} call sites · pane derives selElsewhere`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
