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

import { PublicKey } from '@solana/web3.js'
import type { WalletConfig } from './secure-store'
import { proxyHeaders, proxyUrl } from './api-proxy'

// ── Affiliate / integrator fee config (mirrors the Worker's FEE_BPS = 90) ─────
const AFFILIATE_FEE_BPS = 90                        // 0.9%
const LIFI_INTEGRATOR = 'ChainLens'                 // registered at portal.li.fi; receivers configured there

// Jupiter Referral Program: the swap `feeAccount` must be the referral TOKEN
// account — a PDA of ['referral_ata', referralAccount, mint] — NOT the referral
// account itself. Both IDs are public (visible in every fee transfer on-chain).
const JUP_REFERRAL_PROGRAM = new PublicKey('REFER4ZgmyYx9c6He5XfaTMiGfdLwRnkV4RPp9t9iF3')
const JUP_REFERRAL_ACCOUNT = new PublicKey('9vBwkLqEcNs6LKv8Szyrt4P9h82SBWaD3hbiDZ1A3hUy')

/** Referral token account (PDA) for an output mint, or null if the mint isn't valid base58. */
function jupiterFeeAccount(outputMint: string): string | null {
  try {
    const [pda] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode('referral_ata'), JUP_REFERRAL_ACCOUNT.toBytes(), new PublicKey(outputMint).toBytes()],
      JUP_REFERRAL_PROGRAM,
    )
    return pda.toBase58()
  } catch { return null }
}

// Pluggable fetch. In the Electron MAIN process, Node's undici `fetch` can hang
// indefinitely on some hosts (e.g. li.quest) and even ignore AbortSignal.timeout —
// which is why the desktop quote "hung forever" while the extension (Chromium fetch)
// worked. Electron main injects `net.fetch` (Chromium's stack) via setSwapFetch();
// the extension/service-worker leaves the global fetch in place.
type FetchFn = (input: string, init?: RequestInit) => Promise<Response>
let swapFetch: FetchFn = (input, init) => fetch(input, init)
export function setSwapFetch(fn: FetchFn): void { swapFetch = fn }

/**
 * swapFetch wrapped in a HARD deadline. `Promise.race` against a manual setTimeout
 * guarantees a settle even if the underlying fetch never resolves and ignores
 * AbortSignal.timeout — so a quote can never hang the UI indefinitely. The `label`
 * identifies which provider timed out.
 */
async function fetchWithDeadline(url: string, init: RequestInit | undefined, ms: number, label: string): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms)
  })
  try {
    return await Promise.race([swapFetch(url, init), deadline])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type SwapProvider = '0x' | '1inch' | 'uniswap' | 'jupiter' | 'okx' | 'lifi' | 'rango' | 'swapkit' | 'muesliswap'
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
  // Uniswap only: a Permit2.approve transaction sent AFTER approvalTx, BEFORE the swap
  // (generatePermitAsTransaction path, so no off-chain permit signature is needed).
  permitTx?: { to: string; data: string; value: string } | null
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

// ── LI.FI direct (client-side, keyless) ──────────────────────────────────────
// LI.FI hard rate-limits the Worker's shared Cloudflare egress IP (keyless), so
// cross-chain LI.FI quotes are fetched HERE, from the user's own IP. There is no
// key to protect (LI.FI has none), so this respects the no-keys-in-client model.
// The Worker still handles Rango/SwapKit fallback (those have keys).

const LIFI_CHAIN: Record<string, number> = {
  ethereum: 1, arbitrum: 42161, optimism: 10, base: 8453,
  polygon: 137, avalanche: 43114, bsc: 56, monad: 143,
  solana: 1151111081099710, bitcoin: 20000000000001,
}
const NATIVE_EVM_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'
const isNativeEvmAddr = (a: string) =>
  a.toLowerCase() === NATIVE_EVM_SENTINEL || a === '0x0000000000000000000000000000000000000000'

function erc20ApproveData(spender: string): string {
  const addr = spender.toLowerCase().replace(/^0x/, '').padStart(64, '0')
  return `0x095ea7b3${addr}${'f'.repeat(64)}`
}

function lifiToken(chain: string, addr: string): string {
  if (chain === 'solana') return addr === SOL_NATIVE_MINT ? '11111111111111111111111111111111' : addr
  return isNativeEvmAddr(addr) ? '0x0000000000000000000000000000000000000000' : addr
}

/** Keyless LI.FI quote fetched from the user's IP. Returns null when LI.FI has no route. */
async function lifiQuoteDirect(req: SwapQuoteRequest): Promise<NormalizedSwapQuote | null> {
  const fromId = LIFI_CHAIN[req.fromChain], toId = LIFI_CHAIN[req.toChain]
  if (fromId == null || toId == null) return null

  const params = new URLSearchParams({
    fromChain: String(fromId), toChain: String(toId),
    fromToken: lifiToken(req.fromChain, req.fromToken),
    toToken: lifiToken(req.toChain, req.toToken),
    fromAmount: req.sellAmountRaw,
    fromAddress: req.taker,
    toAddress: req.toAddress || req.taker,
    slippage: String(req.slippageBps / 10000),
  })
  // Integrator fee — routed to the receivers configured under 'ChainLens' at portal.li.fi.
  params.set('integrator', LIFI_INTEGRATOR)
  if (AFFILIATE_FEE_BPS > 0) params.set('fee', String(AFFILIATE_FEE_BPS / 10000))   // 0.009 = 0.9%
  const res = await fetchWithDeadline(`https://li.quest/v1/quote?${params}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  }, 12_000, 'LI.FI direct')
  if (!res.ok) return null
  const d = await res.json().catch(() => null) as Record<string, unknown> | null
  if (!d) return null
  const est = (d.estimate as Record<string, unknown>) || {}
  const tr = (d.transactionRequest as Record<string, unknown>) || {}
  const toolDetails = d.toolDetails as { key?: string } | undefined

  let txData: NormalizedSwapQuote['txData']
  let approvalTx: NormalizedSwapQuote['approvalTx'] = null
  if (req.fromChain === 'solana') {
    if (!tr.data) return null
    txData = { swapTransaction: String(tr.data) }
  } else {
    if (!tr.to || !tr.data) return null
    txData = { to: String(tr.to), data: String(tr.data), value: String(tr.value ?? '0') }
    if (!isNativeEvmAddr(req.fromToken) && est.approvalAddress) {
      approvalTx = { to: req.fromToken, data: erc20ApproveData(String(est.approvalAddress)), value: '0x0' }
    }
  }
  const sellAmt = Number(req.sellAmountRaw), buyAmt = Number(est.toAmount ?? 0)
  return {
    provider: 'lifi',
    fromChain: req.fromChain, toChain: req.toChain,
    fromTokenAddress: req.fromToken, toTokenAddress: req.toToken,
    fromTokenSymbol: req.fromSymbol, toTokenSymbol: req.toSymbol,
    sellAmountRaw: req.sellAmountRaw, buyAmountRaw: String(est.toAmount ?? '0'),
    estimatedGasRaw: String(tr.gasLimit ?? '0'),
    slippageBps: req.slippageBps,
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: req.fromChain !== req.toChain,
    toAddress: req.toAddress || req.taker,
    bridgeTool: (d.tool as string) || toolDetails?.key || null,
    estimatedDurationSec: Number(est.executionDuration ?? 0),
    feeBps: AFFILIATE_FEE_BPS,
    requestId: null,
    txData,
    approvalTx,
  }
}

/** Fetch a normalized DEX quote. Cross-chain tries LI.FI directly first (see above). */
export async function getSwapQuote(req: SwapQuoteRequest, config: WalletConfig): Promise<SwapQuoteResponse> {
  const base = proxyBase(config)
  if (!base) return { quote: null, error: NOT_CONFIGURED }

  // Cross-chain: try keyless LI.FI from here; fall through to the proxy otherwise.
  const crossChain = req.fromChain !== req.toChain
  if (crossChain) {
    try {
      const q = await lifiQuoteDirect(req)
      if (q && q.buyAmountRaw && q.buyAmountRaw !== '0') return { quote: q, error: null }
    } catch (e) { console.warn('[swap] LI.FI direct failed — falling through to proxy:', e instanceof Error ? e.message : e) }
  }

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
  if (crossChain) params.set('skipLifi', '1')   // we already tried LI.FI from the client

  // Jupiter platform fee: pass the referral token account for the output mint so the
  // Worker collects our fee. The Worker retries fee-less if that mint's referral ATA
  // hasn't been created, so an unconfigured mint never breaks the swap.
  if (!crossChain && req.fromChain === 'solana' && AFFILIATE_FEE_BPS > 0) {
    const feeAcct = jupiterFeeAccount(req.toToken)
    if (feeAcct) params.set('solFeeAccount', feeAcct)
  }

  try {
    const res = await fetchWithDeadline(proxyUrl(`${base}/quote?${params}`, config), {
      headers: proxyHeaders(config, { accept: 'application/json' }),
      signal: AbortSignal.timeout(20_000),
    }, 12_000, 'Worker /quote')
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
    const res = await fetchWithDeadline(proxyUrl(`${base}/swap/status?${params}`, config), {
      headers: proxyHeaders(config, { accept: 'application/json' }),
      signal: AbortSignal.timeout(15_000),
    }, 12_000, 'Worker /swap/status')
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
    const res = await swapFetch(proxyUrl(`${base}/tokens?chain=${encodeURIComponent(chain)}`, config), {
      headers: proxyHeaders(config, { accept: 'application/json' }),
      signal: AbortSignal.timeout(15_000),
    })
    const data = await res.json().catch(() => null) as SwapTokenListResponse | null
    if (!res.ok || !data) return { tokens: [], error: null }
    return { tokens: data.tokens ?? [], error: data.error ?? null }
  } catch {
    return { tokens: [], error: null }
  }
}
