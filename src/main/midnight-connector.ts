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
