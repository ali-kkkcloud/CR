// What a call to the live book actually costs, and where the time goes.
//
// READ ONLY. Nothing here writes, appends or updates anything. It sends a
// handful of requests in total, deliberately — the floor is working and the
// allowance it is competing for is the thing being measured.
//
//   node --env-file=.env.local scripts/probe-live.mjs
import { google } from 'googleapis'

const ID = process.env.CRM_SHEET_ID
const mkAuth = () => new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

// The floor is live and at its limit, so a refusal here is expected. Wait it
// out rather than adding to the pile.
async function patient(label, fn) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const t = Date.now()
    try {
      const out = await fn()
      console.log(`  ${String(Date.now() - t).padStart(6)}ms  ${label}`)
      return out
    } catch (e) {
      const code = e?.code ?? e?.response?.status
      if (code !== 429 && code !== 503) throw e
      const wait = 12000
      console.log(`          …the floor is using the whole allowance; waiting ${wait / 1000}s  (${label})`)
      await new Promise(r => setTimeout(r, wait))
    }
  }
  throw new Error(`gave up on ${label}`)
}

// ── How big each tab is ────────────────────────────────────────────────
console.log('\nTab sizes')
{
  const api = google.sheets({ version: 'v4', auth: mkAuth() })
  const meta = await patient('spreadsheets.get (tab sizes)', () => api.spreadsheets.get({
    spreadsheetId: ID,
    fields: 'sheets.properties(title,gridProperties(rowCount,columnCount))',
  }))
  meta.data.sheets
    .map(s => ({ tab: s.properties.title, rows: s.properties.gridProperties.rowCount, cols: s.properties.gridProperties.columnCount }))
    .sort((a, b) => b.rows - a.rows)
    .forEach(r => console.log(`  ${r.rows.toString().padStart(8)} × ${String(r.cols).padStart(3)}   ${r.tab}`))
}

// ── A fresh auth client per call, which is what lib/sheets does today ──
console.log('\nA NEW auth client for every call (what lib/sheets does today)')
const fresh = []
for (let i = 0; i < 3; i++) {
  const t = Date.now()
  await patient(`read Shift_Log!A:H`, async () => {
    const api = google.sheets({ version: 'v4', auth: mkAuth() })
    return api.spreadsheets.values.get({ spreadsheetId: ID, range: 'Shift_Log!A:H' })
  })
  fresh.push(Date.now() - t)
}

// ── One client, reused ─────────────────────────────────────────────────
console.log('\nONE auth client, reused')
const reused = []
{
  const api = google.sheets({ version: 'v4', auth: mkAuth() })
  for (let i = 0; i < 3; i++) {
    const t = Date.now()
    await patient(`read Shift_Log!A:H`, () =>
      api.spreadsheets.values.get({ spreadsheetId: ID, range: 'Shift_Log!A:H' }))
    reused.push(Date.now() - t)
  }

  console.log('\nCRM_Updates — the tab every screen reads, and the save reads too')
  const whole = await patient('values.get CRM_Updates!A:L', () =>
    api.spreadsheets.values.get({ spreadsheetId: ID, range: 'CRM_Updates!A:L' }))
  console.log(`          ${(whole.data.values || []).length} rows came back`)
}

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
console.log(`\n  fresh client per call : ${med(fresh)}ms`)
console.log(`  one client reused     : ${med(reused)}ms`)
