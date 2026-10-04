/**
 * Inbound xReserve mint proof. No test here calls a network or carries a key:
 * the positive fixture is the public mint documented in
 * docs/XRESERVE-GATE2-RESEARCH.md, recorded once (read-only) and embedded
 * below; every negative case is derived from it or built synthetically.
 *
 *   Ethereum deposit 0x9695d030… (1,899.991033 USDC, domain 10004)
 *   → Circle attestation (messageHash 0x2630e4dc…)
 *   → Cardano tx 24da9d4f… : mints 1,899,991,033 USDCx; output 0 pays
 *     1,899,991,032 to addr1vyw8t3dc…; the payload and signature ride in a
 *     REWARD redeemer for a zero withdrawal from a script stake credential.
 */
import { describe, it, expect } from 'vitest'
import { blake2b } from '@noble/hashes/blake2b'
import { bech32 } from '@scure/base'
import { keccak256, type Hex } from 'viem'
import { verifyXReserveCardanoMint, parseDepositIntent, type MintProofInput } from './xreserve-cardano-mint-proof'
import { splitTxRoot, hexToBytesStrict } from './cardano-swap-validate'
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

const RECIPIENT = 'addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax'
const AMOUNT = 1_899_991_033n
const hexOf = (b: Uint8Array) => Buffer.from(b).toString('hex')
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const ATT = CIRCLE_RESPONSE.attestations[0]
const PAYLOAD = ATT.payload.slice(2)
const SIGNATURE = ATT.attestation.slice(2)

const base = (): MintProofInput => ({
  attestationResponse: clone(CIRCLE_RESPONSE),
  cardanoTx: { txHash: MINT_TX_HASH, cbor: MINT_TX_CBOR },
  cardanoOutputs: clone(MINT_TX_OUTPUTS),
  approved: { recipient: RECIPIENT, amountRaw: AMOUNT },
})
const codeOf = (input: MintProofInput) => {
  const r = verifyXReserveCardanoMint(input)
  return r.verified ? 'verified' : r.code
}
const unverified = (input: MintProofInput, pattern: RegExp) => {
  const r = verifyXReserveCardanoMint(input)
  expect(r.verified).toBe(false)
  if (!r.verified) expect(r.reason).toMatch(pattern)
}

/** Replace the attestation payload, keeping messageHash consistent with it. */
function withPayload(input: MintProofInput, payloadHex: string, signatureHex = SIGNATURE): MintProofInput {
  const resp = input.attestationResponse as { attestations: Array<Record<string, unknown>> }
  resp.attestations[0].payload = `0x${payloadHex}`
  resp.attestations[0].attestation = `0x${signatureHex}`
  resp.attestations[0].messageHash = keccak256(`0x${payloadHex}` as Hex)
  return input
}

/** Assemble a transaction from raw parts; returns its CBOR and recomputed id. */
function tx(body: Uint8Array, witnessSet: Uint8Array, isValid = 0xf5, aux: Uint8Array = new Uint8Array([0xf6])) {
  const out = new Uint8Array([0x84, ...body, ...witnessSet, isValid, ...aux])
  return { cbor: hexOf(out), txHash: hexOf(blake2b(body, { dkLen: 32 })) }
}

// ── Synthetic building blocks (the real tx's shapes, rebuilt) ─────────────────
const plutusConstr0 = (fields: Uint8Array[]) => new Uint8Array([0xd8, 0x79, ...cborArray(fields)])
const pairData = (payload = PAYLOAD, signature = SIGNATURE) =>
  plutusConstr0([cborArray([cborBytes(Buffer.from(payload, 'hex')), cborBytes(Buffer.from(signature, 'hex'))])])
const USDCX_POLICY = Buffer.from(CARDANO_USDCX_UNIT.mainnet.slice(0, 56), 'hex')
const USDCX_NAME = Buffer.from(CARDANO_USDCX_UNIT.mainnet.slice(56), 'hex')
const SCRIPT_REWARD = new Uint8Array([0xf1, ...Buffer.from('d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b', 'hex')])
const KEY_REWARD = new Uint8Array([0xe1, ...Buffer.from('d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b', 'hex')])
const usdcxValue = (qty: bigint) => cborArray([cborUint(2_000_000n), cborMap([[cborBytes(USDCX_POLICY), cborMap([[cborBytes(USDCX_NAME), cborUint(qty)]])]])])

function syntheticBody(opts: { mint?: boolean; withdrawal?: { acct: Uint8Array; amount: bigint } | null; payTo?: string; qty?: bigint; mintQty?: bigint } = {}) {
  const entries: Array<[Uint8Array, Uint8Array]> = [
    [cborUint(0), cborArray([cborArray([cborBytes(new Uint8Array(32)), cborUint(0)])])],
    [cborUint(1), cborArray([cborArray([cborBytes(decodeCardanoAddress(opts.payTo ?? RECIPIENT)), usdcxValue(opts.qty ?? AMOUNT - 1n)])])],
    [cborUint(2), cborUint(500_000n)],
  ]
  const w = opts.withdrawal === undefined ? { acct: SCRIPT_REWARD, amount: 0n } : opts.withdrawal
  if (w) entries.push([cborUint(5), cborMap([[cborBytes(w.acct), cborUint(w.amount)]])])
  if (opts.mint !== false) entries.push([cborUint(9), cborMap([[cborBytes(USDCX_POLICY), cborMap([[cborBytes(USDCX_NAME), cborUint(opts.mintQty ?? AMOUNT)]])]])])
  return cborMap(entries)
}
/** Witness set with redeemers in the ARRAY form: [tag, index, data, ex_units]. */
const arrayRedeemers = (...rs: Array<[number, number, Uint8Array]>) => cborMap([[cborUint(5),
  cborArray(rs.map(([tag, idx, data]) => cborArray([cborUint(tag), cborUint(idx), data, cborArray([cborUint(1), cborUint(1)])])))]])
const synthetic = (body: Uint8Array, ws: Uint8Array, extra: Partial<MintProofInput> = {}): MintProofInput => {
  const t = tx(body, ws)
  return { ...base(), cardanoOutputs: undefined, cardanoTx: t, ...extra }
}

describe('the public mint verifies', () => {
  it('proves Circle\'s attested deposit became USDCx at the approved address, and reports — not labels — the difference', () => {
    const r = verifyXReserveCardanoMint(base())
    expect(r).toMatchObject({
      verified: true,
      remoteDomain: 10004,
      messageHash: ATT.messageHash,
      attestationCarrier: 'withdraw-zero-redeemer',
      cardanoTxHash: MINT_TX_HASH,
      mintedRaw: '1899991033',
      creditedRaw: '1899991032',
      recipientOutputIndexes: [0],
      sourceMinusCreditedRaw: '1',
    })
    if (r.verified) {
      expect(r.depositIntent).toMatchObject({ amountRaw: '1899991033', remoteDomain: 10004, maxFeeRaw: '10000000' })
      expect(r.depositIntent.hookData).toBe('00'.repeat(95))   // the unexplained form, reported as observed
      expect(Object.keys(r)).not.toContain('feeRaw')
    }
  })

  it('verifies without the indexer view (CBOR is authoritative), and accepts a string amount', () => {
    expect(verifyXReserveCardanoMint({ ...base(), cardanoOutputs: undefined }).verified).toBe(true)
    expect(verifyXReserveCardanoMint({ ...base(), approved: { recipient: RECIPIENT, amountRaw: '1899991033' } }).verified).toBe(true)
  })

  it('parses the payload by Circle\'s DepositIntent layout', () => {
    const d = parseDepositIntent(PAYLOAD)
    expect(d.remoteRecipient).toBe('000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9')
    expect(d.localToken).toBe('000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
  })
})

describe('changed attestation', () => {
  it('a payload that no longer hashes to Circle\'s messageHash', () => {
    const i = base()
    ;(i.attestationResponse as { attestations: Array<{ payload: string }> }).attestations[0].payload = `0x${PAYLOAD.slice(0, -2)}01`
    unverified(i, /messageHash does not match/)
  })
  it('a self-consistent but different payload is not the one the mint carries', () => {
    unverified(withPayload(base(), PAYLOAD.slice(0, -2) + '01'), /not carried by a redeemer/)
  })
  it('a different signature', () => {
    unverified(withPayload(base(), PAYLOAD, SIGNATURE.slice(0, -2) + (SIGNATURE.endsWith('00') ? '01' : '00')), /not carried by a redeemer/)
  })
  it('another domain, in the response or in the payload', () => {
    const i = base()
    ;(i.attestationResponse as { attestations: Array<{ remoteDomain: number }> }).attestations[0].remoteDomain = 10003
    unverified(i, /domain 10003, not Cardano/)
    const d = PAYLOAD.slice(0, 80) + '00002713' + PAYLOAD.slice(88)
    unverified(withPayload(base(), d), /payload does not target Cardano/)
  })
  it('a different attested amount than the user approved', () => {
    unverified({ ...base(), approved: { recipient: RECIPIENT, amountRaw: AMOUNT + 1n } }, /attested amount is not the approved amount/)
  })
  it('several attestations for the source transaction are ambiguous', () => {
    const i = base()
    const a = (i.attestationResponse as { attestations: unknown[] }).attestations
    a.push(clone(a[0]))
    unverified(i, /more than one attestation/)
  })
  it('missing, empty or malformed responses', () => {
    unverified({ ...base(), attestationResponse: null }, /missing/)
    unverified({ ...base(), attestationResponse: { attestations: [] } }, /no attestation/)
    unverified(withPayload(base(), PAYLOAD.slice(0, 100)), /shorter than a DepositIntent/)
    unverified(withPayload(base(), 'ffffffff' + PAYLOAD.slice(8)), /magic/)
  })
})

describe('the pair must be in an authorizing redeemer', () => {
  it('metadata-only: the same payload and signature in auxiliary data, not in any redeemer', () => {
    const parts = splitTxRoot(hexToBytesStrict(MINT_TX_CBOR))
    // Break the redeemer's copy (first payload chunk zeroed, same length) …
    const ws = Buffer.from(parts.witnessSet).toString('hex')
    const firstChunk = PAYLOAD.slice(0, 128)
    expect(ws.split(firstChunk).length).toBe(2)
    const brokenWs = hexToBytesStrict(ws.replace(firstChunk, '00'.repeat(64)))
    // … and put the complete pair in metadata label 674.
    const aux = cborMap([[cborUint(674), cborArray([cborBytes(Buffer.from(PAYLOAD, 'hex')), cborBytes(Buffer.from(SIGNATURE, 'hex'))])]])
    const t = tx(parts.body, brokenWs, 0xf5, aux)
    expect(t.txHash).toBe(MINT_TX_HASH)          // body untouched: same transaction id
    expect(t.cbor).toContain(PAYLOAD)            // present as a raw substring…
    unverified({ ...base(), cardanoTx: t }, /not carried by a redeemer/)   // …and still not evidence
  })

  it('a SPEND redeemer carrying the pair is not evidence (unrelated)', () => {
    const i = synthetic(syntheticBody(), arrayRedeemers([0, 0, pairData()]))
    unverified(i, /only carried by a redeemer that does not authorize/)
    expect(codeOf(i)).toBe('unrelated')
  })

  it('withdraw-zero from a SCRIPT credential verifies (array redeemer form)', () => {
    const r = verifyXReserveCardanoMint(synthetic(syntheticBody(), arrayRedeemers([3, 0, pairData()])))
    expect(r).toMatchObject({ verified: true, attestationCarrier: 'withdraw-zero-redeemer' })
  })

  it('a MINT redeemer for the USDCx policy verifies', () => {
    const r = verifyXReserveCardanoMint(synthetic(syntheticBody({ withdrawal: null }), arrayRedeemers([1, 0, pairData()])))
    expect(r).toMatchObject({ verified: true, attestationCarrier: 'mint-redeemer' })
  })

  it('a withdrawal that is not zero, or not from a script credential, does not qualify (unrelated)', () => {
    expect(codeOf(synthetic(syntheticBody({ withdrawal: { acct: SCRIPT_REWARD, amount: 1n } }), arrayRedeemers([3, 0, pairData()])))).toBe('unrelated')
    expect(codeOf(synthetic(syntheticBody({ withdrawal: { acct: KEY_REWARD, amount: 0n } }), arrayRedeemers([3, 0, pairData()])))).toBe('unrelated')
  })

  it('two withdrawals with the pair in a reward redeemer: the carrier cannot be matched — a conflict, not unrelated', () => {
    const body = cborMap([
      [cborUint(0), cborArray([cborArray([cborBytes(new Uint8Array(32)), cborUint(0)])])],
      [cborUint(1), cborArray([cborArray([cborBytes(decodeCardanoAddress(RECIPIENT)), usdcxValue(AMOUNT)])])],
      [cborUint(2), cborUint(500_000n)],
      [cborUint(5), cborMap([[cborBytes(SCRIPT_REWARD), cborUint(0)], [cborBytes(KEY_REWARD), cborUint(0)]])],
      [cborUint(9), cborMap([[cborBytes(USDCX_POLICY), cborMap([[cborBytes(USDCX_NAME), cborUint(AMOUNT)]])]])],
    ])
    expect(codeOf(synthetic(body, arrayRedeemers([3, 0, pairData()])))).toBe('carrier-ambiguous')
  })

  it('the pair split across two redeemers, or out of order, is not a pair', () => {
    const onlyPayload = plutusConstr0([cborArray([cborBytes(Buffer.from(PAYLOAD, 'hex'))])])
    const onlySig = plutusConstr0([cborArray([cborBytes(Buffer.from(SIGNATURE, 'hex'))])])
    unverified(synthetic(syntheticBody(), arrayRedeemers([3, 0, onlyPayload], [1, 0, onlySig])), /not carried by a redeemer/)
    unverified(synthetic(syntheticBody(), arrayRedeemers([3, 0, pairData(SIGNATURE, PAYLOAD)])), /not carried by a redeemer/)
  })
})

describe('the mint, the asset and the recipient', () => {
  it('a transaction without a mint', () => {
    unverified(synthetic(syntheticBody({ mint: false }), arrayRedeemers([3, 0, pairData()])), /mints nothing/)
  })

  it('wrong asset: a look-alike name under the USDCx policy (body changed, id recomputed)', () => {
    const parts = splitTxRoot(hexToBytesStrict(MINT_TX_CBOR))
    const body = Buffer.from(parts.body).toString('hex').split('455553444378').join('455553444359')   // "USDCY"
    const t = tx(hexToBytesStrict(body), parts.witnessSet)
    unverified({ ...base(), cardanoOutputs: undefined, cardanoTx: t }, /does not mint USDCx/)
  })

  it('wrong recipient: another address, and the SAME payment key with a stake part (not the exact address)', () => {
    unverified({ ...base(), approved: { recipient: 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8', amountRaw: AMOUNT } },
      /attested recipient is not the approved/)
    // Base address: the approved enterprise address's payment key + an arbitrary stake key.
    const pkh = Buffer.from(decodeCardanoAddress(RECIPIENT)).subarray(1, 29)
    const samePaymentKey = bech32.encode('addr', bech32.toWords(new Uint8Array([0x01, ...pkh, ...new Uint8Array(28).fill(7)])), 1000)
    unverified({ ...base(), approved: { recipient: samePaymentKey, amountRaw: AMOUNT } }, /no output pays USDCx to the approved address/)
  })

  it('a synthetic mint that pays someone else', () => {
    unverified(synthetic(syntheticBody({ payTo: 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8' }), arrayRedeemers([3, 0, pairData()])),
      /no output pays USDCx to the approved address/)
  })

  it('a phase-2-failed transaction minted nothing', () => {
    const parts = splitTxRoot(hexToBytesStrict(MINT_TX_CBOR))
    unverified({ ...base(), cardanoTx: tx(parts.body, parts.witnessSet, 0xf4) }, /failed script validation/)
  })
})

describe('incomplete or inconsistent Cardano evidence', () => {
  it('CBOR that is not the claimed transaction', () => {
    unverified({ ...base(), cardanoTx: { txHash: 'ab'.repeat(32), cbor: MINT_TX_CBOR } }, /not the claimed Cardano transaction/)
  })
  it('truncated or non-hex CBOR', () => {
    unverified({ ...base(), cardanoTx: { txHash: MINT_TX_HASH, cbor: MINT_TX_CBOR.slice(0, -10) } }, /malformed Cardano transaction/)
    unverified({ ...base(), cardanoTx: { txHash: MINT_TX_HASH, cbor: 'zz' } }, /malformed Cardano transaction/)
  })
  it('an indexer view that disagrees with the CBOR', () => {
    const i = base()
    i.cardanoOutputs![0].assets[0].quantity = '1899991033'
    unverified(i, /indexer's outputs do not match/)
    const j = base()
    j.cardanoOutputs!.pop()
    unverified(j, /indexer's outputs do not match/)
  })
  it('an approved recipient that is not a mainnet base/enterprise address', () => {
    unverified({ ...base(), approved: { recipient: 'addr_test1vz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzerspjrlsz', amountRaw: AMOUNT } }, /approved recipient/)
  })
})

describe('mint and credit amounts (wallet rules, not Circle mandates)', () => {
  const withdrawZero = () => arrayRedeemers([3, 0, pairData()])

  it('a valid attestation, but the transaction mints only a tiny amount', () => {
    unverified(synthetic(syntheticBody({ mintQty: 1n, qty: 1n }), withdrawZero()), /mints a different USDCx amount than Circle attested/)
  })

  it('a valid attestation, but the transaction mints a different amount', () => {
    unverified(synthetic(syntheticBody({ mintQty: AMOUNT - 100n, qty: AMOUNT - 100n }), withdrawZero()), /mints a different USDCx amount/)
    unverified(synthetic(syntheticBody({ mintQty: AMOUNT + 1n, qty: AMOUNT }), withdrawZero()), /mints a different USDCx amount/)
  })

  it('a credit larger than the mint (USDCx from other inputs) is not evidence of this mint', () => {
    unverified(synthetic(syntheticBody({ mintQty: AMOUNT, qty: AMOUNT + 5n }), withdrawZero()), /credited more USDCx than the transaction minted/)
  })

  it('the full minted amount credited verifies with a zero difference; a partial credit reports a positive one', () => {
    const full = verifyXReserveCardanoMint(synthetic(syntheticBody({ mintQty: AMOUNT, qty: AMOUNT }), withdrawZero()))
    expect(full).toMatchObject({ verified: true, creditedRaw: AMOUNT.toString(), sourceMinusCreditedRaw: '0' })
    const partial = verifyXReserveCardanoMint(synthetic(syntheticBody({ mintQty: AMOUNT, qty: 1n }), withdrawZero()))
    expect(partial).toMatchObject({ verified: true, creditedRaw: '1', sourceMinusCreditedRaw: (AMOUNT - 1n).toString() })
  })

  it('the real public fixture still verifies: minted equals attested, and the difference is not negative', () => {
    const r = verifyXReserveCardanoMint(base())
    expect(r.verified).toBe(true)
    if (r.verified) {
      expect(r.mintedRaw).toBe(r.depositIntent.amountRaw)
      expect(BigInt(r.sourceMinusCreditedRaw) >= 0n).toBe(true)
    }
  })
})

describe('typed outcomes: the carrier is established before the mint and credit are judged', () => {
  const withdrawZero = () => arrayRedeemers([3, 0, pairData()])

  it('the public fixture is verified', () => {
    expect(codeOf(base())).toBe('verified')
  })
  it('matching attestation, tiny mint → mint-conflict (mint-amount-mismatch), not unrelated', () => {
    expect(codeOf(synthetic(syntheticBody({ mintQty: 1n, qty: 1n }), withdrawZero()))).toBe('mint-amount-mismatch')
  })
  it('matching attestation, excessive mint → mint-amount-mismatch', () => {
    expect(codeOf(synthetic(syntheticBody({ mintQty: AMOUNT * 10n, qty: AMOUNT }), withdrawZero()))).toBe('mint-amount-mismatch')
  })
  it('matching attestation, no USDCx mint at all → no-usdcx-mint', () => {
    expect(codeOf(synthetic(syntheticBody({ mint: false }), withdrawZero()))).toBe('no-usdcx-mint')
  })
  it('matching attestation, credit to the wrong address → no-recipient-credit', () => {
    expect(codeOf(synthetic(syntheticBody({ payTo: 'addr1vx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzers66hrl8' }), withdrawZero()))).toBe('no-recipient-credit')
  })
  it('matching attestation, credit above the mint → excess-recipient-credit', () => {
    expect(codeOf(synthetic(syntheticBody({ mintQty: AMOUNT, qty: AMOUNT + 5n }), withdrawZero()))).toBe('excess-recipient-credit')
  })
  it('the real mint re-marked as phase-2 failed → failed-attempt (not a mint, not a refund)', () => {
    const parts = splitTxRoot(hexToBytesStrict(MINT_TX_CBOR))
    expect(codeOf({ ...base(), cardanoTx: tx(parts.body, parts.witnessSet, 0xf4) })).toBe('failed-attempt')
  })
  it('a phase-2-failed transaction WITHOUT the attestation is simply unrelated', () => {
    const t = tx(syntheticBody(), arrayRedeemers([0, 0, plutusConstr0([])]), 0xf4)
    expect(codeOf({ ...base(), cardanoOutputs: undefined, cardanoTx: t })).toBe('unrelated')
  })
  it('an unrelated USDCx transfer (no attestation carrier) is unrelated', () => {
    expect(codeOf(synthetic(syntheticBody({ mint: false }), cborMap([])))).toBe('unrelated')
  })
  it('corrupt provider data is evidence-unreadable', () => {
    expect(codeOf({ ...base(), cardanoTx: { txHash: MINT_TX_HASH, cbor: MINT_TX_CBOR.slice(0, -10) } })).toBe('evidence-unreadable')
    expect(codeOf({ ...base(), cardanoTx: { txHash: 'ab'.repeat(32), cbor: MINT_TX_CBOR } })).toBe('evidence-unreadable')
    const i = base(); i.cardanoOutputs![0].lovelace = '1'
    expect(codeOf(i)).toBe('evidence-unreadable')
  })
  it('attestation failures carry their own codes', () => {
    expect(codeOf({ ...base(), attestationResponse: { attestations: [] } })).toBe('attestation-missing')
    expect(codeOf({ ...base(), attestationResponse: { attestations: [{ payload: 'zz' }] } })).toBe('attestation-malformed')
    expect(codeOf({ ...base(), approved: { recipient: RECIPIENT, amountRaw: AMOUNT + 1n } })).toBe('attestation-mismatch')
    expect(codeOf({ ...base(), approved: { recipient: RECIPIENT, amountRaw: 0n } })).toBe('invalid-approval')
  })
})
