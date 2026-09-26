/**
 * swap.ts — shared swap types.
 *
 * The Swap page has two modes: an on-chain DEX aggregator ('dex') and the
 * off-chain SimpleSwap cross-chain exchange ('crosschain'). They are distinct
 * flows with separate types — SimpleSwap lives in ./simpleswap.
 *
 * The DEX side normalises every aggregator (0x, 1inch, Jupiter, OKX, LI.FI,
 * MuesliSwap) onto a single `NormalizedSwapQuote` before it touches the UI or
 * the executor. This file is the single source of truth for that shape; the
 * main-process modules import these types directly (types are erased at build).
 */

import type { SolanaUpfrontCost } from '../../shared/solana-upfront-cost'
import type { RouteStep, DestinationTerms } from '../../shared/swap-destination'
import type { PaidAppFee } from '../../shared/swap-settlement'
import type { SwapLifecycleState } from '../../shared/swap-lifecycle'
import type { CardanoOrderTerms, CardanoSwapCost } from '../../shared/swap-quote'

export type SwapMode = 'dex' | 'crosschain'

export type SwapProvider = '0x' | '1inch' | 'uniswap' | 'jupiter' | 'okx' | 'lifi' | 'relay' | 'rango' | 'swapkit' | 'muesliswap' | 'minswap'

/** Wallet-internal chain ids the DEX side understands (matches chain-config). */
export type SwapChain =
  | 'ethereum' | 'arbitrum' | 'optimism' | 'base' | 'polygon' | 'avalanche' | 'bsc'
  | 'monad' | 'solana' | 'cardano' | 'bitcoin' | 'polkadot'

/**
 * A token the user can pick on a given chain.
 *
 * Identity is `chain` + `address`, never the symbol: a live Jupiter search for
 * "BONK" returns five different mints with three different decimal counts. The
 * optional fields below are populated by dynamic discovery (the proxy /tokens
 * route) and absent on the bundled curated entries, so both kinds of token are
 * assignable to the same shape.
 */
export interface SwapToken {
  chain: SwapChain
  symbol: string
  name: string
  address: string        // EVM: 0x… contract (or the native sentinel); Solana: mint; Cardano: policyId+assetName hex
  decimals: number
  logoUri: string | null
  isNative: boolean
  /** true = a provider asserts verified; false = asserts NOT; null/undefined = UNKNOWN. */
  verified?: boolean | null
  /** Which discovery source produced this record (provenance for debugging). */
  source?: string
  priceUsd?: number | null
  liquidityUsd?: number | null
  /** Solana only: owning token program. Token-2022 mints can carry transfer fees. */
  tokenProgram?: string | null
}

/**
 * One token-discovery request. `address` resolves an exact contract/mint;
 * `query` searches by name or symbol (and is treated as an exact address when it
 * structurally is one). Neither means "give me the opening suggestions".
 */
export interface SwapTokenSearchRequest {
  chain: SwapChain
  query?: string
  address?: string
  limit?: number
}

/** EVM native-asset sentinel used by 0x / 1inch / LI.FI. */
export const NATIVE_EVM_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

export interface SwapQuoteRequest {
  fromChain: SwapChain
  toChain: SwapChain
  fromToken: string        // address/mint/policy (or native sentinel)
  toToken: string
  fromSymbol: string
  toSymbol: string
  sellAmountRaw: string    // smallest unit (wei / lamports / lovelace)
  slippageBps: number      // 50 = 0.5%
  taker: string            // the signing wallet address on fromChain
  toAddress: string        // the receiving wallet address on toChain (cross-chain delivery)
  fromDecimals?: number    // decimals of the sell token (SwapKit needs human amounts)
  toDecimals?: number      // decimals of the buy token (to convert SwapKit output back to raw)
  /** RPC-verified numeric EVM chain id, for an imported network the per-provider
   *  maps (keyed by wallet chain-id STRING) have no entry for. See swap-proxy.ts. */
  fromChainId?: number
  toChainId?: number
}

/** The single shape every provider is mapped to before reaching UI / executor. */
/**
 * Fee types re-exported from the shared policy so the renderer cannot drift into
 * its own shape. The renderer may DISPLAY these; it can never author them --
 * every field is produced and re-verified in the privileged layer.
 */
export type {
  AppFeeRecord, ExternalFeeRecord, SwapFeeBase, SwapFeeVerification,
} from '../../shared/swap-fee-policy'
import type { AppFeeRecord, ExternalFeeRecord } from '../../shared/swap-fee-policy'

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
  rate: number             // buyAmount / sellAmount, human-readable
  expiresAt: number        // unix ms — quote TTL

  // Cross-chain metadata (set when fromChain !== toChain). Same-chain quotes omit these.
  isCrossChain?: boolean
  toAddress?: string            // destination wallet the bridge delivers to
  bridgeTool?: string | null    // bridge/tool name (LI.FI step.tool, Rango swapper) — also the LI.FI status key
  estimatedDurationSec?: number // expected bridge settlement time
  /** Legacy single number: the APPLIED app-fee rate, or 0. `appFee` is authoritative. */
  feeBps?: number
  /**
   * The Magic Money fee as this route priced it. Display reads the AMOUNT and
   * token from here rather than turning `feeBps` back into a percentage: the two
   * are not interchangeable when a provider charges on the input and the user is
   * reading a number denominated in the output.
   */
  appFee?: AppFeeRecord | null
  /** Provider/bridge costs that are NOT Magic Money revenue. Shown separately. */
  externalFees?: ExternalFeeRecord[]
  requestId?: string | null     // Rango requestId - required to poll its status

  // The raw payload ready to sign.
  txData: {
    to?: string              // EVM: aggregator contract
    data?: string            // EVM: hex calldata
    value?: string           // EVM: native value (hex or decimal wei)
    swapTransaction?: string  // Solana: base64 VersionedTransaction
    cbor?: string             // Cardano: unsigned tx CBOR hex
  }

  // EVM-only: a prior ERC-20 approval, if the route needs an allowance.
  approvalTx?: {
    to: string
    data: string
    value: string
  } | null

  // Uniswap only: a Permit2.approve tx sent after approvalTx and before the swap.
  permitTx?: {
    to: string
    data: string
    value: string
  } | null

  /** USD figures as the provider stated them, for route comparison only; never estimated. */
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

/** Poll the bridge for a cross-chain swap after the source tx is broadcast. */
export interface CrossSwapStatusRequest {
  provider: SwapProvider
  txHash: string
  fromChain: string
  toChain: string
  bridgeTool?: string | null  // LI.FI: the step tool
  requestId?: string | null   // Rango: the requestId from the quote
  /**
   * The token the user asked to RECEIVE. A refund delivers the token they sold,
   * so without this a returned asset cannot be told apart from a delivered one.
   */
  expectedToTokenAddress?: string
  /**
   * The wallet's receiving address and the approved minimum, so the delivered
   * amount can be MEASURED on the destination chain and checked against the
   * floor the user approved (see swap-delivery.ts).
   */
  recipient?: string | null
  minBuyAmountRaw?: string | null
}

export interface CrossSwapStatus {
  /** Legacy coarse status, kept so an older UI still renders something sane. */
  status: 'pending' | 'done' | 'failed' | 'unknown'
  substatus?: string | null
  receivedAmountRaw?: string | null
  destTxHash?: string | null
  destExplorerUrl?: string | null
  error: string | null

  // ── Canonical lifecycle (see src/shared/swap-lifecycle.ts) ────────────────
  // `status: 'done'` alone never meant the user got their token: LI.FI reports
  // DONE for COMPLETED, PARTIAL and REFUNDED alike. These fields say which.
  state?: SwapLifecycleState
  message?: string | null
  providerStatus?: string | null
  providerSubstatus?: string | null
  /** Provider's stated reason for a refund or failure (Relay `failReason`). */
  failReason?: string | null
  /**
   * Who the provider says it actually PAID app fees to, after settlement. Only
   * Relay publishes this; null everywhere else.
   */
  paidAppFees?: PaidAppFee[] | null
  /**
   * Where `delivered.amountRaw` came from. 'onchain' = measured from the
   * destination transaction; 'provider' = the provider's figure, which for
   * LI.FI is derived from the quote (quote x (1 - slippage)), not observed.
   */
  deliveredAmountSource?: 'onchain' | 'provider' | null
  /** The provider's own figure, kept when the on-chain measurement replaced it. */
  providerReportedAmountRaw?: string | null
  /** What ACTUALLY arrived — on a refund this is the token that was sold. */
  delivered?: {
    chain: string | null
    address: string | null
    symbol: string | null
    decimals: number | null
    amountRaw: string | null
  } | null
}

export interface SwapQuoteResponse {
  quote: NormalizedSwapQuote | null
  error: string | null
  /** Why this route was chosen over the other SAFE ones (routing policy). */
  routing?: SwapRoutingSummary | null
}

export interface SwapRoutingSummary {
  policyVersion: string
  reason: 'best-net-result' | 'fee-route-within-tolerance'
  shortfallBps: number
  costsNormalized: boolean
  safeCandidates: number
  excluded: string[]
  alternatives: { provider: string; buyAmountRaw: string; minBuyAmountRaw: string | null; feeVerified: boolean }[]
}

export interface SwapExecuteResult {
  txHash: string
  explorerUrl: string
  approvalTxHash: string | null
}

export interface SwapTokenListResponse {
  tokens: SwapToken[]
  error: string | null
}
