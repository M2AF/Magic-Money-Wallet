/**
 * dogecoin.ts — Dogecoin (legacy P2PKH) UTXO transaction building, signing, broadcast.
 *
 * Dogecoin is a straight Bitcoin fork (no SegWit on mainnet, no SIGHASH_FORKID), so
 * @scure/btc-signer handles building/signing with Dogecoin network params. Balance,
 * UTXOs and broadcast use the keyless Blockbook indexers (DOGE_INDEXERS). Private
 * keys are derived in wallet-core and never leave the main process.
 */

import * as btc from '@scure/btc-signer'
import { hex } from '@scure/base'
import { DOGE_API_BASE } from './chain-config'
import { getDogecoinKey } from './wallet-core'
import type { SendResult, FeeEstimate } from './tx-sender'

const EXPLORER = 'https://dogechain.info/tx'

// Dogecoin mainnet base58 version bytes. bech32 is required by the type but unused
// for legacy P2PKH (Doge has no SegWit), so any placeholder works.
const DOGE_NETWORK = { bech32: 'doge', pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e }

const DUST = 1_000_000n             // ~0.01 DOGE — outputs below this are non-standard
const MIN_FEE_PER_VBYTE = 1_000n    // sat/vByte — ~0.01 DOGE/kvB, 10× Doge's relay min

interface DogeUtxo { txid: string; vout: number; value: bigint }

// ── BlockCypher helpers (keyless) ──────────────────────────────────────────────

// Confirmed UTXOs for an address. BlockCypher returns outputs in `txrefs` with the
// output index in `tx_output_n` and value in koinu (1 DOGE = 1e8).
async function fetchDogeUtxos(address: string): Promise<DogeUtxo[]> {
  const res = await fetch(`${DOGE_API_BASE}/addrs/${address}?unspentOnly=true&limit=2000`, {
    headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000)
  })
  if (!res.ok) throw new Error(`BlockCypher ${res.status} fetching UTXOs`)
  const json = await res.json() as { txrefs?: Array<{ tx_hash: string; tx_output_n: number; value: number }> }
  return (json.txrefs ?? [])
    .filter(u => u.tx_output_n >= 0)
    .map(u => ({ txid: u.tx_hash, vout: u.tx_output_n, value: BigInt(u.value) }))
}

// Medium fee from BlockCypher's chain endpoint (koinu per kB) → koinu per vByte.
async function feePerVByte(): Promise<bigint> {
  try {
    const res = await fetch(DOGE_API_BASE, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000) })
    if (res.ok) {
      const json = await res.json() as { medium_fee_per_kb?: number; high_fee_per_kb?: number }
      const perKb = json.medium_fee_per_kb ?? json.high_fee_per_kb ?? 0
      if (perKb > 0) {
        const satPerVByte = BigInt(Math.ceil(perKb / 1000))
        return satPerVByte > MIN_FEE_PER_VBYTE ? satPerVByte : MIN_FEE_PER_VBYTE
      }
    }
  } catch { /* use floor */ }
  return MIN_FEE_PER_VBYTE
}

// P2PKH scriptPubKey for an address (all our UTXOs share the from-address script).
function dogeScript(address: string): Uint8Array {
  const decoded = btc.Address(DOGE_NETWORK).decode(address)
  if (!decoded) throw new Error('Invalid Dogecoin address')
  return btc.OutScript.encode(decoded)
}

type Selection = NonNullable<ReturnType<typeof btc.selectUTXO>>

async function selectDoge(fromAddress: string, to: string, sats: bigint, feeRate: bigint): Promise<Selection> {
  const utxos = await fetchDogeUtxos(fromAddress)
  if (utxos.length === 0) throw new Error('No UTXOs found — address has no funds on-chain')
  const script = dogeScript(fromAddress)
  const inputs = utxos.map(u => ({ txid: u.txid, index: u.vout, witnessUtxo: { script, amount: u.value } }))
  const selected = btc.selectUTXO(inputs, [{ address: to, amount: sats }], 'default', {
    changeAddress: fromAddress, feePerByte: feeRate, bip69: true, createTx: true,
    network: DOGE_NETWORK, allowLegacyWitnessUtxo: true, dust: DUST,
  })
  if (!selected) {
    const have = utxos.reduce((a, u) => a + u.value, 0n)
    throw new Error(`Insufficient funds: have ${(Number(have) / 1e8).toFixed(8)} DOGE for amount + fee`)
  }
  return selected
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function estimateDogecoinFee(
  fromAddress: string,
  to: string,
  amountDoge: string
): Promise<FeeEstimate> {
  const sats = BigInt(Math.round(parseFloat(amountDoge) * 1e8))
  if (sats <= 0n) throw new Error('Amount must be greater than 0')
  const feeRate = await feePerVByte()
  const selected = await selectDoge(fromAddress, to, sats, feeRate)
  const feeDoge = Number(selected.fee ?? 0n) / 1e8

  let feeUsd: number | null = null
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=dogecoin&vs_currencies=usd', { signal: AbortSignal.timeout(5_000) })
    const json = await res.json() as { dogecoin?: { usd?: number } }
    const price = json.dogecoin?.usd ?? 0
    if (price > 0) feeUsd = feeDoge * price
  } catch { /* price optional */ }

  return { fee: feeDoge.toFixed(8), feeSymbol: 'DOGE', feeUsd }
}

export async function sendDogecoinTransaction(
  mnemonic: string,
  fromAddress: string,
  to: string,
  amountDoge: string,
  accountIndex = 0
): Promise<SendResult> {
  const sats = BigInt(Math.round(parseFloat(amountDoge) * 1e8))
  if (sats <= 0n) throw new Error('Amount must be greater than 0')

  const { privateKey } = await getDogecoinKey(mnemonic, accountIndex)
  const feeRate = await feePerVByte()
  const selected = await selectDoge(fromAddress, to, sats, feeRate)

  const tx = selected.tx
  if (!tx) throw new Error('Failed to build Dogecoin transaction')
  tx.sign(privateKey)
  tx.finalize()
  const rawHex = hex.encode(tx.extract())

  const txid = await broadcastDoge(rawHex)
  const finalId = txid || tx.id
  return { txHash: finalId, explorerUrl: `${EXPLORER}/${finalId}` }
}

async function broadcastDoge(rawHex: string): Promise<string> {
  const res = await fetch(`${DOGE_API_BASE}/txs/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx: rawHex }),
    signal: AbortSignal.timeout(20_000)
  })
  const json = await res.json().catch(() => null) as { tx?: { hash?: string }; error?: string; errors?: Array<{ error: string }> } | null
  if (res.ok && json?.tx?.hash) return json.tx.hash
  const msg = json?.error || json?.errors?.map(e => e.error).join('; ') || `Broadcast ${res.status}`
  throw new Error(msg)
}
