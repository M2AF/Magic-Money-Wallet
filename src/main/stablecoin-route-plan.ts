/**
 * stablecoin-route-plan.ts — discover and price a Cardano stablecoin journey
 * (privileged layer): source token -> USDCx -> destination USDC -> token.
 *
 * Composition only. Each swap leg goes through the wallet's existing quote path
 * (getSwapQuote: its safety gates, validators and ranking) and the bridge leg
 * through Circle's nonfunding preparation, validated by its own adapter
 * (xreserve-withdrawal-prepare.ts for Ethereum, xreserve-forwarded-prepare.ts
 * for Arc-forwarded Solana). Nothing is signed or stored, and the plan is
 * always `executable: false`: the Cardano burn build is not yet validated.
 *
 * Amounts flow FORWARD ON FLOORS. The bridge is asked to release the source
 * leg's guaranteed minimum of USDCx less the caller's burn-fee cap, so value +
 * fee can never exceed what the user will hold. The destination leg is then
 * quoted on the least USDC that can arrive — clearly marked indicative, because
 * a real journey re-quotes it from the credit MEASURED on the destination chain.
 * An unavailable bridge never stops the swap legs being discovered.
 *
 * The fee caps are the caller's ceilings (a product/user decision); this module
 * has no defaults for them.
 */

import { decodeCardanoAddress } from './cardano-pure'
import { normalizeSwapAddress } from '../shared/swap-token-identity'
import { costsFromSwapQuote } from '../shared/journey-candidate'
import { ProviderFault } from './xreserve-cardano-provider'
import type { SwapQuoteRequest, SwapQuoteResponse } from './swap-proxy'
import type { PreparedWithdrawal, WithdrawalPrepareInput } from './xreserve-withdrawal-prepare'
import type { PreparedForwardedWithdrawal, ForwardedWithdrawalInput } from './xreserve-forwarded-prepare'
import {
  STABLECOIN_INTERMEDIATES, bridgeCapability, isIntermediate,
  type ExactAsset, type StablecoinRoutePlan, type SwapLegPlan, type BridgeLegPlan,
} from '../shared/stablecoin-route'

export interface StablecoinRouteRequest {
  /** The Cardano token sold (`lovelace` for ADA, else a full unit). */
  source: Omit<ExactAsset, 'chain'>
  sellAmountRaw: string
  destination: { chain: 'ethereum' | 'solana'; token: Omit<ExactAsset, 'chain'>; recipient: string }
  /** The wallet's own Cardano base address: swap owner and bridge depositor. */
  cardanoAddress: string
  slippageBps: number
  /** Ceiling for Circle's burn fee, USDCx base units. Without it the bridge is not priced. */
  burnFeeCapRaw?: string
  /** Solana only: ceiling for the CCTP forwarding fee, base units. */
  forwardingFeeCapRaw?: string
  fastFinality?: boolean
}

export interface StablecoinRouteDeps {
  quote(req: SwapQuoteRequest): Promise<SwapQuoteResponse>
  prepareEthereum(input: WithdrawalPrepareInput): Promise<PreparedWithdrawal>
  prepareSolana(input: ForwardedWithdrawalInput): Promise<PreparedForwardedWithdrawal>
}

const UINT = /^(0|[1-9][0-9]{0,77})$/
const decimal6 = (n: bigint) => `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, '0')}`

/**
 * xReserve's remote depositor for a Cardano key-hash address: `0x00000001` +
 * the 28-byte payment key hash. MEASURED on 60 public mainnet burns
 * (docs/XRESERVE-BURN-INTERFACE-RESEARCH.md), not published; script-credential
 * depositors are unverified, so they are refused.
 */
export function cardanoRemoteDepositor(address: string): string {
  let bytes: Uint8Array
  try { bytes = decodeCardanoAddress(address) } catch { throw new ProviderFault('malformed', 'Not a Cardano address.') }
  const type = bytes[0] >> 4
  if (bytes.length < 29 || (type & 1) !== 0 || type > 6) throw new ProviderFault('malformed', 'Only key-hash Cardano addresses can be bridge depositors.')
  return '0x00000001' + Array.from(bytes.slice(1, 29), b => b.toString(16).padStart(2, '0')).join('')
}

const skipped = (role: SwapLegPlan['role'], asset: ExactAsset, amount: string | null, basis: SwapLegPlan['inputBasis']): SwapLegPlan => ({
  kind: 'swap', role, status: 'skipped', from: asset, to: asset, inputBasis: basis, sellAmountRaw: amount,
  expectedOutRaw: amount, minOutRaw: amount, provider: null, via: null, expiresAt: null,
  reason: `Already ${asset.symbol}; no swap needed.`,
})

/** Native gas asset per chain, for itemizing network fees. */
const NATIVE: Record<string, { symbol: string; decimals: number }> = {
  cardano: { symbol: 'ADA', decimals: 6 }, ethereum: { symbol: 'ETH', decimals: 18 },
  base: { symbol: 'ETH', decimals: 18 }, solana: { symbol: 'SOL', decimals: 9 },
}

const sameAsset = (chain: string, a: string, b: string) => {
  try { return normalizeSwapAddress(chain, a) === normalizeSwapAddress(chain, b) } catch { return false }
}

/**
 * Quote one same-chain leg through the wallet's own quote path. A quote for any
 * other asset than requested is refused (identity is never inferred from a symbol).
 * `legIndex` attributes the quote's stated costs to this leg.
 */
export async function quoteSwapLeg(
  role: SwapLegPlan['role'], from: ExactAsset, to: ExactAsset, amount: string, basis: NonNullable<SwapLegPlan['inputBasis']>,
  taker: string, slippageBps: number, deps: Pick<StablecoinRouteDeps, 'quote'>, legIndex = role === 'source' ? 0 : 2,
): Promise<SwapLegPlan> {
  const base = { kind: 'swap' as const, role, from, to, inputBasis: basis, sellAmountRaw: amount }
  let res: SwapQuoteResponse
  try {
    res = await deps.quote({
      fromChain: from.chain as SwapQuoteRequest['fromChain'], toChain: to.chain as SwapQuoteRequest['toChain'],
      fromToken: from.address, toToken: to.address, fromSymbol: from.symbol, toSymbol: to.symbol,
      fromDecimals: from.decimals, toDecimals: to.decimals,
      sellAmountRaw: amount, slippageBps, taker, toAddress: taker,
    })
  } catch (e) {
    res = { quote: null, error: e instanceof Error ? e.message : 'quote failed' }
  }
  const q = res.quote
  if (!q || !UINT.test(q.buyAmountRaw)) {
    return { ...base, status: 'unavailable', expectedOutRaw: null, minOutRaw: null, provider: null, via: null, expiresAt: null,
      reason: res.error ?? `No route from ${from.symbol} to ${to.symbol} on ${from.chain}.` }
  }
  if ((q.fromTokenAddress && !sameAsset(from.chain, q.fromTokenAddress, from.address))
      || (q.toTokenAddress && !sameAsset(to.chain, q.toTokenAddress, to.address))
      || (q.sellAmountRaw && q.sellAmountRaw !== amount)) {
    return { ...base, status: 'unavailable', expectedOutRaw: null, minOutRaw: null, provider: null, via: null, expiresAt: null,
      reason: 'The quote was for a different token or amount than requested, so it is not used.' }
  }
  const native = NATIVE[from.chain] ?? { symbol: '?', decimals: 0 }
  return {
    ...base, status: 'quoted', expectedOutRaw: q.buyAmountRaw,
    minOutRaw: q.minBuyAmountRaw && UINT.test(q.minBuyAmountRaw) ? q.minBuyAmountRaw : null,
    provider: q.provider, via: q.bridgeTool ?? null, expiresAt: q.expiresAt ?? null, reason: null,
    costs: costsFromSwapQuote(q, legIndex, from.chain, native.symbol, native.decimals),
    outputUsd: typeof q.valuation?.outputUsd === 'number' ? q.valuation.outputUsd : null,
  }
}

export async function planStablecoinRoute(req: StablecoinRouteRequest, deps: StablecoinRouteDeps): Promise<StablecoinRoutePlan> {
  if (!UINT.test(req.sellAmountRaw) || req.sellAmountRaw === '0') throw new ProviderFault('malformed', 'Invalid sell amount.')
  const usdcx = STABLECOIN_INTERMEDIATES.cardano
  const usdc = STABLECOIN_INTERMEDIATES[req.destination.chain]
  const source: ExactAsset = { chain: 'cardano', ...req.source }
  const destination: ExactAsset = { chain: req.destination.chain, ...req.destination.token }
  const capability = bridgeCapability(req.destination.chain)
  const notes = [
    'Three separate transactions, each approved on its own. If a later step does not happen, the stablecoin stays where '
      + 'the last completed step left it.',
    req.destination.chain === 'ethereum'
      ? 'The final swap on Ethereum needs ETH in the destination wallet for gas.'
      : 'The final swap on Solana needs SOL in the destination wallet for fees.',
  ]

  // ── 1. Source: token -> USDCx (skipped when the token already is USDCx) ──
  const sourceLeg = isIntermediate(source)
    ? skipped('source', usdcx, req.sellAmountRaw, 'exact')
    : await quoteSwapLeg('source', source, usdcx, req.sellAmountRaw, 'exact', req.cardanoAddress, req.slippageBps, deps)
  // The bridge can only rely on the source leg's GUARANTEED output.
  const usdcxIn = sourceLeg.status === 'unavailable' ? null : sourceLeg.minOutRaw

  // ── 2. Bridge: Circle's nonfunding preparation, validated ────────────────
  const bridge: BridgeLegPlan = {
    kind: 'bridge', status: 'unavailable', capability, usdcxInRaw: usdcxIn, releaseRaw: null, burnFeeRaw: null,
    forwardingMaxFeeRaw: null, destinationFloorRaw: null, transferSpecHash: null, reason: null,
  }
  if (capability.status === 'unavailable') {
    bridge.reason = capability.blockers[0]
  } else if (usdcxIn === null) {
    bridge.status = 'waiting-on-source'
    bridge.reason = 'The source swap could not be quoted, so the bridge amount is unknown.'
  } else if (!req.burnFeeCapRaw || !UINT.test(req.burnFeeCapRaw)
      || (req.destination.chain === 'solana' && (!req.forwardingFeeCapRaw || !UINT.test(req.forwardingFeeCapRaw)))) {
    bridge.status = 'needs-fee-cap'
    bridge.reason = 'Circle publishes no withdrawal fee schedule; a fee ceiling must be chosen before the bridge can be priced.'
  } else {
    const release = BigInt(usdcxIn) - BigInt(req.burnFeeCapRaw)
    const forwarding = req.destination.chain === 'solana' ? BigInt(req.forwardingFeeCapRaw as string) : 0n
    if (release <= forwarding) {
      bridge.status = 'below-minimum'
      bridge.reason = 'The amount does not cover the bridge fee ceilings.'
    } else {
      try {
        const remoteDepositor = cardanoRemoteDepositor(req.cardanoAddress)
        const prepared = req.destination.chain === 'ethereum'
          ? await deps.prepareEthereum({ amount: decimal6(release), remoteDepositor, recipient: req.destination.recipient, maxFeeRaw: req.burnFeeCapRaw })
          : await deps.prepareSolana({
            amount: decimal6(release), remoteDepositor, solanaRecipient: req.destination.recipient,
            maxBurnFeeRaw: req.burnFeeCapRaw, forwardingMaxFee: decimal6(forwarding), fastFinality: req.fastFinality ?? false,
          })
        const forwardingMax = 'forwardingMaxFeeRaw' in prepared ? BigInt(prepared.forwardingMaxFeeRaw) : 0n
        Object.assign(bridge, {
          status: 'prepared', releaseRaw: prepared.amountRaw,
          burnFeeRaw: 'burnFeeRaw' in prepared ? prepared.burnFeeRaw : prepared.maxFeeRaw,
          forwardingMaxFeeRaw: 'forwardingMaxFeeRaw' in prepared ? prepared.forwardingMaxFeeRaw : null,
          destinationFloorRaw: (BigInt(prepared.amountRaw) - forwardingMax).toString(),
          transferSpecHash: prepared.transferSpecHash,
        })
      } catch (e) {
        bridge.reason = e instanceof ProviderFault ? e.message : 'Circle could not prepare this withdrawal.'
      }
    }
  }

  // ── 3. Destination: USDC -> token, discovered even without a priced bridge ─
  // Priced on the least USDC that can arrive; else, for discovery only, on the
  // USDCx entering the bridge (an upper bound — fees not yet known).
  const destIn = bridge.destinationFloorRaw ?? usdcxIn ?? (isIntermediate(source) ? req.sellAmountRaw : null)
  let destLeg: SwapLegPlan
  if (isIntermediate(destination)) {
    destLeg = skipped('destination', usdc, destIn, destIn ? 'indicative' : null)
  } else if (destIn === null || destIn === '0') {
    destLeg = { kind: 'swap', role: 'destination', status: 'unavailable', from: usdc, to: destination, inputBasis: null,
      sellAmountRaw: null, expectedOutRaw: null, minOutRaw: null, provider: null, via: null, expiresAt: null,
      reason: 'Nothing is known to arrive yet, so the destination swap cannot be quoted.' }
  } else {
    destLeg = await quoteSwapLeg('destination', usdc, destination, destIn, 'indicative', req.destination.recipient, req.slippageBps, deps)
  }

  const allFloors = sourceLeg.status !== 'unavailable' && bridge.status === 'prepared' && destLeg.status !== 'unavailable'
  const expiries = [sourceLeg.expiresAt, destLeg.expiresAt].filter((t): t is number => typeof t === 'number')
  return {
    source, destination, recipient: req.destination.recipient,
    legs: [sourceLeg, bridge, destLeg],
    executable: false,
    indicativeFinalMinRaw: allFloors ? destLeg.minOutRaw : null,
    expiresAt: expiries.length ? Math.min(...expiries) : null,
    notes,
  }
}
