/**
 * passkey-shim.ts — MagicMoney Wallet
 *
 * The page-world `navigator.credentials` shim: what finally makes passkeys work
 * inside Magic Money's own browser.
 *
 * Password managers only release site passkeys to browsers on their own
 * allowlist, and there is no API to join one — measured on a Galaxy S21+, where
 * Samsung Pass refuses an embedded WebView by name. So the wallet stops asking
 * and answers instead: this shim routes `create()` / `get()` to the wallet's own
 * seed-derived authenticator, which is the same core the Android system provider
 * (Phase 4) will use.
 *
 * ⚠ THE ORIGIN NEVER COMES FROM HERE. This file runs in the page's world, where
 * anything it computes is attacker-controlled on a hostile site. It sends the
 * page's *challenge* and *rp.id*, and the native side pins the origin from the
 * tab's real URL, rebuilds `clientDataJSON` around that origin, and rejects an
 * rpId the origin does not own. Anything this file said about the origin would
 * be worthless, so it says nothing.
 *
 * Runs identically in the Electron dApp browser (injected into the main world
 * from web3-inject via an esbuild IIFE) and the Android dApp WebView (bundled
 * into dapp-inject at document_start).
 */

/** Marshals one call to the wallet. Errors arrive encoded — see decodeError. */
export type PasskeyShimTransport = (
  type: 'passkey:create' | 'passkey:get' | 'passkey:probe',
  payload: Record<string, unknown>,
) => Promise<Record<string, unknown>>

// ── base64url ↔ bytes (the page speaks BufferSource, the wire speaks strings) ──

function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v
  if (v instanceof ArrayBuffer) return new Uint8Array(v)
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength)
  if (Array.isArray(v)) return Uint8Array.from(v as number[])
  throw new TypeError('Expected a BufferSource')
}

function b64u(v: unknown): string {
  const bytes = toBytes(v)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64u(s: string): ArrayBuffer {
  const b64 = String(s).replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64 + '==='.slice((b64.length + 3) % 4))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * The wire carries `MMPK:<CODE>:<message>` because Electron's IPC strips custom
 * error properties (the same reason web3-inject re-derives EIP-1193 codes from
 * the message) and the Android bridge only moves strings.
 */
const ERROR_PREFIX = 'MMPK:'

/**
 * Map to the DOMException names the spec uses.
 *
 * "Declined", "no such credential" and "biometric failed" ALL become
 * NotAllowedError. That is deliberate and load-bearing: the spec makes them
 * indistinguishable so a site cannot probe who holds an account, and every RP —
 * including chainlensnft.info — already branches on exactly this.
 */
function decodeError(raw: unknown): Error {
  const message = String((raw as { message?: unknown })?.message ?? raw ?? '')
    // Electron prefixes IPC rejections with the channel name.
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^Error:\s*/, '')

  const match = /^MMPK:([A-Z_]+):([\s\S]*)$/.exec(message)
  const code = match ? match[1] : ''
  const text = match ? match[2] : message

  const name =
    code === 'PASSKEY_EXCLUDED' ? 'InvalidStateError'
    : code === 'PASSKEY_UNSUPPORTED_ALGORITHM' ? 'NotSupportedError'
    : code === 'PASSKEY_ORIGIN_MISMATCH' ? 'SecurityError'
    : 'NotAllowedError'

  try {
    return new DOMException(text || 'The operation either timed out or was not allowed.', name)
  } catch {
    const e = new Error(text)
    e.name = name
    return e
  }
}

const abortError = (): Error => {
  try {
    return new DOMException('The operation was aborted.', 'AbortError')
  } catch {
    const e = new Error('The operation was aborted.')
    e.name = 'AbortError'
    return e
  }
}

/** Reject as soon as the caller's AbortSignal fires, without leaking a listener. */
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

// ── Option marshalling ───────────────────────────────────────────────────────

interface AnyRecord { [k: string]: unknown }

const idsOf = (list: unknown): string[] =>
  Array.isArray(list)
    ? list.map(c => { try { return b64u((c as AnyRecord)?.id) } catch { return '' } }).filter(Boolean)
    : []

/**
 * Is the RP asking for a discoverable (username-less) credential? `residentKey`
 * supersedes the legacy `requireResidentKey`, and we default to discoverable
 * because a credential we cannot enumerate is one the user can never pick from
 * the account chooser.
 */
function wantsDiscoverable(sel: AnyRecord | undefined): boolean {
  if (!sel) return true
  if (typeof sel.residentKey === 'string') return sel.residentKey !== 'discouraged'
  if (typeof sel.requireResidentKey === 'boolean') return sel.requireResidentKey
  return true
}

// ── The credential objects handed back to the page ───────────────────────────

/**
 * Give the result `PublicKeyCredential`'s prototype where one exists, so an RP
 * doing `instanceof` is satisfied. Own data properties shadow every native
 * accessor, so no internal-slot getter ever runs on an object that has no slots.
 */
function brand(obj: object): void {
  try {
    const proto = (globalThis as AnyRecord).PublicKeyCredential as { prototype?: object } | undefined
    if (proto?.prototype) Object.setPrototypeOf(obj, proto.prototype)
  } catch { /* branding is a nicety, never a requirement */ }
}

function makeRegistrationCredential(r: AnyRecord): object {
  const rawId = fromB64u(String(r.credentialId))
  const attestationObject = fromB64u(String(r.attestationObject))
  const clientDataJSON = fromB64u(String(r.clientDataJSON))
  const authenticatorData = fromB64u(String(r.authenticatorData))
  const publicKey = r.publicKeySpki ? fromB64u(String(r.publicKeySpki)) : null
  const transports = Array.isArray(r.transports) ? (r.transports as string[]) : ['internal']

  const response = {
    clientDataJSON,
    attestationObject,
    getTransports: () => transports.slice(),
    getAuthenticatorData: () => authenticatorData,
    getPublicKey: () => publicKey,
    getPublicKeyAlgorithm: () => Number(r.publicKeyAlgorithm ?? -7),
  }

  const cred = {
    id: String(r.credentialId),
    rawId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response,
    getClientExtensionResults: () => ({}),
    toJSON: () => ({
      id: String(r.credentialId),
      rawId: String(r.credentialId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(new Uint8Array(clientDataJSON)),
        attestationObject: b64u(new Uint8Array(attestationObject)),
        authenticatorData: b64u(new Uint8Array(authenticatorData)),
        transports: transports.slice(),
        publicKey: r.publicKeySpki ? String(r.publicKeySpki) : undefined,
        publicKeyAlgorithm: Number(r.publicKeyAlgorithm ?? -7),
      },
    }),
  }
  brand(cred)
  return cred
}

function makeAssertionCredential(r: AnyRecord): object {
  const rawId = fromB64u(String(r.credentialId))
  const clientDataJSON = fromB64u(String(r.clientDataJSON))
  const authenticatorData = fromB64u(String(r.authenticatorData))
  const signature = fromB64u(String(r.signature))
  const userHandle = r.userHandle ? fromB64u(String(r.userHandle)) : null

  const cred = {
    id: String(r.credentialId),
    rawId,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: { clientDataJSON, authenticatorData, signature, userHandle },
    getClientExtensionResults: () => ({}),
    toJSON: () => ({
      id: String(r.credentialId),
      rawId: String(r.credentialId),
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(new Uint8Array(clientDataJSON)),
        authenticatorData: b64u(new Uint8Array(authenticatorData)),
        signature: b64u(new Uint8Array(signature)),
        userHandle: userHandle ? b64u(new Uint8Array(userHandle)) : undefined,
      },
    }),
  }
  brand(cred)
  return cred
}

// ── Install ──────────────────────────────────────────────────────────────────

export const PASSKEY_SHIM_FLAG = '__MAGICMONEY_PASSKEY_INSTALLED__'

export function installPasskeyShim(send: PasskeyShimTransport): void {
  const g = globalThis as AnyRecord
  if (g[PASSKEY_SHIM_FLAG]) return
  try {
    Object.defineProperty(g, PASSKEY_SHIM_FLAG, { value: true, configurable: false, enumerable: false })
  } catch {
    g[PASSKEY_SHIM_FLAG] = true
  }

  const nav = g.navigator as AnyRecord | undefined
  if (!nav) return

  // An Android WebView without setWebAuthenticationSupport has no
  // `navigator.credentials` at all, so there may be nothing here to wrap.
  let container = nav.credentials as AnyRecord | undefined
  if (!container) {
    container = {}
    try {
      Object.defineProperty(nav, 'credentials', { value: container, configurable: true, enumerable: false })
    } catch {
      nav.credentials = container
    }
  }

  const originalCreate = typeof container.create === 'function'
    ? (container.create as (o?: unknown) => Promise<unknown>).bind(container) : null
  const originalGet = typeof container.get === 'function'
    ? (container.get as (o?: unknown) => Promise<unknown>).bind(container) : null

  async function create(options?: AnyRecord): Promise<unknown> {
    // Password / federated credentials are none of our business — hand them to
    // whatever the engine already had.
    const pk = options?.publicKey as AnyRecord | undefined
    if (!pk) return originalCreate ? originalCreate(options) : null

    const user = (pk.user ?? {}) as AnyRecord
    const sel = pk.authenticatorSelection as AnyRecord | undefined
    const payload = {
      challenge: b64u(pk.challenge),
      rpId: typeof (pk.rp as AnyRecord)?.id === 'string' ? (pk.rp as AnyRecord).id : undefined,
      userHandle: b64u(user.id),
      userName: String(user.name ?? ''),
      userDisplayName: typeof user.displayName === 'string' ? user.displayName : undefined,
      algorithms: Array.isArray(pk.pubKeyCredParams)
        ? (pk.pubKeyCredParams as AnyRecord[]).map(p => Number(p?.alg)).filter(n => Number.isFinite(n))
        : [],
      excludeCredentials: idsOf(pk.excludeCredentials),
      discoverable: wantsDiscoverable(sel),
    }

    const result = await withAbort(
      send('passkey:create', payload).catch(e => { throw decodeError(e) }),
      options?.signal as AbortSignal | undefined,
    )
    return makeRegistrationCredential(result)
  }

  async function get(options?: AnyRecord): Promise<unknown> {
    const pk = options?.publicKey as AnyRecord | undefined
    if (!pk) return originalGet ? originalGet(options) : null

    // Conditional mediation is browser-autofill UI we do not implement. The spec
    // says such a request must not prompt, so refusing quietly is the correct
    // behaviour — a dialog here would be exactly what the RP asked us not to do.
    if (options?.mediation === 'conditional') throw decodeError('MMPK:PASSKEY_NO_CREDENTIAL:')

    const payload = {
      challenge: b64u(pk.challenge),
      rpId: typeof pk.rpId === 'string' ? pk.rpId : undefined,
      allowCredentials: idsOf(pk.allowCredentials),
    }

    const result = await withAbort(
      send('passkey:get', payload).catch(e => { throw decodeError(e) }),
      options?.signal as AbortSignal | undefined,
    )
    return makeAssertionCredential(result)
  }

  try {
    Object.defineProperty(container, 'create', { value: create, configurable: true, writable: true })
    Object.defineProperty(container, 'get', { value: get, configurable: true, writable: true })
  } catch {
    container.create = create
    container.get = get
  }

  // Feature detection: sites gate the whole passkey UI on these existing and on
  // isUVPAA() resolving true. A WebView that never had PublicKeyCredential needs
  // the constructor to exist at all before any of that runs.
  const existing = g.PublicKeyCredential as (AnyRecord & { prototype?: object }) | undefined
  const ctor = existing ?? function PublicKeyCredential() { throw new TypeError('Illegal constructor') } as unknown as AnyRecord
  ;(ctor as AnyRecord).isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(true)
  ;(ctor as AnyRecord).isConditionalMediationAvailable = () => Promise.resolve(false)
  if (!existing) {
    try {
      Object.defineProperty(g, 'PublicKeyCredential', { value: ctor, configurable: true, writable: true })
    } catch {
      g.PublicKeyCredential = ctor
    }
  }
}

export { ERROR_PREFIX as PASSKEY_ERROR_PREFIX, decodeError as decodePasskeyShimError }
