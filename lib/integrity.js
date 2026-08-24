// ══════════════════════════════════════════════════════════════════════
// The browser is a witness, not the truth
//
// An employee was found running a browser extension built to stop the
// automatic break from ever firing. Its own description lists what it does:
//
//   · intercepts fetch and rewrites activeAgoMs to 0 on every poll
//   · synthesises mousemove, keydown, scroll and wheel events
//   · patches the page's own React ref so the idle timer never advances
//   · clicks Resume automatically if a break fires anyway
//
// ── What cannot be fixed ──────────────────────────────────────────────
//
// None of that can be blocked from inside the page. An extension's content
// script runs in the same origin, with the same privileges, and it runs
// AFTER our code has loaded — so it can read, patch or replace anything we
// write, including any detection we try to run in the browser. Obfuscating
// the client buys an afternoon and loses a week. There is no version of this
// file that lives in the browser and wins.
//
// ── What can ─────────────────────────────────────────────────────────
//
// Stop asking the browser to be the only witness. The server already holds
// facts the extension cannot forge without actually doing the job:
//
//   WORK      rows in CRM_Updates carry the employee's name, the client and
//             a status. Producing one means genuinely filling a client.
//             Faking these is no longer "avoiding a break" — it is writing
//             false monitoring records, which is a different and far more
//             visible act.
//
//   PRESENCE  the heartbeat: what the browser claims. Useful, because
//             somebody watching feeds through a quiet hour really is at
//             their desk with nothing to record — which is why it exists.
//             But it is a claim, and claims are believed only so far.
//
// So the heartbeat may vouch for an employee for a while past their last
// recorded work, and no further. Past that the claim is clamped and the
// ordinary idle rule applies to the work clock alone. An honest employee
// never notices: they record something every few minutes and the window
// never binds. A spoofed browser reports perfect attention and produces no
// work at all, so for it the window always binds.
//
// And the divergence between the two clocks is itself the evidence. It needs
// no history, no fingerprinting and nothing stored — "this browser has
// claimed continuous attention for three hours and recorded nothing" is a
// fact the server can state on its own, and it is what the admin needs in
// order to act.
// ══════════════════════════════════════════════════════════════════════

// How long the browser's word is good for past the last recorded work.
//
// ── Why this is OFF by default ────────────────────────────────────────
//
// Because with the signals the server has, a spoofed browser and a genuinely
// quiet employee are the same shape. Both say "I am here"; neither has
// recorded anything. The platform's own design says so out loud — the
// heartbeat exists precisely so that somebody watching feeds through an hour
// with nothing to fill still counts as present.
//
// So a ceiling on the claim cannot be applied to everyone without eventually
// putting an honest person on a break for a slow stretch that was not their
// fault. That is a real cost, paid by people who did nothing wrong, and it is
// the floor's decision to make rather than a default to slip in.
//
// Turn it on by setting CAUTIO_HEARTBEAT_TRUST_MINUTES. Ninety is a sensible
// first value: no working shift goes an hour and a half with nothing
// recorded, so honest employees never reach it, while a browser that intends
// to claim attention all day reaches it every time.
//
// Detection below runs regardless, and costs nobody anything.
export const HEARTBEAT_TRUST_MINUTES = 90

// null means "believe the browser, as before". A number is a ceiling.
export function heartbeatTrustMinutes() {
  const raw = Number(process.env.CAUTIO_HEARTBEAT_TRUST_MINUTES)
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

// Long enough with a live heartbeat and nothing recorded to be worth the
// admin's attention. Below the trust window, so a flag is raised before the
// clamp starts changing anybody's break.
export const SUSPICIOUS_AFTER_MINUTES = 30

// The heartbeat is fresh if it was claimed within this. The dashboard polls
// every thirty seconds, so anything inside two minutes is a live browser.
const FRESH_CLAIM_MS = 2 * 60000

// An automatic break resumed faster than a person could see the overlay and
// reach for the mouse. One is a fast employee; a dozen is a script.
const INSTANT_RESUME_SECONDS = 3

// ── The clamp ─────────────────────────────────────────────────────────
//
// Given what the server has verified and what the browser claims, decide the
// moment the employee was last credibly active.
//
//   workAt     last thing the server watched them do (a filled client, and
//              the shift's own start, which anchors the very first window)
//   claimedAt  the browser's heartbeat, or null if it has said nothing
//
// Returns the effective activity moment plus whether the claim had to be
// cut back, so the caller can report it.
export function clampClaim(workAt, claimedAt, { trustMinutes = HEARTBEAT_TRUST_MINUTES } = {}) {
  if (claimedAt == null) return { at: workAt, clamped: false }
  if (workAt == null)    return { at: claimedAt, clamped: false }
  // No ceiling configured: the browser is believed, exactly as before.
  if (trustMinutes == null) return { at: Math.max(workAt, claimedAt), clamped: false }

  const ceiling = workAt + trustMinutes * 60000
  if (claimedAt <= ceiling) return { at: Math.max(workAt, claimedAt), clamped: false }

  // The browser is claiming attention further past the last recorded work
  // than a claim is worth. Believe it up to the ceiling and no further.
  return { at: Math.max(workAt, ceiling), clamped: true, overreachMs: claimedAt - ceiling }
}

// ── The evidence ──────────────────────────────────────────────────────
//
// What the two clocks say about one employee, in a form an admin can act on.
// Nothing here accuses anybody: it reports the divergence and lets a person
// decide. A quiet hour and a spoofed browser look the same for ten minutes;
// they look nothing alike after two hours.
export function assessEmployee({
  name, onShift, workAt, claimedAt, nowMs,
  autoBreaks = [],
  suspiciousAfterMinutes = SUSPICIOUS_AFTER_MINUTES,
  trustMinutes = HEARTBEAT_TRUST_MINUTES,
}) {
  if (!onShift) return null

  const claimFresh   = claimedAt != null && (nowMs - claimedAt) <= FRESH_CLAIM_MS
  const minutesSince = (t) => (t == null ? null : Math.round((nowMs - t) / 60000))
  const idleWork     = minutesSince(workAt)

  // A browser insisting somebody is at their desk while the sheet shows they
  // have recorded nothing for half an hour. This is the whole signal.
  const claimingWithoutWork = !!(claimFresh && idleWork != null && idleWork >= suspiciousAfterMinutes)

  const { clamped } = clampClaim(workAt, claimedAt, { trustMinutes })

  // Breaks that ended so soon after they opened that nobody read them.
  const instantResumes = autoBreaks.filter(b =>
    b.seconds != null && b.seconds >= 0 && b.seconds <= INSTANT_RESUME_SECONDS).length

  const reasons = []
  if (claimingWithoutWork) {
    reasons.push(`browser reported activity throughout, nothing recorded for ${idleWork}m`)
  }
  if (clamped) {
    reasons.push(`activity claim ran past the ${trustMinutes}m the sheet supports`)
  }
  if (instantResumes >= 3) {
    reasons.push(`${instantResumes} automatic breaks resumed within ${INSTANT_RESUME_SECONDS}s`)
  }

  if (!reasons.length) return null
  return {
    name,
    minutesSinceWork: idleWork,
    claimFresh,
    clamped,
    instantResumes,
    reasons,
    // Two independent signals agreeing is worth saying out loud; one on its
    // own can still be a slow hour.
    severity: reasons.length >= 2 ? 'high' : 'low',
  }
}
