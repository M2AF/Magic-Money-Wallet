/**
 * Portfolio → Tokens "Swap": which holdings get the button, and the exact pay
 * token each one opens the swap with (chain + contract/mint, never symbol).
 */
import { describe, it, expect } from 'vitest'
import { swapTokenFromHolding } from './swap-from-holding'
import type { WalletToken } from '../types/wallet'

const EMO_MONAD = '0x81a224f8a62f52bde942dbf23a56df77a10b7777'
const held = (chain: string, contractAddress: string, symbol: string, over: Partial<WalletToken> = {}): WalletToken => ({
  contractAddress, name: symbol, symbol, decimals: 18, balance: '1', rawBalance: '1', usdValue: null,
  nativeEquivalent: null, nativeSymbol: 'ETH', logoUri: null, chain, chainLabel: chain, chainColor: '#000', ...over,
})

describe('swapTokenFromHolding', () => {
  it('Monad EMO opens as itself on Monad', () => {
    expect(swapTokenFromHolding(held('monad', EMO_MONAD, 'EMO', { name: 'emonad' }))).toMatchObject({
      chain: 'monad', address: EMO_MONAD, symbol: 'EMO', decimals: 18, isNative: false,
    })
  })

  it('a native coin maps to the network’s native entry (the swap sentinel)', () => {
    const eth = swapTokenFromHolding(held('ethereum', '0x0000000000000000000000000000000000000000', 'ETH'))
    expect(eth).toMatchObject({ chain: 'ethereum', isNative: true, address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' })
  })

  it('a curated token opens as the shipped (verified) entry', () => {
    const usdc = swapTokenFromHolding(held('base', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', 'USDC', { decimals: 6 }))
    expect(usdc).toMatchObject({ chain: 'base', verified: true, decimals: 6 })
  })

  it('Solana mints keep their exact case', () => {
    const mint = 'AyYNfPtftg2zDP4ZbgcoQMggQtwLh4zpfVVmUJs2thto'
    expect(swapTokenFromHolding(held('solana', mint, 'Tilcayo', { decimals: 9 }))?.address).toBe(mint)
  })

  it('no button for what the swap cannot spend', () => {
    // Abstract Global Wallet: a separate smart account the swap signer cannot spend.
    expect(swapTokenFromHolding(held('abstract', '0x9ebe3a824ca958e4b3da772d2065518f009cba62', 'PENGU', { source: 'agw' }))).toBeNull()
    // Networks with no DEX signing here.
    expect(swapTokenFromHolding(held('cardano', 'asset1night', 'NIGHT', { decimals: 6 }))).toBeNull()
    expect(swapTokenFromHolding(held('bitcoin', 'rune', 'DOG'))).toBeNull()
    // An imported network the swap has no capability for.
    expect(swapTokenFromHolding(held('custom-56', '0x55d398326f99059ff775485246999027b3197955', 'USDT'))).toBeNull()
    // Bad metadata.
    expect(swapTokenFromHolding(held('base', 'not-an-address', 'BAD'))).toBeNull()
    expect(swapTokenFromHolding(held('base', '0x1111111111111111111111111111111111111111', 'NODEC', { decimals: NaN }))).toBeNull()
  })
})
