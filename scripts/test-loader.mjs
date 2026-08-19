// Lets plain `node` load the app's modules, which import each other without
// file extensions the way Next resolves them. Test-only.
//
//   node --import ./scripts/test-hooks.mjs ./scripts/stability-check.mjs
import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[mc]?js$/.test(specifier)) {
    const base = dirname(fileURLToPath(context.parentURL))
    for (const ext of ['.js', '.mjs', '/index.js']) {
      const p = resolvePath(base, specifier + ext)
      if (existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true }
    }
  }
  return nextResolve(specifier, context)
}
