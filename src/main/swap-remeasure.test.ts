/**
 * One-time on-chain re-measure of finished deliveries saved before measurement.
 *
 * The two real records (2026-09-22, 55 and 100 MON -> SOL via LI.FI/Relay) saved
 * LI.FI's quote-derived 11717316 / 21358296 lamports; their destination
 * transactions credited 12026493 / 21919609 to the wallet's Solana address.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import {
  recordMeasuredDelivery, sessionsNeedingMeasurement, type SettledSwapSessionMap, type SettledSwapSession,
} from '../shared/swap-settlement'
import { sameAsset } from '../shared/swap-lifecycle'
import { setSwapSessionPersistence, reconcileSessions, __resetSwapSessions } from './swap-sessions'
import type { SwapSigningIdentity } from './swap-intent'

const EVM = '0x01faf6dfc230d755141d84d7cb980dd68f5efe13'
const SOL = '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d'
const WSOL = 'So11111111111111111111111111111111111111112'
const SYSTEM = '11111111111111111111111111111111'
const same = (d: string, e: string, c: string) => sameAsset(d, e, c)

function record(over: Partial<SettledSwapSession> = {}): SettledSwapSession {
  return {
    id: 'mon-55', createdAt: Date.now() - 3_600_000, updatedAt: Date.now() - 3_600_000, walletId: `${EVM}|${SOL}`, accountIndex: 0, environment: 'mainnet',
    provider: 'lifi', fromChain: 'monad', toChain: 'solana',
    fromTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', fromTokenSymbol: 'MON', fromTokenDecimals: 18,
    toTokenAddress: WSOL, toTokenSymbol: 'SOL', toTokenDecimals: 9,
    sellAmountRaw: '55000000000000000000', expectedBuyAmountRaw: '12017756', minBuyAmountRaw: '11424383',
    recipient: SOL, isCrossChain: true, bridgeTool: 'relaydepository', providerRequestId: null,
    approvalTxHash: null, sourceTxHash: '0x4974297741e7087b688c26e00625ea1cfb4096fd46b709f3370d51dace5b3b2e',
    sourceExplorerUrl: null, sourceTxState: 'confirmed', sourceNonce: 5,
    state: 'completed', message: null, providerStatus: 'DONE', providerSubstatus: 'COMPLETED',
    deliveredTokenAddress: SYSTEM, deliveredTokenSymbol: 'SOL', deliveredTokenDecimals: 9,
    deliveredAmountRaw: '11717316',
    destTxHash: '2uiseb2KmBqfESijNCHH29Kj2oxSEjKsER39KASTaopjKH8DJL4jdaNZK7gHsW2UjaFWpzcMmgBLSimhNL3WQEZF',
    destExplorerUrl: null, lastPolledAt: 1, fee: null,
    ...over,
  } as SettledSwapSession
}

describe('recordMeasuredDelivery', () => {
  it('replaces LI.FI\'s derived figure with the measured one, keeping the provider figure', () => {
    const out = recordMeasuredDelivery({ 'mon-55': record() }, 'mon-55', '12026493', null, 2)['mon-55']
    expect(out.deliveredAmountRaw).toBe('12026493')
    expect(out.deliveredAmountSource).toBe('onchain')
    expect(out.providerReportedAmountRaw).toBe('11717316')
    expect(out.state).toBe('completed')
  })

  it('is idempotent — the same measurement twice changes nothing', () => {
    const once = recordMeasuredDelivery({ 'mon-55': record() }, 'mon-55', '12026493', null, 2)
    expect(recordMeasuredDelivery(once, 'mon-55', '12026493', null, 3)).toBe(once)
  })

  it('re-runs the approved minimum on the MEASURED amount: a real shortfall becomes partial', () => {
    const out = recordMeasuredDelivery({ 'mon-55': record() }, 'mon-55', '11000000', null, 2)['mon-55']
    expect(out.state).toBe('partial')
    expect(out.message).toMatch(/less than the minimum you approved/)
  })

  it('never touches a refund or a failure', () => {
    for (const state of ['refunded', 'failed', 'refund-pending'] as const) {
      const map: SettledSwapSessionMap = { r: record({ id: 'r', state }) }
      expect(recordMeasuredDelivery(map, 'r', '1', null)).toBe(map)
    }
  })
})

describe('sessionsNeedingMeasurement — only the records it should touch', () => {
  it('selects the reported record (native SOL spelled as the system program)', () => {
    expect(sessionsNeedingMeasurement({ 'mon-55': record() }, same).map(s => s.id)).toEqual(['mon-55'])
  })
  it('skips measured, refunded, wrong-asset, same-chain and hash-less records', () => {
    const map: SettledSwapSessionMap = {
      measured: record({ id: 'measured', deliveredAmountSource: 'onchain' }),
      refund: record({ id: 'refund', state: 'refunded' }),
      wrong: record({ id: 'wrong', deliveredTokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }),
      same: record({ id: 'same', isCrossChain: false }),
      nohash: record({ id: 'nohash', destTxHash: null }),
    }
    expect(sessionsNeedingMeasurement(map, same)).toEqual([])
  })
})

describe('reconcileSessions re-measure', () => {
  const me: SwapSigningIdentity = { walletId: `${EVM}|${SOL}`, accountIndex: 0, environment: 'mainnet', sourceAddress: EVM, destinationAddress: EVM }
  let stored: Record<string, SettledSwapSession> = {}
  beforeEach(() => {
    __resetSwapSessions()
    stored = {
      'mon-55': record(),
      'mon-100': record({ id: 'mon-100', deliveredAmountRaw: '21358296', minBuyAmountRaw: '20824338', destTxHash: '2jmokd' }),
      // Delivered to someone else: must not be measured or changed.
      'other-recipient': record({ id: 'other-recipient', recipient: 'SomeoneElse11111111111111111111111111111111' }),
      // Another account's record.
      'other-account': record({ id: 'other-account', accountIndex: 1 }),
    }
    setSwapSessionPersistence({ load: async () => stored as never, save: async (v: unknown) => { stored = v as never } })
  })

  it('corrects both reported records once, and nothing else', async () => {
    const measure = vi.fn(async (s: SettledSwapSession) => ({ amountRaw: s.id === 'mon-55' ? '12026493' : '21919609' }))
    await reconcileSessions(me, vi.fn(), measure)
    expect(measure.mock.calls.map(c => c[0].id).sort()).toEqual(['mon-100', 'mon-55'])
    expect(stored['mon-55']).toMatchObject({ deliveredAmountRaw: '12026493', deliveredAmountSource: 'onchain', providerReportedAmountRaw: '11717316', state: 'completed' })
    expect(stored['mon-100']).toMatchObject({ deliveredAmountRaw: '21919609', deliveredAmountSource: 'onchain', providerReportedAmountRaw: '21358296' })
    expect(stored['other-recipient'].deliveredAmountRaw).toBe('11717316')
    expect(stored['other-account'].deliveredAmountRaw).toBe('11717316')

    // Idempotent across runs: nothing left to measure.
    measure.mockClear()
    await reconcileSessions(me, vi.fn(), measure)
    expect(measure).not.toHaveBeenCalled()
  })

  it('an unmeasurable delivery keeps its saved figure', async () => {
    await reconcileSessions(me, vi.fn(), vi.fn(async () => null))
    expect(stored['mon-55']).toMatchObject({ deliveredAmountRaw: '11717316' })
    expect(stored['mon-55'].deliveredAmountSource).toBeUndefined()
  })
})
