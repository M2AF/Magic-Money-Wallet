/**
 * history-wire.ts — the browsing-history contract, shared by every target
 *
 * Two producers, one consumer: Electron's main process (browser-store.ts) and
 * the mobile WebView layer (capacitor/browser-data-local.ts) both fill this
 * shape, and HistoryPanel + SuggestList render it without knowing which. Kept
 * here beside asset-filter-key.ts, theme-sync-wire.ts and downloads-wire.ts for
 * the same reason those are: the alternative is a hand-copied interface in two
 * places and a silent drift between them.
 *
 * `matchHistory` lives here too rather than in either UI, because the address
 * bar on desktop and the one on a phone must never rank the same query
 * differently — that is a behaviour, not a type, and behaviours drift faster.
 *
 * Deliberately free of both node and DOM types so it can be listed in every
 * tsconfig (see the comments in tsconfig.node.json / tsconfig.web.json).
 */

/** One visited page. Repeat visits collapse onto a single entry. */
export interface HistoryEntry {
  id: string
  /** Canonical http(s) URL — hash stripped, bare origins without a trailing slash. */
  url: string
  title: string
  /** Hostname without `www.`, precomputed because every match and row needs it. */
  host: string
  /** Most recent visit, ms epoch. The list is ordered by this, newest first. */
  lastVisitedAt: number
  /** Total visits to this URL. Ranks suggestions above one-off pages. */
  visits: number
}

/**
 * A whole history read.
 *
 * `recording` is false while Tor Mode is on — pages visited through Tor are
 * deliberately never written down, so the panel has to say so rather than look
 * broken when nothing appears after a session's browsing.
 */
export interface HistorySnapshot {
  items: HistoryEntry[]
  recording: boolean
  pausedReason?: string
}

/** Hostname without `www.`, or '' for anything unparseable. Used for grouping and matching. */
export function historyHost(url: string): string {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return ''
  }
}

/**
 * Rank history for the address bar.
 *
 * The tiers exist because a user typing "ope" almost always means a host they
 * know, not a page whose *title* happens to contain those letters — so a host
 * match outranks a title match no matter how recent the title match is. Within
 * a tier, a page visited often beats one visited once, and only then does
 * recency break the tie.
 *
 * An empty query returns the most recently visited entries, which is what the
 * bar shows the moment it is focused.
 */
export function matchHistory(items: HistoryEntry[], query: string, limit: number): HistoryEntry[] {
  if (limit <= 0) return []
  const q = query.trim().toLowerCase()

  const byRecency = (a: HistoryEntry, b: HistoryEntry) => b.lastVisitedAt - a.lastVisitedAt

  if (!q) return [...items].sort(byRecency).slice(0, limit)

  // Typing a full URL is a navigation, not a search — strip the scheme so
  // "https://exa" still matches the host "example.com".
  const bare = q.replace(/^[a-z][a-z0-9+.-]*:\/\//, '')

  const tierOf = (e: HistoryEntry): number => {
    const host = e.host.toLowerCase()
    if (host.startsWith(bare)) return 0
    if (host.includes(bare)) return 1
    if (e.url.toLowerCase().includes(bare)) return 2
    if (e.title.toLowerCase().includes(q)) return 3
    return -1
  }

  return items
    .map(entry => ({ entry, tier: tierOf(entry) }))
    .filter(scored => scored.tier >= 0)
    .sort((a, b) =>
      a.tier - b.tier
      || b.entry.visits - a.entry.visits
      || byRecency(a.entry, b.entry))
    .slice(0, limit)
    .map(scored => scored.entry)
}
