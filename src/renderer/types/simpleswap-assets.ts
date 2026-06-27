/**
 * simpleswap-assets.ts — curated asset catalog for the cross-chain (deposit-address)
 * exchange UI. Routed through the `xchange` aggregator: SimpleSwap is tried first,
 * ChangeNOW answers pairs SimpleSwap can't (e.g. Polkadot/DOT). Both providers key
 * assets by (ticker, network), lowercase. `addrKey` maps to the wallet's address
 * book for auto-filling destination/refund (null = not held, user pastes manually).
 */

import type { SimpleSwapAsset } from './simpleswap'

export const SS_ASSETS: SimpleSwapAsset[] = [
  { ticker: 'btc',  network: 'btc',      label: 'BTC',  name: 'Bitcoin',   addrKey: 'bitcoin' },
  { ticker: 'eth',  network: 'eth',      label: 'ETH',  name: 'Ethereum',  addrKey: 'evm' },
  { ticker: 'sol',  network: 'sol',      label: 'SOL',  name: 'Solana',    addrKey: 'solana' },
  { ticker: 'ada',  network: 'ada',      label: 'ADA',  name: 'Cardano',   addrKey: 'cardano' },
  { ticker: 'dot',  network: 'dot',      label: 'DOT',  name: 'Polkadot',  addrKey: 'polkadot' },
  { ticker: 'usdc', network: 'eth',      label: 'USDC', name: 'USD Coin (ERC-20)', addrKey: 'evm' },
  { ticker: 'usdt', network: 'eth',      label: 'USDT', name: 'Tether (ERC-20)',   addrKey: 'evm' },
  { ticker: 'bnb',  network: 'bsc',      label: 'BNB',  name: 'BNB Chain', addrKey: 'evm' },
  { ticker: 'pol',  network: 'polygon',  label: 'POL',  name: 'Polygon',   addrKey: 'evm' },
  { ticker: 'avax', network: 'avaxc',    label: 'AVAX', name: 'Avalanche', addrKey: 'evm' },
  { ticker: 'ltc',  network: 'ltc',      label: 'LTC',  name: 'Litecoin',  addrKey: null },
  { ticker: 'doge', network: 'doge',     label: 'DOGE', name: 'Dogecoin',  addrKey: null },
  { ticker: 'xmr',  network: 'xmr',      label: 'XMR',  name: 'Monero',    addrKey: null },
  { ticker: 'trx',  network: 'trx',      label: 'TRX',  name: 'Tron',      addrKey: null },
  { ticker: 'xrp',  network: 'xrp',      label: 'XRP',  name: 'XRP',       addrKey: null },
]

/** Stable key for selects/lookups. */
export const ssKey = (a: { ticker: string; network: string }) => `${a.ticker}:${a.network}`

export function findSsAsset(key: string): SimpleSwapAsset | undefined {
  return SS_ASSETS.find(a => ssKey(a) === key)
}

/** Chains reachable by the on-chain DEX side (so the toggle can suggest Cross-Chain otherwise). */
const DEX_REACHABLE_NETWORKS = new Set(['eth', 'bsc', 'polygon', 'avaxc', 'sol', 'arbitrum', 'optimism', 'base'])

/** True if a SimpleSwap asset can NOT be reached by the DEX (e.g. BTC, LTC, XMR). */
export function requiresCrossChain(a: { network: string }): boolean {
  return !DEX_REACHABLE_NETWORKS.has(a.network)
}

// SimpleSwap native coins → the wallet's balance chain id (from chain-config / AllBalances).
// Only native coins the wallet actually tracks are mapped; tokens (usdc/usdt) and
// chains we don't hold (ltc/doge/xmr/trx/xrp) return null → no balance shown.
const SS_BALANCE_CHAIN: Record<string, string> = {
  'btc:btc': 'bitcoin',
  'eth:eth': 'ethereum',
  'sol:sol': 'solana',
  'ada:ada': 'cardano',
  'dot:dot': 'polkadot',
  'bnb:bsc': 'bsc',
  'pol:polygon': 'polygon',
  'avax:avaxc': 'avalanche',
}

/** The wallet balance-chain id for a SimpleSwap asset, or null if not held/known. */
export function ssBalanceChain(a: { ticker: string; network: string }): string | null {
  return SS_BALANCE_CHAIN[ssKey(a)] ?? null
}
