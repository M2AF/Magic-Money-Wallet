import { describe, it, expect } from 'vitest'
import { latestXreserveRoute, xreserveRouteProgress } from './xreserve-route-progress'
import type { TestnetStatusSummary, TestnetRecordSummary } from '../../shared/xreserve-testnet-wire'

const summary = (patch: Partial<TestnetStatusSummary> = {}): TestnetStatusSummary => ({
  state: 'awaiting-mint', sourceCode: 'verified', linkCode: 'linked', retryable: true,
  reason: null, sourceConfirmations: '40', trackingError: null, providerFailure: null,
  conflict: null, mint: null, creditedRaw: null, locatorState: null, auditState: null, ...patch,
})
describe('xReserve staged recipient delivery', () => {
  it('does not promote source confirmation or attestation into destination settlement', () => {
    expect(xreserveRouteProgress().map(s => s.state)).toEqual(['pending', 'pending', 'pending'])
    expect(xreserveRouteProgress(summary({ linkCode: null })).map(s => s.state)).toEqual(['verified', 'pending', 'pending'])
    expect(xreserveRouteProgress(summary()).map(s => s.state)).toEqual(['verified', 'verified', 'pending'])
  })
  it('requires verified credit and keeps provisional or conflicting mints unresolved', () => {
    const minted = summary({ state: 'minted', mint: { txHash: 'ab'.repeat(32), blockHeight: 10, confirmations: 20 }, creditedRaw: '15000000' })
    expect(xreserveRouteProgress(minted).map(s => s.state)).toEqual(['verified', 'verified', 'verified'])
    for (const patch of [{ state: 'awaiting-confirmations' }, { creditedRaw: '0' }, { linkCode: null }, { sourceCode: null }]) {
      expect(xreserveRouteProgress({ ...minted, ...patch })[2].state).toBe('pending')
    }
    expect(xreserveRouteProgress({ ...minted, state: 'mint-conflict' })[2].state).toBe('review')
    expect(xreserveRouteProgress(summary({ state: 'source-failed', sourceCode: 'reverted', linkCode: null }))[0].state).toBe('review')
  })
  it('selects one latest stored route without changing record order', () => {
    const records = [10, 30, 20].map(cardanoTipAtSubmission => ({ cardanoTipAtSubmission } as TestnetRecordSummary))
    expect(latestXreserveRoute(records)).toBe(records[1])
    expect(records.map(r => r.cardanoTipAtSubmission)).toEqual([10, 30, 20])
    expect(latestXreserveRoute([])).toBeUndefined()
  })
})
