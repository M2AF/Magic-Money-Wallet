/**
 * swap-proxy.ts — MagicMoney Wallet
 *
 * Client-side caller for the MagicMoney swap proxy (Cloudflare Worker). The
 * wallet NEVER calls 0x / 1inch / Jupiter / LI.FI directly and never holds
 * their keys — it asks the proxy, which injects keys server-side and returns a
 * normalized quote.
 *
 * Until the worker is deployed, `config.swapProxyUrl` may be empty; callers get
 * a clear, actionable error rather than a thrown exception.
 *
 * Types mirror src/renderer/types/swap.ts (kept in sync by hand, matching the
 * existing main↔renderer type convention).
 */

import type { WalletConfig } from './secure-store'

export type SwapProvider = '0x' | '1inch' | 'jupiter' | 'okx' | 'lifi' | 'rango' | 'swapkit' | 'muesliswap'
export type SwapChain =
  | 'ethereum' | 'arbitrum' | 'optimism' | 'base' | 'polygon' | 'avalanche' | 'bsc'
  | 'monad' | 'solana' | 'cardano' | 'bitcoin' | 'polkadot'

export interface SwapToken {
  chain: SwapChain
  symbol: string
  name: string
  address: string
  decimals: number
  logoUri: string | null
  isNative: boolean
}

export interface SwapQuoteRequest {
  fromChain: SwapChain
  toChain: SwapChain
  fromToken: string
  toToken: string
  fromSymbol: string
  toSymbol: string
  sellAmountRaw: string
  slippageBps: number
  taker: string
  toAddress: string
  fromDecimals?: number
  toDecimals?: number
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
  estimatedGasRaw: string
  slippageBps: number
  priceImpactPct: number
  rate: number
  expiresAt: number
  isCrossChain?: boolean
  toAddress?: string
  bridgeTool?: string | null
  estimatedDurationSec?: number
  feeBps?: number
  requestId?: string | null
  txData: {
    to?: string
    data?: string
    value?: string
    swapTransaction?: string
    cbor?: string
  }
  approvalTx?: { to: string; data: string; value: string } | null
}

export interface SwapQuoteResponse {
  quote: NormalizedSwapQuote | null
  error: string | null
}

export interface SwapTokenListResponse {
  tokens: SwapToken[]
  error: string | null
}

export interface CrossSwapStatusRequest {
  provider: SwapProvider
  txHash: string
  fromChain: string
  toChain: string
  bridgeTool?: string | null
  requestId?: string | null
}

export interface CrossSwapStatus {
  status: 'pending' | 'done' | 'failed' | 'unknown'
  substatus?: string | null
  receivedAmountRaw?: string | null
  destTxHash?: string | null
  destExplorerUrl?: string | null
  error: string | null
}

function proxyBase(config: WalletConfig): string | null {
  const base = (config.swapProxyUrl || '').trim().replace(/\/+$/, '')
  return base || null
}

const NOT_CONFIGURED =
  'DEX swap proxy is not configured yet. Deploy the Cloudflare Worker and set swapProxyUrl to enable on-chain swaps.'

const msg = (e: unknown) =>
  e instanceof Error && e.name === 'TimeoutError' ? 'Quote request timed out — try again.'
  : (e instanceof Error ? e.message : 'Network error')

/** Fetch a normalized DEX quote via the proxy. */
export async function getSwapQuote(req: SwapQuoteRequest, config: WalletConfig): Promise<SwapQuoteResponse> {
  const base = proxyBase(config)
  if (!base) return { quote: null, error: NOT_CONFIGURED }

  const params = new URLSearchParams({
    chain: req.fromChain,          // legacy alias (same-chain); fromChain is authoritative
    fromChain: req.fromChain,
    toChain: req.toChain,
    sell: req.fromToken,
    buy: req.toToken,
    sellSymbol: req.fromSymbol,
    buySymbol: req.toSymbol,
    amount: req.sellAmountRaw,
    slippageBps: String(req.slippageBps),
    taker: req.taker,
    toAddress: req.toAddress || req.taker,
  })
  if (req.fromDecimals != null) params.set('fromDecimals', String(req.fromDecimals))
  if (req.toDecimals != null) params.set('toDecimals', String(req.toDecimals))

  try {
    const res = await fetch(`${base}/quote?${params}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
    })
    const data = await res.json().catch(() => null) as SwapQuoteResponse | null
    if (!res.ok) return { quote: null, error: (data && data.error) || `Proxy ${res.status}` }
    if (!data) return { quote: null, error: 'Malformed proxy response.' }
    return { quote: data.quote ?? null, error: data.error ?? (data.quote ? null : 'No route available.') }
  } catch (e) {
    return { quote: null, error: msg(e) }
  }
}

/** Poll the bridge for a cross-chain swap after the source tx is broadcast. */
export async function getCrossSwapStatus(req: CrossSwapStatusRequest, config: WalletConfig): Promise<CrossSwapStatus> {
  const base = proxyBase(config)
  if (!base) return { status: 'unknown', error: NOT_CONFIGURED }
  const params = new URLSearchParams({
    provider: req.provider,
    txHash: req.txHash,
    fromChain: req.fromChain,
    toChain: req.toChain,
  })
  if (req.bridgeTool) params.set('bridge', req.bridgeTool)
  if (req.requestId) params.set('requestId', req.requestId)
  try {
    const res = await fetch(`${base}/swap/status?${params}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json().catch(() => null) as CrossSwapStatus | null
    if (!res.ok || !data) return { status: 'pending', error: null }   // transient — keep polling
    return data
  } catch (e) {
    return { status: 'pending', error: msg(e) }   // network blip — keep polling
  }
}

/** Fetch a verified token list for a chain (falls back to the client's curated list on empty). */
export async function getSwapTokenList(chain: SwapChain, config: WalletConfig): Promise<SwapTokenListResponse> {
  const base = proxyBase(config)
  if (!base) return { tokens: [], error: null }
  try {
    const res = await fetch(`${base}/tokens?chain=${encodeURIComponent(chain)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json().catch(() => null) as SwapTokenListResponse | null
    if (!res.ok || !data) return { tokens: [], error: null }
    return { tokens: data.tokens ?? [], error: data.error ?? null }
  } catch {
    return { tokens: [], error: null }
  }
}
