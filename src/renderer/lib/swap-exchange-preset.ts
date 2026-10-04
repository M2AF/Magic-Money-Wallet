import type { SwapToken } from '../types/wallet'
import { CURATED_SWAP_TOKENS } from '../../shared/swap-curated-tokens'
import { swapAssetKey } from '../../shared/swap-token-identity'
import { findSsAsset } from '../types/simpleswap-assets'

export interface SwapExchangePreset { fromKey: string; toKey: string; amount: string }

// Only exact curated identities supported by the existing exchange catalog.
// In particular USDCx is not interchangeable with ADA or Ethereum USDC.
const KEYS: Record<string, string> = {
  'cardano:ADA': 'ada:ada', 'solana:SOL': 'sol:sol',
  'ethereum:ETH': 'eth:eth', 'ethereum:USDC': 'usdc:eth', 'ethereum:USDT': 'usdt:eth',
  'bitcoin:BTC': 'btc:btc', 'polkadot:DOT': 'dot:dot',
  'bsc:BNB': 'bnb:bsc', 'polygon:POL': 'pol:polygon', 'avalanche:AVAX': 'avax:avaxc',
}
function exchangeKey(token: SwapToken | undefined): string | null {
  if (!token) return null
  const identity = swapAssetKey(token.chain, token.address)
  const known = CURATED_SWAP_TOKENS.find(t => swapAssetKey(t.chain, t.address) === identity)
  if (!known || known.decimals !== token.decimals) return null
  const key = KEYS[`${known.chain}:${known.symbol}`]
  return key && findSsAsset(key) ? key : null
}
export function swapExchangePreset(
  from: SwapToken | undefined, to: SwapToken | undefined, amount: string,
): SwapExchangePreset | null {
  const fromKey = exchangeKey(from), toKey = exchangeKey(to)
  if (!fromKey || !toKey || fromKey === toKey) return null
  return { fromKey, toKey, amount: /^\d*\.?\d*$/.test(amount) ? amount : '' }
}
