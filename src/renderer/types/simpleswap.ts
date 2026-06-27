/**
 * simpleswap.ts — SimpleSwap (cross-chain instant exchange) types.
 *
 * Architecturally separate from the DEX swap flow — SimpleSwap is an off-chain
 * exchange (deposit-address model, no local tx signing). Verified against the
 * live SimpleSwap v3 API:
 *   - auth: `x-api-key` header
 *   - assets are identified by ticker + network (both lowercase)
 *   - estimate → { estimatedAmount, rateId, validUntil }; ranges → { min, max }
 */

export type SimpleSwapRateType = 'fixed' | 'floating'

// SimpleSwap exchange lifecycle states (terminal: finished | failed | refunded | expired)
export type SimpleSwapStatus =
  | 'waiting' | 'confirming' | 'exchanging' | 'sending'
  | 'finished' | 'failed' | 'refunded' | 'expired' | 'verifying'

/** A selectable asset: SimpleSwap keys assets by (ticker, network). */
export interface SimpleSwapAsset {
  ticker: string    // e.g. 'sol', 'btc', 'usdc'
  network: string   // e.g. 'sol', 'btc', 'eth'
  label: string     // e.g. 'SOL'
  name: string      // e.g. 'Solana'
  /** Wallet address book key used to auto-fill destination/refund (null = not held). */
  addrKey: 'evm' | 'solana' | 'cardano' | 'bitcoin' | 'polkadot' | null
}

export interface SsEstimateParams {
  tickerFrom: string
  networkFrom: string
  tickerTo: string
  networkTo: string
  amount: string
  fixed: boolean
}

/** Combined estimate + ranges (the client fetches both in one round-trip). */
export interface SsEstimate {
  estimatedAmount: string | null
  rateId: string | null         // present only for fixed-rate — pass back to /exchanges to lock it
  validUntil: string | null     // ISO timestamp — fixed-rate quote TTL
  min: string | null            // minimum sendable amount
  max: string | null            // maximum (null = no max)
  error: string | null
}

export interface SsCreateParams {
  tickerFrom: string
  networkFrom: string
  tickerTo: string
  networkTo: string
  amount: string
  fixed: boolean
  addressTo: string                 // destination — required
  extraIdTo?: string                // memo/tag for XRP/XLM/etc.
  userRefundAddress?: string        // recommended
  userRefundExtraId?: string
  rateId?: string | null            // from a fixed estimate, to lock the rate
}

export interface SsExchange {
  id: string
  status: SimpleSwapStatus | string
  tickerFrom: string
  tickerTo: string
  networkFrom: string
  networkTo: string
  amountFrom: string
  amountTo: string
  addressFrom: string               // ← THE DEPOSIT ADDRESS the user sends to
  addressTo: string
  extraIdFrom: string | null        // memo/tag the user must include when sending
  rateType: SimpleSwapRateType
  validUntil: string | null
  createdAt: string | null
  error: string | null
  provider?: ExchangeProvider       // which deposit-address provider answered
}

// ── Deposit-address exchange aggregator (SimpleSwap primary, ChangeNOW fallback) ──
// Additive layer: SimpleSwap stays the default; ChangeNOW only answers pairs
// SimpleSwap can't (e.g. Polkadot/DOT). The provider is threaded estimate→create→status.
export type ExchangeProvider = 'simpleswap' | 'changenow'

/** Estimate result, tagged with the provider that produced it. */
export interface XchangeEstimate extends SsEstimate {
  provider: ExchangeProvider
}

/** Create-exchange params carry the provider chosen from the estimate. */
export interface XchangeCreateParams extends SsCreateParams {
  provider: ExchangeProvider
}
