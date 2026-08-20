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
  // One row per employee per day — see lib/rollup.js. Two jobs: it keeps the
  // month's history readable without carrying every client-hour forever, and
  // it is where the years of work recorded before this platform existed go, in
  // exactly the same shape, so both read back through the same screens.
  DAILY_SUMMARY:    'Daily_Summary',
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

// A WRITE gets a much longer budget than a read, and the reason is not
// symmetry — it is what failure costs.
//
// A read that gives up is a panel that refreshes thirty seconds later. A
// write that gives up is an employee's work thrown away: they filled the
// form, pressed Save, and got "Could not save — try again" with the client
// still marked unsaved. The quota that blocks them is measured per MINUTE, so
// the only way to be sure is to still be trying when the next minute starts.
// Roughly seventy seconds of patience, spread out so it stops hammering.
const WRITE_RETRY_DELAYS_MS = [500, 1500, 4000, 8000, 14000, 20000, 22000]

function isRateLimited(err) {
  const code = err?.code ?? err?.response?.status
  if (code === 429 || code === 503) return true
  const msg = (err?.message || '').toLowerCase()
  return msg.includes('quota exceeded') || msg.includes('rate limit') || msg.includes('try again later')
}

async function withRetry(what, fn, delays = RETRY_DELAYS_MS) {
  let lastErr
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (!isRateLimited(err)) throw err
      lastErr = err
      if (attempt === delays.length) break
      const wait = delays[attempt]
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
const _batch     = _G.batch || (_G.batch = new Map())   // sheetId -> { waiters, timer }
const READ_TTL_MS = 20000

// ── One request instead of six ──────────────────────────────────────────
//
// Every screen needs several tabs at once. The Overview reads Credentials,
// Shift_Log, Breaks, CRM_Updates, Redistribution_Log and the Issue Tracker;
// Full Day View reads four; the employee's own day reads four. Each of those
// was a separate HTTPS round trip to Google and, more to the point, a separate
// unit of a quota that is counted per minute — so a floor of eighteen people
// on a thirty-second poll spends its allowance on the same handful of tabs
// over and over, and when it runs out every screen fails at once.
//
// Sheets can return many ranges in ONE call. The misses that happen together
// — and they always do, because the endpoints ask for them in a single
// Promise.all — are gathered for a few milliseconds and sent as one batchGet.
// Six requests become one: six times the headroom, and one round trip's
// latency instead of six.
//
// This is what keeps the platform quick as the sheet grows. The cost of a read
// is dominated by the round trip, not by the rows, so collapsing the trips is
// the thing that scales.
const BATCH_WINDOW_MS = 8

// ── How long each kind of tab may be held ───────────────────────────────
//
// These were literals at every call site and they had drifted apart: Shift_Log
// was cached for 5 seconds in one route, 15 in nine others and 60 in the one
// that saves an employee's work. That is not a tuning detail — it is why two
// panels on the SAME admin screen disagreed about the same person. The Floor
// column had somebody down as "not in yet" with a full untouched day against
// their name while the strip beside it showed them clocked in at 07:44 and
// two clients done, because the two panels were reading Shift_Log copies most
// of a minute apart.
//
// One number per KIND of tab, named for what the tab is, so a screen cannot
// quietly fall behind another one again.
export const TTL = {
  // Who is on the floor and what they have done. This is the live state of the
  // shift and it has to move: somebody clocking in changes who holds what.
  LIVE:   8000,
  // Footage requests handed between people.
  QUEUE:  10000,
  // Leave, which is set for the day rather than during it.
  DAY:    30000,
  // The roster itself — people, their hours, the client timings. Edited in the
  // spreadsheet by hand, days apart.
  ROSTER: 60000,
  // The Issue Tracker: a separate book, far the largest thing read here, and
  // it belongs to another team's workflow rather than to the shift.
  ISSUES: 60000,
}

function queueRead(spreadsheetId, range) {
  return new Promise((resolve, reject) => {
    let q = _batch.get(spreadsheetId)
    if (!q) { q = { waiters: new Map(), timer: null }; _batch.set(spreadsheetId, q) }
    let arr = q.waiters.get(range)
    if (!arr) { arr = []; q.waiters.set(range, arr) }
    arr.push({ resolve, reject })
    if (!q.timer) q.timer = setTimeout(() => { flushBatch(spreadsheetId) }, BATCH_WINDOW_MS)
  })
}

async function flushBatch(spreadsheetId) {
  const q = _batch.get(spreadsheetId)
  if (!q) return
  clearTimeout(q.timer)
  _batch.delete(spreadsheetId)

  const waiters = q.waiters
  const ranges  = [...waiters.keys()]
  const deliver = (range, rows) => {
    _readCache.set(`${spreadsheetId}::${range}`, { at: Date.now(), rows })
    ;(waiters.get(range) || []).forEach(w => w.resolve(rows))
  }

  // One range is just a read; batching a single range only adds a wrapper.
  if (ranges.length === 1) {
    try { deliver(ranges[0], await readSheet(spreadsheetId, ranges[0])) }
    catch (err) { (waiters.get(ranges[0]) || []).forEach(w => w.reject(err)) }
    return
  }

  try {
    const res = await withRetry(`batch read of ${ranges.length} ranges`, async () => {
      const sheets = await getSheetsClient()
      return sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges })
    })
    const got = res.data.valueRanges || []
    // batchGet answers in the order the ranges were asked for. If the shape
    // ever fails to line up, do not guess — read them singly instead, because
    // handing one tab's rows back as another's would be silently catastrophic.
    if (got.length !== ranges.length) throw new Error('batchGet returned a different number of ranges')
    ranges.forEach((range, i) => deliver(range, got[i]?.values || []))
  } catch (err) {
    // A batch is all or nothing: one unreadable tab fails the whole call. Fall
    // back to reading them one at a time so a single broken range cannot take
    // five healthy ones down with it.
    console.warn(`sheets: batch read failed (${err.message}); falling back to single reads`)
    await Promise.all(ranges.map(async range => {
      try { deliver(range, await readSheet(spreadsheetId, range)) }
      catch (e) { (waiters.get(range) || []).forEach(w => w.reject(e)) }
    }))
  }
}

export async function readSheetCached(spreadsheetId, range, ttlMs = READ_TTL_MS) {
  const key = `${spreadsheetId}::${range}`
  const hit = _readCache.get(key)
  if (hit && (Date.now() - hit.at) < ttlMs) return hit.rows

  let p = _inFlight.get(key)
  if (!p) {
    p = queueRead(spreadsheetId, range)
    _inFlight.set(key, p)
    p.catch(() => {}).then(() => { if (_inFlight.get(key) === p) _inFlight.delete(key) })
  }

  try {
    return await p
  } catch (err) {
    // A rate limit is a bad minute, not a lost tab. Handing back the copy we
    // already have keeps the screen showing real work instead of an error —
    // slightly behind is worth far more to somebody mid-shift than a 500.
    if (hit) {
      console.warn(`sheets: read of ${range} failed (${err.message}); serving the last good copy`)
      return hit.rows
    }
    throw err
  }
}

// ── Ask for everything at once, at the top ──────────────────────────────
//
// Batching can only collapse reads that MISS TOGETHER, and a request that
// reads in stages does not. A screen typically loads the roster, then runs a
// sweep, then reads the shift tabs — three phases separated by `await`, so
// three batches where one would do. Measured on a cold admin Dashboard: 14
// ranges going out as 9 requests rather than the 2 they could be.
//
// Naming everything the request will need, before the first `await`, puts all
// of it in one batch. Every read further down then finds its rows already in
// the cache and costs nothing — the code below is untouched and simply stops
// waiting.
//
// Failures are swallowed on purpose: this is a prefetch, and the real read
// further down is what decides whether a missing tab matters.
export function warmSheetCache(spreadsheetId, specs) {
  return Promise.all(
    specs.map(([range, ttlMs]) => readSheetCached(spreadsheetId, range, ttlMs).catch(() => null))
  )
}

// The tabs a screen about the shift reads: the roster, who is here, what they
// have done, and what keeps somebody off. Warming a tab a particular screen
// does not use costs no extra request — it is in the same batch — and the tabs
// are small apart from CRM_Updates, which every one of these screens needs.
export const SHIFT_SCREEN_TABS = [
  [`${TABS.CREDENTIALS}!A:H`,     TTL.ROSTER],
  [`${TABS.CLIENT_TIMINGS}!A:B`,  TTL.ROSTER],
  [`${TABS.EMPLOYEE_HOURS}!A:D`,  TTL.ROSTER],
  [`${TABS.SHIFT_LOG}!A:H`,       TTL.LIVE],
  [`${TABS.BREAKS}!A:H`,          TTL.LIVE],
  [`${TABS.CRM_UPDATES}!A:L`,     TTL.LIVE],
  [`${TABS.REDISTRIB}!A:G`,       TTL.LIVE],
  [`${TABS.SHIFT_OVERRIDES}!A:H`, TTL.LIVE],
  [`${TABS.LEAVES}!A:H`,          TTL.DAY],
]

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
  }, WRITE_RETRY_DELAYS_MS)
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
  }, WRITE_RETRY_DELAYS_MS)
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
  }, WRITE_RETRY_DELAYS_MS)
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

    // A shift NEVER wraps the operating day's own order.
    //
    // An operating day is exactly the 24 hours from 07:00 to 07:00. A shift
    // that runs past the end of it has crossed into the NEXT day, and those
    // hours belong to that day — they are not the same-named hours at the
    // start of this one.
    //
    // Wrapping conflated the two. Somebody who clocked in at 00:37 and worked
    // to 10:00 was recorded as present at "7, 8, 9 and 10" — and because the
    // order runs 7am-first, those read as seven through ten o'clock on the
    // MORNING THE DAY BEGAN, thirty hours before they arrived. Ninety client
    // slots from a morning they never worked landed on their board, and the
    // hours were counted as covered on a day nobody had covered them.
    //
    // Clamped to the end of the day instead: a 22:00–07:00 night shift covers
    // 22, 23 and midnight through six — nine hours — and stops there.
    if (si > ei) ei = order.length - 1

    if (target >= si && target <= ei) present.add(name)
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

// A time of day recorded against an OPERATING day, resolved to the real
// moment it happened.
//
// Every date column in these sheets holds the operating day — the 07:00→07:00
// window the row belongs to — not the calendar date the row was written on.
// The two are the same for seventeen hours out of twenty-four and differ for
// the other seven: a shift started at 00:18 is filed under the operating day
// that began at 7am the PREVIOUS morning, so reading its date literally puts
// the clock-in twenty-four hours before it happened.
//
// That is not cosmetic. The window a shift is measured against is built from
// this moment, so an employee clocking in at half past midnight had their
// whole shift dated to the day before, was already an entire day past its end,
// and the auto-close shut it the instant the Command Center was opened — the
// person was at their desk and the platform had already sent them home, with
// no clients on their board and nothing on screen to explain it.
export function parseOperatingDateTime(operatingDate, timeStr) {
  const d = parseISTDateTime(operatingDate, timeStr)
  if (!d) return null
  // Before the day-start hour means the small hours at the END of that
  // operating day, which fall on the next calendar date.
  if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() + 1)
  return d
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
  let complete = true
  try {
    for (const tab of ['Infants', 'Others']) {
      let rows = []
      try { rows = await readSheetCached(SOURCE_SHEET_ID, `${tab}!A:B`, 300000) }
      catch (e) {
        // A tab that would not read is NOT "a tab with no vehicles in it".
        console.error(`fetchClientVehicleCounts: tab ${tab}`, e.message)
        complete = false
        continue
      }
      for (let i = 1; i < rows.length; i++) {
        const clientName = (rows[i][0] || '').toString().trim()
        const vehicleNo   = (rows[i][1] || '').toString().trim()
        if (!clientName || !vehicleNo) continue
        const key = clientName.toLowerCase()
        if (!map[key]) map[key] = { originalName: clientName, vehicleCount: 0 }
        map[key].vehicleCount++
      }
    }
    // Half a map is worse than a stale one, and far worse than an error.
    //
    // A tab that failed to read used to be skipped and the half-built result
    // cached as truth for the next minute: every client in the missing tab
    // silently became a client with no vehicles, and the day's vehicle total
    // dropped by seven thousand with nothing anywhere saying why. Numbers that
    // quietly get smaller are the hardest kind of wrong to notice.
    //
    // The last complete map keeps being served instead — the same rule
    // lib/roster follows for the roster itself.
    if (complete) _G.vehicle = { data: map, at: now, complete: true }
    else if (_G.vehicle.data) {
      console.error('fetchClientVehicleCounts: incomplete read, serving last good map')
      return _G.vehicle.data
    }
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
    // Operating-day aware: a clock-in in the small hours belongs to the next
    // calendar date, and reading it literally made a shift that began at half
    // past midnight look a day old — which is well past any "forgotten row"
    // threshold, so the person who had just arrived was dropped from the floor.
    const startedAt = parseOperatingDateTime(r[2], r[3])
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
    // See getOnShiftNamesFromLog: the date column is the operating day, so a
    // clock-in before 7am happened on the calendar day after it. Read
    // literally, somebody starting at 00:21 was twenty-four hours "old" the
    // moment they arrived and their own dashboard told them their shift had
    // never started, while offering to start a second one.
    const startedAt = parseOperatingDateTime(r[2], r[3])
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
