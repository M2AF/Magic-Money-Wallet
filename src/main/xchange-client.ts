/**
 * xchange-client.ts — deposit-address exchange aggregator (main process).
 *
 * Thin layer over the two deposit-address providers. SimpleSwap stays PRIMARY and
 * fully unchanged; ChangeNOW is only consulted when SimpleSwap can't price a pair
 * (e.g. Polkadot/DOT) — Gemini's graceful-degradation. Every result is tagged with
 * the `provider` that answered, and that tag is threaded estimate → create → status
 * so the UI creates/polls against the right backend.
 *
 * Nothing here replaces SimpleSwap: for any pair SimpleSwap already handles, the
 * behaviour and provider are identical to before.
 */

import type { WalletConfig } from './secure-store'
import { ssEstimate, ssCreateExchange, ssGetStatus, type SsEstimateParams, type SsEstimateResult, type SsCreateParams, type SsExchangeResult } from './simpleswap-client'
import { cnEstimate, cnCreateExchange, cnGetStatus } from './changenow-client'

export type ExchangeProvider = 'simpleswap' | 'changenow'
export interface XEstimateResult extends SsEstimateResult { provider: ExchangeProvider }
export interface XExchangeResult extends SsExchangeResult { provider: ExchangeProvider }
export interface XCreateParams extends SsCreateParams { provider: ExchangeProvider }

const ok = (r: SsEstimateResult) => !!r.estimatedAmount && !r.error

/** Estimate via SimpleSwap first; fall back to ChangeNOW only if SimpleSwap can't price it. */
export async function xEstimate(params: SsEstimateParams, config: WalletConfig): Promise<XEstimateResult> {
  const ss = await ssEstimate(params, config)
  if (ok(ss)) return { ...ss, provider: 'simpleswap' }

  const cn = await cnEstimate(params, config)
  if (ok(cn)) return { ...cn, provider: 'changenow' }

  // Neither could price it — surface SimpleSwap's message (or ChangeNOW's if SS was silent).
  return ss.error ? { ...ss, provider: 'simpleswap' } : { ...cn, provider: 'changenow' }
}

/** Create the exchange with the provider chosen from the estimate. */
export async function xCreateExchange(params: XCreateParams, config: WalletConfig): Promise<XExchangeResult> {
  if (params.provider === 'changenow') return { ...(await cnCreateExchange(params, config)), provider: 'changenow' }
  return { ...(await ssCreateExchange(params, config)), provider: 'simpleswap' }
}

/** Poll status against the provider that created the exchange. */
export async function xGetStatus(provider: ExchangeProvider, id: string, config: WalletConfig): Promise<XExchangeResult> {
  if (provider === 'changenow') return { ...(await cnGetStatus(id, config)), provider: 'changenow' }
  return { ...(await ssGetStatus(id, config)), provider: 'simpleswap' }
}
