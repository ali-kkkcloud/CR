// ══════════════════════════════════════════════════════════════════════
// Talking to our own API without the page ever getting stuck.
//
// Two things went wrong often enough that people were reloading the site by
// hand to get out of them.
//
// A REQUEST THAT NEVER ANSWERS. Nothing here had a timeout. A serverless
// function that hangs — a cold start behind an exhausted Sheets quota, a
// dropped connection on a phone tether — left `await fetch(...)` pending for
// as long as the browser felt like waiting, and whatever the page was showing
// at the time stayed on screen. On the first load that is a spinner, and a
// spinner with nothing behind it is indistinguishable from a broken site.
//
// A BODY THAT IS NOT JSON. Every caller went straight to `res.json()`. That
// is fine for our own error payloads, which are JSON, and not fine for the
// gateway's — a 502 or a 504 comes back as an HTML page, and parsing it
// throws. The throw then landed in whatever catch was nearest, and on the
// dashboard the nearest catch sent the employee to the login screen. A blip
// on one read logged people out mid-shift.
//
// So: always resolves, never throws, and always says what actually happened.
// ══════════════════════════════════════════════════════════════════════

// Long enough for a cold serverless start with a slow sheet behind it, short
// enough that a hung request becomes a visible failure rather than a page
// that simply never finishes.
const DEFAULT_TIMEOUT_MS = 20000

export async function fetchJSON(url, { timeoutMs = DEFAULT_TIMEOUT_MS, ...opts } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal })
    const text = await res.text()
    let data = null
    // A body that will not parse is not an exception — it is a server that
    // answered with something other than our API. The status still tells the
    // caller what to do.
    try { data = text ? JSON.parse(text) : null } catch { data = null }
    return { ok: res.ok && !data?.error, status: res.status, data, failed: false }
  } catch (err) {
    // Aborted, offline, DNS, TLS — from the caller's point of view these are
    // all "no answer", and none of them mean the session is invalid.
    return {
      ok: false,
      status: err?.name === 'AbortError' ? 408 : 0,
      data: null,
      failed: true,
      error: err?.name === 'AbortError' ? 'timed out' : (err?.message || 'network error'),
    }
  } finally {
    clearTimeout(timer)
  }
}

// Whether a failure means "your session is gone" as opposed to "we could not
// reach the server just now". Only the first should ever send somebody to the
// login screen; treating the second that way is how a quota blip turned into
// a floor of people logging back in.
export function isAuthFailure(result) {
  if (result.failed) return false                 // never reached the server
  if (result.status === 401 || result.status === 403) return true
  return result.ok && !!result.data && !result.data.user
}

// Back off, but not for long — somebody is watching a spinner.
export function retryDelayMs(attempt) {
  return Math.min(15000, 1000 * Math.pow(2, attempt))
}
