/**
 * journey-candidate.ts — one multi-leg route candidate, from any route family
 * (USDCx via Circle xReserve, cbADA via Chainlink CCIP, ...), with its costs
 * itemized, and how candidates are compared. Platform-neutral and pure.
 *
 * COSTS. Every fee, gas charge and deposit is one item, attributed to the leg
 * that incurs it. An item whose amount could not be measured is UNKNOWN
 * (`amountRaw: null`), never zero. A fee the leg's quoted output already
 * deducts is marked `includedInOutput` so it is shown but not counted twice.
 * A refundable deposit is listed separately and never counted as a cost. A
 * provider's fee CEILING is not a cost: only quoted/measured charges appear.
 *
 * RANKING. Only candidates that are executable AND validated AND have every
 * cost known in USD compete, through the wallet's shared routing policy
 * (selectRoute: best net value; a verified-fee route may be preferred within
 * its tolerance; the actual best stays visible). If the competitors' costs
 * cannot be put on one scale, nothing is recommended — output alone never
 * decides. Everything else is a PREVIEW, listed separately, never "cheapest".
 */

import { selectRoute, type RouteMetrics, type RouteSelectionReason } from './swap-routing-policy'
import type { ExactAsset } from './stablecoin-route'

export type JourneyFamily = 'usdcx-xreserve' | 'cbada-ccip' | 'coinbase-conversion'

export interface JourneyCost {
  label: string
  /** Index of the leg that incurs it. */
  leg: number
  chain: string
  /** What it is paid in. */
  symbol: string
  decimals: number
  /** Base units; null when not stated. */
  amountRaw: string | null
  /** USD value when stated or priced; null otherwise. Unknown = both null. */
  usd: number | null
  kind: 'fee' | 'gas' | 'deposit'
  /** Already deducted from the leg's quoted output (shown, not counted again). */
  includedInOutput: boolean
}

export interface JourneyLegSummary {
  kind: 'swap' | 'bridge' | 'conversion'
  label: string
  status: 'quoted' | 'prepared' | 'skipped' | 'unavailable'
  from: ExactAsset
  to: ExactAsset
  /** `exact` held now; `floor` previous leg's minimum; `indicative` re-quoted later from measured proceeds. */
  inputBasis: 'exact' | 'floor' | 'indicative' | null
  inRaw: string | null
  expectedOutRaw: string | null
  minOutRaw: string | null
  via: string | null
  expiresAt: number | null
  reason: string | null
}

export interface JourneyCandidate {
  family: JourneyFamily
  label: string
  source: ExactAsset
  destination: ExactAsset
  legs: JourneyLegSummary[]
  costs: JourneyCost[]
  /** Every leg can be signed by this wallet today. */
  executable: boolean
  /** Every leg's transaction passes its own pre-signing validator. */
  validated: boolean
  /** Final output if every leg delivers its expectation / its floor. Indicative after any bridge. */
  finalExpectedRaw: string | null
  finalMinRaw: string | null
  /** USD value of the final expected output, as the last leg's provider priced it. */
  finalOutputUsd: number | null
  blockers: string[]
}

export interface CostSummary {
  /** Sum of counted costs in USD; null if any counted cost is unknown or unpriced. */
  countedUsd: number | null
  unknown: string[]
  deposits: JourneyCost[]
}

export function summarizeCosts(c: JourneyCandidate): CostSummary {
  let usd = 0
  let complete = true
  const unknown: string[] = []
  const deposits: JourneyCost[] = []
  for (const k of c.costs) {
    if (k.kind === 'deposit') { deposits.push(k); continue }
    if (k.amountRaw === null && k.usd === null) { unknown.push(k.label); complete = false; continue }
    if (k.includedInOutput) continue
    if (k.usd === null || !Number.isFinite(k.usd)) { unknown.push(`${k.label} (no USD price)`); complete = false; continue }
    usd += k.usd
  }
  return { countedUsd: complete ? usd : null, unknown, deposits }
}

export interface JourneyRanking {
  /** Chosen by the shared policy among complete, executable, validated candidates. */
  recommended: { candidate: JourneyCandidate; reason: RouteSelectionReason; best: JourneyCandidate; shortfallBps: number } | null
  /** Why nothing was recommended, when nothing was. */
  noRecommendation: string | null
  /** Executable and validated, in policy order (recommended first when there is one). */
  executable: JourneyCandidate[]
  /** Research/preview only: not executable or not validated. Never ranked as cheapest. */
  previews: JourneyCandidate[]
}

const UINT = /^(0|[1-9][0-9]{0,77})$/

export function rankJourneys(candidates: JourneyCandidate[]): JourneyRanking {
  const ready = candidates.filter(c => c.executable && c.validated && c.finalExpectedRaw && UINT.test(c.finalExpectedRaw))
  const previews = candidates.filter(c => !ready.includes(c))
    .sort((a, b) => cmpDesc(a.finalMinRaw, b.finalMinRaw))
  if (!ready.length) {
    return { recommended: null, noRecommendation: 'No route can be executed yet.', executable: [], previews }
  }
  // Competing requires every counted cost in USD and a USD output, so the
  // policy can put costs and output on one scale.
  const comparable = ready.filter(c => summarizeCosts(c).countedUsd !== null && c.finalOutputUsd !== null)
  if (comparable.length !== ready.length) {
    return {
      recommended: null,
      noRecommendation: 'Some executable routes have costs that could not be priced, so they cannot be compared fairly.',
      executable: [...ready].sort((a, b) => cmpDesc(a.finalExpectedRaw, b.finalExpectedRaw)),
      previews,
    }
  }
  const metrics: RouteMetrics[] = ready.map((c, i) => ({
    key: String(i),
    provider: c.family,
    netOutRaw: BigInt(c.finalExpectedRaw as string),
    minOutRaw: BigInt(c.finalMinRaw && UINT.test(c.finalMinRaw) ? c.finalMinRaw : (c.finalExpectedRaw as string)),
    sourceCostUsd: summarizeCosts(c).countedUsd,
    outputUsd: c.finalOutputUsd,
    feeVerified: false,
    // A multi-leg journey's floor holds only if every later leg does.
    risk: c.legs.some(l => l.kind === 'bridge') ? 2 : 0,
  }))
  const sel = selectRoute(metrics)
  if (!sel) return { recommended: null, noRecommendation: 'No route returned a usable output.', executable: ready, previews }
  const order = [sel.selectedKey, ...sel.ranked.map(r => r.key).filter(k => k !== sel.selectedKey)]
  return {
    recommended: { candidate: ready[Number(sel.selectedKey)], reason: sel.reason, best: ready[Number(sel.bestKey)], shortfallBps: sel.shortfallBps },
    noRecommendation: null,
    executable: order.map(k => ready[Number(k)]),
    previews,
  }
}

function cmpDesc(a: string | null, b: string | null): number {
  const va = a && UINT.test(a) ? BigInt(a) : -1n
  const vb = b && UINT.test(b) ? BigInt(b) : -1n
  return va === vb ? 0 : va > vb ? -1 : 1
}

/** Costs a swap quote states, attributed to `leg`. Unpriced gas stays unknown. */
export function costsFromSwapQuote(
  q: {
    externalFees?: Array<{ name: string; tokenSymbol: string | null; tokenDecimals: number | null; amountRaw: string | null; includedInQuotedOutput: boolean }>
    valuation?: { sourceCostUsd: number | null } | null
    estimatedGasRaw?: string
    cardanoCost?: { txFeeLovelace: string; depositLovelace: string } | null
  },
  leg: number, chain: string, nativeSymbol: string, nativeDecimals: number,
): JourneyCost[] {
  const out: JourneyCost[] = []
  for (const f of q.externalFees ?? []) {
    out.push({
      label: f.name, leg, chain, symbol: f.tokenSymbol ?? '?', decimals: f.tokenDecimals ?? 0,
      amountRaw: f.amountRaw && UINT.test(f.amountRaw) ? f.amountRaw : null, usd: null,
      kind: 'fee', includedInOutput: f.includedInQuotedOutput,
    })
  }
  if (q.cardanoCost) {
    out.push({ label: 'Cardano network fee', leg, chain, symbol: 'ADA', decimals: 6, amountRaw: q.cardanoCost.txFeeLovelace, usd: null, kind: 'gas', includedInOutput: false })
    if (q.cardanoCost.depositLovelace !== '0') {
      out.push({ label: 'Order deposit (returned)', leg, chain, symbol: 'ADA', decimals: 6, amountRaw: q.cardanoCost.depositLovelace, usd: null, kind: 'deposit', includedInOutput: false })
    }
  } else {
    const usd = q.valuation?.sourceCostUsd
    const gas = q.estimatedGasRaw && UINT.test(q.estimatedGasRaw) && q.estimatedGasRaw !== '0' ? q.estimatedGasRaw : null
    out.push({
      label: `${chain} network fee`, leg, chain, symbol: nativeSymbol, decimals: nativeDecimals,
      amountRaw: gas, usd: typeof usd === 'number' ? usd : null,
      kind: 'gas', includedInOutput: false,
    })
  }
  return out
}

// ── Wire shapes (renderer <-> privileged layer) ──────────────────────────────

/** Renderer -> privileged layer: discover journeys for one pair. Addresses come from the wallet, never from here. */
export interface JourneyPlanRequest {
  fromChain: 'cardano' | 'base' | 'solana'
  fromToken: { address: string; symbol: string; decimals: number }
  toChain: 'ethereum' | 'solana' | 'base'
  toToken: { address: string; symbol: string; decimals: number }
  sellAmountRaw: string
  slippageBps: number
}

export type JourneyPlanEnvelope =
  | { ok: true; value: { candidates: JourneyCandidate[]; ranking: JourneyRanking } }
  | { ok: false; message: string }

/** Network pairs the journey registry can be asked about. */
export function journeyPairSupported(fromChain: string, toChain: string): boolean {
  return (fromChain === 'cardano' && (toChain === 'ethereum' || toChain === 'solana' || toChain === 'base'))
    || (fromChain === 'base' && toChain === 'solana') || (fromChain === 'solana' && toChain === 'base')
}

/** Restored journeys, as the read-only list channel returns them. */
export interface JourneyListSummary {
  /** The CURRENT wallet's unfinished journeys only. */
  active: Array<{
    id: string; bridge: string; createdAt: number
    legs: Array<{ role: string; chain: string; state: string; txHash: string | null; providerRef: string | null; approvalTxHash: string | null; approvedInputRaw: string | null; inputSymbol: string; outputSymbol: string }>
    /** The approved CCIP terms, when the user approved them (immutable). */
    authorization: { sender: string; accountIndex: number; maxCcipFeeWei: string; maxApprovalGasWei: string; maxSendGasWei: string; approvedAt: number } | null
    /** True when nothing was sent for this journey, so it can still be cancelled. */
    cancellable: boolean
    /**
     * Where the value is now: the last CONFIRMED step's measured output, or the
     * output of a sent, unconfirmed step (`settled: false`, amount unknown).
     */
    holding: { chain: string; symbol: string; decimals: number; amountRaw: string | null; settled: boolean }
  }>
  awaitingEvidence: number
  finished: number
  /** Unfinished journeys of other wallets on this device: counted, never shown. */
  otherWallets: number
  unreadable: string[]
}

/**
 * Live terms of one Base -> Solana cbADA transfer for the user to approve
 * (journey:cbadaReview). Ceilings are maxima, never expected costs. Approving
 * sends back only `proposalId`; every term stays in the privileged layer.
 */
export interface CbAdaTermsReview {
  proposalId: string
  quotedAt: number
  expiresAt: number
  sender: string
  accountIndex: number
  recipient: string
  amountRaw: string
  baseToken: string
  solanaMint: string
  router: string
  /** The router's live quote. */
  ccipFeeWei: string
  maxCcipFeeWei: string
  needsApproval: boolean
  allowanceRaw: string
  maxFeePerGasWei: string
  approvalGas: { estimateUnits: string; ceilingUnits: string; maxWei: string; l1FeeWei: string | null }
  /** `estimateUnits` is null while an approval is still needed (the send cannot be estimated before it). */
  sendGas: { estimateUnits: string | null; ceilingUnits: string; maxWei: string; l1FeeWei: string | null }
  /** Fee ceiling + gas ceilings still to be spent. Excludes Base's L1 data fee. */
  totalMaxEthWei: string
  cbAdaBalanceRaw: string
  ethBalanceWei: string
  outboundRateLimit: { enabled: boolean; availableRaw: string; capacityRaw: string } | null
  /** Any entry blocks approval. */
  problems: string[]
}

/** What re-reading a journey's sent steps found (journey:recheck). */
export interface JourneyRecheckResult {
  journeyId: string
  legs: Array<{
    role: string; kind: 'transaction' | 'approval'; chain: string; txHash: string
    onChain: 'confirmed' | 'failed' | 'not-found' | 'unknown'
    allowanceCovers: boolean | null
    burn: {
      burn: 'verified' | 'not-found' | 'unreadable' | 'failed-attempt' | 'conflict' | 'unrelated'
      burnDepth: number | null
      burnFinal: boolean
      provider: 'not-listed' | 'ambiguous' | 'pending' | 'provider-stopped' | 'needs-review' | 'finalized' | 'unreadable' | 'not-checked'
      providerStatus: string | null
      releaseTxHash: string | null
      credit: 'verified' | 'pending' | 'failed' | 'needs-review' | 'evidence-inconsistent' | 'invalid-input' | null
      creditedRaw: string | null
      reason: string | null
    } | null
    messageId: string | null
    delivery:
      | { state: 'delivered'; signature: string; sequenceNumber: string }
      | { state: 'execution-failed'; signature: string; sequenceNumber: string }
      | { state: 'credit-mismatch'; signature: string; creditedRaw: string }
      | { state: 'not-found-yet'; checked: number }
      | { state: 'incomplete'; checked: number; reason: string }
      | null
    note: string | null
  }>
}
