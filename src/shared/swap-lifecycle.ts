/**
 * swap-lifecycle.ts — what actually happened to a cross-chain swap.
 *
 * THE BUG THIS REPLACES
 *
 * The Worker mapped `status === 'DONE'` to `done` and dropped the substatus on
 * the floor. LI.FI uses `DONE` for three outcomes that could hardly be more
 * different:
 *
 *   DONE / COMPLETED   the user got the token they asked for
 *   DONE / PARTIAL     the bridge delivered SOMETHING ELSE — typically the
 *                      bridged stable rather than the destination token, because
 *                      the final swap leg failed
 *   DONE / REFUNDED    the user got their ORIGINAL token back on the SOURCE
 *                      chain; the swap did not happen
 *
 * All three rendered as "✓ Bridge complete — Received <the token you asked
 * for>", using the requested symbol rather than what arrived. A refund was
 * reported as a successful swap.
 *
 * Mapping lives here, in TypeScript, rather than in the Worker: the Worker
 * passes provider fields through and this decides what they mean, so the
 * semantics are unit-testable and ChainLens can reuse them. Platform-neutral —
 * no Electron, Chrome, Capacitor, node: or fetch.
 */

import { normalizeSwapAddress } from './swap-token-identity'

/**
 * Canonical lifecycle state.
 *
 * Ordered roughly by progress, but treat them as distinct outcomes rather than
 * a scale: `partial` and `refunded` are both terminal, and neither is success.
 */
export type SwapLifecycleState =
  /** Signed and sent; the network has not confirmed inclusion. NOT confirmed. */
  | 'source-submitted'
  /** Source transaction is mined and successful. */
  | 'source-confirmed'
  /** Source settled; the bridge is moving value. */
  | 'bridging'
  /** The expected token reached the expected recipient. The only success. */
  | 'completed'
  /** Delivered, but not the asset that was asked for. Terminal, not success. */
  | 'partial'
  /** A refund has been started but has not arrived. */
  | 'refund-pending'
  /** The original asset was returned on the source chain. The swap did not happen. */
  | 'refunded'
  /** The route failed and no refund is indicated. */
  | 'failed'
  /** We genuinely do not know. A timeout is this — never `failed`. */
  | 'unknown'

/** True for states where nothing more will change without intervention. */
export function isTerminalSwapState(state: SwapLifecycleState): boolean {
  return state === 'completed' || state === 'partial' || state === 'refunded' || state === 'failed'
}

/** True only when the user received what they asked for. */
export function isSwapSuccess(state: SwapLifecycleState): boolean {
  return state === 'completed'
}

/** What actually arrived, which is not necessarily what was requested. */
export interface DeliveredAsset {
  chain: string | null
  address: string | null
  symbol: string | null
  decimals: number | null
  amountRaw: string | null
}

export interface SwapStatusReport {
  state: SwapLifecycleState
  /** Provider's own status/substatus, kept verbatim for support and debugging. */
  providerStatus: string | null
  providerSubstatus: string | null
  /** Human-readable explanation of a non-completed outcome. */
  message: string | null
  delivered: DeliveredAsset | null
  destTxHash: string | null
  destExplorerUrl: string | null
}

/** Raw fields a provider status response can carry, after the Worker passes them through. */
export interface RawProviderStatus {
  provider?: string | null
  status?: string | null
  substatus?: string | null
  receivedAmountRaw?: string | null
  receivedTokenChain?: string | null
  receivedTokenAddress?: string | null
  receivedTokenSymbol?: string | null
  receivedTokenDecimals?: number | null
  destTxHash?: string | null
  destExplorerUrl?: string | null
  /** Set when the provider reported the hash is not indexed yet. */
  notFound?: boolean | null
}

const upper = (v: unknown): string => (typeof v === 'string' ? v.trim().toUpperCase() : '')

/**
 * LI.FI substatuses, split by what they mean for the user rather than by the
 * status they arrive under — `REFUND_IN_PROGRESS` shows up under both PENDING
 * and FAILED, and means the same thing in each.
 */
const LIFI_REFUND_PENDING = new Set(['REFUND_IN_PROGRESS', 'NOT_PROCESSABLE_REFUND_NEEDED'])
const LIFI_BRIDGING = new Set([
  'WAIT_SOURCE_CONFIRMATIONS', 'WAIT_DESTINATION_TRANSACTION',
  'BRIDGE_NOT_AVAILABLE', 'CHAIN_NOT_AVAILABLE',
])

function deliveredFrom(raw: RawProviderStatus): DeliveredAsset | null {
  const amount = raw.receivedAmountRaw ?? null
  const address = raw.receivedTokenAddress ?? null
  if (!amount && !address) return null
  return {
    chain: raw.receivedTokenChain ?? null,
    address,
    symbol: raw.receivedTokenSymbol ?? null,
    decimals: typeof raw.receivedTokenDecimals === 'number' ? raw.receivedTokenDecimals : null,
    amountRaw: amount,
  }
}

/**
 * Map a provider's raw status onto the canonical lifecycle.
 *
 * `expectedTokenAddress` is what the user asked to receive. It is compared
 * against what the provider says arrived, because a provider reporting DONE is
 * not the same as the user getting their token — and on a refund the asset that
 * arrives is the one they sold, on the chain they sold it from.
 */
export function mapProviderStatus(
  raw: RawProviderStatus,
  expectedTokenAddress: string,
): SwapStatusReport {
  const status = upper(raw.status)
  const substatus = upper(raw.substatus)
  const delivered = deliveredFrom(raw)
  const base = {
    providerStatus: raw.status ?? null,
    providerSubstatus: raw.substatus ?? null,
    delivered,
    destTxHash: raw.destTxHash ?? null,
    destExplorerUrl: raw.destExplorerUrl ?? null,
  }

  // A hash the provider cannot find yet is UNKNOWN, never failed. Bridges index
  // asynchronously, and a fresh source transaction routinely 404s for a while.
  if (raw.notFound || status === 'NOT_FOUND') {
    return { ...base, state: 'unknown', message: 'The bridge has not indexed this transaction yet.' }
  }

  if (status === 'DONE') {
    if (substatus === 'REFUNDED') {
      return {
        ...base, state: 'refunded',
        message: 'The swap did not go through. Your original funds were returned on the source chain.',
      }
    }
    if (substatus === 'PARTIAL') {
      return {
        ...base, state: 'partial',
        message: delivered?.symbol
          ? `The destination swap did not complete. You received ${delivered.symbol} instead of the token you asked for.`
          : 'The destination swap did not complete. A different asset was delivered.',
      }
    }
    // COMPLETED — but only if what arrived is what was asked for. A provider
    // saying DONE is not evidence about WHICH token landed.
    if (delivered?.address && expectedTokenAddress
        && !sameAsset(delivered.address, expectedTokenAddress, delivered.chain)) {
      return {
        ...base, state: 'partial',
        message: `The bridge delivered ${delivered.symbol ?? 'a different asset'} rather than the token you asked for.`,
      }
    }
    return { ...base, state: 'completed', message: null }
  }

  if (status === 'FAILED') {
    if (LIFI_REFUND_PENDING.has(substatus)) {
      return { ...base, state: 'refund-pending', message: 'The route failed. A refund is in progress.' }
    }
    return { ...base, state: 'failed', message: 'The bridge reported that this route failed.' }
  }

  if (status === 'PENDING') {
    if (LIFI_REFUND_PENDING.has(substatus)) {
      return { ...base, state: 'refund-pending', message: 'The route failed. A refund is in progress.' }
    }
    if (LIFI_BRIDGING.has(substatus) || !substatus) {
      return { ...base, state: 'bridging', message: null }
    }
    return { ...base, state: 'bridging', message: null }
  }

  if (status === 'INVALID') {
    return { ...base, state: 'failed', message: 'The bridge rejected this transaction as invalid.' }
  }

  return { ...base, state: 'unknown', message: 'The bridge did not report a status we recognise.' }
}

/**
 * Provider chain ids that mean Solana. Each provider spells it differently:
 * LI.FI 1151111081099710, Relay 792703809, Rango 'SOLANA'.
 */
const SOLANA_PROVIDER_CHAINS = new Set(['solana', '1151111081099710', '792703809'])

/**
 * Asset comparison for delivery checking — CHAIN-AWARE, via the same identity
 * rules the picker and quotes use (swap-token-identity.ts).
 *
 * EVM addresses are case-insensitive hex; Solana mints are case-sensitive
 * base58. And each ecosystem has more than one spelling of its native coin:
 * LI.FI reports native SOL as the System Program id `1111…1111` while the
 * wallet asks for it as the wrapped-SOL mint `So111…112`, and EVM native is
 * both `0xeee…` and the zero address. Compared literally, a correct native SOL
 * delivery was reported as "a different asset" (field report 2026-09-22: 55 MON
 * -> SOL, DONE/COMPLETED, native SOL credited on-chain above the minimum).
 *
 * `deliveredChain` is the provider's chain id for the delivered asset. Unknown
 * chains fall back to shape: two EVM addresses compare as EVM; anything else
 * must match exactly. A genuinely different mint, or a refund in the SOLD token
 * on another chain, still differs.
 */
export function sameAsset(delivered: string, expected: string, deliveredChain?: string | null): boolean {
  const isHex = (v: string) => /^0x[0-9a-fA-F]{40}$/.test(v)
  const chain = String(deliveredChain ?? '').trim()
  if (SOLANA_PROVIDER_CHAINS.has(chain.toLowerCase())) {
    return normalizeSwapAddress('solana', delivered) === normalizeSwapAddress('solana', expected)
  }
  if (isHex(delivered) && isHex(expected)) {
    // Any EVM chain: every EVM member shares the same normalization.
    return normalizeSwapAddress('ethereum', delivered) === normalizeSwapAddress('ethereum', expected)
  }
  return delivered === expected
}

/**
 * Map Rango's status vocabulary onto the same lifecycle.
 *
 * Rango reports `success` / `failed` / `running`. It carries no PARTIAL concept
 * of its own, so a delivered asset that is not the requested one is the only
 * signal available — which is exactly why the delivered-asset check above is not
 * LI.FI-specific.
 */
/**
 * Map Relay's status vocabulary onto the same lifecycle.
 *
 * VERIFIED against real records from `api.relay.link/requests/v2` on
 * 2026-09-20 — `success`, `refund`, `failure`, `pending` and (from
 * `/intents/status`) `unknown` were all observed.
 *
 * The trap Relay sets, and the reason this cannot read `currencyOut`:
 * on a REFUND, `metadata.currencyOut` still describes what the user ASKED for —
 * a token on the destination chain — while the money actually went back on the
 * SOURCE chain. Two recorded refunds show it plainly: in/out both chain 8453
 * while `currencyOut` says M87 on chain 1, and in/out both chain 56 while
 * `currencyOut` says FRONG on chain 4663. Believing `currencyOut` there would
 * report a refund as a delivery of exactly the token the user wanted.
 *
 * So the refunded asset is taken from `refundCurrency`/the source chain, never
 * from the requested output.
 */
export function mapRelayStatus(
  raw: RawProviderStatus & {
    failReason?: string | null
    sourceChain?: string | null
    outboundChain?: string | null
  },
  expectedTokenAddress: string,
): SwapStatusReport {
  const status = (raw.status ?? '').toLowerCase()
  const base = {
    providerStatus: raw.status ?? null,
    providerSubstatus: raw.failReason ?? raw.substatus ?? null,
    delivered: deliveredFrom(raw),
    destTxHash: raw.destTxHash ?? null,
    destExplorerUrl: raw.destExplorerUrl ?? null,
  }
  const why = raw.failReason && raw.failReason !== 'N/A' ? ` (${raw.failReason})` : ''

  switch (status) {
    case 'success':
      // Still subject to the delivered-asset check: a solver filling with
      // something other than the requested token is a partial, not a success.
      // The report keeps RELAY's vocabulary ('success'), not the 'DONE' used to
      // reach the shared mapper: reconciliation maps a report's providerStatus
      // again, and 'DONE' is not a Relay status — every successful Relay swap
      // was being recorded as 'unknown' ("a status we do not recognise").
      return {
        ...mapProviderStatus({ ...raw, status: 'DONE', substatus: 'COMPLETED' }, expectedTokenAddress),
        providerStatus: base.providerStatus,
        providerSubstatus: base.providerSubstatus,
      }
    case 'refund':
      return {
        ...base, state: 'refunded',
        message:
          `The swap did not go through${why}. Relay returned your funds on the source chain — `
          + 'not the token you asked for, and not on the destination chain.',
      }
    case 'failure':
      return {
        ...base, state: 'failed',
        message: `Relay reported this route failed${why}.`,
      }
    case 'pending':
    case 'waiting':
    case 'delayed':
      return { ...base, state: 'bridging', message: null }
    case 'unknown':
      return {
        ...base, state: 'unknown',
        message: 'Relay has not recorded this request yet.',
      }
    default:
      return { ...base, state: 'unknown', message: 'Relay returned a status we do not recognise.' }
  }
}

/**
 * THE entry point for turning a provider's status into a lifecycle report.
 *
 * Both the live status card (via `getCrossSwapStatus`) and the persisted,
 * restart-safe reconcile loop (`reconcileSessions`) call this. They used to
 * each carry their own `provider === 'rango' ? … : …` dispatch, and when Relay
 * was added to one and not the other, a Relay refund showed correctly on screen
 * while being stored as `unknown` — the exact live-vs-resumed disagreement the
 * shared mapper was meant to rule out. One dispatch, so that cannot recur.
 */
export function mapStatusForProvider(
  provider: string,
  raw: RawProviderStatus & { failReason?: string | null; sourceChain?: string | null; outboundChain?: string | null },
  expectedTokenAddress: string,
): SwapStatusReport {
  switch (provider) {
    case 'relay': return mapRelayStatus(raw, expectedTokenAddress)
    case 'rango': return mapRangoStatus(raw, expectedTokenAddress)
    default: return mapProviderStatus(raw, expectedTokenAddress)
  }
}

export function mapRangoStatus(
  raw: RawProviderStatus, expectedTokenAddress: string,
): SwapStatusReport {
  const status = (raw.status ?? '').toLowerCase()
  const outputType = upper(raw.substatus)

  // Rango signals a refund through its OUTPUT TYPE, not its status: a reverted
  // route still reports `success`, because the refund itself succeeded. Read
  // literally that is "swap complete", which is exactly backwards.
  const substatus =
    outputType === 'REVERTED_TO_INPUT' ? 'REFUNDED'
    : outputType === 'MIDDLE_ASSET' ? 'PARTIAL'
    : raw.substatus ?? null

  const normalized: RawProviderStatus = {
    ...raw,
    status: status === 'success' ? 'DONE' : status === 'failed' ? 'FAILED' : 'PENDING',
    substatus,
  }
  // Report RANGO's own words, not the normalized ones: mapping a report again
  // (reconciliation does) must give the same answer, and 'DONE' re-read by this
  // mapper would become PENDING — a finished swap polled forever.
  return {
    ...mapProviderStatus(normalized, expectedTokenAddress),
    providerStatus: raw.status ?? null,
    providerSubstatus: raw.substatus ?? null,
  }
}
