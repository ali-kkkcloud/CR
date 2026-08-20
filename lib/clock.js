// ══════════════════════════════════════════════════════════════════════
// Reading the sheets' clock, on the browser side.
//
// Every time in these sheets is IST wall-clock with no zone attached, and
// every date column is the OPERATING day — the 07:00→07:00 window a row
// belongs to — rather than the calendar day it was written on. Getting either
// wrong is invisible on a laptop set to IST during daylight hours and badly
// wrong at four in the morning, which is exactly when the night shift is
// working.
//
// Kept out of components/ui.js, which is full of JSX and so cannot be loaded
// by a plain-node test — and these are the functions that most need one.
// ui.js re-exports them, so every existing import still works.
// ══════════════════════════════════════════════════════════════════════

export function nowIST() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
}

// The hour the operating day turns over, mirroring DAY_START_HOUR in
// lib/sheets. Defined here rather than imported because that module pulls in
// the Google client, which has no business in a browser bundle.
const DAY_START_HOUR = 7

// "hh:mm:ss am/pm" or "HH:mm:ss" against a "DD/MM/YYYY" date, as a moment in
// the IST frame. Returns null if either part is unreadable.
export function parseISTStamp(dateStr, timeStr) {
  const t = (timeStr || '').toString().trim()
  let h, mi, se
  let m = t.match(/^(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i)
  if (m) {
    h = parseInt(m[1], 10); mi = parseInt(m[2], 10); se = parseInt(m[3], 10)
    const ap = m[4].toLowerCase()
    if (ap === 'pm' && h !== 12) h += 12
    if (ap === 'am' && h === 12) h = 0
  } else {
    m = t.match(/^(\d{1,2}):(\d{2}):(\d{2})$/)
    if (!m) return null
    h = parseInt(m[1], 10); mi = parseInt(m[2], 10); se = parseInt(m[3], 10)
  }
  const d = (dateStr || '').toString().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (d) {
    const out = new Date(+d[3], +d[2] - 1, +d[1], h, mi, se, 0)
    // The date on a row is the OPERATING day — the 07:00→07:00 window it
    // belongs to — not the calendar day it was written on. A time before
    // seven in the morning therefore happened on the NEXT calendar date.
    //
    // Read literally, every small-hours entry landed exactly twenty-four
    // hours early. A night-shift break that began at 04:57 am showed
    // "24:00:16 elapsed" sixteen seconds after it started, and the same
    // mistake made every running break on the admin's screen look like it
    // had been going for a day.
    if (h < DAY_START_HOUR) out.setDate(out.getDate() + 1)
    return out
  }
  // No date on the row: place it on the IST day in progress, and if that puts
  // it in the future it can only have been yesterday.
  const base = nowIST()
  const out = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, mi, se, 0)
  if (out.getTime() > base.getTime() + 120000) out.setDate(out.getDate() - 1)
  return out
}

// Seconds a break has been running, measured in IST on both ends.
export function elapsedSecondsIST(dateStr, timeStr) {
  const start = parseISTStamp(dateStr, timeStr)
  if (!start) return 0
  return Math.max(0, Math.floor((nowIST().getTime() - start.getTime()) / 1000))
}
