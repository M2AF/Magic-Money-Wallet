/**
 * swap-session.ts — the durable record of a swap that is in flight.
 *
 * WHY THIS EXISTS
 *
 * Cross-chain tracking lived entirely inside `CrossChainStatusCard`: a
 * `setTimeout` loop in a React component. Navigating away, locking, restarting
 * the app, an MV3 service-worker suspension or backgrounding the phone all
 * ended the poll, and nothing remembered the swap had ever happened. The user's
 * only record of a bridge that might still be mid-flight was a screen they had
 * closed.
 *
 * WHAT A SESSION IS — AND IS NOT
 *
 * A session is EVIDENCE, not AUTHORITY. It holds transaction hashes, provider
 * request ids, chain/account identifiers, states and timestamps: everything
 * needed to ask "what happened to this?" and nothing that could be replayed to
 * spend again. Deliberately absent: calldata, serialized transactions, approval
 * payloads, intent ids — anything a caller could hand back to a signer.
 * Resuming reconciles what already happened; it never re-authorizes anything,
 * and any newly required transaction needs fresh approval through the normal
 * intent path.
 *
 * That split is also why sessions are PERSISTED while intents deliberately are
 * not (see swap-intent.ts): persisting a signable payload would create a
 * replayable on-disk record, whereas persisting a transaction hash creates a
 * receipt.
 *
 * Platform-neutral — no Electron, Chrome, Capacitor, node: or fetch.
 */

import type { SwapLifecycleState } from './swap-lifecycle'

/** Where a session's source transaction has got to, independent of the bridge. */
export type SourceTxState =
  /** Signed and broadcast; inclusion NOT confirmed. */
  | 'submitted'
  /** Mined successfully. */
  | 'confirmed'
  /** Mined and reverted. */
  | 'reverted'
  /** We broadcast but never got an answer. Not proof either way. */
  | 'uncertain'
  /**
   * The swap transaction was NEVER broadcast. Something before it may have
   * been (an approval — see `approvalTxHash`), but the swap itself was stopped
   * before sending, so nothing was swapped and no swap fee was taken.
   */
  | 'not-sent'

export interface SwapSession {
  id: string
  createdAt: number
  updatedAt: number

  // ── Who it belongs to (never shown to another wallet/account) ────────────
  walletId: string
  accountIndex: number
  environment: 'mainnet' | 'testnet'

  // ── The route, for display and for resuming a status poll ───────────────
  provider: string
  fromChain: string
  toChain: string
  fromTokenAddress: string
  fromTokenSymbol: string
  fromTokenDecimals: number
  /** What the user asked to RECEIVE — the reference a refund is measured against. */
  toTokenAddress: string
  toTokenSymbol: string
  toTokenDecimals: number
  sellAmountRaw: string
  expectedBuyAmountRaw: string
  minBuyAmountRaw: string | null
  recipient: string
  isCrossChain: boolean
  /**
   * True when a confirmed source transaction is NOT the completed swap: a
   * Cardano batcher order (Minswap) only locks the input, and the swap happens
   * later when a batcher fills the order — or never, until the owner cancels.
   * Optional so sessions saved before it existed read as false.
   */
  settlesAfterSource?: boolean
  bridgeTool: string | null
  /** Rango requestId and similar — required to poll some providers. */
  providerRequestId: string | null

  // ── Evidence ────────────────────────────────────────────────────────────
  approvalTxHash: string | null
  sourceTxHash: string | null
  sourceExplorerUrl: string | null
  sourceTxState: SourceTxState
  /** Pinned nonce, so an uncertain EVM broadcast can be reconciled after a restart. */
  sourceNonce: number | null

  state: SwapLifecycleState
  message: string | null
  providerStatus: string | null
  providerSubstatus: string | null

  /** What ACTUALLY arrived. On a refund this is the token that was sold. */
  deliveredTokenAddress: string | null
  deliveredTokenSymbol: string | null
  deliveredTokenDecimals: number | null
  deliveredAmountRaw: string | null
  /**
   * Where `deliveredAmountRaw` came from: 'onchain' = measured from the
   * destination transaction; 'provider' or absent = the provider's status
   * figure, which for LI.FI is its quote x (1 - slippage), not an observation.
   */
  deliveredAmountSource?: 'onchain' | 'provider' | null
  /** The provider's own figure, kept when an on-chain measurement replaced it. */
  providerReportedAmountRaw?: string | null
  destTxHash: string | null
  destExplorerUrl: string | null

  lastPolledAt: number | null
}

export type SwapSessionMap = Record<string, SwapSession>

/** Sessions older than this are dropped even if never resolved. */
export const SWAP_SESSION_TTL_MS = 7 * 24 * 60 * 60_000
/** Hard cap so the store cannot grow without bound. */
export const MAX_SWAP_SESSIONS = 50

/**
 * True while a session is worth polling.
 *
 * `unknown` IS worth polling: it is usually a bridge that has not indexed the
 * source transaction yet, which resolves on its own. A timeout is never
 * evidence of failure.
 */
export function isSwapSessionActive(session: SwapSession): boolean {
  return session.state === 'source-submitted'
    || session.state === 'source-confirmed'
    || session.state === 'bridging'
    || session.state === 'refund-pending'
    || session.state === 'unknown'
}

/** Sessions belonging to one wallet/account/environment, newest first. */
export function sessionsForIdentity(
  map: SwapSessionMap,
  identity: { walletId: string; accountIndex: number; environment: 'mainnet' | 'testnet' },
): SwapSession[] {
  return Object.values(map ?? {})
    .filter(s =>
      s.walletId === identity.walletId
      && s.accountIndex === identity.accountIndex
      && s.environment === identity.environment)
    .sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Drop expired and surplus sessions.
 *
 * ACTIVE sessions are kept ahead of resolved ones when trimming: a completed
 * swap is history, while an unresolved one is the only handle the user has on
 * money that may still be moving.
 */
export function pruneSwapSessions(map: SwapSessionMap, now = Date.now()): SwapSessionMap {
  const alive = Object.values(map ?? {}).filter(s => now - s.createdAt <= SWAP_SESSION_TTL_MS)
  if (alive.length <= MAX_SWAP_SESSIONS) {
    return Object.fromEntries(alive.map(s => [s.id, s]))
  }
  const ranked = [...alive].sort((a, b) => {
    const aActive = isSwapSessionActive(a) ? 1 : 0
    const bActive = isSwapSessionActive(b) ? 1 : 0
    if (aActive !== bActive) return bActive - aActive
    return b.createdAt - a.createdAt
  })
  return Object.fromEntries(ranked.slice(0, MAX_SWAP_SESSIONS).map(s => [s.id, s]))
}

/**
 * Reject anything in the persisted blob that is not a session.
 *
 * Stored JSON is not trusted input: it survives upgrades, can be edited on
 * disk, and a malformed entry must not crash the swap screen. Sessions carrying
 * fields that look like signing material are dropped outright rather than
 * sanitized — their presence means the record was not written by this code.
 */
export function sanitizeSwapSessions(value: unknown): SwapSessionMap {
  if (!value || typeof value !== 'object') return {}
  const out: SwapSessionMap = {}
  for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue
    const s = entry as Record<string, unknown>
    if (typeof s.id !== 'string' || s.id !== id) continue
    if (typeof s.walletId !== 'string' || typeof s.createdAt !== 'number') continue
    if (typeof s.fromChain !== 'string' || typeof s.toChain !== 'string') continue
    // A session must never carry anything signable.
    if ('txData' in s || 'approvalTx' in s || 'permitTx' in s || 'intentId' in s) continue
    out[id] = entry as unknown as SwapSession
  }
  return out
}
