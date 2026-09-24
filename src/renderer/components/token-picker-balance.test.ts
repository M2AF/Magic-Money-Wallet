/**
 * Picker balances: identity by chain-qualified mint/contract, exact raw
 * amounts, and a clear difference between a real zero and an unknown balance.
 */
import { describe, expect, it } from 'vitest'
import { pickerBalance, rememberLogos, cachedLogo } from './TokenPicker'
import type { SwapToken, WalletToken } from '../types/wallet'

const WSOL = 'So11111111111111111111111111111111111111112'
const TILCAYO = 'AyYNfPtftg2zDP4ZbgcoQMggQtwLh4zpfVVmUJs2thto'

const tok = (over: Partial<SwapToken>): SwapToken => ({
  chain: 'solana', symbol: 'X', name: 'X', address: TILCAYO, decimals: 6, logoUri: null, isNative: false, ...over,
})
const held = (over: Partial<WalletToken>): WalletToken => ({
  chain: 'solana', symbol: 'Tilcayo', name: 'Leopardus tilcayo', contractAddress: TILCAYO,
  decimals: 6, balance: '6,242.797004', rawBalance: '6242797004', logoUri: null,
  ...over,
} as WalletToken)

describe('pickerBalance', () => {
  it('native: the loaded balance for that chain; null when not loaded', () => {
    const sol = tok({ symbol: 'SOL', address: WSOL, isNative: true, decimals: 9 })
    expect(pickerBalance(sol, 'solana', [], 0.035417)).toBe(0.035417)
    expect(pickerBalance(sol, 'solana', [], null)).toBeNull()
    expect(pickerBalance(sol, 'solana', [], 0)).toBe(0)     // a real zero is shown as 0
  })

  it('held token: exact rawBalance, not the comma-grouped display string', () => {
    expect(pickerBalance(tok({}), 'solana', [held({})], null)).toBeCloseTo(6242.797004, 6)
  })

  it('a held token at zero is 0, not missing', () => {
    expect(pickerBalance(tok({}), 'solana', [held({ rawBalance: '0', balance: '0' })], null)).toBe(0)
  })

  it('a token with no holding record is unknown (null), not zero', () => {
    expect(pickerBalance(tok({ address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }), 'solana', [held({})], null)).toBeNull()
  })

  it('identity is the mint, never the symbol', () => {
    // Same symbol, different mint: no balance leaks across.
    const imposter = tok({ symbol: 'Tilcayo', address: 'NV2RYH954cTJ3ckFUpvfqaQXU4ARqqDH3562nFSpump' })
    expect(pickerBalance(imposter, 'solana', [held({})], null)).toBeNull()
  })

  it('Solana mints match case-sensitively; holdings on another chain do not count', () => {
    expect(pickerBalance(tok({ address: TILCAYO.toLowerCase() }), 'solana', [held({})], null)).toBeNull()
    expect(pickerBalance(tok({}), 'solana', [held({ chain: 'monad' })], null)).toBeNull()
  })
})

describe('logo cache for the selected tile', () => {
  it('remembers a discovered logo by chain-qualified address', () => {
    rememberLogos('solana', [{ address: WSOL, logoUri: 'https://example.test/sol.png' }])
    expect(cachedLogo('solana', WSOL)).toBe('https://example.test/sol.png')
    // Native SOL's other spelling resolves to the same asset key.
    expect(cachedLogo('solana', '11111111111111111111111111111111')).toBe('https://example.test/sol.png')
    expect(cachedLogo('monad', WSOL)).toBeNull()
  })
})
