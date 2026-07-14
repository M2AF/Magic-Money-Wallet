/**
 * monero-rpc.ts — plain-fetch Monero daemon RPC helpers (node pick, height,
 * fee estimate). No WASM, no monero-ts — safe in every runtime including the
 * extension's MV3 service worker. The WASM-heavy scanning/sending lives in
 * monero-impl.ts behind per-target loaders.
 */

import { MONERO_NODES } from './chain-config'
import type { WalletConfig } from './secure-store'
import type { FeeEstimate } from './tx-sender'

export const XMR_ATOMIC = 1e12   // 1 XMR = 1e12 atomic units

/** First node that answers get_info within the timeout; also returns the tip height. */
export async function pickNode(): Promise<{ uri: string; height: number }> {
  let lastErr = 'No Monero node reachable'
  for (const uri of MONERO_NODES) {
    try {
      const res = await fetch(`${uri}/json_rpc`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: '0', method: 'get_info' }),
        signal: AbortSignal.timeout(8_000)
      })
      if (!res.ok) { lastErr = `${uri} → ${res.status}`; continue }
      const json = await res.json() as { result?: { height?: number } }
      if (json.result?.height) return { uri, height: json.result.height }
    } catch (err) {
      lastErr = `${uri} → ${String(err)}`
    }
  }
  throw new Error(lastErr)
}

/** Current chain height — used to stamp the wallet birthday at first enable. */
export async function fetchMoneroHeight(): Promise<number> {
  return (await pickNode()).height
}

// Typical 2-in/2-out RingCT tx weight; display-only estimate (the real fee is
// computed by wallet2 inside monero-ts at send time).
const TYPICAL_TX_BYTES = 1500

export async function estimateMoneroFee(_to: string, _config: WalletConfig): Promise<FeeEstimate> {
  const { uri } = await pickNode()
  const res = await fetch(`${uri}/json_rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: '0', method: 'get_fee_estimate' }),
    signal: AbortSignal.timeout(8_000)
  })
  if (!res.ok) throw new Error(`Monero node ${res.status} on fee estimate`)
  const json = await res.json() as { result?: { fee?: number } }
  const perByte = json.result?.fee ?? 0
  const feeXmr = (perByte * TYPICAL_TX_BYTES) / XMR_ATOMIC

  let feeUsd: string | null = null
  try {
    const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=monero&vs_currencies=usd', { signal: AbortSignal.timeout(5_000) })
    const priceJson = await priceRes.json() as { monero?: { usd?: number } }
    const price = priceJson.monero?.usd ?? 0
    if (price > 0) feeUsd = `$${(feeXmr * price).toFixed(4)}`
  } catch { /* price optional */ }

  return { fee: feeXmr.toFixed(8), feeSymbol: 'XMR', feeUsd }
}
