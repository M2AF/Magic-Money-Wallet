/**
 * asset-filter-key.ts — the one asset identity shared by MagicMoney and ChainLens.
 *
 * Both products let you hide an asset, and both stored that decision under a key
 * of their own invention:
 *
 *   MagicMoney token   ethereum:0xA0b8…              chain : contract, mixed case
 *   MagicMoney NFT     ethereum:0xbc4c…:1234         chain : contract : tokenId
 *   ChainLens  token   ethereum-0xa0b8…              chain - contract, lowercased
 *   ChainLens  NFT     ethereum-ethereum-0x…-1234    chain doubled, because its
 *                                                    display ids already carry it
 *
 * Handing either format to the other side hides nothing, so both now write the
 * canonical key below. It is always derived from the ASSET's own fields (chain,
 * contract, tokenId) and never parsed back out of a display id, because the two
 * products' display ids genuinely disagree about what an id is.
 *
 * ⚠ THIS IS A WIRE CONTRACT. Keys written by any client outlive that client in
 * the database, so editing a rule here silently un-hides assets for everyone who
 * already hid them. Add a `v2` discriminator and migrate — never edit v1.
 *
 * Platform-neutral by design: imported by Electron main, the extension/Capacitor
 * handler router, and the renderer. `public/asset-filter-key.js` in the chainlens
 * repo is the hand-kept JavaScript port; the two MUST agree, and its header says
 * so as well.
 */

/** Which of the two lists an asset lands in, plus the explicit "visible" state. */
export type AssetFilterState =
  | 'h'   // hidden by the user
  | 's'   // marked as spam by the user
  | 'a'   // explicitly restored — also whitelists an auto-flagged phishing token

/** One decision, with the wall-clock time it was taken (last write wins). */
export interface AssetFilterEntry {
  s: AssetFilterState
  t: number
}

/** The whole synced set: canonical key → decision. */
export type AssetFilterEntries = Record<string, AssetFilterEntry>

/**
 * The chain's own coin, which has no contract. MagicMoney writes the EVM zero
 * address for it and ChainLens writes the literal "native"; both mean the same
 * asset, so both collapse to one spelling.
 */
const NATIVE_RE = /^(?:native|0x0{40})$/i

const clean = (v: string | null | undefined) => (v ?? '').trim().toLowerCase()

/** Canonical key for a fungible holding. */
export function canonicalTokenKey(chain: string, contractAddress: string | null | undefined): string {
  const raw = (contractAddress ?? '').trim()
  return `${clean(chain)}:t:${NATIVE_RE.test(raw) ? 'native' : raw.toLowerCase()}`
}

/**
 * Canonical key for a collectible.
 *
 * Three chains need their own rule because contract+tokenId is not how they name
 * a single NFT, and the two products split the name differently:
 *
 *   solana   the mint IS the NFT. MagicMoney knows the collection address and
 *            ChainLens does not, so a collection-keyed id could never match.
 *   cardano  policy id + asset name concatenated is the asset *unit* — which is
 *            exactly the whole id ChainLens carries.
 *   bitcoin  the inscription id is the identity; its number is only a label.
 */
export function canonicalNftKey(
  chain: string,
  contractAddress: string | null | undefined,
  tokenId: string | null | undefined,
): string {
  const c = clean(chain)
  const contract = clean(contractAddress)
  const token = clean(tokenId)
  if (c === 'solana')  return `${c}:n:${token || contract}`
  if (c === 'cardano') return `${c}:n:${contract}${token}`
  if (c === 'bitcoin') return `${c}:n:${contract}`
  return `${c}:n:${contract}:${token}`
}

// ─── Migration off the pre-sync MagicMoney keys ──────────────────────────────

/**
 * Canonical keys for one key saved by a MagicMoney build that predates syncing.
 *
 * Those keys are ambiguous — `solana:<mint>` is both what a hidden SPL token and
 * a hidden Solana NFT looked like — so this returns EVERY reading rather than
 * guessing. Emitting a spare key is free: mints, units and contract addresses do
 * not collide, so a reading that was wrong simply matches no asset the user
 * holds, while guessing wrong would un-hide something they hid.
 */
export function legacyWalletKeyToCanonical(legacy: string): string[] {
  const parts = (legacy ?? '').split(':')
  if (parts.length < 2) return []
  const chain = parts[0]
  const rest = parts.slice(1)
  const out = new Set<string>()

  // `bitcoin:ordinal:<inscription id>` — an inscription, never a token.
  if (clean(chain) === 'bitcoin' && clean(rest[0]) === 'ordinal' && rest.length >= 2) {
    out.add(canonicalNftKey(chain, rest.slice(1).join(':'), ''))
    return [...out]
  }

  // A token contract may itself contain colons (`rune:UNCOMMON•GOODS`), so the
  // token reading always takes the whole tail.
  out.add(canonicalTokenKey(chain, rest.join(':')))

  if (rest.length === 1) {
    // Two-part NFT ids exist only where the mint/unit alone names the NFT.
    const c = clean(chain)
    if (c === 'solana' || c === 'cardano') out.add(canonicalNftKey(chain, rest[0], rest[0]))
  } else {
    out.add(canonicalNftKey(chain, rest[0], rest.slice(1).join(':')))
  }
  return [...out]
}

// ─── The synced set ──────────────────────────────────────────────────────────

/**
 * Hard cap on stored decisions, enforced by both servers.
 *
 * Without one, a wallet that meets a few thousand airdropped scam tokens grows a
 * JSONB blob that every login has to download. Oldest decisions are dropped
 * first; the assets involved are long gone from the portfolio by then.
 */
export const MAX_FILTER_ENTRIES = 2000

/**
 * Per-key last-write-wins union of two sets.
 *
 * Both sides push their whole set, so a plain overwrite would let the desktop
 * silently undo a hide made on the phone. Timestamps make that converge, and
 * they are what makes RESTORE work across devices: 'a' is a tombstone, not an
 * absence, so it can out-rank a stale 'h' instead of being re-added by it.
 *
 * Clock skew between devices is the known limitation — a device running minutes
 * fast wins ties it should lose. The blast radius is one asset's visibility, and
 * the user can simply hide it again, so this is not worth a vector clock.
 */
export function mergeFilterEntries(
  base: AssetFilterEntries | null | undefined,
  incoming: AssetFilterEntries | null | undefined,
): AssetFilterEntries {
  const out: AssetFilterEntries = {}
  for (const src of [base, incoming]) {
    if (!src || typeof src !== 'object') continue
    for (const [key, entry] of Object.entries(src)) {
      if (!isFilterEntry(entry) || !key) continue
      const held = out[key]
      if (!held || entry.t > held.t) out[key] = { s: entry.s, t: entry.t }
    }
  }
  const keys = Object.keys(out)
  if (keys.length <= MAX_FILTER_ENTRIES) return out
  const kept: AssetFilterEntries = {}
  for (const key of keys.sort((a, b) => out[b].t - out[a].t).slice(0, MAX_FILTER_ENTRIES)) {
    kept[key] = out[key]
  }
  return kept
}

/** Reject anything the server or another client sent that isn't a decision. */
export function isFilterEntry(value: unknown): value is AssetFilterEntry {
  if (!value || typeof value !== 'object') return false
  const e = value as Partial<AssetFilterEntry>
  return (e.s === 'h' || e.s === 's' || e.s === 'a') && typeof e.t === 'number' && Number.isFinite(e.t)
}

/** Drop every non-conforming member of an untrusted entries object. */
export function sanitizeFilterEntries(value: unknown): AssetFilterEntries {
  if (!value || typeof value !== 'object') return {}
  const out: AssetFilterEntries = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key && key.length <= 256 && isFilterEntry(entry)) out[key] = { s: entry.s, t: entry.t }
  }
  return out
}

/** The three sets the dashboard filters with, derived from the synced entries. */
export function entriesToSets(entries: AssetFilterEntries): {
  hidden: Set<string>; spam: Set<string>; allowed: Set<string>
} {
  const hidden = new Set<string>(), spam = new Set<string>(), allowed = new Set<string>()
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.s === 'h') hidden.add(key)
    else if (entry.s === 's') spam.add(key)
    else allowed.add(key)
  }
  return { hidden, spam, allowed }
}