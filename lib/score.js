// ══════════════════════════════════════════════════════════════════════
// The performance score, in one place
//
// Three parts, and every number behind them is returned alongside the score
// so the person being scored can see how it was arrived at rather than being
// handed a figure to argue with.
//
//   FOOTAGE   40 points. Share of the day's footage requests raised under
//             this employee's name:
//                 (my footage ÷ everybody's footage) × 100 × 40%
//             The heaviest single weight, because a footage request is a
//             customer waiting.
//
//   VEHICLES  60 points. Against a floor of 800 vehicles seen — the count
//             typed into VEHICLES SEEN on each client, which is what the
//             employee actually watched:
//                 min(vehicles seen ÷ 800, 1) × 60
//             At 800 the sixty points are full; no extra credit for going
//             past it, and no cliff for being just short.
//
//   BREAK     −20 points if the day's total break runs past an hour. Counted
//             the way every other screen counts it: the union of the
//             stretches, so overlapping rows are one absence.
//
// ── Why it lives here rather than in the endpoint ─────────────────────
//
// It was written inside the employee's own summary endpoint, so the admin had
// no score at all — their dashboard simply had nowhere to read one from. The
// obvious fix is to write the same three sums into the admin endpoint too,
// and that is exactly how the "Still not updated" list ended up giving two
// different answers to one question: two copies of a rule drift, and the
// screens then disagree about the same employee on the same day.
//
// One implementation, both callers.
// ══════════════════════════════════════════════════════════════════════

export const VEHICLE_TARGET      = 800
export const BREAK_ALLOWANCE_MIN = 60
export const BREAK_PENALTY       = 20

// ── Who is even part of this day ──────────────────────────────────────
//
// The score was worked out for the whole roster, every day, whether or not
// the person had been near the place. That is wrong twice over, and the
// night shift showed both:
//
//   Their work belongs to the operating day their shift BEGAN. A shift that
//   ran 22:00 to 07:00 is filed under yesterday, so once seven passes they
//   have done nothing today — yet a card appeared for them under today.
//
//   And it was not an empty card. Early in the morning the floor has raised
//   no footage yet, so the share is undefined and scored in full: forty
//   points, to somebody who had gone home. A number that flattering, for a
//   day somebody did not work, is worse than no number at all.
//
// So: only people this operating day actually belongs to. A shift row dated
// to it — whatever its status, so somebody who has clocked out today still
// counts — or an update recorded under it, which covers anybody whose row is
// missing but whose work is not.
export function whoWorkedOn(date, shiftRows = [], updateRows = []) {
  const names = new Set()
  shiftRows.slice(1).forEach(r => {
    if (r[2] !== date) return
    const n = (r[1] || '').toString().trim()
    if (n) names.add(n)
  })
  updateRows.slice(1).forEach(r => {
    if (r[0] !== date) return
    const n = (r[2] || '').toString().trim()
    if (n) names.add(n)
  })
  return names
}

export function scoreTier(score) {
  return score >= 95 ? 'Elite'
       : score >= 85 ? 'Excellent'
       : score >= 70 ? 'Good'
       : score >= 50 ? 'Needs Improvement'
       : 'Critical'
}

// Everything the score is made of, given the four raw figures.
//
//   footageMine / footageTotal  requests raised today, mine and the floor's
//   vehiclesSeen                VEHICLES SEEN summed across my updates today
//   breakMinutes                today's break, as a union of stretches
export function computeScore({ footageMine = 0, footageTotal = 0, vehiclesSeen = 0, breakMinutes = 0 }) {
  // No footage at all today is nobody's failure. Scoring a share of zero as
  // zero would put the whole floor on 60 for a quiet morning.
  const sharePct = footageTotal > 0 ? (footageMine / footageTotal) * 100 : null
  const footagePoints = sharePct === null ? 40 : (sharePct / 100) * 40

  const vehiclePoints = Math.min(vehiclesSeen / VEHICLE_TARGET, 1) * 60

  const penalty = breakMinutes > BREAK_ALLOWANCE_MIN ? BREAK_PENALTY : 0

  const score = Math.max(0, Math.min(100,
    Math.round(footagePoints + vehiclePoints - penalty)))

  return {
    score,
    tier: scoreTier(score),
    breakdown: {
      footage: {
        weight: 40,
        mine: footageMine,
        total: footageTotal,
        sharePct: sharePct === null ? null : Math.round(sharePct * 10) / 10,
        points: Math.round(footagePoints * 10) / 10,
      },
      vehicles: {
        weight: 60,
        seen: vehiclesSeen,
        target: VEHICLE_TARGET,
        pct: Math.round(Math.min(vehiclesSeen / VEHICLE_TARGET, 1) * 1000) / 10,
        points: Math.round(vehiclePoints * 10) / 10,
      },
      breakPenalty: {
        weight: -BREAK_PENALTY,
        minutes: breakMinutes,
        allowanceMinutes: BREAK_ALLOWANCE_MIN,
        applied: penalty > 0,
        points: -penalty,
      },
      total: score,
    },
  }
}
