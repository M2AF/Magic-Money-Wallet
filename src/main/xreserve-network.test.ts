/**
 * xReserve network profiles: the Sepolia → Cardano Preprod profile works through
 * every module, and can never be crossed with mainnet. No network.
 *
 * Testnet evidence here is SYNTHETIC: the recorded mainnet Ethereum transaction
 * re-labelled as a Sepolia deposit built by the wallet's own builder, a Circle
 * attestation built from Circle's published layout with a placeholder
 * signature, and a Preprod mint built here. No live testnet deposit has been
 * observed yet.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { blake2b } from '@noble/hashes/blake2b'
import { bech32 } from '@scure/base'
import { encodeAbiParameters, keccak256, type Hex } from 'viem'
import {
  XRESERVE_MAINNET, XRESERVE_SEPOLIA_PREPROD, xreserveNetwork, xreserveNetworkFor, xreserveNetworkById, type XReserveNetwork,
} from './xreserve-network'
import {
  encodeCardanoRecipient, buildCardanoDepositRequest, validateCardanoDepositRequest, XReserveCardanoError,
} from './xreserve-cardano-deposit'
import { verifyXReserveEthereumDeposit, decodeDepositedToRemoteLog, DEPOSITED_TO_REMOTE_TOPIC } from './xreserve-ethereum-deposit-proof'
import { validateXReserveAttestation, evaluateMintCandidate } from './xreserve-cardano-mint-proof'
import { startMintAuditCursor, readMintAuditCursor, auditXReserveCardanoMint } from './xreserve-cardano-mint-audit'
import { startMintScanCursor, locateXReserveCardanoMint, type CardanoMintReader } from './xreserve-cardano-mint-locator'
import { linkXReserveSourceToAttestation } from './xreserve-source-attestation-link'
import { blockfrostMintReads, fetchXReserveAttestation } from './xreserve-cardano-provider'
import { blockfrostPreprodFetch } from './api-proxy'
import { ethereumEvidenceEndpoints, readXReserveEthereumEvidence } from './xreserve-ethereum-evidence-reader'
import { checkXReserveInboundStatus, startXReserveInboundTracking, type InboundReads } from './xreserve-inbound-status'
import {
  startXReserveInboundTrackingRecord, checkAndPersistXReserveInbound, inboundTrackingKey, type InboundTrackingStore,
} from './xreserve-inbound-tracking'
import { TESTNET_PUBLIC_RPCS, PUBLIC_RPCS } from './chain-config'
import { cborArray, cborMap, cborUint, cborBytes } from './cardano-cip30'
import { decodeCardanoAddress } from './cardano-pure'
import type { WalletConfig } from './secure-store'

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

const PRE = XRESERVE_SEPOLIA_PREPROD
const MAIN = XRESERVE_MAINNET
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex')

/** The payment key hash of the public mainnet recipient, re-used on Preprod. */
const PKH = '1c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9'
const SKH = 'c8b6203b361ed6ac9f74718b83c23b5f9b4a1de9923f2b96e521b601'.slice(0, 56)
const addr = (prefix: string, header: number, ...hashes: string[]) =>
  bech32.encode(prefix, bech32.toWords(Uint8Array.from([header, ...Buffer.from(hashes.join(''), 'hex')])), 1000)
const PREPROD_ENTERPRISE = addr('addr_test', 0x60, PKH)
const PREPROD_BASE = addr('addr_test', 0x00, PKH, SKH)
const MAINNET_ENTERPRISE = 'addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax'
const PREPROD_OTHER = addr('addr_test', 0x60, 'ab'.repeat(28))
const SENDER = '0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863'
const AMOUNT = 1_899_991_033n
const APPROVED = { recipient: PREPROD_ENTERPRISE, amountRaw: AMOUNT, maxFeeRaw: 10_000_000n }
const SEPOLIA_HEX = '0xaa36a7'

describe('the profiles', () => {
  it('pin Circle\'s documented values and cannot be edited or imitated', () => {
    expect(PRE).toMatchObject({
      ethereum: { chainId: 11155111, xReserve: '0x008888878f94C0d87defdf0B07f46B93C1934442', usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' },
      cardano: { networkId: 0, addressPrefix: 'addr_test', usdcxUnit: '31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf665553444378' },
      cardanoDomain: 10004, circleApiBase: 'https://xreserve-api-testnet.circle.com',
    })
    expect(MAIN.ethereum.chainId).toBe(1)
    expect(Object.isFrozen(PRE) && Object.isFrozen(PRE.ethereum) && Object.isFrozen(PRE.cardano)).toBe(true)
    expect(() => { (PRE.ethereum as { xReserve: string }).xReserve = '0x0' }).toThrow()
    expect(xreserveNetwork()).toBe(MAIN)
    expect(xreserveNetwork(PRE)).toBe(PRE)
    expect(() => xreserveNetwork(clone(PRE) as XReserveNetwork)).toThrow(TypeError)
    expect(xreserveNetworkFor(true)).toBe(PRE)
    expect(xreserveNetworkFor(false)).toBe(MAIN)
    expect(xreserveNetworkById('sepolia-preprod')).toBe(PRE)
    expect(xreserveNetworkById('toString')).toBeNull()
  })
})

describe('recipient encoding and the deposit call on Preprod', () => {
  it('encodes Preprod enterprise and base addresses exactly as on mainnet', () => {
    const e = encodeCardanoRecipient(PREPROD_ENTERPRISE, PRE)
    expect(e).toMatchObject({ addressKind: 'enterprise', remoteRecipient: `0x00000001${PKH}`, hookData: '0x' })
    const b = encodeCardanoRecipient(PREPROD_BASE, PRE)
    expect(b).toMatchObject({ addressKind: 'base', hookData: `0x${'00'.repeat(66)}01${SKH}` })
    expect(encodeCardanoRecipient(MAINNET_ENTERPRISE).remoteRecipient).toBe(e.remoteRecipient)
  })

  it('never crosses networks: mainnet addresses on Preprod and Preprod addresses on mainnet are refused', () => {
    expect(() => encodeCardanoRecipient(MAINNET_ENTERPRISE, PRE)).toThrow(/mainnet address; this deposit is on Cardano Preprod/)
    expect(() => encodeCardanoRecipient(PREPROD_ENTERPRISE)).toThrow(/testnet address; xReserve deposits here are mainnet only/)
    // An addr_test prefix over a mainnet header (network nibble 1) is refused too.
    expect(() => encodeCardanoRecipient(addr('addr_test', 0x61, PKH), PRE)).toThrow(/not for Cardano Preprod/)
  })

  it('builds the Sepolia call to Circle\'s Sepolia contract with Sepolia USDC', () => {
    const d = buildCardanoDepositRequest(APPROVED, PRE)
    expect(d).toMatchObject({ chainId: 11155111, to: PRE.ethereum.xReserve, value: 0n })
    expect(d.params).toMatchObject({ remoteDomain: 10004, localToken: PRE.ethereum.usdc, value: AMOUNT, maxFee: 10_000_000n })
    expect(d.data.slice(0, 10)).toBe('0xfaadb53b')
  })

  it('validates a Sepolia call only under the Sepolia profile', () => {
    const d = buildCardanoDepositRequest(APPROVED, PRE)
    const call = { chainId: d.chainId, to: d.to, value: 0n, data: d.data }
    expect(validateCardanoDepositRequest(call, APPROVED, PRE).value).toBe(AMOUNT)
    expect(() => validateCardanoDepositRequest(call, { ...APPROVED, recipient: MAINNET_ENTERPRISE })).toThrow(/not for Ethereum mainnet/)
    expect(() => validateCardanoDepositRequest({ ...call, chainId: 1 }, APPROVED, PRE)).toThrow(/not for Ethereum Sepolia/)
    const mainCall = buildCardanoDepositRequest({ ...APPROVED, recipient: MAINNET_ENTERPRISE })
    expect(() => validateCardanoDepositRequest({ chainId: 11155111, to: PRE.ethereum.xReserve, value: 0n, data: mainCall.data }, APPROVED, PRE))
      .toThrow(XReserveCardanoError)
  })
})

// ── SYNTHETIC Sepolia source evidence ─────────────────────────────────────────

const EVENT_LOG = ETH_RECEIPT.logs.findIndex(l => l.topics[0] === DEPOSITED_TO_REMOTE_TOPIC)
const REAL_EVENT = decodeDepositedToRemoteLog(ETH_RECEIPT.logs[EVENT_LOG])
const topicAddr = (a: string) => `0x${a.toLowerCase().replace(/^0x/, '').padStart(64, '0')}`

/** SYNTHETIC: the recorded evidence as a Sepolia deposit built by the wallet's builder. */
function sepoliaEvidence() {
  const d = buildCardanoDepositRequest(APPROVED, PRE)
  const tx = { ...clone(ETH_TX), chainId: SEPOLIA_HEX, to: PRE.ethereum.xReserve.toLowerCase(), input: d.data }
  const receipt = clone(ETH_RECEIPT) as unknown as { logs: Array<{ address: string; topics: string[]; data: string }> } & Record<string, unknown>
  const log = receipt.logs[EVENT_LOG]
  log.address = PRE.ethereum.xReserve.toLowerCase()
  log.topics = [DEPOSITED_TO_REMOTE_TOPIC, topicAddr(PRE.ethereum.usdc), topicAddr(SENDER), d.params.remoteRecipient]
  log.data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'bytes' }],
    [AMOUNT, 10004, REAL_EVENT.remoteToken as Hex, 10_000_000n, '0x'])
  return { transaction: tx, receipt, block: clone(ETH_BLOCK), tipBlockNumber: ETH_TIP as unknown }
}
const verifyInput = (network?: XReserveNetwork, evidence: unknown = sepoliaEvidence()) => ({
  sourceTxHash: ETH_TX.hash, approved: APPROVED, approvedSender: SENDER,
  evidence: evidence as never, minConfirmations: 12, network,
})

describe('SYNTHETIC Sepolia source verification', () => {
  it('verifies under the Sepolia profile', () => {
    expect(verifyXReserveEthereumDeposit(verifyInput(PRE))).toMatchObject({ state: 'verified', code: 'verified' })
  })
  it('is invalid under mainnet (a Preprod recipient cannot be a mainnet approval)', () => {
    expect(verifyXReserveEthereumDeposit(verifyInput())).toMatchObject({ state: 'invalid-input' })
  })
  it('a mainnet chain id under the Sepolia profile is wrong-chain; an event from another contract is missing', () => {
    const e = sepoliaEvidence(); e.transaction.chainId = '0x1'
    expect(verifyXReserveEthereumDeposit(verifyInput(PRE, e))).toMatchObject({ state: 'not-approved', code: 'wrong-chain' })
    const f = sepoliaEvidence(); f.receipt.logs[EVENT_LOG].address = MAIN.ethereum.xReserve.toLowerCase()
    expect(verifyXReserveEthereumDeposit(verifyInput(PRE, f))).toMatchObject({ code: 'event-missing' })
  })
})

// ── SYNTHETIC Preprod attestation and mint ────────────────────────────────────

const word = (n: bigint) => n.toString(16).padStart(64, '0')
function payload(localToken: string) {
  return `0x5a2e0acd00000001${word(AMOUNT)}${(10004).toString(16).padStart(8, '0')}${REAL_EVENT.remoteToken.slice(2)}`
    + `00000001${PKH}${localToken.slice(2).toLowerCase().padStart(64, '0')}${SENDER.slice(2).padStart(64, '0')}`
    + `${word(10_000_000n)}${'1a'.repeat(32)}00000000` as Hex
}
const SIG = `0x${'aa'.repeat(65)}`
const circle = (localToken = PRE.ethereum.usdc) => {
  const p = payload(localToken)
  return { attestations: [{ payload: p, messageHash: keccak256(p), attestation: SIG, remoteDomain: 10004 }] }
}

function preprodMint(opts: { unit?: string; rewardHeader?: number; payTo?: string; blockHeight?: number; salt?: number } = {}) {
  const unit = opts.unit ?? PRE.cardano.usdcxUnit
  const policy = Buffer.from(unit.slice(0, 56), 'hex'); const name = Buffer.from(unit.slice(56), 'hex')
  const payTo = opts.payTo ?? PREPROD_ENTERPRISE
  const value = cborArray([cborUint(1_500_000n), cborMap([[cborBytes(policy), cborMap([[cborBytes(name), cborUint(AMOUNT - 1n)]])]])])
  const reward = new Uint8Array([opts.rewardHeader ?? 0xf0, ...Buffer.from('d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b', 'hex')])
  const body = cborMap([
    [cborUint(0), cborArray([cborArray([cborBytes(new Uint8Array(32).fill(0xd0 + (opts.salt ?? 0))), cborUint(0)])])],
    [cborUint(1), cborArray([cborArray([cborBytes(decodeCardanoAddress(payTo)), value])])],
    [cborUint(2), cborUint(500_000n)],
    [cborUint(5), cborMap([[cborBytes(reward), cborUint(0)]])],
    [cborUint(9), cborMap([[cborBytes(policy), cborMap([[cborBytes(name), cborUint(AMOUNT)]])]])],
  ])
  const p = payload(PRE.ethereum.usdc)
  const pair = new Uint8Array([0xd8, 0x79, ...cborArray([cborArray([cborBytes(Buffer.from(p.slice(2), 'hex')), cborBytes(Buffer.from(SIG.slice(2), 'hex'))])])])
  const ws = cborMap([[cborUint(5), cborArray([cborArray([cborUint(3), cborUint(0), pair, cborArray([cborUint(1), cborUint(1)])])])]])
  const txHash = hexOf(blake2b(body, { dkLen: 32 }))
  return {
    row: { txHash, blockHeight: opts.blockHeight ?? 4_000_050, txIndex: 0 },
    cbor: hexOf(new Uint8Array([0x84, ...body, ...ws, 0xf5, 0xf6])),
    outputs: [{ index: 0, address: payTo, lovelace: '1500000', assets: [{ unit, quantity: (AMOUNT - 1n).toString() }] }],
  }
}

describe('SYNTHETIC Preprod attestation and mint', () => {
  it('the attestation validates only under the profile whose USDC it names', () => {
    const ok = validateXReserveAttestation(circle(), APPROVED, PRE)
    expect(ok).toMatchObject({ ok: true, attestation: { network: 'sepolia-preprod' } })
    expect(validateXReserveAttestation(circle(MAIN.ethereum.usdc), APPROVED, PRE)).toMatchObject({ ok: false, code: 'attestation-mismatch' })
    expect(validateXReserveAttestation(circle(), APPROVED)).toMatchObject({ ok: false, code: 'invalid-approval' })
  })

  it('a Preprod USDCx mint with a Preprod script withdrawal verifies', () => {
    const check = validateXReserveAttestation(circle(), APPROVED, PRE)
    if (!check.ok) throw new Error('unreachable')
    const m = preprodMint()
    expect(evaluateMintCandidate(check.attestation, { txHash: m.row.txHash, cbor: m.cbor }, m.outputs))
      .toMatchObject({ kind: 'verified', proof: { cardanoTxHash: m.row.txHash, mintedRaw: AMOUNT.toString() } })
  })

  it('never accepts the other network\'s asset or reward account', () => {
    const check = validateXReserveAttestation(circle(), APPROVED, PRE)
    if (!check.ok) throw new Error('unreachable')
    const mainUnit = preprodMint({ unit: MAIN.cardano.usdcxUnit })
    expect(evaluateMintCandidate(check.attestation, { txHash: mainUnit.row.txHash, cbor: mainUnit.cbor }, mainUnit.outputs))
      .toMatchObject({ kind: 'mint-conflict', code: 'no-usdcx-mint' })
    const mainReward = preprodMint({ rewardHeader: 0xf1 })
    expect(evaluateMintCandidate(check.attestation, { txHash: mainReward.row.txHash, cbor: mainReward.cbor }, mainReward.outputs))
      .toMatchObject({ kind: 'unrelated' })
    const forged = { ...check.attestation, network: 'devnet' as never }
    expect(evaluateMintCandidate(forged, { txHash: mainReward.row.txHash, cbor: mainReward.cbor })).toMatchObject({ kind: 'evidence-unreadable' })
  })
})

// ── Scanners, cursors and adapters ────────────────────────────────────────────

class Chain implements CardanoMintReader {
  txs = [preprodMint()]
  units: string[] = []
  async addressTransactions(_a: string, from: { blockHeight: number; txIndex: number }, count: number) {
    return this.txs.filter(t => t.row.blockHeight > from.blockHeight || (t.row.blockHeight === from.blockHeight && t.row.txIndex >= from.txIndex)).slice(0, count).map(t => ({ ...t.row }))
  }
  async assetTransactions(unit: string, from: { blockHeight: number; txIndex: number }, count: number) {
    this.units.push(unit); return this.addressTransactions('', from, count)
  }
  async confirmedTransaction(h: string) { const t = this.txs.find(x => x.row.txHash === h)!; return { txHash: h, blockHeight: t.row.blockHeight, cbor: t.cbor } }
  async transactionOutputs(h: string) { return clone(this.txs.find(x => x.row.txHash === h)!.outputs) }
  async tip() { return { blockHeight: 4_000_200 } }
}
const TIP0 = { blockHeight: 4_000_000 }
const attestationFor = () => ({ requestedTxHash: ETH_TX.hash, response: circle() })

describe('SYNTHETIC Preprod scanners', () => {
  it('the locator and the audit find the Preprod mint, and the audit reads the Preprod USDCx unit', async () => {
    const chain = new Chain()
    const base = { approved: APPROVED, sourceTxHash: ETH_TX.hash, attestation: attestationFor(), minConfirmations: 10, network: PRE }
    const l = await locateXReserveCardanoMint({ ...base, cursor: startMintScanCursor(PREPROD_ENTERPRISE, ETH_TX.hash, TIP0) }, chain)
    expect(l).toMatchObject({ state: 'minted' })
    const a = await auditXReserveCardanoMint({ ...base, cursor: startMintAuditCursor(PREPROD_ENTERPRISE, ETH_TX.hash, TIP0, PRE) }, chain)
    expect(a).toMatchObject({ state: 'minted' })
    expect(chain.units).toEqual([PRE.cardano.usdcxUnit])
  })

  it('an audit cursor is bound to its network\'s asset', () => {
    const c = startMintAuditCursor(PREPROD_ENTERPRISE, ETH_TX.hash, TIP0, PRE)
    expect(c.asset).toBe(PRE.cardano.usdcxUnit)
    expect(readMintAuditCursor(clone(c), PRE)).toEqual(c)
    expect(readMintAuditCursor(clone(c))).toBeNull()
    expect(readMintAuditCursor(clone(startMintAuditCursor(MAINNET_ENTERPRISE, ETH_TX.hash, TIP0)), PRE)).toBeNull()
  })
})

describe('adapters on Preprod', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  const CONFIG = { swapProxyUrl: 'https://proxy.example', clientToken: 'tag', alchemyKey: '', blockfrostKey: '', blockfrostPreprodKey: 'preprodKEY' } as unknown as WalletConfig

  it('Blockfrost reads accept only Preprod addresses', async () => {
    const paths: string[] = []
    const reads = blockfrostMintReads({ config: CONFIG, network: PRE, blockfrostFetch: async (p) => { paths.push(p); return new Response('[]') } })
    expect(await reads.addressTransactions(PREPROD_ENTERPRISE, { blockHeight: 1, txIndex: 0 }, 5)).toEqual([])
    await expect(reads.addressTransactions(MAINNET_ENTERPRISE, { blockHeight: 1, txIndex: 0 }, 5)).rejects.toThrow(/Cardano Preprod bech32/)
    expect(paths).toEqual([`addresses/${PREPROD_ENTERPRISE}/transactions?order=asc&count=5&page=1&from=1:0`])
  })

  it('the default Preprod reader calls Blockfrost Preprod directly with the user\'s key, never the mainnet proxy', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: init?.headers as Record<string, string> })
      return new Response(JSON.stringify({ height: 4_000_200 }))
    }))
    expect(await blockfrostMintReads({ config: CONFIG, network: PRE }).tip()).toEqual({ blockHeight: 4_000_200 })
    expect(calls).toEqual([{ url: 'https://cardano-preprod.blockfrost.io/api/v0/blocks/latest', headers: { project_id: 'preprodKEY' } }])
  })

  it('without a preprod key nothing is requested', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f)
    await expect(blockfrostPreprodFetch('blocks/latest', { ...CONFIG, blockfrostPreprodKey: '  ' })).rejects.toThrow(/No Blockfrost preprod project id/)
    await expect(blockfrostMintReads({ config: { ...CONFIG, blockfrostPreprodKey: undefined }, network: PRE }).tip()).rejects.toMatchObject({ kind: 'unavailable' })
    expect(f).not.toHaveBeenCalled()
  })

  it('Circle is asked on its testnet host', async () => {
    const urls: string[] = []
    await fetchXReserveAttestation(ETH_TX.hash, { network: PRE, fetchFn: async (u) => { urls.push(u); return new Response('{"attestations":[]}') } })
    expect(urls).toEqual([`https://xreserve-api-testnet.circle.com/v1/attestations?txHash=${ETH_TX.hash}`])
  })

  it('Ethereum evidence comes from Sepolia endpoints and requires chain id 0xaa36a7', async () => {
    const eps = ethereumEvidenceEndpoints(CONFIG, PRE)
    expect(eps[0].url).toContain('/rpc/alchemy/eth-sepolia')
    expect(eps.slice(1).map(e => e.url)).toEqual(TESTNET_PUBLIC_RPCS.ethereum)
    expect(eps.slice(1).map(e => e.url)).not.toEqual(PUBLIC_RPCS.ethereum)
    const chainIds = ['0x1', SEPOLIA_HEX]
    const fetchFn = async (_u: string, init?: RequestInit) => {
      const req = JSON.parse(String(init?.body))
      const result = req.method === 'eth_chainId' ? chainIds.shift() : req.method === 'eth_blockNumber' ? '0x10' : null
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }))
    }
    const snap = await readXReserveEthereumEvidence(ETH_TX.hash, CONFIG, { network: PRE, fetchFn, endpoints: eps.slice(0, 2) })
    expect(snap.failedAttempts).toEqual([{ endpoint: 'wallet-rpc', method: 'eth_chainId', kind: 'wrong-chain' }])
    expect(snap.endpoint).toBe('public-rpc-1')
  })
})

// ── Link, coordinator and tracking on Preprod ─────────────────────────────────

function preprodReads(chain = new Chain(), network: XReserveNetwork | undefined = PRE): InboundReads {
  return {
    readEthereumEvidence: async (h) => ({ sourceTxHash: h, evidence: sepoliaEvidence() as never }),
    fetchAttestation: async (h) => ({ requestedTxHash: h, response: circle() }),
    locatorReader: chain, auditReader: chain, network,
  }
}

describe('SYNTHETIC Sepolia → Preprod end to end', () => {
  it('the link verifies the Sepolia source and binds the Preprod attestation', () => {
    const r = linkXReserveSourceToAttestation({
      sourceTxHash: ETH_TX.hash, approvedSender: SENDER, approved: APPROVED, evidence: sepoliaEvidence() as never,
      circle: attestationFor(), minConfirmations: 12, network: PRE,
    })
    expect(r).toMatchObject({ state: 'linked', attestation: { network: 'sepolia-preprod' } })
  })

  it('the coordinator reports minted, and refuses reads built for another network', async () => {
    const tracking = startXReserveInboundTracking(PREPROD_ENTERPRISE, ETH_TX.hash, TIP0, PRE)
    const input = { sourceTxHash: ETH_TX.hash, approvedSender: SENDER, approved: APPROVED,
      confirmations: { ethereum: 12, cardano: 10 }, tracking, auditDue: true, network: PRE }
    expect(await checkXReserveInboundStatus(input, preprodReads())).toMatchObject({ state: 'minted' })
    expect(await checkXReserveInboundStatus(input, preprodReads(new Chain(), MAIN)))
      .toMatchObject({ state: 'invalid-input', reason: 'the reads serve a different xReserve network than the deposit' })
    expect(await checkXReserveInboundStatus({ ...input, network: undefined }, preprodReads()))
      .toMatchObject({ state: 'invalid-input' })
  })

  it('a testnet tracking record starts, resumes and is never read as mainnet', async () => {
    const map = new Map<string, string>()
    const store: InboundTrackingStore = { load: async k => map.get(k) ?? null, save: async (k, j) => { map.set(k, j) } }
    const identity = { walletId: 'w', accountId: 'a0', environment: 'testnet' as const }
    const deposit = { identity, approvedSender: SENDER, sourceTxHash: ETH_TX.hash, approved: APPROVED }
    const started = await startXReserveInboundTrackingRecord({ ...deposit, confirmations: { ethereum: 12, cardano: 10 }, cardanoTipAtSubmission: TIP0 }, store)
    expect(started).toMatchObject({ kind: 'started', record: { identity: { environment: 'testnet' }, cursors: { audit: { asset: PRE.cardano.usdcxUnit } } } })
    expect([...map.keys()]).toEqual([inboundTrackingKey(identity, ETH_TX.hash)])
    expect([...map.keys()][0]).toContain(':testnet:')

    const checked = await checkAndPersistXReserveInbound({ ...deposit, auditDue: true }, preprodReads(), store)
    expect(checked).toMatchObject({ kind: 'checked', status: { state: 'minted' } })
    // Mainnet reads for a testnet record: refused by the coordinator, nothing saved.
    const crossed = await checkAndPersistXReserveInbound({ ...deposit, auditDue: true }, preprodReads(new Chain(), MAIN), store)
    expect(crossed).toMatchObject({ kind: 'checked', persisted: 'unchanged', status: { state: 'invalid-input' } })
    // The same record looked up as mainnet is refused as a bad approval (Preprod recipient).
    expect(await checkAndPersistXReserveInbound({ ...deposit, identity: { ...identity, environment: 'mainnet' }, auditDue: false }, preprodReads(), store))
      .toMatchObject({ kind: 'tracking-error', code: 'invalid-input' })
  })
})
