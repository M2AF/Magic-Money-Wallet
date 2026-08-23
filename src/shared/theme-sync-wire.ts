/**
 * theme-sync-wire.ts — the wire contract for custom themes on a ChainLens profile.
 *
 * FROZEN. The Worker (cloudflare-worker/db.js) carries a hand-kept port of
 * sanitizeThemeEntries + mergeThemeEntries, because the merge has to run
 * server-side too: every client pushes its whole list, so a plain overwrite
 * would let the desktop silently undo a theme made on the phone. Drift between
 * the two is SILENT — a theme just quietly fails to appear on the other device.
 *
 * Shape mirrors asset-filter-key.ts on purpose, for the same reasons:
 *
 *   entries[id] = { n: name, c: { bg, accent, text }, t: epochMs, d?: 1 }
 *
 * ⚠ `d: 1` is a TOMBSTONE, not a deletion. Drop the key instead and the other
 * device's next push resurrects the theme forever, exactly as removing a key
 * would re-hide a restored asset. Merge is per-id last-write-wins on `t`, so a
 * newer delete outranks an older edit and a newer edit outranks an older delete.
 *
 * Deliberately NOT synced: which theme is currently selected. `mm.theme` stays
 * per install — the ask was that the themes travel, and repainting someone's
 * desktop because they tried a colour on their phone is a different feature.
 */

/** The three colours a custom theme is built from (see lib/theme-tokens.ts). */
export interface ThemeWireColors {
  bg: string
  accent: string
  text: string
}

export interface ThemeWireEntry {
  /** Display name, trimmed to NAME_MAX. */
  n: string
  c: ThemeWireColors
  /** epoch ms of the last change — the merge's only tiebreak. */
  t: number
  /** 1 = deleted. A tombstone, never absent-means-deleted. */
  d?: 1
}

export type ThemeEntries = Record<string, ThemeWireEntry>

/** Matches MAX_CUSTOM_THEMES in the renderer; duplicated so the wire is standalone. */
export const MAX_SYNCED_THEMES = 6
/** Room for a generous id without letting a client push unbounded keys. */
export const THEME_ID_MAX = 64
export const THEME_NAME_MAX = 24
/** Tombstones are small; this is the ceiling on the whole map, live + deleted. */
export const MAX_THEME_ENTRIES = 64

const HEX = /^#[0-9a-f]{6}$/i

/** `#RRGGBB` lowercased, or null when it isn't one. Never throws. */
function cleanHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.trim()
  return HEX.test(s) ? s.toLowerCase() : null
}

/**
 * Drop anything that is not a well-formed entry, rather than trusting a peer or
 * a corrupted localStorage blob. An unparseable entry is skipped, never
 * defaulted: inventing colours for it would silently overwrite a good copy on
 * the other device via the merge.
 */
export function sanitizeThemeEntries(value: unknown): ThemeEntries {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ThemeEntries = {}
  let seen = 0
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (seen >= MAX_THEME_ENTRIES) break
    if (!id || id.length > THEME_ID_MAX || !id.startsWith('custom-')) continue
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Partial<ThemeWireEntry>
    // typeof first: Number(null) is 0, which is a FINITE, non-negative number,
    // so a null timestamp would sail through as "the oldest possible entry"
    // instead of being rejected. t = 0 itself stays legal.
    const t = e.t
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0) continue

    if (e.d === 1) {
      // A tombstone carries no colours — keep it as small as it is.
      out[id] = { n: '', c: { bg: '', accent: '', text: '' }, t, d: 1 }
      seen++
      continue
    }

    const bg = cleanHex(e.c?.bg)
    const accent = cleanHex(e.c?.accent)
    const text = cleanHex(e.c?.text)
    if (!bg || !accent || !text) continue
    out[id] = {
      n: (typeof e.n === 'string' ? e.n : '').trim().slice(0, THEME_NAME_MAX) || 'Custom',
      c: { bg, accent, text },
      t,
    }
    seen++
  }
  return out
}

/**
 * Per-id last-write-wins. Ties go to `b`, which makes the server's reply
 * idempotent when a client re-pushes the same list.
 */
export function mergeThemeEntries(a: ThemeEntries, b: ThemeEntries): ThemeEntries {
  const out: ThemeEntries = { ...a }
  for (const [id, entry] of Object.entries(b)) {
    const mine = out[id]
    if (!mine || entry.t >= mine.t) out[id] = entry
  }
  return out
}

/** Live (non-tombstoned) entries, newest first, capped at MAX_SYNCED_THEMES. */
export function liveThemeEntries(entries: ThemeEntries): [string, ThemeWireEntry][] {
  return Object.entries(entries)
    .filter(([, e]) => e.d !== 1)
    .sort((x, y) => y[1].t - x[1].t)
    .slice(0, MAX_SYNCED_THEMES)
}

/**
 * Keep the map from growing without bound: once a tombstone is older than every
 * live theme and the map is over the ceiling, it has done its job — no device
 * still holding that theme can have an older copy that would resurrect it.
 */
export function pruneThemeEntries(entries: ThemeEntries): ThemeEntries {
  const all = Object.entries(entries)
  if (all.length <= MAX_THEME_ENTRIES) return entries
  const live = all.filter(([, e]) => e.d !== 1)
  const dead = all.filter(([, e]) => e.d === 1).sort((x, y) => y[1].t - x[1].t)
  return Object.fromEntries([...live, ...dead.slice(0, Math.max(0, MAX_THEME_ENTRIES - live.length))])
}
