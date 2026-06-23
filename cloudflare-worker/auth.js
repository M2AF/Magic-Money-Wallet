/**
 * auth.js — EVM (secp256k1) signature verification for the Supabase write routes.
 *
 * The ChainLens profile's identity IS the EVM address (cl_users.provider_id =
 * evm address), and the Solana/Cardano/etc. addresses are linked sub-records
 * under it — so a single EVM personal_sign proves ownership of the whole profile.
 * No ed25519/other-curve path is needed for sync auth.
 *
 * Uses @noble/curves (already a project dep) — no ethers/web3.js in the Worker.
 */

import { secp256k1 } from '@noble/curves/secp256k1'
import { keccak_256 } from '@noble/hashes/sha3'
import { bytesToHex, utf8ToBytes, concatBytes } from '@noble/hashes/utils'

/** Canonical ownership message — MUST byte-match the client (supabase-sync.ts). */
export function ownershipMessage(action, addressLower, ts) {
  return `MagicMoney Wallet ownership\naction:${action}\naddress:${addressLower}\nts:${ts}`
}

// EIP-191 personal_sign digest: keccak256("\x19Ethereum Signed Message:\n" + len + msg)
function eip191Hash(message) {
  const msg = utf8ToBytes(message)
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${msg.length}`)
  return keccak_256(concatBytes(prefix, msg))
}

/** Recover the 0x EVM address that produced an EIP-191 signature, or null. */
export function recoverEvmAddress(message, sigHex) {
  try {
    const hex = sigHex.startsWith('0x') ? sigHex.slice(2) : sigHex
    if (hex.length !== 130) return null            // 65 bytes: r(32)+s(32)+v(1)
    let v = parseInt(hex.slice(128, 130), 16)
    if (v >= 27) v -= 27
    if (v !== 0 && v !== 1) return null
    const sig = secp256k1.Signature.fromCompact(hex.slice(0, 128)).addRecoveryBit(v)
    const pub = sig.recoverPublicKey(eip191Hash(message)).toRawBytes(false) // 65 bytes (0x04 prefix)
    return '0x' + bytesToHex(keccak_256(pub.slice(1)).slice(-20))
  } catch {
    return null
  }
}

/**
 * Verify `sigHex` is a fresh EIP-191 signature of the ownership message for
 * `addressLower`+`action`. `ts` must be within ±10 min (replay window). Returns
 * the lowercased verified address, or null.
 */
export function verifyOwnership(action, addressLower, ts, sigHex) {
  const now = Date.now()
  const t = Number(ts)
  if (!Number.isFinite(t) || Math.abs(now - t) > 600_000) return null
  const recovered = recoverEvmAddress(ownershipMessage(action, addressLower, t), sigHex || '')
  if (!recovered || recovered.toLowerCase() !== addressLower) return null
  return recovered.toLowerCase()
}
