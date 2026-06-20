/**
 * swap-tokens.ts — curated, verified token metadata for the DEX swap picker.
 *
 * The proxy /tokens route is generic and returns empty for now, so the picker
 * falls back to this list. Addresses are mainnet, hand-verified. Native assets
 * use the per-ecosystem sentinel the aggregators expect:
 *   EVM    → 0xeee… (0x / 1inch / LI.FI native sentinel)
 *   Solana → wrapped-SOL mint (Jupiter treats it as native SOL)
 *   Cardano→ 'lovelace'
 */

import { NATIVE_EVM_SENTINEL, type SwapChain, type SwapToken } from './swap'

const t = (
  chain: SwapChain, symbol: string, name: string, address: string, decimals: number, isNative = false
): SwapToken => ({ chain, symbol, name, address, decimals, logoUri: null, isNative })

export const SWAP_TOKEN_LISTS: Record<SwapChain, SwapToken[]> = {
  ethereum: [
    t('ethereum', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
    t('ethereum', 'USDC', 'USD Coin', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6),
    t('ethereum', 'USDT', 'Tether USD', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6),
    t('ethereum', 'DAI', 'Dai', '0x6B175474E89094C44Da98b954EedeAC495271d0F', 18),
    t('ethereum', 'WETH', 'Wrapped Ether', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18),
  ],
  arbitrum: [
    t('arbitrum', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
    t('arbitrum', 'USDC', 'USD Coin', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6),
    t('arbitrum', 'USDT', 'Tether USD', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6),
    t('arbitrum', 'ARB', 'Arbitrum', '0x912CE59144191C1204E64559FE8253a0e49E6548', 18),
  ],
  optimism: [
    t('optimism', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
    t('optimism', 'USDC', 'USD Coin', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6),
    t('optimism', 'OP', 'Optimism', '0x4200000000000000000000000000000000000042', 18),
  ],
  base: [
    t('base', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
    t('base', 'USDC', 'USD Coin', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6),
  ],
  polygon: [
    t('polygon', 'POL', 'Polygon', NATIVE_EVM_SENTINEL, 18, true),
    t('polygon', 'USDC', 'USD Coin', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6),
    t('polygon', 'USDT', 'Tether USD', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6),
    t('polygon', 'WETH', 'Wrapped Ether', '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 18),
  ],
  avalanche: [
    t('avalanche', 'AVAX', 'Avalanche', NATIVE_EVM_SENTINEL, 18, true),
    t('avalanche', 'USDC', 'USD Coin', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 6),
    t('avalanche', 'USDT', 'Tether USD', '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', 6),
  ],
  bsc: [
    t('bsc', 'BNB', 'BNB', NATIVE_EVM_SENTINEL, 18, true),
    t('bsc', 'USDT', 'Tether USD', '0x55d398326f99059fF775485246999027B3197955', 18),
    t('bsc', 'USDC', 'USD Coin', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18),
  ],
  solana: [
    t('solana', 'SOL', 'Solana', 'So11111111111111111111111111111111111111112', 9, true),
    t('solana', 'USDC', 'USD Coin', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6),
    t('solana', 'USDT', 'Tether USD', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6),
  ],
  cardano: [
    t('cardano', 'ADA', 'Cardano', 'lovelace', 6, true),
    t('cardano', 'MIN', 'Minswap', '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e', 6),
  ],
}

/** Chains the DEX side can quote (EVM + Solana live; Cardano stubbed). */
export const DEX_CHAINS: { id: SwapChain; label: string }[] = [
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'arbitrum', label: 'Arbitrum' },
  { id: 'optimism', label: 'Optimism' },
  { id: 'base', label: 'Base' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'avalanche', label: 'Avalanche' },
  { id: 'bsc', label: 'BNB Chain' },
  { id: 'solana', label: 'Solana' },
]

/** Address-book key used to source the taker address per chain. */
export function takerKeyForChain(chain: SwapChain): 'evm' | 'solana' | 'cardano' {
  if (chain === 'solana') return 'solana'
  if (chain === 'cardano') return 'cardano'
  return 'evm'
}
