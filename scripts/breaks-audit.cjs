// The Breaks tab: what is wrong with it, and putting it right.
//
// ── What went wrong ───────────────────────────────────────────────────
// Until the operating-day fixes, closing a break was not recognised as
// activity: the end time resolved twenty-four hours early, so it always lost
// to whatever came before it. The next poll therefore still saw a long
// silence and opened ANOTHER break, backdated to the same old moment. Press
// Resume, get a new row. Press it again, get another.
//
// The damage is one break recorded as dozens of rows sharing a start time,
// each with a slightly later end — and, separately, durations measured across
// the 07:00 boundary and inflated by a full day.
//
// ── What this does ────────────────────────────────────────────────────
//   TWINS      rows sharing employee + date + start time are one break. The
//              row with the LATEST end is kept and its duration recomputed;
//              the rest are marked superseded and zeroed. Nothing is deleted
//              and no start time is ever touched, so the trail survives.
//   DURATIONS  a surviving row whose minutes disagree with its own start and
//              end is corrected.
//   OVERLAPS   reported, never auto-changed. Which of two genuinely different
//              overlapping breaks was the real one is a judgement about
//              somebody's day, and the totals on screen already count
//              overlapping stretches once (see totalBreakMinutes).
//
// Every change goes out as ONE batch request, so it costs the floor a single
// unit of quota rather than hundreds while people are working.
//
//   node scripts/breaks-audit.cjs            # report + backup, writes nothing
//   node scripts/breaks-audit.cjs --apply    # then repair
const fs = require('fs')
const path = require('path')

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (!m) continue
  let v = m[2].trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  process.env[m[1]] = v
}
const { google } = require('googleapis')

const APPLY = process.argv.includes('--apply')
const DAY_START_HOUR = 7
const TAB = 'Breaks'

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

function parseISTDateTime(dateStr, timeStr) {
  const d = (dateStr || '').toString().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  const t = (timeStr || '').toString().trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)?$/i)
  if (!d || !t) return null
  let h = parseInt(t[1], 10)
  const ap = (t[4] || '').toLowerCase()
  if (ap === 'pm' && h !== 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return new Date(+d[3], +d[2] - 1, +d[1], h, parseInt(t[2], 10), parseInt(t[3], 10), 0)
}
function parseOperating(dateStr, timeStr) {
  const d = parseISTDateTime(dateStr, timeStr)
  if (!d) return null
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() + 1)
  return d
}
// The real stretch a row covers. An end at or just past 07:00 carries this
// operating day's date while belonging to the next one, so it resolves before
// its own start; adding the day back is what makes 04:39 → 07:00 read as 141
// minutes rather than 1581.
function spanOf(r, nowMs) {
  const s = parseOperating(r[2], r[3])
  if (!s) return null
  const open = (r[6] || '').toString().trim() === 'Active'
  if (open) return { start: s.getTime(), end: Math.max(s.getTime(), nowMs), open: true }
  const e = parseOperating(r[2], r[4])
  if (!e) return null
  let end = e.getTime()
  if (end < s.getTime()) end += 24 * 3600000
  return { start: s.getTime(), end, open: false }
}
const mins = (ms) => Math.round(ms / 60000)
const hm = (m) => `${Math.floor(m / 60)}h ${m % 60}m`

;(async () => {
  const api = google.sheets({ version: 'v4', auth })
  const id = process.env.CRM_SHEET_ID
  const res = await api.spreadsheets.values.get({ spreadsheetId: id, range: `${TAB}!A:H` })
  const rows = res.data.values || []
  const nowMs = Date.now()

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(__dirname, '..', `.breaks-backup-${stamp}.json`)
  fs.writeFileSync(backup, JSON.stringify(rows, null, 1))
  console.log(`\nBreaks tab: ${rows.length - 1} rows · backup ${path.basename(backup)}`)

  // Cols: 0 EmpId | 1 Name | 2 Date | 3 Start | 4 End | 5 Minutes | 6 Status | 7 Type
  // A row already marked superseded by an earlier run is history, not a
  // duplicate waiting to be dealt with. Counting it again would report work
  // still to do on a tab that is already clean.
  const superseded = (r) => (r[6] || '').toString().startsWith('Duplicate')
  // Each pass below corrects what the passes after it should see — capping a
  // row that ran over the next break has to be visible to the overlap rule,
  // or the overlap rule merges the very stretch that was just cut back. So
  // these are COPIES, corrected in place as we go. `rows` keeps the sheet as
  // it actually stands, which is what the "as recorded" column reports.
  const entries = rows.slice(1)
    .map((r, i) => ({ row: i + 2, r: [...r] }))
    .filter(x => !superseded(x.r))
  const supersededCount = rows.length - 1 - entries.length

  // Taken before anything is corrected, so the report can show what the sheet
  // says today against what it would say afterwards.
  const recordedByEmp = {}
  entries.forEach(({ r }) => {
    const n = (r[1] || '').toString().trim(); if (!n) return
    recordedByEmp[n] = (recordedByEmp[n] || 0) + (parseInt(r[5], 10) || 0)
  })

  // ── Group by the break they belong to ────────────────────────────────
  const groups = new Map()
  entries.forEach(({ row, r }) => {
    const key = [(r[0] || '').toString().trim(), r[2] || '', (r[3] || '').toString().trim()].join('|')
    ;(groups.get(key) || groups.set(key, []).get(key)).push({ row, r })
  })

  const fixes = new Map()        // row -> [end, minutes, status]
  let twins = 0, durations = 0
  const beforeByEmp = {}, afterByEmp = {}
  const survivors = []

  groups.forEach(list => {
    if (list.length > 1) {
      // The real break ran from this start until the LAST end recorded for it.
      list.sort((a, b) => {
        const ea = spanOf(a.r, nowMs), eb = spanOf(b.r, nowMs)
        return (ea ? ea.end : 0) - (eb ? eb.end : 0)
      })
      const keep = list[list.length - 1]
      list.slice(0, -1).forEach(({ row, r }) => {
        twins++
        fixes.set(row, [r[3], 0, 'Duplicate — superseded'])
      })
      survivors.push(keep)
    } else {
      survivors.push(list[0])
    }
  })

  // ── A break cannot still be running when the next one starts ─────────
  //
  // The 21 August damage, and it is the opposite shape to everything above.
  // A row went invisible at 02:37 pm, stayed Active all afternoon while seven
  // ordinary breaks were taken and resumed on top of it, and was finally
  // closed by End shift at 09:06 pm — 389 minutes, for a man who was working.
  //
  // Merging it into the breaks it spans, which is what the rule below would
  // do, would make it worse: one 389-minute stretch swallowing seven real
  // breaks. So it is CAPPED first.
  //
  // Starting another break is proof of being back at the desk — nothing else
  // can start one. So a finished row that runs past the start of the same
  // employee's next break on the same operating day is cut off there. The
  // start time is never touched, nothing is deleted, and the result is the
  // most that can honestly be claimed: away from when the break began until
  // the moment they were demonstrably back.
  //
  // Only finished rows. An Active row belongs to a shift that may still be
  // running and is left for the platform to close.
  let capped = 0
  {
    const perEmpDay = new Map()
    survivors.forEach(x => {
      const key = [(x.r[0] || '').toString().trim(), x.r[2] || ''].join('|')
      ;(perEmpDay.get(key) || perEmpDay.set(key, []).get(key)).push(x)
    })
    perEmpDay.forEach(list => {
      const spans = list.map(x => ({ x, s: spanOf(x.r, nowMs) })).filter(v => v.s)
      spans.sort((a, b) => a.s.start - b.s.start)
      for (let i = 0; i < spans.length; i++) {
        const cur = spans[i]
        if (cur.s.open) continue
        // The next break that starts AFTER this one began.
        const next = spans.slice(i + 1).find(v => v.s.start > cur.s.start)
        if (!next || cur.s.end <= next.s.start) continue
        const trimmed = mins(next.s.start - cur.s.start)
        capped++
        if (trimmed <= 0) {
          fixes.set(cur.x.row, [cur.x.r[3], 0, 'Duplicate — merged'])
          cur.x.r[4] = cur.x.r[3]; cur.x.r[5] = '0'; cur.x.r[6] = 'Duplicate — merged'
        } else {
          // The next break's own start time, as the sheet already writes it.
          fixes.set(cur.x.row, [next.x.r[3], trimmed, 'Completed'])
          cur.x.r[4] = next.x.r[3]; cur.x.r[5] = String(trimmed); cur.x.r[6] = 'Completed'
        }
        cur.s = spanOf(cur.x.r, nowMs) || cur.s
      }
    })
  }

  // ── Overlapping stretches are one stretch ────────────────────────────
  //
  // Two breaks with DIFFERENT start times can still overlap: one was opened
  // while another was already running, because nothing was polling for
  // somebody whose machine was off. Recording both means the same minutes are
  // counted twice.
  //
  // Merging them is not choosing between them. The person was away from the
  // earliest start to the latest end, and that single stretch is what
  // happened — it is also exactly what the screens now show, so this is what
  // makes the sheet's own column agree with them. The earliest row keeps the
  // stretch; the rest are marked superseded, never deleted.
  let merged = 0
  const openRows = new Set()
  const perEmpDate = new Map()
  survivors.forEach(x => {
    const key = [(x.r[0] || '').toString().trim(), x.r[2] || ''].join('|')
    ;(perEmpDate.get(key) || perEmpDate.set(key, []).get(key)).push(x)
  })
  const kept = []
  perEmpDate.forEach(list => {
    const withSpan = list.map(x => ({ ...x, s: spanOf(x.r, nowMs) })).filter(x => x.s)
    withSpan.sort((a, b) => a.s.start - b.s.start)
    let group = []
    const flush = () => {
      if (!group.length) return
      const first = group[0]
      const last  = group.reduce((m, x) => (x.s.end > m.s.end ? x : m), group[0])
      if (group.length > 1) {
        // An open break is left exactly as it is — it has not finished, so it
        // has no end to merge to.
        if (group.some(x => x.s.open)) { group.forEach(x => kept.push(x)); group = []; return }
        merged += group.length - 1
        fixes.set(first.row, [last.r[4], mins(last.s.end - first.s.start), 'Completed'])
        group.slice(1).forEach(x => fixes.set(x.row, [x.r[3], 0, 'Duplicate — merged']))
        kept.push({ ...first, s: { start: first.s.start, end: last.s.end, open: false } })
      } else {
        kept.push(first)
      }
      group = []
    }
    withSpan.forEach(x => {
      if (!group.length) { group = [x]; return }
      const curEnd = Math.max(...group.map(g => g.s.end))
      if (x.s.start < curEnd) group.push(x)
      else { flush(); group = [x] }
    })
    flush()
  })

  kept.forEach(({ row, r, s }) => {
    if (fixes.has(row) || !s || s.open) return
    const should = mins(s.end - s.start)
    const have = parseInt(r[5], 10)
    if (Number.isFinite(have) && have !== should) {
      durations++
      fixes.set(row, [r[4], should, r[6] || 'Completed'])
    }
  })

  // ── What the totals look like before and after ───────────────────────
  const union = (list) => {
    const sp = list.map(x => spanOf(x.r, nowMs)).filter(Boolean).sort((a, b) => a.start - b.start)
    let total = 0, cs = null, ce = null
    sp.forEach(x => {
      if (ce === null) { cs = x.start; ce = x.end; return }
      if (x.start > ce) { total += ce - cs; cs = x.start; ce = x.end } else ce = Math.max(ce, x.end)
    })
    if (ce !== null) total += ce - cs
    return mins(total)
  }
  Object.assign(beforeByEmp, recordedByEmp)
  const byEmp = {}
  survivors.forEach(x => {
    const n = (x.r[1] || '').toString().trim(); if (!n) return
    ;(byEmp[n] ||= []).push(x)
  })
  Object.entries(byEmp).forEach(([n, list]) => { afterByEmp[n] = union(list) })

  console.log(`\n  already marked superseded       ${supersededCount}`)
  console.log(`  duplicate rows for one break    ${twins}`)
  console.log(`  rows cut back to the next break  ${capped}`)
  console.log(`  overlapping rows merged into one ${merged}`)
  console.log(`  durations that disagree          ${durations}`)
  console.log(`  rows to correct                  ${fixes.size}`)

  console.log(`\nTotal break time recorded, per person:`)
  console.log(`  ${'employee'.padEnd(14)} ${'as recorded'.padStart(12)} ${'corrected'.padStart(12)}`)
  Object.keys(beforeByEmp).sort((a, b) => (beforeByEmp[b] || 0) - (beforeByEmp[a] || 0)).forEach(n => {
    const b = beforeByEmp[n] || 0, a = afterByEmp[n] || 0
    if (b === a) return
    console.log(`  ${n.padEnd(14)} ${hm(b).padStart(12)} ${hm(a).padStart(12)}`)
  })

  if (!APPLY) {
    console.log(`\nNothing written. Re-run with --apply.`)
    return
  }

  // ── Never touch a break that is still running ────────────────────────
  //
  // This runs against a live sheet with a shift on the floor. A row still
  // marked Active belongs to somebody who is away from their desk right now,
  // and the platform is about to close it the moment they press Resume. If
  // this wrote to it in the same second, one of the two writes would be lost
  // — and the one that matters is theirs, not ours.
  //
  // Anything skipped here is simply picked up by the next run, once the shift
  // has closed it normally.
  const isActive = (row) => ((rows[row - 1] || [])[6] || '').toString().trim() === 'Active'
  const skipped = [...fixes.keys()].filter(isActive)
  skipped.forEach(row => fixes.delete(row))
  if (skipped.length) {
    console.log(`\n  ${skipped.length} row(s) left alone — still on a break right now: ` +
                skipped.map(r => `${(rows[r - 1] || [])[1]} row ${r}`).join(', '))
  }

  // One batch. Columns E, F and G only — a start time is never touched.
  const data = [...fixes.entries()].map(([row, values]) => ({
    range: `${TAB}!E${row}:G${row}`, values: [values],
  }))
  console.log(`\nWriting ${data.length} rows in one batch…`)
  await api.spreadsheets.values.batchUpdate({
    spreadsheetId: id,
    requestBody: { valueInputOption: 'RAW', data },
  })
  console.log(`Done. Backup: ${path.basename(backup)}`)
})().catch(e => { console.error('\nFAILED:', e.message); process.exit(1) })
