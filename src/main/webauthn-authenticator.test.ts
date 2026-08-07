import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server'
import {
  deriveWebauthnRoot,
  deriveCredentialMacKey,
  deriveCredentialKey,
  makeCredentialId,
  parseCredentialId,
  isOwnCredentialId,
  buildAuthenticatorData,
  buildAttestationObject,
  buildAssertion,
  coseKeyFromPublicKey,
  buildClientDataJSON,
  rpIdHash,
  base64url,
  fromBase64url,
  toHex,
  fromHex,
  cborInt,
  cborBytes,
  cborText,
  cborMap,
  MAGICMONEY_AAGUID,
  CRED_ID_LEN,
  CRED_ID_VERSION,
  FLAG_UP, FLAG_UV, FLAG_BE, FLAG_BS, FLAG_AT,
} from './webauthn-authenticator'

// Public test phrases. Nothing here is a secret.
const FOUNDRY = 'test test test test test test test test test test test junk'
const BIP39_ZERO = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

const RP_ID = 'chainlensnft.info'
const ORIGIN = `https://${RP_ID}`

const nonce = (seed: number) => Uint8Array.from({ length: 16 }, (_, i) => (i * seed + 3) & 0xff)
const sha256hex = (b: Uint8Array) => new Uint8Array(createHash('sha256').update(b).digest())

/**
 * Drive a full registration ceremony and hand the result to @simplewebauthn/server.
 * The point of Phase 1 is that an INDEPENDENT implementation accepts our bytes —
 * our own tests agreeing with themselves proves nothing about interoperability.
 */
async function register(opts: {
  mnemonic?: string
  accountIndex?: number
  rpId?: string
  origin?: string
  challenge?: Uint8Array
  nonce?: Uint8Array
}) {
  const mnemonic = opts.mnemonic ?? FOUNDRY
  const rpId = opts.rpId ?? RP_ID
  const origin = opts.origin ?? `https://${rpId}`
  const challenge = opts.challenge ?? Uint8Array.from({ length: 32 }, (_, i) => (i * 11 + 1) & 0xff)
  const n = opts.nonce ?? nonce(5)

  const root = await deriveWebauthnRoot(mnemonic, opts.accountIndex ?? 0)
  const att = buildAttestationObject({ root, rpId, nonce: n })
  const clientDataJSON = buildClientDataJSON('webauthn.create', challenge, origin)

  const verification = await verifyRegistrationResponse({
    response: {
      id: base64url(att.credentialId),
      rawId: base64url(att.credentialId),
      response: {
        clientDataJSON: base64url(clientDataJSON),
        attestationObject: base64url(att.attestationObject),
      },
      clientExtensionResults: {},
      type: 'public-key',
    },
    expectedChallenge: base64url(challenge),
    expectedOrigin: origin,
    expectedRPID: rpId,
  })

  return { root, att, challenge, rpId, origin, verification }
}

// ─── Independent verification: registration ─────────────────────────────────

describe('attestation is accepted by @simplewebauthn/server', () => {
  it('verifies a registration end-to-end', async () => {
    const { verification, att } = await register({})
    expect(verification.verified).toBe(true)
    if (!verification.verified) return

    const info = verification.registrationInfo
    expect(info.fmt).toBe('none')
    expect(info.credential.id).toBe(base64url(att.credentialId))
    expect(toHex(info.credential.publicKey)).toBe(toHex(att.publicKeyCose))
    expect(info.credential.counter).toBe(0)
    expect(info.userVerified).toBe(true)
    expect(info.aaguid).toBe('2c4b3c62-a6fc-6b9f-47f2-4ede41f1b4bf')
  })

  // A seed-derived credential genuinely lives on every device holding the words.
  // Reporting singleDevice would be a lie, and RPs use this to decide whether to
  // nag the user to enrol a second key.
  it('reports the credential as multi-device and backed up', async () => {
    const { verification } = await register({})
    expect(verification.verified).toBe(true)
    if (!verification.verified) return
    expect(verification.registrationInfo.credentialDeviceType).toBe('multiDevice')
    expect(verification.registrationInfo.credentialBackedUp).toBe(true)
  })

  it('verifies across several relying parties and several wallet accounts', async () => {
    for (const rpId of ['chainlensnft.info', 'example.com', 'webauthn.io', 'a.very.deep.sub.domain.test']) {
      for (const accountIndex of [0, 1, 7]) {
        const { verification } = await register({ rpId, accountIndex, nonce: nonce(accountIndex + 2) })
        expect(verification.verified, `${rpId} / account ${accountIndex}`).toBe(true)
      }
    }
  })

  it('is rejected when the origin does not match', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY)
    const att = buildAttestationObject({ root, rpId: RP_ID, nonce: nonce(5) })
    const challenge = Uint8Array.from({ length: 32 }, (_, i) => i)
    await expect(verifyRegistrationResponse({
      response: {
        id: base64url(att.credentialId),
        rawId: base64url(att.credentialId),
        response: {
          clientDataJSON: base64url(buildClientDataJSON('webauthn.create', challenge, 'https://evil.example')),
          attestationObject: base64url(att.attestationObject),
        },
        clientExtensionResults: {},
        type: 'public-key',
      },
      expectedChallenge: base64url(challenge),
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    })).rejects.toThrow()
  })
})

// ─── Independent verification: assertion ────────────────────────────────────

describe('assertions are accepted by @simplewebauthn/server', () => {
  async function assertAndVerify(opts: {
    mnemonic?: string
    accountIndex?: number
    rpId?: string
    signChallenge?: Uint8Array
    verifyChallenge?: Uint8Array
    signOrigin?: string
    verifyOrigin?: string
    corruptSignature?: boolean
  } = {}) {
    const rpId = opts.rpId ?? RP_ID
    const reg = await register({ mnemonic: opts.mnemonic, accountIndex: opts.accountIndex, rpId })
    expect(reg.verification.verified).toBe(true)

    const signChallenge = opts.signChallenge ?? Uint8Array.from({ length: 32 }, (_, i) => (i * 3 + 9) & 0xff)
    const signOrigin = opts.signOrigin ?? reg.origin
    const clientDataJSON = buildClientDataJSON('webauthn.get', signChallenge, signOrigin)

    const assertion = buildAssertion({
      root: reg.root,
      rpId,
      credentialId: reg.att.credentialId,
      clientDataHash: sha256hex(clientDataJSON),
    })

    const signature = assertion.signature.slice()
    if (opts.corruptSignature) signature[signature.length - 1] ^= 0x01

    return verifyAuthenticationResponse({
      response: {
        id: base64url(reg.att.credentialId),
        rawId: base64url(reg.att.credentialId),
        response: {
          clientDataJSON: base64url(clientDataJSON),
          authenticatorData: base64url(assertion.authenticatorData),
          signature: base64url(signature),
        },
        clientExtensionResults: {},
        type: 'public-key',
      },
      expectedChallenge: base64url(opts.verifyChallenge ?? signChallenge),
      expectedOrigin: opts.verifyOrigin ?? reg.origin,
      expectedRPID: rpId,
      credential: {
        id: base64url(reg.att.credentialId),
        publicKey: reg.att.publicKeyCose,
        counter: 0,
      },
    })
  }

  it('verifies a sign-in against the registered public key', async () => {
    const result = await assertAndVerify()
    expect(result.verified).toBe(true)
    expect(result.authenticationInfo.newCounter).toBe(0)
    expect(result.authenticationInfo.userVerified).toBe(true)
    expect(result.authenticationInfo.rpID).toBe(RP_ID)
  })

  // The DER encoder is the likeliest place to hide a length bug that only shows
  // up when r or s has a leading zero / high bit, so sign enough times to hit
  // both branches rather than trusting one lucky vector.
  it('verifies across many distinct credentials (exercises DER edge cases)', async () => {
    for (let i = 0; i < 25; i++) {
      const result = await assertAndVerify({
        rpId: `site-${i}.example`,
        signChallenge: Uint8Array.from({ length: 32 }, (_, j) => (i * 31 + j * 7) & 0xff),
      })
      expect(result.verified, `iteration ${i}`).toBe(true)
    }
  }, 30_000)

  it('verifies for a 24-word wallet and a non-zero account index', async () => {
    const twentyFour = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
    const result = await assertAndVerify({ mnemonic: twentyFour, accountIndex: 3 })
    expect(result.verified).toBe(true)
  })

  // simplewebauthn throws for a bad challenge/origin but returns verified:false
  // for a signature that simply does not check out — assert the latter shape.
  it('does not verify when the signature is corrupted', async () => {
    const result = await assertAndVerify({ corruptSignature: true })
    expect(result.verified).toBe(false)
  })

  it('is rejected when the challenge does not match', async () => {
    await expect(assertAndVerify({
      verifyChallenge: Uint8Array.from({ length: 32 }, () => 0xaa),
    })).rejects.toThrow()
  })

  it('is rejected when the origin does not match', async () => {
    await expect(assertAndVerify({ signOrigin: 'https://phish.example' })).rejects.toThrow()
  })

  // The whole point of the wallet: the words alone rebuild the key. Nothing is
  // read back from a store here — the second root is derived from scratch.
  it('a credential registered on one device signs in from the seed alone', async () => {
    const rpId = 'recovery.example'
    const challenge = Uint8Array.from({ length: 32 }, (_, i) => (i * 5) & 0xff)
    const n = nonce(9)

    // "Device A" registers.
    const rootA = await deriveWebauthnRoot(FOUNDRY, 0)
    const att = buildAttestationObject({ root: rootA, rpId, nonce: n })

    // "Device B" holds only the words and the credentialId the RP sends back.
    const rootB = await deriveWebauthnRoot(FOUNDRY, 0)
    const clientDataJSON = buildClientDataJSON('webauthn.get', challenge, `https://${rpId}`)
    const assertion = buildAssertion({
      root: rootB,
      rpId,
      credentialId: att.credentialId,
      clientDataHash: sha256hex(clientDataJSON),
    })

    const result = await verifyAuthenticationResponse({
      response: {
        id: base64url(att.credentialId),
        rawId: base64url(att.credentialId),
        response: {
          clientDataJSON: base64url(clientDataJSON),
          authenticatorData: base64url(assertion.authenticatorData),
          signature: base64url(assertion.signature),
        },
        clientExtensionResults: {},
        type: 'public-key',
      },
      expectedChallenge: base64url(challenge),
      expectedOrigin: `https://${rpId}`,
      expectedRPID: rpId,
      credential: { id: base64url(att.credentialId), publicKey: att.publicKeyCose, counter: 0 },
    })
    expect(result.verified).toBe(true)
  })
})

// ─── Determinism ────────────────────────────────────────────────────────────

describe('determinism', () => {
  it('same mnemonic + rpId + nonce ⇒ byte-identical credential', async () => {
    const n = nonce(13)
    const r1 = await deriveWebauthnRoot(FOUNDRY, 0)
    const r2 = await deriveWebauthnRoot(FOUNDRY, 0)
    expect(toHex(r1)).toBe(toHex(r2))

    const a = buildAttestationObject({ root: r1, rpId: RP_ID, nonce: n })
    const b = buildAttestationObject({ root: r2, rpId: RP_ID, nonce: n })
    expect(toHex(a.credentialId)).toBe(toHex(b.credentialId))
    expect(toHex(a.publicKey)).toBe(toHex(b.publicKey))
    expect(toHex(a.attestationObject)).toBe(toHex(b.attestationObject))
  })

  it('signs deterministically (RFC 6979) — same inputs, same signature bytes', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const credentialId = makeCredentialId(root, RP_ID, nonce(13))
    const clientDataHash = sha256hex(new TextEncoder().encode('same-input'))
    const s1 = buildAssertion({ root, rpId: RP_ID, credentialId, clientDataHash })
    const s2 = buildAssertion({ root, rpId: RP_ID, credentialId, clientDataHash })
    expect(toHex(s1.signature)).toBe(toHex(s2.signature))
  })

  it('normalises to low-S so the encoding is canonical for the Java port', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const halfN = BigInt('0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8')
    for (let i = 0; i < 40; i++) {
      const rpId = `lows-${i}.example`
      const credentialId = makeCredentialId(root, rpId, nonce(i + 1))
      const { signature } = buildAssertion({
        root, rpId, credentialId,
        clientDataHash: sha256hex(new TextEncoder().encode(`lows-${i}`)),
      })
      // Walk the DER: 30 len 02 rlen r 02 slen s
      const rLen = signature[3]
      const sLen = signature[4 + rLen + 1]
      const s = signature.slice(4 + rLen + 2, 4 + rLen + 2 + sLen)
      const sInt = BigInt('0x' + toHex(s))
      expect(sInt <= halfN, `high-S at iteration ${i}`).toBe(true)
    }
  })

  it('a different mnemonic ⇒ a completely different credential', async () => {
    const n = nonce(13)
    const rootA = await deriveWebauthnRoot(FOUNDRY, 0)
    const rootB = await deriveWebauthnRoot(BIP39_ZERO, 0)
    expect(toHex(rootA)).not.toBe(toHex(rootB))

    const a = buildAttestationObject({ root: rootA, rpId: RP_ID, nonce: n })
    const b = buildAttestationObject({ root: rootB, rpId: RP_ID, nonce: n })
    expect(toHex(a.credentialId)).not.toBe(toHex(b.credentialId))
    expect(toHex(a.publicKey)).not.toBe(toHex(b.publicKey))
  })

  it('a different account index ⇒ a different passkey identity', async () => {
    const n = nonce(13)
    const r0 = await deriveWebauthnRoot(FOUNDRY, 0)
    const r1 = await deriveWebauthnRoot(FOUNDRY, 1)
    expect(toHex(r0)).not.toBe(toHex(r1))
    expect(toHex(makeCredentialId(r0, RP_ID, n))).not.toBe(toHex(makeCredentialId(r1, RP_ID, n)))
  })

  it('a different rpId or nonce ⇒ a different key', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const base = deriveCredentialKey(root, RP_ID, nonce(13))
    expect(toHex(deriveCredentialKey(root, 'example.com', nonce(13)).privateKey)).not.toBe(toHex(base.privateKey))
    expect(toHex(deriveCredentialKey(root, RP_ID, nonce(14)).privateKey)).not.toBe(toHex(base.privateKey))
  })

  it('normalises mnemonic whitespace and case, and rejects an invalid phrase', async () => {
    const canonical = await deriveWebauthnRoot(FOUNDRY, 0)
    const messy = await deriveWebauthnRoot(`  TEST   test test test test test test test test test test JUNK \n`, 0)
    expect(toHex(messy)).toBe(toHex(canonical))
    await expect(deriveWebauthnRoot('not actually a valid bip39 mnemonic phrase here')).rejects.toThrow()
    await expect(deriveWebauthnRoot(FOUNDRY, -1)).rejects.toThrow()
  })
})

// ─── Tamper: a bad credentialId must FAIL, never derive a different key ─────

describe('credentialId is MAC-verified', () => {
  it('round-trips a credential it minted', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const n = nonce(21)
    const id = makeCredentialId(root, RP_ID, n)
    expect(id.length).toBe(CRED_ID_LEN)
    expect(id[0]).toBe(CRED_ID_VERSION)
    expect(toHex(parseCredentialId(root, RP_ID, id).nonce)).toBe(toHex(n))
    expect(isOwnCredentialId(root, RP_ID, id)).toBe(true)
  })

  // Exhaustive: EVERY single-bit flip in a 33-byte id must be rejected. Silently
  // deriving some other key would sign with a key the RP has never seen.
  it('rejects every single-bit flip across the whole id', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const id = makeCredentialId(root, RP_ID, nonce(21))
    for (let byte = 0; byte < id.length; byte++) {
      for (let bit = 0; bit < 8; bit++) {
        const bad = id.slice()
        bad[byte] ^= 1 << bit
        expect(isOwnCredentialId(root, RP_ID, bad), `byte ${byte} bit ${bit}`).toBe(false)
        expect(() => parseCredentialId(root, RP_ID, bad)).toThrow()
        expect(() => buildAssertion({
          root, rpId: RP_ID, credentialId: bad, clientDataHash: new Uint8Array(32),
        })).toThrow()
      }
    }
  })

  it('rejects wrong lengths and unknown versions', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const id = makeCredentialId(root, RP_ID, nonce(21))
    for (const bad of [new Uint8Array(0), id.slice(0, -1), new Uint8Array([...id, 0]), new Uint8Array(CRED_ID_LEN)]) {
      expect(() => parseCredentialId(root, RP_ID, bad)).toThrow()
    }
  })

  it('rejects a credential minted for a different rpId', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const id = makeCredentialId(root, 'example.com', nonce(21))
    expect(isOwnCredentialId(root, 'example.com', id)).toBe(true)
    expect(isOwnCredentialId(root, RP_ID, id)).toBe(false)
  })

  it('rejects a credential minted by a different wallet or account', async () => {
    const mine = await deriveWebauthnRoot(FOUNDRY, 0)
    const other = await deriveWebauthnRoot(BIP39_ZERO, 0)
    const account1 = await deriveWebauthnRoot(FOUNDRY, 1)
    const theirId = makeCredentialId(other, RP_ID, nonce(21))
    const account1Id = makeCredentialId(account1, RP_ID, nonce(21))
    expect(isOwnCredentialId(mine, RP_ID, theirId)).toBe(false)
    expect(isOwnCredentialId(mine, RP_ID, account1Id)).toBe(false)
  })

  it('rejects a malformed root rather than deriving from short key material', async () => {
    expect(() => deriveCredentialMacKey(new Uint8Array(31))).toThrow()
    expect(() => makeCredentialId(new Uint8Array(16), RP_ID, nonce(1))).toThrow()
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    expect(() => makeCredentialId(root, RP_ID, new Uint8Array(15))).toThrow()
    expect(() => rpIdHash('')).toThrow()
  })

  it('rejects a clientDataHash that is not 32 bytes', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const credentialId = makeCredentialId(root, RP_ID, nonce(21))
    expect(() => buildAssertion({ root, rpId: RP_ID, credentialId, clientDataHash: new Uint8Array(31) })).toThrow()
  })
})

// ─── Structure: CBOR / COSE / authenticatorData ─────────────────────────────

describe('encoding primitives', () => {
  it('encodes CBOR heads at every width', () => {
    expect(toHex(cborInt(0))).toBe('00')
    expect(toHex(cborInt(23))).toBe('17')
    expect(toHex(cborInt(24))).toBe('1818')
    expect(toHex(cborInt(255))).toBe('18ff')
    expect(toHex(cborInt(256))).toBe('190100')
    expect(toHex(cborInt(65535))).toBe('19ffff')
    expect(toHex(cborInt(65536))).toBe('1a00010000')
    expect(toHex(cborInt(-1))).toBe('20')
    expect(toHex(cborInt(-7))).toBe('26')
    expect(toHex(cborInt(-24))).toBe('37')
    expect(toHex(cborInt(-25))).toBe('3818')
    expect(toHex(cborBytes(new Uint8Array(0)))).toBe('40')
    expect(toHex(cborBytes(Uint8Array.from([1, 2])))).toBe('420102')
    expect(toHex(cborBytes(new Uint8Array(32)))).toBe('5820' + '00'.repeat(32))
    expect(toHex(cborText(''))).toBe('60')
    expect(toHex(cborText('fmt'))).toBe('63666d74')
    expect(toHex(cborMap([]))).toBe('a0')
    expect(toHex(cborMap([[cborInt(1), cborInt(2)]]))).toBe('a10102')
  })

  // a5 | 01 02 | 03 26 | 20 01 | 21 5820 x | 22 5820 y
  // (CTAP2 canonical order: labels 1, 3, -1, -2, -3 sort bytewise as
  //  0x01 < 0x03 < 0x20 < 0x21 < 0x22)
  it('lays out the COSE EC2 P-256 key exactly as WebAuthn requires', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const key = deriveCredentialKey(root, RP_ID, nonce(3))
    const cose = coseKeyFromPublicKey(key.publicKey)
    expect(cose.length).toBe(77)
    expect(toHex(cose.slice(0, 7))).toBe('a5010203262001')
    expect(toHex(cose.slice(7, 9))).toBe('2158')
    expect(cose[9]).toBe(0x20)
    expect(toHex(cose.slice(10, 42))).toBe(toHex(key.x))
    expect(toHex(cose.slice(42, 44))).toBe('2258')
    expect(cose[44]).toBe(0x20)
    expect(toHex(cose.slice(45, 77))).toBe(toHex(key.y))
    expect(() => coseKeyFromPublicKey(new Uint8Array(64))).toThrow()
  })

  it('lays out authenticatorData exactly as WebAuthn requires', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const att = buildAttestationObject({ root, rpId: RP_ID, nonce: nonce(3) })
    const d = att.authData

    expect(toHex(d.slice(0, 32))).toBe(toHex(rpIdHash(RP_ID)))
    expect(d[32]).toBe(FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS | FLAG_AT) // 0x5d
    expect(toHex(d.slice(33, 37))).toBe('00000000')
    expect(toHex(d.slice(37, 53))).toBe(toHex(MAGICMONEY_AAGUID))
    expect((d[53] << 8) | d[54]).toBe(CRED_ID_LEN)
    expect(toHex(d.slice(55, 55 + CRED_ID_LEN))).toBe(toHex(att.credentialId))
    expect(toHex(d.slice(55 + CRED_ID_LEN))).toBe(toHex(att.publicKeyCose))
    expect(d.length).toBe(37 + 16 + 2 + CRED_ID_LEN + 77)
  })

  it('omits attested credential data (and the AT flag) from assertions', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const credentialId = makeCredentialId(root, RP_ID, nonce(3))
    const { authenticatorData } = buildAssertion({
      root, rpId: RP_ID, credentialId, clientDataHash: new Uint8Array(32),
    })
    expect(authenticatorData.length).toBe(37)
    expect(authenticatorData[32]).toBe(FLAG_UP | FLAG_UV | FLAG_BE | FLAG_BS) // 0x1d
    expect(authenticatorData[32] & FLAG_AT).toBe(0)
  })

  it('reflects userPresent / userVerified in the flags', () => {
    const on = buildAuthenticatorData({ rpId: RP_ID })
    const off = buildAuthenticatorData({ rpId: RP_ID, userPresent: false, userVerified: false })
    expect(on[32] & FLAG_UP).toBe(FLAG_UP)
    expect(on[32] & FLAG_UV).toBe(FLAG_UV)
    expect(off[32] & FLAG_UP).toBe(0)
    expect(off[32] & FLAG_UV).toBe(0)
    expect(off[32] & (FLAG_BE | FLAG_BS)).toBe(FLAG_BE | FLAG_BS)
  })

  it('wraps the attestation object as {fmt:"none", attStmt:{}, authData}', async () => {
    const root = await deriveWebauthnRoot(FOUNDRY, 0)
    const att = buildAttestationObject({ root, rpId: RP_ID, nonce: nonce(3) })
    // a3 | 63"fmt" 64"none" | 67"attStmt" a0 | 68"authData" 58<len>
    const prefix = 'a3' + '63666d74' + '646e6f6e65' + '6761747453746d74' + 'a0' + '686175746844617461'
    expect(toHex(att.attestationObject.slice(0, 28))).toBe(prefix)
    expect(att.attestationObject[28]).toBe(0x58)
    expect(att.attestationObject[29]).toBe(att.authData.length)
    expect(toHex(att.attestationObject.slice(30))).toBe(toHex(att.authData))
  })

  it('round-trips hex and base64url', () => {
    const bytes = Uint8Array.from({ length: 40 }, (_, i) => (i * 251) & 0xff)
    expect(toHex(fromHex(toHex(bytes)))).toBe(toHex(bytes))
    expect(toHex(fromBase64url(base64url(bytes)))).toBe(toHex(bytes))
    expect(base64url(Uint8Array.from([0xfb, 0xff]))).toBe('-_8')
    expect(() => fromHex('abc')).toThrow()
  })
})

// ─── The cross-language contract ────────────────────────────────────────────

describe('webauthn-vectors.json (the Java port contract)', () => {
  interface Vector {
    label: string; mnemonic: string; accountIndex: number; rpId: string; nonce: string
    webauthnRoot: string; macKey: string; rpIdHash: string; scalarCounter: number
    privateKey: string; publicKeyUncompressed: string; publicKeyX: string; publicKeyY: string
    coseKey: string; credentialId: string; credentialIdBase64url: string
    registration: { authData: string; attestationObject: string }
    assertion: { clientDataHashSource: string; clientDataHash: string; authenticatorData: string; signatureDer: string }
  }
  const fixture = fileURLToPath(new URL('./__fixtures__/webauthn-vectors.json', import.meta.url))
  const doc = JSON.parse(readFileSync(fixture, 'utf8')) as {
    spec: Record<string, unknown>
    vectors: Vector[]
    tamper: { rpId: string; mnemonic: string; accountIndex: number; mustReject: Array<{ why: string; credentialId: string }> }
  }

  it('has the vectors it claims to have', () => {
    expect(doc.vectors.length).toBeGreaterThanOrEqual(5)
    expect(doc.spec.version).toBe('v1')
    expect(doc.spec.aaguid).toBe(toHex(MAGICMONEY_AAGUID))
  })

  // If this fails, the derivation spec has moved and the Android provider (which
  // asserts the same file in Java) will no longer open passkeys this build makes.
  it.each([0, 1, 2, 3, 4])('reproduces vector %i byte-for-byte', async (i) => {
    const v = doc.vectors[i]
    const root = await deriveWebauthnRoot(v.mnemonic, v.accountIndex)
    expect(toHex(root), `${v.label}: webauthnRoot`).toBe(v.webauthnRoot)
    expect(toHex(deriveCredentialMacKey(root)), `${v.label}: macKey`).toBe(v.macKey)
    expect(toHex(rpIdHash(v.rpId)), `${v.label}: rpIdHash`).toBe(v.rpIdHash)

    const n = fromHex(v.nonce)
    const key = deriveCredentialKey(root, v.rpId, n)
    expect(key.counter, `${v.label}: scalarCounter`).toBe(v.scalarCounter)
    expect(toHex(key.privateKey), `${v.label}: privateKey`).toBe(v.privateKey)
    expect(toHex(key.publicKey), `${v.label}: publicKey`).toBe(v.publicKeyUncompressed)
    expect(toHex(key.x), `${v.label}: x`).toBe(v.publicKeyX)
    expect(toHex(key.y), `${v.label}: y`).toBe(v.publicKeyY)
    expect(toHex(coseKeyFromPublicKey(key.publicKey)), `${v.label}: coseKey`).toBe(v.coseKey)

    const credentialId = makeCredentialId(root, v.rpId, n)
    expect(toHex(credentialId), `${v.label}: credentialId`).toBe(v.credentialId)
    expect(base64url(credentialId), `${v.label}: credentialId b64u`).toBe(v.credentialIdBase64url)

    const att = buildAttestationObject({ root, rpId: v.rpId, nonce: n })
    expect(toHex(att.authData), `${v.label}: authData`).toBe(v.registration.authData)
    expect(toHex(att.attestationObject), `${v.label}: attestationObject`).toBe(v.registration.attestationObject)

    const clientDataHash = fromHex(v.assertion.clientDataHash)
    expect(toHex(sha256hex(new TextEncoder().encode(v.assertion.clientDataHashSource)))).toBe(v.assertion.clientDataHash)
    const assertion = buildAssertion({ root, rpId: v.rpId, credentialId, clientDataHash })
    expect(toHex(assertion.authenticatorData), `${v.label}: authenticatorData`).toBe(v.assertion.authenticatorData)
    expect(toHex(assertion.signature), `${v.label}: signature`).toBe(v.assertion.signatureDer)
  })

  it('rejects every tamper case in the fixture', async () => {
    const t = doc.tamper
    const root = await deriveWebauthnRoot(t.mnemonic, t.accountIndex)
    for (const c of t.mustReject) {
      expect(isOwnCredentialId(root, t.rpId, fromHex(c.credentialId)), c.why).toBe(false)
    }
  })

  it('every fixture credential still verifies against @simplewebauthn/server', async () => {
    for (const v of doc.vectors) {
      const challenge = Uint8Array.from({ length: 32 }, (_, i) => (i + v.rpId.length) & 0xff)
      const origin = `https://${v.rpId}`
      const result = await verifyRegistrationResponse({
        response: {
          id: v.credentialIdBase64url,
          rawId: v.credentialIdBase64url,
          response: {
            clientDataJSON: base64url(buildClientDataJSON('webauthn.create', challenge, origin)),
            attestationObject: base64url(fromHex(v.registration.attestationObject)),
          },
          clientExtensionResults: {},
          type: 'public-key',
        },
        expectedChallenge: base64url(challenge),
        expectedOrigin: origin,
        expectedRPID: v.rpId,
      })
      expect(result.verified, v.label).toBe(true)
    }
  })
})
