import { describe, it, expect } from 'vitest'
import {
  isEvmSwapChain, isNativeSwapAddress, normalizeSwapAddress, swapAssetKey,
  isValidSwapAddress, looksLikeSwapAddress, sanitizeDiscoveredToken,
  mergeDiscoveredTokens, rankDiscoveredTokens, isToken2022,
  NATIVE_EVM_SENTINEL, EVM_ZERO_ADDRESS, SOL_NATIVE_MINT, TOKEN_2022_PROGRAM,
  type DiscoveredToken,
} from './swap-token-identity'

/**
 * Addresses below are real mainnet values taken from live provider responses
 * (Jupiter tokens/v2/search, Relay currencies/v2, LI.FI /v1/tokens) so the cases
 * exercised here are the ones discovery actually produces — in particular the
 * five different "BONK" mints and the two spellings of the same Base contract.
 */

const DEGEN_LOWER = '0x4ed4e862860bed51a9570b96d89af5e1b0efefed'   // Relay spelling
const DEGEN_CHECKSUM = '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed' // LI.FI spelling
const BONK_MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'
const BONK_2022 = '6u8SDnYtD9VDwrEvDDTyjVYMfM4i5bk2Ph9qdPHkpump'

describe('address case rules', () => {
  it('folds the two provider spellings of one EVM contract onto one key', () => {
    expect(swapAssetKey('base', DEGEN_CHECKSUM)).toBe(swapAssetKey('base', DEGEN_LOWER))
  })

  it('preserves Solana mint case — lowercasing a mint destroys it', () => {
    expect(normalizeSwapAddress('solana', BONK_MINT)).toBe(BONK_MINT)
    // The regression this guards: the old balance lookup lowercased every address.
    expect(swapAssetKey('solana', BONK_MINT)).not.toBe(swapAssetKey('solana', BONK_MINT.toLowerCase()))
  })

  it('keys the same symbol on two chains separately', () => {
    expect(swapAssetKey('base', DEGEN_LOWER)).not.toBe(swapAssetKey('ethereum', DEGEN_LOWER))
  })
})

describe('native asset spellings', () => {
  it('collapses the zero address (Relay) onto the 0xeee sentinel the aggregators want', () => {
    expect(normalizeSwapAddress('base', EVM_ZERO_ADDRESS)).toBe(NATIVE_EVM_SENTINEL)
    expect(isNativeSwapAddress('base', EVM_ZERO_ADDRESS)).toBe(true)
  })

  it('collapses the LI.FI system-program spelling of native SOL onto wrapped SOL', () => {
    expect(normalizeSwapAddress('solana', '11111111111111111111111111111111')).toBe(SOL_NATIVE_MINT)
  })

  it('does not treat an ordinary mint or contract as native', () => {
    expect(isNativeSwapAddress('solana', BONK_MINT)).toBe(false)
    expect(isNativeSwapAddress('base', DEGEN_LOWER)).toBe(false)
  })
})

describe('isValidSwapAddress', () => {
  it('accepts a 40-hex EVM contract and rejects near-misses', () => {
    expect(isValidSwapAddress('base', DEGEN_CHECKSUM)).toBe(true)
    expect(isValidSwapAddress('base', DEGEN_LOWER.slice(0, -1))).toBe(false)  // 39 nibbles
    expect(isValidSwapAddress('base', 'not-an-address')).toBe(false)
  })

  it('accepts a 32-byte base58 mint and rejects wrong-length base58', () => {
    expect(isValidSwapAddress('solana', BONK_MINT)).toBe(true)
    expect(isValidSwapAddress('solana', 'abc')).toBe(false)
    // Valid base58 characters, but decodes to the wrong byte length.
    expect(isValidSwapAddress('solana', BONK_MINT + 'ZZZZ')).toBe(false)
  })

  it('rejects base58 characters that do not exist in the alphabet', () => {
    expect(isValidSwapAddress('solana', BONK_MINT.replace('D', '0'))).toBe(false)
  })

  it('does not accept an EVM address on Solana or a mint on EVM', () => {
    expect(isValidSwapAddress('solana', DEGEN_LOWER)).toBe(false)
    expect(isValidSwapAddress('base', BONK_MINT)).toBe(false)
  })

  it('drives the paste-an-address branch of the picker', () => {
    expect(looksLikeSwapAddress('base', `  ${DEGEN_CHECKSUM}  `)).toBe(true)
    expect(looksLikeSwapAddress('base', 'degen')).toBe(false)
  })

  it('knows which chains are EVM', () => {
    expect(isEvmSwapChain('base')).toBe(true)
    expect(isEvmSwapChain('solana')).toBe(false)
  })
})

describe('sanitizeDiscoveredToken', () => {
  const ok = { address: DEGEN_LOWER, symbol: 'DEGEN', name: 'Degen', decimals: 18, source: 'relay' }

  it('accepts a well-formed record', () => {
    const t = sanitizeDiscoveredToken(ok, 'base')
    expect(t).toMatchObject({ chain: 'base', symbol: 'DEGEN', decimals: 18, isNative: false })
  })

  it('DROPS a token with missing or junk decimals rather than defaulting to 18', () => {
    // Defaulting here would misprice a 6-decimal token by a factor of 10^12.
    expect(sanitizeDiscoveredToken({ ...ok, decimals: undefined }, 'base')).toBeNull()
    expect(sanitizeDiscoveredToken({ ...ok, decimals: 'eighteen' }, 'base')).toBeNull()
    expect(sanitizeDiscoveredToken({ ...ok, decimals: 1.5 }, 'base')).toBeNull()
    expect(sanitizeDiscoveredToken({ ...ok, decimals: -1 }, 'base')).toBeNull()
  })

  it('keeps decimals of 0 and Bonk\'s 5', () => {
    expect(sanitizeDiscoveredToken({ ...ok, decimals: 0 }, 'base')?.decimals).toBe(0)
    expect(sanitizeDiscoveredToken({ address: BONK_MINT, symbol: 'Bonk', decimals: 5 }, 'solana')?.decimals).toBe(5)
  })

  it('drops a record whose address is invalid for the chain', () => {
    expect(sanitizeDiscoveredToken({ ...ok, address: '0xdead' }, 'base')).toBeNull()
    expect(sanitizeDiscoveredToken(ok, 'solana')).toBeNull()
  })

  it('treats an absent verified flag as UNKNOWN, never as verified', () => {
    // Jupiter omits isVerified entirely rather than sending false.
    expect(sanitizeDiscoveredToken(ok, 'base')?.verified).toBeNull()
    expect(sanitizeDiscoveredToken({ ...ok, verified: false }, 'base')?.verified).toBe(false)
    expect(sanitizeDiscoveredToken({ ...ok, verified: true }, 'base')?.verified).toBe(true)
  })

  it('rejects non-https logo URIs — token metadata is attacker-controlled', () => {
    expect(sanitizeDiscoveredToken({ ...ok, logoUri: 'javascript:alert(1)' }, 'base')?.logoUri).toBeNull()
    expect(sanitizeDiscoveredToken({ ...ok, logoUri: 'data:image/svg+xml,<svg/>' }, 'base')?.logoUri).toBeNull()
    expect(sanitizeDiscoveredToken({ ...ok, logoUri: 'http://x.test/a.png' }, 'base')?.logoUri).toBeNull()
    expect(sanitizeDiscoveredToken({ ...ok, logoUri: 'https://x.test/a.png' }, 'base')?.logoUri).toBe('https://x.test/a.png')
  })

  it('strips control characters and clamps absurdly long names', () => {
    const t = sanitizeDiscoveredToken({ ...ok, symbol: 'DE\u0000GEN', name: 'x'.repeat(500) }, 'base')
    expect(t?.symbol).toBe('DE GEN')
    expect(t?.name.length).toBeLessThanOrEqual(64)
  })

  it('rejects junk input outright', () => {
    expect(sanitizeDiscoveredToken(null, 'base')).toBeNull()
    expect(sanitizeDiscoveredToken('DEGEN', 'base')).toBeNull()
    expect(sanitizeDiscoveredToken(ok, '')).toBeNull()
  })

  it('flags the Token-2022 program, which may levy a transfer fee', () => {
    const t = sanitizeDiscoveredToken(
      { address: BONK_2022, symbol: 'BONK', decimals: 6, tokenProgram: TOKEN_2022_PROGRAM }, 'solana')
    expect(isToken2022(t!)).toBe(true)
  })
})

describe('mergeDiscoveredTokens', () => {
  const relay: DiscoveredToken = {
    chain: 'base', symbol: 'DEGEN', name: 'Degen', address: DEGEN_LOWER, decimals: 18,
    logoUri: null, isNative: false, verified: true, source: 'relay',
  }
  const lifi: DiscoveredToken = {
    chain: 'base', symbol: 'DEGEN', name: 'Degen', address: DEGEN_CHECKSUM, decimals: 18,
    logoUri: 'https://lifi.test/degen.png', isNative: false, verified: null, source: 'lifi',
  }

  it('dedupes the same contract across providers despite different spellings', () => {
    expect(mergeDiscoveredTokens([relay], [lifi])).toHaveLength(1)
  })

  it('fills gaps from the later source without overwriting what the first asserted', () => {
    const [merged] = mergeDiscoveredTokens([relay], [lifi])
    expect(merged.logoUri).toBe('https://lifi.test/degen.png')  // relay had none
    expect(merged.verified).toBe(true)                          // relay's assertion kept
    expect(merged.source).toBe('relay')
  })

  it('keeps the FIRST source\'s decimals so a resolved amount cannot change meaning', () => {
    const [merged] = mergeDiscoveredTokens([relay], [{ ...lifi, decimals: 6 }])
    expect(merged.decimals).toBe(18)
  })

  it('keeps genuinely different mints apart', () => {
    const a: DiscoveredToken = { ...relay, chain: 'solana', address: BONK_MINT, decimals: 5 }
    const b: DiscoveredToken = { ...relay, chain: 'solana', address: BONK_2022, decimals: 6 }
    expect(mergeDiscoveredTokens([a], [b])).toHaveLength(2)
  })
})

describe('rankDiscoveredTokens', () => {
  const mk = (over: Partial<DiscoveredToken>): DiscoveredToken => ({
    chain: 'solana', symbol: 'X', name: 'X', address: BONK_MINT, decimals: 5,
    logoUri: null, isNative: false, verified: null, source: 'jupiter', ...over,
  })

  it('puts an exact address match first', () => {
    const list = [mk({ symbol: 'BONKCAT', address: BONK_2022 }), mk({ symbol: 'Bonk' })]
    expect(rankDiscoveredTokens(list, BONK_MINT)[0].symbol).toBe('Bonk')
  })

  it('prefers an exact symbol match over a prefix match', () => {
    const list = [mk({ symbol: 'BONKCAT', address: BONK_2022 }), mk({ symbol: 'BONK' })]
    expect(rankDiscoveredTokens(list, 'bonk')[0].symbol).toBe('BONK')
  })

  it('ranks verified above unverified but NEVER drops the unverified one', () => {
    const list = [mk({ symbol: 'BONK', address: BONK_2022, verified: null }), mk({ symbol: 'BONK', verified: true })]
    const out = rankDiscoveredTokens(list, 'bonk')
    expect(out).toHaveLength(2)
    expect(out[0].verified).toBe(true)
  })

  it('does not mutate the input list', () => {
    const list = [mk({ symbol: 'A' }), mk({ symbol: 'B', address: BONK_2022 })]
    const before = list.map(t => t.symbol)
    rankDiscoveredTokens(list, 'b')
    expect(list.map(t => t.symbol)).toEqual(before)
  })
})
