// The Issue Tracker book, and how a footage request lands on a day.
//
// A separate spreadsheet from the CRM, with its own column order and its own
// idea of what a date is. Both live here so the employee's score and the
// admin's read the same columns and place a request on the same day.
import { parseISTDateTime, businessDate } from './sheets'

export const COL = {
  ISSUE_ID: 1, CLIENT: 2, VEHICLE: 3, RAISED_AT: 4, RAISED_BY: 7,
  SUB_REQUEST: 9, DETAILS: 10, RESOLVED: 17, RESOLVED_AT: 18,
}

// ── Which OPERATING day a footage request belongs to ─────────────────
//
// The Issue Tracker stamps a request with the calendar moment it was raised:
// "23/08/2026, 01:14:00 am". Every date this platform files work under is the
// OPERATING day, 07:00 to 07:00 — so a request raised at one in the morning
// carries tomorrow's calendar date while belonging to the shift that began
// last evening.
//
// Comparing the two directly is the mistake that has caused nearly every
// night-shift fault here, and it did it again: a request raised after
// midnight counted for nobody in the day's footage total, so a night shift's
// score was worked out from a share of a number that did not include their
// own work.
export function raisedOperatingDay(raisedAt) {
  const s = (raisedAt || '').toString().trim()
  if (!s) return ''
  const [datePart, ...rest] = s.split(',')
  const timePart = rest.join(',').trim()
  const d = parseISTDateTime((datePart || '').trim(), timePart || '12:00:00 pm')
  // Unparseable — fall back to the bare date rather than dropping the row.
  if (!d) return (datePart || '').trim().split(' ')[0]
  return businessDate(d)
}

// A row that is a customer footage request, rather than any other issue type.
export function isFootageRequest(row) {
  return (row?.[COL.SUB_REQUEST] || '').toString().toLowerCase()
    .includes('customer request for video')
}
