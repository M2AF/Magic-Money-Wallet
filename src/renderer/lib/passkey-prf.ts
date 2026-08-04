/**
 * passkey-prf.ts — WebAuthn PRF ceremony: turn a passkey into 32 bytes of
 * authenticator-bound entropy, which wallet-core then turns into an ordinary
 * BIP-39 phrase. This is the mechanism behind Mera (@category-labs/mera).
 *
 * VENDORED, not depended on. mera is 0.1.0 with a self-declared unstable API,
 * and this sits in the wallet's key-generation path — the ~60 lines we actually
 * need are cheaper to own than to pin. The salt below is mera's documented
 * default, so a phrase generated here is reproducible by any mera-based app
 * using the same rpId. Changing SALT_INPUT changes every derived wallet: don't.
 *
 * BROWSER CONTEXT ONLY. Requires a secure origin whose host matches rpId, so:
 *   Electron  — cannot run in the packaged file:// renderer; main serves a
 *               loopback page (see main/passkey-window.ts) and rpId is
 *               'localhost'.
 *   Android   — the WebView already runs on https://localhost.
 *   Extension — chrome-extension:// cannot claim an https rpId.
 *   iOS       — needs the Associated Domains entitlement (paid Apple account).
 *
 * MEASURED BEHAVIOUR (2026-08-04, Win11 26220, Electron 43 / Chrome 151 / VS
 * Code Electron 42): create() returns PRF output reliably, but an assertion
 * that ASKS for PRF fails with NotAllowedError on all three, while the same
 * assertion without the prf extension succeeds. Windows Hello there mints PRF
 * at registration but will not evaluate it at assertion. Hence
 * `verifyReproducible()`: callers must feature-detect rather than assume a
 * passkey can restore a wallet, and must never present the passkey as a
 * substitute for writing the seed phrase down.
 */

/** mera's documented default salt: sha256("mera.prf.salt.v1"). */
const SALT_INPUT = 'mera.prf.salt.v1'

/** Metadata needed to ask the same passkey for its PRF output again. */
export interface PasskeyCredential {
  /** base64url credential id. */
  id: string
  /** Transport hints reported at creation, used to target the assertion. */
  transports: string[]
}

export interface PasskeyPrfResult {
  /** 32 bytes of authenticator-bound entropy. */
  prf: Uint8Array
  credential: PasskeyCredential
}

export class PasskeyPrfError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED' | 'PRF_UNAVAILABLE' | 'CANCELLED' | 'FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'PasskeyPrfError'
  }
}

function b64urlEncode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// These three feed WebAuthn's BufferSource fields, which since TS 5.7 require
// the ArrayBuffer-backed form specifically — hence the explicit type argument.
function b64urlDecode(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0))
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n)
  crypto.getRandomValues(b)
  return b
}

async function prfSalt(): Promise<Uint8Array<ArrayBuffer>> {
  const input = new TextEncoder().encode(SALT_INPUT)
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input))
}

/** Pull the first PRF output off a credential, if the authenticator gave one. */
function readPrf(credential: PublicKeyCredential): Uint8Array | null {
  const results = credential.getClientExtensionResults() as {
    prf?: { enabled?: boolean; results?: { first?: BufferSource } }
  }
  const first = results.prf?.results?.first
  if (!first) return null
  const bytes = first instanceof ArrayBuffer
    ? new Uint8Array(first)
    : new Uint8Array((first as ArrayBufferView).buffer,
                     (first as ArrayBufferView).byteOffset,
                     (first as ArrayBufferView).byteLength)
  // A short/oversized output would silently weaken or reshape the seed.
  return bytes.length === 32 ? new Uint8Array(bytes) : null
}

function wrap(e: unknown): PasskeyPrfError {
  if (e instanceof PasskeyPrfError) return e
  const err = e as { name?: string; message?: string }
  if (err?.name === 'NotAllowedError') {
    return new PasskeyPrfError('CANCELLED', 'Passkey prompt was dismissed or refused by the device.')
  }
  return new PasskeyPrfError('FAILED', err?.message || String(e))
}

/** Is a WebAuthn PRF ceremony even possible here? Shows no prompt. */
export async function isPasskeySupported(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !window.isSecureContext) return false
    if (typeof PublicKeyCredential === 'undefined') return false
    if (!await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) return false
    // Chromium reports extension support without a ceremony; when the method is
    // missing we can't tell, so we let the user try rather than hide the option.
    const caps = (PublicKeyCredential as unknown as {
      getClientCapabilities?: () => Promise<Record<string, boolean>>
    }).getClientCapabilities
    if (!caps) return true
    const capabilities = await caps.call(PublicKeyCredential)
    return capabilities['extension:prf'] !== false
  } catch {
    return false
  }
}

/**
 * Create a passkey and take its PRF output. One user-verification prompt; some
 * authenticators need a second (fallback assertion) because they don't evaluate
 * PRF during creation.
 *
 * The credential is discoverable and user-verified — both are required for the
 * passkey to be findable and for PRF to be released at all. `user.id` is fresh
 * random bytes every call so a second wallet ADDS a passkey rather than
 * overwriting the first (authenticators key discoverable credentials on
 * rp.id + user.id).
 */
export async function createPasskeyPrf(opts: {
  rpId: string
  rpName: string
  userName: string
  userDisplayName: string
  timeout?: number
}): Promise<PasskeyPrfResult> {
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) {
    throw new PasskeyPrfError('UNSUPPORTED', 'This build cannot run WebAuthn (no secure origin).')
  }
  const salt = await prfSalt()
  try {
    const created = await navigator.credentials.create({
      publicKey: {
        rp: { id: opts.rpId, name: opts.rpName },
        user: {
          id: randomBytes(32),
          name: opts.userName,
          displayName: opts.userDisplayName,
        },
        challenge: randomBytes(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },   // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        attestation: 'none',
        authenticatorSelection: {
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required',
        },
        ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
        extensions: { prf: { eval: { first: salt } } },
      },
    }) as PublicKeyCredential | null

    if (!created) throw new PasskeyPrfError('FAILED', 'The device returned no credential.')

    const response = created.response as AuthenticatorAttestationResponse
    const credential: PasskeyCredential = {
      id: b64urlEncode(new Uint8Array(created.rawId)),
      transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
    }

    const atCreate = readPrf(created)
    if (atCreate) return { prf: atCreate, credential }

    // Fallback: the passkey exists but didn't evaluate PRF inline. Ask it
    // directly — this is the path mera documents as a second prompt.
    const viaAssertion = await getPasskeyPrf({
      rpId: opts.rpId,
      credential,
      timeout: opts.timeout,
    })
    return { prf: viaAssertion, credential }
  } catch (e) {
    throw wrap(e)
  }
}

/**
 * Ask an existing passkey for the same 32 bytes again — the operation that
 * reproduces a wallet. Fails on stacks that mint PRF but won't evaluate it at
 * assertion (see the header note), so treat failure as "not reproducible here",
 * not as data loss.
 */
export async function getPasskeyPrf(opts: {
  rpId: string
  /** Omit to let the platform offer any discoverable passkey for this rpId. */
  credential?: PasskeyCredential
  timeout?: number
}): Promise<Uint8Array> {
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) {
    throw new PasskeyPrfError('UNSUPPORTED', 'This build cannot run WebAuthn (no secure origin).')
  }
  const salt = await prfSalt()
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        rpId: opts.rpId,
        challenge: randomBytes(32),
        userVerification: 'required',
        ...(opts.credential
          ? {
              allowCredentials: [{
                type: 'public-key' as const,
                id: b64urlDecode(opts.credential.id),
                ...(opts.credential.transports.length
                  ? { transports: opts.credential.transports as AuthenticatorTransport[] }
                  : {}),
              }],
            }
          : {}),
        ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
        extensions: { prf: { eval: { first: salt } } },
      },
    }) as PublicKeyCredential | null

    if (!assertion) throw new PasskeyPrfError('FAILED', 'The device returned no assertion.')
    const prf = readPrf(assertion)
    if (!prf) {
      throw new PasskeyPrfError('PRF_UNAVAILABLE',
        'This passkey did not return PRF output — it cannot reproduce a wallet.')
    }
    return prf
  } catch (e) {
    throw wrap(e)
  }
}

/**
 * After creating a passkey, check whether it can actually reproduce the same
 * entropy on this device. Never throws: a false result is a supported outcome
 * (Windows Hello on 26220 behaves exactly this way) and only means the UI must
 * tell the user their seed phrase is the sole recovery path.
 */
export async function verifyReproducible(
  rpId: string,
  credential: PasskeyCredential,
  expected: Uint8Array,
): Promise<boolean> {
  try {
    const again = await getPasskeyPrf({ rpId, credential })
    if (again.length !== expected.length) return false
    // Length-equal compare; not attacker-facing, but constant-time is free here.
    let diff = 0
    for (let i = 0; i < again.length; i++) diff |= again[i]! ^ expected[i]!
    return diff === 0
  } catch {
    return false
  }
}
