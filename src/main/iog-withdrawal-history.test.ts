/**
 * IOG withdrawal history: strict parsing, exact burn-hash selection, and the
 * provider's `finalized` held to independent Ethereum credit evidence.
 *
 * Fixtures (src/main/__fixtures__/iog) are real, read-only captures from
 * 2026-10-05: the public address's history (9 finalized rows) and the one-
 * endpoint Ethereum evidence for release 0x37dce9fa… of burn 88733381…, which
 * credited exactly 2,800 USDC. Nothing here reaches a network.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  parseIogWithdrawalHistory, selectIogWithdrawal, trackIogWithdrawal, fetchIogWithdrawalHistory,
  IOG_HISTORY_LIMITS, type IogWithdrawalRow,
} from './iog-withdrawal-history'
import { ProviderFault } from './xreserve-cardano-provider'
import type { EthereumDepositEvidence } from './xreserve-ethereum-deposit-proof'

const FIX = join(__dirname, '__fixtures__', 'iog')
const history = JSON.parse(readFileSync(join(FIX, 'withdrawal-history-public.json'), 'utf8')) as { address: string; response: Array<Record<string, unknown>> }
const release = JSON.parse(readFileSync(join(FIX, 'ethereum-release-37dce9fa.json'), 'utf8')) as { evidence: EthereumDepositEvidence }
const BURN = '887333810ea503013f1e17c503ed6e691940e177e82f88baa76d19409de76e86'
const RELEASE = '0x37dce9fab6f48033691f841be3c783bd9154998054490d535795cac2876b5630'
const RECIPIENT = '0x720f28c62b844e7dd8705ab0a7651f3f575384f4'
const rows = () => parseIogWithdrawalHistory(structuredClone(history.response))
const expectation = { burnTxHash: BURN, recipient: RECIPIENT, releaseAmountRaw: '2800000000', burnAmountRaw: '2802000000' }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mutable = { transaction: any; receipt: any; block: any; tipBlockNumber: any }
const evidence = (mutate?: (e: Mutable) => void) => async (hash: string): Promise<EthereumDepositEvidence> => {
  expect(hash).toBe(RELEASE)
  const e = structuredClone(release.evidence) as Mutable
  mutate?.(e)
  return e
}
const track = (r: IogWithdrawalRow[], read = evidence(), exp = expectation) =>
  trackIogWithdrawal(r, exp, read, { minConfirmations: 64 })
const withRow = (patch: Record<string, unknown>) =>
  parseIogWithdrawalHistory(history.response.map(r => (r.cardanoBurnTxHash === BURN ? { ...r, ...patch } : r)))

describe('parseIogWithdrawalHistory', () => {
  it('reads the recorded public response', () => {
    const r = rows()
    expect(r).toHaveLength(9)
    expect(r.every(x => x.state === 'finalized')).toBe(true)
  })

  it('refuses a response that is not a list, too long, or has a malformed row', () => {
    expect(() => parseIogWithdrawalHistory({ items: [] })).toThrow(ProviderFault)
    expect(() => parseIogWithdrawalHistory(new Array(IOG_HISTORY_LIMITS.maxRows + 1).fill(history.response[0]))).toThrow(/too many rows/)
    const one = history.response[0]
    for (const broken of [
      { ...one, extra: 1 }, { ...one, cardanoBurnTxHash: 'x' }, { ...one, amount: '0' }, { ...one, amount: 12 },
      { ...one, ethereumTxHash: '0x12' }, { ...one, confirmations: -1 }, { ...one, createdAt: 'yesterday' }, { ...one, status: '' },
    ]) expect(() => parseIogWithdrawalHistory([broken])).toThrow(ProviderFault)
  })

  it('an unknown status is unrecognized (pending), never success', () => {
    expect(parseIogWithdrawalHistory([{ ...history.response[0], status: 'released_maybe' }])[0].state).toBe('unrecognized')
  })

  it('an administratively blocked failure drops its Ethereum hash, as the Portal does', () => {
    const r = parseIogWithdrawalHistory([{ ...history.response[0], status: 'failed', lastError: 'administratively blocked: x' }])[0]
    expect(r).toMatchObject({ state: 'failed', administrativelyBlocked: true, ethereumTxHash: null })
  })
})

describe('selectIogWithdrawal — exact burn hash only', () => {
  it('finds the exact burn, and nothing for any other hash', () => {
    expect(selectIogWithdrawal(rows(), BURN)).toMatchObject({ kind: 'found', row: { burnTxHash: BURN } })
    expect(selectIogWithdrawal(rows(), `0x${BURN.toUpperCase()}`).kind).toBe('found')
    expect(selectIogWithdrawal(rows(), 'ab'.repeat(32))).toEqual({ kind: 'absent' })
  })

  it('two rows claiming one burn are ambiguous, not "the latest"', () => {
    const dup = rows()
    dup.push({ ...dup.find(r => r.burnTxHash === BURN)!, amountRaw: '1' })
    expect(selectIogWithdrawal(dup, BURN).kind).toBe('duplicate')
  })
})

describe('trackIogWithdrawal — provider state vs independently proven credit', () => {
  it('finalized AND the exact 2,800 USDC credit at depth: verified', async () => {
    const t = await track(rows())
    expect(t.kind).toBe('finalized')
    if (t.kind !== 'finalized') return
    expect(t.credit).toMatchObject({ state: 'verified', netCreditRaw: '2800000000', transactionHash: RELEASE })
  })

  it('finalized but a different recipient: needs review, not verified', async () => {
    const t = await track(rows(), evidence(), { ...expectation, recipient: '0x' + '11'.repeat(20) })
    expect(t.kind === 'finalized' && t.credit.state).toBe('needs-review')
    expect(t.kind === 'finalized' && t.credit.code).toBe('amount-mismatch')
  })

  it('finalized but a different approved value: needs review', async () => {
    const t = await track(rows(), evidence(), { ...expectation, releaseAmountRaw: '2799000000' })
    expect(t.kind === 'finalized' && t.credit.code).toBe('amount-mismatch')
  })

  it('finalized but the release reverted: failed', async () => {
    const t = await track(rows(), evidence(e => { e.receipt.status = '0x0' }))
    expect(t.kind === 'finalized' && t.credit.state).toBe('failed')
  })

  it('finalized but the block is no longer canonical: inconsistent, retried', async () => {
    const t = await track(rows(), evidence(e => { e.block.hash = '0x' + 'ee'.repeat(32) }))
    expect(t.kind === 'finalized' && t.credit).toMatchObject({ state: 'evidence-inconsistent', retryable: true })
  })

  it('finalized but the node does not know the release: pending', async () => {
    const t = await track(rows(), evidence(e => { e.transaction = null }))
    expect(t.kind === 'finalized' && t.credit.state).toBe('pending')
  })

  it('finalized without a named release: needs review; the evidence reader is not called', async () => {
    const read = vi.fn()
    const t = await track(withRow({ ethereumTxHash: null }), read)
    expect(t.kind).toBe('needs-review')
    expect(read).not.toHaveBeenCalled()
  })

  it('a different burn amount than approved: needs review', async () => {
    expect((await track(withRow({ amount: '2801000000' }))).kind).toBe('needs-review')
  })

  it('pending, unrecognized, expired and failed provider states are never completion', async () => {
    const read = vi.fn()
    expect((await track(withRow({ status: 'circle_processing' }), read)).kind).toBe('pending')
    expect((await track(withRow({ status: 'something_new' }), read)).kind).toBe('pending')
    expect((await track(withRow({ status: 'expired' }), read)).kind).toBe('provider-stopped')
    expect((await track(withRow({ status: 'FAIL', lastError: 'x' }), read)).kind).toBe('provider-stopped')
    expect(read).not.toHaveBeenCalled()
  })

  it('a burn the provider does not list is "not listed", not failed', async () => {
    expect(await track(rows(), evidence(), { ...expectation, burnTxHash: 'cd'.repeat(32) })).toEqual({ kind: 'not-listed' })
  })
})

describe('fetchIogWithdrawalHistory', () => {
  const ok = (body: string, status = 200) => vi.fn(async () => new Response(body, { status }))

  it('reads a bounded JSON list for a mainnet address', async () => {
    const r = await fetchIogWithdrawalHistory(history.address, { fetchFn: ok(JSON.stringify(history.response)) })
    expect(r).toHaveLength(9)
  })
  it('refuses an oversized response, a non-200, and a non-mainnet address', async () => {
    await expect(fetchIogWithdrawalHistory(history.address, { fetchFn: ok('[' + ' '.repeat(IOG_HISTORY_LIMITS.maxBytes) + ']') })).rejects.toThrow(/too large/)
    await expect(fetchIogWithdrawalHistory(history.address, { fetchFn: ok('', 503) })).rejects.toMatchObject({ kind: 'unavailable' })
    await expect(fetchIogWithdrawalHistory(history.address, { fetchFn: ok('', 429) })).rejects.toMatchObject({ kind: 'rate-limited' })
    await expect(fetchIogWithdrawalHistory('addr_test1qqqftz3dh5tq6a5s2n8nzrpwgk3gkxst5ndzpjnhrlr9aj6c5v2pmgdpzdpzdemd0t3kgpucfgnux6sccrsk4dsrw8rqjcs3wq', { fetchFn: ok('[]') }))
      .rejects.toThrow(ProviderFault)
  })
})
