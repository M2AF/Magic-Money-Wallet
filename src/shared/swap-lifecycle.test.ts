import { describe, expect, it } from 'vitest'
import {
  mapProviderStatus, mapRangoStatus, isTerminalSwapState, isSwapSuccess,
  type RawProviderStatus,
} from './swap-lifecycle'

/**
 * The bug these tests exist for: the Worker mapped any `DONE` to `done` and
 * dropped the substatus, so a REFUND and a PARTIAL delivery both rendered as
 * "✓ Bridge complete — Received <the token you asked for>". The user was told a
 * swap succeeded while their money had come back as the token they sold.
 */

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const DEGEN_BASE = '0x4ed4e862860bed51a9570b96d89af5e1b0efefed'
const WETH_ETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'

const raw = (over: Partial<RawProviderStatus> = {}): RawProviderStatus => ({
  provider: 'lifi', status: 'DONE', substatus: 'COMPLETED',
  receivedAmountRaw: '1000000', receivedTokenAddress: USDC_BASE,
  receivedTokenSymbol: 'USDC', receivedTokenDecimals: 6,
  destTxHash: '0xabc', destExplorerUrl: 'https://basescan.org/tx/0xabc',
  ...over,
})

describe('LI.FI DONE is three different outcomes', () => {
  it('DONE/COMPLETED with the expected token is the only success', () => {
    const r = mapProviderStatus(raw(), USDC_BASE)
    expect(r.state).toBe('completed')
    expect(isSwapSuccess(r.state)).toBe(true)
  })

  it('DONE/REFUNDED is NOT success — the swap did not happen', () => {
    const r = mapProviderStatus(raw({
      substatus: 'REFUNDED', receivedTokenAddress: WETH_ETH, receivedTokenSymbol: 'WETH',
    }), USDC_BASE)
    expect(r.state).toBe('refunded')
    expect(isSwapSuccess(r.state)).toBe(false)
    expect(r.message).toMatch(/original funds were returned/i)
  })

  it('DONE/PARTIAL is NOT success and names what actually arrived', () => {
    const r = mapProviderStatus(raw({
      substatus: 'PARTIAL', receivedTokenAddress: USDC_BASE, receivedTokenSymbol: 'USDC',
    }), DEGEN_BASE)
    expect(r.state).toBe('partial')
    expect(isSwapSuccess(r.state)).toBe(false)
    expect(r.message).toMatch(/USDC/)
  })

  it('reports the DELIVERED asset, not the requested one', () => {
    const r = mapProviderStatus(raw({
      substatus: 'REFUNDED', receivedTokenAddress: WETH_ETH,
      receivedTokenSymbol: 'WETH', receivedTokenDecimals: 18, receivedAmountRaw: '5000000000000000',
    }), USDC_BASE)
    expect(r.delivered).toMatchObject({ symbol: 'WETH', decimals: 18, amountRaw: '5000000000000000' })
  })
})

describe('delivered-asset check catches a mislabelled COMPLETED', () => {
  it('downgrades DONE/COMPLETED to partial when the wrong token arrived', () => {
    // A provider saying DONE is not evidence about WHICH token landed.
    const r = mapProviderStatus(raw({ receivedTokenAddress: USDC_BASE, receivedTokenSymbol: 'USDC' }), DEGEN_BASE)
    expect(r.state).toBe('partial')
  })

  it('accepts a checksum/lowercase difference on EVM as the same asset', () => {
    const r = mapProviderStatus(raw({ receivedTokenAddress: USDC_BASE.toLowerCase() }), USDC_BASE)
    expect(r.state).toBe('completed')
  })

  it('treats Solana mints case-sensitively', () => {
    const ok = mapProviderStatus(raw({ receivedTokenAddress: BONK }), BONK)
    expect(ok.state).toBe('completed')
    const bad = mapProviderStatus(raw({ receivedTokenAddress: BONK.toLowerCase() }), BONK)
    expect(bad.state).toBe('partial')
  })

  it('does not invent a mismatch when the provider reported no token', () => {
    const r = mapProviderStatus(raw({ receivedTokenAddress: null, receivedAmountRaw: null }), USDC_BASE)
    expect(r.state).toBe('completed')
  })
})

describe('in-flight and failure states', () => {
  it('PENDING with a bridging substatus is bridging, not done', () => {
    for (const sub of ['WAIT_SOURCE_CONFIRMATIONS', 'WAIT_DESTINATION_TRANSACTION', 'CHAIN_NOT_AVAILABLE']) {
      expect(mapProviderStatus(raw({ status: 'PENDING', substatus: sub }), USDC_BASE).state).toBe('bridging')
    }
  })

  it('REFUND_IN_PROGRESS is refund-pending under BOTH pending and failed', () => {
    expect(mapProviderStatus(raw({ status: 'PENDING', substatus: 'REFUND_IN_PROGRESS' }), USDC_BASE).state)
      .toBe('refund-pending')
    expect(mapProviderStatus(raw({ status: 'FAILED', substatus: 'REFUND_IN_PROGRESS' }), USDC_BASE).state)
      .toBe('refund-pending')
  })

  it('NOT_PROCESSABLE_REFUND_NEEDED is refund-pending, not a plain failure', () => {
    expect(mapProviderStatus(raw({ status: 'FAILED', substatus: 'NOT_PROCESSABLE_REFUND_NEEDED' }), USDC_BASE).state)
      .toBe('refund-pending')
  })

  it('FAILED without a refund signal is failed', () => {
    expect(mapProviderStatus(raw({ status: 'FAILED', substatus: 'UNKNOWN_ERROR' }), USDC_BASE).state).toBe('failed')
  })

  it('an unindexed hash is UNKNOWN, never failed', () => {
    // A fresh source transaction routinely 404s while the bridge indexes it.
    expect(mapProviderStatus(raw({ notFound: true }), USDC_BASE).state).toBe('unknown')
    expect(mapProviderStatus(raw({ status: 'NOT_FOUND' }), USDC_BASE).state).toBe('unknown')
  })

  it('an unrecognised status is unknown rather than assumed', () => {
    expect(mapProviderStatus(raw({ status: 'SOMETHING_NEW' }), USDC_BASE).state).toBe('unknown')
    expect(mapProviderStatus(raw({ status: null, substatus: null }), USDC_BASE).state).toBe('unknown')
  })

  it('keeps the provider vocabulary verbatim for support', () => {
    const r = mapProviderStatus(raw({ status: 'DONE', substatus: 'PARTIAL' }), DEGEN_BASE)
    expect(r.providerStatus).toBe('DONE')
    expect(r.providerSubstatus).toBe('PARTIAL')
  })
})

describe('Rango signals a refund through its OUTPUT TYPE, not its status', () => {
  it('REVERTED_TO_INPUT on a "success" status is a REFUND', () => {
    // Read literally, Rango reports success here because the refund succeeded.
    const r = mapRangoStatus({
      provider: 'rango', status: 'success', substatus: 'REVERTED_TO_INPUT',
      receivedTokenAddress: WETH_ETH, receivedTokenSymbol: 'WETH', receivedAmountRaw: '1000',
    }, USDC_BASE)
    expect(r.state).toBe('refunded')
    expect(isSwapSuccess(r.state)).toBe(false)
  })

  it('MIDDLE_ASSET is a partial delivery', () => {
    const r = mapRangoStatus({
      provider: 'rango', status: 'success', substatus: 'MIDDLE_ASSET',
      receivedTokenAddress: USDC_BASE, receivedTokenSymbol: 'USDC',
    }, DEGEN_BASE)
    expect(r.state).toBe('partial')
  })

  it('a clean Rango success with the expected asset completes', () => {
    const r = mapRangoStatus({
      provider: 'rango', status: 'success', substatus: 'OUTPUT',
      receivedTokenAddress: USDC_BASE, receivedTokenSymbol: 'USDC',
    }, USDC_BASE)
    expect(r.state).toBe('completed')
  })

  it('running is bridging and failed is failed', () => {
    expect(mapRangoStatus({ status: 'running' }, USDC_BASE).state).toBe('bridging')
    expect(mapRangoStatus({ status: 'failed' }, USDC_BASE).state).toBe('failed')
  })
})

describe('state predicates', () => {
  it('treats partial and refunded as terminal but not successful', () => {
    for (const s of ['completed', 'partial', 'refunded', 'failed'] as const) {
      expect(isTerminalSwapState(s)).toBe(true)
    }
    for (const s of ['bridging', 'refund-pending', 'unknown', 'source-submitted'] as const) {
      expect(isTerminalSwapState(s)).toBe(false)
    }
    expect(isSwapSuccess('partial')).toBe(false)
    expect(isSwapSuccess('refunded')).toBe(false)
    expect(isSwapSuccess('completed')).toBe(true)
  })
})
