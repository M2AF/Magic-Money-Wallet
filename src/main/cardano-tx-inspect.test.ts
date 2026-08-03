import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { blake2b } from '@noble/hashes/blake2b'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  bytesToHex,
  cborArray,
  cborBytes,
  cborInt,
  cborMap,
  cborUint,
  cborValue,
  extractTxBody,
  hexToBytes,
} from './cardano-cip30'
import {
  buildCardanoTx,
  deriveCardanoAddress,
  decodeCardanoAddress,
  getCardanoSpendingKey,
  getCardanoStakeKey,
} from './cardano-pure'
import {
  CborMap,
  clearTxInputCache,
  decodeCbor,
  decodeTxBody,
  encodeCardanoAddress,
  formatAda,
  formatCardanoTxSummary,
  formatSignDataPayload,
  summarizeCardanoTx,
} from './cardano-tx-inspect'
import type { WalletConfig } from './secure-store'

const MNEMONIC = 'test test test test test test test test test test test junk'
const ENTROPY = mnemonicToEntropy(MNEMONIC, wordlist)
const OWN_ADDRESS = deriveCardanoAddress(ENTROPY)
const OWN_BYTES = decodeCardanoAddress(OWN_ADDRESS)
// A well-formed foreign address: same shape, different payment credential.
const FOREIGN_BYTES = (() => {
  const bytes = Uint8Array.from(OWN_BYTES)
  bytes[1] ^= 0xff
  return bytes
})()
const FOREIGN_ADDRESS = encodeCardanoAddress(FOREIGN_BYTES)

const POLICY = 'a'.repeat(56)
const NAME_HEX = bytesToHex(new TextEncoder().encode('SNEK'))

const CONFIG = {} as WalletConfig

/** Wrap a body map as a full `[body, witnesses, isValid, auxData]` transaction. */
function makeTx(bodyEntries: Array<[Uint8Array, Uint8Array]>): string {
  const body = cborMap(bodyEntries)
  const tx = cborArray([body, cborMap([]), new Uint8Array([0xf5]), new Uint8Array([0xf6])])
  return bytesToHex(tx)
}

function input(hashByte: number, index: number): Uint8Array {
  return cborArray([cborBytes(new Uint8Array(32).fill(hashByte)), cborUint(index)])
}

/** Decode-only summary — no network, so foreign inputs stay unresolved. */
function summarize(txHex: string, extra: { stakeKeyHash?: Uint8Array } = {}) {
  return summarizeCardanoTx(txHex, {
    ownAddresses: [OWN_ADDRESS],
    config: CONFIG,
    skipResolution: true,
    ...extra,
  })
}

beforeEach(() => clearTxInputCache())

describe('CBOR reader', () => {
  it('decodes the primitive types Cardano bodies use', () => {
    expect(decodeCbor(cborUint(0))).toBe(0n)
    expect(decodeCbor(cborUint(23))).toBe(23n)
    expect(decodeCbor(cborUint(24))).toBe(24n)
    expect(decodeCbor(cborUint(300))).toBe(300n)
    expect(decodeCbor(cborUint(70000))).toBe(70000n)
    expect(decodeCbor(cborUint(2n ** 40n))).toBe(2n ** 40n)
    expect(decodeCbor(cborInt(-1))).toBe(-1n)
    expect(decodeCbor(cborInt(-1000))).toBe(-1000n)
    expect(decodeCbor(cborBytes(new Uint8Array([1, 2, 3])))).toEqual(new Uint8Array([1, 2, 3]))
    expect(decodeCbor(new Uint8Array([0xf5]))).toBe(true)
    expect(decodeCbor(new Uint8Array([0xf6]))).toBe(null)
  })

  it('round-trips a byte string longer than the 1-byte length header', () => {
    const long = new Uint8Array(300).fill(7)
    expect(decodeCbor(cborBytes(long))).toEqual(long)
  })

  it('preserves map key order and byte-string keys', () => {
    const map = decodeCbor(cborMap([
      [cborBytes(new Uint8Array([0xaa])), cborUint(1)],
      [cborBytes(new Uint8Array([0xbb])), cborUint(2)],
    ]))
    expect(map).toBeInstanceOf(CborMap)
    const entries = (map as CborMap).entries
    expect(entries).toHaveLength(2)
    expect(entries[0][0]).toEqual(new Uint8Array([0xaa]))
    expect(entries[1][1]).toBe(2n)
  })

  it('decodes indefinite-length arrays and maps', () => {
    // 0x9f … 0xff — emitted by several Cardano tx builders.
    expect(decodeCbor(new Uint8Array([0x9f, 0x01, 0x02, 0xff]))).toEqual([1n, 2n])
    const map = decodeCbor(new Uint8Array([0xbf, 0x01, 0x02, 0xff])) as CborMap
    expect(map.getInt(1)).toBe(2n)
  })

  it('unwraps tag 258 (set) so Conway input sets decode like arrays', () => {
    const tagged = new Uint8Array([0xd9, 0x01, 0x02, 0x82, 0x01, 0x02])
    expect(decodeCbor(tagged)).toEqual([1n, 2n])
  })

  it('throws rather than reading past the end of a truncated item', () => {
    expect(() => decodeCbor(new Uint8Array([0x58, 0x10, 0x01]))).toThrow()
    expect(() => decodeCbor(new Uint8Array([0x82, 0x01]))).toThrow()
  })
})

describe('address encoding', () => {
  it('round-trips our own base address', () => {
    expect(encodeCardanoAddress(OWN_BYTES)).toBe(OWN_ADDRESS)
  })

  it('picks the right prefix from the header nibbles', () => {
    expect(encodeCardanoAddress(new Uint8Array([0x00, ...new Uint8Array(56)]))).toMatch(/^addr_test1/)
    expect(encodeCardanoAddress(new Uint8Array([0x01, ...new Uint8Array(56)]))).toMatch(/^addr1/)
    expect(encodeCardanoAddress(new Uint8Array([0xe0, ...new Uint8Array(28)]))).toMatch(/^stake_test1/)
    expect(encodeCardanoAddress(new Uint8Array([0xe1, ...new Uint8Array(28)]))).toMatch(/^stake1/)
  })
})

describe('decodeTxBody', () => {
  it('decodes a real signed transfer built by buildCardanoTx', () => {
    const spendKey = getCardanoSpendingKey(ENTROPY)
    const { txCbor } = buildCardanoTx({
      utxos: [{ txHash: 'ab'.repeat(32), txIndex: 0, lovelace: 10_000_000n, assets: [] }],
      toAddress: FOREIGN_BYTES,
      changeAddress: OWN_BYTES,
      amountLovelace: 3_000_000n,
      fee: 170_000n,
      spendKey,
    })
    // extractTxBody is the same slice cip30SignTx hashes before signing, so this
    // asserts the decoder reads exactly the bytes the signature commits to.
    const body = decodeTxBody(extractTxBody(new Uint8Array(txCbor)))
    expect(body.inputs).toEqual([{ txHash: 'ab'.repeat(32), index: 0 }])
    expect(body.fee).toBe(170_000n)
    expect(body.outputs).toHaveLength(2)
    expect(body.outputs[0].address).toBe(FOREIGN_ADDRESS)
    expect(body.outputs[0].value.lovelace).toBe(3_000_000n)
    expect(body.outputs[1].address).toBe(OWN_ADDRESS)
    expect(body.outputs[1].value.lovelace).toBe(10_000_000n - 3_000_000n - 170_000n)
  })

  it('decodes Babbage map-form outputs with inline datums', () => {
    const mapOutput = cborMap([
      [cborUint(0), cborBytes(FOREIGN_BYTES)],
      [cborUint(1), cborValue(2_000_000n, [{ unit: POLICY + NAME_HEX, quantity: '5' }])],
      [cborUint(2), cborArray([cborUint(0), cborBytes(new Uint8Array([1, 2]))])],
    ])
    const body = decodeTxBody(cborMap([
      [cborUint(0), cborArray([input(0x11, 0)])],
      [cborUint(1), cborArray([mapOutput])],
      [cborUint(2), cborUint(180_000n)],
    ]))
    expect(body.outputs).toHaveLength(1)
    expect(body.outputs[0].hasDatum).toBe(true)
    expect(body.outputs[0].value.lovelace).toBe(2_000_000n)
    expect(body.outputs[0].value.assets).toEqual([
      expect.objectContaining({ policy: POLICY, nameHex: NAME_HEX, name: 'SNEK', quantity: 5n }),
    ])
  })

  it('decodes ttl, validity start, collateral, script data and required signers', () => {
    const signerHash = new Uint8Array(28).fill(9)
    const body = decodeTxBody(cborMap([
      [cborUint(0), cborArray([input(0x22, 1)])],
      [cborUint(1), cborArray([cborArray([cborBytes(FOREIGN_BYTES), cborUint(1_000_000n)])])],
      [cborUint(2), cborUint(200_000n)],
      [cborUint(3), cborUint(99_999n)],
      [cborUint(8), cborUint(88_888n)],
      [cborUint(11), cborBytes(new Uint8Array(32).fill(3))],
      [cborUint(13), cborArray([input(0x33, 0)])],
      [cborUint(14), cborArray([cborBytes(signerHash)])],
      [cborUint(17), cborUint(5_000_000n)],
    ]))
    expect(body.ttl).toBe(99_999n)
    expect(body.validityStart).toBe(88_888n)
    expect(body.collateral).toEqual([{ txHash: '33'.repeat(32), index: 0 }])
    expect(body.totalCollateral).toBe(5_000_000n)
    expect(body.requiredSigners).toEqual([signerHash])
    expect(body.scriptDataHash).toBeDefined()
  })

  it('labels known certificates and flags unknown ones', () => {
    const credential = cborArray([cborUint(0), cborBytes(new Uint8Array(28).fill(4))])
    const poolHash = new Uint8Array(28).fill(5)
    const body = decodeTxBody(cborMap([
      [cborUint(0), cborArray([input(0x44, 0)])],
      [cborUint(1), cborArray([])],
      [cborUint(2), cborUint(180_000n)],
      [cborUint(4), cborArray([
        cborArray([cborUint(2), credential, cborBytes(poolHash)]),
        cborArray([cborUint(99), credential]),
      ])],
    ]))
    expect(body.certificates[0]).toMatchObject({ type: 2, known: true, label: 'Delegate stake to a pool' })
    expect(body.certificates[0].detail).toContain('Pool pool1')
    expect(body.certificates[1]).toMatchObject({ type: 99, known: false })
    expect(body.certificates[1].label).toContain('Unrecognised certificate (type 99)')
  })

  it('reports body fields it does not understand', () => {
    const body = decodeTxBody(cborMap([
      [cborUint(0), cborArray([input(0x55, 0)])],
      [cborUint(1), cborArray([])],
      [cborUint(2), cborUint(170_000n)],
      [cborUint(30), cborUint(1n)],
    ]))
    expect(body.unknownFields).toEqual([30])
  })
})

describe('summarizeCardanoTx', () => {
  it('credits outputs paid to us and lists foreign recipients', async () => {
    const txHex = makeTx([
      [cborUint(0), cborArray([input(0x11, 0)])],
      [cborUint(1), cborArray([
        cborArray([cborBytes(FOREIGN_BYTES), cborUint(4_000_000n)]),
        cborArray([cborBytes(OWN_BYTES), cborUint(1_500_000n)]),
      ])],
      [cborUint(2), cborUint(180_000n)],
    ])
    const summary = await summarize(txHex)
    expect(summary.resolution).toBe('partial')   // inputs deliberately unresolved
    expect(summary.netAda).toBe(1_500_000n)
    expect(summary.fee).toBe(180_000n)
    expect(summary.foreignOutputs).toHaveLength(1)
    expect(summary.foreignOutputs[0].address).toBe(FOREIGN_ADDRESS)
    expect(summary.warnings).toContain('Could not verify every input — amounts shown may be incomplete')
  })

  it('reports a complete resolution when there is nothing to resolve', async () => {
    const txHex = makeTx([
      [cborUint(0), cborArray([])],
      [cborUint(1), cborArray([cborArray([cborBytes(OWN_BYTES), cborUint(2_000_000n)])])],
      [cborUint(2), cborUint(170_000n)],
    ])
    const summary = await summarize(txHex)
    expect(summary.resolution).toBe('complete')
    expect(summary.warnings).toHaveLength(0)
  })

  it('warns about burns, collateral and undecodable certificates', async () => {
    const txHex = makeTx([
      [cborUint(0), cborArray([input(0x66, 0)])],
      [cborUint(1), cborArray([])],
      [cborUint(2), cborUint(200_000n)],
      [cborUint(4), cborArray([cborArray([cborUint(77)])])],
      [cborUint(9), cborMap([[cborBytes(hexToBytes(POLICY)), cborMap([[cborBytes(hexToBytes(NAME_HEX)), cborInt(-3)]])]])],
      [cborUint(13), cborArray([input(0x77, 0)])],
      [cborUint(17), cborUint(5_000_000n)],
    ])
    const summary = await summarize(txHex)
    expect(summary.mintBurn).toEqual([expect.objectContaining({ name: 'SNEK', quantity: -3n })])
    expect(summary.collateralCount).toBe(1)
    expect(summary.warnings).toContain('This transaction burns assets — burned assets cannot be recovered')
    expect(summary.warnings).toContain('Uses collateral (up to 5 ADA) — a script failure can cost you that ADA')
    expect(summary.warnings).toContain('Contains a certificate this wallet cannot decode')
  })

  it('detects the stake witness cip30SignTx would attach', async () => {
    const stakeHash = blake2b(getCardanoStakeKey(ENTROPY).pub, { dkLen: 28 })
    const txHex = makeTx([
      [cborUint(0), cborArray([input(0x88, 0)])],
      [cborUint(1), cborArray([])],
      [cborUint(2), cborUint(170_000n)],
      [cborUint(14), cborArray([cborBytes(stakeHash)])],
    ])
    const summary = await summarize(txHex, { stakeKeyHash: stakeHash })
    expect(summary.requiresStakeWitness).toBe(true)
    expect(summary.warnings).toContain('Also signs with your stake key')
  })

  it('does NOT claim a stake witness for an ordinary transfer', async () => {
    const stakeHash = blake2b(getCardanoStakeKey(ENTROPY).pub, { dkLen: 28 })
    // Change back to our own base address embeds the stake hash in an OUTPUT —
    // scanning outputs would false-positive here on every single transaction.
    const txHex = makeTx([
      [cborUint(0), cborArray([input(0x99, 0)])],
      [cborUint(1), cborArray([cborArray([cborBytes(OWN_BYTES), cborUint(2_000_000n)])])],
      [cborUint(2), cborUint(170_000n)],
    ])
    const summary = await summarize(txHex, { stakeKeyHash: stakeHash })
    expect(summary.requiresStakeWitness).toBe(false)
  })

  it('degrades to failed on malformed input instead of throwing', async () => {
    for (const bad of ['', 'zz', 'ff', 'a1', '82']) {
      const summary = await summarize(bad)
      expect(summary.resolution).toBe('failed')
      expect(summary.rawHex).toBe(bad)
      expect(formatCardanoTxSummary(summary)).toContain('could not be decoded')
    }
  })
})

describe('formatting', () => {
  it('formats lovelace as grouped ADA with trailing zeros trimmed', () => {
    expect(formatAda(0n)).toBe('0')
    expect(formatAda(1_500_000n)).toBe('1.5')
    expect(formatAda(170_000n)).toBe('0.17')
    expect(formatAda(-12_500_000n)).toBe('-12.5')
    expect(formatAda(1_234_567_890_123n)).toBe('1,234,567.890123')
  })

  it('renders a readable summary block', async () => {
    const txHex = makeTx([
      [cborUint(0), cborArray([])],
      [cborUint(1), cborArray([
        cborArray([cborBytes(FOREIGN_BYTES), cborValue(4_000_000n, [{ unit: POLICY + NAME_HEX, quantity: '250' }])]),
      ])],
      [cborUint(2), cborUint(180_000n)],
    ])
    const text = formatCardanoTxSummary(await summarize(txHex))
    expect(text).toContain('Fee')
    expect(text).toContain('0.18 ADA')
    expect(text).toContain('To')
    expect(text).toContain(FOREIGN_ADDRESS.slice(0, 12))
  })

  it('can omit the warning lines for callers that render their own band', async () => {
    // The Electron approval window shows summary.warnings in a styled band. If
    // the body ALSO embedded them the user saw every warning twice.
    const txHex = makeTx([
      [cborUint(0), cborArray([input(0xa1, 0)])],
      [cborUint(1), cborArray([])],
      [cborUint(2), cborUint(200_000n)],
      [cborUint(13), cborArray([input(0xa2, 0)])],
    ])
    const summary = await summarize(txHex)
    expect(summary.warnings.length).toBeGreaterThan(0)

    const withWarnings = formatCardanoTxSummary(summary)
    const without = formatCardanoTxSummary(summary, { includeWarnings: false })
    expect(withWarnings).toContain('⚠')
    expect(without).not.toContain('⚠')
    for (const w of summary.warnings) expect(without).not.toContain(w)
  })

  it('shows a signData payload as text only when it really is text', () => {
    const message = bytesToHex(new TextEncoder().encode('Sign in to example.com\nNonce: 42'))
    expect(formatSignDataPayload(message)).toContain('Sign in to example.com')

    // Control characters could forge extra lines in the prompt — never shown.
    const forged = bytesToHex(new TextEncoder().encode('ok\r[2KYou send 0 ADA'))
    expect(formatSignDataPayload(forged)).toContain('not readable text')

    expect(formatSignDataPayload('00ff00ff')).toContain('not readable text')
  })
})
