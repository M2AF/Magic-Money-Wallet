/**
 * The global USDCx mint audit, against an in-memory asset history. No network,
 * no keys: the reader is a mock, the one real mint is the public fixture
 * recorded read-only on 2026-09-27 (docs/XRESERVE-GATE2-RESEARCH.md) and
 * embedded below, and every proof decision is the real typed proof API.
 */
import { describe, it, expect } from 'vitest'
import { blake2b } from '@noble/hashes/blake2b'
import {
  auditXReserveCardanoMint, startMintAuditCursor, readMintAuditCursor, AuditReaderError,
  AUDIT_CANDIDATES_PER_POLL, AUDITED_ASSET_UNIT,
  type UsdcxAssetReader, type AssetTxRow, type AuditOutputs, type AuditMintInput, type MintAuditCursor,
} from './xreserve-cardano-mint-audit'
import { cborArray, cborMap, cborUint, cborBytes } from './cardano-cip30'
import { decodeCardanoAddress } from './cardano-pure'
import { CARDANO_USDCX_UNIT } from '../shared/swap-token-identity'

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

/** Koios tx_cbor for Cardano tx 24da9d4f5348c67d578ba18408df63c22c64e5468b3ea6b15797a5b4db1f2379 (block 13989038), recorded 2026-09-27. */
const MINT_TX_HASH = '24da9d4f5348c67d578ba18408df63c22c64e5468b3ea6b15797a5b4db1f2379'
const MINT_TX_CBOR = [
  '84aa00d9010282825820b670cab9f262f6e7556ec5d245f641dad4dc3f576b927f9060e0718773f7905504825820c3a2772e',
  '621b2c06002887d04de0a2f4aa6615abfc6813ae302a0d51357dbc9e02018582581d611c75c5b878c190e7861f938a23e8d1',
  'c6914fc23f5df9058d678363c9821a000fd976a1581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34',
  'a14555534443781a713f8ff8825839017a9aee035f6eff7dd56b4078b497a63853438dffe51611a36d6eee61c8ab0b510424',
  '0cfa85aed8265cef4982cd9dcbc5b0c444ddc689dada821a00116d86a1581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe41',
  '4147860d557cac7e34a145555344437801a300583911a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658',
  '20c8b6203b361ed6ac9f74718b83c23b5f9b4a1de9923f2b96e521b601821a00167de4a1581ca3d5052864638828bc3fbc0d',
  '5b9a4223e233620d7911a5376ed4b658a14001028201d81858499f58201a03b7fef85a9d485c8b0abfccedd8acaf8c056ad4',
  '5f0017e59ef93f94a7f51e58201a2546a6091864db9d016e6588a48d31b706c8c8becb903b1aac6e811e7f70a9d87a80ffa3',
  '00583911a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b65820c8b6203b361ed6ac9f74718b83c23b5f9b',
  '4a1de9923f2b96e521b601821a00167de4a1581ca3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658a140',
  '01028201d81858499f58201a2546a6091864db9d016e6588a48d31b706c8c8becb903b1aac6e811e7f70a958201a3ca7f5a5',
  'c642408519ee8aa8a065baf87d8f15d72214ddb52f1056a56e724ad87a80ff82583901cd742f544cdf6a90d8b6c780ffd9c1',
  'c36239ddb9f08bc84eeb962c9920c8b6203b361ed6ac9f74718b83c23b5f9b4a1de9923f2b96e521b61b0000000115a84ee0',
  '021a0005f35405a1581df1d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b0009a2581c1f3aec8bfe7e',
  'a4fe14c5f121e2a92e301afe414147860d557cac7e34a14555534443781a713f8ff9581ca3d5052864638828bc3fbc0d5b9a',
  '4223e233620d7911a5376ed4b658a140010b58203afccb970b9a553373dfcd44ab1ca7967ea87fae68942b931ebaa03d991d',
  '9cd80dd9010281825820b670cab9f262f6e7556ec5d245f641dad4dc3f576b927f9060e0718773f79055041082583901cd74',
  '2f544cdf6a90d8b6c780ffd9c1c36239ddb9f08bc84eeb962c9920c8b6203b361ed6ac9f74718b83c23b5f9b4a1de9923f2b',
  '96e521b61b0000000115dd1a16111a0008ecfe12d901028482582076e8e5a5eb9ae1562b7c6afb042037f76c4b097c9857e9',
  '5c9285a07c5e612ffa0082582086c9f9a54f11627a3b4c0b9577d0a5074eb366b08555192c1d6213239e2854e10082582086',
  'c9f9a54f11627a3b4c0b9577d0a5074eb366b08555192c1d6213239e2854e102825820d722c14b023979e92aae51978d9ead',
  '239ef3f94dc7131939d6a78a10c06eefc700a200d90102818258205ac220baf99a6688d9c285f22685ca1169c3683b1c9323',
  '5388700b220a17aa925840245484527d76e2b362cee9e5e4780293224bec965f496a1e0389ce0bc2d31543e92561f293dc3b',
  '6832d8b498ffe30105217698e37f64b9d19e8a3603a229820605a482000182d879808219a0ae1a00ee46a782010082d87980',
  '82198f191a00e27dba82010182d87a808219a7d21a00f866f082030082d8799f9f5f58405a2e0acd00000001000000000000',
  '00000000000000000000000000000000000000000000713f8ff9000027149ea9794d33dbcef3f77718e903816e877ab2577f',
  '58404d7ee653638f1f60fc671dd6000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c900000000',
  '0000000000000000a0b86991c6218b365840c1d19d4a2e9eb0ce3606eb48000000000000000000000000d0402a74d8d05e7c',
  '4a78e5e01fed14f94c0f4863000000000000000000000000000000000000000058400000000000000000009896801a2546a6',
  '091864db9d016e6588a48d31b706c8c8becb903b1aac6e811e7f70a90000005f000000000000000000000000000000005840',
  '0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  '00000000000000000000000000004f000000000000000000000000000000ff5f5840511b4362647330a3222f480b8e9cc4b3',
  '435241f006d039eb787423ee7e35751c466670f08add272632d703bff1f70fe9439d2494bf6da42953603be47cdacac3411c',
  'ffff0000010101ff821a0006153b1a0c89eefaf5f6',
].join('')

/** Koios tx_utxos outputs for the same transaction, normalized. */
const MINT_TX_OUTPUTS = [
  {
    "index": 0,
    "address": "addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax",
    "lovelace": "1038710",
    "assets": [
      {
        "unit": "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378",
        "quantity": "1899991032"
      }
    ]
  },
  {
    "index": 1,
    "address": "addr1q9af4msrtah07lw4ddq83dyh5cu9xsudllj3vydrd4hwucwg4v94zppypnagttkcyeww7jvzekwuh3dsc3zdm35fmtdq06agkg",
    "lovelace": "1142150",
    "assets": [
      {
        "unit": "1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e345553444378",
        "quantity": "1"
      }
    ]
  },
  {
    "index": 2,
    "address": "addr1zx3a2pfgv33cs29u877q6ku6gg37yvmzp4u3rffhdm2tvkpqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqttz40t",
    "lovelace": "1474020",
    "assets": [
      {
        "unit": "a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658",
        "quantity": "1"
      }
    ]
  },
  {
    "index": 3,
    "address": "addr1zx3a2pfgv33cs29u877q6ku6gg37yvmzp4u3rffhdm2tvkpqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqttz40t",
    "lovelace": "1474020",
    "assets": [
      {
        "unit": "a3d5052864638828bc3fbc0d5b9a4223e233620d7911a5376ed4b658",
        "quantity": "1"
      }
    ]
  },
  {
    "index": 4,
    "address": "addr1q8xhgt65fn0k4yxckmrcpl7ec8pkywwah8cghjzwawtzexfqezmzqwekrmt2e8m5wx9c8s3mt7d5580fjgljh9h9yxmqfnz6cg",
    "lovelace": "4658319072",
    "assets": []
  }
]

const SOURCE = '0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2'
const RECIPIENT = 'addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax'
const OTHER = 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8'
const AMOUNT = 1_899_991_033n
const MINT_HEIGHT = 13989038
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex')
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const ATT = CIRCLE_RESPONSE.attestations[0]
const POLICY = Buffer.from(CARDANO_USDCX_UNIT.mainnet.slice(0, 56), 'hex')
const NAME = Buffer.from(CARDANO_USDCX_UNIT.mainnet.slice(56), 'hex')
const usdcxValue = (q: bigint) => cborArray([cborUint(1_500_000n), cborMap([[cborBytes(POLICY), cborMap([[cborBytes(NAME), cborUint(q)]])]])])

interface ChainTx { row: AssetTxRow; cbor: string; outputs: AuditOutputs }

function assemble(body: Uint8Array, ws: Uint8Array, rowAt: { blockHeight: number; txIndex: number }, outputs: AuditOutputs, isValid = 0xf5): ChainTx {
  return {
    row: { txHash: hexOf(blake2b(body, { dkLen: 32 })), ...rowAt },
    cbor: hexOf(new Uint8Array([0x84, ...body, ...ws, isValid, 0xf6])),
    outputs,
  }
}

/** An ordinary USDCx transfer between two addresses (no mint, no attestation) — most of the asset history. */
function usdcxTransfer(blockHeight: number, txIndex: number, to = OTHER, qty = 1_000_000n, salt = 0): ChainTx {
  const input = new Uint8Array(32); input[0] = salt & 0xff; input[1] = (salt >> 8) & 0xff; input[2] = txIndex
  const body = cborMap([
    [cborUint(0), cborArray([cborArray([cborBytes(input), cborUint(0)])])],
    [cborUint(1), cborArray([cborArray([cborBytes(decodeCardanoAddress(to)), usdcxValue(qty)])])],
    [cborUint(2), cborUint(170_000n)],
  ])
  return assemble(body, cborMap([]), { blockHeight, txIndex },
    [{ index: 0, address: to, lovelace: '1500000', assets: [{ unit: CARDANO_USDCX_UNIT.mainnet, quantity: qty.toString() }] }])
}

/** A transaction whose withdraw-zero redeemer carries Circle's REAL payload and signature. */
function attestedMint(blockHeight: number, opts: { payTo?: string; mintQty?: bigint; credit?: bigint } = {}): ChainTx {
  const payTo = opts.payTo ?? RECIPIENT
  const credit = opts.credit ?? AMOUNT - 1n
  const reward = new Uint8Array([0xf1, ...Buffer.from('d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b', 'hex')])
  const body = cborMap([
    [cborUint(0), cborArray([cborArray([cborBytes(new Uint8Array(32).fill(0xee)), cborUint(0)])])],
    [cborUint(1), cborArray([cborArray([cborBytes(decodeCardanoAddress(payTo)), usdcxValue(credit)])])],
    [cborUint(2), cborUint(500_000n)],
    [cborUint(5), cborMap([[cborBytes(reward), cborUint(0)]])],
    [cborUint(9), cborMap([[cborBytes(POLICY), cborMap([[cborBytes(NAME), cborUint(opts.mintQty ?? AMOUNT)]])]])],
  ])
  const pair = new Uint8Array([0xd8, 0x79, ...cborArray([cborArray([
    cborBytes(Buffer.from(ATT.payload.slice(2), 'hex')), cborBytes(Buffer.from(ATT.attestation.slice(2), 'hex'))])])])
  const ws = cborMap([[cborUint(5), cborArray([cborArray([cborUint(3), cborUint(0), pair, cborArray([cborUint(1), cborUint(1)])])])]])
  return assemble(body, ws, { blockHeight, txIndex: 0 },
    [{ index: 0, address: payTo, lovelace: '1500000', assets: [{ unit: CARDANO_USDCX_UNIT.mainnet, quantity: credit.toString() }] }])
}

const theMint = (): ChainTx => ({
  row: { txHash: MINT_TX_HASH, blockHeight: MINT_HEIGHT, txIndex: 0 }, cbor: MINT_TX_CBOR, outputs: clone(MINT_TX_OUTPUTS),
})

class MockAssetHistory implements UsdcxAssetReader {
  tipHeight = MINT_HEIGHT + 100
  calls = { pages: [] as string[], txs: [] as string[] }
  failTxRead: ((h: string) => Error | null) | null = null
  failPage: Error | null = null
  constructor(public txs: ChainTx[] = []) {}
  async assetTransactions(assetUnit: string, from: { blockHeight: number; txIndex: number }, count: number) {
    expect(assetUnit).toBe(AUDITED_ASSET_UNIT)
    this.calls.pages.push(`${from.blockHeight}:${from.txIndex}/${count}`)
    if (this.failPage) throw this.failPage
    return [...this.txs]
      .sort((a, b) => a.row.blockHeight - b.row.blockHeight || a.row.txIndex - b.row.txIndex)
      .filter(t => t.row.blockHeight > from.blockHeight || (t.row.blockHeight === from.blockHeight && t.row.txIndex >= from.txIndex))
      .slice(0, count).map(t => ({ ...t.row }))
  }
  async confirmedTransaction(txHash: string) {
    this.calls.txs.push(txHash)
    const failed = this.failTxRead?.(txHash)
    if (failed) throw failed
    const t = this.txs.find(x => x.row.txHash === txHash)
    if (!t) throw new AuditReaderError('not-found')
    return { txHash, blockHeight: t.row.blockHeight, cbor: t.cbor }
  }
  async transactionOutputs(txHash: string) { return clone(this.txs.find(x => x.row.txHash === txHash)!.outputs) }
  async tip() { return { blockHeight: this.tipHeight } }
}

const START = (height = MINT_HEIGHT - 1000) => startMintAuditCursor(RECIPIENT, SOURCE, { blockHeight: height })
const input = (cursor: MintAuditCursor, over: Partial<AuditMintInput> = {}): AuditMintInput => ({
  approved: { recipient: RECIPIENT, amountRaw: AMOUNT },
  sourceTxHash: SOURCE,
  attestation: { requestedTxHash: SOURCE, response: clone(CIRCLE_RESPONSE) },
  cursor, minConfirmations: 10, ...over,
})
/** `n` unrelated transfers, one per block, after the start cursor. */
const transfers = (n: number, from = MINT_HEIGHT - 900) => Array.from({ length: n }, (_, i) => usdcxTransfer(from + i, 0, OTHER, 1_000_000n + BigInt(i), i))

describe('the global audit finds the public mint', () => {
  it('among USDCx transfers: minted, with the proof and depth', async () => {
    const h = new MockAssetHistory([...transfers(3), theMint()])
    const r = await auditXReserveCardanoMint(input(START()), h)
    expect(r).toMatchObject({ state: 'minted', retryable: false, checked: 4 })
    expect(r.proof).toMatchObject({ verified: true, cardanoTxHash: MINT_TX_HASH, creditedRaw: '1899991032' })
    expect(r.candidate).toMatchObject({ txHash: MINT_TX_HASH, confirmations: 101 })
  })

  it('unrelated transfers — even of the same amount, to the approved address — are never taken for the mint', async () => {
    const lookalike = usdcxTransfer(MINT_HEIGHT - 5, 0, RECIPIENT, AMOUNT - 1n, 7)
    const r = await auditXReserveCardanoMint(input(START()), new MockAssetHistory([...transfers(4), lookalike]))
    expect(r).toMatchObject({ state: 'no-match-yet', scanComplete: true, proof: null, checked: 5 })
    expect(r.cursor).toMatchObject({ blockHeight: MINT_HEIGHT - 5, txIndex: 0 })
  })
})

describe('an attested mint paid ONLY to another address — invisible to the address locator', () => {
  it('is a mint-conflict (no-recipient-credit): needs review, not a refund, cursor held before it', async () => {
    const elsewhere = attestedMint(MINT_HEIGHT - 20, { payTo: OTHER })
    const h = new MockAssetHistory([...transfers(2), elsewhere])
    const r = await auditXReserveCardanoMint(input(START()), h)
    expect(r).toMatchObject({ state: 'mint-conflict', retryable: false, conflict: 'no-recipient-credit', proof: null })
    expect(r.candidate?.txHash).toBe(elsewhere.row.txHash)
    expect(r.cursor!.blockHeight).toBeLessThan(elsewhere.row.blockHeight)
    expect((await auditXReserveCardanoMint(input(r.cursor!), h)).state).toBe('mint-conflict')   // still there on re-run
  })

  it('other wrong mints carrying the attestation are conflicts too', async () => {
    const tiny = attestedMint(MINT_HEIGHT - 20, { mintQty: 1n, credit: 1n })
    expect((await auditXReserveCardanoMint(input(START()), new MockAssetHistory([tiny]))).conflict).toBe('mint-amount-mismatch')
  })
})

describe('bounded, resumable scanning', () => {
  it('more than 20 rows: 20 per poll, then the mint, never re-reading the first 20', async () => {
    const noise = transfers(27)
    const h = new MockAssetHistory([...noise, theMint()])
    const first = await auditXReserveCardanoMint(input(START()), h)
    expect(first).toMatchObject({ state: 'unknown', retryable: true, checked: AUDIT_CANDIDATES_PER_POLL })
    expect(first.cursor).toMatchObject({ blockHeight: noise[19].row.blockHeight, txIndex: 0 })
    h.calls.txs = []
    const second = await auditXReserveCardanoMint(input(first.cursor!), h)
    expect(second.state).toBe('minted')
    expect(h.calls.txs).toEqual([...noise.slice(20).map(t => t.row.txHash), MINT_TX_HASH])
  })

  it('restart from a cursor saved as JSON, into a fresh reader', async () => {
    const noise = transfers(25)
    const first = await auditXReserveCardanoMint(input(START()), new MockAssetHistory([...noise, theMint()]))
    const restored = readMintAuditCursor(JSON.parse(JSON.stringify(first.cursor)))!
    const fresh = new MockAssetHistory([...noise, theMint()])
    const r = await auditXReserveCardanoMint(input(restored), fresh)
    expect(r.state).toBe('minted')
    expect(fresh.calls.txs[0]).toBe(noise[20].row.txHash)
  })

  it('inclusive cursor: the row AT the cursor is not re-read; later rows in its block are', async () => {
    const hgt = MINT_HEIGHT - 500
    const a = usdcxTransfer(hgt, 0, OTHER, 1n, 1), b = usdcxTransfer(hgt, 1, OTHER, 2n, 2), c = usdcxTransfer(hgt, 2, OTHER, 3n, 3)
    const h = new MockAssetHistory([a, b, c])
    const cursor: MintAuditCursor = { ...START(), blockHeight: hgt, txIndex: 1 }
    const r = await auditXReserveCardanoMint(input(cursor), h)
    expect(h.calls.pages[0]).toBe(`${hgt}:1/${AUDIT_CANDIDATES_PER_POLL + 1}`)
    expect(h.calls.txs).toEqual([c.row.txHash])
    expect(r).toMatchObject({ state: 'no-match-yet', scanComplete: true })
    // The submission cursor (index -1) includes transaction 0 of its block.
    const q = new MockAssetHistory([a])
    await auditXReserveCardanoMint(input(startMintAuditCursor(RECIPIENT, SOURCE, { blockHeight: hgt })), q)
    expect(q.calls.txs).toEqual([a.row.txHash])
  })

  it('the end of today\'s asset history is "no match yet"; a later poll checks only newer transactions', async () => {
    const h = new MockAssetHistory(transfers(3))
    const first = await auditXReserveCardanoMint(input(START()), h)
    expect(first).toMatchObject({ state: 'no-match-yet', retryable: true, scanComplete: true })
    h.txs.push(theMint()); h.calls.txs = []
    expect((await auditXReserveCardanoMint(input(first.cursor!), h)).state).toBe('minted')
    expect(h.calls.txs).toEqual([MINT_TX_HASH])
  })
})

describe('confirmation depth', () => {
  it('a verified mint below the required depth waits, cursor not past it', async () => {
    const h = new MockAssetHistory([theMint()])
    h.tipHeight = MINT_HEIGHT + 2   // 3 confirmations
    const r = await auditXReserveCardanoMint(input(START(), { minConfirmations: 6 }), h)
    expect(r).toMatchObject({ state: 'awaiting-confirmations', retryable: true, proof: null })
    expect(r.candidate?.confirmations).toBe(3)
    expect(r.cursor).toEqual(START())
    h.tipHeight = MINT_HEIGHT + 5
    expect((await auditXReserveCardanoMint(input(r.cursor!, { minConfirmations: 6 }), h)).state).toBe('minted')
  })

  it('a shallow unrelated transfer is kept for a later poll, not passed', async () => {
    const shallow = usdcxTransfer(MINT_HEIGHT + 99, 0, OTHER, 5n, 5)
    const r = await auditXReserveCardanoMint(input(START()), new MockAssetHistory([shallow]))
    expect(r).toMatchObject({ state: 'no-match-yet', scanComplete: false })
    expect(r.cursor).toEqual(START())
  })
})

describe('provider problems are retryable, with progress kept', () => {
  it('a failure mid-scan: unknown, cursor at the last checked row, next poll resumes at the failed one', async () => {
    const noise = transfers(8)
    const h = new MockAssetHistory([...noise, theMint()])
    h.failTxRead = (x) => (x === noise[4].row.txHash ? new AuditReaderError('unavailable', 'HTTP 502') : null)
    const r = await auditXReserveCardanoMint(input(START()), h)
    expect(r).toMatchObject({ state: 'unknown', retryable: true })
    expect(r.cursor).toMatchObject({ blockHeight: noise[3].row.blockHeight })
    h.failTxRead = null; h.calls.txs = []
    const next = await auditXReserveCardanoMint(input(r.cursor!), h)
    expect(h.calls.txs[0]).toBe(noise[4].row.txHash)
    expect(next.state).toBe('minted')
  })

  it('a rate-limited history page: unknown, cursor unchanged', async () => {
    const h = new MockAssetHistory([theMint()])
    h.failPage = new AuditReaderError('rate-limited')
    const r = await auditXReserveCardanoMint(input(START()), h)
    expect(r).toMatchObject({ state: 'unknown', retryable: true, cursor: START() })
    expect(r.reason).toMatch(/rate-limiting/)
  })

  it('malformed rows, out-of-order rows, and a transaction that is not the listed one', async () => {
    const a = new MockAssetHistory([theMint()])
    a.assetTransactions = async () => [{ txHash: 'x', blockHeight: 1, txIndex: 0 }]
    expect((await auditXReserveCardanoMint(input(START()), a)).state).toBe('unknown')
    const [x, y] = transfers(2)
    const b = new MockAssetHistory([x, y])
    b.assetTransactions = async () => [y.row, x.row]
    expect((await auditXReserveCardanoMint(input(START()), b)).reason).toMatch(/ascending/)
    const c = new MockAssetHistory([theMint()])
    c.confirmedTransaction = async (h) => ({ txHash: h, blockHeight: MINT_HEIGHT + 1, cbor: MINT_TX_CBOR })
    expect((await auditXReserveCardanoMint(input(START()), c)).reason).toMatch(/does not match the asset history/)
  })

  it('corrupt CBOR for the real mint is retried, never skipped and never verified', async () => {
    const h = new MockAssetHistory([theMint()])
    h.confirmedTransaction = async (tx) => ({ txHash: tx, blockHeight: MINT_HEIGHT, cbor: MINT_TX_CBOR.slice(0, 300) + (MINT_TX_CBOR[300] === '0' ? '1' : '0') + MINT_TX_CBOR.slice(301) })
    const r = await auditXReserveCardanoMint(input(START()), h)
    expect(r).toMatchObject({ state: 'unknown', proof: null, cursor: START() })
  })
})

describe('bindings and Circle', () => {
  it('awaiting attestation reads nothing from Cardano; a contradicting attestation needs review', async () => {
    const h = new MockAssetHistory([theMint()])
    expect(await auditXReserveCardanoMint(input(START(), { attestation: { requestedTxHash: SOURCE, response: { attestations: [] } } }), h))
      .toMatchObject({ state: 'awaiting-attestation', retryable: true })
    expect(h.calls.pages).toEqual([])
    expect(await auditXReserveCardanoMint(input(START(), { approved: { recipient: RECIPIENT, amountRaw: AMOUNT + 1n } }), h))
      .toMatchObject({ state: 'attestation-mismatch', retryable: false })
  })

  it('refuses an attestation for another hash, a cursor for another deposit, recipient or asset', async () => {
    const h = new MockAssetHistory([theMint()])
    const other = '0x' + 'ab'.repeat(32)
    expect((await auditXReserveCardanoMint(input(START(), { attestation: { requestedTxHash: other, response: clone(CIRCLE_RESPONSE) } }), h)).state).toBe('invalid-input')
    expect((await auditXReserveCardanoMint(input({ ...START(), sourceTxHash: other }), h)).state).toBe('invalid-input')
    expect((await auditXReserveCardanoMint(input({ ...START(), recipient: OTHER }), h)).state).toBe('invalid-input')
    expect((await auditXReserveCardanoMint(input({ ...START(), asset: '00'.repeat(28) } as MintAuditCursor), h)).state).toBe('invalid-input')
    expect((await auditXReserveCardanoMint(input(START(), { minConfirmations: 0 }), h)).state).toBe('invalid-input')
    expect(h.calls.pages).toEqual([])
  })
})

describe('a SHALLOW conflicting candidate is not a verdict until it is deep enough', () => {
  const SHALLOW_AT = MINT_HEIGHT + 95   // tip starts at +100 → 6 confirmations, below the required 10

  it('below depth: retryable wait, cursor held, no final conflict; at depth: mint-conflict (no-recipient-credit)', async () => {
    const elsewhere = attestedMint(SHALLOW_AT, { payTo: OTHER })
    const h = new MockAssetHistory([elsewhere])
    const waiting = await auditXReserveCardanoMint(input(START()), h)
    expect(waiting).toMatchObject({
      state: 'conflict-awaiting-confirmations', retryable: true,
      conflict: null, provisionalConflict: 'no-recipient-credit', proof: null,
    })
    expect(waiting.cursor).toEqual(START())

    h.tipHeight = SHALLOW_AT + 9
    const final = await auditXReserveCardanoMint(input(waiting.cursor!), h)
    expect(final).toMatchObject({ state: 'mint-conflict', retryable: false, conflict: 'no-recipient-credit', provisionalConflict: null })
    expect(final.cursor).toEqual(START())
  })

  it('after a rollback removes it, the next poll keeps no conflict', async () => {
    const h = new MockAssetHistory([attestedMint(SHALLOW_AT, { mintQty: 1n, credit: 1n })])
    expect((await auditXReserveCardanoMint(input(START()), h)).state).toBe('conflict-awaiting-confirmations')
    h.txs = [usdcxTransfer(SHALLOW_AT - 30, 0, OTHER, 5n, 3)]        // replaced by an ordinary transfer
    const after = await auditXReserveCardanoMint(input(START()), h)
    expect(after).toMatchObject({ state: 'no-match-yet', scanComplete: true, conflict: null, provisionalConflict: null })
  })

  it('after a rollback replaces it with the correct mint, the next poll reports the mint', async () => {
    const h = new MockAssetHistory([attestedMint(SHALLOW_AT, { payTo: OTHER })])
    expect((await auditXReserveCardanoMint(input(START()), h)).state).toBe('conflict-awaiting-confirmations')
    h.txs = [theMint()]
    expect((await auditXReserveCardanoMint(input(START()), h)).state).toBe('minted')
  })

  it('the existing DEEP wrong-recipient case is still a final no-recipient-credit conflict', async () => {
    const deep = attestedMint(MINT_HEIGHT - 20, { payTo: OTHER })
    const r = await auditXReserveCardanoMint(input(START()), new MockAssetHistory([deep]))
    expect(r).toMatchObject({ state: 'mint-conflict', retryable: false, conflict: 'no-recipient-credit', provisionalConflict: null })
  })
})

describe('a minted cursor stays immediately before the mint', () => {
  it('more than 20 transfers earlier in the SAME block: polls reach the mint, then keep re-verifying it without getting stuck', async () => {
    const mint = { ...theMint(), row: { txHash: MINT_TX_HASH, blockHeight: MINT_HEIGHT, txIndex: 30 } }
    const earlier = Array.from({ length: 30 }, (_, i) => usdcxTransfer(MINT_HEIGHT, i, OTHER, 1_000_000n + BigInt(i), 100 + i))
    const h = new MockAssetHistory([...earlier, mint])
    let cursor = START()
    const states: string[] = []
    for (let poll = 0; poll < 3; poll++) {
      const r = await auditXReserveCardanoMint(input(JSON.parse(JSON.stringify(cursor))), h)
      states.push(r.state)
      cursor = r.cursor!
    }
    expect(states).toEqual(['unknown', 'minted', 'minted'])
    expect(cursor).toMatchObject({ blockHeight: MINT_HEIGHT, txIndex: 29 })
    for (let poll = 0; poll < 3; poll++) {
      const r = await auditXReserveCardanoMint(input(cursor), h)
      expect(r).toMatchObject({ state: 'minted', checked: 1, candidate: { txHash: MINT_TX_HASH } })
      expect(r.cursor).toEqual(cursor)
    }
  })
})
