import type { Plugin } from 'vite'

/**
 * monero-csp-patch — build-time removal of monero-ts's `new Function(...)` use.
 *
 * monero-ts (and the webpack-bundled copy inside monero.worker.js) sniffs its
 * environment with `new Function("try {return this===window;}...")()` at module
 * load. Under a CSP without 'unsafe-eval' — extension pages ALWAYS (MV3 forbids
 * it), and any future WebView CSP — that throws
 *   "Evaluating a string as JavaScript violates ... 'unsafe-eval'"
 * and the whole library fails to load. These rewrites are semantically
 * equivalent CSP-safe expressions:
 *   - main-thread check → typeof window/importScripts probes
 *   - jsdom check       → false (never jsdom in our targets)
 *   - webpack global    → globalThis
 *
 * Registered in BOTH `plugins` and `worker.plugins` (the ?worker bundle goes
 * through a separate rollup pass) of the extension and capacitor configs.
 */
export function moneroCspPatch(): Plugin {
  return {
    name: 'monero-csp-patch',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('monero-ts') || !code.includes('new Function(')) return null
      const patched = code
        .replace(
          /new Function\("try \{return this===window;\}catch\(e\)\{return false;\}"\)\(\)/g,
          "(typeof window !== 'undefined' && typeof importScripts === 'undefined')"
        )
        .replace(
          /new Function\("try \{return window\.navigator\.userAgent[^"]*"\)\(\)/g,
          'false'
        )
        .replace(
          /new Function\("return this"\)\(\)/g,
          'globalThis'
        )
      return patched === code ? null : { code: patched, map: null }
    },
  }
}
