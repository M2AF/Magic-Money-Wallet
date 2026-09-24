/**
 * swap-sessions.test.ts — the registry across a restart.
 *
 * The settlement reducers are tested in isolation elsewhere; what this covers is
 * the part that used to be missing entirely: a swap that is still in flight when
 * the process goes away, and what happens when it comes back. The old tracker
 * was a `setTimeout` inside a React component, so "comes back" meant "is
 * forgotten".
 *
 * It also pins the boundary that makes persisting this safe at all — a resumed
 * session reconciles, and can never re-authorize a spend.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  setSwapSessionPersistence, openSession, noteApprovalTx, noteSwapBroadcast,
  noteSourceReceipt, listSessions, reconcileSessions, feeSummary, __resetSwapSessions,
} from './swap-sessions'
import { validAppFee } from './swap-fixtures'
import type { SwapSigningIdentity } from './swap-intent'
import type { NormalizedSwapQuote, CrossSwapStatus } from './swap-proxy'

const identity: SwapSigningIdentity = {
  walletId: '0xwallet|solwallet',
  accountIndex: 0,
  environment: 'mainnet',
  sourceAddress: '0x5555555555555555555555555555555555555555',
  destinationAddress: '0x5555555555555555555555555555555555555555',
}

const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'

function crossQuote(): NormalizedSwapQuote {
  return {
    provider: 'lifi',
    fromChain: 'ethereum', toChain: 'base',
    fromTokenAddress: WETH, toTokenAddress: USDC_BASE,
    fromTokenSymbol: 'WETH', toTokenSymbol: 'USDC',
    sellAmountRaw: '1000000000000000000',
    buyAmountRaw: '2600000000',
    minBuyAmountRaw: '2587000000',
    estimatedGasRaw: '210000', slippageBps: 50,
    priceImpactPct: 0, rate: 2600, expiresAt: Date.now() + 30_000,
    isCrossChain: true, toAddress: identity.destinationAddress,
    bridgeTool: 'across',
    appFee: validAppFee('lifi', 'ethereum', '1000000000000000000'),
    txData: { to: '0x3333333333333333333333333333333333333333', data: '0x1234', value: '0' },
  }
}

/** A persistence port backed by a plain object, so a "restart" is a re-read. */
function memoryStore() {
  const box: { blob: unknown } = { blob: {} }
  return {
    box,
    port: {
      load: async () => JSON.parse(JSON.stringify(box.blob)),
      save: (map: unknown) => { box.blob = JSON.parse(JSON.stringify(map)) },
    },
  }
}

beforeEach(() => __resetSwapSessions())

describe('a swap that survives the process', () => {
  it('persists through a restart and is still resumable', async () => {
    const store = memoryStore()
    setSwapSessionPersistence(store.port)

    await openSession('intent-1', crossQuote(), identity, { from: 18, to: 6 })
    await noteSwapBroadcast('intent-1', '0xsrc', 'https://etherscan.io/tx/0xsrc', 12)

    // "Restart": drop every in-memory trace, reinstall the same store.
    __resetSwapSessions()
    setSwapSessionPersistence(store.port)

    const resumed = await listSessions(identity)
    expect(resumed).toHaveLength(1)
    expect(resumed[0].sourceTxHash).toBe('0xsrc')
    expect(resumed[0].sourceNonce).toBe(12)
    expect(resumed[0].fee?.state).toBe('submitted')
  })

  it('persists no signable material — a session can never be replayed into a signer', async () => {
    const store = memoryStore()
    setSwapSessionPersistence(store.port)
    await openSession('intent-1', crossQuote(), identity, { from: 18, to: 6 })
    await noteSwapBroadcast('intent-1', '0xsrc', null, null)

    // Matched as JSON KEYS, not as substrings: `approvalTxHash` legitimately
    // contains "approvalTx", and a hash is evidence while a payload is authority.
    const written = JSON.stringify(store.box.blob)
    expect(written).not.toContain('"txData"')
    expect(written).not.toContain('"approvalTx"')
    expect(written).not.toContain('"permitTx"')
    expect(written).not.toContain('"swapTransaction"')
    expect(written).not.toContain('"data"')
    // The id IS the intent id, but the intent itself is in-memory only and
    // single-use, so knowing it authorizes nothing.
    expect(written).toContain('0xsrc')
  })

  it('works without a store at all, losing resumability but never safety', async () => {
    await openSession('intent-1', crossQuote(), identity, { from: 18, to: 6 })
    await noteSwapBroadcast('intent-1', '0xsrc', null, null)
    expect(await listSessions(identity)).toHaveLength(1)
  })
})

describe('reconciliation', () => {
  it('records a refund on a resumed session without erasing the collected fee', async () => {
    const store = memoryStore()
    setSwapSessionPersistence(store.port)
    await openSession('intent-1', crossQuote(), identity, { from: 18, to: 6 })
    await noteSwapBroadcast('intent-1', '0xsrc', null, null)
    await noteSourceReceipt('intent-1', '0xsrc', true)

    __resetSwapSessions()
    setSwapSessionPersistence(store.port)

    const status: CrossSwapStatus = {
      status: 'done', error: null,
      providerStatus: 'DONE', providerSubstatus: 'REFUNDED',
      delivered: { chain: 'ethereum', address: WETH, symbol: 'WETH', decimals: 18, amountRaw: '990000000000000000' },
    }
    const out = await reconcileSessions(identity, async () => status)
    expect(out[0].state).toBe('refunded')
    expect(out[0].fee?.state).toBe('collected-onchain')
    expect(out[0].fee?.note).toMatch(/not reversed/)
  })

  it('leaves a session alone when the status call fails — a failed poll is not evidence', async () => {
    setSwapSessionPersistence(memoryStore().port)
    await openSession('intent-1', crossQuote(), identity, { from: 18, to: 6 })
    await noteSwapBroadcast('intent-1', '0xsrc', null, null)

    const out = await reconcileSessions(identity, async () => { throw new Error('offline') })
    expect(out[0].state).toBe('source-submitted')
    expect(out[0].lastPolledAt).toBeNull()
  })

  it('does not reconcile another wallet or another account', async () => {
    setSwapSessionPersistence(memoryStore().port)
    await openSession('intent-1', crossQuote(), identity, { from: 18, to: 6 })
    await noteSwapBroadcast('intent-1', '0xsrc', null, null)

    const other: SwapSigningIdentity = { ...identity, walletId: 'someone-else' }
    let polled = 0
    const out = await reconcileSessions(other, async () => { polled++; return { status: 'done', error: null } })
    expect(polled).toBe(0)
    expect(out).toHaveLength(0)
    // The original owner still sees it.
    expect(await listSessions(identity)).toHaveLength(1)
  })
})

describe('approvals never become revenue', () => {
  it('counts an approved-but-unexecuted swap as not collected', async () => {
    setSwapSessionPersistence(memoryStore().port)
    await openSession('intent-1', crossQuote(), identity, { from: 18, to: 6 })
    await noteApprovalTx('intent-1', '0xapproval')

    expect(await feeSummary()).toMatchObject({ collected: 0, pending: 0, notCollected: 1 })
  })

  it('counts one collected fee for a swap that needed an approval first', async () => {
    setSwapSessionPersistence(memoryStore().port)
    await openSession('intent-1', crossQuote(), identity, { from: 18, to: 6 })
    await noteApprovalTx('intent-1', '0xapproval')
    await noteSwapBroadcast('intent-1', '0xsrc', null, null)
    await noteSourceReceipt('intent-1', '0xsrc', true)
    // A resumed run re-opens the same intent; it must not add a second fee.
    await openSession('intent-1', crossQuote(), identity, { from: 18, to: 6 })

    expect(await feeSummary()).toMatchObject({ collected: 1, pending: 0, notCollected: 0 })
    expect(await listSessions(identity)).toHaveLength(1)
  })
})

/**
 * Relay through the PERSISTED path.
 *
 * Regression: `reconcileSessions` carried its own `provider === 'rango' ? … : …`
 * dispatch and never learned about Relay, so a Relay refund was correct on the
 * live card but stored as `unknown`. Both paths now call `mapStatusForProvider`.
 */
describe('Relay sessions reconcile correctly after a restart', () => {
  const PIXL = '0x427a03fb96d9a94a6727fbcfbba143444090dd64'
  const EMO = '0x81a224f8a62f52bde942dbf23a56df77a10b7777'
  const OURS = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'

  const relayQuoteFixture = (): NormalizedSwapQuote => ({
    ...crossQuote(),
    provider: 'relay',
    fromChain: 'monad', toChain: 'ethereum',
    fromTokenAddress: EMO, toTokenAddress: PIXL,
    fromTokenSymbol: 'EMO', toTokenSymbol: 'PIXL',
    sellAmountRaw: '100000000000000000000000',
    buyAmountRaw: '25274783513934663525702',
    minBuyAmountRaw: '24769287843655970255189',
    requestId: '0x1789950917',
    bridgeTool: 'relay',
    appFee: validAppFee('relay', 'monad', '100000000000000000000000'),
  })

  async function openRelay() {
    const store = memoryStore()
    setSwapSessionPersistence(store.port)
    await openSession('intent-r', relayQuoteFixture(), identity, { from: 18, to: 18 })
    await noteSwapBroadcast('intent-r', '0xdeposit', null, 7)
    return store
  }

  const refundStatus = (): CrossSwapStatus => ({
    status: 'pending', providerStatus: 'refund', providerSubstatus: 'SLIPPAGE',
    failReason: 'SLIPPAGE', error: null,
  })

  it('stores a Relay REFUND as refunded, not unknown', async () => {
    await openRelay()
    const [s] = await reconcileSessions(identity, async () => refundStatus())
    expect(s.state).toBe('refunded')
    expect(s.message).toMatch(/source chain/i)
  })

  it('agrees with the live mapper after a restart', async () => {
    const store = await openRelay()
    __resetSwapSessions()
    setSwapSessionPersistence(store.port)
    const [s] = await reconcileSessions(identity, async () => refundStatus())
    expect(s.state).toBe('refunded')
  })

  it('CONFIRMS the payout when Relay\'s settlement record names our beneficiary', async () => {
    await openRelay()
    const [s] = await reconcileSessions(identity, async () => ({
      status: 'done', providerStatus: 'success', error: null,
      delivered: { chain: '1', address: PIXL, symbol: 'PIXL', decimals: 18, amountRaw: '25000000000000000000000' },
      paidAppFees: [{ recipient: OURS.toLowerCase(), bps: '100', amount: '773031' }],
    }))
    expect(s.state).toBe('completed')
    expect(s.fee?.payout).toMatchObject({ status: 'confirmed', amountRaw: '773031', bps: 100 })
  })

  it('records a MISMATCH using a real Relay settlement that paid other integrators', async () => {
    // success-1.json is a real filled request whose paidAppFees name three OTHER
    // recipients. Applied to a session whose fee was meant for us, that is
    // exactly the "charged but not paid to us" case — recorded, never hidden.
    const real = JSON.parse(readFileSync(
      join(__dirname, '..', 'shared', '__fixtures__', 'relay', 'success-1.json'), 'utf8'))
    await openRelay()
    const [s] = await reconcileSessions(identity, async () => ({
      status: 'done', providerStatus: 'success', error: null,
      paidAppFees: real.data.paidAppFees,
    }))
    expect(s.fee?.payout?.status).toBe('mismatch')
    expect(s.fee?.note).toMatch(/none to the Magic Money beneficiary/i)
  })

  it('does not change the payout on a replayed poll', async () => {
    await openRelay()
    const confirmed = async () => ({
      status: 'done' as const, providerStatus: 'success', error: null,
      paidAppFees: [{ recipient: OURS, bps: '100', amount: '773031' }],
    })
    const [first] = await reconcileSessions(identity, confirmed)
    const events = first.fee?.appliedEvents.length
    // A terminal session is no longer polled, so replay it directly.
    const again = await reconcileSessions(identity, confirmed)
    expect(again[0].fee?.appliedEvents.length).toBe(events)
    expect(again[0].fee?.payout?.status).toBe('confirmed')
  })
})
