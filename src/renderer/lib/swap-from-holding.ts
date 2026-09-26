/**
 * swap-from-holding.ts — the Portfolio → Tokens "Swap" button.
 *
 * Turns a held token into the swap screen's pay token, or says it cannot be
 * one. Identity is the holding's own chain + contract/mint; a native coin maps
 * to the network's shipped native entry (the swap uses the sentinel address,
 * the token list the zero-address placeholder).
 *
 * A holding is swappable from here only when the DEX swap can actually SPEND it:
 *   - its network is a measured swap source (EVM account or Solana),
 *   - it is not in the Abstract Global Wallet (a separate smart account the
 *     swap signer cannot spend — quoting it reverted in simulation),
 *   - its decimals and address are well formed.
 * Everything else gets no button, the same way Send is only offered when the
 * asset can be sent.
 */

import type { SwapChain, SwapToken, WalletToken } from '../types/wallet'
import { SWAP_TOKEN_LISTS } from '../types/swap-tokens'
import { swapCapability } from '../../shared/swap-networks'
import { swapAssetKey, isNativeSwapAddress, isValidSwapAddress } from '../../shared/swap-token-identity'

export function swapTokenFromHolding(t: WalletToken): SwapToken | null {
  if (t.source === 'agw') return null
  const cap = swapCapability(t.chain)
  if (!cap || (cap.signing !== 'evm-eoa' && cap.signing !== 'solana')) return null
  if (cap.sameChain.length === 0 && cap.crossChainSource.length === 0) return null

  const chain = t.chain as SwapChain
  const list = SWAP_TOKEN_LISTS[chain] ?? []
  if (isNativeSwapAddress(chain, t.contractAddress)) return list.find(x => x.isNative) ?? null

  if (!Number.isInteger(t.decimals) || t.decimals < 0) return null
  if (!isValidSwapAddress(chain, t.contractAddress)) return null
  const key = swapAssetKey(chain, t.contractAddress)
  const curated = list.find(x => swapAssetKey(chain, x.address) === key)
  if (curated) return curated
  return {
    chain,
    symbol: t.symbol,
    name: t.name,
    address: t.contractAddress,
    decimals: t.decimals,
    logoUri: t.logoUri,
    isNative: false,
    // Not in the shipped list: the swap treats it as a broad token (stricter checks).
    verified: null,
    source: 'owned',
  }
}
