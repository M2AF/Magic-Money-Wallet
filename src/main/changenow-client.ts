/**
 * changenow-client.ts — MagicMoney Wallet
 *
 * ChangeNOW v2 cross-chain exchange client (off-chain, deposit-address model —
 * no local tx signing). This is the SECOND deposit-address provider, used as a
 * fallback behind SimpleSwap for pairs SimpleSwap can't price (e.g. Polkadot/DOT).
 *
 * The API key lives only as a Worker secret (CHANGENOW_API_KEY); all calls go
 * through the proxy `/cn/*` routes. Responses are mapped onto the same
 * SsEstimateResult / SsExchangeResult shapes the SimpleSwap client returns, so the
 * aggregator and UI treat both providers uniformly. ChangeNOW's lifecycle states
 * (new/waiting/confirming/exchanging/sending/finished/failed/refunded/expired)
 * line up 1:1 with the SimpleSwap status card (we map `new` → `waiting`).
 */

import type { WalletConfig } from './secure-store'
import { proxyBase } from './api-proxy'
import type { SsEstimateParams, SsEstimateResult, SsCreateParams, SsExchangeResult } from './simpleswap-client'

const msg = (e: unknown) =>
  e instanceof Error && e.name === 'TimeoutError' ? 'Request timed out — try again.'
  : (e instanceof Error ? e.message : 'Network error')

const flowOf = (fixed: boolean) => (fixed ? 'fixed-rate' : 'standard')

function errorExchange(error: string): SsExchangeResult {
  return {
    id: '', status: 'failed', tickerFrom: '', tickerTo: '', networkFrom: '', networkTo: '',
    amountFrom: '', amountTo: '', addressFrom: '', addressTo: '', extraIdFrom: null,
    rateType: 'floating', validUntil: null, createdAt: null, error,
  }
}

// ChangeNOW `new` is the pre-deposit state — present it as `waiting` like SimpleSwap.
function mapStatus(s: unknown): string {
  const v = String(s ?? 'waiting')
  return v === 'new' ? 'waiting' : v
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeExchange(r: any, params?: Partial<SsCreateParams>): SsExchangeResult {
  return {
    id: String(r?.id ?? ''),
    status: mapStatus(r?.status),
    tickerFrom: r?.fromCurrency ?? params?.tickerFrom ?? '',
    tickerTo: r?.toCurrency ?? params?.tickerTo ?? '',
    networkFrom: r?.fromNetwork ?? params?.networkFrom ?? '',
    networkTo: r?.toNetwork ?? params?.networkTo ?? '',
    amountFrom: String(r?.amountFrom ?? r?.expectedAmountFrom ?? params?.amount ?? ''),
    amountTo: String(r?.amountTo ?? r?.expectedAmountTo ?? ''),
    addressFrom: r?.payinAddress ?? '',
    addressTo: r?.payoutAddress ?? params?.addressTo ?? '',
    extraIdFrom: r?.payinExtraId ?? null,
    rateType: r?.flow === 'fixed-rate' ? 'fixed' : 'floating',
    validUntil: r?.validUntil ?? null,
    createdAt: r?.createdAt ?? null,
    error: null,
  }
}

/** Estimate receive amount + min/max range (estimated-amount + range, in parallel). */
export async function cnEstimate(params: SsEstimateParams, config: WalletConfig): Promise<SsEstimateResult> {
  const proxy = proxyBase(config)
  if (!proxy) return { estimatedAmount: null, rateId: null, validUntil: null, min: null, max: null, error: 'ChangeNOW not configured.' }

  const flow = flowOf(params.fixed)
  const q = `fromCurrency=${params.tickerFrom}&toCurrency=${params.tickerTo}&fromNetwork=${params.networkFrom}&toNetwork=${params.networkTo}`
  const estUrl = `${proxy}/cn/estimate?${q}&fromAmount=${encodeURIComponent(params.amount)}&flow=${flow}&type=direct`
  const rangeUrl = `${proxy}/cn/range?${q}&flow=${flow}`
  try {
    const [estRes, rangeRes] = await Promise.all([
      fetch(estUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }),
      fetch(rangeUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) }),
    ])

    let estimatedAmount: string | null = null, rateId: string | null = null, validUntil: string | null = null, error: string | null = null
    if (estRes.ok) {
      const j = await estRes.json() as { toAmount?: string | number; rateId?: string | null; validUntil?: string | null }
      estimatedAmount = j.toAmount != null ? String(j.toAmount) : null
      rateId = j.rateId ?? null
      validUntil = j.validUntil ?? null
    } else {
      const j = await estRes.json().catch(() => null) as { message?: string; error?: string } | null
      error = (j && (j.message || j.error)) || `ChangeNOW ${estRes.status}`
    }

    let min: string | null = null, max: string | null = null
    if (rangeRes.ok) {
      const j = await rangeRes.json() as { minAmount?: string | number | null; maxAmount?: string | number | null }
      min = j.minAmount != null ? String(j.minAmount) : null
      max = j.maxAmount != null ? String(j.maxAmount) : null
    }

    return { estimatedAmount, rateId, validUntil, min, max, error }
  } catch (e) {
    return { estimatedAmount: null, rateId: null, validUntil: null, min: null, max: null, error: msg(e) }
  }
}

/** Create the exchange — returns the deposit address (addressFrom) the user funds. */
export async function cnCreateExchange(params: SsCreateParams, config: WalletConfig): Promise<SsExchangeResult> {
  const proxy = proxyBase(config)
  if (!proxy) return errorExchange('ChangeNOW not configured.')
  if (!params.addressTo) return errorExchange('Destination address is required.')

  try {
    const res = await fetch(`${proxy}/cn/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromCurrency: params.tickerFrom,
        toCurrency: params.tickerTo,
        fromNetwork: params.networkFrom,
        toNetwork: params.networkTo,
        fromAmount: params.amount,
        address: params.addressTo,
        extraId: params.extraIdTo ?? '',
        refundAddress: params.userRefundAddress ?? '',
        refundExtraId: params.userRefundExtraId ?? '',
        flow: flowOf(params.fixed),
        type: 'direct',
        rateId: params.rateId ?? undefined,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => null) as { message?: string; error?: string } | null
      return errorExchange((j && (j.message || j.error)) || `ChangeNOW ${res.status}`)
    }
    return normalizeExchange(await res.json(), params)
  } catch (e) {
    return errorExchange(msg(e))
  }
}

/** Poll exchange status by id. */
export async function cnGetStatus(id: string, config: WalletConfig): Promise<SsExchangeResult> {
  const proxy = proxyBase(config)
  if (!proxy) return errorExchange('ChangeNOW not configured.')
  if (!id) return errorExchange('Missing exchange id.')

  try {
    const res = await fetch(`${proxy}/cn/status/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    if (!res.ok) {
      const j = await res.json().catch(() => null) as { message?: string; error?: string } | null
      return errorExchange((j && (j.message || j.error)) || `ChangeNOW ${res.status}`)
    }
    return normalizeExchange(await res.json())
  } catch (e) {
    return errorExchange(msg(e))
  }
}
