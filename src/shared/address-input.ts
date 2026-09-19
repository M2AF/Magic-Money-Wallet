/**
 * What the browser's address bar does with typed text — shared by the Electron
 * browser (BrowserApp) and the Capacitor overlay (Android + iOS) so every
 * platform agrees on "is this a site or a search?".
 *
 * Anything that doesn't look like a web address goes to ChainLens search, which
 * reads `?q=` on /search and runs the query straight away.
 */

export const CHAINLENS_SEARCH_URL = 'https://www.chainlensnft.info/search'

export function chainlensSearchUrl(query: string): string {
  return `${CHAINLENS_SEARCH_URL}?q=${encodeURIComponent(query.replace(/\s+/g, ' ').trim())}`
}

// A host the user plausibly meant to visit: localhost, a dotted-quad IPv4, a
// bracketed IPv6, or dotted labels ending in an alphabetic / punycode TLD.
// Deliberately rejects bare words ("uniswap") and numbers ("3.5"), which the
// URL parser would otherwise happily accept as hosts.
const HOST_LIKE = new RegExp(
  '^(?:localhost'
  + '|\\d{1,3}(?:\\.\\d{1,3}){3}'
  + '|\\[[0-9a-f:.]+\\]'
  + '|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]+))'
  + '(?::\\d{1,5})?$',
  'i',
)

/**
 * Resolve address-bar input to the URL to load: the input itself when it is an
 * http(s) address (scheme added if missing; http for .onion), otherwise a
 * ChainLens search for it. Returns null only for blank input.
 */
export function resolveAddressInput(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null

  if (/^https?:\/\//i.test(raw)) {
    try { return new URL(raw).toString() } catch { return chainlensSearchUrl(raw) }
  }

  if (!/\s/.test(raw)) {
    const host = raw.split(/[/?#]/, 1)[0]
    if (HOST_LIKE.test(host)) {
      const scheme = /\.onion(?::\d+)?$/i.test(host) ? 'http' : 'https'
      try { return new URL(`${scheme}://${raw}`).toString() } catch { /* fall through */ }
    }
  }

  return chainlensSearchUrl(raw)
}
