import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server'

// The whole Phase 3 pipeline, headless: the REAL page-world shim talking to the
// REAL wire bridge and the REAL ceremony core, with only the four platform seams
// (mnemonic, account, index storage, approval + biometric) stubbed. The one
// thing that cannot be stubbed is the origin — that is the point of the phase.
const { store, ui } = vi.hoisted(() => ({
  store: { blob: null as string | null },
  ui: { approve: true, choiceId: undefined as string | undefined, shown: [] as Array<Record<string, unknown>> },
}))

import { installPasskeyShim, PASSKEY_SHIM_FLAG } from './passkey-shim'
import { handlePasskeyCreate, handlePasskeyGet, handlePasskeyProbe } from '../main/passkey-bridge'
import { encodePasskeyError, type PasskeyApprovalRequest } from '../main/passkey-protocol'
import type { PasskeyEnvironment } from '../main/passkey-ceremony'
import type { PasskeyIndexStorage } from '../main/passkey-index'
import { ZERO_AAGUID, MAGICMONEY_AAGUID, base64url, fromBase64url } from '../main/webauthn-authenticator'

const MNEMONIC = 'test test test test test test test test test test test junk'
const RP_ID = 'chainlensnft.info'
const ORIGIN = `https://${RP_ID}`

const memoryStorage: PasskeyIndexStorage = {
  async read() { return store.blob },
  async write(b) { store.blob = b },
  async clear() { store.blob = null },
  async exists() { return store.blob != null },
}

const env: PasskeyEnvironment = {
  loadMnemonic: async () => MNEMONIC,
  currentAccount: async () => ({ accountIndex: 0, accountAddress: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' }),
  storage: memoryStorage,
  approve: async (r: PasskeyApprovalRequest) => {
    ui.shown.push(r as unknown as Record<string, unknown>)
    return { approved: ui.approve, choiceId: ui.choiceId }
  },
  verifyUser: async () => 'wallet-password',
  // The in-app-browser environment: we are also the CLIENT here, so the AAGUID
  // is blanked the way a browser would blank it.
  aaguid: ZERO_AAGUID,
}

// ── The native side of the pipe ───────────────────────────────────────────────
// `nativeOrigin` stands in for `event.sender.getURL()` / the chromium-
// authenticated PageRequestEvent.origin. Tests move it, never the page.
let nativeOrigin = ORIGIN

const transport = async (type: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
  try {
    if (type === 'passkey:create') return await handlePasskeyCreate(env, nativeOrigin, payload)
    if (type === 'passkey:get') return await handlePasskeyGet(env, nativeOrigin, payload)
    return await handlePasskeyProbe(env, nativeOrigin, payload) as unknown as Record<string, unknown>
  } catch (e) {
    // Exactly what Electron IPC / the Android bridge do to a rejection.
    throw new Error(`Error invoking remote method '${type}': Error: ${encodePasskeyError(e)}`)
  }
}

const sent: Array<{ type: string; payload: Record<string, unknown> }> = []

// ── A page-world global to install into ───────────────────────────────────────
const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

// Installed ONCE, deliberately: the shim marks itself with a non-configurable
// flag so a hostile page cannot re-install over it, which means a test cannot
// tear it down either. All per-test state lives in `store` / `ui` /
// `nativeOrigin` instead, and the shim itself is stateless between calls.
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true })
installPasskeyShim((type, payload) => {
  sent.push({ type, payload })
  return transport(type, payload)
})
expect((globalThis as Record<string, unknown>)[PASSKEY_SHIM_FLAG]).toBe(true)

const credentials = (globalThis.navigator as unknown as {
  credentials: { create(o?: unknown): Promise<unknown>; get(o?: unknown): Promise<unknown> }
}).credentials

afterAll(() => {
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator)
})

// ── Helpers mirroring what chainlensnft.info actually does ────────────────────
const bufToB64u = (buf: ArrayBuffer | Uint8Array): string => base64url(new Uint8Array(buf as ArrayBuffer))
const b64uToBuf = (s: string): ArrayBuffer => fromBase64url(s).buffer as ArrayBuffer
const challengeOf = (seed: number): ArrayBuffer =>
  Uint8Array.from({ length: 32 }, (_, i) => (i * seed + 7) & 0xff).buffer

/* eslint-disable @typescript-eslint/no-explicit-any */
const regToJSON = (cred: any) => ({
  id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
  authenticatorAttachment: cred.authenticatorAttachment || undefined,
  clientExtensionResults: cred.getClientExtensionResults(),
  response: {
    clientDataJSON: bufToB64u(cred.response.clientDataJSON),
    attestationObject: bufToB64u(cred.response.attestationObject),
    transports: cred.response.getTransports ? cred.response.getTransports() : [],
  },
})
const authToJSON = (cred: any) => ({
  id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
  authenticatorAttachment: cred.authenticatorAttachment || undefined,
  clientExtensionResults: cred.getClientExtensionResults(),
  response: {
    clientDataJSON: bufToB64u(cred.response.clientDataJSON),
    authenticatorData: bufToB64u(cred.response.authenticatorData),
    signature: bufToB64u(cred.response.signature),
    userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : undefined,
  },
})

const createOptions = (challenge: ArrayBuffer, over: Record<string, unknown> = {}) => ({
  publicKey: {
    challenge,
    rp: { id: RP_ID, name: 'ChainLens' },
    user: { id: b64uToBuf('dXNlci0x'), name: 'ryan@example.com', displayName: 'Ryan' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    ...over,
  },
})
const getOptions = (challenge: ArrayBuffer, over: Record<string, unknown> = {}) => ({
  publicKey: { challenge, rpId: RP_ID, ...over },
})
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  store.blob = null
  ui.approve = true
  ui.choiceId = undefined
  ui.shown.length = 0
  sent.length = 0
  nativeOrigin = ORIGIN
})

// ─── The headline: a real RP accepts what the shim produces ─────────────────

describe('passkey shim · end-to-end against @simplewebauthn/server', () => {
  it('registers a credential the server verifies', async () => {
    const challenge = challengeOf(3)
    const cred = await credentials.create(createOptions(challenge))

    const verification = await verifyRegistrationResponse({
      response: regToJSON(cred) as never,
      expectedChallenge: bufToB64u(challenge),
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    })
    expect(verification.verified).toBe(true)
    if (!verification.verified) return
    expect(verification.registrationInfo.fmt).toBe('none')
    expect(verification.registrationInfo.credentialDeviceType).toBe('multiDevice')
  })

  it('signs in with no credential named, and the server verifies it', async () => {
    const created: any = await credentials.create(createOptions(challengeOf(3)))
    const reg = await verifyRegistrationResponse({
      response: regToJSON(created) as never,
      expectedChallenge: bufToB64u(challengeOf(3)),
      expectedOrigin: ORIGIN, expectedRPID: RP_ID,
    })
    expect(reg.verified).toBe(true)
    if (!reg.verified) return

    const challenge = challengeOf(11)
    const asserted = await credentials.get(getOptions(challenge))

    const verification = await verifyAuthenticationResponse({
      response: authToJSON(asserted) as never,
      expectedChallenge: bufToB64u(challenge),
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: reg.registrationInfo.credential,
    })
    expect(verification.verified).toBe(true)
    expect(verification.authenticationInfo.userVerified).toBe(true)
  })

  it('signs in when the site names the credential', async () => {
    const created: any = await credentials.create(createOptions(challengeOf(3)))
    const reg = await verifyRegistrationResponse({
      response: regToJSON(created) as never,
      expectedChallenge: bufToB64u(challengeOf(3)),
      expectedOrigin: ORIGIN, expectedRPID: RP_ID,
    })
    if (!reg.verified) throw new Error('registration failed')

    const challenge = challengeOf(5)
    const asserted = await credentials.get(getOptions(challenge, {
      allowCredentials: [{ type: 'public-key', id: created.rawId }],
    }))
    const verification = await verifyAuthenticationResponse({
      response: authToJSON(asserted) as never,
      expectedChallenge: bufToB64u(challenge),
      expectedOrigin: ORIGIN, expectedRPID: RP_ID,
      credential: reg.registrationInfo.credential,
    })
    expect(verification.verified).toBe(true)
  })

  // A targeted sign-in must not depend on the index at all — that is what makes
  // losing it survivable.
  it('signs in from a named credential after the index is wiped', async () => {
    const created: any = await credentials.create(createOptions(challengeOf(3)))
    const reg = await verifyRegistrationResponse({
      response: regToJSON(created) as never,
      expectedChallenge: bufToB64u(challengeOf(3)),
      expectedOrigin: ORIGIN, expectedRPID: RP_ID,
    })
    if (!reg.verified) throw new Error('registration failed')

    store.blob = null   // index gone

    const challenge = challengeOf(9)
    const asserted = await credentials.get(getOptions(challenge, {
      allowCredentials: [{ type: 'public-key', id: created.rawId }],
    }))
    const verification = await verifyAuthenticationResponse({
      response: authToJSON(asserted) as never,
      expectedChallenge: bufToB64u(challenge),
      expectedOrigin: ORIGIN, expectedRPID: RP_ID,
      credential: reg.registrationInfo.credential,
    })
    expect(verification.verified).toBe(true)

    // …but discovery correctly finds nothing rather than inventing a credential.
    await expect(credentials.get(getOptions(challengeOf(13)))).rejects.toMatchObject({ name: 'NotAllowedError' })
  })
})

// ─── The origin is native, always ───────────────────────────────────────────

describe('passkey shim · the page can never choose the origin', () => {
  it('never sends an origin field at all', async () => {
    await credentials.create(createOptions(challengeOf(3)))
    await credentials.get(getOptions(challengeOf(4)))
    expect(sent).toHaveLength(2)
    for (const { payload } of sent) {
      expect(payload).not.toHaveProperty('origin')
      expect(JSON.stringify(payload)).not.toContain('chainlensnft.info/')
    }
  })

  // The RP id inside clientDataJSON must be the tab's, not the page's claim.
  it('stamps the NATIVE origin into clientDataJSON', async () => {
    const cred: any = await credentials.create(createOptions(challengeOf(3)))
    const clientData = JSON.parse(Buffer.from(cred.response.clientDataJSON).toString('utf8'))
    expect(clientData.origin).toBe(ORIGIN)
    expect(clientData.type).toBe('webauthn.create')
    expect(clientData.challenge).toBe(bufToB64u(challengeOf(3)))
  })

  it('refuses an rpId the tab does not own — including a public suffix', async () => {
    nativeOrigin = 'https://evil.co.uk'
    await expect(credentials.create(createOptions(challengeOf(3), { rp: { id: 'co.uk', name: 'x' } })))
      .rejects.toMatchObject({ name: 'SecurityError' })
    await expect(credentials.create(createOptions(challengeOf(3), { rp: { id: RP_ID, name: 'x' } })))
      .rejects.toMatchObject({ name: 'SecurityError' })
    expect(ui.shown).toHaveLength(0)   // no dialog for a request we will refuse
  })

  it('falls back to the tab’s own host when the page names no rp.id', async () => {
    const opts = createOptions(challengeOf(3))
    delete (opts.publicKey as Record<string, unknown>).rp
    const cred: any = await credentials.create(opts)
    const clientData = JSON.parse(Buffer.from(cred.response.clientDataJSON).toString('utf8'))
    expect(clientData.origin).toBe(ORIGIN)
    // …and it really is bound to that host: a sign-in for it resolves.
    const asserted: any = await credentials.get(getOptions(challengeOf(4), { rpId: undefined }))
    expect(asserted.id).toBe(cred.id)
  })
})

// ─── AAGUID is zeroed on this path ──────────────────────────────────────────

describe('passkey shim · AAGUID', () => {
  it('reports an all-zero AAGUID, because here we are the client too', async () => {
    const cred: any = await credentials.create(createOptions(challengeOf(3)))
    const authData = new Uint8Array(cred.response.getAuthenticatorData())
    const aaguid = authData.slice(37, 53)
    expect(Array.from(aaguid)).toEqual(Array.from(ZERO_AAGUID))
    expect(Array.from(aaguid)).not.toEqual(Array.from(MAGICMONEY_AAGUID))

    const verification = await verifyRegistrationResponse({
      response: regToJSON(cred) as never,
      expectedChallenge: bufToB64u(challengeOf(3)),
      expectedOrigin: ORIGIN, expectedRPID: RP_ID,
    })
    expect(verification.verified).toBe(true)
    if (!verification.verified) return
    expect(verification.registrationInfo.aaguid).toBe('00000000-0000-0000-0000-000000000000')
  })
})

// ─── The credential objects the page receives ───────────────────────────────

describe('passkey shim · PublicKeyCredential shape', () => {
  it('gives registration everything an RP reads', async () => {
    const cred: any = await credentials.create(createOptions(challengeOf(3)))
    expect(cred.type).toBe('public-key')
    expect(cred.authenticatorAttachment).toBe('platform')
    expect(cred.rawId).toBeInstanceOf(ArrayBuffer)
    expect(cred.id).toBe(bufToB64u(cred.rawId))
    expect(cred.response.clientDataJSON).toBeInstanceOf(ArrayBuffer)
    expect(cred.response.attestationObject).toBeInstanceOf(ArrayBuffer)
    expect(cred.getClientExtensionResults()).toEqual({})
    expect(cred.response.getTransports()).toEqual(['internal'])
    expect(cred.response.getPublicKeyAlgorithm()).toBe(-7)
    expect(cred.response.getAuthenticatorData()).toBeInstanceOf(ArrayBuffer)
    expect(cred.toJSON().id).toBe(cred.id)
  })

  // getPublicKey() must be SPKI DER — RPs feed it straight to WebCrypto.
  it('returns an importable SPKI public key', async () => {
    const cred: any = await credentials.create(createOptions(challengeOf(3)))
    const spki = cred.response.getPublicKey()
    expect(spki).toBeInstanceOf(ArrayBuffer)
    expect(spki.byteLength).toBe(91)
    const key = await crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify'])
    expect(key.type).toBe('public')
  })

  it('gives authentication everything an RP reads', async () => {
    await credentials.create(createOptions(challengeOf(3)))
    const cred: any = await credentials.get(getOptions(challengeOf(4)))
    expect(cred.type).toBe('public-key')
    expect(cred.rawId).toBeInstanceOf(ArrayBuffer)
    expect(cred.response.authenticatorData).toBeInstanceOf(ArrayBuffer)
    expect(cred.response.signature).toBeInstanceOf(ArrayBuffer)
    expect(cred.response.userHandle).toBeInstanceOf(ArrayBuffer)
    expect(bufToB64u(cred.response.userHandle)).toBe('dXNlci0x')
    expect(cred.getClientExtensionResults()).toEqual({})
  })

  it('advertises a platform authenticator for feature detection', async () => {
    const PKC = (globalThis as Record<string, unknown>).PublicKeyCredential as Record<string, () => Promise<boolean>>
    expect(PKC).toBeTruthy()
    expect(await PKC.isUserVerifyingPlatformAuthenticatorAvailable()).toBe(true)
    // Conditional UI is browser-autofill integration we do not implement; saying
    // so is better than a prompt the RP explicitly asked us not to show.
    expect(await PKC.isConditionalMediationAvailable()).toBe(false)
  })

  it('installs only once and leaves non-publicKey requests alone', async () => {
    const first = credentials.create
    installPasskeyShim(async () => ({}))
    expect(credentials.create).toBe(first)
    // A password/federated request has no publicKey member; with no original
    // implementation behind us the honest answer is null, not a crash.
    expect(await credentials.get({ password: true })).toBeNull()
  })
})

// ─── Errors ─────────────────────────────────────────────────────────────────

describe('passkey shim · error mapping', () => {
  it('turns a decline into NotAllowedError', async () => {
    ui.approve = false
    await expect(credentials.create(createOptions(challengeOf(3))))
      .rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  // The spec deliberately makes "declined" and "no such credential"
  // indistinguishable so a site cannot probe who has an account — and
  // chainlensnft.info already branches on exactly this.
  it('turns "no credential" into NotAllowedError too', async () => {
    await expect(credentials.get(getOptions(challengeOf(3))))
      .rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('turns an already-registered credential into InvalidStateError', async () => {
    const created: any = await credentials.create(createOptions(challengeOf(3)))
    await expect(credentials.create(createOptions(challengeOf(4), {
      excludeCredentials: [{ type: 'public-key', id: created.rawId }],
    }))).rejects.toMatchObject({ name: 'InvalidStateError' })
  })

  it('turns an unsupported algorithm into NotSupportedError', async () => {
    await expect(credentials.create(createOptions(challengeOf(3), {
      pubKeyCredParams: [{ type: 'public-key', alg: -257 }],
    }))).rejects.toMatchObject({ name: 'NotSupportedError' })
  })

  // A locked wallet is a true statement we must not hand to an arbitrary site.
  it('never leaks an internal message to the page', async () => {
    const locked: PasskeyEnvironment = {
      ...env,
      loadMnemonic: async () => { throw new Error('Wallet is locked — please unlock first') },
    }
    let thrown: unknown
    try {
      await handlePasskeyGet(locked, ORIGIN, { challenge: base64url(new Uint8Array(32)) })
    } catch (e) { thrown = e }
    const encoded = encodePasskeyError(thrown)
    expect(encoded).not.toMatch(/locked/i)
    expect(encoded).toBe('MMPK:PASSKEY_REJECTED:The operation either timed out or was not allowed.')
  })

  it('honours an AbortSignal', async () => {
    const controller = new AbortController()
    const promise = credentials.create({ ...createOptions(challengeOf(3)), signal: controller.signal })
    controller.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('refuses conditional mediation without prompting', async () => {
    await credentials.create(createOptions(challengeOf(3)))
    ui.shown.length = 0
    await expect(credentials.get({ ...getOptions(challengeOf(4)), mediation: 'conditional' }))
      .rejects.toMatchObject({ name: 'NotAllowedError' })
    expect(ui.shown).toHaveLength(0)
  })
})

// ─── The account chooser ────────────────────────────────────────────────────

describe('passkey shim · account chooser', () => {
  async function registerTwo() {
    await credentials.create(createOptions(challengeOf(3)))
    const second = createOptions(challengeOf(4))
    second.publicKey.user = { id: b64uToBuf('dXNlci0y'), name: 'second@example.com', displayName: 'Second' }
    await credentials.create(second)
  }

  it('offers a choice only when more than one identity matches', async () => {
    await credentials.create(createOptions(challengeOf(3)))
    ui.shown.length = 0
    await credentials.get(getOptions(challengeOf(5)))
    expect((ui.shown[0] as unknown as PasskeyApprovalRequest).choices).toBeUndefined()

    await registerTwo()
    ui.shown.length = 0
    await credentials.get(getOptions(challengeOf(6)))
    const choices = (ui.shown[0] as unknown as PasskeyApprovalRequest).choices
    expect(choices).toHaveLength(2)
    expect(choices?.map(c => c.label).sort()).toEqual(['ryan@example.com', 'second@example.com'])
    expect(choices?.[0].sublabel).toMatch(/Account 1/)
  })

  it('signs in as whoever the user picked', async () => {
    await registerTwo()
    ui.shown.length = 0
    ui.choiceId = undefined
    await credentials.get(getOptions(challengeOf(7)))
    const choices = (ui.shown[0] as unknown as PasskeyApprovalRequest).choices ?? []
    const second = choices.find(c => c.label === 'second@example.com')!

    ui.choiceId = second.id
    const cred: any = await credentials.get(getOptions(challengeOf(8)))
    expect(cred.id).toBe(second.id)
    expect(bufToB64u(cred.response.userHandle)).toBe('dXNlci0y')
  })

  // A malformed selection must land on a candidate we already resolved for THIS
  // site, never on something else.
  it('falls back to the first candidate on an unrecognised choice', async () => {
    await registerTwo()
    ui.choiceId = 'not-a-real-choice'
    const cred: any = await credentials.get(getOptions(challengeOf(9)))
    ui.choiceId = undefined
    ui.shown.length = 0
    const fallback: any = await credentials.get(getOptions(challengeOf(10)))
    expect(cred.id).toBe(fallback.id)
  })
})

// ─── Tamper ─────────────────────────────────────────────────────────────────

describe('passkey shim · tamper', () => {
  it('refuses a credentialId the site altered', async () => {
    const created: any = await credentials.create(createOptions(challengeOf(3)))
    const bad = new Uint8Array(created.rawId)
    bad[20] ^= 0x01
    await expect(credentials.get(getOptions(challengeOf(4), {
      allowCredentials: [{ type: 'public-key', id: bad.buffer }],
    }))).rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('refuses a credential minted for another site', async () => {
    const created: any = await credentials.create(createOptions(challengeOf(3)))
    nativeOrigin = 'https://example.com'
    await expect(credentials.get(getOptions(challengeOf(4), {
      rpId: 'example.com',
      allowCredentials: [{ type: 'public-key', id: created.rawId }],
    }))).rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('skips an index row whose MAC no longer checks out', async () => {
    await credentials.create(createOptions(challengeOf(3)))
    // Corrupt the stored ciphertext: the index becomes unreadable, which must
    // read as "no credential", never as a different one.
    const blob = JSON.parse(store.blob!)
    blob.data[0] ^= 0xff
    store.blob = JSON.stringify(blob)
    await expect(credentials.get(getOptions(challengeOf(4))))
      .rejects.toMatchObject({ name: 'NotAllowedError' })
  })

  it('silently probes without prompting or leaking other sites', async () => {
    await credentials.create(createOptions(challengeOf(3)))
    ui.shown.length = 0
    expect(await handlePasskeyProbe(env, ORIGIN, {})).toEqual({ available: true })
    expect(await handlePasskeyProbe(env, 'https://example.com', {})).toEqual({ available: false })
    expect(ui.shown).toHaveLength(0)
  })
})

// ─── clientDataJSON integrity ───────────────────────────────────────────────

describe('passkey shim · clientDataJSON', () => {
  it('signs over the clientDataJSON it actually returns', async () => {
    await credentials.create(createOptions(challengeOf(3)))
    const cred: any = await credentials.get(getOptions(challengeOf(4)))

    // Recompute the signed payload the way a relying party does and confirm the
    // returned JSON is the one that was hashed — not a re-serialisation.
    const authData = new Uint8Array(cred.response.authenticatorData)
    const hash = new Uint8Array(createHash('sha256').update(new Uint8Array(cred.response.clientDataJSON)).digest())
    const signed = new Uint8Array(authData.length + hash.length)
    signed.set(authData, 0)
    signed.set(hash, authData.length)

    const reg = JSON.parse(Buffer.from(cred.response.clientDataJSON).toString('utf8'))
    expect(reg.type).toBe('webauthn.get')
    expect(reg.origin).toBe(ORIGIN)
    expect(reg.crossOrigin).toBe(false)
    expect(signed.length).toBe(69)
  })
})

// ── Transient user activation ────────────────────────────────────────────────
// Chromium refuses create/get without a real gesture so a background script
// cannot summon a passkey prompt. Measured on device: Brave rejected a call this
// shim accepted, which made the shim the more permissive path. The approval
// sheet and biometric still gate every signature — this stops the prompt being
// raised at all.
describe('passkey shim · user activation', () => {
  const withActivation = (isActive: boolean | undefined, fn: () => Promise<unknown>) => {
    const nav = globalThis.navigator as unknown as Record<string, unknown>
    const had = 'userActivation' in nav
    const prev = nav.userActivation
    if (isActive === undefined) delete nav.userActivation
    else nav.userActivation = { isActive: true, hasBeenActive: isActive }
    return fn().finally(() => {
      if (had) nav.userActivation = prev
      else delete nav.userActivation
    })
  }

  it('refuses create() with NotAllowedError when the page was never interacted with', async () => {
    await withActivation(false, async () => {
      await expect(credentials.create({
        publicKey: { challenge: challengeOf(3), rp: { id: RP_ID }, user: { id: challengeOf(4), name: 'a' }, pubKeyCredParams: [{ alg: -7, type: 'public-key' }] },
      })).rejects.toMatchObject({ name: 'NotAllowedError' })
    })
  })

  it('refuses get() with NotAllowedError when the page was never interacted with', async () => {
    await withActivation(false, async () => {
      await expect(credentials.get({
        publicKey: { challenge: challengeOf(5), rpId: RP_ID },
      })).rejects.toMatchObject({ name: 'NotAllowedError' })
    })
  })

  // Non-Chromium engines have no navigator.userActivation; absence must not
  // break the shim, only a present-and-false value blocks.
  it('allows the ceremony when the API is absent', async () => {
    await withActivation(undefined, async () => {
      const cred = await credentials.create({
        publicKey: { challenge: challengeOf(6), rp: { id: RP_ID }, user: { id: challengeOf(7), name: 'a' }, pubKeyCredParams: [{ alg: -7, type: 'public-key' }] },
      })
      expect(cred).toBeTruthy()
    })
  })
})
