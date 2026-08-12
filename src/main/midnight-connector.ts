/**
 * midnight-connector.ts — Midnight DApp Connector API (shared, pure-ish)
 *
 * Until now Midnight was receive/balance/send only: no `window.midnight`, so no
 * Midnight dApp could detect this wallet at all. This module supplies the
 * wallet-side logic for both generations of the connector API, because the
 * ecosystem is mid-migration and shipping only one would strand half of it:
 *
 *   • Legacy (`@midnight-ntwrk/dapp-connector-api` ≤ 3.x) — `window.midnight.<name>`
 *     with enable() / state() / serviceUriConfig(). Most live dApps still use it.
 *   • Current (4.x) — `window.midnight[<uuid>]` with rdns + connect(networkId)
 *     and granular shielded/unshielded/DUST getters.
 *
 * DELIBERATELY free of any @midnightntwrk/* import. Everything that touches the
 * ledger WASM stays behind the IPC boundary in the caller. Lace documents why
 * and it applies to us verbatim: a static import of that graph compiles WASM on
 * every page the injection touches, and any page whose CSP lacks
 * `wasm-unsafe-eval` then aborts the ENTIRE injected script — which on our
 * targets would take the VESPR Cardano announcement down with it.
 */

import { bech32m } from '@scure/base'
import type { WalletConfig } from './secure-store'
import { midnightNetworkFor } from './chain-config'

export type MidnightNetwork = 'mainnet' | 'preprod'

/** Service endpoints a dApp needs to talk to the same network we are on. */
export interface MidnightServiceUris {
  indexerUri: string
  indexerWsUri: string
  /** Absent on purpose — see PROVER_NOTE. */
  proverServerUri?: string
  substrateNodeUri: string
  networkId: string
}

/**
 * We do NOT advertise a prover server.
 *
 * The Midnight SDK's default is a REMOTE prover, which would mean shipping
 * witness data — the private inputs of a shielded transaction — off the device.
 * This wallet proves locally in WASM instead (see midnight-proving-keys.ts), so
 * there is no URI to hand out. A dApp that insists on one can supply its own,
 * which is its choice to make explicitly rather than ours to make silently.
 */
export const PROVER_NOTE =
  'MagicMoney proves locally and does not expose a prover server.'

const ENDPOINTS: Record<MidnightNetwork, MidnightServiceUris> = {
  mainnet: {
    indexerUri:      'https://indexer.mainnet.midnight.network/api/v4/graphql',
    indexerWsUri:    'wss://indexer.mainnet.midnight.network/api/v4/graphql/ws',
    substrateNodeUri: 'https://rpc.mainnet.midnight.network',
    networkId:       'mainnet',
  },
  preprod: {
    indexerUri:      'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWsUri:    'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    substrateNodeUri: 'https://rpc.preprod.midnight.network',
    networkId:       'preprod',
  },
}

export function midnightServiceUris(network: MidnightNetwork): MidnightServiceUris {
  return { ...ENDPOINTS[network] }
}

// ── Network availability ─────────────────────────────────────────────────────

export class MidnightUnavailableError extends Error {
  readonly code = -2   // ErrorCodes.InternalError in the connector spec
  constructor(message: string) {
    super(message)
    this.name = 'MidnightUnavailableError'
  }
}

/**
 * Which Midnight network we can serve, or a clear explanation of why we cannot.
 *
 * Midnight has no manual network switcher — it rides Testnet Mode (Preprod) and
 * Privacy Mode (Mainnet). With neither on, the wallet has no Midnight keys
 * derived at all, so a dApp asking to connect must be told what to turn on
 * rather than getting an opaque failure.
 */
export function activeMidnightNetwork(config: WalletConfig): MidnightNetwork {
  const network = midnightNetworkFor(config)
  if (!network) {
    throw new MidnightUnavailableError(
      'Midnight is not enabled in this wallet. Turn on Privacy Mode (Mainnet) '
      + 'or Testnet Mode (Preprod) in Settings, then reconnect.'
    )
  }
  return network
}

/**
 * Validate the network a 4.x dApp asked for against the one we are actually on.
 *
 * Connecting a Preprod dApp to a Mainnet wallet (or vice versa) produces
 * transactions that are silently invalid, so fail fast and say which is which.
 */
export function assertNetworkSupported(requested: string | undefined, active: MidnightNetwork): void {
  if (!requested) return
  const want = requested.toLowerCase()
  // Accept the aliases dApps use for the two networks this wallet serves.
  const aliases: Record<string, MidnightNetwork> = {
    mainnet: 'mainnet', main: 'mainnet',
    preprod: 'preprod', testnet: 'preprod', 'pre-prod': 'preprod',
  }
  const resolved = aliases[want]
  if (!resolved) {
    // 'preview' and 'undeployed' are real Midnight networks we do not serve.
    // Say so specifically — "unknown network" would read as a wallet bug when
    // it is really a network we have not shipped support for.
    if (want === 'preview' || want === 'undeployed') {
      throw new MidnightUnavailableError(
        `This dApp wants Midnight ${want}, which MagicMoney does not support. `
        + 'The wallet supports Mainnet (Privacy Mode) and Preprod (Testnet Mode).'
      )
    }
    throw new MidnightUnavailableError(`Unknown Midnight network "${requested}".`)
  }
  if (resolved !== active) {
    throw new MidnightUnavailableError(
      `This dApp wants Midnight ${resolved}, but the wallet is on ${active}. `
      + (resolved === 'preprod'
        ? 'Turn on Testnet Mode in Settings to use Preprod.'
        : 'Turn on Privacy Mode in Settings to use Mainnet.')
    )
  }
}

// ── Wallet state ─────────────────────────────────────────────────────────────

export interface MidnightAddressSet {
  unshielded?: string
  shielded?: string
  dust?: string
}

/**
 * Legacy `state()` payload.
 *
 * The `*Legacy` duplicates are required by the ≤3.x interface, which carried
 * both a legacy and a current encoding of each value during its own migration.
 * We derive one encoding, so both fields carry it.
 */
export interface MidnightLegacyState {
  address: string
  addressLegacy: string
  coinPublicKey: string
  coinPublicKeyLegacy: string
  encryptionPublicKey: string
  encryptionPublicKeyLegacy: string
}

/**
 * Split a shielded address into its two component public keys, hex-encoded.
 *
 * `getShieldedAddresses` must return the coin and encryption public keys
 * SEPARATELY — a dApp needs them to build a shielded output to this wallet, and
 * an address string is not a key. We previously returned the address three
 * times, which dApps either reject or silently mis-encode.
 *
 * Hex, not Bech32m: the spec's prose says Bech32m but the reference codec
 * (`ShieldedAddress.coinPublicKeyString()`) returns hex, and live dApps branch
 * on the fields matching /^[0-9a-f]*$/ — verified byte-for-byte against
 * @midnightntwrk/wallet-sdk-address-format. Following the prose would take the
 * fallback path everywhere.
 *
 * The payload is coinPublicKey ++ encryptionPublicKey, 32 bytes each, exactly
 * as computeMidnightAddresses assembles it.
 */
export function splitShieldedAddress(shielded: string | undefined): {
  coinPublicKey?: string
  encryptionPublicKey?: string
} {
  if (!shielded) return {}
  try {
    const { words } = bech32m.decode(shielded as `${string}1${string}`, 400)
    const payload = Buffer.from(bech32m.fromWords(words))
    // Anything else is not a shielded address; say nothing rather than hand a
    // dApp half a key.
    if (payload.length !== 64) return {}
    return {
      coinPublicKey: payload.subarray(0, 32).toString('hex'),
      encryptionPublicKey: payload.subarray(32, 64).toString('hex'),
    }
  } catch {
    return {}
  }
}

export function buildLegacyState(addresses: MidnightAddressSet): MidnightLegacyState {
  const address = addresses.unshielded ?? ''
  // The shielded address is the concatenated coin + encryption public keys; we
  // do not split it, so report it for both rather than inventing a division.
  const shielded = addresses.shielded ?? ''
  return {
    address,
    addressLegacy: address,
    coinPublicKey: shielded,
    coinPublicKeyLegacy: shielded,
    encryptionPublicKey: shielded,
    encryptionPublicKeyLegacy: shielded,
  }
}

/** 1 NIGHT = 1e6 Stars; 1 DUST = 1e15 Specks. */
export const STARS_PER_NIGHT = 1_000_000n
export const SPECKS_PER_DUST = 1_000_000_000_000_000n

/** The all-zero token type is native NIGHT. */
export const NIGHT_TOKEN_TYPE = '00'.repeat(32)

export function nightToStars(night: number | string): bigint {
  const value = typeof night === 'string' ? Number(night) : night
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Amount must be greater than 0')
  }
  // Round rather than truncate so 0.1 NIGHT doesn't become 99999 Stars.
  return BigInt(Math.round(value * Number(STARS_PER_NIGHT)))
}

// ── Approval prompt text ─────────────────────────────────────────────────────

export function formatMidnightConnect(
  origin: string, network: MidnightNetwork, addresses: MidnightAddressSet
): string {
  return [
    `Network:\n  Midnight ${network === 'preprod' ? 'Preprod (testnet)' : 'Mainnet'}`,
    '',
    `Unshielded (NIGHT):\n  ${addresses.unshielded ?? 'Not available'}`,
    `Shielded:\n  ${addresses.shielded ?? 'Not available'}`,
    '',
    'This site will be able to:',
    '  • see your Midnight addresses and NIGHT balance',
    '  • ask you to approve transfers',
    '',
    'Every transfer still needs your approval.',
    PROVER_NOTE,
  ].join('\n')
}

// ── signData payload ─────────────────────────────────────────────────────────

/**
 * Turn a connector signData payload into the exact bytes to sign, plus the text
 * to show the user.
 *
 * The display string is derived FROM THE BYTES, never taken as a separate field
 * alongside them: a page that could send bytes and an unrelated "here is what
 * that says" caption would be able to show a benign message and have a
 * different one signed. What is rendered here is a decoding of what is signed,
 * so the two cannot diverge.
 */
export function decodeMidnightSignPayload(
  payload: unknown, encoding?: string
): { bytes: Uint8Array; display: string; text: string | null } {
  const bytes = toSignBytes(payload, encoding)
  if (bytes.length === 0) throw new Error('Nothing to sign: the payload is empty.')
  const text = readableText(bytes)
  return { bytes, display: text ?? describeSignBytes(bytes), text }
}

/**
 * The payload as a human-readable message, or null if it is really binary.
 *
 * This is the hinge of the signing-oracle defence, so it is deliberately
 * conservative: valid UTF-8 AND free of control characters. A Midnight
 * transaction segment is a serialization of hashes, keys and amounts — for one
 * to pass this check every single byte would have to land in the printable
 * range, which a dApp cannot arrange for content it does not fully control.
 * See signMidnightData for what rides on the distinction.
 */
function readableText(bytes: Uint8Array): string | null {
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return null
  }
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(decoded) ? null : decoded
}

function toSignBytes(payload: unknown, encoding?: string): Uint8Array {
  if (payload instanceof Uint8Array) return payload
  // Byte arrays arrive over IPC as plain arrays (structured clone drops the
  // Uint8Array view for some senders), so accept both.
  if (Array.isArray(payload) && payload.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) {
    return Uint8Array.from(payload as number[])
  }
  if (typeof payload !== 'string') {
    throw new Error('Unsupported Midnight signData payload — expected a string or bytes.')
  }
  const enc = (encoding ?? '').toLowerCase()
  if (enc === 'text' || enc === 'utf8' || enc === 'utf-8') return new TextEncoder().encode(payload)
  // Validate STRICTLY before decoding. Buffer's hex/base64 decoders are
  // lenient: they silently stop at (or skip) the first invalid character
  // rather than throwing. A dApp could then send a long plausible-looking
  // string, have the prompt render its decoding, and get a signature over only
  // a short attacker-chosen prefix of it.
  if (enc === 'hex') {
    const bare = payload.startsWith('0x') ? payload.slice(2) : payload
    if (bare.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(bare)) {
      throw new Error('Midnight signData payload is not valid hex.')
    }
    return Uint8Array.from(Buffer.from(bare, 'hex'))
  }
  if (enc === 'base64') {
    // RFC 4648 alphabet, padding only at the end, in 4-character groups.
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
      throw new Error('Midnight signData payload is not valid base64.')
    }
    return Uint8Array.from(Buffer.from(payload, 'base64'))
  }
  if (enc) throw new Error(`Unsupported Midnight signData encoding "${encoding}".`)
  // No encoding given. Treating a bare string as text is the safe default: the
  // alternative (guessing hex whenever it happens to look like hex) would sign
  // different bytes than the user was shown for a message like "deadbeef".
  return new TextEncoder().encode(payload)
}

/** Render bytes for the approval prompt: readable text when they are text. */
function describeSignBytes(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  let decoded: string
  try {
    decoded = text.decode(bytes)
  } catch {
    return `${bytes.length} bytes (binary):\n  ${Buffer.from(bytes).toString('hex')}`
  }
  // Control characters other than tab/newline mean it is not really a message —
  // show the hex instead of letting them mangle the prompt.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(decoded)) {
    return `${bytes.length} bytes (binary):\n  ${Buffer.from(bytes).toString('hex')}`
  }
  return decoded
}

export function formatMidnightSignData(
  display: string, network: MidnightNetwork
): string {
  return [
    'Message:',
    display.split('\n').map(line => `  ${line}`).join('\n'),
    '',
    `Signed with     your unshielded (NIGHT) key`,
    `Network         Midnight ${network === 'preprod' ? 'Preprod (testnet)' : 'Mainnet'}`,
    '',
    'This proves you control the address. It does not move any funds.',
    'Only sign messages from a site you trust.',
  ].join('\n')
}

export function formatMidnightTransfer(
  to: string, amountStars: bigint, network: MidnightNetwork
): string {
  const whole = amountStars / STARS_PER_NIGHT
  const frac = (amountStars % STARS_PER_NIGHT).toString().padStart(6, '0').replace(/0+$/, '')
  return [
    `You send        ${whole}${frac ? `.${frac}` : ''} NIGHT`,
    `To              ${to}`,
    `Network         Midnight ${network === 'preprod' ? 'Preprod (testnet)' : 'Mainnet'}`,
    '',
    'Fees are paid in DUST, generated by the NIGHT you already hold.',
  ].join('\n')
}
