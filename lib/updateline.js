// What a client's status line should say, in one place.
//
// There were two copies of this — one in the board's list, one in the detail
// pane beside it — and only the list ever got fixed. So the row read
// "Updated at 08:30:52 am by Nesiya" while the pane, for the SAME client at
// the same moment, said "still not updated". The same duplication this
// codebase keeps being bitten by, this time in the UI.
//
// It lives here rather than inside the component because a rule that decides
// what an employee sees deserves a test, and a test cannot import a file full
// of JSX.
//
//   mine      this employee filled it in this slot
//   at        the time they filled it, if known
//   elsewhere anybody filled it today, at any hour — { at, by }
//   upcoming  the slot has not started yet
//
// "Still not updated" means one thing everywhere: nobody has filled this
// client since seven this morning.
export function updateLine({ mine, at, elsewhere, upcoming }) {
  if (mine)      return { text: at ? `Updated at ${at}` : 'Updated', tone: 'done' }
  if (elsewhere) return {
    text: `Updated at ${elsewhere.at}${elsewhere.by ? ` by ${elsewhere.by}` : ''}`,
    tone: 'elsewhere',
  }
  if (upcoming)  return { text: 'Not started yet', tone: 'idle' }
  return { text: 'Still not updated', tone: 'late' }
}

// Where a client sits in the list.
//
// Asked for plainly: what nobody has touched belongs at the top, and below it
// the day in the order it happened — eight in the morning above ten, ten above
// noon. So the list reads as "here is what is outstanding, and here is how the
// day has gone", which is what an operator scans it for.
//
// A clock string alone is not enough to sort by. The operating day runs 07:00
// to 07:00, so on a night shift an update at 2 am comes AFTER one at 11 pm —
// sorting by raw time would fling it to the top of the morning it belongs to
// the tail of.
export const RANK_NOT_UPDATED = -1
// Updated, but the sheet carries no time against it. Real work, so it sits
// below everything that can be placed, and above nothing.
export const RANK_NO_TIME = Number.MAX_SAFE_INTEGER

// "07:34:30 am" -> seconds into the operating day. null if it isn't a clock.
export function clockRank(value) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap])\.?m\.?$/i
    .exec((value || '').toString().trim())
  if (!m) return null
  const hh = Number(m[1])
  if (hh < 1 || hh > 12) return null
  let h = hh % 12
  if (m[4].toLowerCase() === 'p') h += 12
  const secs = h * 3600 + Number(m[2]) * 60 + Number(m[3] || 0)
  return h < 7 ? secs + 86400 : secs
}

export function updateRank({ mine, at, elsewhere }) {
  const stamp = mine ? at : elsewhere ? elsewhere.at : ''
  if (!mine && !elsewhere) return RANK_NOT_UPDATED
  const rank = clockRank(stamp)
  return rank === null ? RANK_NO_TIME : rank
}
