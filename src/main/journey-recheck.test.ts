/**
 * Restored journeys: Solana delivery DISCOVERY (decided only by the proof),
 * re-checking sent steps by their saved hashes, and wallet scoping. Fakes only;
 * nothing reaches a network, nothing is signed or sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encodeAbiParameters, encodeEventTopics, getAddress, type Hex } from 'viem'
import { sha256 } from '@noble/hashes/sha256'
import { base58, base64 } from '@scure/base'
import { findSolanaCbAdaDelivery, recipientAta, type SolanaDeliveryReads, type DeliverySearch } from './cbada-solana-delivery'
import { recheckJourney, __clearDeliveryCursors, type RecheckReads } from './journey-recheck'
import { journeyMapStore, createJourneyWriteQueue } from './journey-store'
import { handleJourneyList, handleJourneyRecheck, type JourneyHost } from './journey-handler'
import { CCIP_MESSAGE_SENT, BASE_SOLANA_ONRAMP, SOLANA_OFFRAMP, type ReceiptLike } from './cbada-ccip-send'
import { CBADA, svmTokenTransferExtraArgs } from './cbada-ccip'
import { createJourney, approveLeg, recordLegSubmitted, authorizeCcipBridge, recordLegApprovalSent, type StablecoinJourney } from '../shared/stablecoin-journey'
import type { WalletConfig } from './secure-store'

const EVM = '0x720f28c62b844e7dd8705ab0a7651f3f575384f4'
const SOL = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'
const WALLET_ID = `${EVM}|${SOL}`
const MSG = ('0x' + 'ab'.repeat(32)) as Hex
const SEND_HASH = '0x' + 'cd'.repeat(32)
const MINT_HEX = ('0x' + Array.from(base58.decode(CBADA.solana.token), b => b.toString(16).padStart(2, '0')).join('')) as Hex

// ── Solana transactions shaped like OffRamp executions ───────────────────────
const disc = (n: string) => sha256(new TextEncoder().encode(`event:${n}`)).slice(0, 8)
const u64 = (v: bigint) => Uint8Array.from({ length: 8 }, (_, i) => Number((v >> BigInt(8 * i)) & 0xffn))
const execEvent = (id: string, state = 2) => 'Program data: ' + base64.encode(new Uint8Array([
  ...disc('ExecutionStateChanged'), ...u64(CBADA.base.selector), ...u64(9n),
  ...Uint8Array.from((id.slice(2).match(/../g) ?? []).map(h => parseInt(h, 16))), ...new Uint8Array(32), state]))
const offrampTx = (logs: string[], credit = '10000000') => ({ meta: { err: null,
  logMessages: [`Program ${SOLANA_OFFRAMP} invoke [1]`, ...logs, `Program ${SOLANA_OFFRAMP} success`],
  preTokenBalances: [{ mint: CBADA.solana.token, owner: SOL, uiTokenAmount: { amount: '0' } }],
  postTokenBalances: [{ mint: CBADA.solana.token, owner: SOL, uiTokenAmount: { amount: credit } }] } })
const SKIP = offrampTx(['Program data: fIjY5xnoBe+C/0rkz0Gm3eU0AAAAAAAA'], '0')
const ATA = recipientAta(SOL)

/**
 * A fake Solana: per-address signature histories (newest first) that honour
 * getSignaturesForAddress's `before` and `until`, a token-account lookup, and
 * transactions by signature. Histories can grow between calls.
 */
function fakeSolana(histories: Record<string, Array<{ signature: string; blockTime: number | null }>>, txs: Record<string, unknown>,
  listed: string[] | null = []) {
  const reads: SolanaDeliveryReads = {
    tokenAccounts: vi.fn(async () => listed),
    signatures: vi.fn(async (address: string, limit: number, opts: { before?: string; until?: string } = {}) => {
      const h = histories[address] ?? []
      let start = 0
      if (opts.before) { const i = h.findIndex(s => s.signature === opts.before); start = i < 0 ? h.length : i + 1 }
      let end = h.length
      if (opts.until) { const i = h.findIndex(s => s.signature === opts.until); if (i >= 0) end = i }
      return h.slice(start, end).slice(0, limit)
    }),
    transaction: vi.fn(async (s: string) => (txs[s] ?? null) as never),
  }
  return reads
}
const sig = (signature: string, blockTime: number | null) => ({ signature, blockTime })
const cursorOf = (r: DeliverySearch) => ('cursor' in r ? r.cursor : null)
beforeEach(() => __clearDeliveryCursors())
const query = { messageId: MSG, recipient: SOL, amountRaw: '10000000', sentAt: 1000 }

describe('findSolanaCbAdaDelivery — discovery, decided by the proof', () => {
  it('passes over a skipped execution and another message, and returns the proven delivery', async () => {
    const reads = fakeSolana({ [ATA]: [sig('other', 1300), sig('skip', 1200), sig('mine', 1100)] },
      { other: offrampTx([execEvent('0x' + '01'.repeat(32))]), skip: SKIP, mine: offrampTx([execEvent(MSG)]) })
    expect(await findSolanaCbAdaDelivery(query, reads)).toEqual({ state: 'delivered', signature: 'mine', sequenceNumber: '9' })
  })

  it('a matching event from a program OTHER than the OffRamp is not a delivery', async () => {
    const sibling = { meta: { ...offrampTx([]).meta, logMessages: [
      `Program ${SOLANA_OFFRAMP} invoke [1]`, `Program ${SOLANA_OFFRAMP} success`,
      'Program Evil1111111111111111111111111111111111111 invoke [1]', execEvent(MSG), 'Program Evil1111111111111111111111111111111111111 success'] } }
    const r = await findSolanaCbAdaDelivery(query, fakeSolana({ [ATA]: [sig('s', 1100)] }, { s: sibling }))
    expect(r).toMatchObject({ state: 'not-found-yet', checked: 1 })
  })

  it('stops at the send time: older transactions are not candidates', async () => {
    const reads = fakeSolana({ [ATA]: [sig('old', 999)] }, { old: offrampTx([execEvent(MSG)]) })
    expect(await findSolanaCbAdaDelivery(query, reads)).toMatchObject({ state: 'not-found-yet', checked: 0 })
    expect(reads.transaction).not.toHaveBeenCalled()
  })

  it('searches EVERY token account: a delivery in the fifth account is found', async () => {
    const five = ['A1', 'A2', 'A3', 'A4', 'A5'].map(a => `Acct${a}11111111111111111111111111111111111`)
    const histories = Object.fromEntries(five.map((a, i) => [a, [sig(`s${i}`, 1100)]]))
    const txs: Record<string, unknown> = Object.fromEntries(five.map((_, i) => [`s${i}`, SKIP]))
    txs.s4 = offrampTx([execEvent(MSG)])
    expect(await findSolanaCbAdaDelivery(query, fakeSolana(histories, txs, five))).toEqual({ state: 'delivered', signature: 's4', sequenceNumber: '9' })
  })

  it('a CLOSED account: no longer listed, but its derived address history still holds the delivery', async () => {
    const reads = fakeSolana({ [ATA]: [sig('close', 1200), sig('mine', 1100)] }, { close: SKIP, mine: offrampTx([execEvent(MSG)]) }, [])
    expect(await findSolanaCbAdaDelivery(query, reads)).toEqual({ state: 'delivered', signature: 'mine', sequenceNumber: '9' })
  })

  it('repeated budget exhaustion RESUMES: each check continues where the last stopped, and finds an older delivery', async () => {
    const skips = Array.from({ length: 60 }, (_, i) => sig(`k${i}`, 2000 - i))
    const txs: Record<string, unknown> = Object.fromEntries(skips.map(s => [s.signature, SKIP]))
    txs.mine = offrampTx([execEvent(MSG)])
    const reads = fakeSolana({ [ATA]: [...skips, sig('mine', 1100)] }, txs)
    const first = await findSolanaCbAdaDelivery(query, reads, { maxTransactions: 25 })
    expect(first).toMatchObject({ state: 'incomplete', checked: 25, reason: 'search budget reached' })
    const second = await findSolanaCbAdaDelivery(query, reads, { maxTransactions: 25, cursor: cursorOf(first) })
    expect(second).toMatchObject({ state: 'incomplete', checked: 25 })
    const third = await findSolanaCbAdaDelivery(query, reads, { maxTransactions: 25, cursor: cursorOf(second) })
    expect(third).toEqual({ state: 'delivered', signature: 'mine', sequenceNumber: '9' })
    // 61 distinct transactions, each read once: no restart at the newest.
    expect((reads.transaction as ReturnType<typeof vi.fn>).mock.calls.length).toBe(61)
  })

  it('transactions that arrive between checks are checked too (newer than the cursor)', async () => {
    const history = [sig('k1', 1300), sig('k2', 1200)]
    const txs: Record<string, unknown> = { k1: SKIP, k2: SKIP, late: offrampTx([execEvent(MSG)]), late2: SKIP }
    const reads = fakeSolana({ [ATA]: history }, txs)
    const first = await findSolanaCbAdaDelivery(query, reads)
    expect(first).toMatchObject({ state: 'not-found-yet', checked: 2 })
    history.unshift(sig('late2', 1500), sig('late', 1400))
    const second = await findSolanaCbAdaDelivery(query, reads, { cursor: cursorOf(first) })
    expect(second).toEqual({ state: 'delivered', signature: 'late', sequenceNumber: '9' })
    expect((reads.transaction as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0])).toEqual(['k1', 'k2', 'late'])
  })

  it('an unreadable account list is incomplete even when the derived account shows nothing', async () => {
    expect(await findSolanaCbAdaDelivery(query, fakeSolana({}, {}, null))).toMatchObject({ state: 'incomplete', reason: expect.stringMatching(/token accounts/) })
    expect((await findSolanaCbAdaDelivery(query, fakeSolana({ [ATA]: [sig('x', 1100)] }, {}))).state).toBe('incomplete')
  })

  it('a failed execution or a wrong credit is surfaced for review', async () => {
    expect((await findSolanaCbAdaDelivery(query, fakeSolana({ [ATA]: [sig('f', 1100)] }, { f: offrampTx([execEvent(MSG, 3)], '0') }))).state).toBe('execution-failed')
    expect((await findSolanaCbAdaDelivery(query, fakeSolana({ [ATA]: [sig('c', 1100)] }, { c: offrampTx([execEvent(MSG)], '1') }))).state).toBe('credit-mismatch')
  })
})

// ── Re-checking a restored journey ───────────────────────────────────────────
const BASE_CB = { chain: 'base' as const, address: CBADA.base.token, symbol: 'cbADA', decimals: 6 }
const SOL_CB = { chain: 'solana' as const, address: CBADA.solana.token, symbol: 'cbADA', decimals: 6 }

function sentJourney(id = 'j1', walletId = WALLET_ID): StablecoinJourney {
  let j = createJourney({ id, walletId, now: 1, bridge: 'ccip-cbada', recipient: SOL, source: BASE_CB, usdcx: BASE_CB, usdc: SOL_CB, destination: SOL_CB })
  j = approveLeg(j, 'bridge', '10000000', 2, '10000000')
  return recordLegSubmitted(j, 'bridge', SEND_HASH, 3)
}

function cbAdaReceipt(hash = SEND_HASH): ReceiptLike & { blockNumber: string } {
  const message = {
    header: { messageId: MSG, sourceChainSelector: CBADA.base.selector, destChainSelector: CBADA.solana.selector, sequenceNumber: 9n, nonce: 0n },
    sender: getAddress(EVM), data: '0x' as Hex, receiver: ('0x' + '00'.repeat(32)) as Hex, extraArgs: svmTokenTransferExtraArgs(SOL),
    feeToken: '0x0000000000000000000000000000000000000000' as Hex, feeTokenAmount: 1n, feeValueJuels: 1n,
    tokenAmounts: [{ sourcePoolAddress: getAddress(CBADA.base.pool), destTokenAddress: MINT_HEX, extraData: '0x' as Hex, amount: 10_000_000n, destExecData: '0x' as Hex }],
  }
  const topics = encodeEventTopics({ abi: [CCIP_MESSAGE_SENT], eventName: 'CCIPMessageSent', args: { destChainSelector: CBADA.solana.selector, sequenceNumber: 9n } })
  return { status: '0x1', transactionHash: hash, blockNumber: '0x10', logs: [{ address: BASE_SOLANA_ONRAMP.toLowerCase(), topics: topics as string[], data: encodeAbiParameters(CCIP_MESSAGE_SENT.inputs.slice(2), [message]) }] }
}

function reads(over: Partial<RecheckReads> = {}): RecheckReads {
  return {
    evmReceipt: vi.fn(async () => cbAdaReceipt()),
    evmAllowance: vi.fn(async () => 10_000_000n),
    evmBlockTime: vi.fn(async () => 1000),
    solanaStatus: vi.fn(async () => 'confirmed' as const),
    cardanoTx: vi.fn(async () => 'confirmed' as const),
    solanaDelivery: fakeSolana({ [ATA]: [sig('mine', 1100)] }, { mine: offrampTx([execEvent(MSG)]) }),
    ...over,
  }
}

function memoryStore(js: StablecoinJourney[]) {
  let map: Record<string, string> = Object.fromEntries(js.map(j => [j.id, JSON.stringify(j)]))
  return { load: async () => ({ ...map }), save: vi.fn(async (m: Record<string, string>) => { map = { ...m } }), peek: () => map }
}

describe('recheckJourney', () => {
  it('confirmed cbADA send: recovers and stores the message id, then finds the PROVEN Solana delivery; no state changes', async () => {
    const m = memoryStore([sentJourney()])
    const store = journeyMapStore(m.load, m.save, createJourneyWriteQueue())
    const r = await recheckJourney(sentJourney(), store, reads(), { evm: EVM }, 10)
    expect(r.legs).toEqual([expect.objectContaining({ role: 'bridge', onChain: 'confirmed', messageId: MSG, delivery: { state: 'delivered', signature: 'mine', sequenceNumber: '9' } })])
    const stored = JSON.parse(m.peek().j1) as StablecoinJourney
    expect(stored.legs[1]).toMatchObject({ state: 'submitted', providerRef: MSG })
  })

  it('a receipt for a different transaction is flagged for review and nothing is stored', async () => {
    const m = memoryStore([sentJourney()])
    const store = journeyMapStore(m.load, m.save, createJourneyWriteQueue())
    const r = await recheckJourney(sentJourney(), store, reads({ evmReceipt: vi.fn(async () => cbAdaReceipt('0x' + 'ee'.repeat(32))) }), { evm: EVM }, 10)
    expect(r.legs[0].note).toMatch(/Needs review: The receipt hash does not match/)
    expect(m.save).not.toHaveBeenCalled()
  })

  it('not on chain yet, or unreadable: reported as such, never re-sent', async () => {
    const m = memoryStore([sentJourney()])
    const store = journeyMapStore(m.load, m.save, createJourneyWriteQueue())
    expect((await recheckJourney(sentJourney(), store, reads({ evmReceipt: vi.fn(async () => null) }), { evm: EVM }, 10)).legs[0]).toMatchObject({ onChain: 'not-found', messageId: null })
    expect((await recheckJourney(sentJourney(), store, reads({ evmReceipt: vi.fn(async () => 'unreadable' as const) }), { evm: EVM }, 10)).legs[0]).toMatchObject({ onChain: 'unknown', note: expect.stringMatching(/could not be read/) })
  })

  it('a journey with nothing sent has nothing to check', async () => {
    const fresh = createJourney({ id: 'f', walletId: WALLET_ID, now: 1, bridge: 'ccip-cbada', recipient: SOL, source: BASE_CB, usdcx: BASE_CB, usdc: SOL_CB, destination: SOL_CB })
    const m = memoryStore([fresh])
    const r = await recheckJourney(fresh, journeyMapStore(m.load, m.save, createJourneyWriteQueue()), reads(), { evm: EVM }, 10)
    expect(r.legs).toEqual([])
  })
})

describe('journey handlers — the current wallet only', () => {
  const host = (journeys: StablecoinJourney[], over: Partial<JourneyHost> = {}) => {
    const m = memoryStore(journeys)
    return {
      loadConfig: async () => ({ network: 'mainnet' }) as unknown as WalletConfig,
      loadAddresses: async () => ({ evm: EVM, solana: SOL, cardano: 'addr1x' }),
      loadJourneys: m.load, saveJourneys: m.save, recheckReads: reads(), ...over,
    } as JourneyHost
  }

  it('lists only this wallet\'s journeys and counts the others without showing them', async () => {
    const r = await handleJourneyList(host([sentJourney('mine'), sentJourney('theirs', '0xother|SoLother')]))
    expect(r).toMatchObject({ ok: true, value: { active: [{ id: 'mine' }], otherWallets: 1, awaitingEvidence: 1 } })
  })

  it('refuses to recheck another wallet\'s journey', async () => {
    expect(await handleJourneyRecheck({ journeyId: 'theirs' }, host([sentJourney('theirs', '0xother|SoLother')]))).toMatchObject({ ok: false, message: expect.stringMatching(/current wallet/) })
    expect(await handleJourneyRecheck({ journeyId: '../x' }, host([]))).toMatchObject({ ok: false })
  })

  it('rechecks this wallet\'s journey', async () => {
    expect(await handleJourneyRecheck({ journeyId: 'mine' }, host([sentJourney('mine')]))).toMatchObject({ ok: true, value: { journeyId: 'mine', legs: [{ onChain: 'confirmed', messageId: MSG }] } })
  })
})

describe('approval recovery after an interruption', () => {
  const APPROVAL = '0x' + '77'.repeat(32)
  function approvalSent(id = 'ap', walletId = WALLET_ID): StablecoinJourney {
    let j = createJourney({ id, walletId, now: 1, bridge: 'ccip-cbada', recipient: SOL, source: BASE_CB, usdcx: BASE_CB, usdc: SOL_CB, destination: SOL_CB })
    j = approveLeg(j, 'bridge', '10000000', 2, '10000000')
    j = authorizeCcipBridge(j, { sender: EVM, accountIndex: 0, maxCcipFeeWei: '2000000000000000', maxApprovalGasWei: '1000000000000000', maxSendGasWei: '1000000000000000' }, 3)
    return recordLegApprovalSent(j, 'bridge', APPROVAL, 4)
  }
  const approvalReceipt = (status: string) => ({ status, transactionHash: APPROVAL, blockNumber: '0x10', logs: [] })

  it('a confirmed approval with a covering allowance is shown; the transfer is not sent from here', async () => {
    const m = memoryStore([approvalSent()])
    const store = journeyMapStore(m.load, m.save, createJourneyWriteQueue())
    const r = await recheckJourney(approvalSent(), store, reads({ evmReceipt: vi.fn(async () => approvalReceipt('0x1')) }), { evm: EVM }, 10)
    expect(r.legs).toEqual([expect.objectContaining({ kind: 'approval', txHash: APPROVAL, onChain: 'confirmed', allowanceCovers: true,
      note: expect.stringMatching(/transfer itself has not been sent/) })])
    expect(m.save).not.toHaveBeenCalled()
  })

  it('a failed approval is reported plainly and is never re-sent', async () => {
    const m = memoryStore([approvalSent()])
    const r = await recheckJourney(approvalSent(), journeyMapStore(m.load, m.save, createJourneyWriteQueue()),
      reads({ evmReceipt: vi.fn(async () => approvalReceipt('0x0')), evmAllowance: vi.fn(async () => 0n) }), { evm: EVM }, 10)
    expect(r.legs[0]).toMatchObject({ kind: 'approval', onChain: 'failed', allowanceCovers: false, note: expect.stringMatching(/not sent again/) })
  })

  it('an approval not on chain yet is checked again later, never sent again', async () => {
    const m = memoryStore([approvalSent()])
    const r = await recheckJourney(approvalSent(), journeyMapStore(m.load, m.save, createJourneyWriteQueue()),
      reads({ evmReceipt: vi.fn(async () => null) }), { evm: EVM }, 10)
    expect(r.legs[0]).toMatchObject({ kind: 'approval', onChain: 'not-found', note: expect.stringMatching(/never sent again/) })
  })

  it('the restored list shows the saved approval hash and counts it as awaiting evidence', async () => {
    const m = memoryStore([approvalSent()])
    const h = { loadConfig: async () => ({ network: 'mainnet' }) as unknown as WalletConfig, loadAddresses: async () => ({ evm: EVM, solana: SOL }),
      loadJourneys: m.load, saveJourneys: m.save } as JourneyHost
    const r = await handleJourneyList(h)
    expect(r).toMatchObject({ ok: true, value: { awaitingEvidence: 1, active: [{ legs: [expect.anything(), expect.objectContaining({ approvalTxHash: APPROVAL }), expect.anything()] }] } })
  })
})
