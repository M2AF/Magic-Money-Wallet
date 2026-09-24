import { describe, expect, it } from 'vitest'
import { CURATED_SWAP_TOKENS } from './swap-curated-tokens'
import { SWAP_NETWORKS } from './swap-networks'

/**
 * The picker renders the curated list before any network call, and falls back
 * to it when /tokens is unavailable. A swappable EVM chain with no native entry
 * here showed an empty picker (or no gas asset) whenever live discovery missed
 * the native sentinel — Robinhood Chain was the reported case.
 */
const NATIVE_EVM_SENTINEL = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

const EXPECTED: Record<string, string> = {
  robinhood: 'ETH', blast: 'ETH', gnosis: 'XDAI', abstract: 'ETH', apechain: 'APE',
  ronin: 'RON', soneium: 'ETH', worldchain: 'ETH', zora: 'ETH', hyperevm: 'HYPE',
}

const nativeOf = (chain: string) => CURATED_SWAP_TOKENS.filter(t => t.chain === chain && t.isNative)

describe('curated native assets for every swappable EVM chain', () => {
  it.each(Object.entries(EXPECTED))('%s has exactly one native %s at the EVM sentinel, 18 decimals', (chain, symbol) => {
    const natives = nativeOf(chain)
    expect(natives).toHaveLength(1)
    expect(natives[0]).toMatchObject({ symbol, address: NATIVE_EVM_SENTINEL, decimals: 18 })
  })

  it('every EVM chain the matrix lets you swap FROM has a native fallback', () => {
    // Arc is excluded on purpose: its gas asset (USDC) has an 18-decimal
    // protocol unit AND a 6-decimal ERC-20 mirror (see swap-networks.ts), so a
    // sentinel entry with a guessed decimals value would misprice it.
    const missing = Object.values(SWAP_NETWORKS)
      .filter(c => c.signing === 'evm-eoa' && c.status !== 'blocked' && c.id !== 'arc')
      .filter(c => c.sameChain.length > 0 || c.crossChainSource.length > 0)
      .filter(c => nativeOf(c.id).length !== 1)
      .map(c => c.id)
    expect(missing).toEqual([])
  })
})
