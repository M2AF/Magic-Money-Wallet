/**
 * Keyless Koios Preprod readers for the xReserve scanners. No network: a fake
 * Koios implements the measured query semantics (inclusive height filter,
 * PostgREST order/limit/offset, rows WITHOUT an in-block position). The real
 * Preprod mint below is public data; same-block histories are SYNTHETIC.
 */
import { describe, it, expect } from 'vitest'
import { blake2b } from '@noble/hashes/blake2b'
import { bech32 } from '@scure/base'
import { keccak256, type Hex } from 'viem'
import {
  koiosMintReads, createKoiosLocatorReader, createKoiosAuditReader, type KoiosFetchFn,
} from './xreserve-koios-provider'
import { XRESERVE_SEPOLIA_PREPROD as PRE } from './xreserve-network'
import { validateXReserveAttestation, evaluateMintCandidate, parseDepositIntent } from './xreserve-cardano-mint-proof'
import { locateXReserveCardanoMint, startMintScanCursor, type MintScanCursor } from './xreserve-cardano-mint-locator'
import { auditXReserveCardanoMint, startMintAuditCursor, type MintAuditCursor } from './xreserve-cardano-mint-audit'
import { cborArray, cborMap, cborUint, cborBytes } from './cardano-cip30'
import { decodeCardanoAddress } from './cardano-pure'

/**
 * PUBLIC Cardano Preprod data, recorded read-only 2026-09-30 from preprod.koios.rest
 * (tx_info with _assets true, tx_cbor) and Circle's testnet API
 * (GET /v1/attestations/{messageHash}) for the USDCx mint
 * 0f043e04dc2c89b710aa7f0071cfb00135f38973cfe8937a45069a075b80aaf4. Outputs are trimmed to the fields
 * the adapter reads; nothing else was changed.
 */
const PREPROD_MINT_HASH = '0f043e04dc2c89b710aa7f0071cfb00135f38973cfe8937a45069a075b80aaf4'
const PREPROD_MINT_HEIGHT = 5230491
const PREPROD_MINT_TIME = 1790612862
const PREPROD_MINT_CBOR = [
  '84ab00d901028282582001aabcda5afb83e345b5d49e840e96c13e2fbb67bf96dbff22f53b3088a19c0103825820dae524e8',
  'ff3b69f1802c498dc92373a5768750d164a29adef1b6126b2e5f4df704018582583900946624cec0f666c471ca550de67ddd',
  '748d9b928b7805d4c851d4a4160b26841606262ce710ef38a1a5d6a590d3aab824fea074d2fee078c3821a0011b0dea1581c',
  '31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf66a14555534443781a00e4e1c08258390000958a2db8b2',
  '933bdbca3797bfef0635ce09d9d8578391b2840cf905a75f8fae4cf7d4dcbcc6b68bcf33498e23385727dd0aaf876d11f912',
  '821a0011b0dea1581c31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf66a14555534443781a004c4b40a3',
  '00581d70714205696502e4ca307c1617422e1a7c6b5f8cdcd84cc9c6cb4edc3601821a0014a67ca1581c714205696502e4ca',
  '307c1617422e1a7c6b5f8cdcd84cc9c6cb4edc36a14001028201d81858499f5820588c97db0488325f5714f70c980de17957',
  '30d8ded7393a7a07e4c6ea8ed7bce4582058915eeef6ce3f6dd2ff82930baa56f4c9d6c8ffdaf8f6cfadc23f9cf22118fcd8',
  '7a80ffa300581d70714205696502e4ca307c1617422e1a7c6b5f8cdcd84cc9c6cb4edc3601821a0014a67ca1581c71420569',
  '6502e4ca307c1617422e1a7c6b5f8cdcd84cc9c6cb4edc36a14001028201d81858499f582058915eeef6ce3f6dd2ff82930b',
  'aa56f4c9d6c8ffdaf8f6cfadc23f9cf22118fc582058937150ad81b12fb97ba71c7c59e20e527968d39d86b8b7720762ed3e',
  '1c49dbd87a80ff82583900eae2c3232a201a20d10b3e8aad858f11306ff86ec785015e6f6747d0a9e927936e8d43fa33ba45',
  'e76a1f0e764c747164ff188981339c7e431a8a87b58f021a0006fbea031a080aeadb05a1581df09c52730e1f0889106470e2',
  '8eb37223bb8546da347ece2c7e3c285be40009a2581c31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf66',
  'a14555534443781a01312d00581c714205696502e4ca307c1617422e1a7c6b5f8cdcd84cc9c6cb4edc36a140010b5820dcb3',
  'fc74d111d148481d282137ef60b37c1854652c9ceacaec48550d9ba32f9b0dd9010281825820dae524e8ff3b69f1802c498d',
  'c92373a5768750d164a29adef1b6126b2e5f4df7041082583900eae2c3232a201a20d10b3e8aad858f11306ff86ec785015e',
  '6f6747d0a9e927936e8d43fa33ba45e76a1f0e764c747164ff188981339c7e431a8abc3fd2111a000a79df12d90102848258',
  '2045b2db056e3ab3c2b97ac504f342c9e783fae1701f05bfe6259efb9e04d39b7d0082582052248549703460f1c2538d1ecd',
  'b9dbba0749f98983576bcc956f348c246ac4f000825820ca50ae63a4e887487d73955b785a031838b5920282a0011993df5b',
  'c31d489a000082582052248549703460f1c2538d1ecdb9dbba0749f98983576bcc956f348c246ac4f002a200d90102818258',
  '20753d7d6ed07cb166843ab9bed3dd444a20defeec9518398c172b7fd06fe58c0f5840592305b8ec4b95ec5bf2425ce7b75d',
  '3a6124567855b9932e9ebb5cefc03194002bd78307a79b35225b3cd8590d749d58e97bf95ad56f5fa032ddff37fb627e0c05',
  'a482000082d879808219a89e1a00f46d7582010082d8798082199edb1a00efd8aa82010182d87a808219afc21a00fe8dbe82',
  '030082d8799f9f5f58405a2e0acd000000010000000000000000000000000000000000000000000000000000000001312d00',
  '00002714a69202b518963a990c1a47f01d8cb287dfdef094584085db2b3523f67327c218ccd700000001946624cec0f666c4',
  '71ca550de67ddd748d9b928b7805d4c851d4a4160000000000000000000000001c7d4b196cb0c7b058401d743fbc6116a902',
  '379c72380000000000000000000000002f426ada87d371250d1168c3490e2de39e5dc9fa0000000000000000000000000000',
  '000000000000584000000000000000000098968058915eeef6ce3f6dd2ff82930baa56f4c9d6c8ffdaf8f6cfadc23f9cf221',
  '18fc0000005f0000000000000000000000000000000058400000000000000000000000000000000000000000000000000000',
  '000000000000000000000000000000000000000000000000010b26841606262ce710ef38a1a54fd6a590d3aab824fea074d2',
  'fee078c3ff5f5840c67e70d6e0738c7d10ce3b4a348ebd49d373f90882e29a55b8b50e9432a30be710dcc47d3b264d47fe99',
  '5fdc4c359320a0398a540c55471784ea23830cd1d6a5411cffff0000010101ff821a00068af41a0d6ee6eff5f6',
].join('')
const PREPROD_MINT_OUTPUTS = [
 {
  "tx_hash": "0f043e04dc2c89b710aa7f0071cfb00135f38973cfe8937a45069a075b80aaf4",
  "tx_index": 1,
  "value": "1159390",
  "payment_addr": {
   "bech32": "addr_test1qqqftz3dhzefxw7megme00l0qc6uuzwemptc8ydjssx0jpd8t786un8h6nwte34k308nxjvwyvu9wf7ap2hcwmg3lyfqwvqemz"
  },
  "asset_list": [
   {
    "policy_id": "31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf66",
    "asset_name": "5553444378",
    "quantity": "5000000"
   }
  ]
 },
 {
  "tx_hash": "0f043e04dc2c89b710aa7f0071cfb00135f38973cfe8937a45069a075b80aaf4",
  "tx_index": 4,
  "value": "2324149647",
  "payment_addr": {
   "bech32": "addr_test1qr4w9ser9gsp5gx3pvlg4tv93ugnqmlcdmrc2q27dan5059faynexm5dg0ar8wj9ua4p7rnkf368ze8lrzyczvuu0epsgwq8c7"
  },
  "asset_list": []
 },
 {
  "tx_hash": "0f043e04dc2c89b710aa7f0071cfb00135f38973cfe8937a45069a075b80aaf4",
  "tx_index": 0,
  "value": "1159390",
  "payment_addr": {
   "bech32": "addr_test1qz2xvfxwcrmxd3r3ef2smenam46gmxuj3duqt4xg2822g9sty6zpvp3x9nn3pmec5xjadfvs6w4tsf875p6d9lhq0rpsmqjlj4"
  },
  "asset_list": [
   {
    "policy_id": "31dde3db98ad05feb688d4dbb146b3b6054e1246cbcef98c79b0bf66",
    "asset_name": "5553444378",
    "quantity": "15000000"
   }
  ]
 },
 {
  "tx_hash": "0f043e04dc2c89b710aa7f0071cfb00135f38973cfe8937a45069a075b80aaf4",
  "tx_index": 2,
  "value": "1353340",
  "payment_addr": {
   "bech32": "addr_test1wpc5yptfv5pwfj3s0stpws3wrf7xkhuvmnvyejwxed8dcds6rk3dj"
  },
  "asset_list": [
   {
    "policy_id": "714205696502e4ca307c1617422e1a7c6b5f8cdcd84cc9c6cb4edc36",
    "asset_name": "",
    "quantity": "1"
   }
  ]
 },
 {
  "tx_hash": "0f043e04dc2c89b710aa7f0071cfb00135f38973cfe8937a45069a075b80aaf4",
  "tx_index": 3,
  "value": "1353340",
  "payment_addr": {
   "bech32": "addr_test1wpc5yptfv5pwfj3s0stpws3wrf7xkhuvmnvyejwxed8dcds6rk3dj"
  },
  "asset_list": [
   {
    "policy_id": "714205696502e4ca307c1617422e1a7c6b5f8cdcd84cc9c6cb4edc36",
    "asset_name": "",
    "quantity": "1"
   }
  ]
 }
]
const PREPROD_MINT_COLLATERAL = {"tx_hash":"0f043e04dc2c89b710aa7f0071cfb00135f38973cfe8937a45069a075b80aaf4","tx_index":5,"value":"2327592914","payment_addr":{"bech32":"addr_test1qr4w9ser9gsp5gx3pvlg4tv93ugnqmlcdmrc2q27dan5059faynexm5dg0ar8wj9ua4p7rnkf368ze8lrzyczvuu0epsgwq8c7"},"asset_list":[]}
const PREPROD_CIRCLE = {"payload":"0x5a2e0acd000000010000000000000000000000000000000000000000000000000000000001312d0000002714a69202b518963a990c1a47f01d8cb287dfdef09485db2b3523f67327c218ccd700000001946624cec0f666c471ca550de67ddd748d9b928b7805d4c851d4a4160000000000000000000000001c7d4b196cb0c7b01d743fbc6116a902379c72380000000000000000000000002f426ada87d371250d1168c3490e2de39e5dc9fa000000000000000000000000000000000000000000000000000000000098968058915eeef6ce3f6dd2ff82930baa56f4c9d6c8ffdaf8f6cfadc23f9cf22118fc0000005f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010b26841606262ce710ef38a1a5d6a590d3aab824fea074d2fee078c3","messageHash":"0x8998337d387fc66958b9abe35e4584e975ced975799269250df7b2aaa914a02b","attestation":"0xc67e70d6e0738c7d10ce3b4a348ebd49d373f90882e29a55b8b50e9432a30be710dcc47d3b264d47fe995fdc4c359320a0398a540c55471784ea23830cd1d6a51c"}

const BASE = 'https://preprod.koios.rest/api/v1'
const UNIT = PRE.cardano.usdcxUnit
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex')
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const credOf = (addr: string) => hexOf(bech32.fromWords(bech32.decode(addr as `${string}1${string}`, 1000).words)).slice(2, 58)

// ── A fake Koios with the measured semantics ─────────────────────────────────

interface SimpleOutput { address: string; lovelace: string; assets: Array<{ unit: string; quantity: string }> }
interface ChainTx { hash: string; height: number; idx: number; cbor: string; outputs: SimpleOutput[]; touches: string[]; assetEvent: boolean }

const timeOf = (h: number) => 1_790_000_000 + h * 20

class FakeKoios {
  txs: ChainTx[] = []
  tipHeight = 0
  log: string[] = []
  cborReads: string[] = []
  /** Return a Response (or throw) instead of the normal answer. */
  intercept: ((path: string, body: Record<string, unknown> | null) => Response | 'hang' | null) | null = null
  /** Edit tx_info rows before they are returned. */
  txInfoPatch: ((rows: Array<Record<string, unknown>>) => Array<Record<string, unknown>>) | null = null
  /** Ignore `_assets` like a Koios that returns empty asset lists. */
  dropAssets = false

  add(tx: ChainTx) { this.txs.push(tx); this.tipHeight = Math.max(this.tipHeight, tx.height + 50) }

  koiosOutputs(tx: ChainTx, withAssets: boolean) {
    return tx.outputs.map((o, i) => ({
      tx_hash: tx.hash, tx_index: i, value: o.lovelace, payment_addr: { bech32: o.address },
      asset_list: withAssets && !this.dropAssets ? o.assets.map(a => ({ policy_id: a.unit.slice(0, 56), asset_name: a.unit.slice(56), quantity: a.quantity })) : [],
    }))
  }

  fetch: KoiosFetchFn = async (url, init) => {
    expect(url.startsWith(BASE)).toBe(true)
    const u = new URL(url)
    const path = u.pathname.replace('/api/v1', '')
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null
    this.log.push(`${init?.method ?? 'GET'} ${path}${u.search}`)
    const hit = this.intercept?.(path, body)
    if (hit === 'hang') return new Promise<Response>(() => { /* never answers */ })
    if (hit) return hit
    const json = (v: unknown) => new Response(JSON.stringify(v), { status: 200 })
    const sorted = [...this.txs].sort((a, b) => a.height - b.height || (a.hash < b.hash ? -1 : 1))
    switch (path) {
      case '/tip': return json([{ block_height: this.tipHeight, block_no: this.tipHeight, hash: 'ab'.repeat(32) }])
      case '/address_txs': {
        expect(u.searchParams.get('order')).toBe('block_height.asc,tx_hash.asc')
        const addr = (body?._addresses as string[])[0]
        const after = body?._after_block_height as number
        const limit = Number(u.searchParams.get('limit')); const offset = Number(u.searchParams.get('offset'))
        return json(sorted.filter(t => t.touches.includes(addr) && t.height >= after).slice(offset, offset + limit)
          .map(t => ({ tx_hash: t.hash, epoch_no: 1, block_height: t.height, block_time: timeOf(t.height) })))
      }
      case '/blocks': {
        const h = Number((u.searchParams.get('block_height') ?? '').replace('eq.', ''))
        return json([{ block_height: h, block_time: timeOf(h) }])
      }
      case '/asset_history': {
        expect(u.searchParams.get('_asset_policy')).toBe(UNIT.slice(0, 56))
        expect(u.searchParams.get('_asset_name')).toBe(UNIT.slice(56))
        const events = sorted.filter(t => t.assetEvent).reverse()   // newest first, as measured
          .map(t => ({ tx_hash: t.hash, metadata: [], quantity: '1', block_time: timeOf(t.height) }))
        return json([{ policy_id: UNIT.slice(0, 56), asset_name: UNIT.slice(56), minting_txs: events }])
      }
      case '/tx_info': {
        const hashes = body?._tx_hashes as string[]
        let rows: Array<Record<string, unknown>> = hashes.map(h => this.txs.find(t => t.hash === h)).filter((t): t is ChainTx => !!t)
          .map(t => ({ tx_hash: t.hash, block_height: t.height, tx_block_index: t.idx, outputs: this.koiosOutputs(t, body?._assets === true), collateral_output: null }))
        if (this.txInfoPatch) rows = this.txInfoPatch(rows)
        return json(rows)
      }
      case '/tx_cbor': {
        const t = this.txs.find(x => x.hash === (body?._tx_hashes as string[])[0])
        if (t) this.cborReads.push(t.hash)
        return json(t ? [{ tx_hash: t.hash, block_height: t.height, cbor: t.cbor }] : [])
      }
    }
    return new Response('not found', { status: 404 })
  }
}

// ── SYNTHETIC Preprod transactions ────────────────────────────────────────────

const RECIPIENT = bech32.encode('addr_test', bech32.toWords(Uint8Array.from([0x60, ...Buffer.from('1c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9', 'hex')])), 1000)
const OTHER = bech32.encode('addr_test', bech32.toWords(Uint8Array.from([0x60, ...Buffer.from('ab'.repeat(28), 'hex')])), 1000)
const SENDER = '0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863'
const AMOUNT = 20_000_000n
const SOURCE = `0x${'00'.repeat(32)}`
const word = (n: bigint) => n.toString(16).padStart(64, '0')
const payloadFor = (amount: bigint, nonce: string) =>
  `0x5a2e0acd00000001${word(amount)}${(10004).toString(16).padStart(8, '0')}${'cd'.repeat(32)}`
  + `00000001${credOf(RECIPIENT)}${PRE.ethereum.usdc.slice(2).toLowerCase().padStart(64, '0')}${SENDER.slice(2).padStart(64, '0')}`
  + `${word(10_000_000n)}${nonce}00000000` as Hex
const SIG = `0x${'aa'.repeat(65)}`
const PAYLOAD = payloadFor(AMOUNT, '1a'.repeat(32))
const CIRCLE = { attestations: [{ payload: PAYLOAD, messageHash: keccak256(PAYLOAD), attestation: SIG, remoteDomain: 10004 }] }

function assemble(body: Uint8Array, ws: Uint8Array, height: number, idx: number, outputs: SimpleOutput[], touches: string[], assetEvent: boolean): ChainTx {
  return { hash: hexOf(blake2b(body, { dkLen: 32 })), height, idx, cbor: hexOf(new Uint8Array([0x84, ...body, ...ws, 0xf5, 0xf6])), outputs, touches, assetEvent }
}

/** A plain ADA payment to `to` (not a mint). */
function payment(height: number, idx: number, to = RECIPIENT, salt = 0): ChainTx {
  const input = new Uint8Array(32); input[0] = salt & 0xff; input[1] = (salt >> 8) & 0xff; input[2] = height & 0xff; input[3] = idx
  const body = cborMap([
    [cborUint(0), cborArray([cborArray([cborBytes(input), cborUint(0)])])],
    [cborUint(1), cborArray([cborArray([cborBytes(decodeCardanoAddress(to)), cborUint(1_500_000n)])])],
    [cborUint(2), cborUint(170_000n)],
  ])
  return assemble(body, cborMap([]), height, idx, [{ address: to, lovelace: '1500000', assets: [] }], [to], false)
}

/** A withdraw-zero USDCx mint carrying `payload` (SYNTHETIC; placeholder signature). */
function mint(height: number, idx: number, opts: { payload?: Hex; payTo?: string; salt?: number } = {}): ChainTx {
  const payTo = opts.payTo ?? RECIPIENT
  const policy = Buffer.from(UNIT.slice(0, 56), 'hex'); const name = Buffer.from(UNIT.slice(56), 'hex')
  const credit = AMOUNT - 1n
  const value = cborArray([cborUint(1_500_000n), cborMap([[cborBytes(policy), cborMap([[cborBytes(name), cborUint(credit)]])]])])
  const reward = new Uint8Array([0xf0, ...Buffer.from('d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b', 'hex')])
  const input = new Uint8Array(32).fill(0xc0 + ((opts.salt ?? 0) & 0x0f)); input[1] = idx; input[2] = height & 0xff
  const body = cborMap([
    [cborUint(0), cborArray([cborArray([cborBytes(input), cborUint(0)])])],
    [cborUint(1), cborArray([cborArray([cborBytes(decodeCardanoAddress(payTo)), value])])],
    [cborUint(2), cborUint(500_000n)],
    [cborUint(5), cborMap([[cborBytes(reward), cborUint(0)]])],
    [cborUint(9), cborMap([[cborBytes(policy), cborMap([[cborBytes(name), cborUint(AMOUNT)]])]])],
  ])
  const p = opts.payload ?? PAYLOAD
  const pair = new Uint8Array([0xd8, 0x79, ...cborArray([cborArray([cborBytes(Buffer.from(p.slice(2), 'hex')), cborBytes(Buffer.from(SIG.slice(2), 'hex'))])])])
  const ws = cborMap([[cborUint(5), cborArray([cborArray([cborUint(3), cborUint(0), pair, cborArray([cborUint(1), cborUint(1)])])])]])
  return assemble(body, ws, height, idx, [{ address: payTo, lovelace: '1500000', assets: [{ unit: UNIT, quantity: credit.toString() }] }], [payTo], true)
}

const approved = { recipient: RECIPIENT, amountRaw: AMOUNT }
const locate = (koios: FakeKoios, cursor: MintScanCursor, opts: { pageSize?: number; maxPages?: number; timeoutMs?: number } = {}) =>
  locateXReserveCardanoMint({ approved, sourceTxHash: SOURCE, attestation: { requestedTxHash: SOURCE, response: CIRCLE }, cursor, minConfirmations: 10, network: PRE },
    createKoiosLocatorReader({ network: PRE, fetchFn: koios.fetch, ...opts }))
const audit = (koios: FakeKoios, cursor: MintAuditCursor, opts: { pageSize?: number; timeoutMs?: number } = {}) =>
  auditXReserveCardanoMint({ approved, sourceTxHash: SOURCE, attestation: { requestedTxHash: SOURCE, response: CIRCLE }, cursor, minConfirmations: 10, network: PRE },
    createKoiosAuditReader({ network: PRE, fetchFn: koios.fetch, ...opts }))

// ── The real Preprod mint ─────────────────────────────────────────────────────

function realMintKoios(): FakeKoios {
  const k = new FakeKoios()
  const assets = (o: typeof PREPROD_MINT_OUTPUTS[number]) => o.asset_list.map(a => ({ unit: a.policy_id + (a.asset_name ?? ''), quantity: a.quantity }))
  k.add({
    hash: PREPROD_MINT_HASH, height: PREPROD_MINT_HEIGHT, idx: 0, cbor: PREPROD_MINT_CBOR,
    outputs: [...PREPROD_MINT_OUTPUTS].sort((a, b) => a.tx_index - b.tx_index).map(o => ({ address: o.payment_addr.bech32, lovelace: o.value, assets: assets(o) })),
    touches: PREPROD_MINT_OUTPUTS.map(o => o.payment_addr.bech32), assetEvent: true,
  })
  return k
}

describe('the real Preprod USDCx mint (public data)', () => {
  const intent = parseDepositIntent(PREPROD_CIRCLE.payload.slice(2))
  const recipient = PREPROD_MINT_OUTPUTS.find(o => credOf(o.payment_addr.bech32) === intent.remoteRecipient.slice(8))!.payment_addr.bech32
  const realApproved = { recipient, amountRaw: intent.amountRaw }
  const response = { attestations: [{ ...PREPROD_CIRCLE, remoteDomain: 10004 }] }

  it('Circle\'s testnet attestation is the payload the mint carries, and the unchanged proof verifies the mint', async () => {
    expect(keccak256(PREPROD_CIRCLE.payload as Hex)).toBe(PREPROD_CIRCLE.messageHash)
    const reads = koiosMintReads({ network: PRE, fetchFn: realMintKoios().fetch })
    const tx = await reads.confirmedTransaction(PREPROD_MINT_HASH)
    const outputs = await reads.transactionOutputs(PREPROD_MINT_HASH)
    const check = validateXReserveAttestation(response, realApproved, PRE)
    if (!check.ok) throw new Error(check.reason)
    expect(evaluateMintCandidate(check.attestation, { txHash: PREPROD_MINT_HASH, cbor: tx.cbor }, outputs)).toMatchObject({
      kind: 'verified', proof: { attestationCarrier: 'withdraw-zero-redeemer', mintedRaw: '20000000', creditedRaw: '15000000' },
    })
  })

  it('outputs are the regular outputs only (collateral excluded), with asset units, matching the CBOR', async () => {
    const outputs = await koiosMintReads({ network: PRE, fetchFn: realMintKoios().fetch }).transactionOutputs(PREPROD_MINT_HASH)
    expect(outputs.map(o => o.index)).toEqual([0, 1, 2, 3, 4])
    expect(PREPROD_MINT_COLLATERAL.tx_index).toBe(5)
    expect(outputs.map(o => o.address)).not.toContain(undefined)
    expect(outputs[0].assets).toEqual([{ unit: UNIT, quantity: '15000000' }])
  })

  it('a Koios answer without asset lists is refused by the proof, never read as a mint', async () => {
    const k = realMintKoios(); k.dropAssets = true
    const reads = koiosMintReads({ network: PRE, fetchFn: k.fetch })
    const check = validateXReserveAttestation(response, realApproved, PRE)
    if (!check.ok) throw new Error(check.reason)
    const outcome = evaluateMintCandidate(check.attestation, { txHash: PREPROD_MINT_HASH, cbor: (await reads.confirmedTransaction(PREPROD_MINT_HASH)).cbor }, await reads.transactionOutputs(PREPROD_MINT_HASH))
    expect(outcome).toMatchObject({ kind: 'evidence-unreadable' })
  })

  it('both scanners find it through Koios', async () => {
    const k = realMintKoios()
    const start = { blockHeight: PREPROD_MINT_HEIGHT - 60 }
    const att = { requestedTxHash: SOURCE, response }
    const base = { approved: realApproved, sourceTxHash: SOURCE, attestation: att, minConfirmations: 10, network: PRE }
    expect(await locateXReserveCardanoMint({ ...base, cursor: startMintScanCursor(recipient, SOURCE, start) }, createKoiosLocatorReader({ network: PRE, fetchFn: k.fetch })))
      .toMatchObject({ state: 'minted', candidate: { txHash: PREPROD_MINT_HASH } })
    expect(await auditXReserveCardanoMint({ ...base, cursor: startMintAuditCursor(recipient, SOURCE, start, PRE) }, createKoiosAuditReader({ network: PRE, fetchFn: k.fetch })))
      .toMatchObject({ state: 'minted', candidate: { txHash: PREPROD_MINT_HASH } })
  })
})

// ── The cursor contract over Koios pages ──────────────────────────────────────

describe('address history: complete blocks, positions, inclusive cursor', () => {
  function sameBlockKoios() {
    const k = new FakeKoios()
    k.add(payment(99, 0, RECIPIENT, 1))
    for (let i = 0; i < 7; i++) k.add(payment(100, i, RECIPIENT, 10 + i))   // 7 in one block, hash order ≠ position
    k.add(payment(101, 3, RECIPIENT, 30))
    k.add(payment(102, 0, OTHER, 40))                                        // another address: never returned
    return k
  }
  const row = (k: FakeKoios, h: number, i: number) => ({ txHash: k.txs.find(t => t.height === h && t.idx === i)!.hash, blockHeight: h, txIndex: i })

  it('a block cut by a page boundary is completed before it is returned, in position order', async () => {
    const k = sameBlockKoios()
    const reads = koiosMintReads({ network: PRE, fetchFn: k.fetch, pageSize: 3 })
    const rows = await reads.addressTransactions(RECIPIENT, { blockHeight: 100, txIndex: 0 }, 5)
    expect(rows).toEqual([0, 1, 2, 3, 4].map(i => row(k, 100, i)))
    // The inclusive cursor row and the rest of the block, then the next block, then the end.
    expect(await reads.addressTransactions(RECIPIENT, { blockHeight: 100, txIndex: 4 }, 5)).toEqual([row(k, 100, 4), row(k, 100, 5), row(k, 100, 6), row(k, 101, 3)])
  })

  it('returns fewer rows than asked ONLY at the end of the history', async () => {
    const k = sameBlockKoios()
    const reads = koiosMintReads({ network: PRE, fetchFn: k.fetch, pageSize: 100 })
    expect(await reads.addressTransactions(RECIPIENT, { blockHeight: 0, txIndex: 0 }, 50)).toHaveLength(9)
    expect(await reads.addressTransactions(RECIPIENT, { blockHeight: 200, txIndex: 0 }, 5)).toEqual([])
  })

  it('a block larger than the page budget, or a budget that runs out, is a retryable error — never a short answer', async () => {
    const k = sameBlockKoios()
    await expect(koiosMintReads({ network: PRE, fetchFn: k.fetch, pageSize: 3, maxPages: 1 }).addressTransactions(RECIPIENT, { blockHeight: 100, txIndex: 0 }, 2))
      .rejects.toMatchObject({ kind: 'unavailable' })
    await expect(koiosMintReads({ network: PRE, fetchFn: k.fetch, pageSize: 2, maxPages: 2 }).addressTransactions(RECIPIENT, { blockHeight: 99, txIndex: 0 }, 9))
      .rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('SYNTHETIC restart: the locator reaches a mint after 17 earlier same-block transactions across pages, reading each exactly once', async () => {
    const k = new FakeKoios()
    for (let i = 0; i < 5; i++) k.add(payment(90 + i, 0, RECIPIENT, i))
    for (let i = 0; i < 17; i++) k.add(payment(100, i, RECIPIENT, 100 + i))
    const target = mint(100, 17)
    k.add(target)
    k.add(payment(101, 0, RECIPIENT, 200))
    let cursor: MintScanCursor = startMintScanCursor(RECIPIENT, SOURCE, { blockHeight: 80 })
    const states: string[] = []
    for (let poll = 0; poll < 4; poll++) {
      const r = await locate(k, JSON.parse(JSON.stringify(cursor)), { pageSize: 4 })
      states.push(r.state)
      cursor = r.cursor!
      if (r.state === 'minted') break
    }
    expect(states).toEqual(['unknown', 'minted'])
    expect(cursor).toMatchObject({ blockHeight: 100, txIndex: 16 })
    const beforeMint = k.cborReads.slice(0, k.cborReads.indexOf(target.hash))
    expect(new Set(beforeMint).size).toBe(beforeMint.length)   // no transaction read twice
    expect(beforeMint).toHaveLength(22)                         // every earlier transaction read once
    // Later polls keep re-verifying the mint from the held cursor.
    const again = await locate(k, JSON.parse(JSON.stringify(cursor)), { pageSize: 4 })
    expect(again).toMatchObject({ state: 'minted', checked: 1 })
  })
})

describe('asset history (mint and burn events)', () => {
  it('SYNTHETIC restart: the audit reaches our mint after other deposits\' mints in the same block, reading each once', async () => {
    const k = new FakeKoios()
    for (let i = 0; i < 25; i++) k.add(mint(100, i, { payload: payloadFor(1_000_000n + BigInt(i), `${i.toString(16).padStart(2, '0')}`.repeat(32)), payTo: OTHER, salt: i }))
    const target = mint(100, 25)
    k.add(target)
    k.add(payment(100, 26, RECIPIENT, 7))   // not an asset event: never an audit candidate
    let cursor: MintAuditCursor = startMintAuditCursor(RECIPIENT, SOURCE, { blockHeight: 90 }, PRE)
    const states: string[] = []
    for (let poll = 0; poll < 4; poll++) {
      const r = await audit(k, JSON.parse(JSON.stringify(cursor)))
      states.push(r.state)
      cursor = r.cursor!
      if (r.state === 'minted') break
    }
    expect(states).toEqual(['unknown', 'minted'])
    expect(cursor).toMatchObject({ blockHeight: 100, txIndex: 24 })
    const beforeMint = k.cborReads.slice(0, k.cborReads.indexOf(target.hash))
    expect(new Set(beforeMint).size).toBe(25)
    expect(beforeMint).toHaveLength(25)
  })

  it('events before the cursor block\'s time are never positioned', async () => {
    const k = new FakeKoios()
    k.add(mint(50, 0, { payTo: OTHER, salt: 1, payload: payloadFor(5n, '5'.repeat(64)) }))
    k.add(mint(120, 0))
    await audit(k, startMintAuditCursor(RECIPIENT, SOURCE, { blockHeight: 100 }, PRE))
    const infoCalls = k.log.filter(l => l.startsWith('POST /tx_info'))
    expect(infoCalls.length).toBeGreaterThan(0)
    expect(k.cborReads).not.toContain(k.txs[0].hash)
  })
})

describe('provider faults stay retryable unknown, with the cursor unchanged', () => {
  function world() {
    const k = new FakeKoios()
    for (let i = 0; i < 4; i++) k.add(payment(100, i, RECIPIENT, i))
    k.add(mint(100, 4))
    return k
  }
  const start = () => startMintScanCursor(RECIPIENT, SOURCE, { blockHeight: 90 })
  const cases: Array<[string, (k: FakeKoios) => void]> = [
    ['tx_info omits a row', k => { k.txInfoPatch = rows => rows.slice(1) }],
    ['tx_info returns a different transaction', k => { k.txInfoPatch = rows => rows.map((r, i) => (i === 0 ? { ...r, tx_hash: 'ee'.repeat(32) } : r)) }],
    ['tx_info disagrees on the block height', k => { k.txInfoPatch = rows => rows.map((r, i) => (i === 0 ? { ...r, block_height: 101 } : r)) }],
    ['tx_info gives two transactions the same position', k => { k.txInfoPatch = rows => rows.map(r => ({ ...r, tx_block_index: 0 })) }],
    ['tx_info has no position', k => { k.txInfoPatch = rows => rows.map(r => ({ ...r, tx_block_index: null })) }],
    ['a history page is out of order', k => { k.intercept = (p) => (p === '/address_txs' ? new Response(JSON.stringify([
      { tx_hash: 'aa'.repeat(32), block_height: 101 }, { tx_hash: 'bb'.repeat(32), block_height: 100 }]), { status: 200 }) : null) }],
    ['a truncated (non-JSON) page', k => { k.intercept = (p) => (p === '/address_txs' ? new Response('[{"tx_hash":"aa', { status: 200 }) : null) }],
    ['HTTP 429', k => { k.intercept = (p) => (p === '/tx_info' ? new Response('slow down', { status: 429 }) : null) }],
    ['HTTP 504', k => { k.intercept = (p) => (p === '/address_txs' ? new Response('gateway timeout', { status: 504 }) : null) }],
    ['a request that never answers', k => { k.intercept = (p) => (p === '/tx_cbor' ? 'hang' : null) }],
    ['the tip is unreadable', k => { k.intercept = (p) => (p === '/tip' ? new Response('[]', { status: 200 }) : null) }],
  ]
  for (const [name, breakIt] of cases) {
    it(`${name}`, async () => {
      const k = world(); breakIt(k)
      const cursor = start()
      const r = await locate(k, cursor, { timeoutMs: 200 })
      expect(r).toMatchObject({ state: 'unknown', retryable: true, proof: null })
      expect(r.cursor).toEqual(cursor)
      expect(JSON.stringify(r)).not.toMatch(/koios\.rest|https?:/)
    })
  }

  it('the audit also turns a 504 into unknown, never "no match"', async () => {
    const k = world(); k.intercept = (p) => (p === '/asset_history' ? new Response('gateway timeout', { status: 504 }) : null)
    const r = await audit(k, startMintAuditCursor(RECIPIENT, SOURCE, { blockHeight: 90 }, PRE))
    expect(r).toMatchObject({ state: 'unknown', retryable: true, scanComplete: false })
  })

  it('only Preprod addresses are read', async () => {
    await expect(koiosMintReads({ network: PRE, fetchFn: new FakeKoios().fetch }).addressTransactions('addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax', { blockHeight: 1, txIndex: 0 }, 3))
      .rejects.toMatchObject({ kind: 'malformed' })
  })
})
