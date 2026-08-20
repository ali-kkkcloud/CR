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
}

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
            if (behaviour.rateLimited.has(range)) throw rateLimit()
            if (behaviour.broken.has(range)) throw new Error(`Unable to parse range: ${range}`)
            return { data: { values: rowsFor(range) } }
          },
          // Writes are recorded and go nowhere. A test must never be able to
          // reach the real spreadsheet, and the platform is live.
          async append({ range }) {
            calls.append.push(range)
            return { data: {} }
          },
          async update({ range }) {
            calls.update.push(range)
            return { data: {} }
          },
          async batchUpdate() { return { data: {} } },
          async batchGet({ ranges }) {
            calls.batchGet.push([...ranges])
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
