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
  // Ranges that fail ONLY on a single-range read, not in a batch. The read
  // layer batches its cached reads and falls back to values.get for the
  // uncached ones, so this is how a test reaches the uncached path alone.
  rateLimitedSingle: new Set(),
  // Milliseconds a call to Google takes. A real Sheets request from a
  // serverless function is a couple of hundred; set this to measure how much
  // of a screen's wall-clock time is round trips rather than our own work.
  latencyMs: 0,
  // Whether an append is actually added to behaviour.data. Off by default;
  // see the append handler below.
  appendWritesBack: false,
  // Tabs the book reports as already existing, for code that checks before
  // creating one.
  sheetTitles: ['Credentials','Shift_Log','CRM_Updates','Redistribution_Log','Leaves',
                'Footage_Followup','Breaks','Shift_Overrides','Client_Timings',
                'Employee_Hours','Daily_Summary','Sessions'],
}

export function reset() {
  calls.get.length = 0
  calls.batchGet.length = 0
  calls.append.length = 0
  calls.update.length = 0
  behaviour.broken = new Set()
  behaviour.rateLimited = new Set()
  behaviour.rateLimitedSingle = new Set()
  behaviour.failBatch = false
  behaviour.data = {}
  behaviour.latencyMs = 0
  behaviour.appendWritesBack = false
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
        // Used by lib/session.js to check whether a tab needs creating.
        async get() {
          return { data: { sheets: behaviour.sheetTitles.map(t => ({ properties: { title: t } })) } }
        },
        async batchUpdate({ requestBody }) {
          const added = (requestBody?.requests || [])
            .map(r => r?.addSheet?.properties?.title).filter(Boolean)
          added.forEach(t => { if (!behaviour.sheetTitles.includes(t)) behaviour.sheetTitles.push(t) })
          return { data: {} }
        },
        values: {
          async get({ range }) {
            calls.get.push(range)
            await wait()
            if (behaviour.rateLimited.has(range) || behaviour.rateLimitedSingle.has(range)) throw rateLimit()
            if (behaviour.broken.has(range)) throw new Error(`Unable to parse range: ${range}`)
            return { data: { values: rowsFor(range) } }
          },
          // Writes are recorded and go nowhere. A test must never be able to
          // reach the real spreadsheet, and the platform is live.
          // Google answers an append with the range it actually wrote to, and
          // lib/sheets uses that to decide whether its cached copy of the tab
          // is still in step with the sheet. Answering without it would send
          // every append down the "throw the tab away" path and quietly stop
          // the test exercising the patch at all.
          //
          // By default the row is NOT added to behaviour.data: several tests
          // depend on the sheet still looking un-written immediately after an
          // append, which is exactly the window the in-memory guards exist to
          // cover. Set behaviour.appendWritesBack when the test wants a sheet
          // that really grows — a load measurement does, because whether the
          // cached copy stays in step with the sheet is part of what is being
          // measured.
          async append({ range, requestBody }) {
            calls.append.push(range)
            await wait()
            const tab = range.split('!')[0]
            const key = Object.keys(behaviour.data).find(k => k.split('!')[0] === tab)
            const n = (key ? behaviour.data[key].length : 1) + 1
            if (behaviour.appendWritesBack && key) {
              behaviour.data[key] = [...behaviour.data[key], ...(requestBody?.values || [])]
            }
            return { data: { updates: { updatedRange: `${tab}!A${n}:Z${n}` } } }
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
