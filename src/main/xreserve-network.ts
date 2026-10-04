/**
 * xreserve-network.ts — the pinned constants of each xReserve Ethereum ⇄ Cardano
 * network, so every xReserve module can run on mainnet OR on Circle's
 * documented testnet pair without any constant coming from a caller.
 *
 * Every xReserve function takes an optional profile and defaults to MAINNET, so
 * existing mainnet callers are unchanged. A profile is chosen by the privileged
 * layer from the wallet's own environment — never from renderer input.
 *
 * Sources (read 2026-09-30):
 *   • Circle, supported blockchains and domains
 *     (developers.circle.com/xreserve/references/supported-blockchains-and-domains):
 *     Ethereum mainnet xReserve 0x8888888199b2Df864bf678259607d6D5EBb4e3Ce and USDC
 *     0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48; Ethereum Sepolia xReserve
 *     0x008888878f94C0d87defdf0B07f46B93C1934442 and USDC
 *     0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238; Cardano USDCx (mainnet
 *     1f3aec8b…5553444378, Preprod 31dde3db…5553444378); Cardano domain 10004.
 *   • Circle, "Deposit USDC into xReserve" quickstart (Cardano tab): Sepolia →
 *     Cardano Preprod, domain 10004 "works on testnet and mainnet".
 *   • Circle xReserve OpenAPI (developers.circle.com/openapi/xreserve.yaml):
 *     servers https://xreserve-api.circle.com (mainnet) and
 *     https://xreserve-api-testnet.circle.com (testnet).
 *   • CIP-19: Shelley address network nibble 1 = mainnet, 0 = testnets.
 */

import { CARDANO_USDCX_UNIT } from '../shared/swap-token-identity'

export type XReserveNetworkId = 'mainnet' | 'sepolia-preprod'

export interface XReserveNetwork {
  id: XReserveNetworkId
  ethereum: {
    /** EIP-155 chain id of the source chain. */
    chainId: number
    /** Human name for messages. */
    name: string
    /** Circle's xReserve contract on that chain. */
    xReserve: string
    /** Circle's USDC on that chain. */
    usdc: string
  }
  cardano: {
    /** Human name for messages. */
    name: string
    /** CIP-19 header network nibble. */
    networkId: 0 | 1
    /** bech32 human-readable prefix of payment addresses. */
    addressPrefix: 'addr' | 'addr_test'
    /** Circle's USDCx, by full unit (policy id + asset name). */
    usdcxUnit: string
  }
  /** xReserve remote domain for Cardano (the same on both networks). */
  cardanoDomain: number
  usdcDecimals: number
  /** Circle's xReserve API base URL. */
  circleApiBase: string
}

export const XRESERVE_MAINNET: XReserveNetwork = Object.freeze({
  id: 'mainnet',
  ethereum: Object.freeze({
    chainId: 1,
    name: 'Ethereum mainnet',
    xReserve: '0x8888888199b2Df864bf678259607d6D5EBb4e3Ce',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  }),
  cardano: Object.freeze({
    name: 'Cardano mainnet',
    networkId: 1,
    addressPrefix: 'addr',
    usdcxUnit: CARDANO_USDCX_UNIT.mainnet,
  }),
  cardanoDomain: 10004,
  usdcDecimals: 6,
  circleApiBase: 'https://xreserve-api.circle.com',
}) as XReserveNetwork

export const XRESERVE_SEPOLIA_PREPROD: XReserveNetwork = Object.freeze({
  id: 'sepolia-preprod',
  ethereum: Object.freeze({
    chainId: 11155111,
    name: 'Ethereum Sepolia',
    xReserve: '0x008888878f94C0d87defdf0B07f46B93C1934442',
    usdc: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  }),
  cardano: Object.freeze({
    name: 'Cardano Preprod',
    networkId: 0,
    addressPrefix: 'addr_test',
    usdcxUnit: CARDANO_USDCX_UNIT.preprod,
  }),
  cardanoDomain: 10004,
  usdcDecimals: 6,
  circleApiBase: 'https://xreserve-api-testnet.circle.com',
}) as XReserveNetwork

const PROFILES: Record<XReserveNetworkId, XReserveNetwork> = {
  'mainnet': XRESERVE_MAINNET,
  'sepolia-preprod': XRESERVE_SEPOLIA_PREPROD,
}

/**
 * Resolve a profile, accepting ONLY one of the two frozen objects above (or
 * undefined, meaning mainnet). A look-alike object from elsewhere is refused,
 * so a caller cannot smuggle in its own contract or token address.
 */
export function xreserveNetwork(network?: XReserveNetwork): XReserveNetwork {
  if (network === undefined) return XRESERVE_MAINNET
  if (network === XRESERVE_MAINNET || network === XRESERVE_SEPOLIA_PREPROD) return network
  throw new TypeError('Unknown xReserve network profile')
}

/** The profile for a wallet environment. */
export function xreserveNetworkFor(testnet: boolean): XReserveNetwork {
  return testnet ? XRESERVE_SEPOLIA_PREPROD : XRESERVE_MAINNET
}

export function xreserveNetworkById(id: unknown): XReserveNetwork | null {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PROFILES, id) ? PROFILES[id as XReserveNetworkId] : null
}
