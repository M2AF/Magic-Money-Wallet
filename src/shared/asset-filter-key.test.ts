import { describe, it, expect } from 'vitest'
import {
  canonicalTokenKey, canonicalNftKey, legacyWalletKeyToCanonical,
  mergeFilterEntries, sanitizeFilterEntries, entriesToSets, MAX_FILTER_ENTRIES,
  type AssetFilterEntries,
} from './asset-filter-key'

/**
 * The point of these keys is that MagicMoney and ChainLens land on the SAME
 * string for the same asset, so most of what follows asserts a wallet-derived
 * key against a key derived from the shape ChainLens actually serves. Those
 * ChainLens shapes are transcribed from chainlens/backend-server.js — if that
 * file's asset mapping changes, these are the tests that should fail.
 */

describe('canonicalTokenKey', () => {
  it('lowercases the contract so checksummed and lowercase spellings agree', () => {
    // MagicMoney keeps Alchemy's checksummed address; ChainLens lowercases it.
    expect(canonicalTokenKey('ethereum', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'))
      .toBe(canonicalTokenKey('ethereum', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'))
  })

  it('collapses both spellings of the native coin', () => {
    // MagicMoney writes the zero address (token-fetcher NATIVE_ADDR); ChainLens
    // writes the literal string "native".
    expect(canonicalTokenKey('base', '0x0000000000000000000000000000000000000000'))
      .toBe(canonicalTokenKey('base', 'native'))
  })

  it('keeps Bitcoin rune and BRC-20 pseudo-contracts distinct', () => {
    expect(canonicalTokenKey('bitcoin', 'rune:UNCOMMON•GOODS')).toBe('bitcoin:t:rune:uncommon•goods')
    expect(canonicalTokenKey('bitcoin', 'brc20:ordi')).not.toBe(canonicalTokenKey('bitcoin', 'rune:ordi'))
  })

  it('separates tokens from NFTs that share a contract', () => {
    expect(canonicalTokenKey('ethereum', '0xabc')).not.toBe(canonicalNftKey('ethereum', '0xabc', '1'))
  })
})

describe('canonicalNftKey', () => {
  it('matches across products for an EVM NFT', () => {
    // MagicMoney: contractAddress + tokenId fields (token-fetcher mapAlchemyNft).
    const wallet = canonicalNftKey('ethereum', '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D', '1234')
    // ChainLens: id is `${chain}-${contract}-${tokenId}`, so it must be split up
    // before keying — this is what public/asset-filter-key.js does.
    const site = canonicalNftKey('ethereum', '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', '1234')
    expect(wallet).toBe(site)
  })

  it('keys Solana on the mint, which is the only id both products hold', () => {
    // MagicMoney stores the collection address as contractAddress and the mint as
    // tokenId; ChainLens only ever sees the mint. Keying on the collection would
    // mean the two never matched.
    const mint = 'HXFhTU8p8kNwXXvQBBhCEBrqPYq1bnzWgTknXuLzsSNC'
    expect(canonicalNftKey('solana', 'CollECt1onGr0upVa1ue', mint)).toBe(canonicalNftKey('solana', '', mint))
  })

  it('reassembles the Cardano asset unit from policy id + asset name', () => {
    const policy = 'a'.repeat(56)
    const assetName = '4d794e4654'
    // ChainLens carries the whole unit as one string; MagicMoney splits it at 56.
    expect(canonicalNftKey('cardano', policy, assetName)).toBe(canonicalNftKey('cardano', policy + assetName, ''))
  })

  it('keys a Bitcoin inscription on its id, not its display number', () => {
    const insc = 'e317…i0'
    expect(canonicalNftKey('bitcoin', insc, '73')).toBe(canonicalNftKey('bitcoin', insc, '999'))
  })

  it('does not conflate two tokenIds in one collection', () => {
    expect(canonicalNftKey('polygon', '0xabc', '1')).not.toBe(canonicalNftKey('polygon', '0xabc', '2'))
  })
})

describe('legacyWalletKeyToCanonical', () => {
  it('migrates an EVM NFT id', () => {
    expect(legacyWalletKeyToCanonical('ethereum:0xbc4c:1234'))
      .toContain(canonicalNftKey('ethereum', '0xbc4c', '1234'))
  })

  it('migrates an ordinal id without also reading it as a token', () => {
    const keys = legacyWalletKeyToCanonical('bitcoin:ordinal:e317i0')
    expect(keys).toEqual([canonicalNftKey('bitcoin', 'e317i0', '')])
  })

  it('emits both readings of an ambiguous two-part Solana id', () => {
    // `solana:<mint>` was written for BOTH a hidden SPL token and a hidden NFT.
    const keys = legacyWalletKeyToCanonical('solana:So11111111111111111111111111111111111111112')
    expect(keys).toContain(canonicalTokenKey('solana', 'So11111111111111111111111111111111111111112'))
    expect(keys).toContain(canonicalNftKey('solana', '', 'So11111111111111111111111111111111111111112'))
  })

  it('does not invent an NFT reading for a plain EVM token id', () => {
    // Two-part EVM ids were only ever tokens, so the extra key would be noise.
    expect(legacyWalletKeyToCanonical('ethereum:0xa0b8')).toEqual([canonicalTokenKey('ethereum', '0xa0b8')])
  })

  it('keeps a colon-bearing rune contract whole', () => {
    expect(legacyWalletKeyToCanonical('bitcoin:rune:GOODS')).toContain(canonicalTokenKey('bitcoin', 'rune:GOODS'))
  })

  it('ignores junk', () => {
    expect(legacyWalletKeyToCanonical('')).toEqual([])
    expect(legacyWalletKeyToCanonical('nocolon')).toEqual([])
  })
})

describe('mergeFilterEntries', () => {
  it('lets a newer restore beat an older hide (the cross-device restore)', () => {
    const phone: AssetFilterEntries  = { 'ethereum:t:0xa': { s: 'h', t: 100 } }
    const desktop: AssetFilterEntries = { 'ethereum:t:0xa': { s: 'a', t: 200 } }
    expect(mergeFilterEntries(phone, desktop)['ethereum:t:0xa'].s).toBe('a')
    // …and the order the two arrive in must not change the answer.
    expect(mergeFilterEntries(desktop, phone)['ethereum:t:0xa'].s).toBe('a')
  })

  it('does not let a stale push undo a newer hide', () => {
    const stale: AssetFilterEntries = { 'ethereum:t:0xa': { s: 'a', t: 100 } }
    const fresh: AssetFilterEntries = { 'ethereum:t:0xa': { s: 'h', t: 300 } }
    expect(mergeFilterEntries(fresh, stale)['ethereum:t:0xa'].s).toBe('h')
  })

  it('unions keys only one side knows about', () => {
    const merged = mergeFilterEntries({ a: { s: 'h', t: 1 } }, { b: { s: 's', t: 2 } })
    expect(Object.keys(merged).sort()).toEqual(['a', 'b'])
  })

  it('caps growth by dropping the oldest decisions', () => {
    const big: AssetFilterEntries = {}
    for (let i = 0; i < MAX_FILTER_ENTRIES + 50; i++) big[`k${i}`] = { s: 'h', t: i }
    const merged = mergeFilterEntries(big, {})
    expect(Object.keys(merged)).toHaveLength(MAX_FILTER_ENTRIES)
    expect(merged.k0).toBeUndefined()                       // oldest dropped
    expect(merged[`k${MAX_FILTER_ENTRIES + 49}`]).toBeDefined()  // newest kept
  })

  it('survives null and malformed input from the server', () => {
    expect(mergeFilterEntries(null, undefined)).toEqual({})
    const merged = mergeFilterEntries({ ok: { s: 'h', t: 1 } }, { bad: { s: 'x', t: 1 } } as unknown as AssetFilterEntries)
    expect(Object.keys(merged)).toEqual(['ok'])
  })
})

describe('sanitizeFilterEntries', () => {
  it('drops entries that are not decisions', () => {
    const out = sanitizeFilterEntries({
      good: { s: 'h', t: 1 },
      badState: { s: 'nope', t: 1 },
      badTime: { s: 'h', t: 'soon' },
      notAnObject: 'h',
      ['x'.repeat(300)]: { s: 'h', t: 1 },   // absurd key length
    })
    expect(Object.keys(out)).toEqual(['good'])
  })

  it('returns an empty set for non-objects', () => {
    expect(sanitizeFilterEntries(null)).toEqual({})
    expect(sanitizeFilterEntries('nope')).toEqual({})
  })
})

describe('entriesToSets', () => {
  it('splits the three states the dashboard filters with', () => {
    const { hidden, spam, allowed } = entriesToSets({
      h: { s: 'h', t: 1 }, s: { s: 's', t: 1 }, a: { s: 'a', t: 1 },
    })
    expect([...hidden]).toEqual(['h'])
    expect([...spam]).toEqual(['s'])
    expect([...allowed]).toEqual(['a'])
  })
})