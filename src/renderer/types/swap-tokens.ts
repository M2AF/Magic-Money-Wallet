/**
 * swap-tokens.ts — the curated token set, as the picker sees it.
 *
 * The DATA now lives in `src/shared/swap-curated-tokens.ts` because the
 * privileged execution gate (`src/main/swap-policy.ts`) needs the same set and
 * must not take it from the renderer: a swap that stays inside this list keeps
 * its pre-discovery execution behaviour, and anything outside it is a BROAD swap
 * that has to clear stricter checks before the wallet signs. One list, two
 * readers — a renderer-owned copy could widen the policy set.
 *
 * These are not the whole universe the picker can offer; the proxy /tokens route
 * does real discovery (Jupiter on Solana, Relay/LI.FI on EVM). This list is what
 * renders instantly before any network call, what discovery falls back to, and
 * the only set whose SYMBOLS are trusted for auto-slippage — a discovered symbol
 * is chosen by whoever minted the token.
 */

import { CURATED_SWAP_TOKENS } from '../../shared/swap-curated-tokens'
import type { SwapChain, SwapToken } from './swap'

/** The shared curated data, grouped per chain and typed for the renderer. */
export const SWAP_TOKEN_LISTS: Record<SwapChain, SwapToken[]> = CURATED_SWAP_TOKENS.reduce(
  (acc, t) => {
    const chain = t.chain as SwapChain
    ;(acc[chain] ??= []).push({
      chain,
      symbol: t.symbol,
      name: t.name,
      address: t.address,
      decimals: t.decimals,
      logoUri: null,
      isNative: t.isNative,
      // The curated set IS the wallet's hand-verified list (by address). Without
      // this the picker labelled real USDC/USDT "UNVERIFIED" whenever the
      // curated entry won the de-duplication against a discovered one.
      verified: true,
      source: 'curated',
    })
    return acc
  },
  {} as Record<SwapChain, SwapToken[]>,
)

/**
 * Networks shown in the DEX Swap pickers — only locally-signable sources (EVM +
 * Solana + Monad). Bitcoin/Cardano/Polkadot are intentionally NOT here: until
 * native (PSBT/CBOR/Substrate) signing exists, those swaps live in the Cross-Chain
 * (SimpleSwap/ChangeNOW) tab only.
 */
export const DEX_CHAINS: { id: SwapChain; label: string }[] = [
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'arbitrum', label: 'Arbitrum' },
  { id: 'optimism', label: 'Optimism' },
  { id: 'base', label: 'Base' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'avalanche', label: 'Avalanche' },
  { id: 'bsc', label: 'BNB Chain' },
  { id: 'monad', label: 'Monad' },
  { id: 'solana', label: 'Solana' },
]

/** Address-book key used to source the wallet address per chain. */
export function takerKeyForChain(chain: SwapChain): 'evm' | 'solana' | 'cardano' | 'bitcoin' | 'polkadot' {
  if (chain === 'solana') return 'solana'
  if (chain === 'cardano') return 'cardano'
  if (chain === 'bitcoin') return 'bitcoin'
  if (chain === 'polkadot') return 'polkadot'
  return 'evm'
}

/**
 * True when the wallet can locally sign a swap that SPENDS from this chain
 * (all EVM chains + Solana). Bitcoin/Cardano/Polkadot need PSBT/CBOR/Substrate
 * signing the executor doesn't have, so as a source they route via SimpleSwap.
 */
export function isDexSignableSource(chain: SwapChain): boolean {
  return chain !== 'bitcoin' && chain !== 'cardano' && chain !== 'polkadot'
}
