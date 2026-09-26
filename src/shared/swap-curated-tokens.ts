/**
 * swap-curated-tokens.ts — the hand-verified DEX token set, shared by the UI and
 * the privileged execution gate.
 *
 * This list has two jobs that must never disagree, which is why it lives here
 * rather than in the renderer:
 *
 *   1. UI     — what the picker shows instantly, before any network call, and
 *               what it falls back to when discovery is unavailable.
 *   2. POLICY — `src/main/swap-policy.ts` treats these addresses as the "known"
 *               set. A swap that stays inside it keeps exactly the execution
 *               behaviour it had before dynamic discovery existed; anything
 *               outside it is a BROAD swap and must clear stricter checks
 *               (successful simulation, explicit minimum received) before the
 *               wallet will sign.
 *
 * If the renderer owned this list, a compromised or merely stale renderer could
 * widen the policy set by sending its own entries. The privileged layer reads it
 * from here and never from the message it was handed.
 *
 * Addresses are mainnet and hand-verified. Native assets use the per-ecosystem
 * sentinel the aggregators expect:
 *   EVM     → 0xeee… (0x / 1inch / LI.FI native sentinel)
 *   Solana  → wrapped-SOL mint (Jupiter treats it as native SOL)
 *   Cardano → 'lovelace'
 *
 * Platform-neutral (no Electron, Chrome, Capacitor, node: or DOM).
 */

import { swapAssetKey, CARDANO_USDCX_UNIT } from './swap-token-identity'

export interface CuratedSwapToken {
  chain: string
  symbol: string
  name: string
  address: string
  decimals: number
  isNative: boolean
}

const NATIVE_EVM_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

const t = (
  chain: string, symbol: string, name: string, address: string, decimals: number, isNative = false,
): CuratedSwapToken => ({ chain, symbol, name, address, decimals, isNative })

export const CURATED_SWAP_TOKENS: CuratedSwapToken[] = [
  // ── Ethereum ──
  t('ethereum', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
  t('ethereum', 'USDC', 'USD Coin', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', 6),
  t('ethereum', 'USDT', 'Tether USD', '0xdAC17F958D2ee523a2206206994597C13D831ec7', 6),
  t('ethereum', 'DAI', 'Dai', '0x6B175474E89094C44Da98b954EedeAC495271d0F', 18),
  t('ethereum', 'WETH', 'Wrapped Ether', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', 18),
  // ── Arbitrum ──
  t('arbitrum', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
  t('arbitrum', 'USDC', 'USD Coin', '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', 6),
  t('arbitrum', 'USDT', 'Tether USD', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', 6),
  t('arbitrum', 'ARB', 'Arbitrum', '0x912CE59144191C1204E64559FE8253a0e49E6548', 18),
  // ── Optimism ──
  t('optimism', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
  t('optimism', 'USDC', 'USD Coin', '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', 6),
  t('optimism', 'OP', 'Optimism', '0x4200000000000000000000000000000000000042', 18),
  // ── Base ──
  t('base', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
  t('base', 'USDC', 'USD Coin', '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', 6),
  // ── Polygon ──
  t('polygon', 'POL', 'Polygon', NATIVE_EVM_SENTINEL, 18, true),
  t('polygon', 'USDC', 'USD Coin', '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', 6),
  t('polygon', 'USDT', 'Tether USD', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', 6),
  t('polygon', 'WETH', 'Wrapped Ether', '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', 18),
  // ── Avalanche ──
  t('avalanche', 'AVAX', 'Avalanche', NATIVE_EVM_SENTINEL, 18, true),
  t('avalanche', 'USDC', 'USD Coin', '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', 6),
  t('avalanche', 'USDT', 'Tether USD', '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', 6),
  // ── BNB Chain ──
  t('bsc', 'BNB', 'BNB', NATIVE_EVM_SENTINEL, 18, true),
  t('bsc', 'USDT', 'Tether USD', '0x55d398326f99059fF775485246999027B3197955', 18),
  t('bsc', 'USDC', 'USD Coin', '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', 18),
  // ── Solana ──
  t('solana', 'SOL', 'Solana', 'So11111111111111111111111111111111111111112', 9, true),
  t('solana', 'USDC', 'USD Coin', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', 6),
  t('solana', 'USDT', 'Tether USD', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', 6),
  // ── Monad ──
  t('monad', 'MON', 'Monad', NATIVE_EVM_SENTINEL, 18, true),
  // ── Robinhood Chain ──
  // Robinhood Chain uses ETH for gas and as its native asset. Keep this in the
  // local fallback list so the native pair is available even when /tokens is
  // unavailable or the live catalogue does not return the native sentinel.
  t('robinhood', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
  // ── Other supported EVM networks ──
  t('blast', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
  t('gnosis', 'XDAI', 'Gnosis', NATIVE_EVM_SENTINEL, 18, true),
  t('abstract', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
  t('apechain', 'APE', 'ApeCoin', NATIVE_EVM_SENTINEL, 18, true),
  t('ronin', 'RON', 'Ronin', NATIVE_EVM_SENTINEL, 18, true),
  t('soneium', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
  t('worldchain', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
  t('zora', 'ETH', 'Ethereum', NATIVE_EVM_SENTINEL, 18, true),
  t('hyperevm', 'HYPE', 'Hyperliquid', NATIVE_EVM_SENTINEL, 18, true),
  // ── Cardano (same-chain via Minswap V2 orders; full asset units) ──
  t('cardano', 'ADA', 'Cardano', 'lovelace', 6, true),
  t('cardano', 'MIN', 'Minswap', '29d222ce763455e3d7a09a665ce554f00ac89d2e99a1a83d267170c64d494e', 6),
  // Circle's USDCx: unit from Circle's xReserve domain reference; 6 decimals per
  // the Cardano token registry (as read by token-fetcher) and Minswap's index.
  // Assets named "USDCx" under other policies exist and are NOT this token.
  t('cardano', 'USDCx', 'USDCx (Circle)', CARDANO_USDCX_UNIT.mainnet, 6),
  // ── Bitcoin / Polkadot (exchange flow only) ──
  t('bitcoin', 'BTC', 'Bitcoin', 'bitcoin', 8, true),
  t('polkadot', 'DOT', 'Polkadot', 'polkadot', 10, true),
]

/** Chain-qualified keys for every curated entry, normalized per the chain's rules. */
const CURATED_KEYS = new Set(CURATED_SWAP_TOKENS.map(t => swapAssetKey(t.chain, t.address)))

/**
 * True when this exact contract/mint is one we ship.
 *
 * Address-based on purpose: a symbol is chosen by whoever minted the token, so
 * a "USDC" match proves nothing. Only the address does.
 */
export function isCuratedSwapToken(chain: string, address: string): boolean {
  return CURATED_KEYS.has(swapAssetKey(chain, address))
}

/** The curated entries for one chain, in list order. */
export function curatedTokensForChain(chain: string): CuratedSwapToken[] {
  const c = (chain ?? '').trim().toLowerCase()
  return CURATED_SWAP_TOKENS.filter(t => t.chain === c)
}
