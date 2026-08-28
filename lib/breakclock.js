import { elapsedSecondsIST } from './clock'

// ══════════════════════════════════════════════════════════════════════
// How long somebody has been away, as of this second.
//
// Out here rather than inside a component for the same reason updateLine is:
// a rule that decides a number an admin acts on should be testable without a
// browser. It lives in one file, and every screen that shows this figure
// imports it from here.
//
// The server counts a running break up to the moment it answers and reports
// that moment as `asOf`. All this does is carry the clock forward from there.
//
// It used to do more, and that was the bug. The browser worked the whole
// total out again from the open row's start time and took whichever of the
// two answers was larger — a second calculation, from a different starting
// point, over a different set of rows. On 28 August the attendance table read
// "Shashi · 2h 56m break" and the floor beside it read "AWAY 6h 10m", in the
// same minute, for the same person. Checked against the sheet afterwards the
// table was right to the second: her stretches that day were 14:37–15:01,
// 15:24–15:46 and 18:39 onwards, which is 176 minutes at 20:49. The floor was
// counting from 14:39 — the first break of her day, not the one that was
// open.
//
// Two answers to one question is worse than either answer being wrong: the
// person reading the screen cannot tell which to believe, and the number
// decides whether somebody gets asked where they have been.
// ══════════════════════════════════════════════════════════════════════
export function liveBreakMinutes(e, asOf) {
  const total = (e && e.totalMinutes) || 0
  if (!e || !e.currentlyOnBreak) return total
  if (!asOf || !asOf.date || !asOf.time) return total
  // In the IST frame, like every other time in the sheets. Building this with
  // the browser's own setHours made it wrong by the machine's offset from IST.
  const since = Math.floor(elapsedSecondsIST(asOf.date, asOf.time) / 60)
  return total + Math.max(0, since)
}
