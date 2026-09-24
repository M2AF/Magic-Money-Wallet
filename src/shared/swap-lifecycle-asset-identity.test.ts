/**
 * Delivered-asset checks are chain-aware.
 *
 * Field report 2026-09-22: 55 MON -> SOL via LI.FI (relaydepository). LI.FI
 * reported DONE/COMPLETED and delivered 11717316 of token
 * `11111111111111111111111111111111` on chain 1151111081099710 — its spelling of
 * NATIVE SOL. The wallet had asked for SOL as the wrapped-SOL mint
 * `So11111111111111111111111111111111111111112`. The destination transaction
 * (2uiseb…WQEZF) shows the recipient's native balance up 0.012026493 SOL,
 * above the 0.011424383 minimum. The literal comparison called that "a
 * different asset". These pin the fix, and that real mismatches still flag.
 */
import { describe, expect, it } from 'vitest'
import { mapProviderStatus, mapStatusForProvider, sameAsset } from './swap-lifecycle'

const WSOL = 'So11111111111111111111111111111111111111112'
const SYSTEM = '11111111111111111111111111111111'
const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const LIFI_SOLANA = '1151111081099710'
const RELAY_SOLANA = '792703809'

// The recorded LI.FI status for the reported swap, reduced to the fields read.
const reported = {
  provider: 'lifi', status: 'DONE', substatus: 'COMPLETED',
  receivedTokenAddress: SYSTEM, receivedTokenChain: LIFI_SOLANA, receivedTokenSymbol: 'SOL',
  receivedTokenDecimals: 9, receivedAmountRaw: '11717316',
  destTxHash: '2uiseb2KmBqfESijNCHH29Kj2oxSEjKsER39KASTaopjKH8DJL4jdaNZK7gHsW2UjaFWpzcMmgBLSimhNL3WQEZF',
}

describe('native SOL spellings are the same asset on Solana', () => {
  it('LI.FI system-program id == wrapped-SOL mint, on LI.FI\'s Solana chain id', () => {
    expect(sameAsset(SYSTEM, WSOL, LIFI_SOLANA)).toBe(true)
    expect(sameAsset(WSOL, SYSTEM, LIFI_SOLANA)).toBe(true)
  })

  it('also on Relay\'s Solana chain id and Rango\'s name', () => {
    expect(sameAsset(SYSTEM, WSOL, RELAY_SOLANA)).toBe(true)
    expect(sameAsset(SYSTEM, WSOL, 'SOLANA')).toBe(true)
  })

  it('the reported swap now maps to COMPLETED, not "delivered a different asset"', () => {
    const r = mapProviderStatus(reported, WSOL)
    expect(r.state).toBe('completed')
    expect(r.delivered?.amountRaw).toBe('11717316')
  })
})

describe('genuinely different assets still flag', () => {
  it('a different Solana mint is a different asset', () => {
    expect(sameAsset(USDC_SOL, WSOL, LIFI_SOLANA)).toBe(false)
    const r = mapProviderStatus({ ...reported, receivedTokenAddress: USDC_SOL, receivedTokenSymbol: 'USDC' }, WSOL)
    expect(r.state).toBe('partial')
    expect(r.message).toMatch(/USDC rather than the token you asked for/)
  })

  it('Solana mints stay case-sensitive', () => {
    expect(sameAsset(USDC_SOL.toLowerCase(), USDC_SOL, LIFI_SOLANA)).toBe(false)
  })

  it('the system-program id is NOT native on an unknown / non-Solana chain', () => {
    // Without a Solana chain id there is no basis to equate the two spellings.
    expect(sameAsset(SYSTEM, WSOL, null)).toBe(false)
    expect(sameAsset(SYSTEM, WSOL, '1')).toBe(false)
  })

  it('EVM: case-insensitive, and both native spellings match; different tokens do not', () => {
    const a = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    expect(sameAsset(a.toLowerCase(), a, '1')).toBe(true)
    expect(sameAsset('0x0000000000000000000000000000000000000000', '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '8453')).toBe(true)
    expect(sameAsset('0xdAC17F958D2ee523a2206206994597C13D831ec7', a, '1')).toBe(false)
  })
})

describe('refund and partial states are unchanged', () => {
  it('DONE/REFUNDED stays refunded even though the refund is "a different asset"', () => {
    const r = mapProviderStatus({
      ...reported, substatus: 'REFUNDED',
      receivedTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', receivedTokenChain: '143', receivedTokenSymbol: 'MON',
    }, WSOL)
    expect(r.state).toBe('refunded')
  })

  it('DONE/PARTIAL stays partial even when the token matches', () => {
    expect(mapProviderStatus({ ...reported, substatus: 'PARTIAL' }, WSOL).state).toBe('partial')
  })

  it('a COMPLETED delivery of the SOLD token on the source chain is still partial', () => {
    const r = mapProviderStatus({
      ...reported, receivedTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', receivedTokenChain: '143', receivedTokenSymbol: 'MON',
    }, WSOL)
    expect(r.state).toBe('partial')
  })

  it('Relay success delivering native SOL is completed through the provider dispatcher', () => {
    const r = mapStatusForProvider('relay', {
      provider: 'relay', status: 'success',
      receivedTokenAddress: SYSTEM, receivedTokenChain: RELAY_SOLANA, receivedTokenSymbol: 'SOL', receivedAmountRaw: '1000',
    }, WSOL)
    expect(r.state).toBe('completed')
  })
})
