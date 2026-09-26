/**
 * swap-settlement.ts — what happened to a swap, and whether Magic Money was
 * actually paid for it.
 *
 * TWO QUESTIONS THAT ARE NOT THE SAME QUESTION
 *
 * "Did the user's swap complete?" and "did the app fee reach us?" have different
 * answers more often than is comfortable, and conflating them is how a revenue
 * number becomes fiction:
 *
 *   • a source-chain swap can confirm while the bridge later REFUNDS — and a fee
 *     collected on the source side is still ours, because it was taken in the
 *     transaction that settled
 *   • a cross-chain route can deliver PARTIALLY, so the user did not get what
 *     they asked for while the fee was charged exactly as quoted
 *   • a route can be approved and never executed, which is worth nothing
 *   • a provider whose fee ACCRUES (rather than transferring in the swap) owes us
 *     a claimable balance, not a payment
 *
 * So a session carries the swap lifecycle and a SEPARATE fee outcome, and
 * neither is inferred from the other.
 *
 * IDEMPOTENCE
 *
 * Every mutation takes an event id derived from the thing that happened (a
 * transaction hash, a provider status tuple), never from the moment it was
 * observed. A retried poll, a resumed session after a restart and a duplicate
 * notification all produce the same id, so none of them can count a fee twice.
 *
 * CHARGE-ONCE
 *
 * The app fee lives INSIDE the swap transaction — there is no separate transfer,
 * by design. One session is opened per user swap and it is keyed by the intent
 * that authorized it, so an approval, a permit, a zero-reset, a retry of an
 * uncertain broadcast and a resumed cross-chain poll all attach to the SAME
 * session rather than opening another. A fee is counted at most once per session
 * because the session is the swap.
 *
 * Platform-neutral — no Electron, Chrome, Capacitor, node: or fetch.
 */

import type { SwapLifecycleState, SwapStatusReport } from './swap-lifecycle'
import { isTerminalSwapState } from './swap-lifecycle'
import type { SwapSession, SwapSessionMap, SourceTxState } from './swap-session'
import { pruneSwapSessions } from './swap-session'
import type { AppFeeRecord } from './swap-fee-policy'

/**
 * Where the app fee stands for one swap.
 *
 * `expected` is what the user was shown and approved. Everything else is
 * observation, and stays null until something is actually observed.
 */
export type FeeSettlementState =
  /**
   * The route was deliberately quoted with NO app fee (tier 2). Terminal, and a
   * distinct outcome from "we tried and failed" -- it is a fact about the route,
   * not a failure to collect, and the accounting must never imply otherwise.
   */
  | 'no-fee'
  /** Authorized but nothing reached the network. Not revenue. */
  | 'not-executed'
  /** The fee-bearing transaction was broadcast; inclusion unconfirmed. */
  | 'submitted'
  /** The fee-bearing transaction confirmed on the source chain. */
  | 'collected-onchain'
  /** The provider owes us a claimable balance rather than a transfer. */
  | 'accrued-claimable'
  /** The fee-bearing transaction reverted, so no fee was taken. */
  | 'not-collected'
  /** We cannot tell. Never treated as either of the two above. */
  | 'unknown'

/**
 * One entry of a provider's post-settlement record of who was paid.
 *
 * Only Relay provides this (`data.paidAppFees[]` in its request history). It is
 * the first evidence in the whole fee pipeline that names the RECIPIENT of a
 * fee that was actually paid, rather than the fee a quote said it would apply.
 */
export interface PaidAppFee {
  recipient: string
  bps: string | number | null
  amount: string | null
}

/**
 * Whether the fee reached Magic Money, which is a different question from
 * whether the fee was CHARGED.
 *
 *   confirmed   the provider's settlement record names our beneficiary
 *   mismatch    the provider paid app fees, and none to our beneficiary
 *   unavailable the provider does not publish who was paid (every provider but Relay)
 *
 * `collected-onchain` on the fee state says the fee-bearing transaction
 * confirmed. It never claimed the money arrived with us, and until this record
 * existed nothing could.
 */
export interface FeePayoutEvidence {
  status: 'confirmed' | 'mismatch' | 'unavailable'
  /** Where the evidence came from. */
  source: string
  /** Our beneficiary's entry, when one was found. */
  amountRaw: string | null
  bps: number | null
  checkedAt: number
}

export interface FeeSettlement {
  policyVersion: string
  provider: string
  /** The terms the user approved, copied at open time and never rewritten. */
  expected: {
    bps: number
    base: 'input' | 'output'
    tokenAddress: string | null
    tokenSymbol: string | null
    tokenDecimals: number | null
    amountRaw: string | null
    recipient: string | null
    collection: 'in-swap' | 'accrued-claimable'
  }
  state: FeeSettlementState
  /** The transaction the fee rides in — always the swap itself, never a separate send. */
  feeTxHash: string | null
  /**
   * Chain the fee settles on. For every provider wired here that is the SOURCE
   * chain, which is why a destination-side refund does not undo it.
   */
  chain: string
  /** Share the provider keeps, when their terms state one. null = unknown, not zero. */
  providerSharePct: number | null
  /** Plain-language note about anything unusual (refund after collection, etc.). */
  note: string | null
  /** Event ids already applied, so a replayed event changes nothing. */
  appliedEvents: string[]
  updatedAt: number
  /** Payout evidence, when a provider publishes it. Absent means "not checked". */
  payout?: FeePayoutEvidence | null
}

/** A session plus its fee outcome. The persisted unit. */
export interface SettledSwapSession extends SwapSession {
  fee: FeeSettlement | null
}

export type SettledSwapSessionMap = Record<string, SettledSwapSession>

/** Everything needed to open a session, taken from the intent that authorized it. */
export interface OpenSessionInput {
  /** The intent id — this is what makes one session per USER SWAP. */
  id: string
  walletId: string
  accountIndex: number
  environment: 'mainnet' | 'testnet'
  provider: string
  fromChain: string
  toChain: string
  fromTokenAddress: string
  fromTokenSymbol: string
  fromTokenDecimals: number
  toTokenAddress: string
  toTokenSymbol: string
  toTokenDecimals: number
  sellAmountRaw: string
  expectedBuyAmountRaw: string
  minBuyAmountRaw: string | null
  recipient: string
  isCrossChain: boolean
  /** See SwapSession.settlesAfterSource. */
  settlesAfterSource?: boolean
  bridgeTool: string | null
  providerRequestId: string | null
  appFee: AppFeeRecord | null
  now?: number
}

function feeFromRecord(record: AppFeeRecord | null, chain: string, now: number): FeeSettlement | null {
  if (!record) return null
  return {
    policyVersion: record.policyVersion,
    provider: record.provider,
    expected: {
      bps: record.appliedBps ?? record.requestedBps,
      base: record.base,
      tokenAddress: record.tokenAddress,
      tokenSymbol: record.tokenSymbol,
      tokenDecimals: record.tokenDecimals,
      amountRaw: record.amountRaw,
      recipient: record.recipient,
      collection: record.collection,
    },
    // A fee-free route starts and stays at `no-fee`: there is nothing to submit,
    // nothing to confirm, and nothing that could later become revenue.
    state: record.requestedBps === 0 ? 'no-fee' : 'not-executed',
    feeTxHash: null,
    chain,
    providerSharePct: record.providerSharePct,
    note: null,
    appliedEvents: [],
    updatedAt: now,
  }
}

/**
 * Open (or return) the session for one authorized swap.
 *
 * Opening is idempotent on the intent id. That is the whole charge-once
 * mechanism: the executor may call this again after an approval, after a
 * zero-reset, or when reconciling an uncertain broadcast, and it will attach to
 * the session that already exists rather than creating a second one with a
 * second fee.
 */
export function openSwapSession(
  map: SettledSwapSessionMap, input: OpenSessionInput,
): SettledSwapSessionMap {
  const now = input.now ?? Date.now()
  if (map[input.id]) return map

  const session: SettledSwapSession = {
    id: input.id,
    createdAt: now,
    updatedAt: now,
    walletId: input.walletId,
    accountIndex: input.accountIndex,
    environment: input.environment,
    provider: input.provider,
    fromChain: input.fromChain,
    toChain: input.toChain,
    fromTokenAddress: input.fromTokenAddress,
    fromTokenSymbol: input.fromTokenSymbol,
    fromTokenDecimals: input.fromTokenDecimals,
    toTokenAddress: input.toTokenAddress,
    toTokenSymbol: input.toTokenSymbol,
    toTokenDecimals: input.toTokenDecimals,
    sellAmountRaw: input.sellAmountRaw,
    expectedBuyAmountRaw: input.expectedBuyAmountRaw,
    minBuyAmountRaw: input.minBuyAmountRaw,
    recipient: input.recipient,
    isCrossChain: input.isCrossChain,
    settlesAfterSource: input.settlesAfterSource === true,
    bridgeTool: input.bridgeTool,
    providerRequestId: input.providerRequestId,
    approvalTxHash: null,
    sourceTxHash: null,
    sourceExplorerUrl: null,
    sourceTxState: 'submitted',
    sourceNonce: null,
    state: 'source-submitted',
    message: null,
    providerStatus: null,
    providerSubstatus: null,
    deliveredTokenAddress: null,
    deliveredTokenSymbol: null,
    deliveredTokenDecimals: null,
    deliveredAmountRaw: null,
    destTxHash: null,
    destExplorerUrl: null,
    lastPolledAt: null,
    fee: feeFromRecord(input.appFee, input.fromChain, now),
  }
  return pruneSettled({ ...map, [input.id]: session }, now)
}

/** Prune with the session rules, preserving the fee outcome alongside each session. */
export function pruneSettled(map: SettledSwapSessionMap, now = Date.now()): SettledSwapSessionMap {
  const kept = pruneSwapSessions(map as unknown as SwapSessionMap, now)
  const out: SettledSwapSessionMap = {}
  for (const id of Object.keys(kept)) out[id] = map[id]
  return out
}

function withEvent<T extends { appliedEvents: string[] }>(holder: T, event: string): boolean {
  if (holder.appliedEvents.includes(event)) return false
  holder.appliedEvents.push(event)
  return true
}

/**
 * Record an approval/permit/reset that went out before the swap.
 *
 * These are NOT fee events. An approval costs gas and changes allowance; it
 * carries no app fee and must never move the fee state, which is exactly the
 * "charge once per swap, not per approval" rule made concrete.
 */
export function recordPreSwapTx(
  map: SettledSwapSessionMap, id: string, txHash: string, now = Date.now(),
): SettledSwapSessionMap {
  const s = map[id]
  if (!s) return map
  return { ...map, [id]: { ...s, approvalTxHash: txHash, updatedAt: now } }
}

/**
 * Record the swap transaction reaching the network.
 *
 * Broadcast is NOT confirmation, for the swap or for the fee: `submitted` says a
 * signature exists, nothing more. A hash observed twice (a retry that turned out
 * to be the same transaction) applies once.
 */
export function recordSwapBroadcast(
  map: SettledSwapSessionMap,
  id: string,
  args: { txHash: string; explorerUrl?: string | null; nonce?: number | null; now?: number },
): SettledSwapSessionMap {
  const s = map[id]
  if (!s) return map
  const now = args.now ?? Date.now()
  const fee = s.fee ? { ...s.fee, appliedEvents: [...s.fee.appliedEvents] } : null
  if (fee && fee.state !== 'no-fee') {
    if (withEvent(fee, `broadcast:${args.txHash}`)) {
      fee.state = 'submitted'
      fee.feeTxHash = args.txHash
      fee.updatedAt = now
    }
  }
  return {
    ...map,
    [id]: {
      ...s,
      sourceTxHash: args.txHash,
      sourceExplorerUrl: args.explorerUrl ?? s.sourceExplorerUrl,
      sourceNonce: args.nonce ?? s.sourceNonce,
      sourceTxState: 'submitted',
      state: 'source-submitted',
      updatedAt: now,
      fee,
    },
  }
}

/** A broadcast whose outcome we never learned. Not failure, not success. */
/**
 * The swap transaction was never sent — record that, precisely.
 *
 * Only for a session with NO swap transaction on record: a session that has a
 * swap hash, an uncertain broadcast, or a receipt is never touched, because
 * "not sent" would then be a claim we cannot make. The approval hash, if any,
 * is kept: the approval DID go out, and it still stands on-chain.
 *
 * The fee is left as it was ('not-executed' for a fee route): no swap
 * transaction, so no fee was taken.
 */
export function recordSwapNotSent(
  map: SettledSwapSessionMap, id: string, reason: string, now = Date.now(),
): SettledSwapSessionMap {
  const s = map[id]
  if (!s) return map
  if (s.sourceTxHash || s.sourceTxState !== 'submitted' || s.sourceNonce != null) return map
  if (isTerminalSwapState(s.state as SwapLifecycleState)) return map
  const approval = s.approvalTxHash
    ? ` An approval transaction (${s.approvalTxHash.slice(0, 10)}…) was confirmed before this and remains in place.`
    : ''
  return {
    ...map,
    [id]: {
      ...s,
      sourceTxState: 'not-sent',
      state: 'failed',
      message: `No swap was sent, so nothing was swapped.${approval} Reason: ${reason}`,
      updatedAt: now,
    },
  }
}

/**
 * Sessions whose swap can no longer be sent: no swap transaction on record,
 * opened longer ago than `afterMs`. The signable intent behind a session
 * expires well within that window, so no later broadcast can belong to it.
 */
export function sessionsLeftUnsent(
  map: SettledSwapSessionMap, now: number, afterMs: number,
): SettledSwapSession[] {
  return Object.values(map).filter(s =>
    !s.sourceTxHash
    && s.sourceTxState === 'submitted'
    && s.sourceNonce == null
    && !isTerminalSwapState(s.state as SwapLifecycleState)
    && now - s.createdAt > afterMs)
}

export function recordUncertainBroadcast(
  map: SettledSwapSessionMap, id: string, nonce: number | null, now = Date.now(),
): SettledSwapSessionMap {
  const s = map[id]
  if (!s) return map
  // A route that never had a fee cannot have an unknown one.
  const fee = s.fee
    ? (s.fee.state === 'no-fee' ? s.fee : { ...s.fee, state: 'unknown' as FeeSettlementState, updatedAt: now })
    : null
  return {
    ...map,
    [id]: { ...s, sourceTxState: 'uncertain', state: 'unknown', sourceNonce: nonce ?? s.sourceNonce, updatedAt: now, fee },
  }
}

/**
 * Apply a source-chain receipt.
 *
 * This is the moment an in-swap fee becomes real: the transaction carrying it
 * was included and succeeded. A revert means no fee was taken — the whole
 * transaction, fee transfer included, did not happen.
 */
export function recordSourceReceipt(
  map: SettledSwapSessionMap,
  id: string,
  args: { txHash: string; success: boolean; now?: number },
): SettledSwapSessionMap {
  const s = map[id]
  if (!s) return map
  const now = args.now ?? Date.now()
  const sourceTxState: SourceTxState = args.success ? 'confirmed' : 'reverted'
  const fee = s.fee ? { ...s.fee, appliedEvents: [...s.fee.appliedEvents] } : null
  if (fee && fee.state !== 'no-fee' && withEvent(fee, `receipt:${args.txHash}:${args.success ? 'ok' : 'revert'}`)) {
    if (!args.success) {
      fee.state = 'not-collected'
      fee.note = 'The swap transaction reverted, so no fee was taken.'
    } else if (fee.expected.collection === 'accrued-claimable') {
      fee.state = 'accrued-claimable'
      fee.note = 'The provider credits this fee to a claimable balance rather than transferring it.'
    } else {
      fee.state = 'collected-onchain'
    }
    fee.feeTxHash = args.txHash
    fee.updatedAt = now
  }
  return {
    ...map,
    [id]: {
      ...s,
      sourceTxHash: args.txHash,
      sourceTxState,
      // A confirmed source tx on a same-chain swap IS the completed swap; a
      // cross-chain one has only reached the bridge, and a batcher order has
      // only been PLACED — the batcher has not traded it yet.
      state: !args.success ? 'failed'
        : s.isCrossChain ? 'bridging'
        : s.settlesAfterSource ? 'source-confirmed'
        : 'completed',
      updatedAt: now,
      fee,
    },
  }
}

/**
 * Apply a bridge status report to a cross-chain session.
 *
 * The fee is deliberately NOT re-decided here for source-collected fees. A
 * destination-side refund returns the user's funds, but the source transaction
 * — the one that carried our fee — still happened. Saying otherwise would either
 * inflate revenue (counting a fee twice on a retry) or silently erase a fee that
 * was genuinely taken. What it does instead is annotate the outcome, so a refund
 * is visible next to the fee rather than hidden behind it.
 */
export function applyStatusReport(
  map: SettledSwapSessionMap,
  id: string,
  report: SwapStatusReport,
  now = Date.now(),
): SettledSwapSessionMap {
  const s = map[id]
  if (!s) return map

  // ---- Post-settlement shortfall DETECTION --------------------------------
  // This is MONITORING, not enforcement, and the distinction is not academic:
  // it runs after the money has already moved, so it can only change what the
  // user is TOLD, never what they received. It must never be counted towards an
  // execution-safety requirement.
  //
  // The three capabilities it is easy to conflate:
  //
  //   1. transaction-enforced  the payload reverts below the floor; the user
  //                            keeps their input (same-chain swaps)
  //   2. provider guarantee    the provider commits to a floor by its own
  //                            mechanism; the failure mode is theirs to define
  //   3. detection (this)      we compare what arrived against what was approved
  //                            and report a shortfall honestly
  //
  // Only (1) makes an amount guaranteed. See `minReceivedScope` on the quote.
  const effective = applyDestinationShortfall(s, report)

  const fee = s.fee ? { ...s.fee, appliedEvents: [...s.fee.appliedEvents] } : null
  const event = `status:${effective.state}:${effective.destTxHash ?? effective.providerSubstatus ?? 'none'}`
  if (fee && fee.state !== 'no-fee' && (effective.state === 'refunded' || effective.state === 'partial')) {
    if (withEvent(fee, event)) {
      fee.note = effective.state === 'refunded'
        ? 'The bridge refunded this swap on the source chain. The app fee was taken in the source ' +
          'transaction that settled, so it is not reversed by the refund.'
        : 'The bridge delivered a different asset than requested. The app fee was taken as quoted on the source chain.'
      fee.updatedAt = now
    }
  }

  return {
    ...map,
    [id]: {
      ...s,
      state: effective.state,
      message: effective.message,
      providerStatus: effective.providerStatus,
      providerSubstatus: effective.providerSubstatus,
      deliveredTokenAddress: effective.delivered?.address ?? s.deliveredTokenAddress,
      deliveredTokenSymbol: effective.delivered?.symbol ?? s.deliveredTokenSymbol,
      deliveredTokenDecimals: effective.delivered?.decimals ?? s.deliveredTokenDecimals,
      deliveredAmountRaw: effective.delivered?.amountRaw ?? s.deliveredAmountRaw,
      destTxHash: effective.destTxHash ?? s.destTxHash,
      destExplorerUrl: effective.destExplorerUrl ?? s.destExplorerUrl,
      lastPolledAt: now,
      updatedAt: now,
      fee,
    },
  }
}

/**
 * Re-classify a "completed" report that delivered LESS than the approved floor.
 *
 * DETECTION ONLY. By the time this runs the destination transfer has happened;
 * nothing here can recover the difference. Its entire value is that the user is
 * told "you received less than the minimum you approved" instead of being shown
 * a green tick. Do not cite it as a minimum-receipt guarantee.
 *
 * Only downgrades, never upgrades: a provider saying PARTIAL is believed, and a
 * provider saying COMPLETED is believed only when the arithmetic agrees with it.
 * Leaves the report untouched when the session has no floor, when nothing was
 * delivered yet, or when the delivered asset is not the one that was asked for
 * (that case is already partial for a different and better-stated reason).
 */
export function applyDestinationShortfall(
  session: SettledSwapSession, report: SwapStatusReport,
): SwapStatusReport {
  return applyShortfallToReport(session.minBuyAmountRaw, report)
}

/**
 * The same rule, given only the approved floor — so the live status screen and
 * the persisted record apply ONE check and cannot disagree about a shortfall.
 */
export function applyShortfallToReport(
  minBuyAmountRaw: string | null | undefined, report: SwapStatusReport,
): SwapStatusReport {
  if (report.state !== 'completed') return report
  const floor = minBuyAmountRaw
  const got = report.delivered?.amountRaw
  if (!floor || !got || !/^[0-9]+$/.test(floor) || !/^[0-9]+$/.test(got)) return report
  try {
    if (BigInt(got) >= BigInt(floor)) return report
  } catch {
    return report
  }
  return {
    ...report,
    state: 'partial',
    message:
      'The bridge delivered less than the minimum you approved for this swap. The amount that arrived is '
      + 'recorded below; nothing further will be sent.',
  }
}

/**
 * Record an amount MEASURED on the destination chain for a completed delivery.
 *
 * Keeps the provider's figure alongside (the first one seen; never overwritten
 * by a later measurement), labels the source, and re-runs the approved-minimum
 * rule on the measured amount — so a delivery that only looked sufficient on the
 * provider's number is reported as a shortfall. Idempotent: the same
 * measurement applied twice changes nothing. Only completed/partial sessions;
 * refunds and failures are never touched.
 */
export function recordMeasuredDelivery(
  map: SettledSwapSessionMap, id: string, measuredAmountRaw: string,
  providerReportedAmountRaw?: string | null, now = Date.now(),
): SettledSwapSessionMap {
  const s = map[id]
  if (!s || (s.state !== 'completed' && s.state !== 'partial')) return map
  if (!/^[0-9]+$/.test(measuredAmountRaw)) return map
  if (s.deliveredAmountSource === 'onchain' && s.deliveredAmountRaw === measuredAmountRaw) return map
  const provider = s.providerReportedAmountRaw
    ?? providerReportedAmountRaw
    ?? (s.deliveredAmountSource === 'onchain' ? null : s.deliveredAmountRaw)
  const checked = applyShortfallToReport(s.minBuyAmountRaw, {
    state: s.state as SwapLifecycleState, message: s.message,
    providerStatus: s.providerStatus, providerSubstatus: s.providerSubstatus,
    delivered: {
      chain: null, address: s.deliveredTokenAddress, symbol: s.deliveredTokenSymbol,
      decimals: s.deliveredTokenDecimals, amountRaw: measuredAmountRaw,
    },
    destTxHash: s.destTxHash, destExplorerUrl: s.destExplorerUrl,
  })
  return {
    ...map,
    [id]: {
      ...s,
      state: checked.state,
      message: checked.message,
      deliveredAmountRaw: measuredAmountRaw,
      deliveredAmountSource: 'onchain',
      providerReportedAmountRaw: provider ?? null,
      updatedAt: now,
    },
  }
}

/**
 * Completed deliveries whose saved amount has never been measured on-chain —
 * the ONLY sessions a re-measure may touch. Excludes refunds and failures (not
 * completed), and a delivery of an asset other than the one requested.
 */
export function sessionsNeedingMeasurement(
  map: SettledSwapSessionMap, sameAssetOn: (delivered: string, expected: string, chain: string) => boolean,
): SettledSwapSession[] {
  return Object.values(map).filter(s =>
    s.state === 'completed'
    && s.isCrossChain
    && !!s.destTxHash
    && s.deliveredAmountSource !== 'onchain'
    && !!s.deliveredTokenAddress
    && sameAssetOn(s.deliveredTokenAddress, s.toTokenAddress, s.toChain))
}

/**
 * Reconcile a provider's record of who was PAID against the beneficiary the
 * user's fee was supposed to go to.
 *
 * Idempotent: the same record applied twice changes nothing, so a replayed poll
 * or a restart cannot flip the result. A mismatch is recorded, not hidden — it
 * means the user paid a fee that did not reach Magic Money, which is exactly the
 * outcome the fee-integrity checks exist to prevent, surfacing after the fact.
 *
 * Note what this does NOT do: it never changes the swap's own outcome, and it
 * does not rewrite `fee.state`. Whether the fee-bearing transaction confirmed and
 * where the fee ended up are separate facts.
 */
export function applyPaidAppFees(
  map: SettledSwapSessionMap,
  id: string,
  paid: PaidAppFee[] | null | undefined,
  source: string,
  now = Date.now(),
): SettledSwapSessionMap {
  const s = map[id]
  if (!s || !s.fee || s.fee.state === 'no-fee' || !Array.isArray(paid)) return map
  const ours = (s.fee.expected.recipient ?? '').toLowerCase()
  if (!ours) return map

  const match = paid.find(p => (p?.recipient ?? '').toLowerCase() === ours) ?? null
  const status: FeePayoutEvidence['status'] = match ? 'confirmed' : 'mismatch'
  const event = `payout:${status}:${match ? String(match.amount) : paid.length}`

  const fee = { ...s.fee, appliedEvents: [...s.fee.appliedEvents] }
  if (!withEvent(fee, event)) return map

  fee.payout = {
    status,
    source,
    amountRaw: match?.amount != null ? String(match.amount) : null,
    bps: match?.bps != null && Number.isFinite(Number(match.bps)) ? Number(match.bps) : null,
    checkedAt: now,
  }
  if (status === 'mismatch') {
    fee.note = paid.length
      ? 'The provider paid app fees on this swap, but none to the Magic Money beneficiary.'
      : 'The provider recorded no app fee payout for this swap.'
  }
  fee.updatedAt = now
  return { ...map, [id]: { ...s, fee, updatedAt: now } }
}

/** Sessions still worth polling, for the reconcile loop. */
export function sessionsNeedingReconcile(map: SettledSwapSessionMap): SettledSwapSession[] {
  return Object.values(map).filter(s =>
    (s.isCrossChain || s.settlesAfterSource === true)
    && !!s.sourceTxHash
    && !isTerminalSwapState(s.state as SwapLifecycleState))
}

export interface FeeRevenueSummary {
  /** Fees taken in a confirmed source transaction. */
  collected: number
  /** Fees the provider owes us as a claimable balance. */
  claimable: number
  /** Broadcast but not yet confirmed. Not revenue. */
  pending: number
  /** Authorized and never executed, or reverted. Not revenue. */
  notCollected: number
  /**
   * Routes deliberately quoted with no app fee (tier 2). Kept apart from
   * `notCollected` and from `unknown`: the first implies a failed attempt and
   * the second implies missing information, and this is neither.
   */
  feeFree: number
  /** We do not know. Never folded into any of the above. */
  unknown: number
}

/**
 * Count sessions by fee outcome.
 *
 * Deliberately counts SESSIONS rather than summing amounts: the fees are
 * denominated in whatever token each route charged, on different chains, and
 * adding a BONK fee to a USDC fee to produce "revenue" would require prices we
 * do not have at reconcile time. A dollar figure belongs to whatever values
 * these later, from the real amounts recorded per session.
 */
export function summarizeFeeRevenue(map: SettledSwapSessionMap): FeeRevenueSummary {
  const out: FeeRevenueSummary = { collected: 0, claimable: 0, pending: 0, notCollected: 0, feeFree: 0, unknown: 0 }
  for (const s of Object.values(map)) {
    switch (s.fee?.state) {
      case 'collected-onchain': out.collected++; break
      case 'accrued-claimable': out.claimable++; break
      case 'submitted': out.pending++; break
      case 'no-fee': out.feeFree++; break
      case 'not-collected':
      case 'not-executed': out.notCollected++; break
      default: out.unknown++; break
    }
  }
  return out
}
