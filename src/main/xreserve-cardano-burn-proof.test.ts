/**
 * Outbound xReserve burn proof. No test here calls a network or carries a key:
 * the positive fixture is a PUBLIC mainnet USDCx burn, recorded once (read-only,
 * Koios `tx_cbor`) on 2026-10-05; every negative case is derived from it.
 *
 *   Cardano tx 887333810ea5… (block 14027166): burns 2,802.000000 USDCx
 *   (2,800 USDC + 2 maxFee) to release USDC to 0x720f28c6…; the BurnIntent rides
 *   in the REWARD redeemer for a zero withdrawal from the script credential
 *   d74de93a…; the depositor is payment key hash 0de0a107….
 *
 * The prepared-withdrawal terms are reconstructed from the transaction's own
 * redeemer, because Circle's prepare endpoint was not reachable (HTTP 403) when
 * this was written: they are the terms Circle would have returned, not a
 * recording of its response.
 */
import { describe, it, expect } from 'vitest'
import { blake2b } from '@noble/hashes/blake2b'
import { verifyXReserveCardanoBurn, cardanoRemoteDepositor, BURN_WITHDRAWAL_SCRIPT, type BurnTerms } from './xreserve-cardano-burn-proof'
import { splitRoot } from './xreserve-cardano-mint-proof'
import { decodeCbor, CborMap } from './cardano-tx-inspect'
import { hexToBytesStrict } from './cardano-swap-validate'

const BURN_TX_HASH = '887333810ea503013f1e17c503ed6e691940e177e82f88baa76d19409de76e86'
const BURN_TX_CBOR = [
  '84ab00d90102818258202816f18f470988a28ed4aaec88d0cb158ed0289b909baddf6e219fed7e3aa6e6050181825839010d',
  'e0a107f07feebfcc64637534d669093fe4c7cfcff0488e3a8f9236010068053e056b1008f1073581b9d92a839a2796fc8751',
  '01ae44555e821b0000001388e8d8c0a1581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34a1455553',
  '4443781a03aad3c1021a000500ed05a1581df1d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b0009a1',
  '581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34a14555534443783aa703207f0b58204e68f7c2d5',
  '5ae78cd96b23a5fcfa3507935297f223d3f799a36462058533d09a0dd90102818258200213c86d232819bf584259aa160a1c',
  'bdafa4931785730d03f326dbf1e8966c89040ed9010281581c0de0a107f07feebfcc64637534d669093fe4c7cfcff0488e3a',
  '8f923610825839010de0a107f07feebfcc64637534d669093fe4c7cfcff0488e3a8f9236010068053e056b1008f1073581b9',
  'd92a839a2796fc875101ae44555e1b0000000b6e3a026a111a0007816412d901028382582076e8e5a5eb9ae1562b7c6afb04',
  '2037f76c4b097c9857e95c9285a07c5e612ffa0082582086c9f9a54f11627a3b4c0b9577d0a5074eb366b08555192c1d6213',
  '239e2854e100825820d722c14b023979e92aae51978d9ead239ef3f94dc7131939d6a78a10c06eefc700a20082825820376b',
  '7329c2d17f43fe59e0b7dbe414705c13d00c9c885283749f4bd4da540ed75840771c5266633cabc598dde05f2dce5622b722',
  '2f17f8b8009ab3fd37fceba015d9378e721c8757780aa84a2d6382c8d531cea75e933c2b3978c0a05ee2cf2d650a82582088',
  'af650afff80060e5bdd5abc124fee0312423ebc91640f60be41d4829fadb6658407053d7ca6e3d052d154a2a4faffa5f78bb',
  'b57381621f7b114768b99f3c8b783f850a77bd29782b59d4a342592ba8af70646ea7c416a47a85c81a884ad8900b0805a282',
  '010082d8798082198f191a00e27dba82030082d87a9f5f5840070afbc2000000000000000000000000000000000000000000',
  '00000000000000018f7ba3000000000000000000000000000000000000000000000000000000005840001e8480000001c4ca',
  '85def700000001000000000000000000000000000000000000000077777777dcc4d5a8b6e418fd04d8997ef11000ee000000',
  '00000000005840000000002222222d7164433c4c09b0b0d809a9b52c04c205000000000000000000000000a0b86991c6218b',
  '36c1d19d4a2e9eb0ce3606eb480000000000000000584000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000',
  '000000000000000000866e992217e0bfb8371f9ad32a53dcc47d1aa04e0000000000000000584000000000720f28c62b844e',
  '7dd8705ab0a7651f3f575384f4000000000000000000000000866e992217e0bfb8371f9ad32a53dcc47d1aa04e0000000000',
  '0000005840000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000',
  '00000000000000a6e49c00dbad58efb3ba88305840adeac26b49c5058de21d5451aeafb6274339e02744f9a847000000706b',
  '20f62a00000001000027149ea9794d33dbcef3f77718e903816e877ab2577f4d7ee6535840638f1f60fc671dd6000000010d',
  'e0a107f07feebfcc64637534d669093fe4c7cfcff0488e3a8f92360000000000000000000000000000000000000000000000',
  '004c000000000000000000000000ffff821a0001f2641a033157b7f5f6',
].join('')

/** The BurnIntent bytes carried by the redeemer, 524 bytes. */
const INTENT = [
  '070afbc200000000000000000000000000000000000000000000000000000000018f7ba30000000000000000000000000000',
  '0000000000000000000000000000001e8480000001c4ca85def7000000010000000000000000000000000000000000000000',
  '77777777dcc4d5a8b6e418fd04d8997ef11000ee0000000000000000000000002222222d7164433c4c09b0b0d809a9b52c04',
  'c205000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000a0b86991',
  'c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000866e992217e0bfb8371f9ad32a53dcc47d1aa04e0000',
  '00000000000000000000720f28c62b844e7dd8705ab0a7651f3f575384f4000000000000000000000000866e992217e0bfb8',
  '371f9ad32a53dcc47d1aa04e0000000000000000000000000000000000000000000000000000000000000000000000000000',
  '00000000000000000000000000000000000000000000a6e49c00dbad58efb3ba8830adeac26b49c5058de21d5451aeafb627',
  '4339e02744f9a847000000706b20f62a00000001000027149ea9794d33dbcef3f77718e903816e877ab2577f4d7ee653638f',
  '1f60fc671dd6000000010de0a107f07feebfcc64637534d669093fe4c7cfcff0488e3a8f9236000000000000000000000000',
  '000000000000000000000000000000000000000000000000',
].join('')

const DEPOSITOR_KEY_HASH = '0de0a107f07feebfcc64637534d669093fe4c7cfcff0488e3a8f9236'
const TERMS: BurnTerms = {
  network: 'mainnet',
  encoded: `0x${INTENT}`,
  burnAmountRaw: '2802000000',
  remoteDepositor: cardanoRemoteDepositor(DEPOSITOR_KEY_HASH),
}

const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, '0')).join('')
const bytes = (h: string) => hexToBytesStrict(h)
const idOf = (body: Uint8Array) => hex(blake2b(body, { dkLen: 32 }))

interface Tx { body: string; ws: string; valid: string; aux: string }
const parts = (cbor = BURN_TX_CBOR): Tx => {
  const p = splitRoot(bytes(cbor))
  return { body: hex(p.body), ws: hex(p.witnessSet), valid: hex(p.isValid), aux: hex(p.auxData) }
}
/** Reassemble, recomputing the transaction id from the (possibly altered) body. */
const build = (t: Tx) => ({ txHash: idOf(bytes(t.body)), cbor: `84${t.body}${t.ws}${t.valid}${t.aux}` })
const swap = (s: string, from: string, to: string) => {
  expect(s.split(from).length - 1, `fixture contains ${from} once`).toBe(1)
  return s.replace(from, to)
}
const verify = (tx: { txHash: string; cbor: string }, terms: BurnTerms = TERMS) => verifyXReserveCardanoBurn({ terms, cardanoTx: tx })

describe('fixture sanity', () => {
  it('is the public burn: id recomputes and the transaction reassembles byte for byte', () => {
    expect(build(parts()).txHash).toBe(BURN_TX_HASH)
    expect(build(parts()).cbor).toBe(BURN_TX_CBOR)
    expect(INTENT).toHaveLength(524 * 2)
  })
})

describe('verifyXReserveCardanoBurn — the public mainnet burn', () => {
  it('verifies', () => {
    expect(verify({ txHash: BURN_TX_HASH, cbor: BURN_TX_CBOR })).toEqual({
      verified: true, cardanoTxHash: BURN_TX_HASH, burnedRaw: '2802000000', valueRaw: '2800000000', maxFeeRaw: '2000000',
      depositorCredential: DEPOSITOR_KEY_HASH, withdrawalScriptHash: BURN_WITHDRAWAL_SCRIPT.mainnet,
    })
  })
  it('accepts the claimed hash in upper case and a one-element BurnIntentSet header', () => {
    expect(verify({ txHash: BURN_TX_HASH.toUpperCase(), cbor: BURN_TX_CBOR }).verified).toBe(true)
    expect(verify({ txHash: BURN_TX_HASH, cbor: BURN_TX_CBOR }, { ...TERMS, encoded: `0xe999239b00000001${INTENT}` }).verified).toBe(true)
  })
  it('encodes the observed remote depositor', () => {
    expect(cardanoRemoteDepositor(DEPOSITOR_KEY_HASH)).toBe(`0x00000001${DEPOSITOR_KEY_HASH}`)
    expect(() => cardanoRemoteDepositor('abcd')).toThrow()
  })
})

describe('prepared terms are checked before any transaction is trusted', () => {
  const tx = { txHash: BURN_TX_HASH, cbor: BURN_TX_CBOR }
  const code = (terms: BurnTerms) => { const r = verify(tx, terms); return r.verified ? 'verified' : r.code }
  it('refuses inconsistent or malformed terms', () => {
    expect(code({ ...TERMS, burnAmountRaw: '2800000000' })).toBe('invalid-terms')   // fee left out
    expect(code({ ...TERMS, burnAmountRaw: '0' })).toBe('invalid-terms')
    expect(code({ ...TERMS, burnAmountRaw: '28.02' })).toBe('invalid-terms')
    expect(code({ ...TERMS, remoteDepositor: cardanoRemoteDepositor('11'.repeat(28)) })).toBe('invalid-terms')
    expect(code({ ...TERMS, remoteDepositor: '0x' + '00'.repeat(32) })).toBe('invalid-terms')
    expect(code({ ...TERMS, encoded: '0x' })).toBe('invalid-terms')
    expect(code({ ...TERMS, encoded: `0x${INTENT}00` })).toBe('invalid-terms')
    expect(code({ ...TERMS, encoded: `0x${INTENT.slice(0, -2)}` })).toBe('invalid-terms')
    expect(code({ ...TERMS, encoded: `0xdeadbeef${INTENT.slice(8)}` })).toBe('invalid-terms')
    expect(code({ ...TERMS, encoded: 'zz' })).toBe('invalid-terms')
    expect(verifyXReserveCardanoBurn({ terms: undefined as unknown as BurnTerms, cardanoTx: tx })).toMatchObject({ verified: false, code: 'invalid-terms' })
    expect(verifyXReserveCardanoBurn(undefined as never)).toMatchObject({ verified: false })
  })
  it('refuses an intent for another Cardano domain', () => {
    const at = (412 + 8) * 2
    expect(code({ ...TERMS, encoded: `0x${INTENT.slice(0, at)}00002715${INTENT.slice(at + 8)}` })).toBe('invalid-terms')
  })
  it('refuses a network whose burn validator was never measured', () => {
    expect(code({ ...TERMS, network: 'sepolia-preprod' })).toBe('unsupported-network')
    expect(code({ ...TERMS, network: 'nope' as never })).toBe('unsupported-network')
  })
})

describe('a different withdrawal is not this burn', () => {
  it('different recipient → unrelated', () => {
    const at = 2 * (72 + 16 + 5 * 32 + 31)   // last byte of destinationRecipient
    const other = `${INTENT.slice(0, at)}77${INTENT.slice(at + 2)}`
    expect(other).not.toBe(INTENT)
    expect(verify({ txHash: BURN_TX_HASH, cbor: BURN_TX_CBOR }, { ...TERMS, encoded: `0x${other}` })).toMatchObject({ verified: false, code: 'unrelated' })
  })
  it('intent only in a non-withdrawal redeemer → unrelated', () => {
    const t = parts()
    t.ws = swap(t.ws, '82030082d87a9f5f5840070afbc2', '82040082d87a9f5f5840070afbc2')   // reward(3) → vote(4)
    expect(verify(build(t))).toMatchObject({ verified: false, code: 'unrelated' })
  })
})

describe('the transaction carries the intent but does not burn as prepared', () => {
  const outcome = (t: Tx) => { const r = verify(build(t)); return r.verified ? 'verified' : `${r.code}:${r.detail ?? ''}` }
  it('failed phase-2 validation is a failed attempt, not a burn', () => {
    const t = parts(); t.valid = 'f4'
    expect(outcome(t)).toBe('failed-attempt:')
  })
  it('a different quantity burned, or a mint instead of a burn', () => {
    const less = parts(); less.body = swap(less.body, '3aa703207f', '3aa703207e')
    expect(outcome(less)).toBe('burn-conflict:burn-amount-mismatch')
    const mint = parts(); mint.body = swap(mint.body, '3aa703207f', '1aa7032000')
    expect(outcome(mint)).toBe('burn-conflict:burn-amount-mismatch')
  })
  it('another asset name or policy in place of USDCx', () => {
    const name = parts(); name.body = swap(name.body, 'a14555534443783aa703207f', 'a14555534443793aa703207f')
    expect(outcome(name)).toBe('burn-conflict:extra-mint')
    const policy = parts(); policy.body = swap(policy.body, '09a1581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34', '09a1581c1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e35')
    expect(outcome(policy)).toBe('burn-conflict:extra-mint')
  })
  it('a withdrawal from some other script, or from a key credential', () => {
    const script = parts(); script.body = swap(script.body, 'f1d74de93a', 'f1d74de93b')
    expect(outcome(script)).toBe('burn-conflict:wrong-withdrawal-script')
    const key = parts(); key.body = swap(key.body, 'f1d74de93a', 'e1d74de93a')
    expect(outcome(key)).toBe('burn-conflict:wrong-withdrawal-script')
  })
  it('a non-zero withdrawal from the burn validator', () => {
    const t = parts(); t.body = swap(t.body, '266dc7b0009a1581c1f3a', '266dc7b0109a1581c1f3a')
    expect(outcome(t)).toBe('burn-conflict:wrong-withdrawal-script')
  })
  it('a depositor that never witnessed the transaction', () => {
    const t = parts()
    const ws = decodeCbor(bytes(t.ws)) as CborMap
    // Two keys witness this burn (the depositor's and the collateral provider's): flip the depositor's.
    const vkey = (ws.getInt(0) as Uint8Array[][]).map(w => w[0]).find(k => hex(blake2b(k, { dkLen: 28 })) === DEPOSITOR_KEY_HASH)!
    expect((ws.getInt(0) as unknown[]).length).toBe(2)
    t.ws = swap(t.ws, hex(vkey), hex(vkey.map((b, i) => (i === 0 ? b ^ 1 : b))))
    expect(outcome(t)).toBe('burn-conflict:depositor-not-witnessed')
  })
})

describe('hostile CBOR never verifies and never throws', () => {
  const reason = (cbor: string, txHash = BURN_TX_HASH) => verify({ txHash, cbor })
  it('rejects wrong ids, non-hex, empty, trailing and truncated input', () => {
    expect(reason(BURN_TX_CBOR, '00'.repeat(32))).toMatchObject({ verified: false, code: 'evidence-unreadable' })
    expect(reason(BURN_TX_CBOR, 'abc')).toMatchObject({ verified: false, code: 'evidence-unreadable' })
    expect(reason('zz')).toMatchObject({ verified: false, code: 'evidence-unreadable' })
    expect(reason('')).toMatchObject({ verified: false, code: 'evidence-unreadable' })
    expect(reason(`${BURN_TX_CBOR}00`)).toMatchObject({ verified: false, code: 'evidence-unreadable' })
    for (let n = 0; n < BURN_TX_CBOR.length; n += 38) {
      expect(reason(BURN_TX_CBOR.slice(0, n))).toMatchObject({ verified: false })
    }
  })
  it('rejects a non-array root, absurd lengths, deep nesting and reserved encodings', () => {
    for (const cbor of ['a0', '80', '84', '84a0', 'bf', '9f', 'ff', '5bffffffffffffffff', '84' + '81'.repeat(2000) + '00']) {
      expect(reason(cbor)).toMatchObject({ verified: false, code: 'evidence-unreadable' })
    }
  })
  it('a body that is not a map, or has no mint or withdrawal, cannot verify', () => {
    const p = parts()
    for (const body of ['80', 'a0', 'a109a0', 'a105a0']) expect(verify(build({ ...p, body })).verified).toBe(false)
  })
  it('flipping any single body byte never verifies; flipping any byte anywhere never throws', () => {
    const p = parts()
    const body = bytes(p.body)
    for (let i = 0; i < body.length; i++) {
      const b = body.slice(); b[i] ^= 0x01
      expect(verify({ txHash: BURN_TX_HASH, cbor: `84${hex(b)}${p.ws}${p.valid}${p.aux}` }).verified, `body byte ${i}`).toBe(false)
    }
    for (let i = 0; i < BURN_TX_CBOR.length / 2; i++) {
      const b = bytes(BURN_TX_CBOR); b[i] ^= 0xff
      expect(() => verify({ txHash: BURN_TX_HASH, cbor: hex(b) })).not.toThrow()
    }
  })
  it('a malformed witness set is unreadable, not a crash', () => {
    const p = parts()
    for (const ws of ['80', 'a10500', 'a1058100', 'a1058403']) expect(verify(build({ ...p, ws })).verified).toBe(false)
  })
})
