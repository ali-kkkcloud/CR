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
  SHIFT_OVERRIDES:  'Shift_Overrides',
  CLIENT_TIMINGS:   'Client_Timings',
  EMPLOYEE_HOURS:   'Employee_Hours',
}

// Google's Sheets quota is per MINUTE, so a burst is a delay rather than a
// failure — but only if we wait it out. A shift change where a dozen people
// clock in within the same minute sails past 60 reads/user and every one of
// them used to surface as a 500 on somebody's screen.
//
// Retrying with a growing pause turns that into a request that takes a few
// seconds instead of one that fails. Only rate limits are retried; a bad
// range or a permission problem is a real error and is raised at once.
const RETRY_DELAYS_MS = [400, 1200, 3000, 7000]

function isRateLimited(err) {
  const code = err?.code ?? err?.response?.status
  if (code === 429 || code === 503) return true
  const msg = (err?.message || '').toLowerCase()
  return msg.includes('quota exceeded') || msg.includes('rate limit') || msg.includes('try again later')
}

async function withRetry(what, fn) {
  let lastErr
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isRateLimited(err)) throw err
      lastErr = err
      if (attempt === RETRY_DELAYS_MS.length) break
      const wait = RETRY_DELAYS_MS[attempt]
      console.warn(`sheets: rate limited on ${what}, retrying in ${wait}ms (attempt ${attempt + 1})`)
      await new Promise(r => setTimeout(r, wait))
    }
  }
  throw lastErr
}

export async function readSheet(spreadsheetId, range) {
  return withRetry(`read ${range}`, async () => {
    const sheets = await getSheetsClient()
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range })
    return res.data.values || []
  })
}

// ── Short-TTL cached reads ──────────────────────────────────────────────
// Every employee dashboard polls several endpoints on a 30s loop, and each
// endpoint re-reads the same handful of tabs. With a dozen-plus employees
// that trivially exceeds Google's Sheets API quota (300 reads/min/project,
// 60/min/user) and then EVERY endpoint starts returning 500 at once.
// This layer collapses those duplicate reads: identical (sheet, range)
// reads within the TTL reuse one result, and concurrent identical reads
// share a single in-flight request instead of each firing their own.
//
// Held on globalThis, not in module variables. Next compiles every API route
// into its own bundle, so each route was getting its OWN cache and its own
// in-flight map — around twenty private copies of a layer whose entire job is
// to make sure a tab is read once. The same Credentials tab was being fetched
// per route per TTL window instead of once, which is what actually exhausted
// the read quota: reads then failed, the roster fell back to a per-route
// last-good copy that a cold route did not have, and Full Day View and
// Employee Progress returned 500. One cache per process now.
const _G = globalThis.__cautioSheets || (globalThis.__cautioSheets = {
  readCache: new Map(),   // key -> { at, rows }
  inFlight:  new Map(),   // key -> Promise
  vehicle:   { data: null, at: 0 },
})
const _readCache = _G.readCache
const _inFlight  = _G.inFlight
const READ_TTL_MS = 20000

export async function readSheetCached(spreadsheetId, range, ttlMs = READ_TTL_MS) {
  const key = `${spreadsheetId}::${range}`
  const now = Date.now()

  const hit = _readCache.get(key)
  if (hit && (now - hit.at) < ttlMs) return hit.rows

  const pending = _inFlight.get(key)
  if (pending) return pending

  const p = (async () => {
    try {
      const rows = await readSheet(spreadsheetId, range)
      _readCache.set(key, { at: Date.now(), rows })
      return rows
    } finally {
      _inFlight.delete(key)
    }
  })()

  _inFlight.set(key, p)
  return p
}

// Call after writing to a tab so the next read reflects the write
// immediately rather than serving a stale cached copy.
export function invalidateSheetCache(spreadsheetId, rangePrefix) {
  for (const key of _readCache.keys()) {
    if (key.startsWith(`${spreadsheetId}::${rangePrefix}`)) _readCache.delete(key)
  }
}

export async function appendRow(spreadsheetId, tab, values) {
  await withRetry(`append to ${tab}`, async () => {
  const sheets = await getSheetsClient()
  await sheets.spreadsheets.values.append({
    spreadsheetId, range: `${tab}!A1`,
    // RAW (not USER_ENTERED) — keeps our "dd/mm/yyyy" and "hh:mm:ss am/pm"
    // strings as literal text. USER_ENTERED lets Sheets auto-detect these
    // as real dates/times and silently convert them to serial numbers,
    // which breaks every string-based date/time comparison in this app.
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  })
  })
  invalidateSheetCache(spreadsheetId, tab)
}

export async function appendRows(spreadsheetId, tab, rowsArray) {
  if (!rowsArray.length) return
  await withRetry(`append ${rowsArray.length} rows to ${tab}`, async () => {
    const sheets = await getSheetsClient()
    await sheets.spreadsheets.values.append({
      spreadsheetId, range: `${tab}!A1`,
      valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      requestBody: { values: rowsArray },
    })
  })
  invalidateSheetCache(spreadsheetId, tab)
}

export async function updateRowCells(spreadsheetId, tab, row, startCol, values) {
  await withRetry(`update ${tab}!${row}`, async () => {
    const sheets = await getSheetsClient()
    const colLetter = String.fromCharCode(64 + startCol)
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${tab}!${colLetter}${row}`,
      valueInputOption: 'RAW', requestBody: { values: [values] },
    })
  })
  invalidateSheetCache(spreadsheetId, tab)
}

// The operating day starts and ends at 07:00 IST, not at midnight.
//
// That is how the floor actually runs: a night shift that clocks in at ten in
// the evening and works through to six belongs, from first hour to last, to
// the day it began — and the calendar rolling over at midnight in the middle
// of it is an accident of the clock, not a change of working day.
//
// Every date written to and read from these sheets is this day, so a shift, its
// breaks, its updates and its attendance all carry one date from end to end.
// Before this, midnight split a night shift in half: half its work was filed
// under one date and half under the next, the admin's "today" emptied itself at
// midnight while people were still working, and every lookup had to carry a
// [today, yesterday] pair to paper over the seam.
export const DAY_START_HOUR = 7

export function businessDate(d) {
  const x = new Date(d.getTime())
  if (x.getHours() < DAY_START_HOUR) x.setDate(x.getDate() - 1)
  return `${String(x.getDate()).padStart(2,'0')}/${String(x.getMonth()+1).padStart(2,'0')}/${x.getFullYear()}`
}

export function todayStr() {
  return businessDate(nowIST())
}

// The operating day before this one. Not "24 hours ago": between midnight and
// seven that lands inside the current operating day and the two dates come out
// identical, which quietly halves every [today, yesterday] lookup exactly when
// a night shift needs both of them.
export function yesterdayStr() {
  const d = nowIST()
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1)
  d.setDate(d.getDate() - 1)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

// The day's hours in the order they actually happen: 7am first, 6am last.
// Ascending 0..23 would put a night shift's small hours at the start of the
// day they belong to the end of, which is how "has this hour finished yet?"
// gets answered backwards for everyone working past midnight.
export function businessHourOrder() {
  const out = []
  for (let h = DAY_START_HOUR; h < 24; h++) out.push(h)
  for (let h = 0; h < DAY_START_HOUR; h++) out.push(h)
  return out
}

// Has this hour of the current operating day already finished?
export function hourHasPassed(hour, nowHour = nowIST().getHours()) {
  const order = businessHourOrder()
  return order.indexOf(hour) < order.indexOf(nowHour)
}

// The hour of the day a "hh:mm:ss am/pm" clock string falls in.
function hourOfClock(t) {
  const m = (t || '').toString().trim().match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)?$/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const ap = (m[4] || '').toLowerCase()
  if (ap === 'pm' && h !== 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return { hour: h, minute: parseInt(m[2], 10) }
}

// Who was actually at work during a given hour of a day that has already been
// worked, reconstructed from the attendance log's own start and end times.
//
// A finished hour cannot be judged by who is clocked in NOW — by the evening
// that is nobody, which would report the whole day as having belonged to no
// one. The shift rows say who was there and when, so that is what decides it.
export function whoWasOnShiftAtHour(shiftLogRows, date, hour, nowHour = nowIST().getHours()) {
  const order = businessHourOrder()
  const target = order.indexOf(hour)
  if (target < 0) return new Set()

  const present = new Set()
  ;(shiftLogRows || []).slice(1).forEach(r => {
    if (r[2] !== date) return
    const name = (r[1] || '').toString().trim()
    if (!name) return
    const start = hourOfClock(r[3])
    if (!start) return
    // Still open: treat them as present right up to now.
    const end = r[4] ? hourOfClock(r[4]) : { hour: nowHour, minute: 59 }
    if (!end) return

    const si = order.indexOf(start.hour)
    let ei = order.indexOf(end.hour)
    // An end exactly on the hour means that hour was not worked.
    if (end.minute === 0 && ei > si) ei -= 1
    if (si < 0 || ei < 0) return
    // A shift can wrap the day's own order — somebody who clocked in at 3am and
    // worked to noon crosses the seven o'clock boundary, so their span runs off
    // the end of the ordered day and back onto the start of it.
    const covers = si <= ei
      ? (target >= si && target <= ei)
      : (target >= si || target <= ei)
    if (covers) present.add(name)
  })
  return present
}

// The moment an operating day begins, as a timestamp — used to decide whether
// something that happened at 03:00 belongs to the day now in progress.
export function businessDayStartMs(dateStr) {
  const [dd, mm, yyyy] = (dateStr || '').split('/').map(n => parseInt(n, 10))
  if (!dd || !mm || !yyyy) return null
  return new Date(yyyy, mm - 1, dd, DAY_START_HOUR, 0, 0, 0).getTime()
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

const VEHICLE_CACHE_TTL = 60000

export async function fetchClientVehicleCounts() {
  const now = Date.now()
  // Shared for the same reason as the read cache above — this one walks two
  // tabs of a second spreadsheet, so a private copy per route was among the
  // most expensive duplications of the lot.
  if (_G.vehicle.data && (now - _G.vehicle.at) < VEHICLE_CACHE_TTL) return _G.vehicle.data
  const map = {}
  try {
    for (const tab of ['Infants', 'Others']) {
      let rows = []
      try { rows = await readSheetCached(SOURCE_SHEET_ID, `${tab}!A:B`, 300000) }
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
    _G.vehicle = { data: map, at: now }
  } catch (err) { console.error('fetchClientVehicleCounts error:', err) }
  return map
}

// ── Build today's effective-shift overrides (Early Start / OT) ──
// Returns: { empName: { start, end, usedEarlyStart, usedOT } }
export async function getShiftOverridesForDate(date) {
  const map = {}
  try {
    const rows = await readSheetCached(CRM_SHEET_ID, `${TABS.SHIFT_OVERRIDES}!A:H`)
    // Cols: Date | EmpId | Name | NewStart | NewEnd | UsedEarlyStart(Yes/No) | UsedOT(Yes/No) | UpdatedAt
    rows.slice(1)
      .filter(r => r[0] === date)
      .forEach(r => {
        const name = r[2]
        map[name] = {
          start: parseInt(r[3]), end: parseInt(r[4]),
          usedEarlyStart: (r[5]||'').toLowerCase() === 'yes',
          usedOT: (r[6]||'').toLowerCase() === 'yes',
        }
      })
  } catch (e) {
    console.error('getShiftOverridesForDate error:', e.message)
  }
  return map
}
// Who is CLOCKED IN right now, from the Shift_Log rows.
//
// Client distribution is shared out between the people actually working,
// not everyone the roster lists — a slot handed to someone who never
// logged in (or who already went home) is a slot nobody updates. An
// employee counts as on-shift when their most recent Shift_Log row across
// the given dates reads "Active"; ending a shift flips it to "Ended" and
// drops them straight back out of the pool.
//
// `dates` should normally be [today, yesterday] so a night shift that
// began yesterday evening still counts after midnight rolls the date over.
//
// A row left reading "Active" for longer than any real shift can run is one
// somebody forgot to close, not somebody at their desk — the sheet has
// several of these going back months. Trusting them would put a person who
// stopped working days ago back into the split, handing them clients nobody
// then updates, so anything older than `maxShiftHours` is ignored. The cap
// allows a 9-hour shift plus 3 hours OT and a wide margin on top.
// Cols: EmpID | Name | Date | Start | End | Duration | Status | -
export function getOnShiftNamesFromLog(shiftLogRows, dates = [], maxShiftHours = 16) {
  const latestRow = {}
  const dateSet = new Set(dates.filter(Boolean))
  shiftLogRows.slice(1).forEach(r => {
    const name = (r[1] || '').toString().trim()
    if (!name || !dateSet.has(r[2])) return
    // Rows are append-only, so a later row is always the newer state.
    latestRow[name] = r
  })

  const nowMs = nowIST().getTime()
  const onShift = new Set()
  Object.entries(latestRow).forEach(([name, r]) => {
    if ((r[6] || '').toString().trim() !== 'Active') return
    const startedAt = parseISTDateTime(r[2], r[3])
    if (startedAt && (nowMs - startedAt.getTime()) / 3600000 > maxShiftHours) return
    onShift.add(name)
  })
  return onShift
}

// Who has already finished for the day.
//
// Not simply "everyone not on shift" — that would include people who haven't
// arrived yet, and they still belong in the split. This is the narrower set:
// employees whose latest row across these dates says the shift is over. They
// must stay out of the roster fallback, or an hour with nobody clocked in
// gets shared out to people who have gone home.
export function getClockedOutNamesFromLog(shiftLogRows, dates = []) {
  const latestRow = {}
  const dateSet = new Set(dates.filter(Boolean))
  shiftLogRows.slice(1).forEach(r => {
    const name = (r[1] || '').toString().trim()
    if (!name || !dateSet.has(r[2])) return
    latestRow[name] = r
  })
  const done = new Set()
  Object.entries(latestRow).forEach(([name, r]) => {
    if ((r[6] || '').toString().trim() === 'Active') return
    done.add(name)
  })
  return done
}

// Who is clocked in but not actually at their desk.
//
// Being on a break is not the same as having gone home, and for a couple of
// minutes it does not matter — reshuffling an hour the moment somebody stands
// up would hand their clients to a colleague and take them back again before
// anyone had touched either board. Past a threshold it matters a great deal:
// an auto-break that opened at 10:15 in the morning and is still open at seven
// in the evening means that employee has not been there all day, and every
// client the hour handed them has sat unwatched while the one person actually
// working was given a third of the floor.
//
// So an open break older than `minMinutes` counts as away, and away employees
// are left out of the split. Below the threshold nothing moves, which is what
// keeps a short break from churning two people's boards.
function nextDay(dateStr) {
  const [dd, mm, yyyy] = (dateStr || '').split('/').map(n => parseInt(n, 10))
  if (!dd || !mm || !yyyy) return dateStr
  const d = new Date(yyyy, mm - 1, dd)
  d.setDate(d.getDate() + 1)
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`
}

export function getAwayOnBreakNames(breakRows, dates = [], minMinutes = 20) {
  const dateSet = new Set(dates.filter(Boolean))
  const nowMs = nowIST().getTime()
  const away = new Set()
  ;(breakRows || []).slice(1).forEach(r => {
    const name = (r[1] || '').toString().trim()
    if (!name || !dateSet.has(r[2])) return
    if ((r[6] || '').toString().trim() !== 'Active') return
    // The row's date is the SHIFT date, not the calendar date the break
    // actually happened on. A break opened at 00:48 during a shift that began
    // the previous evening is stamped with the previous day — so reading the
    // time against that date alone puts it twenty-four hours in the past, and a
    // two-minute break reads as a day-long absence. That would have taken a
    // night-shift employee out of the split for stepping away after midnight.
    //
    // So each row's time is resolved against its own date AND the day after it,
    // and the most recent moment that is not in the future wins — the same rule
    // every other time in these sheets follows.
    let startedAt = null
    for (const d of dateSet) {
      for (const cand of [d, nextDay(d)]) {
        const p = parseISTDateTime(cand, r[3])
        if (!p) continue
        const t = p.getTime()
        if (t > nowMs + 120000) continue
        if (startedAt === null || t > startedAt) startedAt = t
      }
    }
    if (startedAt === null) return
    if ((nowMs - startedAt) / 60000 >= minMinutes) away.add(name)
  })
  return away
}

// The employee's currently-open shift, if they have one.
//
// A night shift started at 22:00 is logged under that day's date and is
// still the open shift at 02:00 the next morning, so the row has to be
// looked for across `dates` (normally [today, yesterday]) rather than
// today alone — otherwise everyone on nights is told their shift hasn't
// started the moment the clock passes midnight. Rows left Active for
// longer than any real shift can run are treated as forgotten, not open,
// so a months-old row can't masquerade as the current shift.
//
// Returns { row, rowNumber, date } or null. rowNumber is 1-based for the
// Sheets API.
export function findOpenShiftRow(shiftLogRows, empId, dates = [], maxShiftHours = 16) {
  const dateSet = new Set(dates.filter(Boolean))
  const wanted = (empId || '').toString().trim()
  const nowMs = nowIST().getTime()
  for (let i = shiftLogRows.length - 1; i >= 1; i--) {
    const r = shiftLogRows[i]
    if ((r[0] || '').toString().trim() !== wanted) continue
    if (!dateSet.has(r[2])) continue
    if ((r[6] || '').toString().trim() !== 'Active') continue
    const startedAt = parseISTDateTime(r[2], r[3])
    if (startedAt && (nowMs - startedAt.getTime()) / 3600000 > maxShiftHours) continue
    return { row: r, rowNumber: i + 1, date: r[2] }
  }
  return null
}

// Returns: { empName: [ {fromHour, toHour, reason} ] }
export async function getLeaveMapForDate(date) {
  const leaveMap = {}
  try {
    const rows = await readSheetCached(CRM_SHEET_ID, `${TABS.LEAVES}!A:H`)
    // Cols: EmpID | Name | Date | LeaveFrom_Hour | LeaveTo_Hour | Reason | MarkedBy | MarkedAt
    rows.slice(1)
      .filter(r => r[2] === date)
      .forEach(r => {
        const name = r[1]
        if (!leaveMap[name]) leaveMap[name] = []
        const fromHour = parseInt(r[3])
        const toHour   = parseInt(r[4]) // exclusive — employee excluded from this hour onwards
        if (!isNaN(fromHour)) leaveMap[name].push({
          fromHour, toHour: isNaN(toHour) ? 24 : toHour,
          reason: r[5] || '',
          markedBy: r[6] || '',
        })
      })
  } catch (e) {
    console.error('getLeaveMapForDate error:', e.message)
  }
  return leaveMap
}
