/**
 * tron.ts — TRON address helpers, read-only contract calls, and send/sign.
 *
 * TRON is secp256k1 (same curve as EVM) but uses a base58check `T…` address and the
 * TRON HTTP API (`wallet/*`) rather than JSON-RPC. All keyed calls route through
 * `tronApiUrl` (proxy injects the Alchemy key). Private key material is derived in
 * the main process via wallet-core and never leaves it.
 */

import { sha256 } from '@noble/hashes/sha256'
import { keccak_256 } from '@noble/hashes/sha3'
import { secp256k1 } from '@noble/curves/secp256k1'
import { base58 } from '@scure/base'
import type { WalletConfig } from './secure-store'
import { tronApiUrl } from './api-proxy'
import { getTronKey } from './wallet-core'
import type { SendResult, FeeEstimate } from './tx-sender'

// ─── Address conversion ────────────────────────────────────────────────────────

/** base58check `T…` address → 20-byte hex (no 0x41 prefix), for ABI encoding. */
export function tronAddrToHex(addr: string): string {
  const decoded = base58.decode(addr)
  const payload = decoded.slice(0, -4)          // strip 4-byte checksum
  return Buffer.from(payload.slice(1)).toString('hex')   // strip 0x41 prefix
}

/** 20-byte (or 41-prefixed 21-byte) hex → base58check `T…` address. */
export function tronHexToBase58(hex: string): string {
  let h = hex.replace(/^0x/, '').toLowerCase()
  if (h.length === 40) h = '41' + h
  const payload = Buffer.from(h, 'hex')
  const checksum = sha256(sha256(payload)).slice(0, 4)
  return base58.encode(new Uint8Array([...payload, ...checksum]))
}

/** ABI-encode a `T…` address as a 32-byte (64-hex) parameter. */
export function tronAddrParam(addr: string): string {
  return '0'.repeat(24) + tronAddrToHex(addr)
}

// ─── Read-only contract call ───────────────────────────────────────────────────

/** POST a constant (read-only) contract call; returns the raw hex result or null. */
export async function tronConstantCall(
  contract: string,
  owner: string,
  selector: string,
  parameter: string,
  config: WalletConfig
): Promise<string | null> {
  try {
    const res = await fetch(tronApiUrl('wallet/triggerconstantcontract', config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ owner_address: owner, contract_address: contract, function_selector: selector, parameter, visible: true }),
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return null
    const json = await res.json() as { constant_result?: string[] }
    return json.constant_result?.[0] ?? null
  } catch { return null }
}

// ─── Signing + broadcast (filled in the senders step) ──────────────────────────

const EXPLORER = 'https://tronscan.org/#/transaction'

async function tronPost<T>(path: string, body: unknown, config: WalletConfig, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(tronApiUrl(path, config), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new Error(`TRON ${path} ${res.status}`)
  return res.json() as Promise<T>
}

/** Sign a transaction's txID (hex) with the secp256k1 key → 65-byte hex (r‖s‖v). */
function signTxid(txID: string, privateKey: Uint8Array): string {
  const sig = secp256k1.sign(txID, privateKey, { lowS: true })   // txID is the message hash (sha256 of raw_data)
  const r = sig.r.toString(16).padStart(64, '0')
  const s = sig.s.toString(16).padStart(64, '0')
  const v = (sig.recovery ?? 0).toString(16).padStart(2, '0')    // TRON uses recid (0/1), not +27
  return r + s + v
}

interface TronUnsignedTx { txID: string; raw_data: unknown; raw_data_hex: string; visible?: boolean; [k: string]: unknown }

/**
 * Send native TRX, or a TRC-20 token when `token` is provided. `amount` is human
 * decimal. Builds the tx on-node (createtransaction / triggersmartcontract), signs
 * the returned txID locally, and broadcasts.
 */
export async function sendTronTransaction(
  mnemonic: string,
  to: string,
  amount: string,
  config: WalletConfig,
  accountIndex = 0,
  token?: { contractAddress: string; decimals: number }
): Promise<SendResult> {
  const { privateKey, address: from } = await getTronKey(mnemonic, accountIndex)

  let unsigned: TronUnsignedTx
  if (token) {
    const raw = BigInt(Math.round(parseFloat(amount) * 10 ** token.decimals))
    if (raw <= 0n) throw new Error('Amount must be greater than 0')
    const parameter = tronAddrParam(to) + raw.toString(16).padStart(64, '0')
    const res = await tronPost<{ transaction?: TronUnsignedTx; result?: { message?: string }; txID?: string }>(
      'wallet/triggersmartcontract',
      {
        owner_address: from, contract_address: token.contractAddress,
        function_selector: 'transfer(address,uint256)', parameter,
        fee_limit: 100_000_000, call_value: 0, visible: true
      },
      config
    )
    if (!res.transaction) throw new Error(decodeTronError(res.result?.message) || 'TRC-20 build failed')
    unsigned = res.transaction
  } else {
    const sun = BigInt(Math.round(parseFloat(amount) * 1e6))
    if (sun <= 0n) throw new Error('Amount must be greater than 0')
    unsigned = await tronPost<TronUnsignedTx>('wallet/createtransaction',
      { owner_address: from, to_address: to, amount: Number(sun), visible: true }, config)
    if (!unsigned.txID) throw new Error('TRX build failed — check the recipient address')
  }

  const signature = signTxid(unsigned.txID, privateKey)
  const signed = { ...unsigned, signature: [signature] }

  const broadcast = await tronPost<{ result?: boolean; txid?: string; code?: string; message?: string }>(
    'wallet/broadcasttransaction', signed, config)
  if (broadcast.result !== true && !broadcast.txid) {
    throw new Error(decodeTronError(broadcast.message) || broadcast.code || 'Broadcast rejected')
  }

  return { txHash: unsigned.txID, explorerUrl: `${EXPLORER}/${unsigned.txID}` }
}

// TRON returns error messages hex-encoded in some responses.
function decodeTronError(msg?: string): string | null {
  if (!msg) return null
  if (/^[0-9a-fA-F]+$/.test(msg) && msg.length % 2 === 0) {
    try { return Buffer.from(msg, 'hex').toString('utf8') } catch { /* not hex */ }
  }
  return msg
}

/**
 * Conservative fee estimate. TRON fees are paid in bandwidth/energy (or burned TRX
 * when those are exhausted); a precise figure needs resource accounting, so we show
 * a safe upper bound: ~1.1 TRX for native, ~30 TRX for a TRC-20 transfer's energy.
 */
export async function estimateTronFee(
  _to: string,
  config: WalletConfig,
  isToken = false
): Promise<FeeEstimate> {
  const feeTrx = isToken ? 30 : 1.1
  let feeUsd: string | null = null
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tron&vs_currencies=usd', { signal: AbortSignal.timeout(5_000) })
    const json = await res.json() as { tron?: { usd?: number } }
    const price = json.tron?.usd ?? 0
    if (price > 0) feeUsd = `$${(feeTrx * price).toFixed(4)}`
  } catch { /* price optional */ }
  return { fee: feeTrx.toFixed(2), feeSymbol: 'TRX', feeUsd }
}
