// A stand-in for the Google Sheets client, used only by scripts/batch-check.mjs.
//
// The point of the read layer is how many requests it sends, and that is
// exactly the thing you cannot see from outside it. This records every call so
// a test can assert on the count — without a network, credentials, or any
// contact with the live spreadsheet.
export const calls = { get: [], batchGet: [], append: [], update: [] }

// Ranges that should behave as unreadable, and ranges that should answer with
// a rate limit — set by the test before it runs.
export const behaviour = {
  broken: new Set(), rateLimited: new Set(), failBatch: false,
  // range -> rows, for tests that need a particular tab to hold something
  // specific rather than the self-describing default.
  data: {},
  // Milliseconds a call to Google takes. A real Sheets request from a
  // serverless function is a couple of hundred; set this to measure how much
  // of a screen's wall-clock time is round trips rather than our own work.
  latencyMs: 0,
}

export function reset() {
  calls.get.length = 0
  calls.batchGet.length = 0
  calls.append.length = 0
  calls.update.length = 0
  behaviour.broken = new Set()
  behaviour.rateLimited = new Set()
  behaviour.failBatch = false
  behaviour.data = {}
  behaviour.latencyMs = 0
}

const wait = () => behaviour.latencyMs > 0
  ? new Promise(r => setTimeout(r, behaviour.latencyMs))
  : Promise.resolve()

// Every range answers with one header row and one row naming itself, so a test
// can prove each caller got ITS range back and not a neighbour's — unless the
// test has said what that range should hold.
const rowsFor = (range) => behaviour.data[range] ?? [['header'], [`rows for ${range}`]]

function rateLimit() {
  const e = new Error('Quota exceeded for quota metric')
  e.code = 429
  return e
}

export const google = {
  auth: { GoogleAuth: class { constructor() {} } },
  sheets() {
    return {
      spreadsheets: {
        values: {
          async get({ range }) {
            calls.get.push(range)
            await wait()
            if (behaviour.rateLimited.has(range)) throw rateLimit()
            if (behaviour.broken.has(range)) throw new Error(`Unable to parse range: ${range}`)
            return { data: { values: rowsFor(range) } }
          },
          // Writes are recorded and go nowhere. A test must never be able to
          // reach the real spreadsheet, and the platform is live.
          async append({ range }) {
            calls.append.push(range)
            await wait()
            return { data: {} }
          },
          async update({ range }) {
            calls.update.push(range)
            await wait()
            return { data: {} }
          },
          async batchUpdate() { return { data: {} } },
          async batchGet({ ranges }) {
            calls.batchGet.push([...ranges])
            await wait()
            if (behaviour.failBatch) throw new Error('batch blew up')
            for (const r of ranges) {
              if (behaviour.rateLimited.has(r)) throw rateLimit()
              if (behaviour.broken.has(r)) throw new Error(`Unable to parse range: ${r}`)
            }
            return { data: { valueRanges: ranges.map(r => ({ range: r, values: rowsFor(r) })) } }
          },
        },
      },
    }
  },
}

export default { google }
