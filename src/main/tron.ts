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
import type { SendResult, FeeEstimate, SendAsset } from './tx-sender'
import { parseUnits } from 'viem'

// Keyless native TRON HTTP API fallbacks — same `wallet/*` shape as the Alchemy
// endpoint, so they're drop-in when the proxy route isn't deployed or Alchemy is
// throttled/unkeyed (mirrors PUBLIC_RPCS / BITCOIN_ESPLORA). TronGrid is the
// canonical public node.
const TRON_FALLBACKS = ['https://api.trongrid.io']

/**
 * POST a TRON HTTP API method, trying the primary (proxy/Alchemy) first and failing
 * over to the keyless public nodes. Returns the first OK JSON response; throws only
 * if every endpoint fails. Used for reads, tx building, and broadcast alike.
 */
export async function tronApiPost<T>(path: string, body: unknown, config: WalletConfig, timeoutMs = 15_000): Promise<T> {
  const p = path.replace(/^\/+/, '')
  // Testnet Mode: every TRON call (reads, TRC-20, builds, broadcast) targets the
  // keyless Shasta node instead — one switch covers the whole tron.ts surface.
  const urls = config.testnetMode
    ? [`https://api.shasta.trongrid.io/${p}`]
    : [tronApiUrl(p, config), ...TRON_FALLBACKS.map(b => `${b}/${p}`)]
  let lastErr: unknown = null
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      })
      if (!res.ok) { lastErr = new Error(`TRON ${p} ${res.status}`); continue }
      return await res.json() as T
    } catch (e) { lastErr = e }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`TRON ${p} unreachable`)
}

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
    const json = await tronApiPost<{ constant_result?: string[] }>('wallet/triggerconstantcontract',
      { owner_address: owner, contract_address: contract, function_selector: selector, parameter, visible: true },
      config, 10_000)
    return json.constant_result?.[0] ?? null
  } catch { return null }
}

// ─── Signing + broadcast ───────────────────────────────────────────────────────

const EXPLORER = 'https://tronscan.org/#/transaction'

/** Sign a transaction's txID (hex) with the secp256k1 key → 65-byte hex (r‖s‖v). */
function signTxid(txID: string, privateKey: Uint8Array): string {
  const sig = secp256k1.sign(txID, privateKey, { lowS: true })   // txID is the message hash (sha256 of raw_data)
  const r = sig.r.toString(16).padStart(64, '0')
  const s = sig.s.toString(16).padStart(64, '0')
  const v = (sig.recovery ?? 0).toString(16).padStart(2, '0')    // TRON uses recid (0/1), not +27
  return r + s + v
}

interface TronUnsignedTx { txID: string; raw_data: unknown; raw_data_hex: string; visible?: boolean; [k: string]: unknown }

/** uint256 → a bare 32-byte hex word, for hand-built TRON call parameters. */
function uintParam(v: bigint): string {
  return v.toString(16).padStart(64, '0')
}

/**
 * Build the `triggersmartcontract` selector + parameter blob for a non-native
 * TRON transfer.
 *
 * TRC-20/721/1155 mirror their ERC equivalents exactly, so the selectors are the
 * same — only the address encoding differs (TRON packs a base58check `T…`
 * address into the same 32-byte word, which is what tronAddrParam does).
 */
export function tronTransferCall(
  asset: SendAsset, from: string, to: string, amount: string
): { selector: string; parameter: string } {
  if (asset.kind === 'token') {
    const raw = parseUnits(amount, asset.decimals)
    if (raw <= 0n) throw new Error('Amount must be greater than 0')
    return {
      selector: 'transfer(address,uint256)',
      parameter: tronAddrParam(to) + uintParam(raw),
    }
  }

  const tokenId = BigInt(asset.tokenId)
  if (asset.standard === 'erc721') {
    // The safe variant, as on EVM: a recipient contract that can't receive NFTs
    // rejects the transfer instead of swallowing the token.
    return {
      selector: 'safeTransferFrom(address,address,uint256)',
      parameter: tronAddrParam(from) + tronAddrParam(to) + uintParam(tokenId),
    }
  }
  if (asset.standard === 'erc1155') {
    const qty = BigInt(asset.quantity ?? '1')
    if (qty <= 0n) throw new Error('Quantity must be at least 1')
    // Trailing `bytes data`: ABI-encodes as a head offset (0xa0 — five words in)
    // followed by a zero length, i.e. an empty byte string.
    return {
      selector: 'safeTransferFrom(address,address,uint256,uint256,bytes)',
      parameter:
        tronAddrParam(from) + tronAddrParam(to) + uintParam(tokenId) +
        uintParam(qty) + uintParam(160n) + uintParam(0n),
    }
  }
  throw new Error(`Cannot send a ${asset.standard} asset on Tron`)
}

/**
 * Send native TRX, or a TRC-20/721/1155 asset when `asset` is provided. `amount`
 * is human decimal. Builds the tx on-node (createtransaction /
 * triggersmartcontract), signs the returned txID locally, and broadcasts.
 */
export async function sendTronTransaction(
  mnemonic: string,
  to: string,
  amount: string,
  config: WalletConfig,
  accountIndex = 0,
  asset?: SendAsset
): Promise<SendResult> {
  const { privateKey, address: from } = await getTronKey(mnemonic, accountIndex)

  let unsigned: TronUnsignedTx
  if (asset) {
    const { selector, parameter } = tronTransferCall(asset, from, to, amount)
    const res = await tronApiPost<{ transaction?: TronUnsignedTx; result?: { message?: string }; txID?: string }>(
      'wallet/triggersmartcontract',
      {
        owner_address: from, contract_address: asset.contractAddress,
        function_selector: selector, parameter,
        fee_limit: 100_000_000, call_value: 0, visible: true
      },
      config
    )
    if (!res.transaction) {
      throw new Error(
        decodeTronError(res.result?.message) ||
        (asset.kind === 'token' ? 'TRC-20 build failed' : 'NFT transfer build failed')
      )
    }
    unsigned = res.transaction
  } else {
    const sun = BigInt(Math.round(parseFloat(amount) * 1e6))
    if (sun <= 0n) throw new Error('Amount must be greater than 0')
    unsigned = await tronApiPost<TronUnsignedTx>('wallet/createtransaction',
      { owner_address: from, to_address: to, amount: Number(sun), visible: true }, config)
    if (!unsigned.txID) throw new Error('TRX build failed — check the recipient address')
  }

  const signature = signTxid(unsigned.txID, privateKey)
  const signed = { ...unsigned, signature: [signature] }

  const broadcast = await tronApiPost<{ result?: boolean; txid?: string; code?: string; message?: string }>(
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
  let feeUsd: number | null = null
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tron&vs_currencies=usd', { signal: AbortSignal.timeout(5_000) })
    const json = await res.json() as { tron?: { usd?: number } }
    const price = json.tron?.usd ?? 0
    if (price > 0) feeUsd = feeTrx * price
  } catch { /* price optional */ }
  return { fee: feeTrx.toFixed(2), feeSymbol: 'TRX', feeUsd }
}
