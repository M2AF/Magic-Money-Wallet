/**
 * A swap that was stopped before its transaction was sent.
 *
 * Field record 2026-09-22 (Abstract, PENGU -> ETH via Relay, the REGULAR
 * account 0x01fa…fe13): approval 0xdf36…fdf confirmed on-chain (nonce 5; the
 * account's nonce is now 6, so nothing followed it), then the swap reverted in
 * simulation and was never sent. The session sat at 'source-submitted' with no
 * swap hash, because reconciliation keys on the swap hash and skipped it.
 */
import { describe, expect, it } from 'vitest'
import {
  openSwapSession, recordPreSwapTx, recordSwapNotSent, recordSwapBroadcast, recordUncertainBroadcast,
  sessionsLeftUnsent, sessionsNeedingReconcile, type SettledSwapSessionMap,
} from './swap-settlement'
import { validAppFee } from '../main/swap-fixtures'

const APPROVAL = '0xdf36702ec7e4b8fb0ab3f29f3b2a89d56f7f6bb567b89a2cba9edc3c93bd8fdf'
const T0 = 1_790_126_809_272

function opened(id = 'abs-1', at = T0): SettledSwapSessionMap {
  return openSwapSession({}, {
    id, walletId: '0x01faf6dfc230d755141d84d7cb980dd68f5efe13|3noTu', accountIndex: 0, environment: 'mainnet',
    provider: 'relay', fromChain: 'abstract', toChain: 'ethereum',
    fromTokenAddress: '0x9ebe3a824ca958e4b3da772d2065518f009cba62', fromTokenSymbol: 'PENGU', fromTokenDecimals: 18,
    toTokenAddress: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', toTokenSymbol: 'ETH', toTokenDecimals: 18,
    sellAmountRaw: '3000000000000000000000', expectedBuyAmountRaw: '10870000000000000',
    minBuyAmountRaw: '10439656931722593', recipient: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13',
    isCrossChain: true, bridgeTool: 'relay', providerRequestId: '0x1790', appFee: validAppFee('relay', 'abstract', '3000000000000000000000'),
    now: at,
  })
}

describe('recordSwapNotSent', () => {
  it('records the reported case accurately: approval kept, swap not sent, no fee taken', () => {
    const map = recordPreSwapTx(opened(), 'abs-1', APPROVAL, T0)
    const out = recordSwapNotSent(map, 'abs-1', 'Swap transaction would fail on-chain.', T0 + 1)['abs-1']
    expect(out.sourceTxState).toBe('not-sent')
    expect(out.state).toBe('failed')
    expect(out.sourceTxHash).toBeNull()
    expect(out.approvalTxHash).toBe(APPROVAL)                 // the approval DID go out
    expect(out.message).toMatch(/No swap was sent, so nothing was swapped/)
    expect(out.message).toMatch(/approval transaction \(0xdf36702e/)
    expect(out.fee?.state).toBe('not-executed')                 // no swap tx, no fee
    // Terminal now, so the status poll will not keep asking about it.
    expect(sessionsNeedingReconcile({ 'abs-1': out })).toHaveLength(0)
  })

  it('NEVER marks a session that has a swap transaction on record', () => {
    const sent = recordSwapBroadcast(opened(), 'abs-1', { txHash: '0xswap', explorerUrl: null, nonce: 6, now: T0 })
    expect(recordSwapNotSent(sent, 'abs-1', 'x')['abs-1'].sourceTxState).toBe('submitted')
  })

  it('NEVER marks an uncertain broadcast — that is not proof of "not sent"', () => {
    const uncertain = recordUncertainBroadcast(opened(), 'abs-1', 6, T0)
    const out = recordSwapNotSent(uncertain, 'abs-1', 'x')['abs-1']
    expect(out.sourceTxState).toBe('uncertain')
    expect(out.state).toBe('unknown')
  })
})

describe('sessionsLeftUnsent — finalizing an old record like the reported one', () => {
  const FIFTEEN_MIN = 15 * 60_000

  it('selects a session with no swap tx once it is past the window', () => {
    const map = recordPreSwapTx(opened(), 'abs-1', APPROVAL, T0)
    expect(sessionsLeftUnsent(map, T0 + FIFTEEN_MIN - 1, FIFTEEN_MIN)).toHaveLength(0)   // could still be sent
    expect(sessionsLeftUnsent(map, T0 + FIFTEEN_MIN + 1, FIFTEEN_MIN).map(s => s.id)).toEqual(['abs-1'])
  })

  it('skips sessions with a swap hash, an uncertain broadcast, or a final state', () => {
    const later = T0 + 60 * 60_000
    const sent = recordSwapBroadcast(opened('a'), 'a', { txHash: '0xs', explorerUrl: null, nonce: 1, now: T0 })
    const unsure = recordUncertainBroadcast(opened('b'), 'b', 2, T0)
    const done = recordSwapNotSent(opened('c'), 'c', 'x', T0)
    expect(sessionsLeftUnsent({ ...sent, ...unsure, ...done }, later, FIFTEEN_MIN)).toHaveLength(0)
  })
})
