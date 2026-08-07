/**
 * passkey-manager.ts — MagicMoney Wallet
 *
 * Phase 2 of the passkey-provider work: the approval UX and vault wiring that
 * sit between a WebAuthn request and the frozen authenticator core.
 *
 * Every ceremony passes three gates, in this order:
 *   1. SITE  — the rpId must actually belong to the origin making the request,
 *              or the approval dialog would be naming the wrong site.
 *   2. USER  — the branded approval window (which site, which account,
 *              create-vs-sign), reusing showApprovalWindow.
 *   3. BIO   — Windows Hello / Touch ID, on a key of its own that has nothing to
 *              do with wallet unlock.
 * Only then is a key derived. The wallet must already be unlocked; loadMnemonic()
 * throws otherwise, so a locked wallet can sign nothing.
 *
 * ⚠ THE ONE INVARIANT WORTH RE-READING. A credential is only ever used after
 * `parseCredentialId` has verified its MAC — whether the id came from the
 * relying party or from our own index file. There is no code path here that
 * conjures a nonce, so a missing, foreign or tampered index can make a sign-in
 * FAIL but can never make it succeed against the wrong key. See passkey-store.ts.
 *
 * This module deliberately does not touch wallet.passkey.enc, wallet.hello.enc,
 * or the biometric-unlock enrollment.
 */

import { randomBytes } from 'crypto'
import {
  deriveWebauthnRoot, buildAttestationObject, buildAssertion,
  isOwnCredentialId, base64url, fromBase64url,
} from './webauthn-authenticator'
import {
  addPasskeyCredential, findPasskeyCredentials, loadPasskeyIndex, removePasskeyCredential,
  PASSKEY_INDEX_UNREADABLE, type PasskeyCredentialRecord,
} from './passkey-store'
import { loadMnemonic, loadAddresses, bioMethod, bioSupported } from './secure-store'
import { runHello } from './hello-bridge'
import { touchIdVerify, touchIdSupported } from './touchid-bridge'
import { showApprovalWindow, type ApprovalOptions } from './browser-manager'

// ─── Error codes (stable — Phase 3's shim maps these to DOMExceptions) ───────

export const PASSKEY_REJECTED = 'PASSKEY_REJECTED'
export const PASSKEY_NO_CREDENTIAL = 'PASSKEY_NO_CREDENTIAL'
export const PASSKEY_ORIGIN_MISMATCH = 'PASSKEY_ORIGIN_MISMATCH'
export const PASSKEY_VERIFICATION_FAILED = 'PASSKEY_VERIFICATION_FAILED'

function passkeyError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/**
 * Bytes the authenticator core allocated itself. Same reason as the alias in
 * webauthn-authenticator.ts: WebCrypto and @simplewebauthn/server require
 * ArrayBuffer-backed views, and a bare `Uint8Array` widens to `ArrayBufferLike`
 * under TS 5.7+. Fields that can hold a caller's own array stay plain.
 */
type OwnedBytes = Uint8Array<ArrayBuffer>

// ─── Gate 1: does this rpId belong to this origin? ──────────────────────────

/**
 * WebAuthn's rule: rpId must equal the origin's host, or be a registrable suffix
 * of it. Without this, a page on evil.example could ask us to mint a passkey for
 * a bank and the approval dialog would faithfully print the bank's name.
 *
 * ⚠ Not a public-suffix list. We reject a single-label rpId that isn't the whole
 * host (so `evil.com` cannot claim `com`), but a site on `evil.co.uk` claiming
 * `co.uk` would pass this check alone. In Phase 4 the platform has already
 * applied its own origin rules before the request reaches us; in Phase 3 we are
 * the browser, so a PSL belongs there if we ever accept untrusted rpIds from
 * page script. Today the shim does not exist and every caller is our own code.
 */
export function rpIdMatchesOrigin(rpId: string, origin: string): boolean {
  if (typeof rpId !== 'string' || rpId.length === 0) return false
  let host: string
  let protocol: string
  try {
    const u = new URL(origin)
    host = u.hostname.toLowerCase()
    protocol = u.protocol
  } catch {
    return false
  }
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
  if (protocol !== 'https:' && !(protocol === 'http:' && isLoopback)) return false

  const id = rpId.toLowerCase()
  if (host === id) return true
  if (!host.endsWith(`.${id}`)) return false
  return id.includes('.')
}

/** The host we name in the dialog. Throws when the site is claiming someone else's rpId. */
export function requireSiteForRpId(rpId: string, origin: string): string {
  if (!rpIdMatchesOrigin(rpId, origin)) {
    throw passkeyError(
      PASSKEY_ORIGIN_MISMATCH,
      `${origin} may not use passkeys for “${rpId}”.`
    )
  }
  return new URL(origin).host
}

// ─── Gate 2: the approval dialog ────────────────────────────────────────────

export interface PasskeyApprovalContext {
  ceremony: 'create' | 'get'
  /** Host shown to the user — always derived from the real origin, never claimed. */
  site: string
  origin: string
  accountIndex: number
  /** EVM address of that account, so "Account 2" is recognisable. */
  accountAddress?: string
  /** RP-supplied user.name, or the one recorded at registration. */
  userName?: string
  /** create only: an existing passkey for this same site + user is being replaced. */
  replacesExisting?: boolean
}

const shortAddress = (a: string): string => (a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a)

/**
 * Pure — the dialog copy, split out so it can be tested without an Electron
 * window. Answers the three questions the plan asks it to: which site, which
 * account, and create-vs-sign.
 */
export function buildPasskeyApproval(ctx: PasskeyApprovalContext): ApprovalOptions {
  const account = ctx.accountAddress
    ? `Account ${ctx.accountIndex + 1} · ${shortAddress(ctx.accountAddress)}`
    : `Account ${ctx.accountIndex + 1}`

  const lines = [`Site: ${ctx.site}`, `Wallet: ${account}`]
  if (ctx.userName) lines.push(`${ctx.ceremony === 'create' ? 'Sign up as' : 'Sign in as'}: ${ctx.userName}`)

  if (ctx.ceremony === 'create') {
    lines.push(
      '',
      'This passkey is derived from your seed phrase. It will work on any device',
      'where you restore those words — and anyone who has them can sign in as you.',
    )
    return {
      title: 'Create a passkey',
      heading: `${ctx.site} wants to create a passkey`,
      detail: lines.join('\n'),
      confirmLabel: 'Create passkey',
      origin: ctx.origin,
      warnings: ctx.replacesExisting
        ? [`This replaces the passkey you already have for ${ctx.site}. The old one will stop working.`]
        : undefined,
    }
  }

  return {
    title: 'Sign in with a passkey',
    heading: `${ctx.site} wants to sign you in`,
    detail: lines.join('\n'),
    confirmLabel: 'Sign in',
    origin: ctx.origin,
  }
}

// ─── Gate 3: the biometric check ────────────────────────────────────────────

export type PasskeyVerification = 'windows-hello' | 'touch-id' | 'wallet-password'

/**
 * A Hello key used ONLY to prove the user is present for a passkey ceremony.
 *
 * Deliberately NOT `HELLO_KEY_NAME`. That key wraps wallet.hello.enc, and
 * secure-store self-heals a `NotFound` on it by deleting the encrypted unlock
 * copy — so borrowing it here would let a passkey prompt silently disable the
 * user's biometric wallet unlock. Nothing about this key can decrypt anything;
 * the signature it produces is discarded.
 */
const PASSKEY_GATE_KEY_NAME = 'MagicMoneyPasskeyGate'
const PASSKEY_GATE_CHALLENGE_B64 = Buffer.from('magicmoney-passkey-gate-v1', 'utf8').toString('base64')

async function windowsHelloGate(): Promise<void> {
  let res = await runHello('sign', PASSKEY_GATE_KEY_NAME, PASSKEY_GATE_CHALLENGE_B64)
  // First ever use, or Windows evicted the key (reboot / PIN change / TPM reset).
  // Creating it prompts Hello just as signing does, so the user is still verified.
  if (!res.ok && res.status === 'NotFound') {
    res = await runHello('enroll', PASSKEY_GATE_KEY_NAME, PASSKEY_GATE_CHALLENGE_B64)
  }
  if (res.ok) return
  if (res.status === 'UserCanceled') {
    throw passkeyError(PASSKEY_VERIFICATION_FAILED, 'Windows Hello was canceled')
  }
  throw passkeyError(PASSKEY_VERIFICATION_FAILED, res.status ?? res.error ?? 'Windows Hello verification failed')
}

/**
 * Verify the human in front of the machine.
 *
 * Falls back to `wallet-password` where no biometric is available (Linux, or a
 * machine with nothing enrolled). That still satisfies WebAuthn's UV bit: the
 * wallet is unlocked, which took the user's password, and platform
 * authenticators set UV for a PIN on exactly the same reasoning. We never report
 * UV without one of the three having happened.
 */
export async function verifyUserForPasskey(reason: string): Promise<PasskeyVerification> {
  const method = bioMethod()
  // Both arms check ENROLLMENT, not just the platform. A Mac with no Touch ID
  // hardware still reports 'touch-id' from bioMethod(); prompting there would
  // throw and lock the user out of passkeys entirely rather than falling back.
  if (method === 'touch-id' && touchIdSupported()) {
    try {
      await touchIdVerify(reason)
      return 'touch-id'
    } catch (e) {
      throw passkeyError(PASSKEY_VERIFICATION_FAILED, e instanceof Error ? e.message : 'Touch ID verification failed')
    }
  }
  if (method === 'windows-hello' && await bioSupported()) {
    await windowsHelloGate()
    return 'windows-hello'
  }
  return 'wallet-password'
}

// ─── Account context ────────────────────────────────────────────────────────

interface AccountContext { accountIndex: number; accountAddress?: string }

function currentAccount(): AccountContext {
  const addresses = loadAddresses()
  return { accountIndex: addresses?.accountIndex ?? 0, accountAddress: addresses?.evm }
}

/**
 * The index is encrypted under ACCOUNT 0's root, which is the wallet's stable
 * identity, so one list covers every account (each record carries its own
 * accountIndex). Switching accounts must not hide the passkeys you made under
 * another one.
 */
async function indexKeyFor(mnemonic: string): Promise<Uint8Array> {
  return deriveWebauthnRoot(mnemonic, 0)
}

// ─── Registration ───────────────────────────────────────────────────────────

export interface PasskeyCreateRequest {
  rpId: string
  /** The tab's real origin. Phase 3 must take this natively, never from page JS. */
  origin: string
  /** RP-supplied user.id. */
  userHandle: Uint8Array
  /** RP-supplied user.name — what the dialog and the account chooser show. */
  userName: string
  /** Default true. A non-discoverable credential is not indexed. */
  discoverable?: boolean
}

export interface PasskeyCreateResult {
  credentialId: OwnedBytes
  attestationObject: OwnedBytes
  authData: OwnedBytes
  publicKeyCose: OwnedBytes
  accountIndex: number
  userVerification: PasskeyVerification
}

export async function createPasskey(req: PasskeyCreateRequest): Promise<PasskeyCreateResult> {
  const site = requireSiteForRpId(req.rpId, req.origin)
  const mnemonic = loadMnemonic()               // throws when the wallet is locked
  const { accountIndex, accountAddress } = currentAccount()

  // Does this replace something? Best-effort only: a first-ever or foreign index
  // just means we cannot promise the warning, never that we block the ceremony.
  let replacesExisting = false
  const userHandleB64 = base64url(req.userHandle)
  try {
    const existing = await findPasskeyCredentials(await indexKeyFor(mnemonic), req.rpId)
    replacesExisting = existing.some(r => r.userHandle === userHandleB64)
  } catch { /* no readable index — the dialog simply omits the warning */ }

  const approved = await showApprovalWindow(buildPasskeyApproval({
    ceremony: 'create', site, origin: req.origin, accountIndex, accountAddress,
    userName: req.userName, replacesExisting,
  }))
  if (!approved) throw passkeyError(PASSKEY_REJECTED, 'You declined to create a passkey.')

  const userVerification = await verifyUserForPasskey(`create a passkey for ${site}`)

  const root = await deriveWebauthnRoot(mnemonic, accountIndex)
  const nonce = new Uint8Array(randomBytes(16))
  const att = buildAttestationObject({ root, rpId: req.rpId, nonce, userVerified: true })

  if (req.discoverable !== false) {
    await addPasskeyCredential(await indexKeyFor(mnemonic), {
      rpId: req.rpId,
      credentialId: base64url(att.credentialId),
      userHandle: userHandleB64,
      userName: req.userName,
      accountIndex,
      createdAt: Date.now(),
    })
  }

  return {
    credentialId: att.credentialId,
    attestationObject: att.attestationObject,
    authData: att.authData,
    publicKeyCose: att.publicKeyCose,
    accountIndex,
    userVerification,
  }
}

// ─── Authentication ─────────────────────────────────────────────────────────

export interface PasskeyAssertRequest {
  rpId: string
  origin: string
  /** SHA-256 of the clientDataJSON the caller built. */
  clientDataHash: Uint8Array
  /**
   * The site's allowCredentials. When non-empty this is a TARGETED sign-in and
   * the index is never consulted — a missing index cannot break it.
   */
  allowCredentials?: Uint8Array[]
}

export interface PasskeyAssertResult {
  /** Either the id the site supplied or one rebuilt from the index. */
  credentialId: Uint8Array
  authenticatorData: OwnedBytes
  signature: Uint8Array
  /** Present only for a discoverable sign-in, where the index knows the user. */
  userHandle: Uint8Array | null
  accountIndex: number
  userVerification: PasskeyVerification
}

/** base64url → bytes, or null. Sanitisation bounds the charset, not the length. */
function decodeOrNull(b64u: string): Uint8Array | null {
  try {
    return fromBase64url(b64u)
  } catch {
    return null
  }
}

interface ResolvedCredential {
  credentialId: Uint8Array
  accountIndex: number
  root: Uint8Array
  userHandle: Uint8Array | null
  userName?: string
}

/**
 * Which accounts might hold a credential for this request.
 *
 * The current account always; plus any account the index has seen for this rpId,
 * so a passkey made under Account 2 still signs in while Account 1 is selected.
 * A missing index simply narrows this to the current account — it degrades
 * discovery, never correctness, because the MAC still has the final say.
 */
async function candidateAccounts(mnemonic: string, rpId: string, current: number): Promise<number[]> {
  const accounts = [current]
  try {
    const records = await loadPasskeyIndex(await indexKeyFor(mnemonic))
    for (const r of records) {
      if (r.rpId === rpId && !accounts.includes(r.accountIndex)) accounts.push(r.accountIndex)
    }
  } catch { /* unreadable or absent — current account only */ }
  return accounts
}

/** Targeted sign-in: the site named the credentials. The MAC decides, nothing else. */
async function resolveTargeted(
  mnemonic: string, rpId: string, allow: Uint8Array[], current: number,
): Promise<ResolvedCredential> {
  const accounts = await candidateAccounts(mnemonic, rpId, current)
  for (const accountIndex of accounts) {
    const root = await deriveWebauthnRoot(mnemonic, accountIndex)
    for (const credentialId of allow) {
      if (isOwnCredentialId(root, rpId, credentialId)) {
        return { credentialId, accountIndex, root, userHandle: null }
      }
    }
  }
  throw passkeyError(PASSKEY_NO_CREDENTIAL, `No Magic Money passkey for ${rpId} matched this request.`)
}

/**
 * Discoverable sign-in: the site named nothing, so we enumerate the index.
 *
 * Records are a HINT. Each candidate's credentialId is still run through the MAC
 * under its recorded account's root, so a hand-edited index — one pointing at
 * another site's credential, say — is rejected rather than signed with.
 */
async function resolveDiscoverable(
  mnemonic: string, rpId: string,
): Promise<ResolvedCredential> {
  let records: PasskeyCredentialRecord[]
  try {
    records = await findPasskeyCredentials(await indexKeyFor(mnemonic), rpId)
  } catch (e) {
    if (e instanceof Error && e.message === PASSKEY_INDEX_UNREADABLE) {
      throw passkeyError(PASSKEY_NO_CREDENTIAL, `This device has no passkey list for this wallet, so ${rpId} cannot sign you in without naming a credential.`)
    }
    throw e
  }

  for (const record of records) {
    const credentialId = decodeOrNull(record.credentialId)
    if (!credentialId) continue
    const root = await deriveWebauthnRoot(mnemonic, record.accountIndex)
    if (!isOwnCredentialId(root, rpId, credentialId)) continue   // tampered row — skip, never use
    return {
      credentialId,
      accountIndex: record.accountIndex,
      root,
      // A malformed userHandle costs the site its user hint; it must not abort a
      // sign-in whose credential has already proved itself against the MAC.
      userHandle: record.userHandle ? decodeOrNull(record.userHandle) : null,
      userName: record.userName,
    }
  }
  throw passkeyError(PASSKEY_NO_CREDENTIAL, `No Magic Money passkey is registered for ${rpId}.`)
}

export async function assertPasskey(req: PasskeyAssertRequest): Promise<PasskeyAssertResult> {
  const site = requireSiteForRpId(req.rpId, req.origin)
  if (!(req.clientDataHash instanceof Uint8Array) || req.clientDataHash.length !== 32) {
    throw new Error('clientDataHash must be 32 bytes')
  }
  const mnemonic = loadMnemonic()               // throws when the wallet is locked
  const { accountIndex: current, accountAddress } = currentAccount()

  // Resolve BEFORE prompting: there is no point asking the user to approve a
  // sign-in we cannot perform, and the dialog needs to name the right account.
  const resolved = req.allowCredentials?.length
    ? await resolveTargeted(mnemonic, req.rpId, req.allowCredentials, current)
    : await resolveDiscoverable(mnemonic, req.rpId)

  const approved = await showApprovalWindow(buildPasskeyApproval({
    ceremony: 'get', site, origin: req.origin,
    accountIndex: resolved.accountIndex,
    accountAddress: resolved.accountIndex === current ? accountAddress : undefined,
    userName: resolved.userName,
  }))
  if (!approved) throw passkeyError(PASSKEY_REJECTED, 'You declined to sign in.')

  const userVerification = await verifyUserForPasskey(`sign in to ${site}`)

  const assertion = buildAssertion({
    root: resolved.root,
    rpId: req.rpId,
    credentialId: resolved.credentialId,
    clientDataHash: req.clientDataHash,
    userVerified: true,
  })

  return {
    credentialId: resolved.credentialId,
    authenticatorData: assertion.authenticatorData,
    signature: assertion.signature,
    userHandle: resolved.userHandle,
    accountIndex: resolved.accountIndex,
    userVerification,
  }
}

// ─── Settings surface ───────────────────────────────────────────────────────

/**
 * Everything this wallet has registered, for a "Passkeys" list in Settings.
 *
 * A foreign index reads as an empty list here rather than an error: for a
 * display surface "this wallet has no passkeys on this device" is the honest
 * answer. The credential paths above deliberately do NOT swallow it, because
 * there the difference between "none" and "unreadable" changes what happens.
 */
export async function listPasskeys(): Promise<PasskeyCredentialRecord[]> {
  const mnemonic = loadMnemonic()
  try {
    return (await loadPasskeyIndex(await indexKeyFor(mnemonic))).sort((a, b) => b.createdAt - a.createdAt)
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
export async function forgetPasskey(rpId: string, credentialId: string): Promise<void> {
  const mnemonic = loadMnemonic()
  try {
    await removePasskeyCredential(await indexKeyFor(mnemonic), rpId, credentialId)
  } catch (e) {
    if (e instanceof Error && e.message === PASSKEY_INDEX_UNREADABLE) return
    throw e
  }
}
