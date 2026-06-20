/**
 * simpleswap-client.ts — MagicMoney Wallet
 *
 * SimpleSwap v3 cross-chain exchange client (off-chain, deposit-address model —
 * no local tx signing). Runs in the Electron main / extension background; the
 * API key comes from WalletConfig (app-layer for now; moves to a proxy later).
 *
 * Verified against the live v3 API:
 *   - auth: `x-api-key` header
 *   - assets keyed by ticker + network (lowercase)
 *   - GET /v3/estimates → { result: { estimatedAmount, rateId, validUntil } }
 *   - GET /v3/ranges    → { result: { min, max } }
 *   - POST /v3/exchanges (camelCase body) → exchange object
 *   - GET /v3/exchanges/{id} → exchange object
 */

import type { WalletConfig } from './secure-store'

const SS_API = 'https://api.simpleswap.io/v3'

export interface SsEstimateParams {
  tickerFrom: string
  networkFrom: string
  tickerTo: string
  networkTo: string
  amount: string
  fixed: boolean
}

export interface SsEstimateResult {
  estimatedAmount: string | null
  rateId: string | null
  validUntil: string | null
  min: string | null
  max: string | null
  error: string | null
}

export interface SsCreateParams {
  tickerFrom: string
  networkFrom: string
  tickerTo: string
  networkTo: string
  amount: string
  fixed: boolean
  addressTo: string
  extraIdTo?: string
  userRefundAddress?: string
  userRefundExtraId?: string
  rateId?: string | null
}

export interface SsExchangeResult {
  id: string
  status: string
  tickerFrom: string
  tickerTo: string
  networkFrom: string
  networkTo: string
  amountFrom: string
  amountTo: string
  addressFrom: string
  addressTo: string
  extraIdFrom: string | null
  rateType: 'fixed' | 'floating'
  validUntil: string | null
  createdAt: string | null
  error: string | null
}

function ssHeaders(key: string): Record<string, string> {
  return { 'x-api-key': key, accept: 'application/json' }
}

const msg = (e: unknown) =>
  e instanceof Error && e.name === 'TimeoutError' ? 'Request timed out — try again.'
  : (e instanceof Error ? e.message : 'Network error')

// SimpleSwap error bodies vary — pull the most useful message we can find.
async function ssError(res: Response): Promise<string> {
  try {
    const j = await res.json() as { error?: unknown; message?: unknown; description?: unknown }
    const m = j.description ?? j.message ?? j.error
    if (typeof m === 'string' && m) return m
  } catch { /* fall through */ }
  return `SimpleSwap ${res.status}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeExchange(r: any): SsExchangeResult {
  return {
    id: String(r?.id ?? ''),
    status: String(r?.status ?? 'waiting'),
    tickerFrom: r?.tickerFrom ?? r?.currency_from ?? '',
    tickerTo: r?.tickerTo ?? r?.currency_to ?? '',
    networkFrom: r?.networkFrom ?? '',
    networkTo: r?.networkTo ?? '',
    amountFrom: String(r?.amountFrom ?? r?.amount_from ?? ''),
    amountTo: String(r?.amountTo ?? r?.amount_to ?? ''),
    addressFrom: r?.addressFrom ?? r?.address_from ?? '',
    addressTo: r?.addressTo ?? r?.address_to ?? '',
    extraIdFrom: r?.extraIdFrom ?? r?.extra_id_from ?? null,
    rateType: r?.type === 'fixed' || r?.fixed === true ? 'fixed' : 'floating',
    validUntil: r?.validUntil ?? null,
    createdAt: r?.createdAt ?? r?.timestamp ?? null,
    error: null,
  }
}

function errorExchange(error: string): SsExchangeResult {
  return {
    id: '', status: 'failed', tickerFrom: '', tickerTo: '', networkFrom: '', networkTo: '',
    amountFrom: '', amountTo: '', addressFrom: '', addressTo: '', extraIdFrom: null,
    rateType: 'floating', validUntil: null, createdAt: null, error,
  }
}

/** Estimate receive amount + min/max range (two v3 calls, run in parallel). */
export async function ssEstimate(params: SsEstimateParams, config: WalletConfig): Promise<SsEstimateResult> {
  const key = config.simpleSwapApiKey
  if (!key) return { estimatedAmount: null, rateId: null, validUntil: null, min: null, max: null, error: 'SimpleSwap key missing.' }

  const base = `tickerFrom=${params.tickerFrom}&networkFrom=${params.networkFrom}&tickerTo=${params.tickerTo}&networkTo=${params.networkTo}`
  try {
    const [estRes, rangeRes] = await Promise.all([
      fetch(`${SS_API}/estimates?${base}&amount=${encodeURIComponent(params.amount)}&fixed=${params.fixed}&reverse=false`, { headers: ssHeaders(key), signal: AbortSignal.timeout(15_000) }),
      fetch(`${SS_API}/ranges?${base}&fixed=${params.fixed}`, { headers: ssHeaders(key), signal: AbortSignal.timeout(15_000) }),
    ])

    let estimatedAmount: string | null = null, rateId: string | null = null, validUntil: string | null = null, error: string | null = null
    if (estRes.ok) {
      const j = await estRes.json() as { result?: { estimatedAmount?: string; rateId?: string | null; validUntil?: string | null } }
      estimatedAmount = j.result?.estimatedAmount ?? null
      rateId = j.result?.rateId ?? null
      validUntil = j.result?.validUntil ?? null
    } else {
      error = await ssError(estRes)
    }

    let min: string | null = null, max: string | null = null
    if (rangeRes.ok) {
      const j = await rangeRes.json() as { result?: { min?: string | null; max?: string | null } }
      min = j.result?.min ?? null
      max = j.result?.max ?? null
    }

    return { estimatedAmount, rateId, validUntil, min, max, error }
  } catch (e) {
    return { estimatedAmount: null, rateId: null, validUntil: null, min: null, max: null, error: msg(e) }
  }
}

/** Create the exchange — returns the deposit address (addressFrom) the user funds. */
export async function ssCreateExchange(params: SsCreateParams, config: WalletConfig): Promise<SsExchangeResult> {
  const key = config.simpleSwapApiKey
  if (!key) return errorExchange('SimpleSwap key missing.')
  if (!params.addressTo) return errorExchange('Destination address is required.')

  try {
    const res = await fetch(`${SS_API}/exchanges`, {
      method: 'POST',
      headers: { ...ssHeaders(key), 'content-type': 'application/json' },
      body: JSON.stringify({
        fixed: params.fixed,
        tickerFrom: params.tickerFrom,
        tickerTo: params.tickerTo,
        networkFrom: params.networkFrom,
        networkTo: params.networkTo,
        amount: params.amount,
        reverse: false,
        addressTo: params.addressTo,
        extraIdTo: params.extraIdTo ?? '',
        userRefundAddress: params.userRefundAddress ?? '',
        userRefundExtraId: params.userRefundExtraId ?? '',
        rateId: params.rateId ?? null,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return errorExchange(await ssError(res))
    const j = await res.json() as { result?: unknown }
    return normalizeExchange(j.result ?? j)
  } catch (e) {
    return errorExchange(msg(e))
  }
}

/** Poll exchange status. */
export async function ssGetStatus(id: string, config: WalletConfig): Promise<SsExchangeResult> {
  const key = config.simpleSwapApiKey
  if (!key) return errorExchange('SimpleSwap key missing.')
  if (!id) return errorExchange('Missing exchange id.')

  try {
    const res = await fetch(`${SS_API}/exchanges/${encodeURIComponent(id)}`, { headers: ssHeaders(key), signal: AbortSignal.timeout(15_000) })
    if (!res.ok) return errorExchange(await ssError(res))
    const j = await res.json() as { result?: unknown }
    return normalizeExchange(j.result ?? j)
  } catch (e) {
    return errorExchange(msg(e))
  }
}
