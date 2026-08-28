/**
 * zcash.ts — Zcash transparent-pool balance, fee estimation, send, broadcast.
 *
 * TRANSPARENT POOL ONLY for now. The shielded pools (Sapling/Orchard) need the
 * WebZjs wallet WASM (not published to npm — must be vendored from a source
 * build); until the wallet can SCAN shielded notes we deliberately do not
 * derive or display a shielded/unified receive address, so no funds can arrive
 * somewhere the wallet cannot see. Keys are derived in wallet-core and never
 * leave the main process.
 *
 * Why a hand-rolled transaction builder: Zcash's v4 (Sapling) transaction format
 * carries extra fields (version group id, expiry, value balance, shielded
 * bundles) and replaces Bitcoin's sighash with ZIP-243 (BLAKE2b-256 with a
 * consensus-branch personalization), so @scure/btc-signer cannot produce a valid
 * Zcash transaction. v4 transparent-only transactions remain standard on
 * mainnet post-NU6. The consensus branch ID is fetched live from lightwalletd
 * (GetLightdInfo) so a future network upgrade doesn't brick sends.
 *
 * ⚠ NU6.3 "Ironwood" activates mainnet at height 3,428,143 (~28 Jul 2026,
 * counterfeit-bug remediation for the Orchard pool) — the branch id changes
 * again. The live fetch above should track it automatically; FALLBACK_BRANCH_ID
 * below does not and will be stale after that date (safe failure mode: a wrong
 * branch id produces an invalid ZIP-243 sighash, so the network rejects the tx
 * rather than accepting something wrong — but re-verify a real transparent send
 * still works shortly after activation, and refresh the fallback constant then).
 *
 * Data providers (keyless): Blockchair dashboards (balance + UTXOs + push) with
 * the ChainSafe lightwalletd gRPC-web proxy for chain info.
 */

import { blake2b } from '@noble/hashes/blake2b'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { secp256k1 } from '@noble/curves/secp256k1'
import { base58 } from '@scure/base'
import { ZCASH_API_BASE } from './chain-config'
import { getZcashKey } from './wallet-core'
import type { SendResult, FeeEstimate } from './tx-sender'

const EXPLORER = 'https://blockchair.com/zcash/transaction'
const LIGHTWALLETD = 'https://zcash-mainnet.chainsafe.dev'

// NU6.1 mainnet consensus branch id (live value observed from lightwalletd on
// 2026-07-13) — fallback when lightwalletd is unreachable. The live value from
// GetLightdInfo always wins (see fetchConsensusBranchId), so a future upgrade
// only needs this constant refreshed for the offline-fallback case.
const FALLBACK_BRANCH_ID = 0x5437f330

const ZATS = 1e8
const DUST = 546n           // zats — below this, change is folded into the fee
const MARGINAL_FEE = 5000n  // ZIP-317 marginal fee per logical action
const P2PKH_PREFIX = new Uint8Array([0x1c, 0xb8])  // t1…
const P2SH_PREFIX  = new Uint8Array([0x1c, 0xbd])  // t3…

interface ZecUtxo { txid: string; vout: number; value: bigint }

// ── Address helpers ────────────────────────────────────────────────────────────

function base58checkDecode(address: string): Uint8Array | null {
  try {
    const raw = base58.decode(address)
    if (raw.length < 5) return null
    const payload = raw.slice(0, raw.length - 4)
    const checksum = raw.slice(raw.length - 4)
    const expect = sha256(sha256(payload)).slice(0, 4)
    if (!checksum.every((b, i) => b === expect[i])) return null
    return payload
  } catch {
    return null
  }
}

/** Structural validation of a transparent mainnet address (t1 P2PKH / t3 P2SH). */
export function validateZcashTransparent(address: string): boolean {
  const payload = base58checkDecode(address)
  if (!payload || payload.length !== 22) return false
  const isP2pkh = payload[0] === P2PKH_PREFIX[0] && payload[1] === P2PKH_PREFIX[1]
  const isP2sh  = payload[0] === P2SH_PREFIX[0]  && payload[1] === P2SH_PREFIX[1]
  return isP2pkh || isP2sh
}

/** scriptPubKey for a transparent address. */
function zcashScript(address: string): Uint8Array {
  const payload = base58checkDecode(address)
  if (!payload || payload.length !== 22) throw new Error('Invalid Zcash transparent address')
  const hash = payload.slice(2)
  if (payload[0] === P2PKH_PREFIX[0] && payload[1] === P2PKH_PREFIX[1]) {
    // OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
    return new Uint8Array([0x76, 0xa9, 0x14, ...hash, 0x88, 0xac])
  }
  // OP_HASH160 <20> OP_EQUAL
  return new Uint8Array([0xa9, 0x14, ...hash, 0x87])
}

// ── Keyless providers ─────────────────────────────────────────────────────────

// Last-known-good balance per address (in-memory). Same doctrine as the
// token-balance cache: a provider FAILURE (Blockchair 429/outage) must never
// present as "Unavailable" when we knew the balance seconds ago.
const lastGoodBalance = new Map<string, number>()

/**
 * Confirmed balance in ZEC (display path — used by balance-fetcher).
 * Provider ladder: Blockchair dashboards → lightwalletd GetTaddressBalance
 * (independent infrastructure, CORS-clean) → last-known-good.
 */
export async function fetchZcashBalance(address: string): Promise<{ native: number; error: string | null }> {
  try {
    const res = await fetch(`${ZCASH_API_BASE}/dashboards/address/${address}?limit=0`, {
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000)
    })
    if (res.ok) {
      const json = await res.json() as { data?: Record<string, { address?: { balance?: number } }> }
      const bal = json.data?.[address]?.address?.balance
      const native = typeof bal === 'number' ? bal / ZATS : 0  // fresh address — zero, not an error
      lastGoodBalance.set(address, native)
      return { native, error: null }
    }
  } catch { /* ladder continues */ }

  const viaLwd = await lightwalletdTaddressBalance(address)
  if (viaLwd != null) {
    lastGoodBalance.set(address, viaLwd)
    return { native: viaLwd, error: null }
  }

  const known = lastGoodBalance.get(address)
  if (known != null) return { native: known, error: null }
  return { native: 0, error: 'Network error' }
}

/**
 * lightwalletd GetTaddressBalance over gRPC-web (unary). Request is an
 * AddressList{ addresses[1]: string }; response a Balance{ valueZat[1]: varint }.
 * Hand-rolled framing like fetchConsensusBranchId — no gRPC dependency.
 */
async function lightwalletdTaddressBalance(address: string): Promise<number | null> {
  try {
    const addrBytes = new TextEncoder().encode(address)
    // protobuf: field 1, wire type 2 (len-delimited) — tag 0x0A
    if (addrBytes.length > 127) return null   // t-addrs are ~35 chars; guard the 1-byte varint
    const msg = new Uint8Array([0x0a, addrBytes.length, ...addrBytes])
    const body = new Uint8Array(5 + msg.length)
    new DataView(body.buffer).setUint32(1, msg.length, false)   // frame: flag 0 + u32 BE length
    body.set(msg, 5)
    const res = await fetch(`${LIGHTWALLETD}/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetTaddressBalance`, {
      method: 'POST',
      headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' },
      body,
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    // Response frame: 5-byte header, then Balance{ field 1 varint }. A zero
    // balance can serialize as an EMPTY message (frame length 0) — valid.
    const len = new DataView(buf.buffer).getUint32(1, false)
    if (len === 0) return 0
    if (buf.length < 7 || buf[5] !== 0x08) return null   // field 1, wire type 0
    let v = 0n, shift = 0n, i = 6
    while (i < buf.length) {
      const b = buf[i++]
      v |= BigInt(b & 0x7f) << shift
      if (!(b & 0x80)) break
      shift += 7n
    }
    return Number(v) / ZATS
  } catch {
    return null
  }
}

async function fetchZecUtxos(address: string): Promise<ZecUtxo[]> {
  const res = await fetch(`${ZCASH_API_BASE}/dashboards/address/${address}?limit=1000`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000)
  })
  if (!res.ok) throw new Error(`Blockchair ${res.status} fetching UTXOs`)
  const json = await res.json() as {
    data?: Record<string, { utxo?: Array<{ transaction_hash: string; index: number; value: number; block_id: number }> }>
  }
  return (json.data?.[address]?.utxo ?? [])
    .filter(u => u.block_id > 0)   // confirmed only — Zcash reorg safety
    .map(u => ({ txid: u.transaction_hash, vout: u.index, value: BigInt(u.value) }))
}

/** Live consensus branch id from lightwalletd (gRPC-web GetLightdInfo). */
async function fetchConsensusBranchId(): Promise<number> {
  try {
    // gRPC-web unary call with an empty request message: 5-byte frame header.
    const res = await fetch(`${LIGHTWALLETD}/cash.z.wallet.sdk.rpc.CompactTxStreamer/GetLightdInfo`, {
      method: 'POST',
      headers: { 'content-type': 'application/grpc-web+proto', 'x-grpc-web': '1' },
      body: new Uint8Array(5),
      signal: AbortSignal.timeout(8_000)
    })
    if (!res.ok) return FALLBACK_BRANCH_ID
    const buf = new Uint8Array(await res.arrayBuffer())
    // Skip the 5-byte gRPC frame header, then walk protobuf fields for
    // LightdInfo.consensusBranchId (field 6, wire type 2 = length-delimited hex string).
    let i = 5
    const view = buf
    while (i < view.length) {
      const tag = view[i++]
      const field = tag >> 3
      const wire = tag & 7
      if (wire === 0) {                        // varint
        while (i < view.length && view[i] & 0x80) i++
        i++
      } else if (wire === 2) {                 // length-delimited
        let len = 0, shift = 0
        while (view[i] & 0x80) { len |= (view[i++] & 0x7f) << shift; shift += 7 }
        len |= (view[i++] & 0x7f) << shift
        if (field === 6) {
          const s = new TextDecoder().decode(view.slice(i, i + len))
          const parsed = parseInt(s, 16)
          if (Number.isFinite(parsed) && parsed > 0) return parsed
        }
        i += len
      } else {
        break  // unexpected wire type (frame trailer) — stop parsing
      }
    }
  } catch { /* fall through */ }
  return FALLBACK_BRANCH_ID
}

// ── v4 (Sapling) transparent-only transaction builder ─────────────────────────

const HEADER = 0x80000004          // v4 + overwintered flag
const VERSION_GROUP_ID = 0x892f2085 // Sapling

function u32le(v: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, v >>> 0, true)
  return b
}
function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setBigUint64(0, v, true)
  return b
}
function varint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n])
  if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, n >> 8])
  throw new Error('varint too large for a wallet transaction')
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((a, p) => a + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
function txidToBytes(txid: string): Uint8Array {
  // txids display big-endian; the wire format is little-endian
  const bytes = Buffer.from(txid, 'hex')
  return new Uint8Array(bytes.reverse())
}
function blake2bPersonal(personal: string | Uint8Array, data: Uint8Array): Uint8Array {
  const p = typeof personal === 'string' ? new TextEncoder().encode(personal) : personal
  return blake2b(data, { dkLen: 32, personalization: p })
}

interface TxPlan {
  inputs: ZecUtxo[]
  outputs: Array<{ script: Uint8Array; value: bigint }>
  fee: bigint
}

/** Greedy largest-first selection with a ZIP-317 conventional fee. */
function planTransaction(utxos: ZecUtxo[], toScript: Uint8Array, changeScript: Uint8Array, amount: bigint): TxPlan {
  const sorted = [...utxos].sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0))
  const inputs: ZecUtxo[] = []
  let inTotal = 0n
  for (const u of sorted) {
    inputs.push(u)
    inTotal += u.value
    // ZIP-317: fee = marginal_fee × max(grace, logical actions); transparent
    // actions = max(nIn, nOut). Assume 2 outputs (payment + change) first.
    const fee = MARGINAL_FEE * BigInt(Math.max(2, Math.max(inputs.length, 2)))
    if (inTotal >= amount + fee) {
      const change = inTotal - amount - fee
      const outputs = [{ script: toScript, value: amount }]
      if (change >= DUST) {
        outputs.push({ script: changeScript, value: change })
        return { inputs, outputs, fee }
      }
      // change folded into fee
      return { inputs, outputs, fee: fee + change }
    }
  }
  const have = Number(inTotal) / ZATS
  throw new Error(`Insufficient transparent funds: have ${have.toFixed(8)} ZEC for amount + fee`)
}

/** ZIP-243 SIGHASH_ALL digest for one input of a v4 transparent-only tx. */
function zip243Sighash(
  plan: TxPlan,
  inputIndex: number,
  scriptCode: Uint8Array,
  branchId: number
): Uint8Array {
  const prevouts = concat(...plan.inputs.map(u => concat(txidToBytes(u.txid), u32le(u.vout))))
  const sequences = concat(...plan.inputs.map(() => u32le(0xffffffff)))
  const outputs = concat(...plan.outputs.map(o => concat(u64le(o.value), varint(o.script.length), o.script)))

  const hashPrevouts = blake2bPersonal('ZcashPrevoutHash', prevouts)
  const hashSequence = blake2bPersonal('ZcashSequencHash', sequences)
  const hashOutputs  = blake2bPersonal('ZcashOutputsHash', outputs)
  const zeros32 = new Uint8Array(32)

  const input = plan.inputs[inputIndex]
  const preimage = concat(
    u32le(HEADER),
    u32le(VERSION_GROUP_ID),
    hashPrevouts,
    hashSequence,
    hashOutputs,
    zeros32,            // hashJoinSplits (none)
    zeros32,            // hashShieldedSpends (none)
    zeros32,            // hashShieldedOutputs (none)
    u32le(0),           // nLockTime
    u32le(0),           // nExpiryHeight (0 = no expiry)
    u64le(0n),          // valueBalance
    u32le(1),           // SIGHASH_ALL
    txidToBytes(input.txid), u32le(input.vout),
    varint(scriptCode.length), scriptCode,
    u64le(input.value),
    u32le(0xffffffff)
  )

  // personalization = 'ZcashSigHash' ++ branchId (little-endian) — 16 bytes
  const personal = concat(new TextEncoder().encode('ZcashSigHash'), u32le(branchId))
  return blake2bPersonal(personal, preimage)
}

function serializeTx(plan: TxPlan, scriptSigs: Uint8Array[]): Uint8Array {
  return concat(
    u32le(HEADER),
    u32le(VERSION_GROUP_ID),
    varint(plan.inputs.length),
    ...plan.inputs.map((u, i) => concat(
      txidToBytes(u.txid), u32le(u.vout),
      varint(scriptSigs[i].length), scriptSigs[i],
      u32le(0xffffffff)
    )),
    varint(plan.outputs.length),
    ...plan.outputs.map(o => concat(u64le(o.value), varint(o.script.length), o.script)),
    u32le(0),    // nLockTime
    u32le(0),    // nExpiryHeight
    u64le(0n),   // valueBalance
    varint(0),   // nShieldedSpend
    varint(0),   // nShieldedOutput
    varint(0)    // nJoinSplit — with 0 joinsplits the trailing JS fields are absent
  )
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function estimateZcashFee(
  fromAddress: string,
  to: string,
  amountZec: string
): Promise<FeeEstimate> {
  const zats = BigInt(Math.round(parseFloat(amountZec) * ZATS))
  if (zats <= 0n) throw new Error('Amount must be greater than 0')
  if (!validateZcashTransparent(to)) throw new Error('Only transparent (t1…/t3…) recipients are supported for now')
  const utxos = await fetchZecUtxos(fromAddress)
  if (utxos.length === 0) throw new Error('No UTXOs found — address has no transparent funds on-chain')
  const plan = planTransaction(utxos, zcashScript(to), zcashScript(fromAddress), zats)
  const feeZec = Number(plan.fee) / ZATS

  let feeUsd: number | null = null
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd', { signal: AbortSignal.timeout(5_000) })
    const json = await res.json() as { zcash?: { usd?: number } }
    const price = json.zcash?.usd ?? 0
    if (price > 0) feeUsd = feeZec * price
  } catch { /* price optional */ }

  return { fee: feeZec.toFixed(8), feeSymbol: 'ZEC', feeUsd }
}

export async function sendZcashTransaction(
  mnemonic: string,
  fromAddress: string,
  to: string,
  amountZec: string,
  accountIndex = 0
): Promise<SendResult> {
  const zats = BigInt(Math.round(parseFloat(amountZec) * ZATS))
  if (zats <= 0n) throw new Error('Amount must be greater than 0')
  if (!validateZcashTransparent(to)) throw new Error('Only transparent (t1…/t3…) recipients are supported for now')

  const { privateKey, publicKey } = await getZcashKey(mnemonic, accountIndex)
  const [utxos, branchId] = await Promise.all([fetchZecUtxos(fromAddress), fetchConsensusBranchId()])
  if (utxos.length === 0) throw new Error('No UTXOs found — address has no transparent funds on-chain')

  const plan = planTransaction(utxos, zcashScript(to), zcashScript(fromAddress), zats)

  // All our UTXOs pay to the single derived P2PKH address, so scriptCode is the
  // from-address P2PKH script for every input.
  const scriptCode = zcashScript(fromAddress)
  const scriptSigs = plan.inputs.map((_u, i) => {
    const digest = zip243Sighash(plan, i, scriptCode, branchId)
    const sig = secp256k1.sign(digest, privateKey)
    const der = sig.toDERRawBytes()
    const sigWithType = new Uint8Array([...der, 0x01])  // SIGHASH_ALL
    return concat(
      new Uint8Array([sigWithType.length]), sigWithType,
      new Uint8Array([publicKey.length]), publicKey
    )
  })

  const raw = serializeTx(plan, scriptSigs)
  const rawHex = Buffer.from(raw).toString('hex')
  const txid = await broadcastZcash(rawHex)
  return { txHash: txid, explorerUrl: `${EXPLORER}/${txid}` }
}

async function broadcastZcash(rawHex: string): Promise<string> {
  const res = await fetch(`${ZCASH_API_BASE}/push/transaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${rawHex}`,
    signal: AbortSignal.timeout(20_000)
  })
  const json = await res.json().catch(() => null) as { data?: { transaction_hash?: string }; context?: { error?: string } } | null
  if (res.ok && json?.data?.transaction_hash) return json.data.transaction_hash
  // Fall back to computing the txid locally if Blockchair accepted without echoing it.
  if (res.ok) {
    const digest = sha256(sha256(Buffer.from(rawHex, 'hex')))
    return Buffer.from(digest.reverse()).toString('hex')
  }
  throw new Error(json?.context?.error || `Broadcast ${res.status}`)
}

// Verify hash160 path stays consistent with wallet-core (compile-time usage).
export function zcashP2pkhScriptFromPubkey(compressedPubkey: Uint8Array): Uint8Array {
  const hash160 = ripemd160(sha256(compressedPubkey))
  return new Uint8Array([0x76, 0xa9, 0x14, ...hash160, 0x88, 0xac])
}
