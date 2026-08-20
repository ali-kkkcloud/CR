// Lets plain `node` load the app's modules, which import each other without
// file extensions the way Next resolves them. Test-only.
//
//   node --import ./scripts/test-hooks.mjs ./scripts/stability-check.mjs
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

export async function resolve(specifier, context, nextResolve) {
  // Test-only, and only when asked for: swap the real Sheets client for the
  // recorder in fake-googleapis.mjs, so a test can count the requests the read
  // layer actually sends without a network or a spreadsheet anywhere near it.
  if (specifier === 'googleapis' && process.env.CAUTIO_FAKE_SHEETS) {
    const p = resolvePath(dirname(fileURLToPath(import.meta.url)), 'fake-googleapis.mjs')
    return { url: pathToFileURL(p).href, shortCircuit: true }
  }
  if (specifier.startsWith('.') && !/\.[mc]?js$/.test(specifier)) {
    const base = dirname(fileURLToPath(context.parentURL))
    for (const ext of ['.js', '.mjs', '/index.js']) {
      const p = resolvePath(base, specifier + ext)
      if (existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
