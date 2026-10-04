/**
 * xreserve-cardano-provider.ts — read-only providers for the xReserve mint
 * locator and the global USDCx audit: Blockfrost (through the wallet's own
 * `blockfrostFetch`) and Circle's xReserve attestation endpoint.
 *
 * NOT WIRED IN. No polling loop, session, UI or signing lives here; this only
 * turns documented HTTP endpoints into the `CardanoMintReader` /
 * `UsdcxAssetReader` interfaces and a Circle fetch that keeps its hash binding.
 *
 * Endpoints (Blockfrost OpenAPI; measured through the wallet proxy 2026-09-29):
 *   addresses/{address}/transactions?order=asc&count=&page=1&from=block:index
 *   assets/{unit}/transactions?order=asc&count=&page=1&from=block:index
 *       `from` is INCLUSIVE. An address with no history in range answers
 *       200 [] (measured), so a 404 here is unexpected and is an error — never
 *       read as empty history.
 *   txs/{hash}          confirmed block height (and the hash, checked)
 *   txs/{hash}/cbor     complete transaction CBOR
 *   txs/{hash}/utxos    outputs. Blockfrost ALSO lists the collateral-return
 *                       output with `collateral: true` even for a VALID
 *                       transaction (measured on 24da9d4f…: body outputs 0-4,
 *                       listed outputs 0-5). Those are excluded, so the list
 *                       matches the transaction body the proof reads.
 *   blocks/latest       tip height
 *   Circle: GET https://xreserve-api.circle.com/v1/attestations?txHash=0x…
 *       A hash Circle has not attested answers 200 {"attestations":[]}
 *       (measured); only that is "awaiting", never an HTTP error.
 *
 * FAILURES are thrown, never papered over: 402/418/429 → rate-limited (quota,
 * ban, throttle), 403 and 5xx and transport errors/timeouts → unavailable,
 * 404 → not-found, bad shapes or inconsistent data → malformed. Messages name
 * the endpoint kind and HTTP status only — never a URL, which with the proxy
 * carries the client tag, and never a key.
 *
 * NETWORKS. `network` (xreserve-network.ts) selects mainnet (default: the
 * wallet's proxied Blockfrost, Circle's mainnet API) or Sepolia → Preprod
 * (Blockfrost Cardano Preprod with the user's own preprod project id, Circle's
 * testnet API). Addresses are checked against that network's bech32 prefix.
 */

import { blockfrostFetch as walletBlockfrostFetch, blockfrostPreprodFetch } from './api-proxy'
import { xreserveNetwork, type XReserveNetwork } from './xreserve-network'
import type { WalletConfig } from './secure-store'
import {
  CardanoReaderError, type CardanoMintReader, type AddressTxRow, type ConfirmedTx, type CardanoOutputs,
} from './xreserve-cardano-mint-locator'
import { AuditReaderError, type UsdcxAssetReader } from './xreserve-cardano-mint-audit'

export type ProviderFaultKind = 'rate-limited' | 'unavailable' | 'malformed' | 'not-found'

/** The adapter's own failure; translated to each scanner's error class at the boundary. */
export class ProviderFault extends Error {
  constructor(readonly kind: ProviderFaultKind, message: string) { super(message) }
}
const fault = (kind: ProviderFaultKind, message: string): never => { throw new ProviderFault(kind, message) }

export type BlockfrostFetchFn = (path: string, config: WalletConfig, timeoutMs?: number) => Promise<Response>

export interface BlockfrostReaderOptions {
  config: WalletConfig
  /**
   * Defaults to the wallet's `blockfrostFetch` (proxy with injected key, or the
   * user's own key) on mainnet, and to `blockfrostPreprodFetch` on Preprod.
   */
  blockfrostFetch?: BlockfrostFetchFn
  timeoutMs?: number
  /** xReserve network profile; mainnet when omitted. */
  network?: XReserveNetwork
}

/** Blockfrost's documented maximum page size. */
const MAX_COUNT = 100
const HEX64 = /^[0-9a-fA-F]{64}$/
const UINT = /^(0|[1-9][0-9]*)$/

function faultForStatus(status: number, what: string): ProviderFault {
  if (status === 402 || status === 418 || status === 429) return new ProviderFault('rate-limited', `${what}: provider limit (HTTP ${status})`)
  if (status === 404) return new ProviderFault('not-found', `${what}: not found (HTTP 404)`)
  if (status === 403 || status >= 500) return new ProviderFault('unavailable', `${what}: provider unavailable (HTTP ${status})`)
  return new ProviderFault('unavailable', `${what}: unexpected response (HTTP ${status})`)
}

async function getJson(opts: BlockfrostReaderOptions, path: string, what: string): Promise<unknown> {
  const fetchFn = opts.blockfrostFetch
    ?? (xreserveNetwork(opts.network).cardano.networkId === 1 ? walletBlockfrostFetch : blockfrostPreprodFetch)
  let res: Response
  try {
    res = await fetchFn(path, opts.config, opts.timeoutMs ?? 12_000)
  } catch {
    // Timeout or transport error. The thrown error is not echoed: it can carry the request URL.
    return fault('unavailable', `${what}: request failed or timed out`)
  }
  if (!res || typeof res.status !== 'number') return fault('unavailable', `${what}: no response`)
  if (res.status !== 200) throw faultForStatus(res.status, what)
  try {
    return await res.json()
  } catch {
    return fault('malformed', `${what}: response is not JSON`)
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const nonNegInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0

function checkCursor(from: { blockHeight: number; txIndex: number }, count: number): void {
  if (!from || !nonNegInt(from.blockHeight) || !nonNegInt(from.txIndex)) fault('malformed', 'history cursor must be non-negative integers')
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_COUNT) fault('malformed', `history count must be 1-${MAX_COUNT}`)
}

function historyRows(body: unknown, count: number, what: string): AddressTxRow[] {
  if (!Array.isArray(body)) return fault('malformed', `${what}: expected a list`)
  if (body.length > count) fault('malformed', `${what}: more rows than requested`)
  return body.map((r, i) => {
    if (!isObj(r) || typeof r.tx_hash !== 'string' || !HEX64.test(r.tx_hash) || !nonNegInt(r.tx_index) || !nonNegInt(r.block_height)) {
      return fault('malformed', `${what}: row ${i} is malformed`)
    }
    return { txHash: r.tx_hash.toLowerCase(), blockHeight: r.block_height, txIndex: r.tx_index }
  })
}

function historyPath(prefix: string, from: { blockHeight: number; txIndex: number }, count: number): string {
  return `${prefix}/transactions?order=asc&count=${count}&page=1&from=${from.blockHeight}:${from.txIndex}`
}

function checkTxHash(txHash: string): string {
  if (typeof txHash !== 'string' || !HEX64.test(txHash)) fault('malformed', 'transaction hash is malformed')
  return txHash.toLowerCase()
}

/** Shared Blockfrost reads; throws `ProviderFault`. */
export function blockfrostMintReads(opts: BlockfrostReaderOptions) {
  const net = xreserveNetwork(opts.network)
  // bech32 data charset only, after the network's own prefix.
  const addressRe = net.cardano.networkId === 1 ? /^addr1[02-9ac-hj-np-z]{50,120}$/ : /^addr_test1[02-9ac-hj-np-z]{50,120}$/
  return {
    async addressTransactions(address: string, from: { blockHeight: number; txIndex: number }, count: number): Promise<AddressTxRow[]> {
      // Mainnet bech32 only; it is also a path segment, so nothing else may pass.
      if (typeof address !== 'string' || !addressRe.test(address)) fault('malformed', `address is not a ${net.cardano.name} bech32 address`)
      checkCursor(from, count)
      return historyRows(await getJson(opts, historyPath(`addresses/${address}`, from, count), 'address history'), count, 'address history')
    },

    async assetTransactions(assetUnit: string, from: { blockHeight: number; txIndex: number }, count: number): Promise<AddressTxRow[]> {
      if (typeof assetUnit !== 'string' || !/^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/.test(assetUnit)) fault('malformed', 'asset unit is malformed')
      checkCursor(from, count)
      return historyRows(await getJson(opts, historyPath(`assets/${assetUnit}`, from, count), 'asset history'), count, 'asset history')
    },

    async confirmedTransaction(txHash: string): Promise<ConfirmedTx> {
      const hash = checkTxHash(txHash)
      const meta = await getJson(opts, `txs/${hash}`, 'transaction')
      if (!isObj(meta) || typeof meta.hash !== 'string' || meta.hash.toLowerCase() !== hash) fault('malformed', 'transaction: provider returned a different transaction')
      const m = meta as Record<string, unknown>
      if (!nonNegInt(m.block_height)) fault('malformed', 'transaction: no confirmed block height')
      const raw = await getJson(opts, `txs/${hash}/cbor`, 'transaction CBOR')
      if (!isObj(raw) || typeof raw.cbor !== 'string' || !/^([0-9a-fA-F]{2})+$/.test(raw.cbor)) fault('malformed', 'transaction CBOR: not hex')
      return { txHash: hash, blockHeight: m.block_height as number, cbor: ((raw as Record<string, unknown>).cbor as string).toLowerCase() }
    },

    async transactionOutputs(txHash: string): Promise<CardanoOutputs> {
      const hash = checkTxHash(txHash)
      const body = await getJson(opts, `txs/${hash}/utxos`, 'transaction outputs')
      if (!isObj(body) || typeof body.hash !== 'string' || body.hash.toLowerCase() !== hash || !Array.isArray(body.outputs)) {
        fault('malformed', 'transaction outputs: provider returned a different or malformed transaction')
      }
      const outputs = ((body as Record<string, unknown>).outputs as unknown[])
        .map((o, i) => {
          if (!isObj(o) || typeof o.address !== 'string' || !nonNegInt(o.output_index) || !Array.isArray(o.amount) || typeof o.collateral !== 'boolean') {
            return fault('malformed', `transaction outputs: output ${i} is malformed`)
          }
          return o as { address: string; output_index: number; amount: unknown[]; collateral: boolean }
        })
        // The collateral return is listed even when it was never created (valid transaction).
        .filter(o => !o.collateral)
        .map(o => {
          let lovelace: string | null = null
          const assets: Array<{ unit: string; quantity: string }> = []
          for (const a of o.amount) {
            if (!isObj(a) || typeof a.unit !== 'string' || typeof a.quantity !== 'string' || !UINT.test(a.quantity)) {
              return fault('malformed', `transaction outputs: output ${o.output_index} has a malformed amount`)
            }
            if (a.unit === 'lovelace') {
              if (lovelace !== null) fault('malformed', `transaction outputs: output ${o.output_index} lists lovelace twice`)
              lovelace = a.quantity
            } else {
              const unit = a.unit.toLowerCase()
              if (!/^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/.test(unit) || assets.some(x => x.unit === unit)) {
                fault('malformed', `transaction outputs: output ${o.output_index} has a malformed or repeated asset`)
              }
              assets.push({ unit, quantity: a.quantity })
            }
          }
          if (lovelace === null) fault('malformed', `transaction outputs: output ${o.output_index} has no lovelace`)
          return { index: o.output_index, address: o.address, lovelace: lovelace as string, assets }
        })
        .sort((a, b) => a.index - b.index)
      // Regular outputs must be exactly 0..n-1, as in the transaction body.
      outputs.forEach((o, i) => { if (o.index !== i) fault('malformed', 'transaction outputs: indexes are not contiguous') })
      return outputs
    },

    async tip(): Promise<{ blockHeight: number }> {
      const b = await getJson(opts, 'blocks/latest', 'chain tip')
      if (!isObj(b) || !nonNegInt(b.height)) fault('malformed', 'chain tip: no block height')
      return { blockHeight: (b as Record<string, unknown>).height as number }
    },
  }
}

/** Run a read, rethrowing any failure as the scanner's own error class. */
async function as<T>(read: () => Promise<T>, wrap: (kind: ProviderFaultKind, message: string) => Error): Promise<T> {
  try {
    return await read()
  } catch (e) {
    if (e instanceof ProviderFault) throw wrap(e.kind, e.message)
    throw wrap('unavailable', 'provider read failed')
  }
}

/** Reader for the recipient-address locator (throws `CardanoReaderError`). */
export function createBlockfrostLocatorReader(opts: BlockfrostReaderOptions): CardanoMintReader {
  const r = blockfrostMintReads(opts)
  const wrap = (k: ProviderFaultKind, m: string) => new CardanoReaderError(k, m)
  return {
    addressTransactions: (address, from, count) => as(() => r.addressTransactions(address, from, count), wrap),
    confirmedTransaction: (txHash) => as(() => r.confirmedTransaction(txHash), wrap),
    transactionOutputs: (txHash) => as(() => r.transactionOutputs(txHash), wrap),
    tip: () => as(() => r.tip(), wrap),
  }
}

/** Reader for the global USDCx audit (throws `AuditReaderError`). */
export function createBlockfrostAuditReader(opts: BlockfrostReaderOptions): UsdcxAssetReader {
  const r = blockfrostMintReads(opts)
  const wrap = (k: ProviderFaultKind, m: string) => new AuditReaderError(k, m)
  return {
    assetTransactions: (unit, from, count) => as(() => r.assetTransactions(unit, from, count), wrap),
    confirmedTransaction: (txHash) => as(() => r.confirmedTransaction(txHash), wrap),
    transactionOutputs: (txHash) => as(() => r.transactionOutputs(txHash), wrap),
    tip: () => as(() => r.tip(), wrap),
  }
}

// ── Circle ────────────────────────────────────────────────────────────────────

/** Circle's documented mainnet endpoint (GET /v1/attestations?txHash=). */
export const XRESERVE_ATTESTATIONS_URL = 'https://xreserve-api.circle.com/v1/attestations'

export type HttpFetchFn = (url: string, init?: RequestInit) => Promise<Response>

/**
 * Fetch Circle's attestations for EXACTLY `sourceTxHash`, returned together
 * with the hash it was requested for — the pair the proof, locator and audit
 * require. `{ attestations: [] }` is Circle's own "not yet"; any HTTP error or
 * malformed body is thrown as a `ProviderFault`, never turned into an empty list.
 *
 * `fetchFn` defaults to the global fetch; Electron's main process should pass
 * its Chromium `net.fetch`, as swap-proxy.ts does, because Node's fetch can hang.
 */
export async function fetchXReserveAttestation(
  sourceTxHash: string, opts: { fetchFn?: HttpFetchFn; timeoutMs?: number; network?: XReserveNetwork } = {},
): Promise<{ requestedTxHash: string; response: { attestations: unknown[] } }> {
  const net = xreserveNetwork(opts.network)
  if (typeof sourceTxHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(sourceTxHash)) {
    return fault('malformed', 'Circle attestation: source transaction hash is malformed')
  }
  const requestedTxHash = sourceTxHash.toLowerCase()
  const fetchFn = opts.fetchFn ?? ((url: string, init?: RequestInit) => fetch(url, init))
  let res: Response
  try {
    res = await fetchFn(`${net.circleApiBase}/v1/attestations?txHash=${requestedTxHash}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
    })
  } catch {
    return fault('unavailable', 'Circle attestation: request failed or timed out')
  }
  if (!res || typeof res.status !== 'number') return fault('unavailable', 'Circle attestation: no response')
  if (res.status !== 200) throw faultForStatus(res.status, 'Circle attestation')
  let body: unknown
  try { body = await res.json() } catch { return fault('malformed', 'Circle attestation: response is not JSON') }
  if (!isObj(body) || !Array.isArray(body.attestations) || !(body.attestations as unknown[]).every(isObj)) {
    return fault('malformed', 'Circle attestation: response has no attestation list')
  }
  return { requestedTxHash, response: { attestations: body.attestations as unknown[] } }
}
