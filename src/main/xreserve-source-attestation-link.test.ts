/**
 * Source-to-attestation link. No network.
 *
 *   • The REAL public Ethereum transaction 0x9695d030… (recorded read-only,
 *     below) is not an approvable wallet deposit — its hookData is the
 *     undocumented 95-zero-byte form — so it stays `source-not-approved`.
 *   • The POSITIVE case is SYNTHETIC and labelled so: the recorded evidence
 *     with the wallet builder's calldata and matching event, plus a Circle
 *     attestation built here from Circle's published DepositIntent layout with
 *     a placeholder signature. It is NOT a live, verified wallet-built deposit.
 */
import { describe, it, expect } from 'vitest'
import { encodeAbiParameters, keccak256, type Hex } from 'viem'
import { linkXReserveSourceToAttestation, type LinkInput, type LinkedField } from './xreserve-source-attestation-link'
import { decodeDepositedToRemoteLog, DEPOSITED_TO_REMOTE_TOPIC } from './xreserve-ethereum-deposit-proof'
import { buildCardanoDepositRequest, type CardanoDepositInput } from './xreserve-cardano-deposit'

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
/** GET https://xreserve-api.circle.com/v1/attestations?txHash=0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2, recorded 2026-09-27 23:49 UTC. */
const CIRCLE_RESPONSE = {
  "attestations": [
    {
      "remoteDomain": 10004,
      "payload": "0x5a2e0acd0000000100000000000000000000000000000000000000000000000000000000713f8ff9000027149ea9794d33dbcef3f77718e903816e877ab2577f4d7ee653638f1f60fc671dd6000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000d0402a74d8d05e7c4a78e5e01fed14f94c0f486300000000000000000000000000000000000000000000000000000000009896801a2546a6091864db9d016e6588a48d31b706c8c8becb903b1aac6e811e7f70a90000005f0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
      "messageHash": "0x2630e4dcac36445673096a668c29fc06b0b0ec89f058dcbb5aa2097b3a752c69",
      "attestation": "0x511b4362647330a3222f480b8e9cc4b3435241f006d039eb787423ee7e35751c466670f08add272632d703bff1f70fe9439d2494bf6da42953603be47cdacac31c"
    }
  ]
}


const SOURCE = ETH_TX.hash
const SENDER = '0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863'
const RECIPIENT = 'addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax'
const APPROVED: CardanoDepositInput = { recipient: RECIPIENT, amountRaw: 1_899_991_033n, maxFeeRaw: 10_000_000n }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const EVENT_LOG = ETH_RECEIPT.logs.findIndex(l => l.topics[0] === DEPOSITED_TO_REMOTE_TOPIC)
const REAL_EVENT = decodeDepositedToRemoteLog(ETH_RECEIPT.logs[EVENT_LOG])

/** SYNTHETIC: the recorded evidence carrying the builder's calldata and the matching (empty-hookData) event. */
function derivedEvidence() {
  const e = {
    transaction: clone(ETH_TX) as Record<string, unknown>,
    receipt: clone(ETH_RECEIPT) as unknown as { logs: Array<{ data: string }>; status: string } & Record<string, unknown>,
    block: clone(ETH_BLOCK) as Record<string, unknown>,
    tipBlockNumber: ETH_TIP as unknown,
  }
  e.transaction.input = buildCardanoDepositRequest(APPROVED).data
  e.receipt.logs[EVENT_LOG].data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes' }],
    [REAL_EVENT.value, REAL_EVENT.remoteDomain, REAL_EVENT.remoteToken as Hex, REAL_EVENT.maxFee, '0x'])
  return e
}

/** DepositIntent fields for the SYNTHETIC attestation — by default, exactly the derived deposit's event. */
interface Intent {
  amount: bigint; domain: number; remoteToken: string; recipient: string
  localToken: string; depositor: string; maxFee: bigint; nonce: string; hookData: string
}
const INTENT: Intent = {
  amount: 1_899_991_033n, domain: 10004, remoteToken: REAL_EVENT.remoteToken.slice(2),
  recipient: REAL_EVENT.remoteRecipient.slice(2),
  localToken: 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', depositor: SENDER.slice(2),
  maxFee: 10_000_000n, nonce: '1a2546a6091864db9d016e6588a48d31b706c8c8becb903b1aac6e811e7f70a9', hookData: '',
}
const word = (n: bigint) => n.toString(16).padStart(64, '0')
/** Circle's DepositIntent layout (DepositIntent.sol), encoded here for the synthetic attestation. */
function payloadHex(i: Intent): string {
  return '5a2e0acd' + '00000001' + word(i.amount) + i.domain.toString(16).padStart(8, '0')
    + i.remoteToken + i.recipient + i.localToken.padStart(64, '0') + i.depositor.padStart(64, '0')
    + word(i.maxFee) + i.nonce + (i.hookData.length / 2).toString(16).padStart(8, '0') + i.hookData
}
function circleFor(i: Intent, requestedTxHash = SOURCE, extra: Record<string, unknown> = {}) {
  const payload = `0x${payloadHex(i)}` as Hex
  return {
    requestedTxHash,
    response: { attestations: [{ payload, messageHash: keccak256(payload), attestation: `0x${'aa'.repeat(65)}`, remoteDomain: 10004, ...extra }] },
  }
}
const input = (over: Partial<LinkInput> = {}): LinkInput => ({
  sourceTxHash: SOURCE, approvedSender: SENDER, approved: APPROVED, evidence: derivedEvidence(),
  circle: circleFor(INTENT), minConfirmations: 12, ...over,
})

describe('the real public transaction', () => {
  it('stays source-not-approved under the wallet builder (95-zero-byte hookData), whatever Circle says', () => {
    const real = { transaction: clone(ETH_TX), receipt: clone(ETH_RECEIPT), block: clone(ETH_BLOCK), tipBlockNumber: ETH_TIP }
    const r = linkXReserveSourceToAttestation(input({ evidence: real, circle: { requestedTxHash: SOURCE, response: clone(CIRCLE_RESPONSE) } }))
    expect(r).toMatchObject({ state: 'source-not-approved', code: 'calldata-mismatch', retryable: false, attestation: null })
  })
})

describe('SYNTHETIC positive case (not a live wallet-built deposit)', () => {
  it('links: source verified at depth, Circle intent equal to the on-chain event in every field', () => {
    const r = linkXReserveSourceToAttestation(input())
    expect(r).toMatchObject({ state: 'linked', code: 'linked', retryable: false, mismatchedFields: [] })
    expect(r.source).toMatchObject({ state: 'verified', confirmations: 21041n })
    expect(r.attestation?.intent).toMatchObject({ amountRaw: '1899991033', remoteDomain: 10004, hookData: '' })
  })
})

describe('every compared field, independently', () => {
  const cases: Array<[LinkedField, Partial<Intent>, string]> = [
    ['amount', { amount: 1_899_991_034n }, 'attestation-mismatch'],
    ['localToken', { localToken: 'dac17f958d2ee523a2206206994597c13d831ec7' }, 'attestation-mismatch'],
    ['localDepositor', { depositor: '1111111111111111111111111111111111111111' }, 'intent-event-mismatch'],
    ['remoteDomain', { domain: 10003 }, 'attestation-mismatch'],
    ['remoteRecipient', { recipient: `00000001${'ab'.repeat(28)}` }, 'attestation-mismatch'],
    ['remoteToken', { remoteToken: 'cd'.repeat(32) }, 'intent-event-mismatch'],
    ['maxFee', { maxFee: 9_999_999n }, 'intent-event-mismatch'],
    ['hookData', { hookData: '00'.repeat(95) }, 'intent-event-mismatch'],
  ]
  for (const [field, change, code] of cases) {
    it(`${field} differs → attestation-mismatch naming only ${field}`, () => {
      const r = linkXReserveSourceToAttestation(input({ circle: circleFor({ ...INTENT, ...change }) }))
      expect(r).toMatchObject({ state: 'attestation-mismatch', code, retryable: false })
      expect(r.mismatchedFields).toEqual([field])
      expect(r.state).not.toMatch(/refund/)
    })
  }
})

describe('binding, source state and attestation state', () => {
  it('a Circle response requested for another hash is misbound, even when its content matches', () => {
    const r = linkXReserveSourceToAttestation(input({ circle: circleFor(INTENT, `0x${'ab'.repeat(32)}`) }))
    expect(r).toMatchObject({ state: 'attestation-mismatch', code: 'source-hash-misbound', attestation: null })
  })

  it('a shallow source is source-pending, and Circle is not consulted as proof', () => {
    const e = derivedEvidence(); e.tipBlockNumber = ETH_BLOCK.number
    const r = linkXReserveSourceToAttestation(input({ evidence: e }))
    expect(r).toMatchObject({ state: 'source-pending', code: 'insufficient-confirmations', retryable: true, attestation: null })
  })

  it('a failed receipt is source-failed — terminal, and never a refund', () => {
    const e = derivedEvidence(); e.receipt.status = '0x0'
    const r = linkXReserveSourceToAttestation(input({ evidence: e }))
    expect(r).toMatchObject({ state: 'source-failed', code: 'reverted', retryable: false })
  })

  it('source evidence that contradicts itself is source-inconsistent (retryable)', () => {
    const e = derivedEvidence(); e.block.hash = `0x${'ef'.repeat(32)}`
    expect(linkXReserveSourceToAttestation(input({ evidence: e }))).toMatchObject({ state: 'source-inconsistent', code: 'block-mismatch', retryable: true })
  })

  it('an empty Circle list is attestation-pending (retryable)', () => {
    const r = linkXReserveSourceToAttestation(input({ circle: { requestedTxHash: SOURCE, response: { attestations: [] } } }))
    expect(r).toMatchObject({ state: 'attestation-pending', code: 'attestation-missing', retryable: true })
  })

  it('several attestations for the source are an ambiguous mismatch', () => {
    const one = circleFor(INTENT)
    const r = linkXReserveSourceToAttestation(input({ circle: { requestedTxHash: SOURCE,
      response: { attestations: [...one.response.attestations, ...one.response.attestations] } } }))
    expect(r).toMatchObject({ state: 'attestation-mismatch', code: 'attestation-mismatch', retryable: false })
  })

  it('a malformed Circle response is attestation-malformed (retryable); a tampered messageHash is a mismatch', () => {
    expect(linkXReserveSourceToAttestation(input({ circle: { requestedTxHash: SOURCE, response: { attestations: [{ payload: 'zz' }] } } })))
      .toMatchObject({ state: 'attestation-malformed', retryable: true })
    expect(linkXReserveSourceToAttestation(input({ circle: circleFor(INTENT, SOURCE, { messageHash: `0x${'00'.repeat(32)}` }) })))
      .toMatchObject({ state: 'attestation-mismatch', code: 'attestation-mismatch' })
  })

  it('refuses a Circle response without its requested hash', () => {
    const r = linkXReserveSourceToAttestation(input({ circle: { response: circleFor(INTENT).response } as never }))
    expect(r).toMatchObject({ state: 'invalid-input', source: null })
  })
})
