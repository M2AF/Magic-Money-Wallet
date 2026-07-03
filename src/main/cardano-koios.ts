/**
 * cardano-koios.ts — keyless Koios fallback for Cardano
 *
 * Blockfrost is the wallet's primary Cardano backend (balance, UTXOs, tx submit).
 * It needs an API key (routed through the proxy) and is a single point of failure.
 * Koios (https://api.koios.rest) is a free, keyless Cardano API with a DIFFERENT
 * request/response shape. These helpers translate ONLY the three operations the
 * wallet needs to keep working when Blockfrost is down — native balance, spendable
 * UTXOs, and broadcast — into the shapes the existing callers already use.
 *
 * Enrichment (token metadata, tx history) is intentionally NOT mirrored: if
 * Blockfrost is down those degrade gracefully (missing token USD / history) while
 * balance + sends still work. All helpers return null (reads) or throw (submit) on
 * failure so callers can fall back cleanly.
 */

import { KOIOS_URL } from './chain-config'
import type { CardanoUtxo } from './cardano-pure'

function koiosPost(path: string, body: unknown, timeoutMs = 12_000, base = KOIOS_URL): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

/**
 * Native ADA balance in lovelace at a payment address, or null if Koios is
 * unreachable. Koios `/address_info.balance` is the per-address controlled lovelace
 * — for this wallet's single-address-per-account HD scheme that matches the
 * Blockfrost stake `controlled_amount` closely enough for a down-Blockfrost fallback.
 */
export async function koiosAddressLovelace(address: string, base = KOIOS_URL): Promise<number | null> {
  try {
    const res = await koiosPost('/address_info', { _addresses: [address] }, 12_000, base)
    if (!res.ok) return null
    const rows = await res.json() as Array<{ balance?: string }>
    if (!Array.isArray(rows)) return null
    if (rows.length === 0) return 0   // address not seen on-chain = zero balance
    return Number(rows[0]?.balance ?? '0')
  } catch { return null }
}

/**
 * Spendable UTXOs normalized to the wallet's CardanoUtxo shape (lovelace only —
 * the ADA send path doesn't spend native tokens), or null if Koios is unreachable.
 */
export async function koiosAddressUtxos(address: string, base = KOIOS_URL): Promise<CardanoUtxo[] | null> {
  try {
    const res = await koiosPost('/address_utxos', { _addresses: [address], _extended: false }, 12_000, base)
    if (!res.ok) return null
    const rows = await res.json() as Array<{ tx_hash: string; tx_index: number; value: string }>
    if (!Array.isArray(rows)) return null
    return rows.map(u => ({
      txHash: u.tx_hash,
      txIndex: u.tx_index,
      lovelace: BigInt(u.value ?? '0'),
    }))
  } catch { return null }
}

/**
 * Broadcast a signed transaction (CBOR bytes) via Koios `/submittx`. Returns the
 * tx hash Koios echoes back. Throws on any failure so the caller can surface the
 * original Blockfrost error instead.
 */
export async function koiosSubmitTx(txCbor: Uint8Array, base = KOIOS_URL): Promise<string> {
  const res = await fetch(`${base}/submittx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/cbor' },
    body: new Uint8Array(txCbor),   // fresh ArrayBuffer-backed copy → valid BodyInit
    signal: AbortSignal.timeout(20_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Koios submit failed (${res.status}): ${body.slice(0, 200)}`)
  }
  const hash = await res.json().catch(() => null) as string | null
  if (!hash || typeof hash !== 'string') throw new Error('Koios submit: no tx hash returned')
  return hash
}
