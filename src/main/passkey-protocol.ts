/**
 * passkey-protocol.ts — MagicMoney Wallet
 *
 * The platform-neutral pieces of the passkey provider: error codes, the
 * rpId/origin rules, and the request/result shapes. No Electron, no Capacitor,
 * no filesystem — Electron main, the Android WebView bundle and the unit tests
 * all import this same file, because the alternative is three copies of a
 * security rule drifting apart.
 *
 * See webauthn-authenticator.ts for the frozen v1 derivation spec, which this
 * layer never touches.
 */

import { parse as parseHost } from 'tldts'

// ─── Error codes (stable — the page shim maps these to DOMExceptions) ────────

export const PASSKEY_REJECTED = 'PASSKEY_REJECTED'
export const PASSKEY_NO_CREDENTIAL = 'PASSKEY_NO_CREDENTIAL'
export const PASSKEY_ORIGIN_MISMATCH = 'PASSKEY_ORIGIN_MISMATCH'
export const PASSKEY_VERIFICATION_FAILED = 'PASSKEY_VERIFICATION_FAILED'
export const PASSKEY_UNSUPPORTED_ALGORITHM = 'PASSKEY_UNSUPPORTED_ALGORITHM'
export const PASSKEY_EXCLUDED = 'PASSKEY_EXCLUDED'

export function passkeyError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** The `code` a thrown passkey error carries, or '' for anything else. */
export function passkeyErrorCode(e: unknown): string {
  return (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string')
    ? (e as { code: string }).code
    : ''
}

/**
 * Flatten an error into `MMPK:<CODE>:<message>` for the trip back to the page.
 *
 * Electron's IPC strips custom error properties (the same reason web3-inject
 * re-derives EIP-1193 codes from the message) and the Android bridge only moves
 * strings — so the code has to ride inside the message or the shim cannot tell
 * "declined" from "wrong algorithm". passkey-shim.ts parses this back out.
 *
 * ⚠ Only a CODED error's message crosses to the page. Anything else becomes a
 * generic PASSKEY_REJECTED: "Wallet is locked — please unlock first" is a true
 * sentence we must not hand to an arbitrary site, and neither is a stack-shaped
 * internal failure. The shim maps both to NotAllowedError, which is what the
 * spec wants a site to see regardless.
 */
export function encodePasskeyError(e: unknown): string {
  const code = passkeyErrorCode(e)
  if (!code) return `MMPK:${PASSKEY_REJECTED}:The operation either timed out or was not allowed.`
  return `MMPK:${code}:${e instanceof Error ? e.message : String(e)}`
}

// ─── rpId ↔ origin ──────────────────────────────────────────────────────────

/**
 * A loopback origin is a "potentially trustworthy" origin even over http, which
 * is what makes local development possible. Capacitor also serves the wallet's
 * own WebView from https://localhost.
 */
function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]'
}

/**
 * WebAuthn's rule, properly: rpId must equal the origin's host, or be a
 * *registrable-domain* suffix of it.
 *
 * The registrable-domain part is the whole point and is why this uses a real
 * public suffix list (tldts, with private domains enabled, matching what
 * browsers do) rather than counting dots. Phase 2 shipped a host-suffix check
 * that would have let a page on `evil.co.uk` claim rpId `co.uk` — which would
 * have handed it every passkey minted by every other `*.co.uk` site. The same
 * hole covers `user.github.io` claiming `github.io`.
 *
 * An exact host match is always allowed, including for loopback and bare IPs,
 * because a site is unambiguously itself.
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
  if (host.length === 0) return false
  if (protocol !== 'https:' && !(protocol === 'http:' && isLoopbackHost(host))) return false

  const id = rpId.toLowerCase()
  if (host === id) return true
  if (!host.endsWith(`.${id}`)) return false

  // A suffix claim only counts when the claimed rpId is itself registrable.
  // `getDomain` returns null for a bare public suffix (co.uk, github.io, com).
  return parseHost(id, { allowPrivateDomains: true }).domain !== null
}

/**
 * The host to name in the approval dialog, or a thrown mismatch.
 *
 * ⚠ `origin` must always come from the tab's real URL, resolved natively. Never
 * pass a value that page script supplied — that is the whole reason this
 * function takes an origin instead of trusting the rpId on its own.
 */
export function requireSiteForRpId(rpId: string, origin: string): string {
  if (!rpIdMatchesOrigin(rpId, origin)) {
    throw passkeyError(PASSKEY_ORIGIN_MISMATCH, `${origin} may not use passkeys for “${rpId}”.`)
  }
  return new URL(origin).host
}

/**
 * The rpId to use when the page supplies none. Per spec that is the origin's
 * effective domain — the full host, not its registrable domain.
 */
export function defaultRpIdForOrigin(origin: string): string {
  return new URL(origin).hostname.toLowerCase()
}

// ─── Shared shapes ──────────────────────────────────────────────────────────

/** One discoverable credential, as recorded in the wallet's index. */
export interface PasskeyCredentialRecord {
  rpId: string
  /** base64url credentialId. Always re-verified against the MAC before use. */
  credentialId: string
  /** base64url of the RP-supplied `user.id`. May be '' for RPs that send none. */
  userHandle: string
  /** RP-supplied `user.name` — what the approval dialog shows the user. */
  userName: string
  accountIndex: number
  createdAt: number
}

export type PasskeyVerification = 'windows-hello' | 'touch-id' | 'android-biometric' | 'wallet-password'

export interface PasskeyAccount {
  accountIndex: number
  accountAddress?: string
}

/** One selectable identity in a discoverable sign-in with several candidates. */
export interface PasskeyChoice {
  /** Opaque id echoed back by the chooser — the base64url credentialId. */
  id: string
  /** Primary line: the username the site knows. */
  label: string
  /** Secondary line: which wallet account, and when it was created. */
  sublabel: string
}

export interface PasskeyApprovalRequest {
  ceremony: 'create' | 'get'
  site: string
  origin: string
  accountIndex: number
  accountAddress?: string
  userName?: string
  replacesExisting?: boolean
  /**
   * Present only when a discoverable sign-in matched more than one credential.
   * The dialog must then let the user pick, and echo the chosen id back.
   */
  choices?: PasskeyChoice[]
}

export interface PasskeyApprovalDecision {
  approved: boolean
  /** Which `PasskeyChoice.id` the user picked, when choices were offered. */
  choiceId?: string
}
