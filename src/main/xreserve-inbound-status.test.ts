/**
 * Inbound xReserve status coordinator. No network: every read is injected.
 *
 *   • The REAL public Ethereum transaction 0x9695d030… and Circle's REAL
 *     attestation for it (recorded read-only, below) are not an approvable
 *     wallet deposit — the 95-zero-byte hookData — so the coordinator must stop
 *     at `source-not-approved` without reading Cardano.
 *   • Every POSITIVE end-to-end case is SYNTHETIC and labelled so: the recorded
 *     Ethereum evidence carrying the wallet builder's calldata and matching
 *     event, a Circle attestation built here from Circle's published
 *     DepositIntent layout with a placeholder signature, and Cardano mint
 *     transactions built here to carry it. No wallet-built deposit has been
 *     observed live.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { blake2b } from '@noble/hashes/blake2b'
import { encodeAbiParameters, keccak256, type Hex } from 'viem'
import {
  checkXReserveInboundStatus, startXReserveInboundTracking, xreserveInboundReads,
  type InboundReads, type InboundStatusInput, type InboundTracking,
} from './xreserve-inbound-status'
import { decodeDepositedToRemoteLog, DEPOSITED_TO_REMOTE_TOPIC } from './xreserve-ethereum-deposit-proof'
import { EthereumEvidenceError } from './xreserve-ethereum-evidence-reader'
import { ProviderFault, XRESERVE_ATTESTATIONS_URL } from './xreserve-cardano-provider'
import { PUBLIC_RPCS } from './chain-config'
import type { WalletConfig } from './secure-store'
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

const fresh = (): InboundTracking => clone(startXReserveInboundTracking(RECIPIENT, SOURCE, { blockHeight: TIP_AT_SUBMISSION }))
const input = (over: Partial<InboundStatusInput> = {}): InboundStatusInput => ({
  sourceTxHash: SOURCE, approvedSender: SENDER, approved: APPROVED,
  confirmations: { ethereum: 12, cardano: 10 }, tracking: fresh(), auditDue: false, ...over,
})
/** Persist and reload a result's cursors the way a caller would: through JSON. */
const persisted = (prev: InboundTracking, r: { cursors: { locator: unknown; audit: unknown } }): InboundTracking => JSON.parse(JSON.stringify({
  cardanoTipAtSubmission: prev.cardanoTipAtSubmission,
  locatorCursor: r.cursors.locator ?? prev.locatorCursor,
  auditCursor: r.cursors.audit ?? prev.auditCursor,
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('the real public transaction', () => {
  it('stays source-not-approved (95-zero-byte hookData) and Cardano is never read', async () => {
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)])
    w.evidence = { transaction: clone(ETH_TX), receipt: clone(ETH_RECEIPT), block: clone(ETH_BLOCK), tipBlockNumber: ETH_TIP }
    w.circle = clone(CIRCLE_RESPONSE)
    const tracking = fresh()
    const r = await checkXReserveInboundStatus(input({ tracking, auditDue: true }), w.reads())
    expect(r).toMatchObject({ state: 'source-not-approved', sourceCode: 'calldata-mismatch', linkCode: null, retryable: false, locator: null, audit: null })
    expect(w.log).toEqual(['ethereum'])
    expect(r.cursors).toEqual({ locator: tracking.locatorCursor, audit: tracking.auditCursor })
  })
})

describe('SYNTHETIC end to end (not a live wallet-built deposit)', () => {
  it('reads in order — Ethereum, Circle, locator, then audit when due — and reports minted', async () => {
    const mint = syntheticMint(TIP_AT_SUBMISSION + 50)
    const w = new World([payment(TIP_AT_SUBMISSION + 10), mint, payment(TIP_AT_SUBMISSION + 60, OTHER)])
    const r = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(r).toMatchObject({ state: 'minted', retryable: false, linkCode: 'linked', conflict: null })
    expect(r.mint).toEqual({ txHash: mint.row.txHash, blockHeight: TIP_AT_SUBMISSION + 50, confirmations: 151 })
    expect(r.proof).toMatchObject({ verified: true, cardanoTxHash: mint.row.txHash })
    expect(r.locator?.state).toBe('minted')
    expect(r.audit?.state).toBe('minted')
    const firstLocator = w.log.findIndex(l => l.startsWith('locator'))
    const firstAudit = w.log.findIndex(l => l.startsWith('audit'))
    expect(w.log.slice(0, 2)).toEqual(['ethereum', 'circle'])
    expect(firstLocator).toBe(2)
    expect(firstAudit).toBeGreaterThan(w.log.lastIndexOf('locator:outputs'))
  })

  it('auditDue false: the audit reader is not touched and its stored cursor is echoed', async () => {
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)])
    const tracking = fresh()
    const r = await checkXReserveInboundStatus(input({ tracking, auditDue: false }), w.reads())
    expect(r.state).toBe('minted')
    expect(r.audit).toBeNull()
    expect(w.log.some(l => l.startsWith('audit'))).toBe(false)
    expect(r.cursors.audit).toEqual(tracking.auditCursor)
  })

  it('a minted cursor stays immediately before the mint (after checked transactions), so the next call re-verifies it', async () => {
    const mint = syntheticMint(TIP_AT_SUBMISSION + 50)
    const w = new World([payment(TIP_AT_SUBMISSION + 10), mint])
    const first = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(first.cursors.locator).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 10, txIndex: 0 })
    expect(first.cursors.audit).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 10, txIndex: 0 })
    w.log = []
    const again = await checkXReserveInboundStatus(input({ tracking: persisted(fresh(), first), auditDue: true }), w.reads())
    expect(again).toMatchObject({ state: 'minted', mint: { txHash: mint.row.txHash } })
    expect(w.log[0]).toBe('ethereum')
  })

  it('a shallow mint stays pending: awaiting-confirmations', async () => {
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 195)])
    const r = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(r).toMatchObject({ state: 'awaiting-confirmations', retryable: true, mint: { confirmations: 6 }, proof: null })
  })

  it('nothing minted yet: awaiting-mint, retryable, never a final absence', async () => {
    const w = new World([payment(TIP_AT_SUBMISSION + 10)])
    const r = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(r).toMatchObject({ state: 'awaiting-mint', retryable: true })
    expect(r.audit).toMatchObject({ state: 'no-match-yet', scanComplete: true })
  })
})

describe('restart with JSON-serialized cursors', () => {
  it('an unfinished scan is cardano-unknown with progress kept; the reloaded cursors resume there and find the mint', async () => {
    const payments = Array.from({ length: 25 }, (_, i) => payment(TIP_AT_SUBMISSION + 1 + i, RECIPIENT, i))
    const mint = syntheticMint(TIP_AT_SUBMISSION + 40)
    const w = new World([...payments, mint])
    const first = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(first).toMatchObject({ state: 'cardano-unknown', retryable: true })
    expect(first.cursors.locator).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 20, txIndex: 0 })
    expect(first.cursors.audit).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 20, txIndex: 0 })

    const tracking = persisted(fresh(), first)
    w.log = []
    const second = await checkXReserveInboundStatus(input({ tracking, auditDue: true }), w.reads())
    expect(w.log).toContain(`locator:page@${TIP_AT_SUBMISSION + 20}:0`)
    expect(w.log).toContain(`audit:page@${TIP_AT_SUBMISSION + 20}:0`)
    expect(second).toMatchObject({ state: 'minted', mint: { txHash: mint.row.txHash } })
  })

  it('audit cadence: the locator advances every call, the audit cursor only when due', async () => {
    const w = new World(Array.from({ length: 25 }, (_, i) => payment(TIP_AT_SUBMISSION + 1 + i, RECIPIENT, i)))
    const t0 = fresh()
    const a = await checkXReserveInboundStatus(input({ tracking: t0, auditDue: false }), w.reads())
    expect(a.cursors.audit).toEqual(t0.auditCursor)
    const t1 = persisted(t0, a)
    const b = await checkXReserveInboundStatus(input({ tracking: t1, auditDue: false }), w.reads())
    expect(b).toMatchObject({ state: 'awaiting-mint' })
    expect(b.cursors.audit).toEqual(t0.auditCursor)
    const c = await checkXReserveInboundStatus(input({ tracking: persisted(t1, b), auditDue: true }), w.reads())
    expect(c.cursors.audit).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 20 })
  })
})

describe('combining the two scanners', () => {
  it('a mint paid only to another address: the locator cannot see it, the due audit reports a deep mint-conflict', async () => {
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50, { payTo: OTHER })])
    const quiet = await checkXReserveInboundStatus(input({ auditDue: false }), w.reads())
    expect(quiet.state).toBe('awaiting-mint')
    const audited = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(audited).toMatchObject({ state: 'mint-conflict', retryable: false, conflict: 'no-recipient-credit' })
    expect(audited.locator?.state).toBe('awaiting-mint')
  })

  it('a deep conflict takes precedence over minted', async () => {
    const wrong = syntheticMint(TIP_AT_SUBMISSION + 30, { payTo: OTHER, salt: 1 })
    const right = syntheticMint(TIP_AT_SUBMISSION + 50, { salt: 2 })
    const r = await checkXReserveInboundStatus(input({ auditDue: true }), new World([wrong, right]).reads())
    expect(r.locator?.state).toBe('minted')
    expect(r).toMatchObject({ state: 'mint-conflict', conflict: 'no-recipient-credit', proof: null })
  })

  it('a provisional (shallow) conflict keeps the status pending even when the locator verified a mint', async () => {
    const right = syntheticMint(TIP_AT_SUBMISSION + 50, { salt: 2 })
    const wrong = syntheticMint(TIP_AT_SUBMISSION + 198, { payTo: OTHER, salt: 1 })
    const w = new World([right, wrong]); w.hiddenFromAudit.add(right.row.txHash)
    const r = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(r.locator?.state).toBe('minted')
    expect(r).toMatchObject({ state: 'conflict-awaiting-confirmations', retryable: true, conflict: 'no-recipient-credit', proof: null })
  })

  it('the scanners verify DIFFERENT mint transactions: mint-evidence-inconsistent, for review', async () => {
    const a = syntheticMint(TIP_AT_SUBMISSION + 40, { salt: 3 })
    const b = syntheticMint(TIP_AT_SUBMISSION + 60, { salt: 4 })
    const w = new World([a, b]); w.hiddenFromAudit.add(a.row.txHash)
    const r = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(r.locator?.candidate?.txHash).toBe(a.row.txHash)
    expect(r.audit?.candidate?.txHash).toBe(b.row.txHash)
    expect(r).toMatchObject({ state: 'mint-evidence-inconsistent', retryable: false, mint: null, proof: null })
  })

  it('a disagreement with a SHALLOW candidate stays pending, cursors held before both, and becomes final once both are deep', async () => {
    const a = syntheticMint(TIP_AT_SUBMISSION + 40, { salt: 3 })
    const b = syntheticMint(TIP_AT_SUBMISSION + 195, { salt: 4 })
    const w = new World([payment(TIP_AT_SUBMISSION + 10), a, b]); w.hiddenFromAudit.add(a.row.txHash)
    const first = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(first.locator?.state).toBe('minted')
    expect(first.audit?.state).toBe('awaiting-confirmations')
    expect(first).toMatchObject({ state: 'disagreement-awaiting-confirmations', retryable: true, mint: null, proof: null })
    expect(first.cursors.locator).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 10, txIndex: 0 })
    expect(first.cursors.audit).toMatchObject({ blockHeight: TIP_AT_SUBMISSION + 10, txIndex: 0 })

    w.tipHeight += 20
    const later = await checkXReserveInboundStatus(input({ tracking: persisted(fresh(), first), auditDue: true }), w.reads())
    expect(later.locator?.candidate?.txHash).toBe(a.row.txHash)
    expect(later.audit?.candidate?.txHash).toBe(b.row.txHash)
    expect(later).toMatchObject({ state: 'mint-evidence-inconsistent', retryable: false })
  })

  it('a deep conflict still wins over a scanner disagreement', async () => {
    const a = syntheticMint(TIP_AT_SUBMISSION + 40, { salt: 3 })
    const wrong = syntheticMint(TIP_AT_SUBMISSION + 45, { payTo: OTHER, salt: 5 })
    const w = new World([a, wrong]); w.hiddenFromAudit.add(a.row.txHash)
    const r = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(r).toMatchObject({ state: 'mint-conflict', conflict: 'no-recipient-credit' })
  })
})

describe('the source is re-verified on every call', () => {
  it('a rollback after minted: source-pending, no Cardano reads, stored cursors kept', async () => {
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)])
    const first = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(first.state).toBe('minted')
    const tracking = persisted(fresh(), first)
    w.evidence = { transaction: null, receipt: null, block: null, tipBlockNumber: ETH_TIP }
    w.log = []
    const r = await checkXReserveInboundStatus(input({ tracking, auditDue: true }), w.reads())
    expect(r).toMatchObject({ state: 'source-pending', sourceCode: 'not-found', linkCode: null, retryable: true, mint: null })
    expect(w.log).toEqual(['ethereum'])
    expect(w.cardanoReads()).toEqual([])
    expect(r.cursors).toEqual({ locator: tracking.locatorCursor, audit: tracking.auditCursor })
  })

  it('a source that is now too shallow is source-pending before any Cardano read', async () => {
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)])
    const e = derivedEvidence(); e.tipBlockNumber = ETH_BLOCK.number; w.evidence = e
    const r = await checkXReserveInboundStatus(input(), w.reads())
    expect(r).toMatchObject({ state: 'source-pending', sourceCode: 'insufficient-confirmations' })
    expect(w.log).toEqual(['ethereum'])
  })
})

describe('Circle and provider failures are never an absence', () => {
  it('an empty Circle list is attestation-pending, retryable, with no Cardano reads', async () => {
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)]); w.circle = { attestations: [] }
    const r = await checkXReserveInboundStatus(input({ auditDue: true }), w.reads())
    expect(r).toMatchObject({ state: 'attestation-pending', retryable: true, linkCode: 'attestation-missing' })
    expect(w.cardanoReads()).toEqual([])
  })

  it('Circle rate-limited or down: provider-unavailable (circle), retryable, cursors kept', async () => {
    for (const err of [new ProviderFault('rate-limited', 'x'), new TypeError('socket hang up')]) {
      const w = new World(); w.circleError = err
      const tracking = fresh()
      const r = await checkXReserveInboundStatus(input({ tracking }), w.reads())
      expect(r).toMatchObject({ state: 'provider-unavailable', retryable: true,
        providerFailure: { provider: 'circle', kind: err instanceof ProviderFault ? 'rate-limited' : 'unavailable' } })
      expect(r.cursors.locator).toEqual(tracking.locatorCursor)
      expect(w.log).toEqual(['ethereum', 'circle'])
    }
  })

  it('Ethereum RPC failure: provider-unavailable (ethereum), Circle not asked, nothing read on Cardano', async () => {
    const w = new World(); w.ethError = new EthereumEvidenceError('unavailable', 'Ethereum evidence: every endpoint failed')
    const r = await checkXReserveInboundStatus(input(), w.reads())
    expect(r).toMatchObject({ state: 'provider-unavailable', retryable: true, providerFailure: { provider: 'ethereum', kind: 'unavailable' } })
    expect(w.log).toEqual(['ethereum'])
  })

  it('evidence returned for another hash is refused as a provider fault', async () => {
    const reads = new World().reads()
    reads.readEthereumEvidence = async () => ({ sourceTxHash: `0x${'ab'.repeat(32)}`, evidence: derivedEvidence() as never })
    const r = await checkXReserveInboundStatus(input(), reads)
    expect(r).toMatchObject({ state: 'provider-unavailable', providerFailure: { provider: 'ethereum', kind: 'inconsistent' } })
  })

  it('Cardano rate-limited: cardano-unknown, retryable, scan progress preserved', async () => {
    const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)]); w.cardanoError = new CardanoReaderError('rate-limited')
    const tracking = fresh()
    const r = await checkXReserveInboundStatus(input({ tracking }), w.reads())
    expect(r).toMatchObject({ state: 'cardano-unknown', retryable: true, mint: null })
    expect(r.cursors.locator).toEqual(tracking.locatorCursor)
  })
})

describe('tracking record', () => {
  const cases: Array<[string, (t: InboundTracking) => InboundTracking, boolean, string]> = [
    ['no submission tip', t => ({ ...t, cardanoTipAtSubmission: null }), false, 'submission-tip-missing'],
    ['an unreadable submission tip', t => ({ ...t, cardanoTipAtSubmission: { blockHeight: -1 } }), false, 'submission-tip-missing'],
    ['no locator cursor', t => ({ ...t, locatorCursor: undefined }), false, 'locator-cursor-missing'],
    ['a locator cursor for another deposit', t => ({ ...t, locatorCursor: { ...(t.locatorCursor as object), sourceTxHash: `0x${'cd'.repeat(32)}` } }), false, 'locator-cursor-invalid'],
    ['a locator cursor for another recipient', t => ({ ...t, locatorCursor: { ...(t.locatorCursor as object), recipient: OTHER } }), false, 'locator-cursor-invalid'],
    ['no audit cursor when the audit is due', t => ({ ...t, auditCursor: null }), true, 'audit-cursor-missing'],
    ['no audit cursor even when the audit is NOT due', t => ({ ...t, auditCursor: undefined }), false, 'audit-cursor-missing'],
    ['a malformed audit cursor (audit not due)', t => ({ ...t, auditCursor: { v: 1 } }), false, 'audit-cursor-invalid'],
    ['an audit cursor for another deposit (audit not due)', t => ({ ...t, auditCursor: { ...(t.auditCursor as object), sourceTxHash: `0x${'cd'.repeat(32)}` } }), false, 'audit-cursor-invalid'],
    ['an audit cursor for another recipient (audit due)', t => ({ ...t, auditCursor: { ...(t.auditCursor as object), recipient: OTHER } }), true, 'audit-cursor-invalid'],
  ]
  for (const [name, mutate, auditDue, code] of cases) {
    it(`${name} → tracking-error ${code}, before any read`, async () => {
      const w = new World([syntheticMint(TIP_AT_SUBMISSION + 50)])
      const r = await checkXReserveInboundStatus(input({ tracking: mutate(fresh()), auditDue }), w.reads())
      expect(r).toMatchObject({ state: 'tracking-error', trackingError: code, retryable: false, cursors: { locator: null, audit: null } })
      expect(r.state).not.toBe('awaiting-mint')
      expect(w.log).toEqual([])
    })
  }


  it('startXReserveInboundTracking seeds both cursors from the submission tip, and refuses a missing tip', () => {
    const t = startXReserveInboundTracking(RECIPIENT, SOURCE, { blockHeight: TIP_AT_SUBMISSION })
    expect(t.locatorCursor).toMatchObject({ blockHeight: TIP_AT_SUBMISSION, txIndex: -1, recipient: RECIPIENT, sourceTxHash: SOURCE })
    expect(t.auditCursor).toMatchObject({ blockHeight: TIP_AT_SUBMISSION, txIndex: -1, kind: 'usdcx-asset-audit' })
    expect(() => startXReserveInboundTracking(RECIPIENT, SOURCE, undefined as never)).toThrow(RangeError)
  })

  it('invalid arguments are refused before any read', async () => {
    const w = new World()
    for (const over of [{ sourceTxHash: '0x1234' }, { confirmations: { ethereum: 0, cardano: 10 } }, { auditDue: 'yes' as never }]) {
      expect((await checkXReserveInboundStatus(input(over), w.reads())).state).toBe('invalid-input')
    }
    expect(w.log).toEqual([])
  })
})

describe('Circle is asked only for a verified source', () => {
  it('a Circle outage cannot mask a reverted source', async () => {
    const w = new World(); w.circleError = new ProviderFault('unavailable', 'x')
    const e = derivedEvidence(); (e.receipt as Record<string, unknown>).status = '0x0'; w.evidence = e
    const r = await checkXReserveInboundStatus(input(), w.reads())
    expect(r).toMatchObject({ state: 'source-failed', sourceCode: 'reverted', retryable: false, providerFailure: null })
    expect(w.log).toEqual(['ethereum'])
  })

  it('a Circle outage cannot mask an unapproved source (the real public transaction)', async () => {
    const w = new World(); w.circleError = new ProviderFault('rate-limited', 'x')
    w.evidence = { transaction: clone(ETH_TX), receipt: clone(ETH_RECEIPT), block: clone(ETH_BLOCK), tipBlockNumber: ETH_TIP }
    const r = await checkXReserveInboundStatus(input(), w.reads())
    expect(r).toMatchObject({ state: 'source-not-approved', sourceCode: 'calldata-mismatch', providerFailure: null })
    expect(w.log).toEqual(['ethereum'])
  })

  it('inconsistent source evidence is returned before Circle', async () => {
    const w = new World(); const e = derivedEvidence(); e.block.hash = `0x${'ef'.repeat(32)}`; w.evidence = e
    const r = await checkXReserveInboundStatus(input(), w.reads())
    expect(r).toMatchObject({ state: 'source-inconsistent', sourceCode: 'block-mismatch', retryable: true })
    expect(w.log).toEqual(['ethereum'])
  })

  it('a verified source with Circle down is provider-unavailable and carries the verified source', async () => {
    const w = new World(); w.circleError = new ProviderFault('unavailable', 'x')
    const r = await checkXReserveInboundStatus(input(), w.reads())
    expect(r).toMatchObject({ state: 'provider-unavailable', sourceCode: 'verified', providerFailure: { provider: 'circle', kind: 'unavailable' } })
  })
})

describe('SYNTHETIC: more than 20 transactions earlier in the SAME block as the mint', () => {
  it('later polls reach the mint and keep re-verifying it without getting stuck', async () => {
    const block = TIP_AT_SUBMISSION + 50
    const earlier = Array.from({ length: 25 }, (_, i) => payment(block, RECIPIENT, 200 + i, i))
    const earlierOther = Array.from({ length: 25 }, (_, i) => payment(block, OTHER, 300 + i, 25 + i))
    const mint = syntheticMint(block, { txIndex: 60 })
    const w = new World([...earlier, ...earlierOther, mint])
    let tracking = fresh()
    const states: string[] = []
    for (let poll = 0; poll < 7; poll++) {
      const r = await checkXReserveInboundStatus(input({ tracking, auditDue: true }), w.reads())
      states.push(`${r.state}/${r.locator?.state}/${r.audit?.state}`)
      tracking = persisted(tracking, r)
    }
    // 50 earlier rows in the block: the address scan (25 of them) reaches the mint
    // on poll 2, the audit (all 50) on poll 3; both then keep re-verifying it.
    expect(states).toEqual([
      'cardano-unknown/unknown/unknown',
      'minted/minted/unknown',
      ...Array(5).fill('minted/minted/minted'),
    ])
    expect(tracking.locatorCursor).toMatchObject({ blockHeight: block, txIndex: 24 })
    expect(tracking.auditCursor).toMatchObject({ blockHeight: block, txIndex: 49 })
  })
})

describe('xreserveInboundReads wires the supplied fetches to the intended readers', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const CONFIG = { swapProxyUrl: '', clientToken: '', alchemyKey: '', blockfrostKey: '' } as unknown as WalletConfig

  it('the supplied fetch serves Ethereum RPC and Circle; the supplied Blockfrost fetch serves both scanners; global fetch is never used', async () => {
    const globalFetch = vi.fn(async () => { throw new Error('global fetch must not be used') })
    vi.stubGlobal('fetch', globalFetch)
    const fetchCalls: string[] = []
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      fetchCalls.push(url)
      if (url.startsWith(XRESERVE_ATTESTATIONS_URL)) return new Response(JSON.stringify({ attestations: [] }), { status: 200 })
      const req = JSON.parse(String(init?.body)) as { id: number; method: string }
      const result = req.method === 'eth_chainId' ? '0x1' : req.method === 'eth_blockNumber' ? '0x10' : null
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), { status: 200 })
    })
    const bfPaths: string[] = []
    const blockfrostFetch = vi.fn(async (path: string, config: WalletConfig) => {
      expect(config).toBe(CONFIG)
      bfPaths.push(path)
      return new Response(JSON.stringify(path === 'blocks/latest' ? { height: 123 } : []), { status: 200 })
    })
    const reads = xreserveInboundReads(CONFIG, { fetchFn, blockfrostFetch })

    const snap = await reads.readEthereumEvidence(SOURCE)
    expect(snap.evidence).toEqual({ transaction: null, receipt: null, block: null, tipBlockNumber: '0x10' })
    expect(new Set(fetchCalls)).toEqual(new Set([PUBLIC_RPCS.ethereum[0]]))

    fetchCalls.length = 0
    const circle = await reads.fetchAttestation(SOURCE)
    expect(circle).toEqual({ requestedTxHash: SOURCE, response: { attestations: [] } })
    expect(fetchCalls).toEqual([`${XRESERVE_ATTESTATIONS_URL}?txHash=${SOURCE}`])

    expect(await reads.locatorReader.tip()).toEqual({ blockHeight: 123 })
    expect(await reads.locatorReader.addressTransactions(RECIPIENT, { blockHeight: 5, txIndex: 0 }, 21)).toEqual([])
    expect(await reads.auditReader.tip()).toEqual({ blockHeight: 123 })
    expect(await reads.auditReader.assetTransactions(AUDITED_ASSET_UNIT, { blockHeight: 5, txIndex: 0 }, 21)).toEqual([])
    expect(bfPaths).toEqual([
      'blocks/latest',
      `addresses/${RECIPIENT}/transactions?order=asc&count=21&page=1&from=5:0`,
      'blocks/latest',
      `assets/${AUDITED_ASSET_UNIT}/transactions?order=asc&count=21&page=1&from=5:0`,
    ])
    expect(globalFetch).not.toHaveBeenCalled()
  })
})
