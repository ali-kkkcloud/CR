// Why is this client still on somebody's board?
//
// READ ONLY. Nothing here writes, appends or updates anything.
//
// A client reaches a board by one of several routes, and removing it from
// Client_Timings only closes ONE of them. This says which route is keeping a
// given client alive.
//
//   node --env-file=.env.local scripts/why-client.mjs "Cityflo_Mumbai" 8
import { google } from 'googleapis'

const WANTED = (process.argv[2] || '').trim()
const HOUR   = process.argv[3] != null ? parseInt(process.argv[3], 10) : null
if (!WANTED) { console.error('usage: why-client.mjs "<client name>" [hour]'); process.exit(1) }

const ID = process.env.CRM_SHEET_ID
const api = google.sheets({ version: 'v4', auth: new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
}) })

async function patient(label, fn) {
  for (let i = 0; i < 6; i++) {
    try { return await fn() }
    catch (e) {
      const code = e?.code ?? e?.response?.status
      if (code !== 429 && code !== 503) throw e
      console.log(`  …the floor is using the allowance; waiting  (${label})`)
      await new Promise(r => setTimeout(r, 12000))
    }
  }
  throw new Error(`gave up on ${label}`)
}

const norm = (s) => (s || '').toString().replace(/\s+/g, ' ').trim().toLowerCase()
const target = norm(WANTED)

const p2 = (n) => String(n).padStart(2, '0')
const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
const opDay = (() => { const x = new Date(now); if (x.getHours() < 7) x.setDate(x.getDate() - 1); return `${p2(x.getDate())}/${p2(x.getMonth() + 1)}/${x.getFullYear()}` })()

const res = await patient('read', () => api.spreadsheets.values.batchGet({
  spreadsheetId: ID,
  ranges: ['Client_Timings!A:B', 'Employee_Hours!A:D', 'CRM_Updates!A:L', 'Redistribution_Log!A:G'],
}))
const [timings, empHours, updates, redist] = res.data.valueRanges.map(v => v.values || [])

console.log(`\nLooking for "${WANTED}"${HOUR != null ? ` at hour ${HOUR}` : ''} · operating day ${opDay}\n`)

// ── 1 · Client_Timings — the schedule itself ───────────────────────────
const inTimings = timings.slice(1).filter(r => norm(r[0]) === target)
console.log(`1. Client_Timings`)
if (inTimings.length === 0) console.log(`   not there — the schedule no longer delivers it`)
else inTimings.forEach(r => console.log(`   STILL THERE: hours "${r[1]}"`))

// ── 2 · Employee_Hours — a client named against a person ───────────────
// A named client is delivered whether or not the timings sheet mentions it.
const inEmpHours = empHours.slice(1).filter(r =>
  (r[2] || '').toString().split(',').some(c => norm(c) === target))
console.log(`\n2. Employee_Hours (fixed clients)`)
if (inEmpHours.length === 0) console.log(`   not named against anybody`)
else inEmpHours.forEach(r => console.log(`   STILL THERE: ${r[0]} hour ${r[1]} → "${r[2]}"`))

// ── 3 · CRM_Updates — a row already written for today ──────────────────
//
// This is the one people miss. A finished hour is worked out from the
// schedule AND from what was already recorded, with anything recorded PINNED
// to whoever recorded it — so work never moves off the person who did it.
// A row written before the client was removed keeps it on that board.
const todaysRows = updates.slice(1).filter(r => r[0] === opDay && norm(r[3]) === target)
console.log(`\n3. CRM_Updates rows for ${opDay}`)
if (todaysRows.length === 0) console.log(`   none`)
else {
  todaysRows.forEach(r => console.log(
    `   hour ${String(r[4]).padStart(2)} · ${r[2]} · status "${r[5] || ''}" · saved ${r[1] || '—'}`))
  const hours = [...new Set(todaysRows.map(r => r[4]))].join(', ')
  console.log(`   → pinned to hours: ${hours}`)
}

// ── 4 · Redistribution_Log — handed over during the day ────────────────
const redistRows = redist.slice(1).filter(r => r[0] === opDay && norm(r[4]) === target)
console.log(`\n4. Redistribution_Log for ${opDay}`)
if (redistRows.length === 0) console.log(`   none`)
else redistRows.forEach(r => console.log(`   hour ${r[5]} · ${r[2]} → ${r[3]}`))

// ── The verdict ────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────────────`)
if (inTimings.length) {
  console.log(`It is still in Client_Timings. The schedule is still delivering it.`)
} else if (inEmpHours.length) {
  console.log(`Removed from Client_Timings, but still NAMED against somebody in`)
  console.log(`Employee_Hours — a named client is delivered either way.`)
} else if (todaysRows.length) {
  console.log(`Removed from the schedule, but a CRM_Updates row for today already`)
  console.log(`carries it. Today's plan pins anything already recorded to whoever`)
  console.log(`recorded it, so it stays on that board for the rest of the day.`)
  console.log(`Tomorrow it will not appear.`)
} else {
  console.log(`Not in any of the four. If it is still on screen it is a cached`)
  console.log(`copy of the roster — Client_Timings is held for up to a minute.`)
}
