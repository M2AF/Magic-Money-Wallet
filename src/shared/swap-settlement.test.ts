/**
 * swap-settlement.test.ts — the accounting rules that decide whether Magic Money
 * was actually paid, and the ones that stop it being paid twice.
 *
 * These are the cases where a naive implementation quietly produces a wrong
 * revenue number: an approval counted as a swap, a retried poll counted twice, a
 * refund erasing a fee that really was taken, a broadcast counted before it
 * confirmed.
 */

import { describe, it, expect } from 'vitest'
import {
  openSwapSession, recordPreSwapTx, recordSwapBroadcast, recordUncertainBroadcast,
  recordSourceReceipt, applyStatusReport, sessionsNeedingReconcile, summarizeFeeRevenue,
  type SettledSwapSessionMap, type OpenSessionInput,
} from './swap-settlement'
import { mapProviderStatus } from './swap-lifecycle'
import {
  APP_FEE_BPS, SWAP_FEE_POLICY_VERSION, SWAP_FEE_BENEFICIARIES, feeFreeRecord,
  type AppFeeRecord,
} from './swap-fee-policy'
import { sanitizeSwapSessions } from './swap-session'

const T0 = 1_800_000_000_000
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

const feeRecord = (over: Partial<AppFeeRecord> = {}): AppFeeRecord => ({
  policyVersion: SWAP_FEE_POLICY_VERSION,
  provider: 'lifi',
  requestedBps: APP_FEE_BPS,
  appliedBps: APP_FEE_BPS,
  base: 'input',
  chain: 'ethereum',
  tokenAddress: WETH,
  tokenSymbol: 'WETH',
  tokenDecimals: 18,
  amountRaw: '10000000000000000',
  recipient: SWAP_FEE_BENEFICIARIES.lifiIntegrator,
  recipientKind: 'registered-integrator',
  collection: 'in-swap',
  providerSharePct: null,
  verification: 'applied-verified',
  evidence: [],
  ...over,
})

const input = (over: Partial<OpenSessionInput> = {}): OpenSessionInput => ({
  id: 'intent-1',
  walletId: 'wallet-a',
  accountIndex: 0,
  environment: 'mainnet',
  provider: 'lifi',
  fromChain: 'ethereum',
  toChain: 'ethereum',
  fromTokenAddress: WETH, fromTokenSymbol: 'WETH', fromTokenDecimals: 18,
  toTokenAddress: USDC, toTokenSymbol: 'USDC', toTokenDecimals: 6,
  sellAmountRaw: '1000000000000000000',
  expectedBuyAmountRaw: '2600000000',
  minBuyAmountRaw: '2587000000',
  recipient: '0x5555555555555555555555555555555555555555',
  isCrossChain: false,
  bridgeTool: null,
  providerRequestId: null,
  appFee: feeRecord(),
  now: T0,
  ...over,
})

const open = (over: Partial<OpenSessionInput> = {}): SettledSwapSessionMap =>
  openSwapSession({}, input(over))

describe('charge once per user swap', () => {
  it('opening the same intent twice does not create a second fee-bearing session', () => {
    let map = open()
    map = openSwapSession(map, input())
    map = openSwapSession(map, input())
    expect(Object.keys(map)).toHaveLength(1)
  })

  it('an approval is not a fee event', () => {
    let map = open()
    map = recordPreSwapTx(map, 'intent-1', '0xapproval')
    expect(map['intent-1'].approvalTxHash).toBe('0xapproval')
    // Still not executed: nothing carrying the fee has been broadcast.
    expect(map['intent-1'].fee?.state).toBe('not-executed')
    expect(summarizeFeeRevenue(map)).toMatchObject({ collected: 0, notCollected: 1 })
  })

  it('a zero-reset, an approval and a permit all attach to the one session', () => {
    let map = open()
    map = recordPreSwapTx(map, 'intent-1', '0xreset')
    map = recordPreSwapTx(map, 'intent-1', '0xapproval')
    map = recordPreSwapTx(map, 'intent-1', '0xpermit')
    expect(Object.keys(map)).toHaveLength(1)
    expect(map['intent-1'].fee?.state).toBe('not-executed')
  })

  it('the same broadcast observed twice applies once', () => {
    let map = open()
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xswap', now: T0 + 1 })
    const first = map['intent-1'].fee!.appliedEvents.length
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xswap', now: T0 + 2 })
    expect(map['intent-1'].fee!.appliedEvents).toHaveLength(first)
  })

  it('the same receipt replayed after a restart applies once', () => {
    let map = open()
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xswap', now: T0 + 1 })
    map = recordSourceReceipt(map, 'intent-1', { txHash: '0xswap', success: true, now: T0 + 2 })
    const events = map['intent-1'].fee!.appliedEvents.length
    map = recordSourceReceipt(map, 'intent-1', { txHash: '0xswap', success: true, now: T0 + 9 })
    expect(map['intent-1'].fee!.appliedEvents).toHaveLength(events)
    expect(map['intent-1'].fee!.state).toBe('collected-onchain')
  })
})

describe('a broadcast is not a payment', () => {
  it('stays pending until the source transaction confirms', () => {
    let map = open()
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xswap' })
    expect(map['intent-1'].fee?.state).toBe('submitted')
    expect(summarizeFeeRevenue(map)).toMatchObject({ collected: 0, pending: 1 })
  })

  it('becomes collected only on a successful receipt', () => {
    let map = open()
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xswap' })
    map = recordSourceReceipt(map, 'intent-1', { txHash: '0xswap', success: true })
    expect(map['intent-1'].fee?.state).toBe('collected-onchain')
    expect(map['intent-1'].state).toBe('completed')
    expect(summarizeFeeRevenue(map)).toMatchObject({ collected: 1, pending: 0 })
  })

  it('a reverted swap collected nothing — the fee was inside it', () => {
    let map = open()
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xswap' })
    map = recordSourceReceipt(map, 'intent-1', { txHash: '0xswap', success: false })
    expect(map['intent-1'].fee?.state).toBe('not-collected')
    expect(map['intent-1'].state).toBe('failed')
    expect(summarizeFeeRevenue(map)).toMatchObject({ collected: 0, notCollected: 1 })
  })

  it('an ambiguous broadcast is UNKNOWN, never collected and never failed', () => {
    let map = open()
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xswap', nonce: 7 })
    map = recordUncertainBroadcast(map, 'intent-1', 7)
    expect(map['intent-1'].sourceTxState).toBe('uncertain')
    expect(map['intent-1'].fee?.state).toBe('unknown')
    expect(summarizeFeeRevenue(map)).toMatchObject({ collected: 0, notCollected: 0, unknown: 1 })
  })

  it('an accruing provider owes a claimable balance, not a transfer', () => {
    let map = open({ appFee: feeRecord({ collection: 'accrued-claimable' }) })
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xswap' })
    map = recordSourceReceipt(map, 'intent-1', { txHash: '0xswap', success: true })
    expect(map['intent-1'].fee?.state).toBe('accrued-claimable')
    expect(summarizeFeeRevenue(map)).toMatchObject({ collected: 0, claimable: 1 })
  })
})

describe('cross-chain outcomes', () => {
  const crossOpen = () => {
    let map = open({ isCrossChain: true, toChain: 'base', bridgeTool: 'across' })
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xsrc' })
    map = recordSourceReceipt(map, 'intent-1', { txHash: '0xsrc', success: true })
    return map
  }

  it('a confirmed source tx on a cross-chain swap is BRIDGING, not completed', () => {
    const map = crossOpen()
    expect(map['intent-1'].state).toBe('bridging')
    expect(map['intent-1'].fee?.state).toBe('collected-onchain')
  })

  it('DONE/REFUNDED records a refund and keeps the source-collected fee, with a note', () => {
    let map = crossOpen()
    const report = mapProviderStatus(
      { status: 'DONE', substatus: 'REFUNDED', receivedAmountRaw: '1000000000000000000', receivedTokenAddress: WETH },
      USDC,
    )
    map = applyStatusReport(map, 'intent-1', report)
    expect(map['intent-1'].state).toBe('refunded')
    // The fee rode in the source transaction, which settled. Erasing it would be
    // as wrong as counting the swap as a success.
    expect(map['intent-1'].fee?.state).toBe('collected-onchain')
    expect(map['intent-1'].fee?.note).toMatch(/not reversed by the refund/)
    expect(map['intent-1'].deliveredTokenAddress).toBe(WETH)
  })

  it('DONE/PARTIAL is not success, and the fee note says what happened', () => {
    let map = crossOpen()
    const report = mapProviderStatus(
      { status: 'DONE', substatus: 'PARTIAL', receivedAmountRaw: '2000000', receivedTokenSymbol: 'USDbC' },
      USDC,
    )
    map = applyStatusReport(map, 'intent-1', report)
    expect(map['intent-1'].state).toBe('partial')
    expect(map['intent-1'].fee?.note).toMatch(/different asset/)
  })

  it('a replayed refund status does not annotate twice', () => {
    let map = crossOpen()
    const report = mapProviderStatus({ status: 'DONE', substatus: 'REFUNDED', receivedTokenAddress: WETH }, USDC)
    map = applyStatusReport(map, 'intent-1', report)
    const events = map['intent-1'].fee!.appliedEvents.length
    map = applyStatusReport(map, 'intent-1', report)
    expect(map['intent-1'].fee!.appliedEvents).toHaveLength(events)
  })

  it('DONE/COMPLETED with the expected asset is the only success', () => {
    let map = crossOpen()
    map = applyStatusReport(map, 'intent-1', mapProviderStatus(
      { status: 'DONE', substatus: 'COMPLETED', receivedAmountRaw: '2600000000', receivedTokenAddress: USDC }, USDC))
    expect(map['intent-1'].state).toBe('completed')
  })
})

describe('resuming after a restart', () => {
  it('lists exactly the unresolved cross-chain sessions', () => {
    let map = open({ id: 'a', isCrossChain: true })
    map = recordSwapBroadcast(map, 'a', { txHash: '0xa' })

    map = openSwapSession(map, input({ id: 'b', isCrossChain: true }))
    map = recordSwapBroadcast(map, 'b', { txHash: '0xb' })
    map = recordSourceReceipt(map, 'b', { txHash: '0xb', success: true })
    map = applyStatusReport(map, 'b', mapProviderStatus(
      { status: 'DONE', substatus: 'COMPLETED', receivedTokenAddress: USDC }, USDC))

    // Same-chain, already done: nothing to poll.
    map = openSwapSession(map, input({ id: 'c', isCrossChain: false }))
    map = recordSwapBroadcast(map, 'c', { txHash: '0xc' })

    const pending = sessionsNeedingReconcile(map).map(s => s.id)
    expect(pending).toEqual(['a'])
  })

  it('a session that never broadcast is not polled', () => {
    const map = open({ isCrossChain: true })
    expect(sessionsNeedingReconcile(map)).toHaveLength(0)
  })
})

describe('persisted sessions are untrusted input', () => {
  it('drops anything carrying signable-looking fields', () => {
    const poisoned = {
      good: { id: 'good', walletId: 'w', createdAt: T0, fromChain: 'ethereum', toChain: 'base' },
      bad: { id: 'bad', walletId: 'w', createdAt: T0, fromChain: 'ethereum', toChain: 'base', txData: { to: '0x1', data: '0x2' } },
    }
    const clean = sanitizeSwapSessions(poisoned)
    expect(Object.keys(clean)).toEqual(['good'])
  })

  it('drops entries whose key does not match their id, and junk', () => {
    expect(Object.keys(sanitizeSwapSessions({ x: { id: 'y', walletId: 'w', createdAt: 1, fromChain: 'a', toChain: 'b' } }))).toEqual([])
    expect(sanitizeSwapSessions(null)).toEqual({})
    expect(sanitizeSwapSessions('nope')).toEqual({})
  })
})

describe('revenue summary is honest about what it counts', () => {
  it('never folds unknown or pending into collected', () => {
    let map = open({ id: 'done' })
    map = recordSwapBroadcast(map, 'done', { txHash: '0x1' })
    map = recordSourceReceipt(map, 'done', { txHash: '0x1', success: true })

    map = openSwapSession(map, input({ id: 'pending' }))
    map = recordSwapBroadcast(map, 'pending', { txHash: '0x2' })

    map = openSwapSession(map, input({ id: 'lost' }))
    map = recordSwapBroadcast(map, 'lost', { txHash: '0x3' })
    map = recordUncertainBroadcast(map, 'lost', 3)

    map = openSwapSession(map, input({ id: 'never' }))

    expect(summarizeFeeRevenue(map)).toEqual({
      collected: 1, claimable: 0, pending: 1, notCollected: 1, feeFree: 0, unknown: 1,
    })
  })
})

describe('a fee-free route is its own outcome', () => {
  const feeFreeOpen = () => openSwapSession({}, input({ appFee: feeFreeRecord('1inch', 'ethereum', 'tier-2 fallback') }))

  it('starts and stays at no-fee - never "not collected"', () => {
    let map = feeFreeOpen()
    expect(map['intent-1'].fee?.state).toBe('no-fee')
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xswap' })
    expect(map['intent-1'].fee?.state).toBe('no-fee')
    map = recordSourceReceipt(map, 'intent-1', { txHash: '0xswap', success: true })
    expect(map['intent-1'].fee?.state).toBe('no-fee')
    expect(map['intent-1'].state).toBe('completed')
  })

  it('is counted apart from failures and from unknowns', () => {
    const map = recordSourceReceipt(
      recordSwapBroadcast(feeFreeOpen(), 'intent-1', { txHash: '0xswap' }),
      'intent-1', { txHash: '0xswap', success: true },
    )
    expect(summarizeFeeRevenue(map)).toMatchObject({ collected: 0, notCollected: 0, unknown: 0, feeFree: 1 })
  })

  it('stays no-fee even when the broadcast outcome is unknown', () => {
    let map = recordSwapBroadcast(feeFreeOpen(), 'intent-1', { txHash: '0xswap', nonce: 3 })
    map = recordUncertainBroadcast(map, 'intent-1', 3)
    expect(map['intent-1'].fee?.state).toBe('no-fee')
    expect(map['intent-1'].state).toBe('unknown')
  })

  it('stays no-fee through a refund', () => {
    let map = recordSourceReceipt(
      recordSwapBroadcast(openSwapSession({}, input({
        isCrossChain: true, toChain: 'base', appFee: feeFreeRecord('rango', 'ethereum', 'tier-2'),
      })), 'intent-1', { txHash: '0xsrc' }),
      'intent-1', { txHash: '0xsrc', success: true },
    )
    map = applyStatusReport(map, 'intent-1', mapProviderStatus(
      { status: 'DONE', substatus: 'REFUNDED', receivedTokenAddress: WETH }, USDC))
    expect(map['intent-1'].state).toBe('refunded')
    expect(map['intent-1'].fee?.state).toBe('no-fee')
    expect(map['intent-1'].fee?.note).toBeNull()
  })
})

describe('destination-side minimum receipt', () => {
  const bridged = (min: string | null) => {
    let map = openSwapSession({}, input({ isCrossChain: true, toChain: 'base', minBuyAmountRaw: min }))
    map = recordSwapBroadcast(map, 'intent-1', { txHash: '0xsrc' })
    return recordSourceReceipt(map, 'intent-1', { txHash: '0xsrc', success: true })
  }

  it('downgrades a "completed" delivery that came in UNDER the approved floor', () => {
    // A bridge cannot revert the way a same-chain swap does, so the floor is
    // enforced by detection: the user is told they got less than they approved
    // rather than being told the swap succeeded.
    const map = applyStatusReport(bridged('2587000000'), 'intent-1', mapProviderStatus(
      { status: 'DONE', substatus: 'COMPLETED', receivedTokenAddress: USDC, receivedAmountRaw: '2000000000' }, USDC))
    expect(map['intent-1'].state).toBe('partial')
    expect(map['intent-1'].message).toMatch(/less than the minimum you approved/)
  })

  it('leaves a delivery AT the floor alone', () => {
    const map = applyStatusReport(bridged('2587000000'), 'intent-1', mapProviderStatus(
      { status: 'DONE', substatus: 'COMPLETED', receivedTokenAddress: USDC, receivedAmountRaw: '2587000000' }, USDC))
    expect(map['intent-1'].state).toBe('completed')
  })

  it('only ever downgrades - a provider saying PARTIAL is believed as-is', () => {
    const map = applyStatusReport(bridged('1'), 'intent-1', mapProviderStatus(
      { status: 'DONE', substatus: 'PARTIAL', receivedTokenAddress: USDC, receivedAmountRaw: '9999999999' }, USDC))
    expect(map['intent-1'].state).toBe('partial')
  })

  it('does not invent a shortfall when there is no floor or no delivered amount', () => {
    const noFloor = applyStatusReport(bridged(null), 'intent-1', mapProviderStatus(
      { status: 'DONE', substatus: 'COMPLETED', receivedTokenAddress: USDC, receivedAmountRaw: '1' }, USDC))
    expect(noFloor['intent-1'].state).toBe('completed')
    const noAmount = applyStatusReport(bridged('2587000000'), 'intent-1', mapProviderStatus(
      { status: 'DONE', substatus: 'COMPLETED', receivedTokenAddress: USDC }, USDC))
    expect(noAmount['intent-1'].state).toBe('completed')
  })
})
