/**
 * journey-providers.ts — the registry of multi-leg route families
 * (privileged layer). Each provider says which network pairs it can connect
 * and builds a JourneyCandidate: its legs (reusing the wallet's existing swap
 * quote path for every DEX leg), every cost itemized, and whether it is
 * executable and validated. Candidates are compared by rankJourneys
 * (src/shared/journey-candidate.ts), which applies the shared routing policy to
 * executable, validated routes only and lists the rest as previews.
 *
 * Families:
 *   usdcx-xreserve      Cardano token -> USDCx -> USDC (Ethereum/Solana) -> token
 *   cbada-ccip          Base/Solana token -> cbADA -> CCIP -> cbADA -> token
 *   coinbase-conversion native Cardano ADA <-> cbADA through a Coinbase account;
 *                       conditional: listed with its conditions, never executable
 *
 * Nothing here signs or sends. Today every candidate is non-executable: the
 * xReserve burn build and the CCIP send are not yet implemented and validated,
 * and journey persistence is not wired. The final output after any bridge is
 * INDICATIVE: a real journey re-quotes the last leg from the measured credit.
 */

import type { SwapQuoteRequest, SwapQuoteResponse } from './swap-proxy'
import type { PreparedWithdrawal, WithdrawalPrepareInput } from './xreserve-withdrawal-prepare'
import type { PreparedForwardedWithdrawal, ForwardedWithdrawalInput } from './xreserve-forwarded-prepare'
import { planStablecoinRoute, quoteSwapLeg } from './stablecoin-route-plan'
import { CBADA, cbAdaLane, isCbAda, type CcipReads, type CbAdaChain } from './cbada-ccip'
import type { ExactAsset, SwapLegPlan } from '../shared/stablecoin-route'
import {
  rankJourneys, type JourneyCandidate, type JourneyCost, type JourneyFamily, type JourneyLegSummary, type JourneyRanking,
} from '../shared/journey-candidate'

export interface JourneyRequest {
  source: ExactAsset
  sellAmountRaw: string
  destination: ExactAsset
  /** This wallet's own address on the source chain (swap taker, bridge sender). */
  sourceAddress: string
  /** This wallet's own address on the destination chain. */
  recipient: string
  slippageBps: number
}

export interface JourneyDeps {
  quote(req: SwapQuoteRequest): Promise<SwapQuoteResponse>
  prepareEthereum(input: WithdrawalPrepareInput): Promise<PreparedWithdrawal>
  prepareSolana(input: ForwardedWithdrawalInput): Promise<PreparedForwardedWithdrawal>
  ccip: CcipReads
  /** USD price of a chain's native gas asset; null/absent leaves those costs unpriced. */
  nativeUsd?(chain: string): Promise<number | null>
}

export interface JourneyProvider {
  family: JourneyFamily
  supports(sourceChain: string, destinationChain: string): boolean
  plan(req: JourneyRequest, deps: JourneyDeps): Promise<JourneyCandidate>
}

const UINT = /^(0|[1-9][0-9]{0,77})$/
/** Display name of a chain id, e.g. 'base' -> 'Base'. */
const cap = (c: string) => c.charAt(0).toUpperCase() + c.slice(1)
const DEST_GAS_NOTE: Record<string, string> = {
  ethereum: 'The final swap on Ethereum needs ETH in the destination wallet for gas.',
  base: 'The final swap on Base needs ETH in the destination wallet for gas.',
  solana: 'The final swap on Solana needs SOL in the destination wallet for fees.',
}

function legSummary(l: SwapLegPlan, label: string): JourneyLegSummary {
  return {
    kind: 'swap', label, status: l.status, from: l.from, to: l.to, inputBasis: l.inputBasis,
    inRaw: l.sellAmountRaw, expectedOutRaw: l.expectedOutRaw, minOutRaw: l.minOutRaw, via: l.via, expiresAt: l.expiresAt, reason: l.reason,
  }
}

const unknownCost = (label: string, leg: number, chain: string, symbol: string, decimals: number, kind: JourneyCost['kind'] = 'fee'): JourneyCost =>
  ({ label, leg, chain, symbol, decimals, amountRaw: null, usd: null, kind, includedInOutput: false })

/** A provider that threw becomes an explicit unavailable candidate; it never hides the others. */
function failed(family: JourneyFamily, req: JourneyRequest, why: string): JourneyCandidate {
  return {
    family, label: family, source: req.source, destination: req.destination, legs: [], costs: [],
    executable: false, validated: false, finalExpectedRaw: null, finalMinRaw: null, finalOutputUsd: null, blockers: [why],
  }
}

// ── USDCx via Circle xReserve ──────────────────────────────────────────────────

export const usdcxProvider: JourneyProvider = {
  family: 'usdcx-xreserve',
  supports: (s, d) => s === 'cardano' && (d === 'ethereum' || d === 'solana'),
  async plan(req, deps) {
    const plan = await planStablecoinRoute({
      source: { address: req.source.address, symbol: req.source.symbol, decimals: req.source.decimals },
      sellAmountRaw: req.sellAmountRaw,
      destination: { chain: req.destination.chain as 'ethereum' | 'solana', token: req.destination, recipient: req.recipient },
      cardanoAddress: req.sourceAddress, slippageBps: req.slippageBps,
      // No fee ceiling: a ceiling bounds a charge; it is never the expected cost.
    }, deps)
    const [src, bridge, dst] = plan.legs
    const costs: JourneyCost[] = [...(src.costs ?? []), ...(dst.costs ?? [])]
    if (bridge.status === 'prepared') {
      costs.push({ label: 'Circle withdrawal fee', leg: 1, chain: 'cardano', symbol: 'USDCx', decimals: 6, amountRaw: bridge.burnFeeRaw, usd: null, kind: 'fee', includedInOutput: true })
      if (bridge.forwardingMaxFeeRaw) costs.push(unknownCost('CCTP forwarding fee (only its ceiling is known)', 1, 'solana', 'USDC', 6))
    } else {
      costs.push(unknownCost('Circle withdrawal fee', 1, 'cardano', 'USDCx', 6))
    }
    costs.push(unknownCost('Cardano burn network fee', 1, 'cardano', 'ADA', 6, 'gas'))
    const bridged = bridge.status === 'prepared'
    return {
      family: 'usdcx-xreserve', label: 'USDCx via Circle xReserve', source: plan.source, destination: plan.destination,
      legs: [
        legSummary(src, `Swap ${src.from.symbol} → USDCx on Cardano`),
        { kind: 'bridge', label: `Bridge USDCx → USDC on ${cap(req.destination.chain)}`, status: bridged ? 'prepared' : 'unavailable',
          from: src.to, to: dst.from, inputBasis: 'floor', inRaw: bridge.usdcxInRaw, expectedOutRaw: bridge.destinationFloorRaw,
          minOutRaw: bridge.destinationFloorRaw, via: 'Circle xReserve', expiresAt: null, reason: bridge.reason },
        legSummary(dst, `Swap USDC → ${dst.to.symbol} on ${cap(req.destination.chain)}`),
      ],
      costs,
      executable: false, validated: false,
      finalExpectedRaw: bridged && dst.status !== 'unavailable' ? dst.expectedOutRaw : null,
      finalMinRaw: plan.indicativeFinalMinRaw,
      finalOutputUsd: dst.outputUsd ?? null,
      blockers: [...bridge.capability.blockers, ...(bridge.reason && !bridged ? [bridge.reason] : []), DEST_GAS_NOTE[req.destination.chain]],
    }
  },
}

// ── cbADA via Chainlink CCIP ───────────────────────────────────────────────────

const cbAdaAsset = (chain: CbAdaChain): ExactAsset => ({ chain, address: CBADA[chain].token, symbol: 'cbADA', decimals: CBADA[chain].decimals })

const skippedLeg = (role: SwapLegPlan['role'], asset: ExactAsset, amount: string | null): SwapLegPlan => ({
  kind: 'swap', role, status: 'skipped', from: asset, to: asset, inputBasis: role === 'source' ? 'exact' : 'indicative',
  sellAmountRaw: amount, expectedOutRaw: amount, minOutRaw: amount, provider: null, via: null, expiresAt: null,
  reason: `Already ${asset.symbol}; no swap needed.`, costs: [], outputUsd: null,
})

export const cbAdaProvider: JourneyProvider = {
  family: 'cbada-ccip',
  supports: (s, d) => cbAdaLane(s, d),
  async plan(req, deps) {
    const from = req.source.chain as CbAdaChain, to = req.destination.chain as CbAdaChain
    const srcCb = cbAdaAsset(from), dstCb = cbAdaAsset(to)
    // ── 1. Source: token -> cbADA (skipped when it already is cbADA) ─────────
    const src = isCbAda(from, req.source.address)
      ? skippedLeg('source', srcCb, req.sellAmountRaw)
      : await quoteSwapLeg('source', req.source, srcCb, req.sellAmountRaw, 'exact', req.sourceAddress, req.slippageBps, deps, 0)
    const bridgeIn = src.status === 'unavailable' ? null : src.minOutRaw
    const costs: JourneyCost[] = [...(src.costs ?? [])]
    const blockers = ['Sending cbADA over Chainlink CCIP is not implemented or validated in this wallet yet.']

    // ── 2. CCIP: pool checks and the live fee ────────────────────────────────
    let bridgeStatus: JourneyLegSummary['status'] = 'unavailable'
    let bridgeReason: string | null = null
    if (bridgeIn === null) {
      bridgeReason = 'The first swap could not be quoted, so the amount to bridge is unknown.'
    } else if (BigInt(bridgeIn) > CBADA.laneCapacityRaw) {
      bridgeReason = 'The amount exceeds the CCIP lane\'s transfer capacity.'
    } else if (to === 'base') {
      // Lock/release on Base: arriving cbADA is RELEASED from what the pool holds.
      const liquidity = await deps.ccip.baseReleaseLiquidity()
      if (liquidity === null) bridgeReason = 'The Base pool\'s release liquidity could not be read.'
      else if (liquidity < BigInt(bridgeIn)) bridgeReason = `The Base CCIP pool holds ${liquidity} base units of cbADA, less than this transfer would release.`
      else bridgeStatus = 'prepared'
      costs.push(unknownCost('Chainlink CCIP fee (Solana → Base not yet estimated)', 1, 'solana', 'SOL', 9))
    } else {
      bridgeStatus = 'prepared'
      const feeWei = await deps.ccip.feeBaseToSolana(BigInt(bridgeIn), req.recipient)
      const ethUsd = feeWei === null ? null : await deps.nativeUsd?.('base') ?? null
      costs.push({
        label: 'Chainlink CCIP fee', leg: 1, chain: 'base', symbol: 'ETH', decimals: 18,
        amountRaw: feeWei === null ? null : feeWei.toString(),
        usd: feeWei !== null && ethUsd !== null ? Number(feeWei) / 1e18 * ethUsd : null,
        kind: 'fee', includedInOutput: false,
      })
    }
    costs.push(unknownCost(`${cap(from)} network fee for the CCIP send`, 1, from, from === 'solana' ? 'SOL' : 'ETH', from === 'solana' ? 9 : 18, 'gas'))
    if (bridgeReason) blockers.push(bridgeReason)

    // ── 3. Destination: cbADA -> token, quoted on the amount CCIP delivers ───
    // Token pools move cbADA 1:1; the CCIP fee is paid separately. Indicative:
    // a real journey re-quotes from the credit measured on the destination.
    const arriving = bridgeStatus === 'prepared' ? bridgeIn : null
    const discoverWith = arriving ?? bridgeIn ?? (isCbAda(from, req.source.address) ? req.sellAmountRaw : null)
    let dst: SwapLegPlan
    if (isCbAda(to, req.destination.address)) dst = skippedLeg('destination', dstCb, discoverWith)
    else if (discoverWith === null) {
      dst = { kind: 'swap', role: 'destination', status: 'unavailable', from: dstCb, to: req.destination, inputBasis: null, sellAmountRaw: null,
        expectedOutRaw: null, minOutRaw: null, provider: null, via: null, expiresAt: null, reason: 'Nothing is known to arrive yet.', costs: [], outputUsd: null }
    } else {
      dst = await quoteSwapLeg('destination', dstCb, req.destination, discoverWith, 'indicative', req.recipient, req.slippageBps, deps, 2)
    }
    costs.push(...(dst.costs ?? []))
    blockers.push(DEST_GAS_NOTE[to])

    const complete = src.status !== 'unavailable' && bridgeStatus === 'prepared' && dst.status !== 'unavailable'
    return {
      family: 'cbada-ccip', label: 'cbADA via Chainlink CCIP', source: req.source, destination: req.destination,
      legs: [
        legSummary(src, `Swap ${req.source.symbol} → cbADA on ${cap(from)}`),
        { kind: 'bridge', label: `Bridge cbADA ${cap(from)} → ${cap(to)} (Chainlink CCIP)`, status: bridgeStatus, from: srcCb, to: dstCb,
          inputBasis: 'floor', inRaw: bridgeIn, expectedOutRaw: arriving, minOutRaw: arriving, via: 'Chainlink CCIP', expiresAt: null, reason: bridgeReason },
        legSummary(dst, `Swap cbADA → ${req.destination.symbol} on ${cap(to)}`),
      ],
      costs,
      executable: false, validated: false,
      finalExpectedRaw: complete ? dst.expectedOutRaw : null,
      finalMinRaw: complete ? dst.minOutRaw : null,
      finalOutputUsd: complete ? dst.outputUsd ?? null : null,
      blockers,
    }
  },
}

// ── Native Cardano ADA <-> cbADA through Coinbase (conditional) ───────────────

export const coinbaseConversionProvider: JourneyProvider = {
  family: 'coinbase-conversion',
  supports: (s, d) => s === 'cardano' && (d === 'base' || d === 'solana'),
  async plan(req) {
    const to = req.destination.chain as CbAdaChain
    return {
      family: 'coinbase-conversion', label: 'ADA → cbADA through a Coinbase account', source: req.source, destination: req.destination,
      legs: [{
        kind: 'conversion', label: `Convert ADA to cbADA on ${cap(to)} through Coinbase`, status: 'unavailable',
        from: req.source, to: cbAdaAsset(to), inputBasis: null, inRaw: req.sellAmountRaw, expectedOutRaw: null, minOutRaw: null,
        via: 'Coinbase', expiresAt: null, reason: 'Requires a connected Coinbase account.',
      }],
      costs: [unknownCost('Coinbase conversion and withdrawal fees', 0, 'cardano', 'ADA', 6)],
      executable: false, validated: false, finalExpectedRaw: null, finalMinRaw: null, finalOutputUsd: null,
      blockers: [
        'Requires a connected Coinbase account; the wallet has no Coinbase connection.',
        'Coinbase documents account-based wrapping, but API automation of an ADA deposit followed by a cbADA withdrawal is not verified.',
        'Network support, fees, limits and account eligibility are not established.',
      ],
    }
  },
}

export const JOURNEY_PROVIDERS: readonly JourneyProvider[] = [usdcxProvider, cbAdaProvider, coinbaseConversionProvider]

export async function planJourneys(
  req: JourneyRequest, deps: JourneyDeps, providers: readonly JourneyProvider[] = JOURNEY_PROVIDERS,
): Promise<{ candidates: JourneyCandidate[]; ranking: JourneyRanking }> {
  if (!UINT.test(req.sellAmountRaw) || req.sellAmountRaw === '0') throw new Error('Invalid sell amount.')
  const supported = providers.filter(p => p.supports(req.source.chain, req.destination.chain))
  const candidates: JourneyCandidate[] = []
  // One at a time: several providers share per-IP-limited quote APIs.
  for (const p of supported) {
    try { candidates.push(await p.plan(req, deps)) } catch (e) {
      candidates.push(failed(p.family, req, e instanceof Error ? e.message : 'This route could not be planned.'))
    }
  }
  return { candidates, ranking: rankJourneys(candidates) }
}
