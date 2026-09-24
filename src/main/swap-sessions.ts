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
 * not installed one still works — sessions live in memory for that run and are
 * lost on restart, which degrades resumability without ever degrading safety.
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

export interface SwapSessionPersistence {
  load: () => Promise<unknown>
  save: (map: SettledSwapSessionMap) => void | Promise<void>
}

let persistence: SwapSessionPersistence | null = null
let sessions: SettledSwapSessionMap = {}
let loaded = false

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
  loaded = true
  if (!persistence) return
  try {
    const raw = await persistence.load()
    const clean = sanitizeSwapSessions(raw) as unknown as SettledSwapSessionMap
    sessions = pruneSettled(clean)
  } catch {
    sessions = {}
  }
}

function flush(): void {
  if (!persistence) return
  try {
    const result = persistence.save(sessions)
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch(() => { /* evidence store: a lost write is not fatal */ })
    }
  } catch { /* same */ }
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
    bridgeTool: quote.bridgeTool ?? null,
    providerRequestId: quote.requestId ?? null,
    appFee: quote.appFee ?? null,
  }
  sessions = openSwapSession(sessions, input)
  flush()
}

/** An approval/permit/reset went out. Never a fee event. */
export async function noteApprovalTx(intentId: string, txHash: string): Promise<void> {
  await ensureLoaded()
  sessions = recordPreSwapTx(sessions, intentId, txHash)
  flush()
}

/** The swap transaction reached the network. */
export async function noteSwapBroadcast(
  intentId: string, txHash: string, explorerUrl: string | null, nonce: number | null,
): Promise<void> {
  await ensureLoaded()
  sessions = recordSwapBroadcast(sessions, intentId, { txHash, explorerUrl, nonce })
  flush()
}

/** We broadcast and never learned the outcome. */
export async function noteUncertainBroadcast(intentId: string, nonce: number | null): Promise<void> {
  await ensureLoaded()
  sessions = recordUncertainBroadcast(sessions, intentId, nonce)
  flush()
}

/**
 * The swap was stopped before its transaction was sent — typically after an
 * approval had already gone out (simulation refused it, the quote expired).
 */
export async function noteSwapNotSent(intentId: string, reason: string): Promise<void> {
  await ensureLoaded()
  sessions = recordSwapNotSent(sessions, intentId, reason)
  flush()
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
  flush()
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
    sessions = applyStatusReport(sessions, session.id, report)
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
  flush()
  return listSessions(identity)
}

/** Test seam — drops in-memory state without touching any store. */
export function __resetSwapSessions(): void {
  sessions = {}
  loaded = false
  persistence = null
  setSettlementTrackingActive(false)
}
