/**
 * midnight-proving-keys-web.ts — BROWSER byte-source for the Midnight proving
 * keys (extension offscreen document + Android WebView).
 *
 * Same role as the Electron on-disk reader in src/main/midnight-proving-keys.ts,
 * and it feeds the SAME size + SHA-256 gate — only the transport differs. The
 * keys are packaged with the app (extension: web_accessible_resources; Android:
 * the Capacitor asset bundle) and fetched from the app's own origin, never from
 * the SDK's `-dev-` S3 bucket (no CORS, no integrity manifest, re-fetched every
 * cold start).
 *
 * ~3.7 MB total, so they are fetched lazily — only when a NIGHT send actually
 * needs to prove — and cached by the provider for the process lifetime.
 */

import { makeKeyMaterialProvider, type KeyMaterialProvider } from '../main/midnight-proving-keys'

/**
 * Resolve a packaged key file to a fetchable URL.
 * - Extension: chrome.runtime.getURL() (the offscreen document is an
 *   extension page, so this is same-origin and needs no host permission).
 * - Android/WebView: a path relative to the bundled app origin.
 */
function keyUrl(filename: string): string {
  const rel = `midnight-keys/${filename}`
  const runtime = (globalThis as { chrome?: { runtime?: { getURL?: (p: string) => string } } }).chrome?.runtime
  return runtime?.getURL ? runtime.getURL(rel) : new URL(rel, globalThis.location?.href ?? 'https://localhost/').toString()
}

/** Proving-key provider for browser targets — integrity-checked identically. */
export function makeWebKeyMaterialProvider(): KeyMaterialProvider {
  return makeKeyMaterialProvider(async (filename: string) => {
    const res = await fetch(keyUrl(filename))
    if (!res.ok) {
      throw new Error(`Midnight proving key ${filename}: HTTP ${res.status} (is it packaged with the app?)`)
    }
    return new Uint8Array(await res.arrayBuffer())
  })
}
