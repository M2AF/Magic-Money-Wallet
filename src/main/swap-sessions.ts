/**
 * swap-sessions.ts — the privileged layer's registry of swaps in flight and of
 * what Magic Money was paid for them.
 *
 * WHY A PORT INSTEAD OF DIRECT STORAGE
 *
 * The same executor runs on Electron (file-backed store), the extension and
 * Android (chrome.storage / Capacitor Preferences). Rather than three copies of
 * the lifecycle, this module owns the logic and takes a two-function
 * persistence port that each platform installs at startup. A platform that has
 * not installed one retains legacy in-memory tracking. Bound Cardano orders
 * require acknowledged persistence before submission so they stay recoverable.
 *
 * WHAT IS PERSISTED, AND WHAT IS DELIBERATELY NOT
 *
 * Hashes, ids, amounts, states, timestamps and fee terms. NOT calldata, NOT
 * serialized transactions, NOT intent ids that could be replayed into a signer.
 * A session answers "what happened to this?"; it can never authorize a spend.
 * That is the same split `swap-intent.ts` makes from the other direction: intents
 * are signable and therefore never persisted, sessions are evidence and
 * therefore always are.
 */

import {
  openSwapSession, recordPreSwapTx, recordSwapBroadcast, recordUncertainBroadcast,
  recordSourceReceipt, applyStatusReport, applyPaidAppFees, sessionsNeedingReconcile, summarizeFeeRevenue,
  recordSwapNotSent, sessionsLeftUnsent, recordMeasuredDelivery, sessionsNeedingMeasurement,
  pruneSettled,
  type SettledSwapSession, type SettledSwapSessionMap, type OpenSessionInput, type FeeRevenueSummary,
} from '../shared/swap-settlement'
import { sanitizeSwapSessions } from '../shared/swap-session'
import { mapStatusForProvider, sameAsset } from '../shared/swap-lifecycle'
import { setSettlementTrackingActive } from './swap-policy'
import type { SwapSigningIdentity } from './swap-intent'
import type { NormalizedSwapQuote, CrossSwapStatus } from './swap-proxy'
import type { MinswapOrderScanCursor } from './cardano-swap'
import { CardanoInputReservationError, inputRef, pendingCardanoSource } from './cardano-swap-inputs'

export interface SwapSessionPersistence {
  load: () => Promise<unknown>
  save: (map: SettledSwapSessionMap) => void | Promise<void>
}

let persistence: SwapSessionPersistence | null = null
let sessions: SettledSwapSessionMap = {}
let loaded = false
let loading: Promise<void> | null = null
let writes: Promise<void> = Promise.resolve()
const cardanoClaims = new Map<symbol, { environment: string; inputs: readonly string[] }>()
type SessionWithInputs = SettledSwapSession & { cardanoReservedInputs?: string[] }

/** Hold overlapping inputs before any async validation or signing begins. */
export async function reserveCardanoSwapInputs(
  intentId: string, identity: SwapSigningIdentity, inputs: readonly string[],
): Promise<() => void> {
  if (!inputs.length || !inputs.every(inputRef) || new Set(inputs).size !== inputs.length) {
    throw new CardanoInputReservationError('The swap inputs could not be reserved.')
  }
  await ensureLoaded()
  const conflict = () => new CardanoInputReservationError(
    'Another Cardano swap is using these inputs or its submission is still unresolved. Check that swap and request a fresh quote. Nothing was sent.')
  for (const claim of cardanoClaims.values()) {
    if (claim.environment === identity.environment && claim.inputs.some(ref => inputs.includes(ref))) throw conflict()
  }
  for (const s of Object.values(sessions) as SessionWithInputs[]) {
    if (s.id === intentId || s.environment !== identity.environment || !pendingCardanoSource(s)) continue
    const reserved = s.cardanoReservedInputs
    if (Array.isArray(reserved) && reserved.length && reserved.every(inputRef)) {
      if (reserved.some(ref => inputs.includes(ref))) throw conflict()
    } else if (s.walletId === identity.walletId && s.accountIndex === identity.accountIndex) {
      // Older records have no inputs. Absence is not permission to spend again.
      throw conflict()
    }
  }
  const key = Symbol(intentId)
  cardanoClaims.set(key, { environment: identity.environment, inputs: [...inputs] })
  return () => { cardanoClaims.delete(key) }
}

/**
 * Each platform installs its own store once, at startup.
 *
 * This is also what turns broad cross-chain execution on: a bridged swap of an
 * unverified token is only admissible if its outcome will still be reconciled
 * after a restart, and that is exactly what a persistence port provides. The
 * policy asks (`isSettlementTrackingActive`) rather than assuming, so a platform
 * that never installs one keeps the stricter behaviour instead of silently
 * losing the guarantee.
 */
export function setSwapSessionPersistence(port: SwapSessionPersistence): void {
  persistence = port
  loaded = false
  setSettlementTrackingActive(true)
}

/**
 * Read persisted sessions once per run.
 *
 * Stored JSON is untrusted input: it survives upgrades and can be edited on
 * disk. `sanitizeSwapSessions` drops anything that is not a session — in
 * particular anything carrying signable-looking fields, which would mean the
 * record was not written by this code.
 */
async function ensureLoaded(): Promise<void> {
  if (loaded) return
  if (!persistence) { loaded = true; return }
  if (loading) return loading
  const port = persistence
  loading = (async () => {
    const raw = await port.load()
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('The stored swap sessions are unreadable; they were left untouched.')
    }
    const clean = sanitizeSwapSessions(raw) as unknown as SettledSwapSessionMap
    sessions = keepPendingCardanoSources(clean, pruneSettled(clean))
    loaded = true
  })()
  try { await loading } finally { loading = null }
}

/** Unresolved source hashes/reservations must outlive history TTL and size caps. */
function keepPendingCardanoSources(previous: SettledSwapSessionMap, next: SettledSwapSessionMap): SettledSwapSessionMap {
  const protectedRecords = Object.fromEntries(Object.entries(previous).filter(([, s]) => pendingCardanoSource(s)))
  return { ...protectedRecords, ...next }
}

/** Snapshot and serialize writes: a slow older write must not replace newer evidence. */
function persistSnapshot(): Promise<void> {
  const port = persistence
  if (!port) return Promise.reject(new Error('Swap recovery storage is unavailable.'))
  const snapshot = JSON.parse(JSON.stringify(sessions)) as SettledSwapSessionMap
  const result = writes.then(() => port.save(snapshot))
  writes = result.catch(() => { /* one failure must not poison later writes */ })
  return result
}

function flush(): Promise<void> {
  if (!persistence) return Promise.resolve()
  return persistSnapshot().catch(() => { /* post-broadcast updates are best effort */ })
}

/**
 * Open the session for an authorized swap, keyed by its intent id.
 *
 * Called at the point of the FIRST network action, not at quote time: a quote
 * the user never executes is not a swap and must not appear as one. Idempotent,
 * so the executor can call it again for an approval, a retry, or a resumed
 * cross-chain poll without ever producing a second fee-bearing record.
 */
export async function openSession(
  intentId: string,
  quote: NormalizedSwapQuote,
  identity: SwapSigningIdentity,
  decimals: { from: number; to: number },
): Promise<void> {
  await ensureLoaded()
  openSessionRecord(intentId, quote, identity, decimals)
  await flush()
}

function openSessionRecord(
  intentId: string, quote: NormalizedSwapQuote, identity: SwapSigningIdentity,
  decimals: { from: number; to: number },
): void {
  const input: OpenSessionInput = {
    id: intentId,
    walletId: identity.walletId,
    accountIndex: identity.accountIndex,
    environment: identity.environment,
    provider: quote.provider,
    fromChain: quote.fromChain,
    toChain: quote.toChain,
    fromTokenAddress: quote.fromTokenAddress,
    fromTokenSymbol: quote.fromTokenSymbol,
    fromTokenDecimals: decimals.from,
    toTokenAddress: quote.toTokenAddress,
    toTokenSymbol: quote.toTokenSymbol,
    toTokenDecimals: decimals.to,
    sellAmountRaw: quote.sellAmountRaw,
    expectedBuyAmountRaw: quote.buyAmountRaw,
    minBuyAmountRaw: quote.minBuyAmountRaw ?? null,
    recipient: quote.toAddress ?? identity.destinationAddress,
    isCrossChain: quote.fromChain !== quote.toChain,
    // A Cardano batcher order is placed by the source transaction and traded
    // later, so its session must stay open until the order is filled or cancelled.
    settlesAfterSource: !!quote.cardanoOrder,
    bridgeTool: quote.bridgeTool ?? null,
    providerRequestId: quote.requestId ?? null,
    appFee: quote.appFee ?? null,
  }
  sessions = keepPendingCardanoSources(sessions, openSwapSession(sessions, input))
}

/**
 * Durable gate for a Cardano order whose hash is known before submission.
 * A crash after this save cannot distinguish "about to submit" from "submitted",
 * so recovery conservatively polls the hash and never resends automatically.
 * No transaction bytes or signing authority are stored.
 */
export async function prepareCardanoSwapBroadcast(
  intentId: string, quote: NormalizedSwapQuote, identity: SwapSigningIdentity,
  decimals: { from: number; to: number }, txHash: string, explorerUrl: string, inputs?: readonly string[],
): Promise<void> {
  if (!persistence) throw new Error('Swap recovery storage is unavailable.')
  await ensureLoaded()
  openSessionRecord(intentId, quote, identity, decimals)
  const s = sessions[intentId]
  sessions = {
    ...sessions,
    [intentId]: {
      ...s, sourceTxHash: txHash, sourceExplorerUrl: explorerUrl,
      sourceTxState: 'uncertain', state: 'unknown', updatedAt: Date.now(),
      ...(inputs ? { cardanoReservedInputs: [...inputs] } : {}),
      message: 'Order submission was prepared. Check the transaction on-chain; do not resend automatically.',
    },
  }
  await persistSnapshot()
}

/** An approval/permit/reset went out. Never a fee event. */
export async function noteApprovalTx(intentId: string, txHash: string): Promise<void> {
  await ensureLoaded()
  sessions = recordPreSwapTx(sessions, intentId, txHash)
  await flush()
}

/** The swap transaction reached the network. */
export async function noteSwapBroadcast(
  intentId: string, txHash: string, explorerUrl: string | null, nonce: number | null,
): Promise<void> {
  await ensureLoaded()
  sessions = recordSwapBroadcast(sessions, intentId, { txHash, explorerUrl, nonce })
  await flush()
}

/** We broadcast and never learned the outcome. */
export async function noteUncertainBroadcast(intentId: string, nonce: number | null): Promise<void> {
  await ensureLoaded()
  sessions = recordUncertainBroadcast(sessions, intentId, nonce)
  await flush()
}

/**
 * The swap was stopped before its transaction was sent — typically after an
 * approval had already gone out (simulation refused it, the quote expired).
 */
export async function noteSwapNotSent(intentId: string, reason: string): Promise<void> {
  await ensureLoaded()
  sessions = recordSwapNotSent(sessions, intentId, reason)
  await flush()
}

/**
 * A session with no swap transaction this long after it opened can no longer
 * get one: the signable intent lasts 5 minutes (swap-intent.ts) and a quote at
 * most 10 (swap-executor.ts). Well past both, "not sent" is a fact, not a guess.
 */
const UNSENT_FINAL_AFTER_MS = 15 * 60_000

/** The source transaction was included — successfully or not. */
export async function noteSourceReceipt(
  intentId: string, txHash: string, success: boolean,
): Promise<void> {
  await ensureLoaded()
  sessions = recordSourceReceipt(sessions, intentId, { txHash, success })
  await flush()
}

/** Sessions belonging to the wallet/account/environment asking for them. */
export async function listSessions(identity: SwapSigningIdentity): Promise<SettledSwapSession[]> {
  await ensureLoaded()
  return Object.values(sessions)
    .filter(s => s.walletId === identity.walletId
      && s.accountIndex === identity.accountIndex
      && s.environment === identity.environment)
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function feeSummary(): Promise<FeeRevenueSummary> {
  await ensureLoaded()
  return summarizeFeeRevenue(sessions)
}

/**
 * Bring every unresolved cross-chain session up to date.
 *
 * This is RECONCILIATION, not resumption of authority: it asks the provider what
 * happened and records the answer. It never signs, never re-quotes and never
 * re-authorizes. A swap that needs a new transaction has to go back through the
 * normal quote-and-approve path, because the user's approval was for terms that
 * no longer exist.
 *
 * `fetchStatus` is injected so this is testable without a network and so the
 * extension and Electron can pass their own configured caller.
 */
/**
 * Is `recipient` this wallet's OWN address on `chain`? The wallet id is
 * `<evm>|<solana>` of the account's public addresses (swap-intent.ts), so this
 * checks the delivery went to us before any saved amount is changed.
 */
function isOwnRecipient(session: SettledSwapSession): boolean {
  const [evm, sol] = session.walletId.split('|')
  const r = session.recipient ?? ''
  return session.toChain === 'solana' ? !!sol && r === sol : !!evm && r.toLowerCase() === evm.toLowerCase()
}

/**
 * A session as the Minswap order reader extends it. Kept off the shared
 * SwapSession type on purpose: that type is part of the swap core ChainLens
 * runs, and this cursor means nothing there. The shared reducers spread the
 * record, so the field survives every update; `sanitizeSwapSessions` keeps it.
 */
type SessionWithOrderScan = SettledSwapSession & { cardanoOrderScan?: MinswapOrderScanCursor | null }

/** The persisted Minswap spender-scan cursor for a session, if a fallback scan ever ran. */
export function orderScanCursorOf(session: SettledSwapSession): MinswapOrderScanCursor | null {
  const c = (session as SessionWithOrderScan).cardanoOrderScan
  return c && typeof c.orderRef === 'string' && Number.isInteger(c.blockHeight) && Number.isInteger(c.txIndex) ? c : null
}

export async function reconcileSessions(
  identity: SwapSigningIdentity,
  fetchStatus: (s: SettledSwapSession) => Promise<CrossSwapStatus>,
  /**
   * Measure a completed delivery on its destination chain (swap-delivery.ts).
   * Used once per finished record saved before measurement existed — e.g. the
   * two MON -> SOL swaps that saved LI.FI's quote-derived figure.
   */
  measure?: (s: SettledSwapSession) => Promise<{ amountRaw: string } | null>,
): Promise<SettledSwapSession[]> {
  await ensureLoaded()
  // Sessions that never got a swap transaction are invisible to the status poll
  // below (it keys on the source hash), so they would sit at 'source-submitted'
  // forever. Record them as not sent once they can no longer be.
  for (const s of sessionsLeftUnsent(sessions, Date.now(), UNSENT_FINAL_AFTER_MS)) {
    if (s.walletId !== identity.walletId || s.accountIndex !== identity.accountIndex
        || s.environment !== identity.environment) continue
    sessions = recordSwapNotSent(sessions, s.id,
      'no swap transaction was recorded for this swap, and its authorization has expired, so it can no longer be sent.')
  }
  const mine = sessionsNeedingReconcile(sessions).filter(s =>
    s.walletId === identity.walletId
    && s.accountIndex === identity.accountIndex
    && s.environment === identity.environment)

  for (const session of mine) {
    let status: CrossSwapStatus
    try {
      status = await fetchStatus(session)
    } catch {
      continue   // a failed poll is not evidence of anything; leave the session alone
    }
    // The Worker hands back the provider's vocabulary; meaning is decided here,
    // by the same mapper the live card uses, so a resumed session and a live one
    // can never disagree about what DONE/PARTIAL means.
    const raw = {
      provider: session.provider,
      status: status.providerStatus ?? null,
      substatus: status.providerSubstatus ?? null,
      // The MEASURED destination credit when the status carries one (see
      // swap-delivery.ts) — not the provider's figure, which for LI.FI is
      // derived from the quote. The approved-minimum check below runs on it.
      receivedAmountRaw: (status.deliveredAmountSource === 'onchain' ? status.delivered?.amountRaw : null)
        ?? status.receivedAmountRaw ?? null,
      receivedTokenAddress: status.delivered?.address ?? null,
      receivedTokenSymbol: status.delivered?.symbol ?? null,
      receivedTokenDecimals: status.delivered?.decimals ?? null,
      receivedTokenChain: status.delivered?.chain ?? null,
      destTxHash: status.destTxHash ?? null,
      destExplorerUrl: status.destExplorerUrl ?? null,
    }
    const report = mapStatusForProvider(session.provider, {
      ...raw,
      failReason: status.failReason ?? null,
    }, session.toTokenAddress)
    // An unknown state from the reader may carry a precise reason (a Minswap
    // order spent without a recognisable fill or refund); keep it over the
    // mapper's generic wording.
    sessions = applyStatusReport(sessions, session.id,
      report.state === 'unknown' && status.message ? { ...report, message: status.message } : report)
    // Where a Minswap spender scan got to, so a restart resumes instead of rescanning.
    if (status.orderScanCursor && sessions[session.id]) {
      sessions = {
        ...sessions,
        [session.id]: { ...sessions[session.id], cardanoOrderScan: status.orderScanCursor } as SessionWithOrderScan,
      }
    }
    if (status.deliveredAmountSource === 'onchain' && status.delivered?.amountRaw) {
      sessions = recordMeasuredDelivery(sessions, session.id, status.delivered.amountRaw, status.providerReportedAmountRaw)
    }
    // Recipient-level payout evidence, where the provider publishes it (Relay).
    if (status.paidAppFees) {
      sessions = applyPaidAppFees(sessions, session.id, status.paidAppFees, `${session.provider}: settlement record`)
    }
  }

  // Finished deliveries saved before on-chain measurement: measure once, after
  // confirming the delivery went to this wallet. Idempotent — a measured record
  // is never selected again. Refunds and wrong-asset deliveries are excluded by
  // `sessionsNeedingMeasurement`.
  if (measure) {
    const unmeasured = sessionsNeedingMeasurement(sessions, (d, e, chain) => sameAsset(d, e, chain))
      .filter(s => s.walletId === identity.walletId && s.accountIndex === identity.accountIndex
        && s.environment === identity.environment && isOwnRecipient(s))
    for (const s of unmeasured) {
      let measured: { amountRaw: string } | null = null
      try { measured = await measure(s) } catch { continue }
      if (measured) sessions = recordMeasuredDelivery(sessions, s.id, measured.amountRaw)
    }
  }
  await flush()
  return listSessions(identity)
}

/** Test seam — drops in-memory state without touching any store. */
export function __resetSwapSessions(): void {
  cardanoClaims.clear()
  sessions = {}
  loaded = false
  loading = null
  writes = Promise.resolve()
  persistence = null
  setSettlementTrackingActive(false)
}
