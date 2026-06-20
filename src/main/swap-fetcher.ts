/**
 * swap-fetcher.ts — MagicMoney Wallet
 *
 * Cross-chain swap quotes via the SwapKit REST API (https://api.swapkit.dev).
 * Stage 1: pricing only — fetch routes for a sell/buy pair and surface them to
 * the UI. Execution (POST /v3/swap → sign with the wallet's own keys) is a
 * later stage and is intentionally NOT done here.
 *
 * Asset nomenclature: "CHAIN.TICKER" (e.g. "ETH.ETH", "BTC.BTC") or, for
 * tokens, "CHAIN.TICKER-0xCONTRACT" (e.g. "ETH.USDC-0xA0b8...eB48").
 *
 * Auth: public API key sent in the `x-api-key` header. The key is a publishable
 * credential — the SwapKit *signing secret* is server-side only and must never
 * ship in this client.
 */

import type { WalletConfig } from './secure-store'

const SWAPKIT_API = 'https://api.swapkit.dev'

export interface SwapQuoteParams {
  sellAsset: string   // "ETH.ETH" | "ETH.USDC-0x..."
  buyAsset: string
  sellAmount: string  // decimal string in whole units, e.g. "0.1"
  slippage?: number   // percent, default 3
}

export interface SwapFee {
  type?: string
  amount?: string
  asset?: string
  chain?: string
}

export interface SwapRoute {
  routeId: string
  providers: string[]
  sellAsset: string
  buyAsset: string
  sellAmount: string
  expectedBuyAmount: string
  expectedBuyAmountMaxSlippage: string
  estimatedTime: { total?: number } | null
  totalSlippageBps: number | null
  fees: SwapFee[]
  tags: string[]            // e.g. "RECOMMENDED" | "FASTEST" | "CHEAPEST"
}

export interface SwapQuoteResult {
  quoteId: string | null
  routes: SwapRoute[]
  error: string | null
}

type RawRoute = {
  routeId?: string
  providers?: string[]
  sellAsset?: string
  buyAsset?: string
  sellAmount?: string
  expectedBuyAmount?: string
  expectedBuyAmountMaxSlippage?: string
  estimatedTime?: { total?: number } | null
  totalSlippageBps?: number
  fees?: SwapFee[]
  meta?: { tags?: string[] } | null
}

function normalizeRoute(r: RawRoute): SwapRoute {
  return {
    routeId: r.routeId ?? '',
    providers: r.providers ?? [],
    sellAsset: r.sellAsset ?? '',
    buyAsset: r.buyAsset ?? '',
    sellAmount: r.sellAmount ?? '',
    expectedBuyAmount: r.expectedBuyAmount ?? '',
    expectedBuyAmountMaxSlippage: r.expectedBuyAmountMaxSlippage ?? '',
    estimatedTime: r.estimatedTime ?? null,
    totalSlippageBps: r.totalSlippageBps ?? null,
    fees: r.fees ?? [],
    tags: r.meta?.tags ?? [],
  }
}

// ─── Stage 2: build transaction (/v3/swap) + status (/track) ─────────────────

// Ethers-v6-style EVM tx (hex-encoded numeric fields) returned for EVM routes.
export interface EvmTxObject {
  to?: string
  from?: string
  data?: string
  value?: string
  gas?: string
  gasPrice?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
  chainId?: number
  nonce?: number
}

export interface SwapBuildParams {
  routeId: string
  sourceAddress: string
  destinationAddress: string
}

export interface SwapBuildResult {
  swapId: string | null
  txType: string | null            // "EVM" | "PSBT" | "COSMOS" | …
  tx: EvmTxObject | string | null
  approvalTx: EvmTxObject | null   // ERC-20 approve — sign BEFORE tx
  targetAddress: string | null
  error: string | null
}

export interface SwapTrackResult {
  status: string | null            // pending | swapping | completed | refunded | failed | …
  hash: string | null
  error: string | null
}

export async function fetchSwapTx(
  params: SwapBuildParams,
  config: WalletConfig
): Promise<SwapBuildResult> {
  if (!params.routeId || !params.sourceAddress || !params.destinationAddress) {
    return { swapId: null, txType: null, tx: null, approvalTx: null, targetAddress: null, error: 'Missing swap build parameters.' }
  }
  try {
    const res = await fetch(`${SWAPKIT_API}/v3/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.swapKitApiKey },
      body: JSON.stringify({
        routeId: params.routeId,
        sourceAddress: params.sourceAddress,
        destinationAddress: params.destinationAddress,
      }),
      signal: AbortSignal.timeout(25_000),
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { swapId: null, txType: null, tx: null, approvalTx: null, targetAddress: null, error: `SwapKit ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}` }
    }
    const json = await res.json() as {
      swapId?: string; txType?: string; tx?: EvmTxObject | string
      approvalTx?: EvmTxObject; targetAddress?: string; error?: string
    }
    if (json.error) return { swapId: null, txType: null, tx: null, approvalTx: null, targetAddress: null, error: json.error }
    return {
      swapId: json.swapId ?? null,
      txType: json.txType ?? null,
      tx: json.tx ?? null,
      approvalTx: json.approvalTx ?? null,
      targetAddress: json.targetAddress ?? null,
      error: null,
    }
  } catch (e) {
    return { swapId: null, txType: null, tx: null, approvalTx: null, targetAddress: null, error: e instanceof Error ? e.message : 'Network error' }
  }
}

export async function trackSwap(
  hash: string,
  chainId: string,
  config: WalletConfig
): Promise<SwapTrackResult> {
  if (!hash) return { status: null, hash: null, error: 'Missing tx hash.' }
  try {
    const res = await fetch(`${SWAPKIT_API}/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': config.swapKitApiKey },
      body: JSON.stringify({ hash, chainId }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return { status: null, hash, error: `SwapKit ${res.status}` }
    const json = await res.json() as { status?: string; hash?: string; error?: string }
    if (json.error) return { status: null, hash, error: json.error }
    return { status: json.status ?? null, hash: json.hash ?? hash, error: null }
  } catch (e) {
    return { status: null, hash, error: e instanceof Error ? e.message : 'Network error' }
  }
}

export async function fetchSwapQuote(
  params: SwapQuoteParams,
  config: WalletConfig
): Promise<SwapQuoteResult> {
  const { sellAsset, buyAsset, sellAmount } = params
  if (!sellAsset || !buyAsset || !sellAmount) {
    return { quoteId: null, routes: [], error: 'Select both assets and an amount.' }
  }
  if (sellAsset === buyAsset) {
    return { quoteId: null, routes: [], error: 'Choose two different assets.' }
  }
  if (!(parseFloat(sellAmount) > 0)) {
    return { quoteId: null, routes: [], error: 'Enter an amount greater than zero.' }
  }

  try {
    const res = await fetch(`${SWAPKIT_API}/v3/quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.swapKitApiKey,
      },
      body: JSON.stringify({
        sellAsset,
        buyAsset,
        sellAmount,
        slippage: params.slippage ?? 3,
      }),
      signal: AbortSignal.timeout(20_000),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { quoteId: null, routes: [], error: `SwapKit ${res.status}${body ? `: ${body.slice(0, 180)}` : ''}` }
    }

    const json = await res.json() as { quoteId?: string; routes?: RawRoute[]; error?: string }
    if (json.error) return { quoteId: null, routes: [], error: json.error }

    const routes = (json.routes ?? []).map(normalizeRoute).filter(r => r.routeId)
    if (routes.length === 0) {
      return { quoteId: json.quoteId ?? null, routes: [], error: 'No routes available for this pair.' }
    }
    return { quoteId: json.quoteId ?? null, routes, error: null }
  } catch (e) {
    const msg = e instanceof Error && e.name === 'TimeoutError'
      ? 'Quote request timed out — try again.'
      : (e instanceof Error ? e.message : 'Network error')
    return { quoteId: null, routes: [], error: msg }
  }
}
