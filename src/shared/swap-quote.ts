/**
 * swap-quote.ts — the normalized swap quote contract, shared by every host.
 *
 * Magic Money's privileged layer and ChainLens's connected-wallet page read and
 * validate the same shape. Moved here unchanged from src/main/swap-proxy.ts,
 * which re-exports it so existing imports keep working.
 */

import type { SolanaUpfrontCost } from './solana-upfront-cost'
import type { RouteStep, DestinationTerms } from './swap-destination'
import type { AppFeeRecord, ExternalFeeRecord } from './swap-fee-policy'

export type SwapProvider = '0x' | '1inch' | 'uniswap' | 'jupiter' | 'okx' | 'lifi' | 'relay' | 'rango' | 'swapkit' | 'muesliswap' | 'minswap'

/**
 * A Cardano batcher order as the provider priced it. These are CLAIMS: the
 * privileged layer re-reads every one of them out of the transaction before it
 * signs (src/main/cardano-swap-validate.ts). Lovelace amounts are integer strings.
 */
export interface CardanoOrderTerms {
  protocol: 'MinswapV2'
  /** Token units the route crosses, in order: sell, any intermediates, buy. */
  path: string[]
  /** Maximum batcher fee committed in the order datum. */
  batcherFeeLovelace: string
  /** ADA locked with the order and returned when it is filled or cancelled. */
  depositLovelace: string
  /** The aggregator's own fee output. Not a Magic Money fee. */
  aggregatorFeeLovelace: string
}

/**
 * What the order transaction actually costs, READ FROM THE TRANSACTION by the
 * privileged layer — never taken from the provider. Integer strings (lovelace).
 */
export interface CardanoSwapCost {
  txFeeLovelace: string
  batcherFeeLovelace: string
  depositLovelace: string
  aggregatorFeeLovelace: string
  /** Net ADA leaving the wallet: fees + deposit, plus the sell amount when selling ADA. */
  adaSpentLovelace: string
  validUntilSlot: string
  /** The floor the order datum commits the batcher to. */
  orderMinimumRaw: string
  /** Single-hop orders: whether an unfillable order is refunded by the batcher. */
  killable: boolean | null
}

export interface NormalizedSwapQuote {
  provider: SwapProvider
  fromChain: string
  toChain: string
  fromTokenAddress: string
  toTokenAddress: string
  fromTokenSymbol: string
  toTokenSymbol: string
  sellAmountRaw: string
  buyAmountRaw: string
  /**
   * Smallest output the transaction will accept before reverting — the actual
   * slippage protection, and the number the user is really approving. Derived
   * from buyAmount+slippage when a provider doesn't return one; a BROAD swap
   * additionally requires simulation rather than trusting a derived value.
   */
  minBuyAmountRaw?: string
  /**
   * Where `minBuyAmountRaw` came from. 'provider' = the route's OWN floor field,
   * i.e. the bound encoded in the payload the router enforces. 'derived' = we
   * computed it from output x (1 - slippage); an estimate, enforced by nothing.
   * Broad (non-curated) tokens may only execute on a 'provider' floor.
   */
  minReceivedSource?: 'provider' | 'derived'
  /**
   * The route as the provider described it (LI.FI `includedSteps`), reduced to
   * what destination terms need. Descriptive only — never executed.
   */
  routeSteps?: RouteStep[] | null
  /**
   * What the minimum received ACTUALLY guarantees, and what the user holds if a
   * cross-chain destination leg fails. Computed by the wallet from routeSteps,
   * never accepted from a backend. Bound into the intent with the rest of the
   * quote, so the approved plan includes its failure mode.
   */
  destination?: DestinationTerms
  /**
   * Handle for the quote the privileged layer stored (see swap-intent.ts). The
   * renderer echoes it back on execute; the wallet then signs ITS OWN copy.
   */
  intentId?: string
  estimatedGasRaw: string
  slippageBps: number
  priceImpactPct: number
  rate: number
  expiresAt: number
  isCrossChain?: boolean
  toAddress?: string
  bridgeTool?: string | null
  estimatedDurationSec?: number
  /**
   * Legacy single number, kept so an older renderer still shows something. It is
   * the APPLIED rate, or 0 -- it is never the rate we merely asked for, and it is
   * not what the policy gate reads. `appFee` is authoritative.
   */
  feeBps?: number
  /**
   * The Magic Money fee, as this specific route priced it: requested vs applied
   * rate, which side it came off, the actual token amount, the beneficiary, and
   * what evidence supports the claim. The wallet re-verifies all of it before
   * signing (src/main/swap-fee.ts) -- an attached record is a claim, not proof.
   */
  appFee?: AppFeeRecord | null
  /** Provider/bridge costs that are NOT ours. Reported separately, never as revenue. */
  externalFees?: ExternalFeeRecord[]
  requestId?: string | null
  txData: {
    to?: string
    data?: string
    value?: string
    swapTransaction?: string
    cbor?: string
  }
  approvalTx?: { to: string; data: string; value: string } | null
  // Uniswap only: a Permit2.approve transaction sent AFTER approvalTx, BEFORE the swap
  // (generatePermitAsTransaction path, so no off-chain permit signature is needed).
  permitTx?: { to: string; data: string; value: string } | null
  /**
   * USD figures AS THE PROVIDER STATED THEM, for route comparison only. Null
   * where a provider does not state one; never estimated. See
   * src/shared/swap-routing-policy.ts.
   */
  valuation?: { outputUsd: number | null; sourceCostUsd: number | null } | null
  /**
   * Solana source only: the SOL this exact transaction needs up front — fees,
   * new or temporary token accounts at CURRENT rent, and SOL sent in the
   * transaction — computed in the privileged layer from the quoted transaction
   * (src/main/solana-swap-cost.ts). The screen and the pre-signing check both
   * judge the balance against it with the same shared rule.
   */
  solanaCost?: SolanaUpfrontCost | null
  /** Cardano source only: the order terms the provider described (claims). */
  cardanoOrder?: CardanoOrderTerms | null
  /** Cardano source only: costs read from the validated transaction itself. */
  cardanoCost?: CardanoSwapCost | null
}
