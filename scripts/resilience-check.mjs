// What the page does when the server does not answer properly.
//
// This is the part nobody tests, and it is what the floor has been hitting:
// things "loading late" and having to reload the site by hand. Every one of
// those is a failure path — a request that never came back, a gateway page
// where JSON was expected, a blip on one read — being handled as though it
// meant something it did not.
//
// Exercises lib/fetchJson against a stubbed global fetch. No network.
//
//   node --import ./scripts/test-hooks.mjs scripts/resilience-check.mjs
import { fetchJSON, isAuthFailure, retryDelayMs } from '../lib/fetchJson.js'

let pass = 0, fail = 0
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL  ' + m) } }

const asResponse = (body, { status = 200 } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => body,
})

// ── 1 · A request that never answers must not hang the page ────────────
console.log('\n1  A server that never answers')
{
  // Hangs until aborted — exactly what a wedged serverless function does.
  globalThis.fetch = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e)
    })
  })

  const began = Date.now()
  const r = await fetchJSON('/api/anything', { timeoutMs: 300 })
  const took = Date.now() - began

  ok(took < 2000, `the call took ${took}ms — it was supposed to give up at 300ms`)
  ok(r.failed === true && r.ok === false, 'a hung request should come back as a failure, not hang')
  ok(r.status === 408, `expected a timeout status, got ${r.status}`)
  ok(isAuthFailure(r) === false, 'a timeout was treated as "your session is gone" — this is what logged people out')
  console.log(`   gave up after ${took}ms, reported as a timeout, session untouched`)
}

// ── 2 · A gateway error page where JSON was expected ───────────────────
// A 502 or 504 comes back as HTML. Every caller used to do res.json() on it,
// which throws — and on the dashboard the nearest catch sent the employee to
// the login screen.
console.log('\n2  An HTML error page from the gateway')
{
  globalThis.fetch = async () => asResponse(
    '<!DOCTYPE html><html><body>504 Gateway Timeout</body></html>', { status: 504 }
  )
  const r = await fetchJSON('/api/auth/me')
  ok(r.failed === false, 'a 504 is an answer, just not a useful one')
  ok(r.ok === false, 'a 504 must not read as success')
  ok(r.data === null, `an unparseable body should come back as null, got ${JSON.stringify(r.data)}`)
  ok(isAuthFailure(r) === false, 'a gateway timeout was read as a session failure — this logged people out mid-shift')
  console.log(`   504 + HTML body → not ok, not an auth failure, nothing thrown`)
}

// ── 3 · A real session failure still logs somebody out ─────────────────
// The rule must not become "never log anybody out".
console.log('\n3  A session that really has expired')
{
  globalThis.fetch = async () => asResponse(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  const r = await fetchJSON('/api/auth/me')
  ok(isAuthFailure(r) === true, 'a 401 must still send somebody to the login screen')

  globalThis.fetch = async () => asResponse(JSON.stringify({ user: null }), { status: 200 })
  const r2 = await fetchJSON('/api/auth/me')
  ok(isAuthFailure(r2) === true, 'a 200 with no user is still no session')
  console.log(`   401 → log out   ·   200 with no user → log out`)
}

// ── 4 · A 500 from our own API is not a session failure ────────────────
// The shift read is backed by the spreadsheet. A quota minute says nothing
// whatsoever about who you are.
console.log('\n4  Our own API returning 500')
{
  globalThis.fetch = async () => asResponse(JSON.stringify({ error: 'Server error' }), { status: 500 })
  const r = await fetchJSON('/api/shift/status')
  ok(r.ok === false, 'a 500 must not read as success')
  ok(isAuthFailure(r) === false, 'a 500 on a data read was logging people out')
  ok(r.data?.error === 'Server error', 'the error payload should still be readable')
  console.log(`   500 → not ok, session untouched, message preserved`)
}

// ── 5 · A 200 carrying an error payload is not success ─────────────────
console.log('\n5  A 200 with an error in the body')
{
  globalThis.fetch = async () => asResponse(JSON.stringify({ error: 'Sheet is busy' }), { status: 200 })
  const r = await fetchJSON('/api/clients/current')
  ok(r.ok === false, 'a body carrying an error must not be stored as data')
  console.log(`   200 + {error} → not ok`)
}

// ── 6 · The ordinary case still works ──────────────────────────────────
console.log('\n6  A normal answer')
{
  globalThis.fetch = async () => asResponse(JSON.stringify({ user: { name: 'Mahesh' }, clients: [1, 2, 3] }))
  const r = await fetchJSON('/api/auth/me')
  ok(r.ok === true && r.data?.user?.name === 'Mahesh', 'a good response did not come through intact')
  ok(isAuthFailure(r) === false, 'a valid session was read as an auth failure')
  console.log(`   200 + JSON → ok, data intact`)
}

// ── 7 · Offline is not a session failure either ────────────────────────
console.log('\n7  No network at all')
{
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch') }
  const r = await fetchJSON('/api/auth/me')
  ok(r.failed === true, 'a network error should be reported, not thrown')
  ok(isAuthFailure(r) === false, 'going offline for a moment must not log anybody out')
  console.log(`   offline → failed, session untouched`)
}

// ── 8 · The retry backoff is short enough for somebody watching ────────
console.log('\n8  How long a retry waits')
{
  const waits = [0, 1, 2, 3, 4, 5, 6].map(retryDelayMs)
  ok(waits[0] <= 1000, `the first retry waits ${waits[0]}ms — too long for somebody staring at a spinner`)
  ok(Math.max(...waits) <= 15000, `a retry waits up to ${Math.max(...waits)}ms`)
  ok(waits.every((w, i) => i === 0 || w >= waits[i - 1]), 'the backoff should not go backwards')
  console.log(`   ${waits.map(w => (w / 1000) + 's').join(' → ')}`)
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} checks passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
