// ══════════════════════════════════════════════════════════════════════
// The performance score, in one place
//
// Three parts, and every number behind them is returned alongside the score
// so the person being scored can see how it was arrived at rather than being
// handed a figure to argue with.
//
//   FOOTAGE   5 points for every request raised under this employee's name.
//             Uncapped: ten requests is fifty points. Do one and you are five
//             better off; do none and nothing happens to you.
//
//   VEHICLES  70 points. Against a floor of 800 vehicles seen — the count
//             typed into VEHICLES SEEN on each client, which is what the
//             employee actually watched:
//                 min(vehicles seen ÷ 800, 1) × 70
//             At 800 the seventy points are full; no extra credit for going
//             past it, and no cliff for being just short.
//
//   BREAK     −20 points if the day's total break runs past an hour. Counted
//             the way every other screen counts it: the union of the
//             stretches, so overlapping rows are one absence.
//
// ── What changed, and why the old rule had to go ──────────────────────
//
// Footage used to be 40 points of SHARE: my requests divided by the whole
// floor's. Share is a zero-sum measure, and that made it the wrong thing to
// pay people on. Two employees doing identical work scored differently
// depending on how busy everybody else was, a good day for the floor pushed
// every individual score DOWN, and a quiet morning with no requests at all
// was undefined — so it was scored as full marks, handing forty points to
// people who had raised nothing.
//
// Counting the requests themselves removes all three. The number now only
// answers for what this person did.
//
// One consequence worth saying out loud: footage points now START at zero and
// build through the shift, where before they started full. Early-morning
// scores therefore read lower than they used to. That is the rule doing what
// it says — nothing has gone wrong.
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
export const VEHICLE_WEIGHT      = 70
export const FOOTAGE_POINTS      = 5
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
//   And it was not an empty card. Under the old share rule a morning with no
//   footage yet was undefined and scored in full — forty points to somebody
//   who had gone home. Counting requests instead has retired that particular
//   flattery, but the rest of the reasoning stands: a card for a day somebody
//   did not work is a number about nothing.
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

// Everything the score is made of, given the three raw figures.
//
//   footageCount   footage requests raised under this name in the period
//   vehiclesSeen   VEHICLES SEEN summed across this person's updates
//   breakMinutes   break taken, as a union of stretches
//
// `footageTotal` — the floor's total, which the old share needed — is gone
// on purpose. Nothing about one person's score depends on anybody else's work
// any more, and leaving the parameter in place would invite a caller to keep
// computing a figure that no longer means anything.
export function computeScore({ footageCount = 0, vehiclesSeen = 0, breakMinutes = 0 }) {
  // Uncapped by design. Ten requests really is fifty points; the clamp at 100
  // below is the only ceiling, and it is the score's ceiling, not footage's.
  const footagePoints = footageCount * FOOTAGE_POINTS

  const vehiclePct    = Math.min(vehiclesSeen / VEHICLE_TARGET, 1)
  const vehiclePoints = vehiclePct * VEHICLE_WEIGHT

  const penalty = breakMinutes > BREAK_ALLOWANCE_MIN ? BREAK_PENALTY : 0

  const score = Math.max(0, Math.min(100,
    Math.round(footagePoints + vehiclePoints - penalty)))

  return {
    score,
    tier: scoreTier(score),
    breakdown: {
      footage: {
        // No weight: there is no denominator to be "out of" any more. The
        // screens read this to decide whether to print "x / 40".
        perRequest: FOOTAGE_POINTS,
        count: footageCount,
        points: Math.round(footagePoints * 10) / 10,
      },
      vehicles: {
        weight: VEHICLE_WEIGHT,
        seen: vehiclesSeen,
        target: VEHICLE_TARGET,
        pct: Math.round(vehiclePct * 1000) / 10,
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

// ── The score over a PERIOD, rather than one day ───────────────────────
//
// Every part of the score is defined per DAY: 800 vehicles a day, an hour's
// break a day, the requests raised during it. So a week cannot be scored by
// adding the week's totals up and putting them through the same formula —
// that would measure five days of vehicles against one day's target, park
// everybody on the ceiling, and turn the number into a tick rather than a
// measurement. The break penalty would go the other way and become almost
// unavoidable, since a week's breaks pass sixty minutes on the second day.
//
// So each day is scored on its own terms and the days are averaged. That is
// the only aggregate that means the same thing as the daily number it is made
// of: "a typical day in this period looked like this".
//
// Only days the person actually worked are passed in — see the Reports
// endpoint. A week off is not a zero; it is a day that does not belong in the
// average at all, and counting it as zero would punish people for their
// roster.
//
//   days: [{ footageCount, vehiclesSeen, breakMinutes }, …]
export function averageScore(days = []) {
  const scored = days.map(d => computeScore(d))
  const worked = scored.length

  if (!worked) {
    return {
      score: null, tier: null, days: 0,
      breakdown: {
        footage:      { perRequest: FOOTAGE_POINTS, count: 0, points: 0 },
        vehicles:     { weight: VEHICLE_WEIGHT, seen: 0, target: VEHICLE_TARGET, pct: 0, points: 0 },
        breakPenalty: { weight: -BREAK_PENALTY, minutes: 0, allowanceMinutes: BREAK_ALLOWANCE_MIN, applied: false, points: 0, daysApplied: 0 },
        total: null,
      },
    }
  }

  const avg = (pick) => scored.reduce((s, x) => s + pick(x.breakdown), 0) / worked
  const sum = (pick) => days.reduce((s, d) => s + (pick(d) || 0), 0)
  const r1  = (n) => Math.round(n * 10) / 10

  const score = Math.max(0, Math.min(100,
    Math.round(scored.reduce((s, x) => s + x.score, 0) / worked)))

  const daysPenalised = scored.filter(x => x.breakdown.breakPenalty.applied).length

  return {
    score,
    tier: scoreTier(score),
    days: worked,
    breakdown: {
      // Totals for the period, alongside the per-day average that the score
      // is actually built from — both, because "42 requests this month" and
      // "worth 7 a day" answer different questions and the screen shows each.
      footage: {
        perRequest: FOOTAGE_POINTS,
        count:  sum(d => d.footageCount),
        points: r1(avg(b => b.footage.points)),
      },
      vehicles: {
        weight: VEHICLE_WEIGHT,
        seen:   sum(d => d.vehiclesSeen),
        target: VEHICLE_TARGET,
        pct:    r1(avg(b => b.vehicles.pct)),
        points: r1(avg(b => b.vehicles.points)),
      },
      breakPenalty: {
        weight: -BREAK_PENALTY,
        minutes: sum(d => d.breakMinutes),
        allowanceMinutes: BREAK_ALLOWANCE_MIN,
        // Over a period this is not a yes or no. It is "on how many days".
        applied: daysPenalised > 0,
        daysApplied: daysPenalised,
        points: r1(avg(b => b.breakPenalty.points)),
      },
      total: score,
    },
  }
}
