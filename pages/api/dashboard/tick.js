// ══════════════════════════════════════════════════════════════════════
// The whole dashboard, in one request.
//
// The employee's screen refreshes every thirty seconds, and it did that by
// calling six endpoints at once: the board, the day, the summary, the footage
// queue, the break state and the shift state.
//
// On Vercel every API route is its OWN serverless function, with its own
// process and its own memory. The read cache in lib/sheets exists to make sure
// a tab is fetched once and shared — and it cannot cross a function boundary.
// So six endpoints meant SIX separate caches, each fetching the same
// Shift_Log, the same Breaks, the same CRM_Updates, over and over.
//
// Google allows 60 read requests a minute PER USER, and the "user" here is the
// one service account the entire platform signs in as. Sixty a minute, for
// eighteen dashboards, two admin screens and every save. Measured against the
// live book: the allowance was gone, permanently — a single read from outside
// the platform was refused again and again.
//
// That is what the floor was feeling. A save is two reads and one write, and
// each of them was being refused and retried on a backoff that runs to seventy
// seconds. It was never the save that was slow. It was that there was no
// allowance left to do it with.
//
// One request now. The six answers are produced by the SAME six handlers —
// not a reimplementation of them, so there is nothing here that can drift away
// from what the individual endpoints do — but they run in one process, so the
// cache does its job and the twenty-odd tab reads collapse into two.
//
// The six endpoints are untouched and still work on their own. First load
// still uses them, and anything else that calls them is unaffected.
// ══════════════════════════════════════════════════════════════════════
import { getUserFromReq } from '../../../lib/auth'
import { guardSession } from '../../../lib/session'
import { warmTogether, CRM_SHEET_ID, SHIFT_SCREEN_TABS, TABS } from '../../../lib/sheets'

import board       from '../clients/current'
import myDay       from './my-day'
import summary     from './summary'
import footage     from '../footage/list'
import breakStatus from '../break/status'
import shiftStatus from '../shift/status'

// Run one of the real handlers and keep what it answered.
//
// Each is given its own res, so one handler answering 401 or 500 cannot
// decide the whole request. A section that fails comes back as null and the
// page keeps whatever it already had on screen for that panel — which is what
// it does today when one of the six fetches fails.
async function run(handler, req, query) {
  let body = null, code = 200
  const res = {
    status(c) { code = c; return res },
    json(payload) { body = payload; return res },
    end() { return res },
    setHeader() { return res },
  }
  try {
    await handler({ ...req, method: 'GET', query }, res)
  } catch (e) {
    console.error('tick: a section failed —', e?.message || e)
    return { code: 500, body: null }
  }
  return { code, body }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end()
  const user = getUserFromReq(req)
  if (!user) return res.status(401).json({ error: 'Unauthorized' })

  // Every tab the six of them need between them, asked for in ONE batch
  // before any of them runs. This is the whole point of the endpoint: from
  // here down, every read below finds its rows already in memory.
  //
  // ── Why they all share ONE window ──────────────────────────────────
  //
  // Batching can only collapse reads that go STALE TOGETHER. These tabs each
  // had their own lifetime — the shift tabs 15 seconds, the footage queue 20,
  // leave 30, the roster 60 — so they came due at different moments and left
  // as three or four separate requests instead of one. The tabs that expired
  // alone were the small ones, and a round trip for Leaves by itself costs
  // exactly what a round trip for all twelve costs.
  //
  // So this asks for all of them on the shortest of those windows. The extra
  // ranges ride a request that was leaving anyway, which makes them free —
  // and the roster and the leave list end up FRESHER than they were, not
  // staler.
  //
  // Monthly_History is deliberately NOT here. It holds finished months, it is
  // read behind its own long-lived cache in lib/history, and putting it on a
  // fifteen-second window would fetch a thousand rows four times a minute to
  // be told nothing had changed.
  const EVERY_TAB = [
    ...SHIFT_SCREEN_TABS.map(([range]) => range),
    `${TABS.FOOTAGE_FOLLOWUP}!A:J`,
    `${TABS.DAILY_SUMMARY}!A:N`,
  ]
  try { await warmTogether(CRM_SHEET_ID, EVERY_TAB) }
  catch (e) { console.error('tick: warm failed —', e.message) }

  // Checked once here rather than six times over. Signing in somewhere else
  // ends this session — see lib/session.js.
  if (!(await guardSession(user, res))) return

  // Passed straight through rather than defaulted here — each handler already
  // knows what it does with a missing parameter, and a second opinion about
  // that is exactly how two callers of the same endpoint start disagreeing.
  const q = req.query || {}
  const activeAgoMs = q.activeAgoMs

  // Deliberately sequential in one respect only: they all start together, so
  // their cache misses land in the same batch window.
  const [b, d, s, f, br, sh] = await Promise.all([
    run(board,       req, {}),
    run(myDay,       req, {}),
    run(summary,     req, q.range == null ? {} : { range: q.range }),
    run(footage,     req, {}),
    run(breakStatus, req, activeAgoMs == null ? {} : { activeAgoMs }),
    run(shiftStatus, req, {}),
  ])

  // One section reporting a replaced session is the whole session being
  // replaced — the page should go to the login screen, not carry on with five
  // panels out of six.
  const replaced = [b, d, s, f, br, sh].find(r => r.code === 401 && r.body?.reason === 'session-replaced')
  if (replaced) return res.status(401).json(replaced.body)

  return res.status(200).json({
    clients:     b.code  === 200 ? b.body  : null,
    myDay:       d.code  === 200 ? d.body  : null,
    summary:     s.code  === 200 ? s.body  : null,
    footage:     f.code  === 200 ? f.body  : null,
    breakStatus: br.code === 200 ? br.body : null,
    shiftStatus: sh.code === 200 ? sh.body : null,
  })
}
