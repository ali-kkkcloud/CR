// The months worked before this platform existed, as reported from the old
// spreadsheets. Monthly totals: one row per employee per month.
//
//   node scripts/import-monthly-history.cjs
//
// TO ADD ANOTHER MONTH: add an array of [name, clients, completed, pending,
// vehicles, monitored] and list it in PERIODS with its label and dates. Names
// are matched to the roster case-insensitively, so MAHESH and Mahesh are one
// person; anybody who has since left keeps their months and is marked.
//
// Safe to re-run: the tab is REWRITTEN, never appended to, so running it twice
// cannot double-count. Every row is checked as it goes — completed + pending
// must equal the reported total, and any that does not is printed rather than
// written silently.
//
// Periods must not overlap the days the platform itself recorded, or the same
// work would be counted from both. August stops at the 18th for exactly that
// reason: the platform took over on the 19th.
const fs = require('fs')
const { google } = require('googleapis')
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trim().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }))
const auth = new google.auth.GoogleAuth({
  credentials: { client_email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

const HEADER = [
  'Label', 'From_Date', 'To_Date', 'Employee',
  'Total_Clients', 'Total_Completed', 'Total_Pending',
  'Total_Vehicles', 'Vehicles_Monitored', 'Source',
]

// [name, clients, completed, pending, vehicles, monitored]
const JUNE = [
  ['BRINDA', 328, 141, 187, 15877, 3344],
  ['CHANDAN', 8690, 3326, 5364, 87681, 16351],
  ['GUNASAGARI', 2650, 1216, 1434, 92367, 10074],
  ['HARI', 5978, 1710, 4268, 79742, 7154],
  ['KIRAN', 6277, 1535, 4742, 94612, 10046],
  ['MAHESH', 8630, 1868, 6762, 97930, 13898],
  ['MANTU', 8178, 2890, 5288, 85634, 13602],
  ['NAVEEN', 6604, 1695, 4909, 94190, 7022],
  ['NESIYA', 5635, 2330, 3305, 85391, 8387],
  ['RAKESH', 2408, 570, 1838, 34176, 1490],
  ['RISHI', 6169, 3677, 2492, 87915, 15906],
  ['RITANJALI', 676, 252, 424, 10027, 951],
  ['SHASHI', 7422, 3194, 4228, 90275, 18705],
  ['SUNIL', 6463, 3141, 3322, 88562, 20575],
  ['YUNUS', 2882, 1879, 1003, 34956, 8360],
]

const JULY = [
  ['BRINDA', 1310, 623, 687, 14978, 2245],
  ['CHANDAN', 7568, 3484, 4084, 92606, 20253],
  ['GUNASAGARI', 1268, 467, 801, 104974, 17276],
  ['HARI', 3470, 721, 2749, 46389, 3720],
  ['HARIPRASAD', 368, 171, 197, 25249, 6147],
  ['KIRAN', 7313, 2134, 5179, 111295, 8923],
  ['MAHESH', 5926, 1273, 4653, 83935, 6532],
  ['MANTU', 8546, 2510, 6036, 100697, 14611],
  ['NAVEEN', 5859, 3081, 2778, 94418, 21325],
  ['NESIYA', 6679, 3262, 3417, 99462, 12034],
  ['RAKESH', 4036, 1129, 2907, 71913, 15288],
  ['RISHI', 7424, 3616, 3808, 113225, 17162],
  ['RITANJALI', 4146, 1518, 2628, 55548, 5690],
  ['SHASHI', 5038, 2252, 2786, 72819, 17255],
  ['SUNIL', 6365, 2503, 3862, 104277, 18751],
  ['YUNUS', 9106, 2952, 6154, 87388, 10700],
]

const AUGUST = [
  ['Afzal', 1665, 932, 733, 25961, 5616],
  ['BRINDA', 2041, 1037, 1004, 27511, 4383],
  ['CHANDAN', 4980, 2718, 2262, 57846, 13470],
  ['Darshan', 1142, 562, 580, 15500, 2155],
  ['GUNASAGARI', 531, 248, 283, 43253, 7892],
  ['HARI', 2294, 677, 1617, 34131, 11292],
  ['KIRAN', 3004, 985, 2019, 42350, 8473],
  ['Mahesh', 3289, 1022, 2267, 46147, 5533],
  ['MANTU', 3698, 851, 2847, 38968, 4254],
  ['Naveen', 3239, 1518, 1721, 51279, 7725],
  ['Nesiya', 3100, 1885, 1215, 45111, 6368],
  ['Nikita', 957, 480, 477, 12805, 2131],
  ['Rakesh', 2772, 793, 1979, 47947, 9744],
  ['RISHI', 4899, 2035, 2864, 61438, 14748],
  ['Ritanjali', 1426, 543, 883, 19383, 1853],
  ['Shashi', 2238, 1150, 1088, 34694, 10157],
  ['Sunil', 2762, 1298, 1464, 51844, 12344],
  ['Yunus', 3873, 945, 2928, 46028, 2886],
]

const PERIODS = [
  { label: 'June 2026',   from: '01/06/2026', to: '30/06/2026', rows: JUNE },
  { label: 'July 2026',   from: '01/07/2026', to: '31/07/2026', rows: JULY },
  // Up to the 18th only — the platform takes over on the 19th, and an
  // overlapping day would be counted from both sides.
  { label: 'August 2026 (1–18)', from: '01/08/2026', to: '18/08/2026', rows: AUGUST },
]

;(async () => {
  const sheets = google.sheets({ version: 'v4', auth })
  const id = env.CRM_SHEET_ID
  const meta = await sheets.spreadsheets.get({ spreadsheetId: id })
  const names = meta.data.sheets.map(s => s.properties.title)

  if (!names.includes('Monthly_History')) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: 'Monthly_History' } } }] },
    })
    console.log('created Monthly_History')
  }

  // Every check that follows depends on there being exactly one row per
  // employee per period, so the tab is rewritten rather than appended to.
  await sheets.spreadsheets.values.clear({ spreadsheetId: id, range: 'Monthly_History!A:J' })

  const out = [HEADER]
  let bad = 0
  PERIODS.forEach(p => p.rows.forEach(([name, clients, completed, pending, vehicles, monitored]) => {
    if (completed + pending !== clients) {
      console.log(`  MISMATCH ${p.label} ${name}: ${completed} + ${pending} = ${completed + pending}, reported total ${clients}`)
      bad++
    }
    out.push([
      p.label, p.from, p.to, name,
      String(clients), String(completed), String(pending),
      String(vehicles), String(monitored), 'imported',
    ])
  }))

  await sheets.spreadsheets.values.update({
    spreadsheetId: id, range: `Monthly_History!A1:J${out.length}`,
    valueInputOption: 'RAW', requestBody: { values: out },
  })

  console.log(`wrote ${out.length - 1} rows across ${PERIODS.length} periods`)
  PERIODS.forEach(p => {
    const c = p.rows.reduce((s, r) => s + r[1], 0)
    const d = p.rows.reduce((s, r) => s + r[2], 0)
    const v = p.rows.reduce((s, r) => s + r[4], 0)
    const m = p.rows.reduce((s, r) => s + r[5], 0)
    console.log(`  ${p.label.padEnd(22)} ${String(p.rows.length).padStart(2)} people  ${String(c).padStart(7)} clients  ${String(d).padStart(7)} done  ${String(v).padStart(8)} vehicles  ${String(m).padStart(7)} monitored`)
  })
  console.log(bad === 0 ? 'every row adds up (completed + pending = total)' : `${bad} row(s) do not add up`)
})()
