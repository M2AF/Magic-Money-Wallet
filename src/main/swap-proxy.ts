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
import { proxyHeaders, proxyUrl, heliusRpcUrl } from './api-proxy'
import { sanitizeDiscoveredToken, isNativeSwapAddress } from '../shared/swap-token-identity'
import { deriveMinBuyAmountRaw } from './swap-policy'
import {
  withMinReceived, joinReasons, unsignableReason, outdatedWorkerReason, selectSafeRoute,
  type SwapRoutingSummary,
} from '../shared/swap-candidates'
import { compactRouteSteps } from '../shared/swap-destination'
import type { PaidAppFee } from '../shared/swap-settlement'
import { mapStatusForProvider, sameAsset, type SwapLifecycleState } from '../shared/swap-lifecycle'
import { applyShortfallToReport } from '../shared/swap-settlement'
import { measureDelivery } from './swap-delivery'
import { estimateSolanaSwapCost } from './solana-swap-cost'
import { Connection } from '@solana/web3.js'
import {
  APP_FEE_BPS, SWAP_FEE_POLICY_VERSION, SWAP_FEE_BENEFICIARIES, SWAP_FEE_PROVIDERS,
  effectiveBps, feeAmountMatches, feeFreeRecord,
  type AppFeeRecord, type ExternalFeeRecord,
} from '../shared/swap-fee-policy'
import { resolveJupiterFeeAccount, classifyQuoteFee } from './swap-fee'

// The app fee rate and the beneficiaries come from the shared policy, not from
// constants here. The previous arrangement hardcoded 90 bps in this file AND
// defaulted to 90 in the Worker, so the direct LI.FI path below could not be
// corrected by a Worker deploy at all -- exactly the drift the policy module
// exists to prevent.
const LIFI_INTEGRATOR = SWAP_FEE_BENEFICIARIES.lifiIntegrator

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

export type { SwapProvider, NormalizedSwapQuote } from '../shared/swap-quote'
import type { SwapProvider, NormalizedSwapQuote } from '../shared/swap-quote'
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
  verified?: boolean | null
  source?: string
  priceUsd?: number | null
  liquidityUsd?: number | null
  tokenProgram?: string | null
}

export interface SwapTokenSearchRequest {
  chain: SwapChain
  query?: string
  address?: string
  limit?: number
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
  /**
   * Numeric EVM chain id, RPC-verified by the wallet (see
   * swap-network-resolver.ts). `fromChain`/`toChain` are wallet chain-id
   * STRINGS, understood only for built-ins — every per-provider map in the
   * Worker (and the client's own direct LI.FI call) is keyed by that closed
   * set. An imported network has no entry in any of them, so its numeric id is
   * sent alongside the string and used as a fallback wherever the string
   * lookup misses. Never used to override or contradict a resolved built-in.
   */
  fromChainId?: number
  toChainId?: number
}


export interface SwapQuoteResponse {
  quote: NormalizedSwapQuote | null
  error: string | null
  /** Why this route was chosen over the other SAFE ones (routing policy). */
  routing?: SwapRoutingSummary | null
}

export type { SwapRoutingSummary } from '../shared/swap-candidates'

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
  /** The token the user asked to RECEIVE — a refund returns the token they sold. */
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
async function lifiQuoteDirect(req: SwapQuoteRequest, noFee = false): Promise<NormalizedSwapQuote | null> {
  // LIFI_CHAIN only knows the wallet's built-in chain-id STRINGS. An imported
  // network's RPC-verified numeric id (req.fromChainId/toChainId) is the
  // fallback — never used to override a built-in's resolved id.
  const fromId = LIFI_CHAIN[req.fromChain] ?? req.fromChainId ?? null
  const toId = LIFI_CHAIN[req.toChain] ?? req.toChainId ?? null
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
  // Integrator fee, at the SAME policy rate the Worker uses. Routed to the
  // receivers configured under this integrator at portal.li.fi.
  //
  // Measured 2026-09-19: LI.FI answers a fee request from an integrator that is
  // not configured for fee collection with HTTP 400, so a misconfigured
  // integrator drops this route rather than silently returning a fee-free one.
  params.set('integrator', LIFI_INTEGRATOR)
  if (!noFee) params.set('fee', String(APP_FEE_BPS / 10000))   // 0.01 = 1%
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
  const { appFee, externalFees } = lifiFeeRecords(est, req, noFee)

  const sellAmt = Number(req.sellAmountRaw), buyAmt = Number(est.toAmount ?? 0)
  return {
    provider: 'lifi',
    fromChain: req.fromChain, toChain: req.toChain,
    fromTokenAddress: req.fromToken, toTokenAddress: req.toToken,
    fromTokenSymbol: req.fromSymbol, toTokenSymbol: req.toSymbol,
    sellAmountRaw: req.sellAmountRaw, buyAmountRaw: String(est.toAmount ?? '0'),
    // LI.FI states the executed floor directly (verified live: toAmount x
    // (1 - slippage)). Only that counts as a provider floor; a fallback is an
    // estimate and is labelled as one.
    ...lifiMinReceived(est, req.slippageBps),
    estimatedGasRaw: String(tr.gasLimit ?? '0'),
    slippageBps: req.slippageBps,
    priceImpactPct: 0,
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: req.fromChain !== req.toChain,
    toAddress: req.toAddress || req.taker,
    bridgeTool: (d.tool as string) || toolDetails?.key || null,
    // The route's own step list: it names the asset that crosses the bridge,
    // which is what the user holds if a destination swap fails.
    routeSteps: compactRouteSteps(d.includedSteps),
    estimatedDurationSec: Number(est.executionDuration ?? 0),
    feeBps: appFee.appliedBps ?? 0,
    appFee,
    externalFees,
    requestId: null,
    txData,
    approvalTx,
  }
}

/**
 * Read LI.FI's own fee accounting out of a direct (keyless, client-side) quote.
 *
 * Mirrors `lifiFeeRecords` in cloudflare-worker/swap-proxy.js deliberately: this
 * path never touches the Worker, so it needs its own copy of the same reading,
 * and the two are checked against each other by swap-fee-policy.test.ts.
 *
 * MEASURED 2026-09-19 on li.quest/v1/quote with fee=0.01&integrator=ChainLens:
 * `estimate.feeCosts[].feeSplit.recipients` NAMES the integrator and states its
 * amount, and the amount is exactly 100 bps of the INPUT. The same call with an
 * unregistered integrator is refused outright. That is what makes the applied
 * fee checkable rather than merely requested.
 */
function lifiFeeRecords(
  est: Record<string, unknown>, req: SwapQuoteRequest, noFee = false,
): { appFee: AppFeeRecord; externalFees: ExternalFeeRecord[] } {
  const cap = SWAP_FEE_PROVIDERS.lifi
  const appFee: AppFeeRecord = noFee
    ? feeFreeRecord('lifi', req.fromChain, 'quoted without an app fee (tier-2 fallback)')
    : {
    policyVersion: SWAP_FEE_POLICY_VERSION,
    provider: 'lifi',
    requestedBps: APP_FEE_BPS,
    appliedBps: null,
    base: 'input',
    chain: req.fromChain,
    tokenAddress: req.fromToken,
    tokenSymbol: req.fromSymbol || null,
    tokenDecimals: req.fromDecimals ?? null,
    amountRaw: null,
    recipient: LIFI_INTEGRATOR,
    recipientKind: 'registered-integrator',
    collection: cap.collection,
    providerSharePct: cap.providerSharePct,
    verification: 'requested-unverified',
    evidence: [],
  }
  const externalFees: ExternalFeeRecord[] = []

  const costs = Array.isArray(est.feeCosts) ? est.feeCosts as Array<Record<string, unknown>> : []
  for (const cost of costs) {
    const split = cost.feeSplit as { lifiFee?: unknown; integratorFee?: unknown; recipients?: unknown } | undefined
    const token = (cost.token ?? {}) as { symbol?: string; decimals?: number }
    if (!noFee && split && split.integratorFee != null) {
      const amount = String(split.integratorFee).replace(/[^0-9]/g, '')
      const named = Array.isArray(split.recipients)
        && (split.recipients as Array<{ name?: string }>).some(r => r?.name === LIFI_INTEGRATOR)
      appFee.amountRaw = amount || null
      if (token.symbol) appFee.tokenSymbol = token.symbol
      if (typeof token.decimals === 'number') appFee.tokenDecimals = token.decimals
      appFee.appliedBps = effectiveBps(amount, req.sellAmountRaw)
      appFee.evidence.push('estimate.feeCosts[].feeSplit reported by LI.FI')
      if (!named) {
        appFee.evidence.push('integrator was not named in feeSplit.recipients')
      } else if (feeAmountMatches(amount, req.sellAmountRaw, APP_FEE_BPS)) {
        appFee.appliedBps = APP_FEE_BPS
        appFee.verification = 'applied-verified'
        appFee.evidence.push(`integrator named in recipients; amount reconciles to ${APP_FEE_BPS} bps of the input`)
      } else {
        appFee.evidence.push('integrator fee did not reconcile to the policy rate')
      }
    }
    // LI.FI's own fixed fee (0.25% at time of measurement) is a cost to the USER.
    // Reporting it as anything else would inflate what Magic Money is seen to earn.
    const lifiCut = split?.lifiFee != null ? String(split.lifiFee).replace(/[^0-9]/g, '') : ''
    if (lifiCut && lifiCut !== '0') {
      externalFees.push({
        name: 'LI.FI fee',
        tokenSymbol: token.symbol ?? null,
        tokenDecimals: typeof token.decimals === 'number' ? token.decimals : null,
        amountRaw: lifiCut,
        includedInQuotedOutput: cost.included !== false,
      })
    }
  }
  if (!noFee && !appFee.amountRaw) appFee.evidence.push('LI.FI response carried no integrator fee split')
  return { appFee, externalFees }
}

/** LI.FI's own floor when it sent one, otherwise a clearly-labelled estimate. */
function lifiMinReceived(
  est: Record<string, unknown>, slippageBps: number,
): { minBuyAmountRaw?: string; minReceivedSource?: 'provider' | 'derived' } {
  const stated = String(est.toAmountMin ?? '')
  if (/^[0-9]+$/.test(stated) && stated !== '0') {
    return { minBuyAmountRaw: stated, minReceivedSource: 'provider' }
  }
  const derived = deriveMinBuyAmountRaw(String(est.toAmount ?? '0'), slippageBps)
  return derived ? { minBuyAmountRaw: derived, minReceivedSource: 'derived' } : {}
}

type WorkerQuoteResponse = SwapQuoteResponse & { candidates?: NormalizedSwapQuote[] | null }

/**
 * Fetch every candidate route, drop the ones that could not be signed, and
 * offer the best SAFE one under the routing policy.
 *
 * Candidates: LI.FI direct from this device (cross-chain only; the Worker's
 * shared IP is rate-limited) plus every candidate the Worker ranked. All of
 * them go through the same safety filter and the same `selectRoute` — no
 * source is exempt, and a verified fee no longer short-circuits the comparison.
 */
export async function getSwapQuote(req: SwapQuoteRequest, config: WalletConfig): Promise<SwapQuoteResponse> {
  const base = proxyBase(config)
  if (!base) return { quote: null, error: NOT_CONFIGURED }

  // Reasons a route was not offered, so "no route" can say WHY rather than
  // implying the pair does not exist.
  const excluded: string[] = []
  const candidates: NormalizedSwapQuote[] = []
  const consider = (raw: NormalizedSwapQuote | null, label: string): void => {
    const ready = withMinReceived(raw)
    if (!ready) return
    const why = unsignableReason(ready)
    if (why) { excluded.push(`${label}: ${why}`); return }
    candidates.push(ready)
  }

  // Cross-chain: keyless LI.FI from this device. The fee-bearing quote is used
  // when LI.FI VERIFIES the fee; otherwise an explicitly fee-free quote is
  // preferred over charging a 1% nobody can attribute, and the unverified one
  // is kept only if the fee-free re-ask fails — mirroring the Worker.
  const crossChain = req.fromChain !== req.toChain
  if (crossChain) {
    let paid: NormalizedSwapQuote | null = null
    try {
      paid = withMinReceived(await lifiQuoteDirect(req))
      if (!paid || !paid.buyAmountRaw || paid.buyAmountRaw === '0') {
        excluded.push('lifi: no route returned for this pair')
        paid = null
      }
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e)
      console.warn('[swap] LI.FI direct failed:', why)
      excluded.push(`lifi: ${why}`)
    }
    if (paid && classifyQuoteFee(paid).tier === 'fee-paying') {
      consider(paid, 'lifi')
    } else {
      let free: NormalizedSwapQuote | null = null
      try { free = await lifiQuoteDirect(req, true) } catch { /* the Worker is still ahead of us */ }
      if (free && free.buyAmountRaw && free.buyAmountRaw !== '0') consider(free, 'lifi (fee-free)')
      else if (paid) consider(paid, 'lifi')
    }
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
  // RPC-verified numeric ids, for an imported network none of the Worker's
  // per-provider maps (keyed by wallet chain-id STRING) have an entry for.
  if (req.fromChainId != null) params.set('fromChainId', String(req.fromChainId))
  if (req.toChainId != null) params.set('toChainId', String(req.toChainId))
  if (crossChain) params.set('skipLifi', '1')   // we already tried LI.FI from the client

  // Jupiter platform fee: the referral TOKEN account for the output mint. It is
  // derived AND checked on-chain here, in the privileged layer, because the
  // derivation alone proves nothing -- every mint has a deterministic PDA whether
  // or not it was ever created, and Jupiter will happily embed an uninitialised
  // one. A mint with no account means Jupiter can only be quoted fee-free.
  if (!crossChain && req.fromChain === 'solana') {
    const resolved = await resolveJupiterFeeAccount(req.toToken, config)
    if (resolved.feeAccount) params.set('solFeeAccount', resolved.feeAccount)
    else excluded.push(`jupiter fee: ${resolved.reason ?? 'no fee account for this token'}`)
  }

  let workerError: string | null = null
  try {
    const res = await fetchWithDeadline(proxyUrl(`${base}/quote?${params}`, config), {
      headers: proxyHeaders(config, { accept: 'application/json' }),
      signal: AbortSignal.timeout(20_000),
    }, 15_000, 'Worker /quote')
    const data = await res.json().catch(() => null) as WorkerQuoteResponse | null
    if (!res.ok) workerError = (data && data.error) || `Proxy ${res.status}`
    else if (!data) workerError = 'Malformed proxy response.'
    else {
      // The Worker's ranking is a claim from a separately deployed service that
      // may be older than this client, so every candidate is re-checked against
      // the policy this client ships with. A Worker that predates `candidates`
      // sends only `quote`.
      const list = Array.isArray(data.candidates) && data.candidates.length
        ? data.candidates
        : (data.quote ? [data.quote] : [])
      for (const q of list) {
        if (!q || typeof q !== 'object') continue
        const outdated = outdatedWorkerReason(q)
        if (outdated) { excluded.push(`${q.provider}: ${outdated}`); continue }
        consider(q, String(q.provider))
      }
      if (!list.length) workerError = data.error ?? 'No route available.'
    }
  } catch (e) {
    workerError = msg(e)
  }

  if (!candidates.length) {
    return {
      quote: null,
      error: joinReasons(workerError ?? 'No route could be offered safely for this swap.', excluded),
    }
  }

  const selected = selectSafeRoute(candidates, excluded)
  if (!selected.quote) return selected
  return { ...selected, quote: await withSolanaCost(selected.quote, req.taker, config) }
}

/**
 * Attach the SOL a Solana-source quote needs up front, read from ITS transaction
 * (see solana-swap-cost.ts). Best-effort: when it cannot be read the quote is
 * still offered without a cost record, and simulation stays the final check.
 */
async function withSolanaCost(
  quote: NormalizedSwapQuote, payer: string, config: WalletConfig,
): Promise<NormalizedSwapQuote> {
  if (quote.fromChain !== 'solana' || !quote.txData.swapTransaction || !payer) return quote
  try {
    const cost = await estimateSolanaSwapCost(
      quote.txData.swapTransaction,
      // The canonical taker: this wallet's Solana address, which the executor
      // requires to be the transaction's fee payer (swap-executor.ts).
      payer,
      new Connection(heliusRpcUrl(config), 'confirmed'),
      { paysOutSolToPayer: quote.toChain === 'solana' && isNativeSwapAddress('solana', quote.toTokenAddress) },
    )
    return cost ? { ...quote, solanaCost: cost } : quote
  } catch {
    return quote
  }
}

/**
 * Poll the bridge for a cross-chain swap after the source tx is broadcast.
 *
 * The Worker hands back the provider's own vocabulary; the canonical meaning is
 * decided here (src/shared/swap-lifecycle.ts) so `DONE/PARTIAL` and
 * `DONE/REFUNDED` stop reading as success. `expectedToTokenAddress` is what the
 * user asked to receive — a refund arrives as the token they SOLD, so without it
 * a returned asset is indistinguishable from a delivered one.
 */
export async function getCrossSwapStatus(req: CrossSwapStatusRequest, config: WalletConfig): Promise<CrossSwapStatus> {
  const base = proxyBase(config)
  if (!base) return { status: 'unknown', state: 'unknown', error: NOT_CONFIGURED }
  const params = new URLSearchParams({
    provider: req.provider,
    txHash: req.txHash,
    fromChain: req.fromChain,
    toChain: req.toChain,
  })
  if (req.bridgeTool) params.set('bridge', req.bridgeTool)
  // Relay identifies a request by requestId; the source hash is not its key.
  if (req.requestId) params.set('requestId', req.requestId)
  try {
    const res = await fetchWithDeadline(proxyUrl(`${base}/swap/status?${params}`, config), {
      headers: proxyHeaders(config, { accept: 'application/json' }),
      signal: AbortSignal.timeout(15_000),
    }, 12_000, 'Worker /swap/status')
    const data = await res.json().catch(() => null) as (CrossSwapStatus & Record<string, unknown>) | null
    // A transient failure is UNKNOWN, not failed — keep polling.
    if (!res.ok || !data) return { status: 'pending', state: 'bridging', error: null }

    const expected = req.expectedToTokenAddress ?? ''
    const raw = {
      provider: req.provider,
      status: (data.providerStatus as string) ?? null,
      substatus: (data.providerSubstatus as string) ?? null,
      receivedAmountRaw: data.receivedAmountRaw ?? null,
      receivedTokenAddress: (data.receivedTokenAddress as string) ?? null,
      receivedTokenSymbol: (data.receivedTokenSymbol as string) ?? null,
      receivedTokenDecimals: (data.receivedTokenDecimals as number) ?? null,
      receivedTokenChain: (data.receivedTokenChain as string) ?? null,
      destTxHash: data.destTxHash ?? null,
      destExplorerUrl: data.destExplorerUrl ?? null,
      notFound: (data.notFound as boolean) ?? null,
    }
    let report = mapStatusForProvider(req.provider, {
      ...raw,
      failReason: (data.failReason as string) ?? null,
      sourceChain: (data.sourceChain as string) ?? null,
      outboundChain: (data.outboundChain as string) ?? null,
    }, expected)

    // What ACTUALLY arrived, read from the destination transaction, when the
    // expected asset was delivered to our recipient. It replaces the provider's
    // figure (LI.FI's is quote x (1 - slippage), not a measurement) and is what
    // the approved-minimum check then runs on — so the check gets stricter.
    // Refunds and wrong-asset deliveries keep the provider's figure: there is
    // no expected-asset credit to measure.
    let deliveredAmountSource: 'onchain' | 'provider' | null = report.delivered?.amountRaw ? 'provider' : null
    const providerReportedAmountRaw: string | null = report.delivered?.amountRaw ?? null
    const d = report.delivered
    if ((report.state === 'completed' || report.state === 'partial') && report.destTxHash && req.recipient
        && d?.address && expected && sameAsset(d.address, expected, d.chain)) {
      const measured = await measureDelivery({
        toChain: req.toChain, destTxHash: report.destTxHash, recipient: req.recipient, tokenAddress: expected,
      }, config)
      if (measured) {
        report = { ...report, delivered: { ...d, amountRaw: measured.amountRaw } }
        deliveredAmountSource = 'onchain'
      }
    }
    report = applyShortfallToReport(req.minBuyAmountRaw, report)

    return {
      ...data,
      deliveredAmountSource,
      providerReportedAmountRaw,
      state: report.state,
      message: report.message,
      providerStatus: report.providerStatus,
      providerSubstatus: report.providerSubstatus,
      delivered: report.delivered,
      destTxHash: report.destTxHash,
      destExplorerUrl: report.destExplorerUrl,
      failReason: (data.failReason as string) ?? null,
      paidAppFees: Array.isArray(data.paidAppFees) ? data.paidAppFees as PaidAppFee[] : null,
      error: null,
    }
  } catch (e) {
    return { status: 'pending', state: 'bridging', error: msg(e) }   // network blip — keep polling
  }
}

/**
 * Which chain ids our providers actually route, as the backend reports them.
 *
 * This is what lets an IMPORTED network be judged on the same evidence a
 * built-in is. Note what is and is not sent: the wallet asks its own backend
 * which chains the PROVIDERS support, and nothing about the user's network
 * leaves the device — the imported RPC URL is only ever contacted by the wallet
 * itself, to confirm the chain id it claims.
 *
 * Cached in memory with bounded freshness; a failure keeps the previous answer
 * rather than reporting "nothing is supported" and disabling every import.
 *
 * PROVIDER-AGGREGATED (2026-09-21): this used to carry LI.FI and Relay alone,
 * which made those two the permanent eligibility boundary for an imported
 * network — a chain routed only by 0x, 1inch, Uniswap, Rango or SwapKit could
 * never qualify, however well supported it actually was. `providers` now
 * carries every provider the Worker has execution-adapter coverage for
 * (`/swap/chains` v2), each with its own evidence: `source` says whether the
 * list came from the provider's own live endpoint or from its documented
 * chains (used where no key is configured, or no chain-list endpoint exists),
 * and `expiresAt` is when that evidence should be re-read. `lifi`/`relay` are
 * kept at the top level for callers written before this widened.
 */
export interface SwapProviderChainEntry {
  chains: number[]
  nonEvm: string[]
  /** 'live' = fetched from the provider just now. 'documented' = its published
   *  list, used when no live endpoint exists or this deployment holds no key
   *  for it. 'unavailable' = neither could be produced. */
  source: 'live' | 'documented' | 'unavailable'
  /** 'discovered' | 'documented' | 'none' — how the caller should weigh it. */
  evidence: string
  url: string | null
  fetchedAt: number
  expiresAt: number
  stale: boolean
  error: string | null
}

export interface SwapProviderChains {
  version: number
  builtAt: number
  providers: Record<string, SwapProviderChainEntry>
  /** Legacy v1 fields, kept for callers that only ever looked at these two. */
  lifi: number[]
  relay: number[]
  fetchedAt: number
  stale: boolean
}

/**
 * Which providers the Worker actually QUERIES for which role, mirroring
 * cloudflare-worker/swap-proxy.js `handleQuote` exactly (same-chain EVM branch
 * vs the cross-chain `tries` array). A chain id appearing in a provider's
 * documented/live list is a necessary condition for routing it in that role,
 * never a sufficient one on its own — but the split here is what the picker
 * uses to say whether an imported chain can be a swap SOURCE, a cross-chain
 * DESTINATION, or both.
 */
export const SAME_CHAIN_EVM_PROVIDERS = ['0x', '1inch', 'uniswap', 'lifi', 'rango', 'relay'] as const
export const CROSS_CHAIN_EVM_PROVIDERS = ['relay', 'rango', 'swapkit', 'lifi'] as const
/** Every provider the Worker has an EXECUTION adapter for (never Jupiter, which is Solana-only). */
export const EVM_CHAIN_PROVIDERS = ['lifi', 'relay', '0x', '1inch', 'uniswap', 'rango', 'swapkit'] as const

const EMPTY_PROVIDER_CHAINS: SwapProviderChains = {
  version: 2, builtAt: 0, providers: {}, lifi: [], relay: [], fetchedAt: 0, stale: true,
}

const PROVIDER_CHAINS_TTL_MS = 6 * 60 * 60_000
let providerChains: SwapProviderChains | null = null

export function __setProviderChainsCache(value: SwapProviderChains | null): void {
  providerChains = value
}

/** Every EVM chain id ANY provider we can execute against lists, deduplicated. */
export function unionOfExecutableChains(chains: SwapProviderChains): number[] {
  const out = new Set<number>()
  for (const name of EVM_CHAIN_PROVIDERS) {
    for (const id of chains.providers[name]?.chains ?? []) out.add(id)
  }
  return [...out]
}

/** Which of our execution-capable providers list this chain id, by name. */
export function providersForChainId(chains: SwapProviderChains, chainId: number): string[] {
  return EVM_CHAIN_PROVIDERS.filter(name => chains.providers[name]?.chains.includes(chainId))
}

export async function getSwapProviderChains(config: WalletConfig): Promise<SwapProviderChains> {
  const fresh = providerChains && Date.now() - providerChains.fetchedAt < PROVIDER_CHAINS_TTL_MS
  if (fresh && providerChains) return providerChains

  const base = proxyBase(config)
  if (!base) return providerChains ?? EMPTY_PROVIDER_CHAINS
  try {
    const res = await fetchWithDeadline(proxyUrl(`${base}/swap/chains`, config), {
      headers: proxyHeaders(config, { accept: 'application/json' }),
      signal: AbortSignal.timeout(12_000),
    }, 8_000, 'Worker /swap/chains')
    const data = await res.json().catch(() => null) as Partial<SwapProviderChains> | null
    if (!res.ok || !data) return providerChains ?? EMPTY_PROVIDER_CHAINS

    const providers: Record<string, SwapProviderChainEntry> = {}
    for (const [name, raw] of Object.entries(data.providers ?? {})) {
      const p = raw as Partial<SwapProviderChainEntry> | null
      if (!p) continue
      providers[name] = {
        chains: (p.chains ?? []).filter((n): n is number => Number.isInteger(n)),
        nonEvm: Array.isArray(p.nonEvm) ? p.nonEvm.filter((s): s is string => typeof s === 'string') : [],
        source: p.source === 'live' || p.source === 'documented' ? p.source : 'unavailable',
        evidence: typeof p.evidence === 'string' ? p.evidence : 'none',
        url: typeof p.url === 'string' ? p.url : null,
        fetchedAt: typeof p.fetchedAt === 'number' ? p.fetchedAt : 0,
        expiresAt: typeof p.expiresAt === 'number' ? p.expiresAt : 0,
        stale: !!p.stale,
        error: typeof p.error === 'string' ? p.error : null,
      }
    }
    const value: SwapProviderChains = {
      version: typeof data.version === 'number' ? data.version : 2,
      builtAt: typeof data.builtAt === 'number' ? data.builtAt : Date.now(),
      providers,
      lifi: (data.lifi ?? []).filter((n): n is number => Number.isInteger(n)),
      relay: (data.relay ?? []).filter((n): n is number => Number.isInteger(n)),
      fetchedAt: Date.now(),
      stale: !!data.stale,
    }
    providerChains = value
    return value
  } catch {
    return providerChains ?? EMPTY_PROVIDER_CHAINS
  }
}

/**
 * Discover tokens for a chain: opening suggestions, a name/symbol search, or an
 * exact contract/mint resolve.
 *
 * Every record is re-validated through the shared identity core before it is
 * returned. The Worker already sanitizes, but this response carries attacker-
 * authored metadata (anyone can mint a token and name its logo), and a bad
 * `decimals` here would misprice a trade — so it is checked on both sides rather
 * than trusted across the wire.
 *
 * Never throws and never surfaces a provider outage as an error: the caller
 * falls back to its curated entries, and one slow provider must not empty the
 * picker.
 */
export async function getSwapTokenList(
  req: SwapTokenSearchRequest,
  config: WalletConfig,
): Promise<SwapTokenListResponse> {
  const base = proxyBase(config)
  const chain = req?.chain
  if (!base || !chain) return { tokens: [], error: null }

  const params = new URLSearchParams({ chain })
  if (req.address) params.set('address', req.address)
  else if (req.query) params.set('q', req.query)
  if (req.limit) params.set('limit', String(Math.min(50, Math.max(1, req.limit))))

  try {
    const res = await fetchWithDeadline(proxyUrl(`${base}/tokens?${params}`, config), {
      headers: proxyHeaders(config, { accept: 'application/json' }),
      signal: AbortSignal.timeout(15_000),
    }, 8_000, 'Worker /tokens')
    const data = await res.json().catch(() => null) as { tokens?: unknown[]; error?: string | null } | null
    if (!res.ok || !data) return { tokens: [], error: null }

    const tokens: SwapToken[] = []
    for (const raw of data.tokens ?? []) {
      const clean = sanitizeDiscoveredToken(raw, chain)
      if (clean) tokens.push({ ...clean, chain })   // `chain` re-attached as the narrow SwapChain
    }
    return { tokens, error: data.error ?? null }
  } catch {
    return { tokens: [], error: null }
  }
}
