/**
 * near-intents-swap.ts — Cardano (ADA) -> another chain through NEAR Intents
 * 1Click, wired into the wallet's swap pipeline (privileged layer).
 *
 *   quoteNearIntentsFromCardano   a DRY quote, normalized for the swap screen
 *   executeNearIntentsFromCardano the executable quote, held to the approved
 *                                 terms; an exact ADA payment to its deposit
 *                                 address, saved BEFORE it is submitted
 *   nearIntentsSwapStatus         1Click's status, with the destination credit
 *                                 MEASURED on the destination chain
 *
 * The deposit is never resent: an uncertain submission is followed by its hash
 * and its deposit address. See near-intents-client.ts for the trust model.
 */

import type { NormalizedSwapQuote } from '../shared/swap-quote'
import type { WalletConfig } from './secure-store'
import { isNativeSwapAddress } from '../shared/swap-token-identity'
import { mapStatusForProvider, sameAsset } from '../shared/swap-lifecycle'
import { applyShortfallToReport } from '../shared/swap-settlement'
import { measureDelivery } from './swap-delivery'
import { feeFreeRecord } from '../shared/swap-fee-policy'
import {
  fetchOneClickTokens, findOneClickAsset, requestOneClickQuote, checkExecutableQuote, fetchOneClickStatus,
  submitOneClickDeposit, verifyOneClickQuoteSignature, ONE_CLICK_CARDANO_ADA, DEADLINE_MS, NearIntentsError,
  type FetchFn, type OneClickProxy,
} from './near-intents-client'

/** The Cardano payment must be final well before the refund deadline: about 10 minutes. */
export const DEPOSIT_TTL_SLOTS = 600n
/** How long the screen may hold a dry quote before it must be refreshed. */
const QUOTE_HOLD_MS = 60_000

export interface NearIntentsQuoteInput {
  toChain: string
  toToken: string
  toDecimals?: number
  toSymbol: string
  sellAmountRaw: string
  slippageBps: number
  /** This wallet's Cardano address (refunds). */
  taker: string
  /** This wallet's address on the destination chain. */
  toAddress: string
}

export async function quoteNearIntentsFromCardano(
  req: NearIntentsQuoteInput, opts: { fetchFn?: FetchFn; apiKey?: string | null; proxy?: OneClickProxy | null; now?: number } = {},
): Promise<NormalizedSwapQuote> {
  const now = opts.now ?? Date.now()
  if (!/^[1-9][0-9]{0,77}$/.test(req.sellAmountRaw)) throw new NearIntentsError('Invalid ADA amount.')
  if (!req.taker || !req.toAddress) throw new NearIntentsError('This account has no address on one of these networks.')
  const tokens = await fetchOneClickTokens(opts.fetchFn, now)
  const native = isNativeSwapAddress(req.toChain, req.toToken)
  const dest = findOneClickAsset(tokens, req.toChain, req.toToken, req.toDecimals, native)
  if (!dest) throw new NearIntentsError(`NEAR Intents does not offer ${req.toSymbol} on ${req.toChain}.`)
  const r = await requestOneClickQuote({
    dry: true, destinationAsset: dest.assetId, amountLovelace: req.sellAmountRaw, slippageBps: req.slippageBps,
    refundTo: req.taker, recipient: req.toAddress, deadline: new Date(now + DEADLINE_MS).toISOString(),
  }, { fetchFn: opts.fetchFn, apiKey: opts.apiKey, proxy: opts.proxy })
  if (!verifyOneClickQuoteSignature(r)) throw new NearIntentsError('The NEAR Intents quote signature does not verify.')
  const q = r.quote
  if (q.amountIn !== req.sellAmountRaw || r.quoteRequest.recipient !== req.toAddress || r.quoteRequest.refundTo !== req.taker) {
    throw new NearIntentsError('The NEAR Intents quote does not match the requested swap.')
  }
  const out = Number(q.amountOutUsd), inUsd = Number(q.amountInUsd)
  return {
    provider: 'near-intents', fromChain: 'cardano', toChain: req.toChain,
    fromTokenAddress: 'lovelace', toTokenAddress: req.toToken, fromTokenSymbol: 'ADA', toTokenSymbol: req.toSymbol,
    sellAmountRaw: q.amountIn, buyAmountRaw: q.amountOut, minBuyAmountRaw: q.minAmountOut, minReceivedSource: 'provider',
    estimatedGasRaw: '0', slippageBps: req.slippageBps, priceImpactPct: 0,
    rate: Number(q.amountOut) / 10 ** dest.decimals / (Number(q.amountIn) / 1e6),
    expiresAt: now + QUOTE_HOLD_MS, isCrossChain: true, toAddress: req.toAddress, bridgeTool: 'near-intents',
    estimatedDurationSec: q.timeEstimate ?? undefined,
    // No Magic Money fee on this route yet (it needs a 1Click partner key and a NEAR fee account).
    appFee: feeFreeRecord('near-intents', 'cardano', 'no Magic Money fee on NEAR Intents routes yet'),
    externalFees: [
      { name: 'NEAR Intents payout fee', tokenSymbol: req.toSymbol, tokenDecimals: dest.decimals, amountRaw: q.withdrawFee, includedInQuotedOutput: true },
    ],
    requestId: null, txData: {},
    valuation: { outputUsd: Number.isFinite(out) ? out : null, sourceCostUsd: Number.isFinite(out) && Number.isFinite(inUsd) ? Math.max(0, inUsd - out) : null },
    nearIntents: {
      originAsset: ONE_CLICK_CARDANO_ADA, destinationAsset: dest.assetId, slippageBps: req.slippageBps,
      refundTo: req.taker, recipient: req.toAddress, refundFeeLovelace: q.refundFee,
    },
  }
}

export interface NearIntentsToCardanoInput {
  fromChain: string
  fromToken: string
  fromDecimals?: number
  fromSymbol: string
  sellAmountRaw: string
  slippageBps: number
  /** This wallet's address on the source chain (refunds). */
  taker: string
  /** This wallet's Cardano address. */
  toAddress: string
}

/**
 * Another chain -> Cardano ADA: a DRY quote for depositing a token NEAR lists
 * on the source chain (matched by exact contract or native, and decimals).
 * Paid by an ordinary transfer to the deposit address at signing time
 * (swap-executor.ts executeNearIntentsDeposit); refunds return to `taker`.
 */
export async function quoteNearIntentsToCardano(
  req: NearIntentsToCardanoInput, opts: { fetchFn?: FetchFn; apiKey?: string | null; proxy?: OneClickProxy | null; now?: number } = {},
): Promise<NormalizedSwapQuote> {
  const now = opts.now ?? Date.now()
  if (!/^[1-9][0-9]{0,77}$/.test(req.sellAmountRaw)) throw new NearIntentsError('Invalid amount.')
  if (!req.taker || !req.toAddress) throw new NearIntentsError('This account has no address on one of these networks.')
  const tokens = await fetchOneClickTokens(opts.fetchFn, now)
  const origin = findOneClickAsset(tokens, req.fromChain, req.fromToken, req.fromDecimals, isNativeSwapAddress(req.fromChain, req.fromToken))
  if (!origin) throw new NearIntentsError(`NEAR Intents does not take ${req.fromSymbol} on ${req.fromChain}.`)
  const r = await requestOneClickQuote({
    dry: true, originAsset: origin.assetId, destinationAsset: ONE_CLICK_CARDANO_ADA, amountLovelace: req.sellAmountRaw,
    slippageBps: req.slippageBps, refundTo: req.taker, recipient: req.toAddress, deadline: new Date(now + DEADLINE_MS).toISOString(),
  }, { fetchFn: opts.fetchFn, apiKey: opts.apiKey, proxy: opts.proxy })
  if (!verifyOneClickQuoteSignature(r)) throw new NearIntentsError('The NEAR Intents quote signature does not verify.')
  const q = r.quote
  if (q.amountIn !== req.sellAmountRaw || r.quoteRequest.recipient !== req.toAddress || r.quoteRequest.refundTo !== req.taker
      || r.quoteRequest.originAsset !== origin.assetId || r.quoteRequest.destinationAsset !== ONE_CLICK_CARDANO_ADA) {
    throw new NearIntentsError('The NEAR Intents quote does not match the requested swap.')
  }
  const out = Number(q.amountOutUsd), inUsd = Number(q.amountInUsd)
  return {
    provider: 'near-intents', fromChain: req.fromChain, toChain: 'cardano',
    fromTokenAddress: req.fromToken, toTokenAddress: 'lovelace', fromTokenSymbol: req.fromSymbol, toTokenSymbol: 'ADA',
    sellAmountRaw: q.amountIn, buyAmountRaw: q.amountOut, minBuyAmountRaw: q.minAmountOut, minReceivedSource: 'provider',
    estimatedGasRaw: '0', slippageBps: req.slippageBps, priceImpactPct: 0,
    rate: (Number(q.amountOut) / 1e6) / (Number(q.amountIn) / 10 ** origin.decimals),
    expiresAt: now + QUOTE_HOLD_MS, isCrossChain: true, toAddress: req.toAddress, bridgeTool: 'near-intents',
    estimatedDurationSec: q.timeEstimate ?? undefined,
    appFee: feeFreeRecord('near-intents', req.fromChain, 'no Magic Money fee on NEAR Intents routes yet'),
    externalFees: [
      { name: 'NEAR Intents payout fee', tokenSymbol: 'ADA', tokenDecimals: 6, amountRaw: q.withdrawFee, includedInQuotedOutput: true },
    ],
    requestId: null, txData: {},
    valuation: { outputUsd: Number.isFinite(out) ? out : null, sourceCostUsd: Number.isFinite(out) && Number.isFinite(inUsd) ? Math.max(0, inUsd - out) : null },
    nearIntents: {
      originAsset: origin.assetId, destinationAsset: ONE_CLICK_CARDANO_ADA, slippageBps: req.slippageBps,
      refundTo: req.taker, recipient: req.toAddress,
      // In the ORIGIN asset's units on this direction (named for the Cardano-origin case).
      refundFeeLovelace: q.refundFee,
    },
  }
}

/**
 * The executable (non-dry) quote for an approved dry quote, checked field by
 * field and against the approved minimum. Returns its deposit address.
 */
export async function liveNearIntentsDeposit(
  quote: NormalizedSwapQuote, opts: { fetchFn?: FetchFn; apiKey?: string | null; proxy?: OneClickProxy | null; now?: number } = {},
): Promise<{ depositAddress: string; deadlineMs: number; correlationId: string | null }> {
  const t = quote.nearIntents
  if (!t || !quote.minBuyAmountRaw) throw new NearIntentsError('The approved NEAR Intents terms are missing.')
  const now = opts.now ?? Date.now()
  const live = await requestOneClickQuote({
    dry: false, originAsset: t.originAsset, destinationAsset: t.destinationAsset, amountLovelace: quote.sellAmountRaw, slippageBps: t.slippageBps,
    refundTo: t.refundTo, recipient: t.recipient, deadline: new Date(now + DEADLINE_MS).toISOString(),
  }, opts)
  const checked = checkExecutableQuote(live, {
    originAsset: t.originAsset, originChain: quote.fromChain, destinationAsset: t.destinationAsset, amountLovelace: quote.sellAmountRaw, slippageBps: t.slippageBps,
    refundTo: t.refundTo, recipient: t.recipient, approvedMinOutRaw: quote.minBuyAmountRaw, now,
  })
  return { ...checked, correlationId: live.correlationId }
}

export { submitOneClickDeposit }

/** 1Click status for a recorded deposit, with the credit measured on chain. */
export async function nearIntentsSwapStatus(
  req: { requestId?: string | null; toChain: string; expectedToTokenAddress?: string; recipient?: string | null; minBuyAmountRaw?: string | null },
  config: WalletConfig, fetchFn?: FetchFn,
) {
  if (!req.requestId) {
    return { status: 'unknown' as const, state: 'unknown' as const, error: null, message: 'The NEAR Intents deposit address is not recorded for this swap.' }
  }
  let s
  try { s = await fetchOneClickStatus(req.requestId, fetchFn) } catch (e) {
    return { status: 'pending' as const, state: 'bridging' as const, error: e instanceof Error ? e.message : 'status unavailable' }
  }
  if (!s) return { status: 'pending' as const, state: 'source-submitted' as const, error: null, message: 'NEAR Intents has not seen this deposit yet.' }
  const expected = req.expectedToTokenAddress ?? ''
  const destTxHash = s.destinationTxHashes[0] ?? null
  let report = mapStatusForProvider('near-intents', {
    provider: 'near-intents', status: s.rawStatus, substatus: s.refundReason,
    receivedAmountRaw: s.status === 'SUCCESS' ? s.amountOut : null,
    receivedTokenAddress: s.status === 'SUCCESS' ? expected : null, receivedTokenChain: s.status === 'SUCCESS' ? req.toChain : null,
    destTxHash, destExplorerUrl: null,
  }, expected)
  let deliveredAmountSource: 'onchain' | 'provider' | null = report.delivered?.amountRaw ? 'provider' : null
  const providerReportedAmountRaw = report.delivered?.amountRaw ?? null
  const d = report.delivered
  if (report.state === 'completed' && destTxHash && req.recipient && d?.address && expected && sameAsset(d.address, expected, d.chain)) {
    const measured = await measureDelivery({ toChain: req.toChain, destTxHash, recipient: req.recipient, tokenAddress: expected }, config)
    // Native EVM payouts leave no Transfer event to measure; there the provider
    // figure stands, as on every other cross-chain route (see swap-delivery.ts).
    const measurable = req.toChain === 'solana' || !isNativeSwapAddress(req.toChain, expected)
    if (measured) { report = { ...report, delivered: { ...d, amountRaw: measured.amountRaw } }; deliveredAmountSource = 'onchain' }
    else if (measurable) {
      // SUCCESS that the destination chain does not (yet) confirm is not delivery.
      // Reported as still processing, so a resumed session (which re-maps the
      // provider status) cannot record a completion the chain has not shown.
      report = { ...report, state: 'bridging', providerStatus: 'PROCESSING', providerSubstatus: 'AWAITING_DESTINATION_CREDIT',
        message: 'NEAR Intents reports success; waiting to confirm the credit on the destination chain.' }
      deliveredAmountSource = null
    }
  }
  report = applyShortfallToReport(req.minBuyAmountRaw ?? null, report)
  return {
    status: report.state === 'completed' ? 'done' as const : report.state === 'failed' ? 'failed' as const : 'pending' as const,
    state: report.state, message: report.message, providerStatus: report.providerStatus, providerSubstatus: report.providerSubstatus,
    delivered: report.delivered, destTxHash: report.destTxHash, destExplorerUrl: report.destExplorerUrl,
    deliveredAmountSource, providerReportedAmountRaw, error: null,
  }
}
