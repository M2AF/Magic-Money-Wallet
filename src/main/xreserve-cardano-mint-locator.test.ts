/**
 * The mint locator, against an in-memory Cardano provider. No network, no
 * keys: the Cardano reader is a mock, and the one real mint is the public
 * fixture recorded read-only on 2026-09-27 (docs/XRESERVE-GATE2-RESEARCH.md),
 * embedded below. Every proof decision is the REAL verifyXReserveCardanoMint.
 */
import { describe, it, expect } from 'vitest'
import { blake2b } from '@noble/hashes/blake2b'
import {
  locateXReserveCardanoMint, startMintScanCursor, readMintScanCursor, CardanoReaderError,
  MINT_SCAN_CANDIDATES_PER_POLL,
  type CardanoMintReader, type AddressTxRow, type CardanoOutputs, type LocateMintInput, type MintScanCursor,
} from './xreserve-cardano-mint-locator'
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
const AMOUNT = 1_899_991_033n
const MINT_HEIGHT = 13989038
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex')
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

// ── An in-memory provider ─────────────────────────────────────────────────────

interface ChainTx { row: AddressTxRow; cbor: string; outputs: CardanoOutputs }

/** A real, parseable transaction that is NOT a mint: pays `lovelace` (and optionally USDCx) to the recipient. */
function unrelatedTx(blockHeight: number, txIndex: number, usdcx = 0n, salt = 0): ChainTx {
  const policy = Buffer.from(CARDANO_USDCX_UNIT.mainnet.slice(0, 56), 'hex')
  const name = Buffer.from(CARDANO_USDCX_UNIT.mainnet.slice(56), 'hex')
  const value = usdcx > 0n
    ? cborArray([cborUint(1_500_000n), cborMap([[cborBytes(policy), cborMap([[cborBytes(name), cborUint(usdcx)]])]])])
    : cborUint(1_500_000n)
  const input = new Uint8Array(32)
  input[0] = salt & 0xff; input[1] = (salt >> 8) & 0xff; input[2] = blockHeight & 0xff; input[3] = txIndex
  const body = cborMap([
    [cborUint(0), cborArray([cborArray([cborBytes(input), cborUint(0)])])],
    [cborUint(1), cborArray([cborArray([cborBytes(decodeCardanoAddress(RECIPIENT)), value])])],
    [cborUint(2), cborUint(170_000n)],
  ])
  const cbor = hexOf(new Uint8Array([0x84, ...body, 0xa0, 0xf5, 0xf6]))
  const txHash = hexOf(blake2b(body, { dkLen: 32 }))
  return {
    row: { txHash, blockHeight, txIndex }, cbor,
    outputs: [{ index: 0, address: RECIPIENT, lovelace: '1500000', assets: usdcx > 0n ? [{ unit: CARDANO_USDCX_UNIT.mainnet, quantity: usdcx.toString() }] : [] }],
  }
}
const theMint = (): ChainTx => ({
  row: { txHash: MINT_TX_HASH, blockHeight: MINT_HEIGHT, txIndex: 0 }, cbor: MINT_TX_CBOR, outputs: clone(MINT_TX_OUTPUTS),
})

class MockProvider implements CardanoMintReader {
  txs: ChainTx[] = []
  tipHeight = MINT_HEIGHT + 100
  calls = { pages: [] as string[], txs: [] as string[] }
  failTxRead: ((hash: string) => Error | null) | null = null
  failPage: Error | null = null
  corrupt: ((tx: ChainTx) => Partial<{ cbor: string; blockHeight: number }>) | null = null

  constructor(txs: ChainTx[] = []) { this.txs = txs }
  private sorted() {
    return [...this.txs].sort((a, b) => a.row.blockHeight - b.row.blockHeight || a.row.txIndex - b.row.txIndex)
  }
  async addressTransactions(address: string, from: { blockHeight: number; txIndex: number }, count: number) {
    this.calls.pages.push(`${from.blockHeight}:${from.txIndex}/${count}`)
    if (this.failPage) throw this.failPage
    expect(address).toBe(RECIPIENT)
    return this.sorted()
      .filter(t => t.row.blockHeight > from.blockHeight || (t.row.blockHeight === from.blockHeight && t.row.txIndex >= from.txIndex))
      .slice(0, count).map(t => ({ ...t.row }))
  }
  async confirmedTransaction(txHash: string) {
    this.calls.txs.push(txHash)
    const failed = this.failTxRead?.(txHash)
    if (failed) throw failed
    const t = this.txs.find(x => x.row.txHash === txHash)
    if (!t) throw new CardanoReaderError('not-found')
    return { txHash, blockHeight: t.row.blockHeight, cbor: t.cbor, ...(this.corrupt?.(t) ?? {}) }
  }
  async transactionOutputs(txHash: string) {
    return clone(this.txs.find(x => x.row.txHash === txHash)!.outputs)
  }
  async tip() { return { blockHeight: this.tipHeight } }
}

const START = (height = MINT_HEIGHT - 1000) => startMintScanCursor(RECIPIENT, SOURCE, { blockHeight: height })
const input = (cursor: MintScanCursor, over: Partial<LocateMintInput> = {}): LocateMintInput => ({
  approved: { recipient: RECIPIENT, amountRaw: AMOUNT },
  sourceTxHash: SOURCE,
  attestation: { requestedTxHash: SOURCE, response: clone(CIRCLE_RESPONSE) },
  cursor,
  minConfirmations: 10,
  ...over,
})
/** `n` unrelated transactions, one per block, starting just after the start cursor. */
const unrelated = (n: number, from = MINT_HEIGHT - 900) => Array.from({ length: n }, (_, i) => unrelatedTx(from + i, 0, 0n, i))

describe('finding the mint', () => {
  it('finds a mint after the first 20 transactions, across two polls, never re-reading the first 20', async () => {
    const noise = unrelated(25)
    const p = new MockProvider([...noise, theMint()])
    const first = await locateXReserveCardanoMint(input(START()), p)
    expect(first).toMatchObject({ state: 'unknown', retryable: true, checked: MINT_SCAN_CANDIDATES_PER_POLL })
    expect(first.cursor).toMatchObject({ blockHeight: noise[19].row.blockHeight, txIndex: 0 })

    p.calls.txs = []
    const second = await locateXReserveCardanoMint(input(first.cursor!), p)
    expect(second).toMatchObject({ state: 'minted', retryable: false })
    expect(second.proof).toMatchObject({ verified: true, creditedRaw: '1899991032', cardanoTxHash: MINT_TX_HASH })
    expect(second.candidate).toMatchObject({ txHash: MINT_TX_HASH, blockHeight: MINT_HEIGHT, confirmations: 101 })
    expect(p.calls.txs).toEqual([...noise.slice(20).map(t => t.row.txHash), MINT_TX_HASH])
  })

  it('resumes from a cursor saved as JSON across a restart (fresh provider object)', async () => {
    const noise = unrelated(30)
    const first = await locateXReserveCardanoMint(input(START()), new MockProvider([...noise, theMint()]))
    const saved = JSON.parse(JSON.stringify(first.cursor))
    const restored = readMintScanCursor(saved)!
    const fresh = new MockProvider([...noise, theMint()])
    const r = await locateXReserveCardanoMint(input(restored), fresh)
    // The remaining 10 unrelated transactions and the mint (#31) fit in one poll.
    expect(r.state).toBe('minted')
    expect(fresh.calls.txs).toEqual([...noise.slice(20).map(t => t.row.txHash), MINT_TX_HASH])
  })

  it('inclusive cursor: the row AT the cursor is not re-read, but later rows in the same block are', async () => {
    const h = MINT_HEIGHT - 500
    const a = unrelatedTx(h, 0, 0n, 1), b = unrelatedTx(h, 1, 0n, 2), c = unrelatedTx(h, 2, 0n, 3)
    const p = new MockProvider([a, b, c])
    const cursor: MintScanCursor = { v: 1, recipient: RECIPIENT, sourceTxHash: SOURCE, blockHeight: h, txIndex: 1 }
    const r = await locateXReserveCardanoMint(input(cursor), p)
    expect(p.calls.pages[0]).toBe(`${h}:1/${MINT_SCAN_CANDIDATES_PER_POLL + 1}`)
    expect(p.calls.txs).toEqual([c.row.txHash])
    expect(r.state).toBe('awaiting-mint')
    // The submission cursor (index -1) includes transaction 0 of its block.
    const q = new MockProvider([a])
    await locateXReserveCardanoMint(input(startMintScanCursor(RECIPIENT, SOURCE, { blockHeight: h })), q)
    expect(q.calls.txs).toEqual([a.row.txHash])
  })

  it('a complete scan without the mint is "awaiting mint"; a later poll checks only the new transactions', async () => {
    const noise = unrelated(3)
    const p = new MockProvider([...noise])
    const first = await locateXReserveCardanoMint(input(START()), p)
    expect(first).toMatchObject({ state: 'awaiting-mint', retryable: true, checked: 3 })
    p.txs.push(theMint())
    p.calls.txs = []
    const later = await locateXReserveCardanoMint(input(first.cursor!), p)
    expect(later.state).toBe('minted')
    expect(p.calls.txs).toEqual([MINT_TX_HASH])
  })

  it('an unrelated USDCx TRANSFER of the same amount to the recipient is not a mint', async () => {
    const transfer = unrelatedTx(MINT_HEIGHT - 10, 0, AMOUNT - 1n, 9)
    const r = await locateXReserveCardanoMint(input(START()), new MockProvider([transfer]))
    expect(r.state).toBe('awaiting-mint')
    expect(r.proof).toBeNull()
    expect(r.cursor).toMatchObject({ blockHeight: MINT_HEIGHT - 10, txIndex: 0 })
  })
})

describe('confirmation depth', () => {
  it('a verified mint below the required depth waits, without moving the cursor past it', async () => {
    const p = new MockProvider([...unrelated(2), theMint()])
    p.tipHeight = MINT_HEIGHT + 1                                   // 2 confirmations
    const r = await locateXReserveCardanoMint(input(START(), { minConfirmations: 5 }), p)
    expect(r).toMatchObject({ state: 'awaiting-confirmations', retryable: true, proof: null })
    expect(r.candidate).toMatchObject({ txHash: MINT_TX_HASH, confirmations: 2 })
    expect(r.cursor!.blockHeight).toBeLessThan(MINT_HEIGHT)
    p.tipHeight = MINT_HEIGHT + 4                                   // 5 confirmations
    const later = await locateXReserveCardanoMint(input(r.cursor!, { minConfirmations: 5 }), p)
    expect(later.state).toBe('minted')
  })

  it('a shallow unrelated transaction is not passed for good either', async () => {
    const shallow = unrelatedTx(MINT_HEIGHT + 99, 0, 0n, 5)
    const p = new MockProvider([shallow])
    const r = await locateXReserveCardanoMint(input(START()), p)   // tip = +100 → 2 confirmations < 10
    expect(r.state).toBe('awaiting-mint')
    expect(r.cursor).toEqual(START())
  })
})

describe('retryable problems keep progress and never become terminal', () => {
  it('a rate limit midway: unknown, progress kept, next poll resumes at the failed candidate', async () => {
    const noise = unrelated(8)
    const p = new MockProvider([...noise, theMint()])
    p.failTxRead = (h) => (h === noise[5].row.txHash ? new CardanoReaderError('rate-limited') : null)
    const r = await locateXReserveCardanoMint(input(START()), p)
    expect(r).toMatchObject({ state: 'unknown', retryable: true })
    expect(r.reason).toMatch(/rate-limiting; will retry/)
    expect(r.cursor).toMatchObject({ blockHeight: noise[4].row.blockHeight })
    p.failTxRead = null
    p.calls.txs = []
    const next = await locateXReserveCardanoMint(input(r.cursor!), p)
    expect(p.calls.txs[0]).toBe(noise[5].row.txHash)
    expect(next.state).toBe('minted')
  })

  it('a 5xx on the history page, a tip failure, or an arbitrary error: unknown, cursor unchanged', async () => {
    const p = new MockProvider([theMint()])
    p.failPage = new CardanoReaderError('unavailable', 'HTTP 503')
    expect(await locateXReserveCardanoMint(input(START()), p)).toMatchObject({ state: 'unknown', retryable: true, cursor: START() })
    const q = new MockProvider([theMint()])
    q.tip = async () => { throw new Error('socket hang up') }
    expect(await locateXReserveCardanoMint(input(START()), q)).toMatchObject({ state: 'unknown', cursor: START() })
  })

  it('malformed provider data: a bad row, rows out of order, or a transaction that is not the listed one', async () => {
    const a = new MockProvider([theMint()])
    a.addressTransactions = async () => [{ txHash: 'nothex', blockHeight: 1, txIndex: 0 }]
    expect((await locateXReserveCardanoMint(input(START()), a)).state).toBe('unknown')

    const [x, y] = unrelated(2)
    const b = new MockProvider([x, y])
    b.addressTransactions = async () => [y.row, x.row]
    expect((await locateXReserveCardanoMint(input(START()), b)).reason).toMatch(/ascending/)

    const c = new MockProvider([theMint()])
    c.corrupt = () => ({ blockHeight: MINT_HEIGHT + 1 })
    expect((await locateXReserveCardanoMint(input(START()), c)).reason).toMatch(/does not match the address history/)
  })

  it('CBOR that is not the listed transaction is retried, never skipped and never verified', async () => {
    const p = new MockProvider([theMint()])
    p.corrupt = (t) => ({ cbor: t.cbor.slice(0, 200) + (t.cbor[200] === '0' ? '1' : '0') + t.cbor.slice(201) })
    const r = await locateXReserveCardanoMint(input(START()), p)
    expect(r).toMatchObject({ state: 'unknown', retryable: true, proof: null, cursor: START() })
    expect(r.reason).toMatch(/could not be read reliably/)
    p.corrupt = null
    expect((await locateXReserveCardanoMint(input(r.cursor!), p)).state).toBe('minted')
  })
})

describe('Circle and the caller', () => {
  it('an empty attestation list is "awaiting attestation", and Cardano is not read', async () => {
    const p = new MockProvider([theMint()])
    const r = await locateXReserveCardanoMint(input(START(), { attestation: { requestedTxHash: SOURCE, response: { attestations: [] } } }), p)
    expect(r).toMatchObject({ state: 'awaiting-attestation', retryable: true, cursor: START() })
    expect(p.calls.pages).toEqual([])
  })

  it('an attestation that contradicts the approval is a mismatch, not a retry or a mint', async () => {
    const r = await locateXReserveCardanoMint(input(START(), { approved: { recipient: RECIPIENT, amountRaw: AMOUNT + 1n } }), new MockProvider([theMint()]))
    expect(r).toMatchObject({ state: 'attestation-mismatch', retryable: false, proof: null })
  })

  it('a broken Circle response is retryable unknown', async () => {
    const r = await locateXReserveCardanoMint(input(START(), { attestation: { requestedTxHash: SOURCE, response: { attestations: [{ payload: 'zz' }] } } }), new MockProvider([theMint()]))
    expect(r).toMatchObject({ state: 'unknown', retryable: true })
  })

  it('refuses an attestation requested for another hash, a foreign cursor, bad depth, and bad amounts', async () => {
    const p = new MockProvider([theMint()])
    const other = '0x' + 'ab'.repeat(32)
    expect((await locateXReserveCardanoMint(input(START(), { attestation: { requestedTxHash: other, response: clone(CIRCLE_RESPONSE) } }), p)).state).toBe('invalid-input')
    expect((await locateXReserveCardanoMint(input({ ...START(), sourceTxHash: other }), p)).state).toBe('invalid-input')
    expect((await locateXReserveCardanoMint(input({ ...START(), recipient: 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8' }), p)).state).toBe('invalid-input')
    for (const minConfirmations of [0, -1, 1.5]) {
      expect((await locateXReserveCardanoMint(input(START(), { minConfirmations }), p)).state).toBe('invalid-input')
    }
    expect((await locateXReserveCardanoMint(input(START(), { approved: { recipient: RECIPIENT, amountRaw: 0n } }), p)).state).toBe('invalid-input')
    expect(readMintScanCursor({ v: 2 })).toBeNull()
    expect(p.calls.pages).toEqual([])
  })
})

// ── Transactions that carry Circle's REAL payload and signature ───────────────
const ATT = CIRCLE_RESPONSE.attestations[0]
const plutusConstr0 = (fields: Uint8Array[]) => new Uint8Array([0xd8, 0x79, ...cborArray(fields)])
const pairData = () => plutusConstr0([cborArray([
  cborBytes(Buffer.from(ATT.payload.slice(2), 'hex')), cborBytes(Buffer.from(ATT.attestation.slice(2), 'hex'))])])
const SCRIPT_REWARD = new Uint8Array([0xf1, ...Buffer.from('d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b', 'hex')])
const OTHER = 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8'

/**
 * A transaction in the recipient's history whose withdraw-zero redeemer (or a
 * spend redeemer, when `carrierTag` is 0) carries the attestation.
 */
function attestedTx(blockHeight: number, opts: {
  mintQty?: bigint | null; credit?: bigint; creditTo?: string; isValid?: number; carrierTag?: number; salt?: number
} = {}): ChainTx {
  const policy = Buffer.from(CARDANO_USDCX_UNIT.mainnet.slice(0, 56), 'hex')
  const name = Buffer.from(CARDANO_USDCX_UNIT.mainnet.slice(56), 'hex')
  const usdcx = (q: bigint) => cborArray([cborUint(1_500_000n), cborMap([[cborBytes(policy), cborMap([[cborBytes(name), cborUint(q)]])]])])
  const creditTo = opts.creditTo ?? RECIPIENT
  const credit = opts.credit ?? AMOUNT - 1n
  const outs: Array<[string, Uint8Array]> = [[creditTo, usdcx(credit)]]
  // Keep the recipient in the transaction even when the credit goes elsewhere.
  if (creditTo !== RECIPIENT) outs.push([RECIPIENT, cborUint(1_500_000n)])
  const input = new Uint8Array(32); input[0] = 0xee; input[1] = opts.salt ?? 0; input[2] = blockHeight & 0xff
  const entries: Array<[Uint8Array, Uint8Array]> = [
    [cborUint(0), cborArray([cborArray([cborBytes(input), cborUint(0)])])],
    [cborUint(1), cborArray(outs.map(([a, v]) => cborArray([cborBytes(decodeCardanoAddress(a)), v])))],
    [cborUint(2), cborUint(500_000n)],
    [cborUint(5), cborMap([[cborBytes(SCRIPT_REWARD), cborUint(0)]])],
  ]
  const mintQty = opts.mintQty === undefined ? AMOUNT : opts.mintQty
  if (mintQty !== null) entries.push([cborUint(9), cborMap([[cborBytes(policy), cborMap([[cborBytes(name), cborUint(mintQty)]])]])])
  const body = cborMap(entries)
  const ws = cborMap([[cborUint(5), cborArray([cborArray([cborUint(opts.carrierTag ?? 3), cborUint(0), pairData(), cborArray([cborUint(1), cborUint(1)])])])]])
  const cbor = hexOf(new Uint8Array([0x84, ...body, ...ws, opts.isValid ?? 0xf5, 0xf6]))
  const txHash = hexOf(blake2b(body, { dkLen: 32 }))
  const outputs: CardanoOutputs = outs.map(([address, _v], index) => ({
    index, address, lovelace: '1500000',
    assets: index === 0 ? [{ unit: CARDANO_USDCX_UNIT.mainnet, quantity: credit.toString() }] : [],
  }))
  return { row: { txHash, blockHeight, txIndex: 0 }, cbor, outputs }
}

describe('a transaction carrying the attestation that does not mint as approved is a CONFLICT', () => {
  const cases: Array<[string, Parameters<typeof attestedTx>[1], string]> = [
    ['a tiny mint', { mintQty: 1n, credit: 1n }, 'mint-amount-mismatch'],
    ['an excessive mint', { mintQty: AMOUNT * 100n, credit: AMOUNT }, 'mint-amount-mismatch'],
    ['no USDCx mint at all', { mintQty: null }, 'no-usdcx-mint'],
    ['the credit paid to another address', { creditTo: OTHER }, 'no-recipient-credit'],
    ['more credited than minted', { credit: AMOUNT + 5n }, 'excess-recipient-credit'],
  ]
  for (const [label, opts, code] of cases) {
    it(`${label} → mint-conflict (${code}): needs review, not skipped, not "awaiting mint"`, async () => {
      const bad = attestedTx(MINT_HEIGHT - 50, opts)
      const p = new MockProvider([...unrelated(2), bad, theMint()])
      const r = await locateXReserveCardanoMint(input(START()), p)
      expect(r).toMatchObject({ state: 'mint-conflict', retryable: false, conflict: code, proof: null })
      expect(r.candidate?.txHash).toBe(bad.row.txHash)
      // The cursor stays BEFORE the conflicting transaction, so a review re-run sees it again.
      expect(r.cursor!.blockHeight).toBeLessThan(bad.row.blockHeight)
      const again = await locateXReserveCardanoMint(input(r.cursor!), p)
      expect(again.state).toBe('mint-conflict')
    })
  }
})

describe('attempts, non-qualifying carriers and awkward transactions', () => {
  it('a phase-2-failed attempt is reported explicitly (not a mint, not a refund); a later mint is still found', async () => {
    const failed = attestedTx(MINT_HEIGHT - 30, { isValid: 0xf4 })
    const p = new MockProvider([failed, theMint()])
    const first = await locateXReserveCardanoMint(input(START()), p)
    expect(first).toMatchObject({ state: 'mint-attempt-failed', retryable: true, proof: null })
    expect(first.candidate?.txHash).toBe(failed.row.txHash)
    expect(first.cursor).toMatchObject({ blockHeight: failed.row.blockHeight })   // deep: passed
    const next = await locateXReserveCardanoMint(input(first.cursor!), p)
    expect(next.state).toBe('minted')
  })

  it('a shallow failed attempt is reported but not passed yet', async () => {
    const failed = attestedTx(MINT_HEIGHT + 99, { isValid: 0xf4 })
    const r = await locateXReserveCardanoMint(input(START()), new MockProvider([failed]))
    expect(r.state).toBe('mint-attempt-failed')
    expect(r.cursor).toEqual(START())
  })

  it('the attestation in a SPEND redeemer (not qualifying) is unrelated: skipped, the real mint found', async () => {
    const spend = attestedTx(MINT_HEIGHT - 40, { carrierTag: 0 })
    const r = await locateXReserveCardanoMint(input(START()), new MockProvider([spend, theMint()]))
    expect(r.state).toBe('minted')
  })

  it('a SMALL transaction whose redeemer uses Plutus tag 121 is read, not stalled on (walker regression)', async () => {
    const small = unrelatedTx(MINT_HEIGHT - 60, 0, 0n, 77)
    // Give it a tiny witness set: one spend redeemer, constructor 0, no fields.
    const body = small.cbor.slice(2, small.cbor.length - 6)            // strip 0x84 … a0 f5 f6
    const ws = cborMap([[cborUint(5), cborArray([cborArray([cborUint(0), cborUint(0), plutusConstr0([]), cborArray([cborUint(1), cborUint(1)])])])]])
    small.cbor = '84' + body + hexOf(ws) + 'f5f6'
    expect(ws.length).toBeLessThan(121)
    const r = await locateXReserveCardanoMint(input(START()), new MockProvider([small, theMint()]))
    expect(r.state).toBe('minted')
  })
})

describe('a SHALLOW conflicting candidate is not a verdict until it is deep enough', () => {
  const SHALLOW_AT = MINT_HEIGHT + 95   // tip starts at +100 → 6 confirmations, below the required 10

  it('below depth: retryable wait, cursor held, no final conflict; at depth: mint-conflict with its code', async () => {
    const bad = attestedTx(SHALLOW_AT, { mintQty: 1n, credit: 1n })
    const p = new MockProvider([bad])
    const waiting = await locateXReserveCardanoMint(input(START()), p)
    expect(waiting).toMatchObject({
      state: 'conflict-awaiting-confirmations', retryable: true,
      conflict: null, provisionalConflict: 'mint-amount-mismatch', proof: null,
    })
    expect(waiting.candidate).toMatchObject({ txHash: bad.row.txHash, confirmations: 6 })
    expect(waiting.cursor).toEqual(START())

    p.tipHeight = SHALLOW_AT + 9                                     // exactly 10 confirmations
    const final = await locateXReserveCardanoMint(input(waiting.cursor!), p)
    expect(final).toMatchObject({ state: 'mint-conflict', retryable: false, conflict: 'mint-amount-mismatch', provisionalConflict: null })
    expect(final.candidate?.txHash).toBe(bad.row.txHash)
    expect(final.cursor).toEqual(START())
  })

  it('after a rollback removes it, the next poll re-reads the history and keeps no conflict', async () => {
    const bad = attestedTx(SHALLOW_AT, { creditTo: OTHER })
    const p = new MockProvider([bad])
    const waiting = await locateXReserveCardanoMint(input(START()), p)
    expect(waiting.state).toBe('conflict-awaiting-confirmations')
    p.txs = []                                                        // rolled back
    const after = await locateXReserveCardanoMint(input(waiting.cursor!), p)
    expect(after).toMatchObject({ state: 'awaiting-mint', conflict: null, provisionalConflict: null })
  })

  it('after a rollback REPLACES it with the correct mint, the next poll reports that mint instead', async () => {
    const bad = attestedTx(SHALLOW_AT, { mintQty: AMOUNT + 1n, credit: AMOUNT })
    const p = new MockProvider([bad])
    expect((await locateXReserveCardanoMint(input(START()), p)).state).toBe('conflict-awaiting-confirmations')
    p.txs = [attestedTx(SHALLOW_AT - 20, {})]                        // a correct mint, now deep enough
    const after = await locateXReserveCardanoMint(input(START()), p)
    expect(after).toMatchObject({ state: 'minted', conflict: null, provisionalConflict: null })
  })
})

describe('a minted cursor stays immediately before the mint', () => {
  it('more than 20 transactions earlier in the SAME block: polls reach the mint, then keep re-verifying it without getting stuck', async () => {
    const mint = { ...theMint(), row: { txHash: MINT_TX_HASH, blockHeight: MINT_HEIGHT, txIndex: 30 } }
    const earlier = Array.from({ length: 30 }, (_, i) => unrelatedTx(MINT_HEIGHT, i, 0n, 100 + i))
    const p = new MockProvider([...earlier, mint])
    let cursor = START()
    const states: string[] = []
    for (let poll = 0; poll < 3; poll++) {
      const r = await locateXReserveCardanoMint(input(JSON.parse(JSON.stringify(cursor))), p)
      states.push(r.state)
      cursor = r.cursor!
    }
    expect(states).toEqual(['unknown', 'minted', 'minted'])
    // After the 30 unrelated transactions, before the mint (index 30).
    expect(cursor).toMatchObject({ blockHeight: MINT_HEIGHT, txIndex: 29 })
    for (let poll = 0; poll < 3; poll++) {
      const r = await locateXReserveCardanoMint(input(cursor), p)
      expect(r).toMatchObject({ state: 'minted', checked: 1, candidate: { txHash: MINT_TX_HASH } })
      expect(r.cursor).toEqual(cursor)
    }
  })
})
