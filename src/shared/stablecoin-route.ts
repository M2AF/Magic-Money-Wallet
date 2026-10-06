/**
 * stablecoin-route.ts — the shape of a Cardano stablecoin journey:
 *
 *   source token -> Cardano USDCx -> destination-chain USDC -> destination token
 *
 * Three legs, each its own transaction and approval, with partial completion
 * possible (docs/USDCX-STABLECOIN-ROUTING-PLAN.md). Platform-neutral: plain data
 * and pure helpers only. Nothing here is signable, and a plan is NEVER an
 * approval: every later leg is re-quoted from the amount actually MEASURED as
 * received, not from these estimates.
 */

import { CARDANO_USDCX_UNIT } from './swap-token-identity'
import type { JourneyCost } from './journey-candidate'

export type StablecoinChain = 'cardano' | 'ethereum' | 'solana' | 'base'

/** One asset, identified exactly: never by symbol. */
export interface ExactAsset {
  chain: StablecoinChain
  /** `lovelace`, a full Cardano unit, an EVM contract, or a Solana mint. */
  address: string
  symbol: string
  decimals: number
}

/** The exact intermediate stablecoin on each chain the journey crosses. */
export const STABLECOIN_INTERMEDIATES: Readonly<Record<StablecoinChain, ExactAsset>> = Object.freeze({
  cardano: Object.freeze({ chain: 'cardano', address: CARDANO_USDCX_UNIT.mainnet, symbol: 'USDCx', decimals: 6 }),
  ethereum: Object.freeze({ chain: 'ethereum', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 }),
  solana: Object.freeze({ chain: 'solana', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC', decimals: 6 }),
  base: Object.freeze({ chain: 'base', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 }),
}) as Readonly<Record<StablecoinChain, ExactAsset>>

export function isIntermediate(asset: { chain: string; address: string }): boolean {
  const pin = STABLECOIN_INTERMEDIATES[asset.chain as StablecoinChain]
  if (!pin) return false
  return asset.chain === 'solana' ? asset.address === pin.address : asset.address.toLowerCase() === pin.address.toLowerCase()
}

export type StablecoinBridgeId = 'xreserve-cardano-ethereum' | 'xreserve-cardano-solana-forwarded'

/**
 * What the wallet can do with a bridge today. `prepare-only`: Circle's terms
 * can be fetched and validated, but nothing is signable. Never `executable`
 * until a validated unsigned burn build exists (plan step 3).
 */
export interface BridgeCapability {
  id: StablecoinBridgeId | null
  destination: StablecoinChain
  status: 'prepare-only' | 'unavailable'
  executable: false
  /** Why execution is not possible, in the user's terms. */
  blockers: string[]
}

const BURN_BLOCKER = 'The Cardano USDCx burn is built by IOG\'s Portal backend, and that build has not yet been validated by this wallet.'

export function bridgeCapability(destination: string): BridgeCapability {
  if (destination === 'ethereum') {
    return { id: 'xreserve-cardano-ethereum', destination, status: 'prepare-only', executable: false, blockers: [BURN_BLOCKER] }
  }
  if (destination === 'solana') {
    return {
      id: 'xreserve-cardano-solana-forwarded', destination, status: 'prepare-only', executable: false,
      blockers: [
        BURN_BLOCKER,
        'Delivery to Solana is forwarded through Arc; whether the recipient must be a wallet or its USDC token account, '
          + 'and whether IOG\'s operator accepts forwarded withdrawals, are not yet established.',
      ],
    }
  }
  return {
    id: null, destination: destination as StablecoinChain, status: 'unavailable', executable: false,
    blockers: ['Circle xReserve does not deliver Cardano USDCx to this network.'],
  }
}

export interface SwapLegPlan {
  kind: 'swap'
  role: 'source' | 'destination'
  status: 'quoted' | 'skipped' | 'unavailable'
  from: ExactAsset
  to: ExactAsset
  /**
   * `exact`: the amount the user holds now. `floor`: the previous leg's
   * guaranteed minimum. `indicative`: an estimate (a bridge release not yet
   * measured); a later quote from the measured credit replaces it.
   */
  inputBasis: 'exact' | 'floor' | 'indicative' | null
  sellAmountRaw: string | null
  expectedOutRaw: string | null
  minOutRaw: string | null
  provider: string | null
  /** Provider route label (e.g. 'Danogo CLMM', 'Minswap V2'). */
  via: string | null
  expiresAt: number | null
  reason: string | null
  /** Costs the quote states (fees, gas, deposits); unknown items stay unknown. */
  costs?: JourneyCost[]
  /** USD value of the expected output, when the provider priced it. */
  outputUsd?: number | null
}

export interface BridgeLegPlan {
  kind: 'bridge'
  status: 'prepared' | 'needs-fee-cap' | 'waiting-on-source' | 'below-minimum' | 'unavailable'
  capability: BridgeCapability
  /** USDCx entering the bridge (the source leg's floor, or the amount held). */
  usdcxInRaw: string | null
  /** USDC released at the bridge destination (Circle's `value`). */
  releaseRaw: string | null
  /** Outer burn fee Circle returned (USDCx). */
  burnFeeRaw: string | null
  /** Solana only: CCTP forwarding fee ceiling, deducted before delivery. */
  forwardingMaxFeeRaw: string | null
  /** The least USDC the destination can receive under these terms. */
  destinationFloorRaw: string | null
  transferSpecHash: string | null
  reason: string | null
}

/** Renderer -> privileged layer: the read-only route preview request. */
export interface StablecoinPlanRequest {
  fromToken: { address: string; symbol: string; decimals: number }
  toChain: 'ethereum' | 'solana'
  toToken: { address: string; symbol: string; decimals: number }
  sellAmountRaw: string
  slippageBps: number
}

export type StablecoinPlanEnvelope = { ok: true; value: StablecoinRoutePlan } | { ok: false; message: string }

export interface StablecoinRoutePlan {
  source: ExactAsset
  destination: ExactAsset
  recipient: string
  legs: [SwapLegPlan, BridgeLegPlan, SwapLegPlan]
  /** Always false in this unit: the bridge leg cannot be signed yet. */
  executable: false
  /** Least final output if every leg settles at its floor; null when any leg is unknown. */
  indicativeFinalMinRaw: string | null
  /** Earliest quote expiry among the quoted legs. */
  expiresAt: number | null
  notes: string[]
}
