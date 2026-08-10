/**
 * passkey-ceremony.ts — MagicMoney Wallet
 *
 * The WebAuthn ceremonies, with every platform detail injected.
 *
 * Electron main and the Android WebView bundle both drive this same file. They
 * differ only in how they load the mnemonic, store the index, show an approval
 * and check a biometric — so those four things are a `PasskeyEnvironment` and
 * nothing else is duplicated. Two copies of the credential-resolution rules is
 * precisely the drift risk the plan calls out for TS-vs-Java; it applies just as
 * well to Electron-vs-Android.
 *
 * Every ceremony passes three gates, in this order:
 *   1. SITE  — the rpId must actually belong to the origin making the request,
 *              checked against a real public suffix list (passkey-protocol.ts).
 *   2. USER  — the approval dialog: which site, which account, create-vs-sign,
 *              and a chooser when a discoverable sign-in matched several.
 *   3. BIO   — Windows Hello / Touch ID / Android BiometricPrompt, on a gate of
 *              its own that has nothing to do with wallet unlock.
 * Only then is a key derived. The wallet must already be unlocked; loadMnemonic
 * throws otherwise, so a locked wallet can sign nothing.
 *
 * ⚠ THE ONE INVARIANT WORTH RE-READING. A credential is only ever used after
 * `parseCredentialId` has verified its MAC — whether the id came from the
 * relying party or from our own index. There is no code path here that conjures
 * a nonce, so a missing, foreign or tampered index can make a sign-in FAIL but
 * can never make it succeed against the wrong key. See passkey-index.ts.
 *
 * ⚠ `origin` is ALWAYS resolved natively from the tab's real URL. Page script
 * never supplies it, which is what makes the approval dialog's "Site:" line
 * trustworthy and what stops a page claiming another site's rpId.
 */

import { sha256 } from '@noble/hashes/sha256'
import {
  deriveWebauthnRoot, buildAttestationObject, buildAssertion, buildClientDataJSON,
  isOwnCredentialId, base64url, fromBase64url,
  COSE_ALG_ES256,
} from './webauthn-authenticator'
import {
  loadIndex, addRecord, findRecords, removeRecord,
  PASSKEY_INDEX_UNREADABLE, type PasskeyIndexStorage, type PasskeyCredentialRecord,
} from './passkey-index'
import {
  requireSiteForRpId, passkeyError, defaultRpIdForOrigin,
  PASSKEY_REJECTED, PASSKEY_NO_CREDENTIAL, PASSKEY_UNSUPPORTED_ALGORITHM, PASSKEY_EXCLUDED,
  type PasskeyAccount, type PasskeyApprovalRequest, type PasskeyApprovalDecision,
  type PasskeyVerification, type PasskeyChoice,
} from './passkey-protocol'

type OwnedBytes = Uint8Array<ArrayBuffer>

// ─── The platform seam ──────────────────────────────────────────────────────

export interface PasskeyEnvironment {
  /** Throws when the wallet is locked. The only door to key material. */
  loadMnemonic(): Promise<string>
  /** Which account the wallet currently has selected, for the dialog and new keys. */
  currentAccount(): Promise<PasskeyAccount>
  /** Where the encrypted credential index lives on this platform. */
  storage: PasskeyIndexStorage
  approve(request: PasskeyApprovalRequest): Promise<PasskeyApprovalDecision>
  verifyUser(reason: string): Promise<PasskeyVerification>
  /**
   * AAGUID to report. Pass ZERO_AAGUID on the in-app-browser path, where we are
   * also the client and must blank it the way a browser would. Defaults to the
   * core's MAGICMONEY_AAGUID (the provider path, where Chrome blanks it).
   */
  aaguid?: Uint8Array
  now?(): number
}

const nowOf = (env: PasskeyEnvironment): number => (env.now ? env.now() : Date.now())

/**
 * The index is encrypted under ACCOUNT 0's root, which is the wallet's stable
 * identity, so one list covers every account (each record carries its own
 * accountIndex). Switching accounts must not hide the passkeys you made under
 * another one.
 */
const indexKeyFor = (mnemonic: string): Promise<Uint8Array> => deriveWebauthnRoot(mnemonic, 0)

// ─── Registration ───────────────────────────────────────────────────────────

export interface CeremonyCreateRequest {
  /** The tab's real origin, resolved natively. Never page-supplied. */
  origin: string
  /** Page-supplied rp.id; defaults to the origin's effective domain. */
  rpId?: string
  userHandle: Uint8Array
  userName: string
  /** Default true. A non-discoverable credential is not indexed. */
  discoverable?: boolean
  /**
   * Page-supplied challenge. When present WE build the clientDataJSON — the
   * in-app-browser path, where the shim is the client and the origin inside that
   * JSON must be the real one rather than anything the page could set.
   */
  challenge?: Uint8Array
  crossOrigin?: boolean
  /** COSE alg ids from pubKeyCredParams. We only ever do ES256. */
  algorithms?: number[]
  /** Credentials the RP already has; registering a second is an error. */
  excludeCredentials?: Uint8Array[]
}

export interface CeremonyCreateResult {
  credentialId: OwnedBytes
  attestationObject: OwnedBytes
  authData: OwnedBytes
  publicKeyCose: OwnedBytes
  /** Uncompressed SEC1 point — the source for the SPKI form the page gets. */
  publicKey: Uint8Array
  /** Present only when `challenge` was supplied. */
  clientDataJSON?: OwnedBytes
  accountIndex: number
  userVerification: PasskeyVerification
}

export async function runCreate(env: PasskeyEnvironment, req: CeremonyCreateRequest): Promise<CeremonyCreateResult> {
  const rpId = req.rpId ?? defaultRpIdForOrigin(req.origin)
  const site = requireSiteForRpId(rpId, req.origin)

  // ES256 only. Saying so before any prompt spares the user a dialog for a
  // ceremony that would fail at the end anyway.
  if (req.algorithms && req.algorithms.length > 0 && !req.algorithms.includes(COSE_ALG_ES256)) {
    throw passkeyError(PASSKEY_UNSUPPORTED_ALGORITHM, `${site} asked for an algorithm Magic Money does not support.`)
  }

  const mnemonic = await env.loadMnemonic()            // throws when locked
  const { accountIndex, accountAddress } = await env.currentAccount()

  // excludeCredentials: the RP is telling us what it already holds, so we do not
  // mint a second credential the user cannot tell from the first.
  //
  // ⚠ THE QUESTION IS "CAN THIS DEVICE ALREADY OFFER IT?", NOT "COULD THIS
  // DEVICE DERIVE IT?". Those differ for a seed-derived authenticator in the way
  // that matters: the MAC verifies on EVERY device holding the seed, so asking
  // `isOwnCredentialId` refused registration on a second device — which could
  // not discover the first device's credential either, the index being local.
  // Unable to register, unable to sign in, and no way out from the device.
  //
  // The local index is the honest answer. A second device registers its own
  // credential (the nonce is fresh, so it is genuinely distinct), the relying
  // party stores both, and each device can discover its own. That is one passkey
  // per device with nothing to sync — and when the index sync lands it upgrades
  // this to a shared one rather than being a precondition for it.
  if (req.excludeCredentials?.length) {
    const offerable = new Set<string>()
    try {
      for (const r of await findRecords(env.storage, await indexKeyFor(mnemonic), rpId)) {
        offerable.add(r.credentialId)
      }
    } catch {
      // No readable index ⇒ we cannot claim to hold anything ⇒ let it proceed.
      // Blocking here is what created the deadlock this comment exists about.
    }
    for (const excluded of req.excludeCredentials) {
      if (offerable.has(base64url(excluded))) {
        throw passkeyError(PASSKEY_EXCLUDED,
          `You already have a Magic Money passkey for ${site} on this device.`)
      }
    }
  }

  // Does this replace something? Best-effort only: a first-ever or foreign index
  // just means we cannot promise the warning, never that we block the ceremony.
  const userHandleB64 = base64url(req.userHandle)
  let replacesExisting = false
  try {
    const existing = await findRecords(env.storage, await indexKeyFor(mnemonic), rpId)
    replacesExisting = existing.some(r => r.userHandle === userHandleB64)
  } catch { /* no readable index — the dialog simply omits the warning */ }

  const decision = await env.approve({
    ceremony: 'create', site, origin: req.origin, accountIndex, accountAddress,
    userName: req.userName, replacesExisting,
  })
  if (!decision.approved) throw passkeyError(PASSKEY_REJECTED, 'You declined to create a passkey.')

  const userVerification = await env.verifyUser(`create a passkey for ${site}`)

  const root = await deriveWebauthnRoot(mnemonic, accountIndex)
  const nonce = randomNonce()
  const att = buildAttestationObject({ root, rpId, nonce, userVerified: true, aaguid: env.aaguid })

  if (req.discoverable !== false) {
    await addRecord(env.storage, await indexKeyFor(mnemonic), {
      rpId,
      credentialId: base64url(att.credentialId),
      userHandle: userHandleB64,
      userName: req.userName,
      accountIndex,
      createdAt: nowOf(env),
    })
  }

  return {
    credentialId: att.credentialId,
    attestationObject: att.attestationObject,
    authData: att.authData,
    publicKeyCose: att.publicKeyCose,
    publicKey: att.publicKey,
    clientDataJSON: req.challenge
      ? buildClientDataJSON('webauthn.create', req.challenge, req.origin, req.crossOrigin ?? false)
      : undefined,
    accountIndex,
    userVerification,
  }
}

// ─── Authentication ─────────────────────────────────────────────────────────

export interface CeremonyAssertRequest {
  origin: string
  rpId?: string
  /**
   * The site's allowCredentials. When non-empty this is a TARGETED sign-in and
   * the index is only ever a hint — a missing index cannot break it.
   */
  allowCredentials?: Uint8Array[]
  /** Shim path: we build the clientDataJSON around the real origin. */
  challenge?: Uint8Array
  crossOrigin?: boolean
  /** Provider path: the clientDataHash is handed to us already computed. */
  clientDataHash?: Uint8Array
}

export interface CeremonyAssertResult {
  credentialId: Uint8Array
  authenticatorData: OwnedBytes
  signature: Uint8Array
  /** Present only for a discoverable sign-in, where the index knows the user. */
  userHandle: Uint8Array | null
  clientDataJSON?: OwnedBytes
  accountIndex: number
  userVerification: PasskeyVerification
}

interface Candidate {
  credentialId: Uint8Array
  accountIndex: number
  root: Uint8Array
  userHandle: Uint8Array | null
  userName?: string
  createdAt?: number
}

/**
 * Which accounts might hold a credential for this request.
 *
 * The current account always; plus any account the index has seen for this rpId,
 * so a passkey made under Account 2 still signs in while Account 1 is selected.
 * A missing index simply narrows this to the current account — it degrades
 * discovery, never correctness, because the MAC still has the final say.
 */
async function candidateAccounts(
  env: PasskeyEnvironment, mnemonic: string, rpId: string, current: number,
): Promise<number[]> {
  const accounts = [current]
  try {
    for (const r of await loadIndex(env.storage, await indexKeyFor(mnemonic))) {
      if (r.rpId === rpId && !accounts.includes(r.accountIndex)) accounts.push(r.accountIndex)
    }
  } catch { /* unreadable or absent — current account only */ }
  return accounts
}

/** base64url → bytes, or null. Sanitisation bounds the charset, not the length. */
function decodeOrNull(b64u: string): Uint8Array | null {
  try {
    return fromBase64url(b64u)
  } catch {
    return null
  }
}

/** Targeted sign-in: the site named the credentials. The MAC decides, nothing else. */
async function targetedCandidates(
  env: PasskeyEnvironment, mnemonic: string, rpId: string, allow: Uint8Array[], current: number,
): Promise<Candidate[]> {
  const out: Candidate[] = []
  for (const accountIndex of await candidateAccounts(env, mnemonic, rpId, current)) {
    const root = await deriveWebauthnRoot(mnemonic, accountIndex)
    for (const credentialId of allow) {
      if (isOwnCredentialId(root, rpId, credentialId)) {
        out.push({ credentialId, accountIndex, root, userHandle: null })
      }
    }
    if (out.length > 0) break   // the site named these; the first account that owns one is the answer
  }
  return out
}

/**
 * Discoverable sign-in: the site named nothing, so we enumerate the index.
 *
 * Records are a HINT. Each candidate's credentialId is still run through the MAC
 * under its recorded account's root, so a hand-edited index — one pointing at
 * another site's credential, say — is rejected rather than signed with.
 */
async function discoverableCandidates(
  env: PasskeyEnvironment, mnemonic: string, rpId: string,
): Promise<Candidate[]> {
  let records: PasskeyCredentialRecord[]
  try {
    records = await findRecords(env.storage, await indexKeyFor(mnemonic), rpId)
  } catch (e) {
    if (e instanceof Error && e.message === PASSKEY_INDEX_UNREADABLE) return []
    throw e
  }

  const out: Candidate[] = []
  for (const record of records) {
    const credentialId = decodeOrNull(record.credentialId)
    if (!credentialId) continue
    const root = await deriveWebauthnRoot(mnemonic, record.accountIndex)
    if (!isOwnCredentialId(root, rpId, credentialId)) continue   // tampered row — skip, never use
    out.push({
      credentialId,
      accountIndex: record.accountIndex,
      root,
      // A malformed userHandle costs the site its user hint; it must not abort a
      // sign-in whose credential has already proved itself against the MAC.
      userHandle: record.userHandle ? decodeOrNull(record.userHandle) : null,
      userName: record.userName,
      createdAt: record.createdAt,
    })
  }
  return out
}

function choicesFor(candidates: Candidate[]): PasskeyChoice[] {
  return candidates.map(c => ({
    id: base64url(c.credentialId),
    label: c.userName || 'Unnamed account',
    sublabel: `Account ${c.accountIndex + 1}${c.createdAt ? ` · added ${new Date(c.createdAt).toLocaleDateString()}` : ''}`,
  }))
}

export async function runAssert(env: PasskeyEnvironment, req: CeremonyAssertRequest): Promise<CeremonyAssertResult> {
  const rpId = req.rpId ?? defaultRpIdForOrigin(req.origin)
  const site = requireSiteForRpId(rpId, req.origin)

  // Exactly one source of client data. The shim hands us a challenge (we build
  // the JSON around the REAL origin); the provider path hands us a hash Chrome
  // already computed.
  const clientDataJSON = req.challenge
    ? buildClientDataJSON('webauthn.get', req.challenge, req.origin, req.crossOrigin ?? false)
    : undefined
  const clientDataHash = clientDataJSON ? sha256(clientDataJSON) : req.clientDataHash
  if (!(clientDataHash instanceof Uint8Array) || clientDataHash.length !== 32) {
    throw new Error('clientDataHash must be 32 bytes')
  }

  const mnemonic = await env.loadMnemonic()            // throws when locked
  const { accountIndex: current, accountAddress } = await env.currentAccount()

  // Resolve BEFORE prompting: there is no point asking the user to approve a
  // sign-in we cannot perform, and the dialog needs to name the right account.
  // Safe because gate 1 already pinned rpId to the real origin, so a site can
  // only ever probe for credentials it already knows about.
  const candidates = req.allowCredentials?.length
    ? await targetedCandidates(env, mnemonic, rpId, req.allowCredentials, current)
    : await discoverableCandidates(env, mnemonic, rpId)

  if (candidates.length === 0) {
    throw passkeyError(PASSKEY_NO_CREDENTIAL, `No Magic Money passkey is registered for ${rpId}.`)
  }

  // More than one identity for this site ⇒ the user picks. Below that, naming
  // the single account in the dialog is enough.
  const offerChoice = candidates.length > 1
  const decision = await env.approve({
    ceremony: 'get', site, origin: req.origin,
    accountIndex: candidates[0].accountIndex,
    accountAddress: candidates[0].accountIndex === current ? accountAddress : undefined,
    userName: offerChoice ? undefined : candidates[0].userName,
    choices: offerChoice ? choicesFor(candidates) : undefined,
  })
  if (!decision.approved) throw passkeyError(PASSKEY_REJECTED, 'You declined to sign in.')

  // An unrecognised or absent choiceId falls back to the first candidate — the
  // same one a single-candidate dialog would have used. Never a different site's.
  const chosen = (offerChoice && decision.choiceId
    ? candidates.find(c => base64url(c.credentialId) === decision.choiceId)
    : undefined) ?? candidates[0]

  const userVerification = await env.verifyUser(`sign in to ${site}`)

  const assertion = buildAssertion({
    root: chosen.root, rpId, credentialId: chosen.credentialId, clientDataHash, userVerified: true,
  })

  return {
    credentialId: chosen.credentialId,
    authenticatorData: assertion.authenticatorData,
    signature: assertion.signature,
    userHandle: chosen.userHandle,
    clientDataJSON,
    accountIndex: chosen.accountIndex,
    userVerification,
  }
}

// ─── Silent probes (no prompt, no key material) ─────────────────────────────

/**
 * Does this wallet hold a credential this request could use?
 *
 * Backs the shim's `isConditionalMediationAvailable` / autofill hint, so a page
 * can decide whether to show a passkey affordance WITHOUT us popping a dialog.
 * It reveals nothing a site does not already know: gate 1 pins the rpId to the
 * caller's own origin, so it can only ever ask about itself.
 */
export async function hasCredentialFor(
  env: PasskeyEnvironment, origin: string, rpIdOpt?: string, allowCredentials?: Uint8Array[],
): Promise<boolean> {
  const rpId = rpIdOpt ?? defaultRpIdForOrigin(origin)
  try {
    requireSiteForRpId(rpId, origin)
    const mnemonic = await env.loadMnemonic()
    const { accountIndex } = await env.currentAccount()
    const candidates = allowCredentials?.length
      ? await targetedCandidates(env, mnemonic, rpId, allowCredentials, accountIndex)
      : await discoverableCandidates(env, mnemonic, rpId)
    return candidates.length > 0
  } catch {
    return false
  }
}

// ─── Settings surface ───────────────────────────────────────────────────────

/**
 * Everything this wallet has registered, newest first.
 *
 * A foreign index reads as an empty list here rather than an error: for a
 * display surface "this wallet has no passkeys on this device" is the honest
 * answer. The credential paths above deliberately do NOT swallow it, because
 * there the difference between "none" and "unreadable" changes what happens.
 */
export async function listRecords(env: PasskeyEnvironment): Promise<PasskeyCredentialRecord[]> {
  const mnemonic = await env.loadMnemonic()
  try {
    return (await loadIndex(env.storage, await indexKeyFor(mnemonic))).sort((a, b) => b.createdAt - a.createdAt)
  } catch (e) {
    if (e instanceof Error && e.message === PASSKEY_INDEX_UNREADABLE) return []
    throw e
  }
}

/**
 * Forget one credential.
 *
 * Discovery only — the passkey itself is a function of the seed and cannot be
 * destroyed, so it keeps working anywhere the site names it. The UI must say so
 * rather than implying deletion; the site's own account settings are where a
 * passkey is actually revoked.
 */
export async function forgetRecord(env: PasskeyEnvironment, rpId: string, credentialId: string): Promise<void> {
  const mnemonic = await env.loadMnemonic()
  try {
    await removeRecord(env.storage, await indexKeyFor(mnemonic), rpId, credentialId)
  } catch (e) {
    if (e instanceof Error && e.message === PASSKEY_INDEX_UNREADABLE) return
    throw e
  }
}

// ─── Misc ───────────────────────────────────────────────────────────────────

/**
 * 16 fresh bytes. WebCrypto is present in Electron main (Node 20+), the Android
 * WebView and every test runner, so there is no platform seam for this.
 */
function randomNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16))
}

/**
 * SubjectPublicKeyInfo DER for a P-256 point — what `getPublicKey()` returns to
 * the page. Fixed 26-byte prefix (SEQUENCE, ecPublicKey + prime256v1 OIDs, BIT
 * STRING header) followed by the uncompressed point.
 */
export function spkiFromP256(publicKey: Uint8Array): Uint8Array {
  if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
    throw new Error('SPKI encoding requires an uncompressed 65-byte P-256 point')
  }
  const prefix = Uint8Array.from([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
  ])
  const out = new Uint8Array(prefix.length + publicKey.length)
  out.set(prefix, 0)
  out.set(publicKey, prefix.length)
  return out
}
