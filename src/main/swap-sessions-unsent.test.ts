/**
 * Reconciliation finalizes a session that never got a swap transaction — for
 * the account it belongs to, and no other.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import {
  setSwapSessionPersistence, openSession, noteApprovalTx, reconcileSessions, __resetSwapSessions,
} from './swap-sessions'
import type { SwapSigningIdentity } from './swap-intent'
import type { NormalizedSwapQuote } from './swap-proxy'
import { validAppFee } from './swap-fixtures'

const REGULAR: SwapSigningIdentity = {
  walletId: '0x01faf6dfc230d755141d84d7cb980dd68f5efe13|3noTu', accountIndex: 0, environment: 'mainnet',
  sourceAddress: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13', destinationAddress: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13',
}
const OTHER_ACCOUNT: SwapSigningIdentity = { ...REGULAR, accountIndex: 1 }

const quote = {
  provider: 'relay', fromChain: 'abstract', toChain: 'ethereum',
  fromTokenAddress: '0x9ebe3a824ca958e4b3da772d2065518f009cba62', toTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  fromTokenSymbol: 'PENGU', toTokenSymbol: 'ETH', sellAmountRaw: '3000000000000000000000', buyAmountRaw: '1',
  minBuyAmountRaw: '1', toAddress: REGULAR.destinationAddress, bridgeTool: 'relay', requestId: '0x1790',
  appFee: validAppFee('relay', 'abstract', '3000000000000000000000'),
} as unknown as NormalizedSwapQuote

let stored: unknown = {}
beforeEach(() => {
  __resetSwapSessions()
  stored = {}
  setSwapSessionPersistence({ load: async () => stored as never, save: async (v: unknown) => { stored = v } })
})
afterEach(() => vi.useRealTimers())

describe('reconcileSessions and never-sent swaps', () => {
  it('finalizes an expired session with only an approval as not-sent, and never polls it', async () => {
    vi.useFakeTimers({ now: 1_790_126_809_272 })
    await openSession('abs-1', quote, REGULAR, { from: 18, to: 18 })
    await noteApprovalTx('abs-1', '0xdf36702ec7e4b8fb0ab3f29f3b2a89d56f7f6bb567b89a2cba9edc3c93bd8fdf')
    vi.setSystemTime(1_790_126_809_272 + 16 * 60_000)

    const poll = vi.fn()
    const list = await reconcileSessions(REGULAR, poll)
    const s = list.find(x => x.id === 'abs-1')!
    expect(s.sourceTxState).toBe('not-sent')
    expect(s.state).toBe('failed')
    expect(s.approvalTxHash).toMatch(/^0xdf36/)
    expect(s.message).toMatch(/authorization has expired/)
    expect(poll).not.toHaveBeenCalled()      // no swap hash to ask a provider about
  })

  it('leaves a recent session alone — its swap could still be sent', async () => {
    vi.useFakeTimers({ now: 1_790_126_809_272 })
    await openSession('abs-2', quote, REGULAR, { from: 18, to: 18 })
    vi.setSystemTime(1_790_126_809_272 + 60_000)
    const s = (await reconcileSessions(REGULAR, vi.fn())).find(x => x.id === 'abs-2')!
    expect(s.sourceTxState).toBe('submitted')
    expect(s.state).toBe('source-submitted')
  })

  it('does not touch another account\'s session', async () => {
    vi.useFakeTimers({ now: 1_790_126_809_272 })
    await openSession('abs-3', quote, REGULAR, { from: 18, to: 18 })
    vi.setSystemTime(1_790_126_809_272 + 16 * 60_000)
    await reconcileSessions(OTHER_ACCOUNT, vi.fn())
    // Another account reconciling must leave this account's record untouched.
    const savedAfterOther = (stored as Record<string, { sourceTxState: string }>)['abs-3']
    expect(savedAfterOther.sourceTxState).toBe('submitted')
    // Finalized only once the OWNING account reconciles.
    const s = (await reconcileSessions(REGULAR, vi.fn())).find(x => x.id === 'abs-3')!
    expect(s.sourceTxState).toBe('not-sent')
  })
})
