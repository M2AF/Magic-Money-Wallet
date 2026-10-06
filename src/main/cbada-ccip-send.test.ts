/**
 * Base -> Solana cbADA over CCIP: build, validate, simulate, message-id recovery
 * and Solana delivery verification. Nothing here signs or sends.
 *
 * Fixtures (src/main/__fixtures__/ccip): a real, public Base -> Solana CCIP send
 * receipt (another token, same OnRamp, 2026-10-05) and a real Solana OffRamp
 * "SkippedAlreadyExecutedMessage" event. No cbADA had yet been delivered Base ->
 * Solana, so positive cbADA cases use events encoded to the published layouts.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, getAddress, type Hex } from 'viem'
import { sha256 } from '@noble/hashes/sha256'
import { base58, base64 } from '@scure/base'
import {
  buildCbAdaBaseToSolana, validateCbAdaSendTxs, simulateCbAdaSend, messageIdFromReceipt, recordSignedBridgeSend,
  recoverBridgeReference, verifySolanaCbAdaDelivery, CCIP_MESSAGE_SENT, BASE_SOLANA_ONRAMP, SOLANA_OFFRAMP,
  CBADA_CCIP_EXECUTION_ENABLED, CcipSendError, type CbAdaSendTerms, type ReceiptLike,
} from './cbada-ccip-send'
import { CBADA, svmTokenTransferExtraArgs } from './cbada-ccip'
import { journeyMapStore, createJourneyWriteQueue } from './journey-store'
import { createJourney, approveLeg, recordLegSubmitted, recordLegOutcome } from '../shared/stablecoin-journey'

const SENDER = '0x720f28c62B844e7dD8705ab0A7651F3f575384F4'
const RECIPIENT = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'
const terms: CbAdaSendTerms = { sender: SENDER, solanaRecipient: RECIPIENT, amountRaw: '10000000', feeWei: '1384650232086707' }
const CAP = 2_000_000_000_000_000n
const MINT_HEX = ('0x' + Array.from(base58.decode(CBADA.solana.token), b => b.toString(16).padStart(2, '0')).join('')) as Hex
const MSG_ID = ('0x' + 'ab'.repeat(32)) as Hex
const ERC20 = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])

describe('build and validate', () => {
  it('approves EXACTLY the amount, and only when the allowance is short', () => {
    expect(buildCbAdaBaseToSolana(terms, 0n).approve).not.toBeNull()
    expect(buildCbAdaBaseToSolana(terms, 10_000_000n).approve).toBeNull()
    const v = validateCbAdaSendTxs(buildCbAdaBaseToSolana(terms, 0n), terms, CAP)
    expect(v).toEqual({ amountRaw: '10000000', feeWei: '1384650232086707', recipient: RECIPIENT, approves: true })
    expect(CBADA_CCIP_EXECUTION_ENABLED).toBe(false)
  })

  const refuse = (mutate: (t: ReturnType<typeof buildCbAdaBaseToSolana>) => void, pattern: RegExp, t = terms, cap = CAP) => {
    const txs = buildCbAdaBaseToSolana(terms, 0n)
    mutate(txs)
    expect(() => validateCbAdaSendTxs(txs, t, cap)).toThrow(CcipSendError)
    expect(() => validateCbAdaSendTxs(txs, t, cap)).toThrow(pattern)
  }
  const approveData = (spender: string, amount: bigint) => encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [spender as Hex, amount] })
  const sendFor = (t: Partial<CbAdaSendTerms>) => buildCbAdaBaseToSolana({ ...terms, ...t }, 10n ** 30n).send

  it('an unlimited approval', () => refuse(x => { x.approve!.data = approveData(CBADA.base.router, 2n ** 256n - 1n) }, /exactly the amount/))
  it('another spender', () => refuse(x => { x.approve!.data = approveData('0x' + '11'.repeat(20), 10_000_000n) }, /spender other than the CCIP router/))
  it('an approval of another token', () => refuse(x => { x.approve!.to = '0x' + '22'.repeat(20) }, /not for cbADA/))
  it('another router', () => refuse(x => { x.send.to = '0x' + '33'.repeat(20) }, /pinned CCIP router/))
  it('another Solana recipient', () => refuse(x => { x.send = sendFor({ solanaRecipient: base58.encode(new Uint8Array(32).fill(9)) }) }, /different Solana recipient/))
  it('another amount', () => refuse(x => { x.send = sendFor({ amountRaw: '9000000' }) }, /different token or amount/))
  it('a fee different from the quote', () => refuse(x => { x.send.value = '1' }, /different fee/))
  it('a fee above the ceiling', () => refuse(() => { /* unchanged */ }, /approved ceiling/, terms, 1n))
  it('extra calldata bytes', () => refuse(x => { x.send.data += '00' }, /extra bytes|not a ccipSend/))
  it('another lane (Robinhood selector)', () => {
    refuse(x => {
      const router = parseAbi(['function ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32)'])
      x.send.data = encodeFunctionData({ abi: router, functionName: 'ccipSend', args: [1n, {
        receiver: ('0x' + '00'.repeat(32)) as Hex, data: '0x', tokenAmounts: [{ token: getAddress(CBADA.base.token), amount: 10_000_000n }],
        feeToken: '0x0000000000000000000000000000000000000000', extraArgs: svmTokenTransferExtraArgs(RECIPIENT) }] })
    }, /lane other than Base -> Solana/)
  })
  it('a fee paid in a token, or a payload to a program', () => {
    const router = parseAbi(['function ccipSend(uint64 destinationChainSelector, (bytes receiver, bytes data, (address token, uint256 amount)[] tokenAmounts, address feeToken, bytes extraArgs) message) payable returns (bytes32)'])
    const msg = (o: Record<string, unknown>) => encodeFunctionData({ abi: router, functionName: 'ccipSend', args: [CBADA.solana.selector, {
      receiver: ('0x' + '00'.repeat(32)) as Hex, data: '0x', tokenAmounts: [{ token: getAddress(CBADA.base.token), amount: 10_000_000n }],
      feeToken: '0x0000000000000000000000000000000000000000', extraArgs: svmTokenTransferExtraArgs(RECIPIENT), ...o }] })
    refuse(x => { x.send.data = msg({ feeToken: getAddress(CBADA.base.token) }) }, /fee in a token/)
    refuse(x => { x.send.data = msg({ data: '0x1234' }) }, /receiver program or payload/)
  })
})

describe('simulateCbAdaSend (fake client)', () => {
  function client(over: Record<string, unknown> = {}) {
    const values: Record<string, unknown> = {
      isChainSupported: true, getOnRamp: BASE_SOLANA_ONRAMP, isSupportedChain: true, getToken: CBADA.base.token,
      getCurrentRateLimiterState: [{ tokens: CBADA.laneCapacityRaw, lastUpdated: 0, isEnabled: true, capacity: CBADA.laneCapacityRaw, rate: 1n },
        { tokens: 0n, lastUpdated: 0, isEnabled: false, capacity: 0n, rate: 0n }],
      balanceOf: 50_000_000n, allowance: 0n, ...over,
    }
    return {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]),
      getBalance: vi.fn(async () => (over.eth as bigint) ?? 10n ** 17n),
      call: vi.fn(async ({ to }: { to: string }) => ({ data: to.toLowerCase() === CBADA.base.router.toLowerCase() ? MSG_ID : '0x' + '00'.repeat(31) + '01' })),
    } as never
  }

  it('with no allowance: the approval simulates, the send waits for it', async () => {
    const r = await simulateCbAdaSend(client(), buildCbAdaBaseToSolana(terms, 0n), terms, 10n ** 15n)
    expect(r).toMatchObject({ approveSimulated: 'ok', sendSimulated: 'needs-approval', problems: [] })
    expect(r.lane).toMatchObject({ routerSupports: true, poolSupports: true, onRampPinned: true })
  })

  it('with the allowance in place: the send simulates and yields an INDICATIVE message id', async () => {
    const r = await simulateCbAdaSend(client({ allowance: 10_000_000n }), buildCbAdaBaseToSolana(terms, 10_000_000n), terms, 10n ** 15n)
    expect(r).toMatchObject({ approveSimulated: 'not-needed', sendSimulated: 'ok', simulatedMessageId: MSG_ID })
  })

  it('reports short balances, an unsupported lane and a changed OnRamp', async () => {
    const r = await simulateCbAdaSend(client({ balanceOf: 1n, isChainSupported: false, getOnRamp: '0x' + '44'.repeat(20), eth: 1n }), buildCbAdaBaseToSolana(terms, 0n), terms, 10n ** 15n)
    expect(r.problems.join(' ')).toMatch(/Solana lane/)
    expect(r.problems.join(' ')).toMatch(/enough cbADA/)
    expect(r.problems.join(' ')).toMatch(/enough ETH/)
    expect(r.problems.join(' ')).toMatch(/different OnRamp/)
  })

  it('fails closed: an unreadable pool token, and ETH that covers the fee but not the gas reserve', async () => {
    const unreadable = await simulateCbAdaSend(client({ getToken: null }), buildCbAdaBaseToSolana(terms, 0n), terms, 10n ** 15n)
    expect(unreadable.problems.join(' ')).toMatch(/could not be confirmed as cbADA/)
    const feeOnly = await simulateCbAdaSend(client({ eth: BigInt(terms.feeWei) }), buildCbAdaBaseToSolana(terms, 0n), terms, 10n ** 15n)
    expect(feeOnly.problems.join(' ')).toMatch(/maximum network gas/)
  })

  it('reads the v2 default outbound bucket and refuses unreadable or insufficient live capacity', async () => {
    const txs = buildCbAdaBaseToSolana(terms, 0n)
    const ok = client()
    const report = await simulateCbAdaSend(ok, txs, terms, 10n ** 15n)
    expect((ok as { readContract: ReturnType<typeof vi.fn> }).readContract).toHaveBeenCalledWith(expect.objectContaining({
      functionName: 'getCurrentRateLimiterState', args: [CBADA.solana.selector, false],
    }))
    expect(report.outboundRateLimit).toEqual({ enabled: true, availableRaw: CBADA.laneCapacityRaw.toString(), capacityRaw: CBADA.laneCapacityRaw.toString() })
    for (const state of [null, [{ tokens: 9_999_999n, capacity: CBADA.laneCapacityRaw, isEnabled: true }],
      [{ tokens: 9_999_999n, capacity: 9_999_999n, isEnabled: true }]]) {
      const result = await simulateCbAdaSend(client({ getCurrentRateLimiterState: state }), txs, terms, 10n ** 15n)
      expect(result.problems.join(' ')).toMatch(/rate limit/)
    }
  })
})

// ── Message id from the confirmed transaction ────────────────────────────────

function cbAdaEvent(over: { sender?: string; amount?: bigint; recipient?: string; pool?: string; dest?: bigint } = {}) {
  const message = {
    header: { messageId: MSG_ID, sourceChainSelector: CBADA.base.selector, destChainSelector: over.dest ?? CBADA.solana.selector, sequenceNumber: 77n, nonce: 0n },
    sender: getAddress(over.sender ?? SENDER), data: '0x' as Hex, receiver: ('0x' + '00'.repeat(32)) as Hex,
    extraArgs: svmTokenTransferExtraArgs(over.recipient ?? RECIPIENT), feeToken: '0x0000000000000000000000000000000000000000' as Hex,
    feeTokenAmount: 1n, feeValueJuels: 1n,
    tokenAmounts: [{ sourcePoolAddress: getAddress(over.pool ?? CBADA.base.pool), destTokenAddress: MINT_HEX, extraData: '0x' as Hex, amount: over.amount ?? 10_000_000n, destExecData: '0x' as Hex }],
  }
  const topics = encodeEventTopics({ abi: [CCIP_MESSAGE_SENT], eventName: 'CCIPMessageSent', args: { destChainSelector: message.header.destChainSelector, sequenceNumber: 77n } })
  const data = encodeAbiParameters(CCIP_MESSAGE_SENT.inputs.slice(2), [message])
  return { address: BASE_SOLANA_ONRAMP.toLowerCase(), topics: topics as string[], data }
}
const receiptWith = (logs: ReceiptLike['logs'], status = '0x1'): ReceiptLike => ({ status, transactionHash: '0x' + 'cd'.repeat(32), logs })

describe('messageIdFromReceipt', () => {
  const real = JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'ccip', 'base-ccip-send-receipt.json'), 'utf8')).receipt as ReceiptLike

  it('decodes the real OnRamp event, and refuses it for cbADA terms (another sender and token)', () => {
    expect(() => messageIdFromReceipt(real, terms)).toThrow(/sent by another address/)
    expect(() => messageIdFromReceipt(real, { ...terms, sender: '0xd791156A50c586c4E8b313d35BC8017b2556DfCc' })).toThrow(/token other than cbADA/)
  })

  it('reads the id of a cbADA send held to the approved terms', () => {
    expect(messageIdFromReceipt(receiptWith([cbAdaEvent()]), terms)).toEqual({ messageId: MSG_ID, sequenceNumber: '77' })
  })

  it('refuses a failed send, a missing or doubled message, and every mismatch', () => {
    expect(() => messageIdFromReceipt(receiptWith([cbAdaEvent()], '0x0'), terms)).toThrow(/did not succeed/)
    expect(() => messageIdFromReceipt(receiptWith([]), terms)).toThrow(/no CCIP message/)
    expect(() => messageIdFromReceipt(receiptWith([cbAdaEvent(), cbAdaEvent()]), terms)).toThrow(/more than one/)
    expect(() => messageIdFromReceipt(receiptWith([{ ...cbAdaEvent(), address: '0x' + '55'.repeat(20) }]), terms)).toThrow(/no CCIP message/)
    expect(() => messageIdFromReceipt(receiptWith([cbAdaEvent({ amount: 1n })]), terms)).toThrow(/different amount/)
    expect(() => messageIdFromReceipt(receiptWith([cbAdaEvent({ recipient: base58.encode(new Uint8Array(32).fill(7)) })]), terms)).toThrow(/different Solana recipient/)
    expect(() => messageIdFromReceipt(receiptWith([cbAdaEvent({ pool: '0x' + '66'.repeat(20) })]), terms)).toThrow(/other than cbADA/)
    expect(() => messageIdFromReceipt(receiptWith([cbAdaEvent({ dest: 1n })]), terms)).toThrow(/another lane/)
  })
})

describe('journey persistence around the send', () => {
  const BASE_CB = { chain: 'base' as const, address: CBADA.base.token, symbol: 'cbADA', decimals: 6 }
  const SOL_CB = { chain: 'solana' as const, address: CBADA.solana.token, symbol: 'cbADA', decimals: 6 }
  function setup() {
    let map: Record<string, string> = {}
    const store = journeyMapStore(async () => map, async (m) => { map = m }, createJourneyWriteQueue())
    let j = createJourney({ id: 'j1', walletId: 'w', now: 1, bridge: 'ccip-cbada', recipient: RECIPIENT, source: BASE_CB, usdcx: BASE_CB, usdc: SOL_CB, destination: SOL_CB })
    j = approveLeg(j, 'bridge', '10000000', 2, '10000000')
    return { store, j, map: () => map }
  }

  it('the hash is stored before broadcast; the id is recovered later by that hash and stored once', async () => {
    const { store, j } = setup()
    const sent = await recordSignedBridgeSend(store, j, '0x' + 'cd'.repeat(32), 3)
    expect((await store.get('j1'))!.legs[1]).toMatchObject({ state: 'submitted', txHash: '0x' + 'cd'.repeat(32), providerRef: null })
    // Interrupted before confirmation: nothing to read yet, nothing re-sent.
    const pending = await recoverBridgeReference(store, sent, terms, async () => null, 4)
    expect(pending.messageId).toBeNull()
    const getReceipt = vi.fn(async () => receiptWith([cbAdaEvent()]))
    const done = await recoverBridgeReference(store, (await store.get('j1'))!, terms, getReceipt, 5)
    expect(done.messageId).toBe(MSG_ID)
    expect((await store.get('j1'))!.legs[1].providerRef).toBe(MSG_ID)
    // Once stored, the reference is read back without asking the chain again.
    await recoverBridgeReference(store, done.journey, terms, getReceipt, 6)
    expect(getReceipt).toHaveBeenCalledTimes(1)
  })

  it('never binds an OnRamp event from a receipt for a different transaction', async () => {
    const { store, j } = setup()
    const sent = await recordSignedBridgeSend(store, j, '0x' + 'cd'.repeat(32), 3)
    const otherReceipt = { ...receiptWith([cbAdaEvent()]), transactionHash: '0x' + 'ee'.repeat(32) }
    await expect(recoverBridgeReference(store, sent, terms, async () => otherReceipt, 4)).rejects.toThrow(/receipt.*hash/i)
    expect((await store.get('j1'))!.legs[1].providerRef).toBeNull()
  })

  it('the store refuses a journey that replaces a recorded hash or reference', async () => {
    const { store, j } = setup()
    const sent = await recordSignedBridgeSend(store, j, '0x' + 'cd'.repeat(32), 3)
    const replaced = { ...sent, legs: [sent.legs[0], { ...sent.legs[1], txHash: '0x' + 'ee'.repeat(32) }, sent.legs[2]] } as typeof sent
    await expect(store.put(replaced)).rejects.toThrow(/never replaced/)
    const confirmed = recordLegOutcome(recordLegSubmitted(approveLeg(createJourney({ id: 'j2', walletId: 'w', now: 1, bridge: 'ccip-cbada', recipient: RECIPIENT,
      source: BASE_CB, usdcx: BASE_CB, usdc: SOL_CB, destination: SOL_CB }), 'bridge', '1', 2, '1'), 'bridge', '0x' + 'ab'.repeat(32), 3), 'bridge', { state: 'confirmed', measuredOutputRaw: '1' }, 4)
    await store.put(confirmed)
    await expect(store.put({ ...confirmed, status: 'active', legs: [confirmed.legs[0], { ...confirmed.legs[1], state: 'uncertain' }, confirmed.legs[2]] } as typeof confirmed))
      .rejects.toThrow()
  })
})

// ── Solana delivery ───────────────────────────────────────────────────────────

const disc = (name: string) => sha256(new TextEncoder().encode(`event:${name}`)).slice(0, 8)
function u64(v: bigint) { const b = new Uint8Array(8); for (let i = 0; i < 8; i++) b[i] = Number((v >> BigInt(8 * i)) & 0xffn); return b }
function executionEvent(messageId: string, state: number, source: bigint = CBADA.base.selector): string {
  const id = Uint8Array.from((messageId.replace(/^0x/, '').match(/../g) ?? []).map(h => parseInt(h, 16)))
  return 'Program data: ' + base64.encode(new Uint8Array([...disc('ExecutionStateChanged'), ...u64(source), ...u64(77n), ...id, ...new Uint8Array(32), state]))
}
const tokenBal = (owner: string, amount: string) => ({ mint: CBADA.solana.token, owner, uiTokenAmount: { amount } })
function solanaTx(logs: string[], pre = '0', post = '10000000', err: unknown = null) {
  return { meta: { err, logMessages: [`Program ${SOLANA_OFFRAMP} invoke [1]`, 'Program log: Instruction: Execute', ...logs],
    preTokenBalances: [tokenBal(RECIPIENT, pre)], postTokenBalances: [tokenBal(RECIPIENT, post)] } }
}
const expectation = { messageId: MSG_ID, recipient: RECIPIENT, amountRaw: '10000000' }

describe('verifySolanaCbAdaDelivery', () => {
  it('delivered: the OffRamp executed THIS message successfully and the recipient got exactly the amount', () => {
    expect(verifySolanaCbAdaDelivery(solanaTx([executionEvent(MSG_ID, 2)]), expectation)).toEqual({ state: 'delivered', sequenceNumber: '77' })
  })

  it('does not credit an event emitted by another program in the same transaction', () => {
    const other = '11111111111111111111111111111111'
    const tx = solanaTx([
      `Program ${SOLANA_OFFRAMP} success`,
      `Program ${other} invoke [1]`,
      executionEvent(MSG_ID, 2),
      `Program ${other} success`,
    ])
    expect(verifySolanaCbAdaDelivery(tx, expectation).state).toBe('not-this-message')
  })

  it('accepts the OffRamp event after a nested program returns', () => {
    const other = '11111111111111111111111111111111'
    const tx = solanaTx([
      `Program ${other} invoke [2]`,
      `Program ${other} success`,
      executionEvent(MSG_ID, 2),
      `Program ${SOLANA_OFFRAMP} success`,
    ])
    expect(verifySolanaCbAdaDelivery(tx, expectation).state).toBe('delivered')
  })

  it('a real "already executed" skip is not a delivery, though the transaction succeeded', () => {
    // Observed on mainnet 2026-10-05: SkippedAlreadyExecutedMessage{source: Base, sequence 13541}.
    const v = verifySolanaCbAdaDelivery(solanaTx(['Program data: fIjY5xnoBe+C/0rkz0Gm3eU0AAAAAAAA'], '0', '0'), expectation)
    expect(v).toEqual({ state: 'not-this-message', reason: 'the OffRamp skipped an already-executed message' })
  })

  it('another message id, another source, or not the OffRamp: not this delivery', () => {
    expect(verifySolanaCbAdaDelivery(solanaTx([executionEvent('0x' + '01'.repeat(32), 2)]), expectation).state).toBe('not-this-message')
    expect(verifySolanaCbAdaDelivery(solanaTx([executionEvent(MSG_ID, 2, 1n)]), expectation).state).toBe('not-this-message')
    const notOffRamp = solanaTx([executionEvent(MSG_ID, 2)])
    notOffRamp.meta.logMessages[0] = 'Program 11111111111111111111111111111111 invoke [1]'
    expect(verifySolanaCbAdaDelivery(notOffRamp, expectation)).toMatchObject({ state: 'not-this-message', reason: 'not a CCIP OffRamp execution' })
    expect(verifySolanaCbAdaDelivery(solanaTx([executionEvent(MSG_ID, 2)], '0', '10000000', { InstructionError: [0, 'x'] }), expectation).state).toBe('not-this-message')
  })

  it('an execution in state Failure is reported as failed, not delivered and not refunded', () => {
    expect(verifySolanaCbAdaDelivery(solanaTx([executionEvent(MSG_ID, 3)], '0', '0'), expectation)).toEqual({ state: 'execution-failed', sequenceNumber: '77' })
  })

  it('a different credit than approved is flagged', () => {
    expect(verifySolanaCbAdaDelivery(solanaTx([executionEvent(MSG_ID, 2)], '5', '9000005'), expectation)).toEqual({ state: 'credit-mismatch', creditedRaw: '9000000' })
  })
})
