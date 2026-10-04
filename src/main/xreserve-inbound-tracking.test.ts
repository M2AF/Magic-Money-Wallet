/**
 * Inbound xReserve tracking persistence. No network, no credentials: reads are
 * injected fakes and storage is an in-memory map of JSON text.
 *
 * Every positive status case is SYNTHETIC (see xreserve-inbound-status.test.ts):
 * recorded Ethereum evidence carrying the wallet builder's calldata, a Circle
 * attestation built from Circle's published layout with a placeholder
 * signature, and Cardano mints built here. No wallet-built deposit has been
 * observed live. The real public transaction appears only as a
 * `source-not-approved` case.
 */
import { describe, it, expect } from 'vitest'
import { blake2b } from '@noble/hashes/blake2b'
import { encodeAbiParameters, keccak256, type Hex } from 'viem'
import {
  startXReserveInboundTrackingRecord, checkAndPersistXReserveInbound, parseInboundTrackingRecord, inboundTrackingKey,
  type InboundTrackingStore, type TrackingIdentity, type StartTrackingInput, type CheckTrackingInput, type XReserveInboundRecord,
} from './xreserve-inbound-tracking'
import type { InboundReads } from './xreserve-inbound-status'
import { decodeDepositedToRemoteLog, DEPOSITED_TO_REMOTE_TOPIC } from './xreserve-ethereum-deposit-proof'
import { buildCardanoDepositRequest, type CardanoDepositInput } from './xreserve-cardano-deposit'
import { CardanoReaderError, type AddressTxRow, type CardanoOutputs } from './xreserve-cardano-mint-locator'
import { AUDITED_ASSET_UNIT } from './xreserve-cardano-mint-audit'
import { cborArray, cborMap, cborUint, cborBytes } from './cardano-cip30'
import { decodeCardanoAddress } from './cardano-pure'
import { CARDANO_USDCX_UNIT } from '../shared/swap-token-identity'

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


// ── Ethereum + Circle (SYNTHETIC positive source, real public negative) ───────

const SOURCE = ETH_TX.hash
const SENDER = '0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863'
const RECIPIENT = 'addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax'
const OTHER = 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8'
const AMOUNT = 1_899_991_033n
const APPROVED: CardanoDepositInput = { recipient: RECIPIENT, amountRaw: AMOUNT, maxFeeRaw: 10_000_000n }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const EVENT_LOG = ETH_RECEIPT.logs.findIndex(l => l.topics[0] === DEPOSITED_TO_REMOTE_TOPIC)
const REAL_EVENT = decodeDepositedToRemoteLog(ETH_RECEIPT.logs[EVENT_LOG])

/** SYNTHETIC: the recorded evidence carrying the builder's calldata and the matching (empty-hookData) event. */
function derivedEvidence() {
  const e = {
    transaction: clone(ETH_TX) as Record<string, unknown>,
    receipt: clone(ETH_RECEIPT) as unknown as { logs: Array<{ data: string }> } & Record<string, unknown>,
    block: clone(ETH_BLOCK) as Record<string, unknown>,
    tipBlockNumber: ETH_TIP as unknown,
  }
  e.transaction.input = buildCardanoDepositRequest(APPROVED).data
  e.receipt.logs[EVENT_LOG].data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes' }],
    [REAL_EVENT.value, REAL_EVENT.remoteDomain, REAL_EVENT.remoteToken as Hex, REAL_EVENT.maxFee, '0x'])
  return e
}

const word = (n: bigint) => n.toString(16).padStart(64, '0')
/** SYNTHETIC DepositIntent payload (Circle's DepositIntent.sol layout) matching the derived deposit's event. */
const SYN_PAYLOAD = `0x${'5a2e0acd' + '00000001' + word(AMOUNT) + (10004).toString(16).padStart(8, '0')
  + REAL_EVENT.remoteToken.slice(2) + REAL_EVENT.remoteRecipient.slice(2)
  + 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'.padStart(64, '0') + SENDER.slice(2).padStart(64, '0')
  + word(10_000_000n) + '1a2546a6091864db9d016e6588a48d31b706c8c8becb903b1aac6e811e7f70a9' + '00000000'}` as Hex
/** Placeholder signature: NOT Circle's. */
const SYN_SIGNATURE = `0x${'aa'.repeat(65)}`
const SYN_CIRCLE = () => ({
  attestations: [{ payload: SYN_PAYLOAD, messageHash: keccak256(SYN_PAYLOAD), attestation: SYN_SIGNATURE, remoteDomain: 10004 }],
})

// ── Cardano (SYNTHETIC mint transactions carrying the synthetic attestation) ──

const TIP_AT_SUBMISSION = 13_989_000
const POLICY = Buffer.from(CARDANO_USDCX_UNIT.mainnet.slice(0, 56), 'hex')
const NAME = Buffer.from(CARDANO_USDCX_UNIT.mainnet.slice(56), 'hex')
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex')
const usdcxValue = (q: bigint) => cborArray([cborUint(1_500_000n), cborMap([[cborBytes(POLICY), cborMap([[cborBytes(NAME), cborUint(q)]])]])])

interface ChainTx { row: AddressTxRow; cbor: string; outputs: CardanoOutputs; to: string }

function assemble(body: Uint8Array, ws: Uint8Array, at: { blockHeight: number; txIndex: number }, to: string, qty: bigint): ChainTx {
  return {
    row: { txHash: hexOf(blake2b(body, { dkLen: 32 })), ...at },
    cbor: hexOf(new Uint8Array([0x84, ...body, ...ws, 0xf5, 0xf6])),
    outputs: [{ index: 0, address: to, lovelace: '1500000', assets: [{ unit: CARDANO_USDCX_UNIT.mainnet, quantity: qty.toString() }] }],
    to,
  }
}

/** An ordinary USDCx payment (no mint, no attestation). */
function payment(blockHeight: number, to = RECIPIENT, salt = 0, txIndex = 0): ChainTx {
  const input = new Uint8Array(32); input[0] = salt & 0xff; input[1] = (salt >> 8) & 0xff; input[2] = blockHeight & 0xff
  const body = cborMap([
    [cborUint(0), cborArray([cborArray([cborBytes(input), cborUint(0)])])],
    [cborUint(1), cborArray([cborArray([cborBytes(decodeCardanoAddress(to)), usdcxValue(1_000_000n)])])],
    [cborUint(2), cborUint(170_000n)],
  ])
  return assemble(body, cborMap([]), { blockHeight, txIndex }, to, 1_000_000n)
}

/** SYNTHETIC: a withdraw-zero mint whose redeemer carries the synthetic payload and placeholder signature. */
function syntheticMint(blockHeight: number, opts: { payTo?: string; salt?: number; txIndex?: number } = {}): ChainTx {
  const payTo = opts.payTo ?? RECIPIENT
  const credit = AMOUNT - 1n
  const reward = new Uint8Array([0xf1, ...Buffer.from('d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b', 'hex')])
  const body = cborMap([
    [cborUint(0), cborArray([cborArray([cborBytes(new Uint8Array(32).fill(0xe0 + (opts.salt ?? 0))), cborUint(0)])])],
    [cborUint(1), cborArray([cborArray([cborBytes(decodeCardanoAddress(payTo)), usdcxValue(credit)])])],
    [cborUint(2), cborUint(500_000n)],
    [cborUint(5), cborMap([[cborBytes(reward), cborUint(0)]])],
    [cborUint(9), cborMap([[cborBytes(POLICY), cborMap([[cborBytes(NAME), cborUint(AMOUNT)]])]])],
  ])
  const pair = new Uint8Array([0xd8, 0x79, ...cborArray([cborArray([
    cborBytes(Buffer.from(SYN_PAYLOAD.slice(2), 'hex')), cborBytes(Buffer.from(SYN_SIGNATURE.slice(2), 'hex'))])])])
  const ws = cborMap([[cborUint(5), cborArray([cborArray([cborUint(3), cborUint(0), pair, cborArray([cborUint(1), cborUint(1)])])])]])
  return assemble(body, ws, { blockHeight, txIndex: opts.txIndex ?? 0 }, payTo, credit)
}

const sorted = (txs: ChainTx[]) => [...txs].sort((a, b) => a.row.blockHeight - b.row.blockHeight || a.row.txIndex - b.row.txIndex)
const fromOn = (t: ChainTx, from: { blockHeight: number; txIndex: number }) =>
  t.row.blockHeight > from.blockHeight || (t.row.blockHeight === from.blockHeight && t.row.txIndex >= from.txIndex)

/** An in-memory world behind every injected read, logging each read in order. */
class World {
  log: string[] = []
  evidence: unknown = derivedEvidence()
  circle: unknown = SYN_CIRCLE()
  ethError: Error | null = null
  circleError: Error | null = null
  cardanoError: Error | null = null
  tipHeight = TIP_AT_SUBMISSION + 200
  /** Transactions the asset index has not got (to make the two views disagree). */
  hiddenFromAudit = new Set<string>()
  constructor(public txs: ChainTx[] = []) {}

  reads(): InboundReads {
    const tx = (h: string) => this.txs.find(t => t.row.txHash === h)
    const common = (who: string) => ({
      confirmedTransaction: async (h: string) => {
        this.log.push(`${who}:tx`); if (this.cardanoError) throw this.cardanoError
        const t = tx(h); if (!t) throw new CardanoReaderError('not-found')
        return { txHash: h, blockHeight: t.row.blockHeight, cbor: t.cbor }
      },
      transactionOutputs: async (h: string) => { this.log.push(`${who}:outputs`); return clone(tx(h)!.outputs) },
      tip: async () => { this.log.push(`${who}:tip`); if (this.cardanoError) throw this.cardanoError; return { blockHeight: this.tipHeight } },
    })
    return {
      readEthereumEvidence: async (h) => {
        this.log.push('ethereum'); if (this.ethError) throw this.ethError
        return { sourceTxHash: h, evidence: clone(this.evidence) as never }
      },
      fetchAttestation: async (h) => {
        this.log.push('circle'); if (this.circleError) throw this.circleError
        return { requestedTxHash: h, response: clone(this.circle) }
      },
      locatorReader: {
        ...common('locator'),
        addressTransactions: async (address, from, count) => {
          this.log.push(`locator:page@${from.blockHeight}:${from.txIndex}`)
          if (this.cardanoError) throw this.cardanoError
          return sorted(this.txs).filter(t => t.to === address && fromOn(t, from)).slice(0, count).map(t => ({ ...t.row }))
        },
      },
      auditReader: {
        ...common('audit'),
        assetTransactions: async (unit, from, count) => {
          expect(unit).toBe(AUDITED_ASSET_UNIT)
          this.log.push(`audit:page@${from.blockHeight}:${from.txIndex}`)
          if (this.cardanoError) throw this.cardanoError
          return sorted(this.txs).filter(t => !this.hiddenFromAudit.has(t.row.txHash) && fromOn(t, from)).slice(0, count).map(t => ({ ...t.row }))
        },
      },
    }
  }
  cardanoReads() { return this.log.filter(l => l.startsWith('locator') || l.startsWith('audit')) }
}


// ── Storage and inputs ────────────────────────────────────────────────────────

class MemoryStore implements InboundTrackingStore {
  saves: Array<{ key: string; json: string }> = []
  loads: string[] = []
  failLoad = false
  failSave = false
  constructor(public map = new Map<string, string>()) {}
  async load(key: string) {
    this.loads.push(key)
    if (this.failLoad) throw new Error('disk on fire at /secret/path')
    return this.map.has(key) ? this.map.get(key)! : null
  }
  async save(key: string, json: string) {
    if (this.failSave) throw new Error('quota exceeded')
    this.saves.push({ key, json })
    this.map.set(key, json)
  }
}

const IDENTITY: TrackingIdentity = { walletId: 'wallet-1', accountId: 'account-0', environment: 'mainnet' }
const KEY = inboundTrackingKey(IDENTITY, SOURCE)
const DEPOSIT = { identity: IDENTITY, approvedSender: SENDER, sourceTxHash: SOURCE, approved: APPROVED }
const startInput = (over: Partial<StartTrackingInput> = {}): StartTrackingInput => ({
  ...DEPOSIT, confirmations: { ethereum: 12, cardano: 10 }, cardanoTipAtSubmission: { blockHeight: TIP_AT_SUBMISSION }, ...over,
})
const checkInput = (over: Partial<CheckTrackingInput> = {}): CheckTrackingInput => ({ ...DEPOSIT, auditDue: false, ...over })

async function started(store = new MemoryStore()) {
  const r = await startXReserveInboundTrackingRecord(startInput(), store)
  expect(r.kind).toBe('started')
  return store
}
const stored = (store: MemoryStore): XReserveInboundRecord => JSON.parse(store.map.get(KEY)!)
/** Rewrite the stored record's JSON with `mutate`. */
const tamper = (store: MemoryStore, mutate: (r: Record<string, any>) => void) => {
  const r = JSON.parse(store.map.get(KEY)!); mutate(r); store.map.set(KEY, JSON.stringify(r))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('start tracking an already-submitted deposit', () => {
  it('seeds both cursors from the submission tip and persists only resume evidence', async () => {
    const store = await started()
    expect(store.saves.map(s => s.key)).toEqual([KEY])
    const json = store.saves[0].json
    expect(JSON.parse(json)).toEqual({
      v: 1, kind: 'xreserve-inbound-tracking', identity: IDENTITY,
      approvedSender: SENDER, sourceTxHash: SOURCE,
      approved: { recipient: RECIPIENT, amountRaw: '1899991033', maxFeeRaw: '10000000' },
      confirmations: { ethereum: 12, cardano: 10 },
      cardanoTipAtSubmission: { blockHeight: TIP_AT_SUBMISSION },
      cursors: {
        locator: { v: 1, recipient: RECIPIENT, sourceTxHash: SOURCE, blockHeight: TIP_AT_SUBMISSION, txIndex: -1 },
        audit: { v: 1, kind: 'usdcx-asset-audit', asset: AUDITED_ASSET_UNIT, recipient: RECIPIENT, sourceTxHash: SOURCE, blockHeight: TIP_AT_SUBMISSION, txIndex: -1 },
      },
    })
    // Nothing executable: no calldata, selector, CBOR or signature.
    const calldata = buildCardanoDepositRequest(APPROVED).data
    expect(json).not.toContain(calldata.slice(10, 74))
    expect(json).not.toMatch(/faadb53b|calldata|"data"|"input"|cbor|signature|privateKey|"to"/i)
  })

  it('is idempotent: a repeat start keeps the stored record and its progress', async () => {
    const store = await started()
    const w = new World(Array.from({ length: 25 }, (_, i) => payment(TIP_AT_SUBMISSION + 1 + i, RECIPIENT, i)))
    await checkAndPersistXReserveInbound(checkInput(), w.reads(), store)
    const progressed = stored(store)
    expect(progressed.cursors.locator.blockHeight).toBe(TIP_AT_SUBMISSION + 20)
    const saves = store.saves.length
    const again = await startXReserveInboundTrackingRecord(startInput(), store)
    expect(again).toMatchObject({ kind: 'already-tracking', record: progressed })
    expect(store.saves.length).toBe(saves)
  })

  it('a repeat start with different depths or a different submission tip is refused, not overwritten', async () => {
    const store = await started()
    const before = store.map.get(KEY)
    for (const over of [{ cardanoTipAtSubmission: { blockHeight: TIP_AT_SUBMISSION + 500 } }, { confirmations: { ethereum: 12, cardano: 20 } }]) {
      expect(await startXReserveInboundTrackingRecord(startInput(over), store)).toMatchObject({ kind: 'tracking-error', code: 'start-mismatch' })
    }
    expect(store.map.get(KEY)).toBe(before)
  })

  it('requires the submission tip: it is never manufactured, and nothing is loaded or saved', async () => {
    const store = new MemoryStore()
    for (const tip of [undefined, null, { blockHeight: -1 }, { blockHeight: 1.5 }]) {
      expect(await startXReserveInboundTrackingRecord(startInput({ cardanoTipAtSubmission: tip as never }), store))
        .toMatchObject({ kind: 'tracking-error', code: 'invalid-input' })
    }
    expect(store.loads).toEqual([])
    expect(store.saves).toEqual([])
  })

  it('refuses invalid identities and approvals before touching the store', async () => {
    const store = new MemoryStore()
    const bad: Array<Partial<StartTrackingInput>> = [
      { identity: { ...IDENTITY, environment: 'devnet' as never } },
      { identity: { ...IDENTITY, walletId: '' } },
      { approvedSender: '0x1234' },
      { sourceTxHash: '0xabc' },
      { approved: { ...APPROVED, maxFeeRaw: AMOUNT } },
      { approved: { ...APPROVED, recipient: 'addr1notanaddress' } },
      { approved: { recipient: RECIPIENT, amountRaw: AMOUNT } as never },
      { confirmations: { ethereum: 0, cardano: 10 } },
    ]
    for (const over of bad) {
      expect(await startXReserveInboundTrackingRecord(startInput(over), store)).toMatchObject({ kind: 'tracking-error', code: 'invalid-input' })
    }
    expect(store.loads).toEqual([])
  })

  it('an existing corrupt record is reported, never overwritten by a fresh start', async () => {
    const store = new MemoryStore(new Map([[KEY, '{"v":1,']]))
    expect(await startXReserveInboundTrackingRecord(startInput(), store)).toMatchObject({ kind: 'tracking-error', code: 'record-corrupt' })
    expect(store.map.get(KEY)).toBe('{"v":1,')
  })

  it('a failed save on start is visible', async () => {
    const store = new MemoryStore(); store.failSave = true
    expect(await startXReserveInboundTrackingRecord(startInput(), store)).toEqual({ kind: 'tracking-error', code: 'save-failed', reason: 'the tracking store could not be written' })
  })
})

describe('check and persist', () => {
  it('JSON restart/resume: a bounded scan saves its cursors; a fresh process resumes from them and finds the mint', async () => {
    const map = new Map<string, string>()
    await started(new MemoryStore(map))
    const mint = syntheticMint(TIP_AT_SUBMISSION + 40)
    const w = new World([...Array.from({ length: 25 }, (_, i) => payment(TIP_AT_SUBMISSION + 1 + i, RECIPIENT, i)), mint])

    const first = await checkAndPersistXReserveInbound(checkInput({ auditDue: true }), w.reads(), new MemoryStore(map))
    expect(first).toMatchObject({ kind: 'checked', persisted: 'saved', status: { state: 'cardano-unknown', retryable: true } })
    const afterFirst = JSON.parse(map.get(KEY)!) as XReserveInboundRecord
    expect(afterFirst.cursors.locator).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 20, txIndex: 0 })
    expect(afterFirst.cursors.audit).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 20, txIndex: 0 })

    // "Restart": a new store object over the same persisted text, a new world log.
    w.log = []
    const second = await checkAndPersistXReserveInbound(checkInput({ auditDue: true }), w.reads(), new MemoryStore(map))
    expect(w.log).toContain(`locator:page@${TIP_AT_SUBMISSION + 20}:0`)
    expect(second).toMatchObject({ kind: 'checked', status: { state: 'minted', mint: { txHash: mint.row.txHash } } })
  })

  it('Ethereum is re-read on every call; a rollback after minted is source-pending with cursors unchanged', async () => {
    const store = await started()
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)])
    const first = await checkAndPersistXReserveInbound(checkInput(), w.reads(), store)
    expect(first).toMatchObject({ kind: 'checked', status: { state: 'minted' } })
    const record = stored(store)
    w.log = []
    const again = await checkAndPersistXReserveInbound(checkInput(), w.reads(), store)
    expect(again).toMatchObject({ kind: 'checked', status: { state: 'minted' }, persisted: 'unchanged' })
    expect(w.log[0]).toBe('ethereum')
    w.evidence = { transaction: null, receipt: null, block: null, tipBlockNumber: ETH_TIP }
    w.log = []
    const rolled = await checkAndPersistXReserveInbound(checkInput(), w.reads(), store)
    expect(rolled).toMatchObject({ kind: 'checked', persisted: 'unchanged', status: { state: 'source-pending', sourceCode: 'not-found', retryable: true } })
    expect(w.log).toEqual(['ethereum'])
    expect(stored(store)).toEqual(record)
  })

  it('a deep address proof reports minted while the due audit is unfinished; the audit result and its progress are kept', async () => {
    const store = await started()
    const others = Array.from({ length: 25 }, (_, i) => payment(TIP_AT_SUBMISSION + 1 + i, OTHER, i))
    const mint = syntheticMint(TIP_AT_SUBMISSION + 50)
    const r = await checkAndPersistXReserveInbound(checkInput({ auditDue: true }), new World([...others, mint]).reads(), store)
    expect(r).toMatchObject({ kind: 'checked', persisted: 'saved', status: { state: 'minted', mint: { txHash: mint.row.txHash } } })
    if (r.kind !== 'checked') throw new Error('unreachable')
    expect(r.status.locator?.state).toBe('minted')
    expect(r.status.audit).toMatchObject({ state: 'unknown', retryable: true, checked: 20 })
    expect(stored(store).cursors.audit).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 20, txIndex: 0 })
  })

  it('typed coordinator states pass through unchanged (the real public transaction stays source-not-approved)', async () => {
    const store = await started()
    const w = new World()
    w.evidence = { transaction: clone(ETH_TX), receipt: clone(ETH_RECEIPT), block: clone(ETH_BLOCK), tipBlockNumber: ETH_TIP }
    w.circle = clone(CIRCLE_RESPONSE)
    const r = await checkAndPersistXReserveInbound(checkInput(), w.reads(), store)
    expect(r).toMatchObject({ kind: 'checked', persisted: 'unchanged', status: { state: 'source-not-approved', sourceCode: 'calldata-mismatch', retryable: false } })
    expect(w.log).toEqual(['ethereum'])
  })

  it('a Cardano rate limit is a retryable cardano-unknown; progress is not lost and nothing is saved', async () => {
    const store = await started()
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)]); w.cardanoError = new CardanoReaderError('rate-limited')
    const saves = store.saves.length
    const r = await checkAndPersistXReserveInbound(checkInput(), w.reads(), store)
    expect(r).toMatchObject({ kind: 'checked', persisted: 'unchanged', status: { state: 'cardano-unknown', retryable: true } })
    expect(store.saves.length).toBe(saves)
  })

  it('a failed save is visible: save-failed carries the true status, and the stored record keeps the previous cursors', async () => {
    const store = await started()
    const before = store.map.get(KEY)
    store.failSave = true
    const w = new World(Array.from({ length: 25 }, (_, i) => payment(TIP_AT_SUBMISSION + 1 + i, RECIPIENT, i)))
    const r = await checkAndPersistXReserveInbound(checkInput(), w.reads(), store)
    expect(r).toMatchObject({ kind: 'save-failed', reason: 'the tracking store could not be written', status: { state: 'cardano-unknown' } })
    if (r.kind !== 'save-failed') throw new Error('unreachable')
    expect(r.status.cursors.locator).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 20 })
    expect(store.map.get(KEY)).toBe(before)
    expect(JSON.stringify(r, (_k, v) => typeof v === 'bigint' ? v.toString() : v)).not.toContain('quota')
  })
})

describe('a missing, corrupt or mismatched record is a typed error before any network read', () => {
  it('no record: record-missing, never awaiting-mint', async () => {
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)])
    const r = await checkAndPersistXReserveInbound(checkInput(), w.reads(), new MemoryStore())
    expect(r).toMatchObject({ kind: 'tracking-error', code: 'record-missing' })
    expect(w.log).toEqual([])
  })

  it('an unreadable store: load-failed, with no store detail leaked', async () => {
    const store = await started(); store.failLoad = true
    const w = new World()
    const r = await checkAndPersistXReserveInbound(checkInput(), w.reads(), store)
    expect(r).toEqual({ kind: 'tracking-error', code: 'load-failed', reason: 'the tracking store could not be read' })
    expect(w.log).toEqual([])
  })

  const corrupt: Array<[string, (r: Record<string, any>) => void]> = [
    ['missing locator cursor', r => { delete r.cursors.locator }],
    ['null audit cursor', r => { r.cursors.audit = null }],
    ['locator cursor for another recipient', r => { r.cursors.locator.recipient = OTHER }],
    ['audit cursor for another deposit', r => { r.cursors.audit.sourceTxHash = `0x${'cd'.repeat(32)}` }],
    ['locator cursor with a negative height', r => { r.cursors.locator.blockHeight = -5 }],
    ['audit cursor for another asset', r => { r.cursors.audit.asset = 'ab'.repeat(28) }],
    ['missing submission tip', r => { delete r.cardanoTipAtSubmission }],
    ['non-decimal amount', r => { r.approved.amountRaw = '0x713f8ff9' }],
    ['fee cap not below the amount', r => { r.approved.maxFeeRaw = r.approved.amountRaw }],
    ['zero confirmation depth', r => { r.confirmations.cardano = 0 }],
    ['an extra executable field', r => { r.calldata = '0xfaadb53b' }],
    ['an extra cursor field', r => { r.cursors.locator.cbor = '84a4' }],
    ['a future schema version', r => { r.v = 2 }],
    ['an upper-case source hash', r => { r.sourceTxHash = r.sourceTxHash.toUpperCase().replace('0X', '0x') }],
  ]
  for (const [name, mutate] of corrupt) {
    it(`${name} → record-corrupt`, async () => {
      const store = await started(); tamper(store, mutate)
      const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)])
      expect(await checkAndPersistXReserveInbound(checkInput(), w.reads(), store)).toMatchObject({ kind: 'tracking-error', code: 'record-corrupt' })
      expect(w.log).toEqual([])
    })
  }

  it('text that is not JSON → record-corrupt', async () => {
    const w = new World()
    const r = await checkAndPersistXReserveInbound(checkInput(), w.reads(), new MemoryStore(new Map([[KEY, 'not json']])))
    expect(r).toMatchObject({ kind: 'tracking-error', code: 'record-corrupt' })
    expect(w.log).toEqual([])
  })

  const mismatches: Array<[string, (r: Record<string, any>) => void, string]> = [
    ['another wallet', r => { r.identity.walletId = 'wallet-2' }, 'identity-mismatch'],
    ['another account', r => { r.identity.accountId = 'account-9' }, 'identity-mismatch'],
    ['another sender', r => { r.approvedSender = `0x${'11'.repeat(20)}` }, 'approval-mismatch'],
    ['another amount', r => { r.approved.amountRaw = '1899991034' }, 'approval-mismatch'],
    ['another fee cap', r => { r.approved.maxFeeRaw = '9999999' }, 'approval-mismatch'],
    ['another recipient (cursors re-bound too)', r => {
      r.approved.recipient = OTHER; r.cursors.locator.recipient = OTHER; r.cursors.audit.recipient = OTHER
    }, 'approval-mismatch'],
    ['another source transaction (cursors re-bound too)', r => {
      const other = `0x${'ab'.repeat(32)}`; r.sourceTxHash = other; r.cursors.locator.sourceTxHash = other; r.cursors.audit.sourceTxHash = other
    }, 'approval-mismatch'],
  ]
  for (const [name, mutate, code] of mismatches) {
    it(`a record for ${name} → ${code}`, async () => {
      const store = await started(); tamper(store, mutate)
      const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)])
      expect(await checkAndPersistXReserveInbound(checkInput(), w.reads(), store)).toMatchObject({ kind: 'tracking-error', code })
      expect(w.log).toEqual([])
    })
  }

  it('the caller\'s deposit must also match: a different approval finds nothing bound to it', async () => {
    const store = await started()
    const w = new World()
    const r = await checkAndPersistXReserveInbound(checkInput({ approved: { ...APPROVED, amountRaw: AMOUNT + 1n } }), w.reads(), store)
    expect(r).toMatchObject({ kind: 'tracking-error', code: 'approval-mismatch' })
    expect(w.log).toEqual([])
  })

  it('parseInboundTrackingRecord round-trips a stored record exactly', async () => {
    const store = await started()
    const json = store.map.get(KEY)!
    expect(JSON.stringify(parseInboundTrackingRecord(json))).toBe(json)
  })
})
