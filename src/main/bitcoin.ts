/**
 * bitcoin.ts — native Bitcoin (P2WPKH) UTXO transaction building, signing, broadcast.
 *
 * Spends ONLY from the Native-SegWit payment address (BIP-84 `bc1q…`). Inscriptions,
 * Runes and rare sats live on the Taproot address (BIP-86 `bc1p…`), which this never
 * touches — so a send can never burn an inscription UTXO as a fee or change output.
 *
 * UTXOs / fee rate / broadcast use the keyless Esplora hosts (BITCOIN_ESPLORA).
 * Private keys are derived in wallet-core and never leave the main process.
 */

import * as btc from '@scure/btc-signer'
import { hex, base64 } from '@scure/base'
import { sha256 } from '@noble/hashes/sha256'
import { secp256k1 } from '@noble/curves/secp256k1'
import { BITCOIN_ESPLORA, TESTNET_BITCOIN_ESPLORA, isTestnet } from './chain-config'
import { loadConfig } from './secure-store'
import { getBitcoinKey, getBitcoinNestedKey, getBitcoinTaprootKey } from './wallet-core'
import type { SendResult, FeeEstimate } from './tx-sender'

/** The wallet's three Bitcoin addresses (passed in so signing can pick the right key per input). */
export interface BtcAddresses { bitcoin: string; bitcoinNested: string; bitcoinTaproot: string }

const DUST = 546n            // standard P2WPKH dust threshold (sats)
const MIN_FEE_RATE = 2n      // sat/vByte floor

// Testnet Mode context, read fresh per call. Sends/fees/PSBTs operate on
// TESTNET3 while the mode is on (Testnet4 shares the same tb1 addresses and is
// display-only — see the renderer's chain card gating). Keys switch to the
// BIP-44 testnet coin type (m/84'/1'/…) to match the tb1 address derivation.
function btcMode(): { testnet: boolean; esplora: string[]; network: typeof btc.NETWORK; explorer: string } {
  const testnet = isTestnet(loadConfig())
  return testnet
    ? { testnet, esplora: TESTNET_BITCOIN_ESPLORA, network: btc.TEST_NETWORK, explorer: 'https://mempool.space/testnet/tx' }
    : { testnet, esplora: BITCOIN_ESPLORA, network: btc.NETWORK, explorer: 'https://mempool.space/tx' }
}

interface BtcUtxo { txid: string; vout: number; value: bigint }

async function esploraGet(path: string, timeout = 12_000): Promise<Response | null> {
  for (const base of btcMode().esplora) {
    try {
      const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(timeout) })
      if (res.ok) return res
    } catch { /* try the next host */ }
  }
  return null
}

// Confirmed + mempool UTXOs (Esplora /address/{addr}/utxo).
async function fetchBitcoinUtxos(address: string): Promise<BtcUtxo[]> {
  const res = await esploraGet(`/address/${address}/utxo`)
  if (!res) throw new Error('Could not reach a Bitcoin node to list UTXOs')
  const json = await res.json() as Array<{ txid: string; vout: number; value: number }>
  return json.map(u => ({ txid: u.txid, vout: u.vout, value: BigInt(u.value) }))
}

// Address balance in sats (Esplora /address/{addr}) — for the dApp provider's getBalance.
export async function getBitcoinAddressBalance(address: string): Promise<{ confirmed: number; unconfirmed: number; total: number }> {
  const res = await esploraGet(`/address/${address}`)
  if (!res) return { confirmed: 0, unconfirmed: 0, total: 0 }
  const j = await res.json() as {
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number }
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number }
  }
  const confirmed = j.chain_stats.funded_txo_sum - j.chain_stats.spent_txo_sum
  const unconfirmed = j.mempool_stats.funded_txo_sum - j.mempool_stats.spent_txo_sum
  return { confirmed, unconfirmed, total: confirmed + unconfirmed }
}

// Esplora /fee-estimates → { "1": rate, "6": rate, … } sat/vB. ~3-block target.
async function feePerVByte(): Promise<bigint> {
  const res = await esploraGet('/fee-estimates', 8_000)
  if (res) {
    try {
      const json = await res.json() as Record<string, number>
      const rate = json['3'] ?? json['6'] ?? json['1']
      if (rate && rate > 0) {
        const r = BigInt(Math.ceil(rate))
        return r > MIN_FEE_RATE ? r : MIN_FEE_RATE
      }
    } catch { /* fall through to floor */ }
  }
  return MIN_FEE_RATE
}

type Selection = NonNullable<ReturnType<typeof btc.selectUTXO>>

// Build a P2WPKH spend from the Native-SegWit payment address ONLY.
async function buildSegwitSend(
  publicKey: Uint8Array, fromAddress: string, to: string, sats: bigint, feeRate: bigint,
  network = btc.NETWORK
): Promise<Selection> {
  const utxos = await fetchBitcoinUtxos(fromAddress)
  if (utxos.length === 0) throw new Error('No spendable UTXOs — the SegWit address has no funds on-chain')
  const p2 = btc.p2wpkh(publicKey, network)   // .script = the P2WPKH scriptPubKey shared by every UTXO of this address
  const inputs = utxos.map(u => ({ txid: u.txid, index: u.vout, witnessUtxo: { script: p2.script, amount: u.value } }))
  const selected = btc.selectUTXO(inputs, [{ address: to, amount: sats }], 'default', {
    changeAddress: fromAddress, feePerByte: feeRate, bip69: true, createTx: true, dust: DUST, network,
  })
  if (!selected) {
    const have = utxos.reduce((a, u) => a + u.value, 0n)
    throw new Error(`Insufficient funds: have ${(Number(have) / 1e8).toFixed(8)} BTC for amount + fee`)
  }
  return selected
}

// ── Public API ─────────────────────────────────────────────────────────────────

export async function estimateBitcoinFee(
  fromAddress: string, to: string, amountBtc: string, mnemonic: string, accountIndex = 0
): Promise<FeeEstimate> {
  const mode = btcMode()
  const sats = BigInt(Math.round(parseFloat(amountBtc) * 1e8))
  if (sats <= 0n) throw new Error('Amount must be greater than 0')
  const { publicKey } = await getBitcoinKey(mnemonic, accountIndex, mode.testnet)
  const selected = await buildSegwitSend(publicKey, fromAddress, to, sats, await feePerVByte(), mode.network)
  const feeBtc = Number(selected.fee ?? 0n) / 1e8

  let feeUsd: string | null = null
  if (!mode.testnet) {
    try {
      const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd', { signal: AbortSignal.timeout(5_000) })
      const j = await res.json() as { bitcoin?: { usd?: number } }
      const price = j.bitcoin?.usd ?? 0
      if (price > 0) feeUsd = `$${(feeBtc * price).toFixed(2)}`
    } catch { /* price optional */ }
  }

  return { fee: feeBtc.toFixed(8), feeSymbol: 'BTC', feeUsd }
}

export async function sendBitcoinTransaction(
  mnemonic: string, fromAddress: string, to: string, amountBtc: string, accountIndex = 0
): Promise<SendResult> {
  const mode = btcMode()
  const sats = BigInt(Math.round(parseFloat(amountBtc) * 1e8))
  if (sats <= 0n) throw new Error('Amount must be greater than 0')

  const { privateKey, publicKey } = await getBitcoinKey(mnemonic, accountIndex, mode.testnet)
  const selected = await buildSegwitSend(publicKey, fromAddress, to, sats, await feePerVByte(), mode.network)

  const tx = selected.tx
  if (!tx) throw new Error('Failed to build Bitcoin transaction')
  tx.sign(privateKey)
  tx.finalize()
  const rawHex = hex.encode(tx.extract())

  const txid = await broadcastBitcoin(rawHex)
  return { txHash: txid, explorerUrl: `${mode.explorer}/${txid}` }
}

export async function broadcastBitcoin(rawHex: string): Promise<string> {
  let lastErr = 'Broadcast failed'
  for (const base of btcMode().esplora) {
    try {
      const res = await fetch(`${base}/tx`, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: rawHex, signal: AbortSignal.timeout(20_000),
      })
      const text = (await res.text()).trim()
      if (res.ok && /^[0-9a-f]{64}$/i.test(text)) return text
      lastErr = text || `Broadcast ${res.status}`
    } catch (e) {
      lastErr = String(e).includes('abort') ? 'Broadcast timed out' : 'Broadcast network error'
    }
  }
  throw new Error(lastErr)
}

// ── PSBT signing (for dApp/marketplace provider) ─────────────────────────────

export interface PsbtSignRequest {
  psbt: string                          // base64 OR hex
  signInputs?: Record<string, number[]> // address → input indices to sign (sats-connect / Unisat)
  finalize?: boolean                    // finalize signed inputs (default true)
  extractTx?: boolean                   // also return the extracted raw tx hex (requires full finalize)
}

function decodePsbt(s: string): Uint8Array {
  const t = s.trim()
  return /^[0-9a-fA-F]+$/.test(t) && t.length % 2 === 0 ? hex.decode(t) : base64.decode(t)
}

/**
 * Sign a PSBT the dApp/marketplace constructed. We only ever sign the inputs the
 * caller asks for (signInputs) — or, if none specified, only inputs the wallet's
 * own keys actually own — and pick the matching key per address (P2WPKH/P2SH ECDSA,
 * P2TR schnorr; @scure/btc-signer applies the BIP-86 tweak). Returns the signed PSBT
 * in both encodings (Unisat wants hex, sats-connect/WBIP wants base64).
 */
export async function signBitcoinPsbt(
  req: PsbtSignRequest, mnemonic: string, addresses: BtcAddresses, accountIndex = 0
): Promise<{ psbtBase64: string; psbtHex: string; txHex?: string }> {
  const tx = btc.Transaction.fromPSBT(decodePsbt(req.psbt), { allowUnknownInputs: true, allowUnknownOutputs: true })

  const { testnet } = btcMode()
  const [nat, nes, tap] = await Promise.all([
    getBitcoinKey(mnemonic, accountIndex, testnet),
    getBitcoinNestedKey(mnemonic, accountIndex, testnet),
    getBitcoinTaprootKey(mnemonic, accountIndex, testnet),
  ])
  const keyFor = (addr: string): Uint8Array | null =>
    addr === addresses.bitcoin ? nat.privateKey
    : addr === addresses.bitcoinNested ? nes.privateKey
    : addr === addresses.bitcoinTaproot ? tap.privateKey
    : null

  if (req.signInputs && Object.keys(req.signInputs).length > 0) {
    for (const [addr, idxs] of Object.entries(req.signInputs)) {
      const key = keyFor(addr)
      if (!key) continue
      for (const i of idxs) { try { tx.signIdx(key, i) } catch { /* not ours / already signed */ } }
    }
  } else {
    // No explicit list — sign every input our keys actually own (sign() no-ops the rest).
    for (const key of [nat.privateKey, nes.privateKey, tap.privateKey]) {
      try { tx.sign(key) } catch { /* no matching inputs for this key */ }
    }
  }

  if (req.finalize !== false) { try { tx.finalize() } catch { /* leave partially signed if not every input is ours */ } }

  const psbtBytes = tx.toPSBT()
  const out: { psbtBase64: string; psbtHex: string; txHex?: string } = {
    psbtBase64: base64.encode(psbtBytes), psbtHex: hex.encode(psbtBytes),
  }
  if (req.extractTx) { try { out.txHex = hex.encode(tx.extract()) } catch { /* not fully finalized */ } }
  return out
}

// ── Message signing (BIP-137 ECDSA over the payment key) ─────────────────────
// Taproot/BIP-322 message signing is a known gap (see Phase notes).

function varint(n: number): Uint8Array {
  if (n < 0xfd) return new Uint8Array([n])
  if (n <= 0xffff) return new Uint8Array([0xfd, n & 0xff, (n >> 8) & 0xff])
  return new Uint8Array([0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff])
}

/** Bitcoin Signed Message (BIP-137) with a SegWit key. addressType picks the key + header offset. */
export async function signBitcoinMessage(
  message: string, addressType: 'native' | 'nested' | 'taproot', mnemonic: string, accountIndex = 0
): Promise<string> {
  if (addressType === 'taproot') {
    throw new Error('Taproot (bc1p) message signing uses BIP-322, which is not supported yet — sign with the payment address.')
  }
  const { testnet } = btcMode()
  const { privateKey } = addressType === 'nested'
    ? await getBitcoinNestedKey(mnemonic, accountIndex, testnet)
    : await getBitcoinKey(mnemonic, accountIndex, testnet)

  const msgBytes = new TextEncoder().encode(message)
  const magic = new TextEncoder().encode('Bitcoin Signed Message:\n')
  const preimage = new Uint8Array([magic.length, ...magic, ...varint(msgBytes.length), ...msgBytes])
  const digest = sha256(sha256(preimage))

  const sig = secp256k1.sign(digest, privateKey)
  // BIP-137 header: P2SH-P2WPKH (nested) = 35 + rec; P2WPKH (native) = 39 + rec.
  const header = (addressType === 'nested' ? 35 : 39) + (sig.recovery ?? 0)
  return base64.encode(new Uint8Array([header, ...sig.toCompactRawBytes()]))
}
