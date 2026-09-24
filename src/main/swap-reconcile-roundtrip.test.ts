/**
 * Reconciliation maps a status that was ALREADY mapped once (by
 * getCrossSwapStatus). The report must survive that second pass unchanged.
 *
 * Field record 2026-09-23: EMO -> PIXL via Relay, delivered 1004.64 PIXL
 * (confirmed on Ethereum), stored as 'unknown' — "Relay returned a status we do
 * not recognise" — because the first pass reported LI.FI's 'DONE' instead of
 * Relay's 'success'. Rango had the same flaw, and re-read 'DONE' as PENDING.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { mapStatusForProvider } from '../shared/swap-lifecycle'
import {
  setSwapSessionPersistence, openSession, noteSwapBroadcast, reconcileSessions, __resetSwapSessions,
} from './swap-sessions'
import type { SwapSigningIdentity } from './swap-intent'
import type { NormalizedSwapQuote, CrossSwapStatus } from './swap-proxy'
import { validAppFee } from './swap-fixtures'

/** The status shape mapStatusForProvider accepts (Relay adds failReason). */
type ProviderRaw = Parameters<typeof mapStatusForProvider>[1]

const PIXL = '0x427a03fb96d9a94a6727fbcfbba143444090dd64'
const ME = '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'
const id: SwapSigningIdentity = { walletId: 'w', accountIndex: 0, environment: 'mainnet', sourceAddress: ME, destinationAddress: ME }

/** What getCrossSwapStatus returns: the Worker's raw fields plus ONE mapping pass. */
function firstPass(provider: string, raw: ProviderRaw): CrossSwapStatus {
  const r = mapStatusForProvider(provider, raw, PIXL)
  return {
    status: 'done', error: null, state: r.state, message: r.message,
    providerStatus: r.providerStatus, providerSubstatus: r.providerSubstatus,
    receivedAmountRaw: raw.receivedAmountRaw ?? null, delivered: r.delivered,
    destTxHash: r.destTxHash, destExplorerUrl: r.destExplorerUrl,
  }
}

const delivered = {
  receivedAmountRaw: '1004644860155406749453', receivedTokenAddress: PIXL, receivedTokenSymbol: 'PIXL',
  receivedTokenDecimals: 18, receivedTokenChain: '1', destTxHash: '0x4b20',
}

const cases: Array<[string, ProviderRaw, string]> = [
  ['relay', { provider: 'relay', status: 'success', ...delivered }, 'completed'],       // the reported record
  ['relay', { provider: 'relay', status: 'refund', failReason: 'N/A' }, 'refunded'],
  ['relay', { provider: 'relay', status: 'failure', failReason: 'X' }, 'failed'],
  ['rango', { provider: 'rango', status: 'success', ...delivered }, 'completed'],
  ['rango', { provider: 'rango', status: 'success', substatus: 'REVERTED_TO_INPUT' }, 'refunded'],
  ['rango', { provider: 'rango', status: 'success', substatus: 'MIDDLE_ASSET' }, 'partial'],
  ['lifi', { provider: 'lifi', status: 'DONE', substatus: 'COMPLETED', ...delivered }, 'completed'],
  ['lifi', { provider: 'lifi', status: 'DONE', substatus: 'REFUNDED' }, 'refunded'],
]

let stored: unknown = {}
beforeEach(() => {
  __resetSwapSessions(); stored = {}
  setSwapSessionPersistence({ load: async () => stored as never, save: async (v: unknown) => { stored = v } })
})

describe('a mapped status survives reconciliation', () => {
  it.each(cases)('%s %j -> %s', async (provider, raw, expected) => {
    expect(firstPass(provider, raw).state).toBe(expected)          // the live screen
    const quote = {
      provider, fromChain: 'monad', toChain: 'ethereum', fromTokenAddress: '0x81a2', toTokenAddress: PIXL,
      fromTokenSymbol: 'EMO', toTokenSymbol: 'PIXL', sellAmountRaw: '1', buyAmountRaw: '1', minBuyAmountRaw: '1',
      toAddress: ME, bridgeTool: provider, requestId: '0x1790', appFee: validAppFee(provider, 'monad', '1'),
    } as unknown as NormalizedSwapQuote
    await openSession('s', quote, id, { from: 18, to: 18 })
    await noteSwapBroadcast('s', '0xsrc', null, 1)
    const [session] = await reconcileSessions(id, async () => firstPass(provider, raw))
    expect(session.state).toBe(expected)                              // the stored record
  })
})
