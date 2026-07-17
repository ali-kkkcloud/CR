import { google } from 'googleapis'

function getAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

export async function getSheetsClient() {
  const auth = getAuth()
  return google.sheets({ version: 'v4', auth })
}

export const CRM_SHEET_ID    = process.env.CRM_SHEET_ID
export const ISSUE_SHEET_ID  = process.env.ISSUE_TRACKER_SHEET_ID
export const SOURCE_SHEET_ID = process.env.SOURCE_SHEET_ID || '1ZuDoyszorGsMCWtWP1-KTOBPxGSkcR-DxbKK5apZ9NU'

export const TABS = {
  CREDENTIALS:      'Credentials',
  SHIFT_LOG:        'Shift_Log',
  CRM_UPDATES:      'CRM_Updates',
  REDISTRIB:        'Redistribution_Log',
  LEAVES:           'Leaves',
  FOOTAGE_FOLLOWUP: 'Footage_Followup',
  BREAKS:           'Breaks',
}

export async function readSheet(spreadsheetId, range) {
  const sheets = await getSheetsClient()
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range })
  return res.data.values || []
}

export async function appendRow(spreadsheetId, tab, values) {
  const sheets = await getSheetsClient()
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: `${tab}!A1`,
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  })
}

export async function appendRows(spreadsheetId, tab, rowsArray) {
  if (!rowsArray.length) return
  const sheets = await getSheetsClient()
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: `${tab}!A1`,
    valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rowsArray },
  })
}

export async function updateRowCells(spreadsheetId, tab, row, startCol, values) {
  const sheets = await getSheetsClient()
  const colLetter = String.fromCharCode(64 + startCol)
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `${tab}!${colLetter}${row}`,
    valueInputOption: 'USER_ENTERED', requestBody: { values: [values] },
  })
}

export function todayStr() {
  return new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Kolkata'
  })
}

// Builds "hh:mm:ss am/pm" manually rather than trusting Intl's hour12
// behaviour. Some Node/ICU builds (seen on Vercel's production runtime)
// silently drop the am/pm designator for certain locale configs even when
// hour12:true is passed, which produced 24-hour strings like "17:57:36"
// with no am/pm — breaking every duration calc that parses this string.
export function nowStr() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  let h = d.getHours()
  const mi = String(d.getMinutes()).padStart(2, '0')
  const se = String(d.getSeconds()).padStart(2, '0')
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12; if (h === 0) h = 12
  return `${String(h).padStart(2, '0')}:${mi}:${se} ${ampm}`
}

export function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

export function parseISTDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null
  const parts = dateStr.split('/')
  if (parts.length !== 3) return null
  const [day, month, year] = parts.map(s => parseInt(s, 10))
  const t = timeStr.toString().trim()

  // Preferred: 12-hour "hh:mm:ss am/pm"
  let m = t.match(/(\d+):(\d+):(\d+)\s*(am|pm)/i)
  if (m) {
    let [, h, min, sec, ampm] = m
    h = parseInt(h, 10)
    if (ampm.toLowerCase() === 'pm' && h !== 12) h += 12
    if (ampm.toLowerCase() === 'am' && h === 12) h = 0
    return new Date(year, month - 1, day, h, parseInt(min, 10), parseInt(sec, 10))
  }

  // Fallback: bare 24-hour "hh:mm:ss" — covers any timestamps already
  // stored in the sheet from before this fix (no am/pm designator).
  m = t.match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
  if (m) {
    const [, h, min, sec] = m
    return new Date(year, month - 1, day, parseInt(h, 10), parseInt(min, 10), parseInt(sec, 10))
  }

  return null
}

export function calcDuration(dateStr, startTimeStr, endDateStr, endTimeStr) {
  const start = parseISTDateTime(dateStr, startTimeStr)
  const end   = parseISTDateTime(endDateStr || dateStr, endTimeStr)
  if (!start || !end) return '—'
  let diffMs = end - start
  if (diffMs < 0) diffMs += 24 * 3600000
  const h = Math.floor(diffMs / 3600000)
  const m = Math.floor((diffMs % 3600000) / 60000)
  return `${h}h ${m}m`
}

// Same as calcDuration but returns raw minutes (integer) — used for Breaks,
// where durations are short and admins want to sum/compare them numerically.
export function calcDurationMinutes(dateStr, startTimeStr, endDateStr, endTimeStr) {
  const start = parseISTDateTime(dateStr, startTimeStr)
  const end   = parseISTDateTime(endDateStr || dateStr, endTimeStr)
  if (!start || !end) return 0
  let diffMs = end - start
  if (diffMs < 0) diffMs += 24 * 3600000
  return Math.round(diffMs / 60000)
}

let _vehicleCache = null
let _vehicleCacheTime = 0
const VEHICLE_CACHE_TTL = 60000

export async function fetchClientVehicleCounts() {
  const now = Date.now()
  if (_vehicleCache && (now - _vehicleCacheTime) < VEHICLE_CACHE_TTL) return _vehicleCache
  const map = {}
  try {
    for (const tab of ['Infants', 'Others']) {
      let rows = []
      try { rows = await readSheet(SOURCE_SHEET_ID, `${tab}!A:B`) }
      catch (e) { console.error(`fetchClientVehicleCounts: tab ${tab}`, e.message); continue }
      for (let i = 1; i < rows.length; i++) {
        const clientName = (rows[i][0] || '').toString().trim()
        const vehicleNo   = (rows[i][1] || '').toString().trim()
        if (!clientName || !vehicleNo) continue
        const key = clientName.toLowerCase()
        if (!map[key]) map[key] = { originalName: clientName, vehicleCount: 0 }
        map[key].vehicleCount++
      }
    }
    _vehicleCache = map
    _vehicleCacheTime = now
  } catch (err) { console.error('fetchClientVehicleCounts error:', err) }
  return map
}

// ── Build leave map from Leaves tab for a given date ──
// Returns: { empName: [ {fromHour, toHour, reason} ] }
export async function getLeaveMapForDate(date) {
  const leaveMap = {}
  try {
    const rows = await readSheet(CRM_SHEET_ID, `${TABS.LEAVES}!A:H`)
    // Cols: EmpID | Name | Date | LeaveFrom_Hour | LeaveTo_Hour | Reason | MarkedBy | MarkedAt
    rows.slice(1)
      .filter(r => r[2] === date)
      .forEach(r => {
        const name = r[1]
        if (!leaveMap[name]) leaveMap[name] = []
        const fromHour = parseInt(r[3])
        const toHour   = parseInt(r[4]) // exclusive — employee excluded from this hour onwards
        if (!isNaN(fromHour)) leaveMap[name].push({ fromHour, toHour: isNaN(toHour) ? 24 : toHour, reason: r[5] || '' })
      })
  } catch (e) {
    console.error('getLeaveMapForDate error:', e.message)
  }
  return leaveMap
}
