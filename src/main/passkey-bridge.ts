/**
 * passkey-bridge.ts — MagicMoney Wallet
 *
 * The wire format between the page shim and the ceremonies: base64url in,
 * base64url out, plus the two things the native side must decide for itself.
 *
 * ⚠ `origin` is a parameter of these functions and is NEVER read from the
 * payload. Callers pass the tab's real URL — `event.sender.getURL()` in Electron,
 * the chromium-authenticated `PageRequestEvent.origin` on Android. The payload
 * is page-controlled and is trusted only for the RP's own challenge, rp.id and
 * credential lists, each of which is either checked against the origin or fed
 * through the credentialId MAC before it can matter.
 *
 * Shared by Electron's IPC handlers and Android's dapp-glue so the two cannot
 * disagree about what a passkey response looks like.
 */

import { base64url, fromBase64url, COSE_ALG_ES256 } from './webauthn-authenticator'
import { runCreate, runAssert, hasCredentialFor, spkiFromP256, type PasskeyEnvironment } from './passkey-ceremony'

/** What a seed-derived credential reports. It is a platform authenticator on
 *  whichever device holds the seed — cross-device reach comes from the words,
 *  not from a transport, so claiming 'hybrid' would overstate it. */
const TRANSPORTS = ['internal']

export interface PasskeyWirePayload {
  challenge?: unknown
  rpId?: unknown
  userHandle?: unknown
  userName?: unknown
  userDisplayName?: unknown
  algorithms?: unknown
  excludeCredentials?: unknown
  allowCredentials?: unknown
  discoverable?: unknown
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)

function decodeList(v: unknown): Uint8Array[] {
  if (!Array.isArray(v)) return []
  const out: Uint8Array[] = []
  for (const item of v) {
    if (typeof item !== 'string') continue
    try { out.push(fromBase64url(item)) } catch { /* a malformed id simply never matches */ }
  }
  return out
}

function decodeRequired(v: unknown, what: string): Uint8Array {
  if (typeof v !== 'string') throw new TypeError(`${what} must be a base64url string`)
  return fromBase64url(v)
}

/** Registration. `origin` is native; everything else came from the page. */
export async function handlePasskeyCreate(
  env: PasskeyEnvironment, origin: string, payload: PasskeyWirePayload,
): Promise<Record<string, unknown>> {
  const result = await runCreate(env, {
    origin,
    rpId: str(payload.rpId),
    challenge: decodeRequired(payload.challenge, 'challenge'),
    userHandle: decodeRequired(payload.userHandle, 'user.id'),
    userName: typeof payload.userName === 'string' ? payload.userName.slice(0, 256) : '',
    algorithms: Array.isArray(payload.algorithms)
      ? payload.algorithms.map(Number).filter(n => Number.isFinite(n))
      : [],
    excludeCredentials: decodeList(payload.excludeCredentials),
    discoverable: payload.discoverable !== false,
  })

  return {
    credentialId: base64url(result.credentialId),
    attestationObject: base64url(result.attestationObject),
    authenticatorData: base64url(result.authData),
    clientDataJSON: base64url(result.clientDataJSON!),
    publicKeySpki: base64url(spkiFromP256(result.publicKey)),
    publicKeyAlgorithm: COSE_ALG_ES256,
    transports: TRANSPORTS,
  }
}

/** Authentication. `origin` is native; everything else came from the page. */
export async function handlePasskeyGet(
  env: PasskeyEnvironment, origin: string, payload: PasskeyWirePayload,
): Promise<Record<string, unknown>> {
  const result = await runAssert(env, {
    origin,
    rpId: str(payload.rpId),
    challenge: decodeRequired(payload.challenge, 'challenge'),
    allowCredentials: decodeList(payload.allowCredentials),
  })

  return {
    credentialId: base64url(result.credentialId),
    clientDataJSON: base64url(result.clientDataJSON!),
    authenticatorData: base64url(result.authenticatorData),
    signature: base64url(result.signature),
    userHandle: result.userHandle ? base64url(result.userHandle) : undefined,
  }
}

/** Silent "do I hold anything for this site?" — no prompt, no key material. */
export async function handlePasskeyProbe(
  env: PasskeyEnvironment, origin: string, payload: PasskeyWirePayload,
): Promise<{ available: boolean }> {
  return { available: await hasCredentialFor(env, origin, str(payload.rpId), decodeList(payload.allowCredentials)) }
}
