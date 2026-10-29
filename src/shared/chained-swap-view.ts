/**
 * chained-swap-view.ts — what the screen sees of a multi-hop swap
 * (src/main/chained-swap.ts). Shapes only; the privileged layer owns all logic.
 */

export interface ChainQuoteRequest {
  /** The chain the swap starts on; Cardano when omitted. */
  fromChain?: string
  fromToken: string; fromSymbol: string; fromDecimals: number
  toChain: string; toToken: string; toSymbol: string; toDecimals: number
  sellAmountRaw: string
  slippageBps: number
}

export interface ChainHopView {
  kind: 'cardano-dex' | 'near-intents' | 'dest-dex' | 'src-dex'
  fromChain: string; toChain: string
  fromSymbol: string; toSymbol: string
  fromDecimals: number; toDecimals: number
  approvedMinOutRaw: string
  plannedSellRaw: string
  state: 'pending' | 'executing' | 'submitted' | 'completed' | 'failed' | 'refunded' | 'needs-review'
  provider: string | null
  /** The single-swap record this hop executed through (hidden from history as its own entry). */
  intentId?: string | null
  /** The route that actually ran this hop, once it has been sent. */
  via?: string | null
  txHash: string | null
  sellRaw: string | null
  measuredOutRaw: string | null
  message: string | null
}

export interface ChainQuoteView {
  planId: string
  hops: ChainHopView[]
  routes: Array<{ kind: ChainHopView['kind']; provider: string; fromSymbol: string; toSymbol: string; minOutRaw: string; chain: string }>
  finalMinRaw: string
  finalExpectedRaw: string
  expiresAt: number
}

export interface ChainedSwapView {
  id: string
  createdAt: number
  hops: ChainHopView[]
  finalMinRaw: string
  finalExpectedRaw: string
  state: 'running' | 'paused' | 'completed' | 'stopped' | 'needs-review'
  reason: string | null
}
