/**
 * Ethereum source-deposit proof. No network: the public transaction
 * 0x9695d030… was recorded read-only (below) and every other case is derived
 * from it.
 *
 * THE PUBLIC TRANSACTION IS NOT AN APPROVABLE DEPOSIT, and that is a test of
 * its own: its hookData is the undocumented 95-zero-byte form, which
 * buildCardanoDepositRequest never produces (docs/XRESERVE-GATE2-RESEARCH.md),
 * so against any approval the wallet could make it must come back
 * `not-approved`. The VERIFIED path uses a DERIVED copy that differs only in
 * carrying the builder's exact calldata and the matching event bytes. The
 * derived copy keeps the real hash, block and receipt identity — this pure
 * module does not recompute a transaction hash from signed fields (the trusted
 * provider is relied on for that binding).
 */
import { describe, it, expect } from 'vitest'
import { encodeAbiParameters, pad, type Hex } from 'viem'
import {
  verifyXReserveEthereumDeposit, decodeDepositedToRemoteLog, DEPOSITED_TO_REMOTE_TOPIC,
  type VerifyEthereumDepositInput,
} from './xreserve-ethereum-deposit-proof'
import { buildCardanoDepositRequest, XRESERVE_ETHEREUM_MAINNET, type CardanoDepositInput } from './xreserve-cardano-deposit'

/**
 * Ethereum mainnet, recorded read-only 2026-09-29 01:36 UTC from ethereum-rpc.publicnode.com:
 * eth_getTransactionByHash / eth_getTransactionReceipt / eth_getBlockByNumber(receipt.blockNumber, false)
 * (header trimmed to the fields read) / eth_blockNumber.
 */
const ETH_TX = {
 "type": "0x2",
 "chainId": "0x1",
 "nonce": "0x41",
 "gas": "0x336dc",
 "maxFeePerGas": "0x3ffae82",
 "maxPriorityFeePerGas": "0x27053",
 "to": "0x8888888199b2df864bf678259607d6d5ebb4e3ce",
 "value": "0x0",
 "accessList": [],
 "input": "0xfaadb53b00000000000000000000000000000000000000000000000000000000713f8ff90000000000000000000000000000000000000000000000000000000000002714000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000098968000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000005f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
 "r": "0xc5c393efd815a0a532bc77e451c887324a965de2582b49b0b6950ab5077467e4",
 "s": "0x3af7d5bc4994210dcda0c47b9d647aaad16223cbd0e9187a3ae7f77bc0d5e079",
 "yParity": "0x0",
 "v": "0x0",
 "hash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
 "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
 "blockNumber": "0x18da052",
 "transactionIndex": "0x95",
 "from": "0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863",
 "gasPrice": "0x36fe7e1",
 "blockTimestamp": "0x6ab736d3"
}

const ETH_RECEIPT = {
 "type": "0x2",
 "status": "0x1",
 "cumulativeGasUsed": "0x180c8fc",
 "logs": [
  {
   "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
   "topics": [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x000000000000000000000000d0402a74d8d05e7c4a78e5e01fed14f94c0f4863",
    "0x0000000000000000000000008888888199b2df864bf678259607d6d5ebb4e3ce"
   ],
   "data": "0x00000000000000000000000000000000000000000000000000000000713f8ff9",
   "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
   "blockNumber": "0x18da052",
   "blockTimestamp": "0x6ab736d3",
   "transactionHash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
   "transactionIndex": "0x95",
   "logIndex": "0x629",
   "removed": false
  },
  {
   "address": "0x8888888199b2df864bf678259607d6d5ebb4e3ce",
   "topics": [
    "0x2eef4ec627e0f99d1cc55f26e234a6066090b7bc0b3f61245f1f2d7c91d3e563",
    "0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "0x000000000000000000000000d0402a74d8d05e7c4a78e5e01fed14f94c0f4863",
    "0x000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9"
   ],
   "data": "0x00000000000000000000000000000000000000000000000000000000713f8ff900000000000000000000000000000000000000000000000000000000000027149ea9794d33dbcef3f77718e903816e877ab2577f4d7ee653638f1f60fc671dd6000000000000000000000000000000000000000000000000000000000098968000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000005f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
   "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
   "blockNumber": "0x18da052",
   "blockTimestamp": "0x6ab736d3",
   "transactionHash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
   "transactionIndex": "0x95",
   "logIndex": "0x62a",
   "removed": false
  },
  {
   "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
   "topics": [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x0000000000000000000000008888888199b2df864bf678259607d6d5ebb4e3ce",
    "0x00000000000000000000000077777777dcc4d5a8b6e418fd04d8997ef11000ee"
   ],
   "data": "0x00000000000000000000000000000000000000000000000000000000713f8ff9",
   "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
   "blockNumber": "0x18da052",
   "blockTimestamp": "0x6ab736d3",
   "transactionHash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
   "transactionIndex": "0x95",
   "logIndex": "0x62b",
   "removed": false
  },
  {
   "address": "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee",
   "topics": [
    "0x4174a9435a04d04d274c76779cad136a41fde6937c56241c09ab9d3c7064a1a9",
    "0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "0x000000000000000000000000866e992217e0bfb8371f9ad32a53dcc47d1aa04e",
    "0x0000000000000000000000008888888199b2df864bf678259607d6d5ebb4e3ce"
   ],
   "data": "0x00000000000000000000000000000000000000000000000000000000713f8ff9",
   "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
   "blockNumber": "0x18da052",
   "blockTimestamp": "0x6ab736d3",
   "transactionHash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
   "transactionIndex": "0x95",
   "logIndex": "0x62c",
   "removed": false
  }
 ],
 "logsBloom": "0x80000000400000000000000000000200000000000000000000000000000001000000000000000800000202010000400000000000000000000008000010000040000000000000000008000018000000000004000000000000000000000000000100000000000000000000000000000000000001000000000000008011000000000000000000000000000000020000000200000000010000080000000000400000000000040000200000000000000000000000000000000000001000040000000000000002000000000000000000000000000000000000000000000400000000000000000000000000000208000000000004004000000000000000000000000000",
 "transactionHash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
 "transactionIndex": "0x95",
 "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
 "blockNumber": "0x18da052",
 "gasUsed": "0x1d7a5",
 "effectiveGasPrice": "0x36fe7e1",
 "from": "0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863",
 "to": "0x8888888199b2df864bf678259607d6d5ebb4e3ce",
 "contractAddress": null
}

const ETH_BLOCK = {
 "number": "0x18da052",
 "hash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
 "parentHash": "0x8e2749cc83d14e64a07835853e20aea68b7f757ae6011d60d53eb6282fc8011a",
 "timestamp": "0x6ab736d3"
}

const ETH_TIP = '0x18df282'

const SOURCE = ETH_TX.hash
const SENDER = '0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863'
/** Enterprise address for the recipient credential in the real deposit (1c75c5…6363c9). */
const RECIPIENT = 'addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax'
const APPROVED: CardanoDepositInput = { recipient: RECIPIENT, amountRaw: 1_899_991_033n, maxFeeRaw: 10_000_000n }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const EVENT_LOG_INDEX = ETH_RECEIPT.logs.findIndex(l => l.topics[0] === DEPOSITED_TO_REMOTE_TOPIC)

/** Event data (non-indexed fields) for a given hookData, keeping the real value/domain/remoteToken/maxFee. */
function eventData(hookData: Hex, over: Partial<{ value: bigint; domain: number; maxFee: bigint }> = {}): Hex {
  const real = decodeDepositedToRemoteLog(ETH_RECEIPT.logs[EVENT_LOG_INDEX])
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes' }],
    [over.value ?? real.value, over.domain ?? real.remoteDomain, real.remoteToken as Hex, over.maxFee ?? real.maxFee, hookData],
  )
}

/** The public evidence, as recorded. */
const publicEvidence = () => ({
  transaction: clone(ETH_TX) as Record<string, unknown>,
  receipt: clone(ETH_RECEIPT) as unknown as { logs: Array<{ address: string; topics: string[]; data: string; removed?: boolean }> } & Record<string, unknown>,
  block: clone(ETH_BLOCK) as Record<string, unknown>,
  tipBlockNumber: ETH_TIP as unknown,
})

/** The same evidence, carrying the BUILDER's calldata and the matching event — the approvable deposit. */
function derivedEvidence() {
  const e = publicEvidence()
  e.transaction.input = buildCardanoDepositRequest(APPROVED).data
  e.receipt.logs[EVENT_LOG_INDEX].data = eventData('0x')
  return e
}
const input = (evidence: ReturnType<typeof publicEvidence>, over: Partial<VerifyEthereumDepositInput> = {}): VerifyEthereumDepositInput =>
  ({ sourceTxHash: SOURCE, approved: APPROVED, approvedSender: SENDER, evidence, minConfirmations: 12, ...over })
const codeOf = (i: VerifyEthereumDepositInput) => {
  const r = verifyXReserveEthereumDeposit(i)
  return `${r.state}/${r.code}`
}

describe('the recorded public transaction', () => {
  it('its DepositedToRemote event decodes, independently of the builder, to the deposit Circle attested', () => {
    expect(DEPOSITED_TO_REMOTE_TOPIC).toBe('0x2eef4ec627e0f99d1cc55f26e234a6066090b7bc0b3f61245f1f2d7c91d3e563')
    const log = ETH_RECEIPT.logs[EVENT_LOG_INDEX]
    expect(log.address).toBe(XRESERVE_ETHEREUM_MAINNET.xReserve.toLowerCase())
    expect(decodeDepositedToRemoteLog(log)).toEqual({
      localToken: XRESERVE_ETHEREUM_MAINNET.usdc.toLowerCase(),
      value: 1_899_991_033n,
      localDepositor: SENDER,
      remoteRecipient: '0x000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9',
      remoteDomain: 10004,
      // Equal to the remoteToken field of Circle's attested DepositIntent for this deposit.
      remoteToken: '0x9ea9794d33dbcef3f77718e903816e877ab2577f4d7ee653638f1f60fc671dd6',
      maxFee: 10_000_000n,
      hookData: `0x${'00'.repeat(95)}`,
    })
  })

  it('is NOT the deposit the wallet would approve: its calldata carries the undocumented 95-zero hookData', () => {
    const r = verifyXReserveEthereumDeposit(input(publicEvidence()))
    expect(r).toMatchObject({ state: 'not-approved', code: 'calldata-mismatch', retryable: false })
  })
})

describe('the approvable deposit (derived) verifies at depth', () => {
  it('verified: every rule holds, 21,041 blocks deep', () => {
    const r = verifyXReserveEthereumDeposit(input(derivedEvidence()))
    expect(r).toMatchObject({ state: 'verified', code: 'verified', retryable: false, confirmations: 21041n, blockHash: ETH_BLOCK.hash })
    expect(r.deposit).toMatchObject({ value: 1_899_991_033n, remoteDomain: 10004, maxFee: 10_000_000n, hookData: '0x' })
    expect(r.event).toMatchObject({ localDepositor: SENDER, value: 1_899_991_033n, hookData: '0x' })
  })

  it('shallow → pending (retryable), then verified once deep enough', () => {
    const e = derivedEvidence()
    e.tipBlockNumber = ETH_BLOCK.number                                    // 1 confirmation
    expect(verifyXReserveEthereumDeposit(input(e))).toMatchObject({ state: 'pending', code: 'insufficient-confirmations', retryable: true, confirmations: 1n })
    e.tipBlockNumber = `0x${(BigInt(ETH_BLOCK.number) + 11n).toString(16)}`   // exactly 12
    expect(verifyXReserveEthereumDeposit(input(e))).toMatchObject({ state: 'verified', confirmations: 12n })
  })
})

describe('not the approved deposit', () => {
  it('altered calldata: another amount, fee, recipient, or one extra byte', () => {
    for (const approved of [{ ...APPROVED, amountRaw: 1_899_991_034n }, { ...APPROVED, maxFeeRaw: 9_999_999n },
      { ...APPROVED, recipient: 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8' }]) {
      expect(codeOf(input(derivedEvidence(), { approved }))).toBe('not-approved/calldata-mismatch')
    }
    const e = derivedEvidence(); e.transaction.input = `${e.transaction.input}00`
    expect(codeOf(input(e))).toBe('not-approved/calldata-mismatch')
  })
  it('another sender', () => {
    expect(codeOf(input(derivedEvidence(), { approvedSender: '0x1111111111111111111111111111111111111111' }))).toBe('not-approved/wrong-sender')
  })
  it('another destination, ETH value, or chain', () => {
    const to = derivedEvidence(); to.transaction.to = '0x008888878f94c0d87defdf0b07f46b93c1934442'
    expect(codeOf(input(to))).toBe('not-approved/wrong-destination')
    const value = derivedEvidence(); value.transaction.value = '0x1'
    expect(codeOf(input(value))).toBe('not-approved/nonzero-value')
    const chain = derivedEvidence(); chain.transaction.chainId = '0xaa36a7'
    expect(codeOf(input(chain))).toBe('not-approved/wrong-chain')
  })
})

describe('event evidence must be exact and unambiguous', () => {
  const withEvent = (mutate: (log: { address: string; topics: string[]; data: string; removed?: boolean }) => void) => {
    const e = derivedEvidence(); mutate(e.receipt.logs[EVENT_LOG_INDEX]); return e
  }
  it('an event field that contradicts the (matching) calldata', () => {
    expect(codeOf(input(withEvent(l => { l.data = eventData('0x', { value: 1n }) })))).toBe('evidence-inconsistent/event-mismatch')
    expect(codeOf(input(withEvent(l => { l.data = eventData('0x', { maxFee: 1n }) })))).toBe('evidence-inconsistent/event-mismatch')
    expect(codeOf(input(withEvent(l => { l.data = eventData('0x', { domain: 10003 }) })))).toBe('evidence-inconsistent/event-mismatch')
    expect(codeOf(input(withEvent(l => { l.data = eventData(`0x${'00'.repeat(95)}`) })))).toBe('evidence-inconsistent/event-mismatch')
    expect(codeOf(input(withEvent(l => { l.topics[1] = pad('0xdac17f958d2ee523a2206206994597c13d831ec7') })))).toBe('evidence-inconsistent/event-mismatch')
    expect(codeOf(input(withEvent(l => { l.topics[2] = pad('0x1111111111111111111111111111111111111111') })))).toBe('evidence-inconsistent/event-mismatch')
    expect(codeOf(input(withEvent(l => { l.topics[3] = `0x00000001${'ab'.repeat(28)}` })))).toBe('evidence-inconsistent/event-mismatch')
  })
  it('the event from another contract does not count — so it is missing', () => {
    expect(codeOf(input(withEvent(l => { l.address = '0x77777777dcc4d5a8b6e418fd04d8997ef11000ee' })))).toBe('evidence-inconsistent/event-missing')
  })
  it('a missing or duplicated event', () => {
    const none = derivedEvidence(); none.receipt.logs.splice(EVENT_LOG_INDEX, 1)
    expect(codeOf(input(none))).toBe('evidence-inconsistent/event-missing')
    const two = derivedEvidence(); two.receipt.logs.push(clone(two.receipt.logs[EVENT_LOG_INDEX]))
    expect(codeOf(input(two))).toBe('evidence-inconsistent/event-ambiguous')
  })
  it('a removed (reorged) log, or one that does not decode', () => {
    expect(codeOf(input(withEvent(l => { l.removed = true })))).toBe('evidence-inconsistent/log-removed')
    expect(codeOf(input(withEvent(l => { l.data = '0x1234' })))).toBe('evidence-inconsistent/malformed')
  })
})

describe('receipt, block and status', () => {
  it('a receipt for another transaction, or in another block', () => {
    const other = derivedEvidence(); other.receipt.transactionHash = `0x${'ab'.repeat(32)}`
    expect(codeOf(input(other))).toBe('evidence-inconsistent/receipt-mismatch')
    const moved = derivedEvidence(); moved.receipt.blockHash = `0x${'cd'.repeat(32)}`
    expect(codeOf(input(moved))).toBe('evidence-inconsistent/receipt-mismatch')
    const idx = derivedEvidence(); idx.receipt.transactionIndex = '0x1'
    expect(codeOf(input(idx))).toBe('evidence-inconsistent/receipt-mismatch')
  })
  it('a block header that is not the receipt\'s block (reorg)', () => {
    const e = derivedEvidence(); e.block.hash = `0x${'ef'.repeat(32)}`
    expect(codeOf(input(e))).toBe('evidence-inconsistent/block-mismatch')
    const missing = derivedEvidence(); missing.block = null as never
    expect(codeOf(input(missing))).toBe('evidence-inconsistent/block-missing')
  })
  it('a failed transaction is terminal, and never verified', () => {
    const e = derivedEvidence(); e.receipt.status = '0x0'
    expect(verifyXReserveEthereumDeposit(input(e))).toMatchObject({ state: 'failed', code: 'reverted', retryable: false })
  })
  it('not yet known, not yet mined, or mined without a receipt', () => {
    const unknown = derivedEvidence(); unknown.transaction = null as never
    expect(codeOf(input(unknown))).toBe('pending/not-found')
    const pending = derivedEvidence(); pending.transaction.blockNumber = null; pending.transaction.blockHash = null
    expect(codeOf(input(pending))).toBe('pending/not-mined')
    const noReceipt = derivedEvidence(); noReceipt.receipt = null as never
    expect(codeOf(input(noReceipt))).toBe('evidence-inconsistent/receipt-missing')
  })
  it('the provider returned another transaction, or a tip behind the block', () => {
    const e = derivedEvidence(); e.transaction.hash = `0x${'ab'.repeat(32)}`
    expect(codeOf(input(e))).toBe('evidence-inconsistent/hash-mismatch')
    const behind = derivedEvidence(); behind.tipBlockNumber = '0x1'
    expect(codeOf(input(behind))).toBe('evidence-inconsistent/tip-behind')
  })
  it('invalid caller input', () => {
    expect(codeOf(input(derivedEvidence(), { sourceTxHash: '0x12' }))).toBe('invalid-input/invalid-input')
    expect(codeOf(input(derivedEvidence(), { approvedSender: 'nope' }))).toBe('invalid-input/invalid-input')
    expect(codeOf(input(derivedEvidence(), { minConfirmations: 0 }))).toBe('invalid-input/invalid-input')
    expect(codeOf(input(derivedEvidence(), { approved: { ...APPROVED, maxFeeRaw: APPROVED.amountRaw } }))).toBe('invalid-input/invalid-input')
  })
})
