/**
 * address-validate.ts — per-chain recipient address validation (audit H-3).
 *
 * Used by the Send form (wallet:validate-address IPC) so a mistyped or
 * wrong-chain address fails at the input field with a clear message instead of
 * surfacing later as a raw provider error at fee-estimation or broadcast.
 *
 * Every check is a REAL decode of the format the corresponding sender can pay
 * to — the same libraries the signing paths use — not a regex approximation:
 *   EVM       viem isAddress (EIP-55 checksum enforced on mixed-case input)
 *   Solana    base58 → 32-byte ed25519 pubkey
 *   Cardano   bech32 payment address, network-header checked (tx-sender builds
 *             outputs for Shelley addresses; Byron base58 is rejected)
 *   Bitcoin   @scure/btc-signer Address decoder (bech32/bech32m/base58check —
 *             covers bc1q/bc1p/3…/1…, tb1… etc. on testnet)
 *   Dogecoin  base58check with the version bytes dogecoin.ts can encode
 *   Tron      base58check, 0x41-prefixed 21-byte payload
 */

import { isAddress } from 'viem'
import { base58, bech32 } from '@scure/base'
import { sha256 } from '@noble/hashes/sha256'
import * as btc from '@scure/btc-signer'
import { validateMoneroAddress } from './monero-pure'
import { validateZcashTransparent } from './zcash'

export interface AddressValidation {
  valid: boolean
  reason?: string   // user-facing, present when valid === false
}

const ok: AddressValidation = { valid: true }
const bad = (reason: string): AddressValidation => ({ valid: false, reason })

// base58check → payload (version byte included), or null when malformed.
function base58CheckDecode(address: string): Uint8Array | null {
  try {
    const raw = base58.decode(address)
    if (raw.length < 5) return null
    const payload = raw.slice(0, -4)
    const checksum = raw.slice(-4)
    const expect = sha256(sha256(payload)).slice(0, 4)
    for (let i = 0; i < 4; i++) if (checksum[i] !== expect[i]) return null
    return payload
  } catch {
    return null
  }
}

function validateSolana(address: string): AddressValidation {
  try {
    if (base58.decode(address).length !== 32) return bad('Not a valid Solana address')
    return ok
  } catch {
    return bad('Not a valid Solana address')
  }
}

function validateCardano(address: string, testnet: boolean): AddressValidation {
  const expectPrefix = testnet ? 'addr_test' : 'addr'
  let decoded: { prefix: string; words: number[] }
  try {
    decoded = bech32.decode(address as `${string}1${string}`, 1000)
  } catch {
    // Byron-era base58 addresses (Ae2…/DdzFF…) decode as base58check but our
    // tx builder only produces Shelley outputs — reject with a specific hint.
    if (base58CheckDecode(address)) return bad('Byron-era Cardano addresses are not supported — use a Shelley address (addr1…)')
    return bad(testnet ? 'Not a valid Cardano testnet address (addr_test1…)' : 'Not a valid Cardano address (addr1…)')
  }
  if (decoded.prefix === (testnet ? 'addr' : 'addr_test')) {
    return bad(testnet ? 'That is a Cardano MAINNET address — Testnet Mode is on' : 'That is a Cardano TESTNET address')
  }
  if (decoded.prefix !== expectPrefix) {
    return bad(decoded.prefix.startsWith('stake')
      ? 'That is a stake address — funds must go to a payment address (addr1…)'
      : `Not a valid Cardano address (${expectPrefix}1…)`)
  }
  return ok
}

function validateBitcoin(address: string, testnet: boolean): AddressValidation {
  try {
    btc.Address(testnet ? btc.TEST_NETWORK : btc.NETWORK).decode(address)
    return ok
  } catch {
    // Wrong-network bech32 is the common cross-paste mistake — call it out.
    try {
      btc.Address(testnet ? btc.NETWORK : btc.TEST_NETWORK).decode(address)
      return bad(testnet ? 'That is a Bitcoin MAINNET address — Testnet Mode is on' : 'That is a Bitcoin TESTNET address')
    } catch {
      return bad(testnet ? 'Not a valid Bitcoin testnet address (tb1…/2…)' : 'Not a valid Bitcoin address (bc1q…/bc1p…/3…/1…)')
    }
  }
}

// Version bytes dogecoin.ts's DOGE_NETWORK can encode outputs for.
const DOGE_P2PKH = 0x1e   // D…
const DOGE_P2SH  = 0x16   // 9…/A…

function validateDogecoin(address: string): AddressValidation {
  const payload = base58CheckDecode(address)
  if (!payload || payload.length !== 21 || (payload[0] !== DOGE_P2PKH && payload[0] !== DOGE_P2SH)) {
    return bad('Not a valid Dogecoin address (D…)')
  }
  return ok
}

function validateTron(address: string): AddressValidation {
  const payload = base58CheckDecode(address)
  if (!payload || payload.length !== 21 || payload[0] !== 0x41) {
    return bad('Not a valid Tron address (T…)')
  }
  return ok
}

function validateMonero(address: string): AddressValidation {
  // Real decode: CryptoNote block-base58 + keccak checksum + mainnet prefix
  // (standard 4…, subaddress 8…, integrated) — see monero-pure.ts.
  return validateMoneroAddress(address)
    ? ok
    : bad('Not a valid Monero address (4… or 8…)')
}

function validateZcash(address: string): AddressValidation {
  if (validateZcashTransparent(address)) return ok
  // Shielded/unified recipients exist but the sender can't pay them yet —
  // give a precise reason instead of "invalid".
  if (/^(zs1|u1)/.test(address)) return bad('Shielded Zcash recipients aren’t supported yet — use a transparent (t1…/t3…) address')
  return bad('Not a valid Zcash transparent address (t1…/t3…)')
}

/**
 * Validate a recipient for a Send-form chain id ('ethereum'…'hyperevm' → EVM,
 * or 'solana' | 'cardano' | 'tron' | 'dogecoin' | 'bitcoin').
 * `testnet` = wallet-wide Testnet Mode (Bitcoin/Cardano encode differently).
 */
export function validateAddress(chainId: string, address: string, testnet = false): AddressValidation {
  const a = address.trim()
  if (!a) return bad('Enter a recipient address')
  switch (chainId) {
    case 'solana':   return validateSolana(a)
    case 'cardano':  return validateCardano(a, testnet)
    case 'bitcoin':  return validateBitcoin(a, testnet)
    case 'dogecoin': return validateDogecoin(a)
    case 'tron':     return validateTron(a)
    case 'monero':   return validateMonero(a)
    case 'zcash':    return validateZcash(a)
    default:
      // Every other Send-form chain is EVM. isAddress enforces the EIP-55
      // checksum when the input is mixed-case (catches real typos).
      return isAddress(a) ? ok : bad('Not a valid EVM address (0x… — check for typos)')
  }
}
