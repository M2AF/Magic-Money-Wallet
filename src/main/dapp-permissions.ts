/**
 * dapp-permissions.ts — per-chain dApp origin grants (shared, pure)
 *
 * The approved-origins list used to be a flat `string[]` shared by every chain,
 * so connecting a site for EVM silently authorised it to request Cardano and
 * Bitcoin signatures too. This module holds the per-chain shape and the
 * migration off the old one.
 *
 * Pure by design — no storage, no platform API. Electron (secure-store.ts, sync
 * JSON file), the extension (chrome-store.ts, chrome.storage) and both mobile
 * targets (capacitor-store.ts, Preferences) have incompatible I/O signatures but
 * MUST agree on the shape and the migration, so the decisions live here once and
 * each store only does its own reads and writes.
 */

export type DappChain = 'evm' | 'cardano' | 'bitcoin' | 'solana' | 'polkadot'

export const DAPP_CHAINS: readonly DappChain[] = ['evm', 'cardano', 'bitcoin', 'solana', 'polkadot']

/**
 * Map a user-facing chain label (as shown on an approval sheet) to its grant.
 * Every EVM network — Ethereum, Monad, Abstract, Robinhood, custom chains —
 * shares the one `evm` grant, because they share one address and one provider.
 */
export function grantForChainLabel(label: string): DappChain {
  switch (label.toLowerCase()) {
    case 'cardano':  return 'cardano'
    case 'bitcoin':  return 'bitcoin'
    case 'solana':   return 'solana'
    case 'polkadot': return 'polkadot'
    default:         return 'evm'
  }
}

export interface ApprovedOrigin {
  origin: string
  /** Chains this origin may use. Never empty — an empty grant is a revocation. */
  chains: DappChain[]
  addedAt: number
}

function isDappChain(value: unknown): value is DappChain {
  return typeof value === 'string' && (DAPP_CHAINS as readonly string[]).includes(value)
}

/**
 * Parse whatever is on disk into the current shape.
 *
 * Legacy `string[]` entries expand to ALL chains. That is deliberate: those
 * origins were genuinely approved by the user under the old semantics, and
 * narrowing them here would silently break every already-connected dApp on
 * upgrade. Only NEW grants are scoped to the chain that actually asked, so the
 * hole closes going forward without a forced reconnect.
 */
export function normalizeApprovedOrigins(raw: unknown): ApprovedOrigin[] {
  if (!Array.isArray(raw)) return []
  const out: ApprovedOrigin[] = []

  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry) out.push({ origin: entry, chains: [...DAPP_CHAINS], addedAt: 0 })
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Partial<ApprovedOrigin>
    if (typeof record.origin !== 'string' || !record.origin) continue
    const chains = Array.isArray(record.chains) ? record.chains.filter(isDappChain) : []
    if (chains.length === 0) continue   // an empty grant means revoked
    out.push({
      origin: record.origin,
      chains: [...new Set(chains)],
      addedAt: typeof record.addedAt === 'number' ? record.addedAt : 0,
    })
  }

  // Collapse duplicates (possible if a legacy file listed an origin twice).
  const merged = new Map<string, ApprovedOrigin>()
  for (const record of out) {
    const existing = merged.get(record.origin)
    if (!existing) { merged.set(record.origin, record); continue }
    existing.chains = [...new Set([...existing.chains, ...record.chains])]
    existing.addedAt = Math.min(existing.addedAt || record.addedAt, record.addedAt || existing.addedAt)
  }
  return [...merged.values()]
}

/** Is this origin allowed to use this chain? */
export function hasChainGrant(records: ApprovedOrigin[], origin: string, chain: DappChain): boolean {
  const record = records.find(r => r.origin === origin)
  return !!record && record.chains.includes(chain)
}

/** Grant `chain` to `origin`, leaving any grants it already has intact. */
export function grantChain(records: ApprovedOrigin[], origin: string, chain: DappChain): ApprovedOrigin[] {
  const existing = records.find(r => r.origin === origin)
  if (!existing) return [...records, { origin, chains: [chain], addedAt: Date.now() }]
  if (existing.chains.includes(chain)) return records
  return records.map(r =>
    r.origin === origin ? { ...r, chains: [...r.chains, chain] } : r
  )
}

/**
 * Revoke a single chain, or the whole origin when `chain` is omitted. Revoking
 * the last remaining chain drops the origin entirely, so a site with no grants
 * never lingers in the Connected Sites list.
 */
export function revokeChain(
  records: ApprovedOrigin[], origin: string, chain?: DappChain
): ApprovedOrigin[] {
  if (!chain) return records.filter(r => r.origin !== origin)
  return records
    .map(r => (r.origin === origin ? { ...r, chains: r.chains.filter(c => c !== chain) } : r))
    .filter(r => r.chains.length > 0)
}

/** Flat origin list — the shape the pre-existing callers and the UI still use. */
export function originList(records: ApprovedOrigin[]): string[] {
  return records.map(r => r.origin)
}
