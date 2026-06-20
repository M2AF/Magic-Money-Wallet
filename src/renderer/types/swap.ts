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

export type SwapMode = 'dex' | 'crosschain'

export type SwapProvider = '0x' | '1inch' | 'jupiter' | 'okx' | 'lifi' | 'muesliswap'

/** Wallet-internal chain ids the DEX side understands (matches chain-config). */
export type SwapChain = 'ethereum' | 'arbitrum' | 'optimism' | 'base' | 'polygon' | 'avalanche' | 'bsc' | 'solana' | 'cardano'

/** A token the user can pick on a given chain (verified metadata, from the proxy /tokens route). */
export interface SwapToken {
  chain: SwapChain
  symbol: string
  name: string
  address: string        // EVM: 0x… contract (or the native sentinel); Solana: mint; Cardano: policyId+assetName hex
  decimals: number
  logoUri: string | null
  isNative: boolean
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
}

/** The single shape every provider is mapped to before reaching UI / executor. */
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
  estimatedGasRaw: string
  slippageBps: number
  priceImpactPct: number
  rate: number             // buyAmount / sellAmount, human-readable
  expiresAt: number        // unix ms — quote TTL

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
}

export interface SwapQuoteResponse {
  quote: NormalizedSwapQuote | null
  error: string | null
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
