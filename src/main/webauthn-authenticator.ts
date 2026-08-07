/**
 * webauthn-authenticator.ts — MagicMoney Wallet
 *
 * The seed-derived WebAuthn authenticator core. Magic Money holds its own
 * passkeys instead of borrowing a password manager's, so a passkey is restored
 * by the same 12/24 words that restore funds.
 *
 * SECURITY CONTRACT:
 *   - Only `deriveWebauthnRoot` ever touches the mnemonic. Everything else takes
 *     `root` (32 bytes). That boundary is deliberate: the Android
 *     CredentialProviderService is a background service reachable by any app's
 *     sign-in prompt, and it is given `root` only — never the seed. A full
 *     compromise of the provider costs the user their logins, not their money.
 *   - Credentials are STATELESS. `credentialId` carries the nonce that derives
 *     the key, MAC'd so we can prove we minted it. Nothing to lose, nothing to
 *     sync. (The classic U2F key-wrapping trick.)
 *   - A credentialId that fails the MAC is REJECTED, never used to derive some
 *     other key. This is the failure mode that burned us on
 *     `mnemonicFromPasskeyBackup`.
 *
 * DERIVATION SPEC v1 — FROZEN. This is a cross-language contract: the Android
 * provider re-implements it in Java (Phase 4) and both must agree byte-for-byte.
 * `src/main/__fixtures__/webauthn-vectors.json` is the contract; regenerate it
 * with `node scripts/gen-webauthn-vectors.mjs` and expect the Java suite to fail
 * loudly if this file changes shape.
 *
 *   seed         = BIP-39 seed (the existing wallet seed)
 *   webauthnRoot = HKDF-SHA256(ikm=seed, salt="magicmoney/webauthn",
 *                              info="v1" | "v1/<accountIndex>", len=32)
 *   macKey       = HKDF-Expand(webauthnRoot, info="cred-id-mac", len=32)
 *
 *   per credential:
 *     nonce    = 16 random bytes (fresh at registration)
 *     rpIdHash = SHA-256(rpId)
 *     priv     = HKDF-Expand(webauthnRoot, info=rpIdHash||nonce||ctr, len=32)
 *                rejection-sampled into a valid P-256 scalar; ctr (1 byte, from
 *                0) increments on the vanishingly rare out-of-range draw
 *     credId   = 0x01 || nonce(16) || tag(16)
 *     tag      = HMAC-SHA256(macKey, rpIdHash||nonce)[0..15]
 *
 * Runs in the Electron main process and (via the same source) in the Capacitor
 * bundle. Pure computation — no Electron, no filesystem, no network.
 */

import * as bip39 from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { hkdf, expand as hkdfExpand } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { hmac } from '@noble/hashes/hmac'
// `@noble/curves/p256` is a deprecated re-export of this same object in
// curves 1.9+; import the live path so the module survives the next major.
import { p256 } from '@noble/curves/nist'

// ─── Spec constants (frozen — the Java port hardcodes these) ─────────────────

/** Derivation-spec version. Bump only with a new credentialId version byte. */
export const WEBAUTHN_SPEC_VERSION = 'v1'

/** HKDF salt separating the WebAuthn root from every other seed-derived key. */
const ROOT_SALT = 'magicmoney/webauthn'

/** HKDF info for the credential-id MAC key. */
const MAC_KEY_INFO = 'cred-id-mac'

/** credentialId format version. Byte 0 of every credentialId we mint. */
export const CRED_ID_VERSION = 0x01

const NONCE_LEN = 16
const TAG_LEN = 16
/** 0x01 || nonce(16) || tag(16) */
export const CRED_ID_LEN = 1 + NONCE_LEN + TAG_LEN

/**
 * Magic Money's AAGUID — a stable, self-assigned authenticator model id.
 * Reproducibly SHA-256("magicmoney/webauthn/aaguid/v1")[0..15] so the Java port
 * can be checked against a derivation rather than a copy-pasted constant.
 * = 2c4b3c62-a6fc-6b9f-47f2-4ede41f1b4bf
 */
export const MAGICMONEY_AAGUID = Uint8Array.from([
  0x2c, 0x4b, 0x3c, 0x62, 0xa6, 0xfc, 0x6b, 0x9f,
  0x47, 0xf2, 0x4e, 0xde, 0x41, 0xf1, 0xb4, 0xbf,
])

/** COSE alg identifier for ECDSA w/ SHA-256. The only algorithm we support. */
export const COSE_ALG_ES256 = -7

// authenticatorData flag bits (WebAuthn §6.1).
export const FLAG_UP = 0x01 // user present
export const FLAG_UV = 0x04 // user verified
export const FLAG_BE = 0x08 // backup eligible
export const FLAG_BS = 0x10 // backed up
export const FLAG_AT = 0x40 // attested credential data included
export const FLAG_ED = 0x80 // extension data included

/**
 * Signature counter. Fixed at 0 — standard for software authenticators, and it
 * tells relying parties not to attempt clone detection. Do not invent one: a
 * seed-derived credential legitimately lives on every device holding the seed,
 * so a rising counter would be a lie.
 */
export const SIGN_COUNT = 0

// ─── Small byte helpers ─────────────────────────────────────────────────────

/**
 * Byte strings this module allocates itself. The explicit `ArrayBuffer` matters:
 * WebCrypto and @simplewebauthn/server require ArrayBuffer-backed views, and a
 * bare `Uint8Array` widens to `Uint8Array<ArrayBufferLike>` under TS 5.7+.
 * Values handed back verbatim from @noble stay plain `Uint8Array` — they never
 * reach a Web API.
 */
type OwnedBytes = Uint8Array<ArrayBuffer>

const utf8 = (s: string): OwnedBytes => new TextEncoder().encode(s)

function concat(...parts: Uint8Array[]): OwnedBytes {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** Constant-time equality. Used for the credentialId MAC — never `===`. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function bytesToBigInt(b: Uint8Array): bigint {
  let n = 0n
  for (const byte of b) n = (n << 8n) | BigInt(byte)
  return n
}

function bigIntTo32Bytes(n: bigint): OwnedBytes {
  const out = new Uint8Array(32)
  for (let i = 31; i >= 0; i--) { out[i] = Number(n & 0xffn); n >>= 8n }
  return out
}

// ─── Minimal CBOR encoder ───────────────────────────────────────────────────
//
// WebAuthn needs exactly four CBOR types: unsigned ints, negative ints, byte
// strings and text strings, inside definite-length maps. That is ~50 lines, so
// we encode it here rather than take a dependency the Java port cannot share.
// Emission order is caller-controlled and every call site below is already in
// CTAP2 canonical order (keys sorted by encoded length, then bytewise).

function cborHead(major: number, value: number): OwnedBytes {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('CBOR: invalid head value')
  const mt = major << 5
  if (value < 24) return Uint8Array.from([mt | value])
  if (value < 0x100) return Uint8Array.from([mt | 24, value])
  if (value < 0x10000) return Uint8Array.from([mt | 25, value >> 8, value & 0xff])
  if (value < 0x100000000) {
    return Uint8Array.from([mt | 26, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff])
  }
  throw new Error('CBOR: value too large')
}

/** Major 0/1 — a signed integer, as WebAuthn's COSE labels use. */
export function cborInt(n: number): OwnedBytes {
  return n < 0 ? cborHead(1, -n - 1) : cborHead(0, n)
}

/** Major 2 — byte string. */
export function cborBytes(b: Uint8Array): OwnedBytes {
  return concat(cborHead(2, b.length), b)
}

/** Major 3 — UTF-8 text string. */
export function cborText(s: string): OwnedBytes {
  const b = utf8(s)
  return concat(cborHead(3, b.length), b)
}

/**
 * Major 5 — definite-length map. `entries` are pre-encoded key/value pairs and
 * are emitted in the order given; callers are responsible for canonical order.
 */
export function cborMap(entries: Array<[Uint8Array, Uint8Array]>): OwnedBytes {
  return concat(cborHead(5, entries.length), ...entries.flatMap(([k, v]) => [k, v]))
}

// ─── Root + credential-key derivation ───────────────────────────────────────

/**
 * The WebAuthn root for a wallet account. The ONLY function here that sees the
 * mnemonic — everything downstream takes the returned 32 bytes.
 *
 * `accountIndex` 0 is exactly the frozen v1 spec (info = "v1"); other accounts
 * append "/<n>" so each wallet account is a distinct passkey identity. Keep this
 * encoding identical in the Java port.
 */
export async function deriveWebauthnRoot(mnemonic: string, accountIndex = 0): Promise<Uint8Array> {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error('WebAuthn root derivation failed: invalid account index')
  }
  // Same normalisation as wallet-core's normalizeMnemonic — duplicated rather
  // than imported to keep this core free of wallet-core's chain dependencies
  // (it has to load in the Android provider's slice of the bundle).
  const cleaned = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!bip39.validateMnemonic(cleaned, wordlist)) {
    throw new Error('Invalid BIP-39 mnemonic phrase')
  }
  const seed = await bip39.mnemonicToSeed(cleaned)
  const info = accountIndex === 0 ? WEBAUTHN_SPEC_VERSION : `${WEBAUTHN_SPEC_VERSION}/${accountIndex}`
  return hkdf(sha256, seed, utf8(ROOT_SALT), utf8(info), 32)
}

function assertRoot(root: Uint8Array): void {
  if (!(root instanceof Uint8Array) || root.length !== 32) {
    throw new Error('WebAuthn root must be 32 bytes')
  }
}

/** HMAC key that authenticates credential ids. Never leaves this module. */
export function deriveCredentialMacKey(root: Uint8Array): Uint8Array {
  assertRoot(root)
  return hkdfExpand(sha256, root, utf8(MAC_KEY_INFO), 32)
}

/** SHA-256 of the RP ID — the identifier bound into both the key and the MAC. */
export function rpIdHash(rpId: string): Uint8Array {
  if (typeof rpId !== 'string' || rpId.length === 0) throw new Error('rpId must be a non-empty string')
  return sha256(utf8(rpId))
}

export interface CredentialKey {
  /** P-256 scalar, 32 bytes. */
  privateKey: OwnedBytes
  /** Uncompressed SEC1 point, 65 bytes (0x04 || x || y). */
  publicKey: Uint8Array
  /** Affine X, 32 bytes. */
  x: Uint8Array
  /** Affine Y, 32 bytes. */
  y: Uint8Array
  /** Rejection-sampling counter that produced this key (0 in practice). */
  counter: number
}

/**
 * The per-credential P-256 key. Deterministic in (root, rpId, nonce), so the
 * same seed regenerates it on any device with nothing stored anywhere.
 *
 * The scalar is rejection-sampled, NOT reduced mod n: reduction biases the low
 * end of the range, and rejection is trivially portable to Java. A draw lands
 * out of range with probability ~2^-32, so `counter` is 0 for every credential
 * anyone will ever create — it exists so the rare case is defined rather than
 * fatal.
 */
export function deriveCredentialKey(root: Uint8Array, rpId: string, nonce: Uint8Array): CredentialKey {
  assertRoot(root)
  if (nonce.length !== NONCE_LEN) throw new Error(`nonce must be ${NONCE_LEN} bytes`)
  const rpHash = rpIdHash(rpId)
  const n = p256.CURVE.n

  for (let counter = 0; counter <= 0xff; counter++) {
    const info = concat(rpHash, nonce, Uint8Array.from([counter]))
    const candidate = hkdfExpand(sha256, root, info, 32)
    const d = bytesToBigInt(candidate)
    if (d === 0n || d >= n) continue // out of range — bump ctr and redraw
    const privateKey = bigIntTo32Bytes(d)
    const publicKey = p256.getPublicKey(privateKey, false)
    return {
      privateKey,
      publicKey,
      x: publicKey.slice(1, 33),
      y: publicKey.slice(33, 65),
      counter,
    }
  }
  // Unreachable short of a broken HKDF: 256 consecutive rejections is ~2^-8192.
  throw new Error('Credential key derivation failed: scalar rejection limit reached')
}

// ─── Credential id (stateless, MAC-verified) ────────────────────────────────

function credentialTag(macKey: Uint8Array, rpHash: Uint8Array, nonce: Uint8Array): Uint8Array {
  return hmac(sha256, macKey, concat(rpHash, nonce)).slice(0, TAG_LEN)
}

/** `0x01 || nonce(16) || tag(16)` — self-authenticating, nothing persisted. */
export function makeCredentialId(root: Uint8Array, rpId: string, nonce: Uint8Array): OwnedBytes {
  assertRoot(root)
  if (nonce.length !== NONCE_LEN) throw new Error(`nonce must be ${NONCE_LEN} bytes`)
  const tag = credentialTag(deriveCredentialMacKey(root), rpIdHash(rpId), nonce)
  return concat(Uint8Array.from([CRED_ID_VERSION]), nonce, tag)
}

/**
 * Recover the nonce from a credentialId, or throw.
 *
 * THROWING IS THE POINT. A tampered id must never fall through to deriving some
 * other key — that would silently sign with a key the relying party has never
 * seen, and turn a corrupted byte into an unexplainable auth failure at best.
 */
export function parseCredentialId(root: Uint8Array, rpId: string, credentialId: Uint8Array): { nonce: Uint8Array } {
  assertRoot(root)
  if (!(credentialId instanceof Uint8Array) || credentialId.length !== CRED_ID_LEN) {
    throw new Error('Unrecognised credential id: wrong length')
  }
  if (credentialId[0] !== CRED_ID_VERSION) {
    throw new Error('Unrecognised credential id: unsupported version')
  }
  const nonce = credentialId.slice(1, 1 + NONCE_LEN)
  const tag = credentialId.slice(1 + NONCE_LEN)
  const expected = credentialTag(deriveCredentialMacKey(root), rpIdHash(rpId), nonce)
  if (!timingSafeEqual(tag, expected)) {
    throw new Error('Unrecognised credential id: authentication tag mismatch')
  }
  return { nonce }
}

/** Non-throwing probe: is this one of ours, for this RP and this wallet? */
export function isOwnCredentialId(root: Uint8Array, rpId: string, credentialId: Uint8Array): boolean {
  try {
    parseCredentialId(root, rpId, credentialId)
    return true
  } catch {
    return false
  }
}

// ─── COSE + authenticatorData ───────────────────────────────────────────────

/**
 * COSE_Key for an EC2 P-256 public key: `{1:2, 3:-7, -1:1, -2:x, -3:y}`.
 * Emitted in CTAP2 canonical order (1, 3, -1, -2, -3 — all one-byte labels,
 * sorted bytewise as 0x01, 0x03, 0x20, 0x21, 0x22).
 */
export function coseKeyFromPublicKey(publicKey: Uint8Array): OwnedBytes {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error('COSE key requires an uncompressed 65-byte P-256 point')
  }
  return cborMap([
    [cborInt(1), cborInt(2)],                        // kty: EC2
    [cborInt(3), cborInt(COSE_ALG_ES256)],           // alg: ES256
    [cborInt(-1), cborInt(1)],                       // crv: P-256
    [cborInt(-2), cborBytes(publicKey.slice(1, 33))], // x
    [cborInt(-3), cborBytes(publicKey.slice(33, 65))], // y
  ])
}

export interface AuthDataOptions {
  rpId: string
  /** Default true. Registration and assertion both require it by default. */
  userVerified?: boolean
  /** Default true — no ceremony reaches here without an approval dialog. */
  userPresent?: boolean
  signCount?: number
  /** Present only for registration (sets the AT flag). */
  attested?: { credentialId: Uint8Array; publicKey: Uint8Array }
}

/**
 * `rpIdHash(32) || flags(1) || signCount(4 BE) || [attestedCredentialData]`
 * where attestedCredentialData = `aaguid(16) || credIdLen(2 BE) || credId || COSEKey`.
 *
 * BE|BS are always set: a seed-derived credential genuinely is multi-device and
 * genuinely is backed up — by the user's 12/24 words. Claiming single-device
 * would be false, and relying parties use these flags to decide whether to nag
 * the user for a second credential.
 */
export function buildAuthenticatorData(opts: AuthDataOptions): OwnedBytes {
  const { rpId, userVerified = true, userPresent = true, signCount = SIGN_COUNT, attested } = opts

  let flags = FLAG_BE | FLAG_BS
  if (userPresent) flags |= FLAG_UP
  if (userVerified) flags |= FLAG_UV
  if (attested) flags |= FLAG_AT

  if (!Number.isInteger(signCount) || signCount < 0 || signCount > 0xffffffff) {
    throw new Error('signCount must be a uint32')
  }
  const counterBytes = Uint8Array.from([
    (signCount >>> 24) & 0xff, (signCount >>> 16) & 0xff, (signCount >>> 8) & 0xff, signCount & 0xff,
  ])

  const head = concat(rpIdHash(rpId), Uint8Array.from([flags]), counterBytes)
  if (!attested) return head

  const { credentialId, publicKey } = attested
  if (credentialId.length > 1023) throw new Error('credentialId exceeds 1023 bytes')
  const idLen = Uint8Array.from([(credentialId.length >> 8) & 0xff, credentialId.length & 0xff])
  return concat(head, MAGICMONEY_AAGUID, idLen, credentialId, coseKeyFromPublicKey(publicKey))
}

// ─── Registration ───────────────────────────────────────────────────────────

export interface AttestationOptions {
  /** 32-byte WebAuthn root from `deriveWebauthnRoot`. Never the mnemonic. */
  root: Uint8Array
  rpId: string
  /** 16 fresh random bytes. Caller-supplied so ceremonies stay reproducible. */
  nonce: Uint8Array
  userVerified?: boolean
  userPresent?: boolean
  signCount?: number
}

export interface AttestationResult {
  /** CBOR `{fmt:"none", attStmt:{}, authData}` — response.attestationObject. */
  attestationObject: OwnedBytes
  authData: OwnedBytes
  credentialId: OwnedBytes
  /** COSE_Key bytes the relying party will store. */
  publicKeyCose: OwnedBytes
  /** Uncompressed SEC1 point, 65 bytes. */
  publicKey: Uint8Array
}

/**
 * Build a registration response. `fmt: "none"` — we make no claim about the
 * hardware because there is none to claim: the "authenticator" is the user's
 * seed. Self-attestation would assert a provenance we cannot back, and every
 * major platform authenticator returns "none" for exactly this reason.
 *
 * No clientDataHash is needed: an empty attStmt signs nothing.
 */
export function buildAttestationObject(opts: AttestationOptions): AttestationResult {
  const { root, rpId, nonce } = opts
  const key = deriveCredentialKey(root, rpId, nonce)
  const credentialId = makeCredentialId(root, rpId, nonce)

  const authData = buildAuthenticatorData({
    rpId,
    userVerified: opts.userVerified,
    userPresent: opts.userPresent,
    signCount: opts.signCount,
    attested: { credentialId, publicKey: key.publicKey },
  })

  // CTAP2 canonical order: "fmt"(3) < "attStmt"(7) < "authData"(8).
  const attestationObject = cborMap([
    [cborText('fmt'), cborText('none')],
    [cborText('attStmt'), cborMap([])],
    [cborText('authData'), cborBytes(authData)],
  ])

  return { attestationObject, authData, credentialId, publicKeyCose: coseKeyFromPublicKey(key.publicKey), publicKey: key.publicKey }
}

// ─── Assertion ──────────────────────────────────────────────────────────────

export interface AssertionOptions {
  root: Uint8Array
  rpId: string
  /** Must MAC-verify against this root and rpId, or the call throws. */
  credentialId: Uint8Array
  /** SHA-256 of the clientDataJSON the browser (or the provider) supplied. */
  clientDataHash: Uint8Array
  userVerified?: boolean
  userPresent?: boolean
  signCount?: number
}

export interface AssertionResult {
  authenticatorData: OwnedBytes
  /** ASN.1 DER ECDSA signature, low-S normalised. */
  signature: Uint8Array
}

/**
 * Sign an assertion: ES256 over `authenticatorData || clientDataHash`.
 *
 * Deterministic by design — RFC 6979 k, then low-S normalisation. Two reasons:
 * a bad RNG in a background service can leak the key through a repeated k, and
 * determinism lets the shared test vectors pin the signature bytes themselves,
 * so the Java port cannot quietly diverge on encoding.
 */
export function buildAssertion(opts: AssertionOptions): AssertionResult {
  const { root, rpId, credentialId, clientDataHash } = opts
  if (clientDataHash.length !== 32) throw new Error('clientDataHash must be 32 bytes')

  // Throws on a tampered id — deliberately before any key material exists.
  const { nonce } = parseCredentialId(root, rpId, credentialId)
  const key = deriveCredentialKey(root, rpId, nonce)

  const authenticatorData = buildAuthenticatorData({
    rpId,
    userVerified: opts.userVerified,
    userPresent: opts.userPresent,
    signCount: opts.signCount,
  })

  const digest = sha256(concat(authenticatorData, clientDataHash))
  const sig = p256.sign(digest, key.privateKey)
  const normalised = sig.hasHighS() ? sig.normalizeS() : sig

  return { authenticatorData, signature: normalised.toDERRawBytes() }
}

// ─── Encoding helpers for the transport layer ───────────────────────────────

/** base64url, no padding — the WebAuthn JSON wire format. */
export function base64url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(s: string): OwnedBytes {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob(padded)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function fromHex(hex: string): OwnedBytes {
  if (hex.length % 2 !== 0) throw new Error('hex string must have an even length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/** The clientDataJSON a browser would produce, for the in-app shim (Phase 3). */
export function buildClientDataJSON(type: 'webauthn.create' | 'webauthn.get', challenge: Uint8Array, origin: string, crossOrigin = false): OwnedBytes {
  return utf8(JSON.stringify({ type, challenge: base64url(challenge), origin, crossOrigin }))
}
