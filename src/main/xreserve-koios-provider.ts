/**
 * xreserve-koios-provider.ts — keyless Koios readers for the xReserve mint
 * locator and the global USDCx audit (read-only, dependency-injected fetch).
 *
 * WHY. The Sepolia → Cardano Preprod test needs Cardano Preprod reads, and a
 * Blockfrost Preprod project id is not always available. Koios is keyless. It
 * fills the SAME `CardanoMintReader` / `UsdcxAssetReader` interfaces the
 * Blockfrost adapter fills, so the proof and confirmation rules are unchanged.
 *
 * KOIOS IS NOT BLOCKFROST. Measured on preprod.koios.rest 2026-09-30:
 *   • GET  /tip                → [{ block_height, block_no, … }]
 *   • POST /address_txs        { _addresses, _after_block_height } →
 *       [{ tx_hash, epoch_no, block_height, block_time }]. Despite its name,
 *       `_after_block_height` behaved INCLUSIVELY (a tx at exactly that height
 *       was returned); this adapter does not rely on either reading and filters
 *       locally. Rows carry NO position inside the block. Pagination is
 *       PostgREST `order`, `limit`, `offset` query parameters.
 *   • GET  /asset_history      → [{ minting_txs: [{ tx_hash, quantity, block_time }] }]
 *       every mint AND burn of the asset, newest first, in ONE response, with
 *       no height and no position. (`/asset_txs?_history=true` timed out at 90 s
 *       on Preprod, and `_history=false` omits transactions whose outputs were
 *       since spent — unusable for finding a past mint.)
 *   • GET  /blocks?block_height=eq.N  → the block's `block_time`
 *   • POST /tx_info            → block_height, `tx_block_index` (position in the
 *       block), regular `outputs` (collateral is a SEPARATE `collateral_output`
 *       field), and more; the flags below switch the heavy parts off.
 *   • POST /tx_cbor            → [{ tx_hash, block_height, cbor }]
 *
 * THE CURSOR CONTRACT is re-built here explicitly. Each history read returns
 * rows at or after (blockHeight, txIndex), ascending by (block height, position
 * in block), at most `count` rows, and FEWER than `count` only when the current
 * end of the history was reached. Koios pages are ordered by (block_height,
 * tx_hash) — not by position — so a page that fills up may cut a block in two:
 * that last block is dropped from the page and read again with the next page.
 * If the page budget runs out before a complete answer exists, the read THROWS
 * (retryable), so a scanner can never mistake an unfinished read for "no more
 * transactions".
 *
 * THE AUDIT'S CANDIDATES on Koios are the asset's mint and burn transactions
 * (asset_history — 3,675 events for Preprod USDCx on 2026-09-30, one response
 * in ~2 s) rather than every USDCx transfer. Only events after the cursor
 * block's time are positioned, oldest first, one tx_info batch at a time. Every mint is a mint event,
 * so no mint can be missed; transfers were only ever `unrelated` candidates.
 * A transaction that FAILED phase-2 validation mints nothing and may be absent;
 * that only affects the informational `mint-attempt-failed` state.
 *
 * FAILURES are thrown, never papered over: 429 → rate-limited; 403, 5xx
 * (504 included), transport errors and timeouts (a hard deadline, since Node's
 * fetch in Electron main can ignore abort signals) → unavailable; 404 → not-found; bad shapes or
 * inconsistent data → malformed. Messages carry no URL.
 */

import { TESTNET_KOIOS_URL, KOIOS_URL } from './chain-config'
import { xreserveNetwork, type XReserveNetwork } from './xreserve-network'
import { ProviderFault, type ProviderFaultKind } from './xreserve-cardano-provider'
import {
  CardanoReaderError, type CardanoMintReader, type AddressTxRow, type ConfirmedTx, type CardanoOutputs,
} from './xreserve-cardano-mint-locator'
import { AuditReaderError, type UsdcxAssetReader } from './xreserve-cardano-mint-audit'

export type KoiosFetchFn = (url: string, init?: RequestInit) => Promise<Response>

export interface KoiosReaderOptions {
  /** xReserve network profile; mainnet when omitted (Koios mainnet), Preprod → preprod.koios.rest. */
  network?: XReserveNetwork
  fetchFn?: KoiosFetchFn
  /** Per-request timeout, ms. */
  timeoutMs?: number
  /** Rows per history page (Koios allows up to 1000). */
  pageSize?: number
  /** Pages one history read may fetch before giving up (retryable). */
  maxPages?: number
  /** Most mint/burn events the audit accepts from asset_history in one read. */
  maxAssetEvents?: number
}

const HEX64 = /^[0-9a-fA-F]{64}$/
const UINT = /^(0|[1-9][0-9]*)$/
const UNIT_RE = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/
/** tx_info with everything heavy switched off. */
const TX_INFO_FLAGS = { _inputs: false, _metadata: false, _assets: false, _withdrawals: false, _certs: false, _scripts: false, _bytecode: false }
const TX_INFO_BATCH = 50

const fault = (kind: ProviderFaultKind, message: string): never => { throw new ProviderFault(kind, message) }
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const nonNegInt = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0

function faultForStatus(status: number, what: string): ProviderFault {
  if (status === 429) return new ProviderFault('rate-limited', `${what}: provider limit (HTTP ${status})`)
  if (status === 404) return new ProviderFault('not-found', `${what}: not found (HTTP 404)`)
  return new ProviderFault('unavailable', `${what}: provider unavailable (HTTP ${status})`)
}

interface Position { txHash: string; blockHeight: number; txIndex: number }

/** Koios reads shared by both readers; throws ProviderFault. */
export function koiosMintReads(opts: KoiosReaderOptions = {}) {
  const net = xreserveNetwork(opts.network)
  const base = net.cardano.networkId === 1 ? KOIOS_URL : TESTNET_KOIOS_URL
  const fetchFn = opts.fetchFn ?? ((url: string, init?: RequestInit) => fetch(url, init))
  const timeoutMs = opts.timeoutMs ?? 30_000
  const pageSize = Math.min(1000, Math.max(1, opts.pageSize ?? 100))
  const maxPages = Math.max(1, opts.maxPages ?? 10)
  const maxAssetEvents = Math.max(1, opts.maxAssetEvents ?? 2000)
  const addressRe = net.cardano.networkId === 1 ? /^addr1[02-9ac-hj-np-z]{50,120}$/ : /^addr_test1[02-9ac-hj-np-z]{50,120}$/

  async function call(path: string, what: string, body?: unknown): Promise<unknown> {
    // A HARD deadline as well as the abort signal: Node's fetch in Electron main
    // can ignore AbortSignal.timeout (see swap-proxy.ts), and a read must settle.
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), timeoutMs) })
    const exchange = (async () => {
      let res: Response
      try {
        res = await fetchFn(`${base}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: body === undefined ? { accept: 'application/json' } : { 'Content-Type': 'application/json', accept: 'application/json' },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch {
        // Timeout or transport error. The thrown error is not echoed: it can carry the URL.
        return fault('unavailable', `${what}: request failed or timed out`)
      }
      if (!res || typeof res.status !== 'number') return fault('unavailable', `${what}: no response`)
      if (res.status < 200 || res.status > 299) throw faultForStatus(res.status, what)
      try { return await res.json() } catch { return fault('malformed', `${what}: response is not JSON`) }
    })()
    exchange.catch(() => { /* a late failure after the deadline is already reported */ })
    try {
      return await Promise.race([exchange, deadline])
    } catch (e) {
      if (e instanceof ProviderFault) throw e
      return fault('unavailable', `${what}: request failed or timed out`)
    } finally {
      clearTimeout(timer)
    }
  }

  const checkHash = (h: unknown): string => {
    if (typeof h !== 'string' || !HEX64.test(h)) fault('malformed', 'transaction hash is malformed')
    return (h as string).toLowerCase()
  }
  const checkFrom = (from: { blockHeight: number; txIndex: number }, count: number) => {
    if (!from || !nonNegInt(from.blockHeight) || !nonNegInt(from.txIndex)) fault('malformed', 'history cursor must be non-negative integers')
    if (!Number.isSafeInteger(count) || count < 1 || count > 1000) fault('malformed', 'history count must be 1-1000')
  }

  /**
   * tx_info rows for these hashes, in batches; every hash must come back exactly
   * once. `withAssets` is REQUIRED for outputs: with `_assets: false` Koios
   * returns every output's asset_list empty (measured), which the proof would
   * rightly refuse as not matching the CBOR.
   */
  async function txInfo(hashes: string[], withAssets = false): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>()
    for (let i = 0; i < hashes.length; i += TX_INFO_BATCH) {
      const batch = hashes.slice(i, i + TX_INFO_BATCH)
      const body = await call('/tx_info', 'transaction info', { _tx_hashes: batch, ...TX_INFO_FLAGS, _assets: withAssets })
      if (!Array.isArray(body)) fault('malformed', 'transaction info: expected a list')
      for (const r of body as unknown[]) {
        if (!isObj(r) || typeof r.tx_hash !== 'string' || !HEX64.test(r.tx_hash)) fault('malformed', 'transaction info: malformed row')
        const h = (r as { tx_hash: string }).tx_hash.toLowerCase()
        if (out.has(h) || !batch.includes(h)) fault('malformed', 'transaction info: unexpected or repeated transaction')
        out.set(h, r as Record<string, unknown>)
      }
    }
    for (const h of hashes) if (!out.has(h)) fault('not-found', 'transaction info: a transaction is not (yet) indexed')
    return out
  }

  async function positions(hashes: string[]): Promise<Position[]> {
    const info = await txInfo(hashes)
    const taken = new Set<string>()
    return hashes.map(h => {
      const r = info.get(h) as Record<string, unknown>
      if (!nonNegInt(r.block_height) || !nonNegInt(r.tx_block_index)) fault('malformed', 'transaction info: no confirmed block position')
      // Two transactions cannot share one position in one block.
      const at = `${r.block_height}:${r.tx_block_index}`
      if (taken.has(at)) fault('malformed', 'transaction info: two transactions report the same block position')
      taken.add(at)
      return { txHash: h, blockHeight: r.block_height as number, txIndex: r.tx_block_index as number }
    })
  }

  const ahead = (a: { blockHeight: number; txIndex: number }, b: { blockHeight: number; txIndex: number }) =>
    a.blockHeight > b.blockHeight || (a.blockHeight === b.blockHeight && a.txIndex > b.txIndex)
  const atOrAfter = (p: Position, from: { blockHeight: number; txIndex: number }) => !ahead(from, p)
  const byPosition = (a: Position, b: Position) => a.blockHeight - b.blockHeight || a.txIndex - b.txIndex

  /**
   * Page through a height-ordered history (rows: hash + height) from
   * `from.blockHeight`, keeping only COMPLETE blocks, then position and filter.
   */
  async function historyFrom(
    page: (offset: number, limit: number) => Promise<unknown>, what: string,
    from: { blockHeight: number; txIndex: number }, count: number,
  ): Promise<AddressTxRow[]> {
    const rows: Array<{ txHash: string; blockHeight: number }> = []
    const seen = new Set<string>()
    let end = false
    let pages = 0
    for (; pages < maxPages; pages++) {
      const body = await page(pages * pageSize, pageSize)
      if (!Array.isArray(body) || body.length > pageSize) fault('malformed', `${what}: expected a list of at most ${pageSize}`)
      let prev = rows.length ? rows[rows.length - 1].blockHeight : -1
      for (const r of body as unknown[]) {
        if (!isObj(r) || typeof r.tx_hash !== 'string' || !HEX64.test(r.tx_hash) || !nonNegInt(r.block_height)) {
          fault('malformed', `${what}: malformed row`)
        }
        const rr = r as Record<string, unknown>
        const row = { txHash: (rr.tx_hash as string).toLowerCase(), blockHeight: rr.block_height as number }
        if (row.blockHeight < prev) fault('malformed', `${what}: rows are not in ascending block order`)
        prev = row.blockHeight
        if (row.blockHeight < from.blockHeight) continue   // tolerate an exclusive/inclusive difference
        if (seen.has(row.txHash)) continue                 // offset overlap: never counted twice
        seen.add(row.txHash)
        rows.push(row)
      }
      if ((body as unknown[]).length < pageSize) { end = true; break }
      // Rows below the newest height are whole blocks; enough of them ends paging.
      const top = rows.length ? rows[rows.length - 1].blockHeight : -1
      const complete = rows.filter(r => r.blockHeight < top).length
      const atFromBlock = rows.filter(r => r.blockHeight === from.blockHeight).length
      if (complete >= count + atFromBlock) break
    }
    let usable = rows
    if (!end) {
      const top = rows.length ? rows[rows.length - 1].blockHeight : -1
      usable = rows.filter(r => r.blockHeight < top)   // the newest block may continue on the next page
      if (usable.length === 0) fault('unavailable', `${what}: one block is larger than the page budget; will retry`)
    }
    const placed = await positions(usable.map(r => r.txHash))
    placed.forEach((p, i) => {
      if (p.blockHeight !== usable[i].blockHeight) fault('malformed', `${what}: a transaction's block height disagrees between reads`)
    })
    const result = placed.filter(p => atOrAfter(p, from)).sort(byPosition)
    if (!end && result.length < count) {
      fault('unavailable', `${what}: the history could not be read completely within the page budget; will retry`)
    }
    return result.slice(0, count).map(p => ({ txHash: p.txHash, blockHeight: p.blockHeight, txIndex: p.txIndex }))
  }

  return {
    async tip(): Promise<{ blockHeight: number }> {
      const body = await call('/tip', 'chain tip')
      const t = Array.isArray(body) && body.length === 1 && isObj(body[0]) ? body[0] as Record<string, unknown> : null
      const h = t ? (nonNegInt(t.block_height) ? t.block_height : t.block_no) : null
      if (!nonNegInt(h)) fault('malformed', 'chain tip: no block height')
      return { blockHeight: h as number }
    },

    async addressTransactions(address: string, from: { blockHeight: number; txIndex: number }, count: number): Promise<AddressTxRow[]> {
      if (typeof address !== 'string' || !addressRe.test(address)) fault('malformed', `address is not a ${net.cardano.name} bech32 address`)
      checkFrom(from, count)
      return historyFrom(
        (offset, limit) => call(`/address_txs?order=block_height.asc,tx_hash.asc&limit=${limit}&offset=${offset}`, 'address history',
          { _addresses: [address], _after_block_height: from.blockHeight }),
        'address history', from, count)
    },

    async assetTransactions(assetUnit: string, from: { blockHeight: number; txIndex: number }, count: number): Promise<AddressTxRow[]> {
      if (typeof assetUnit !== 'string' || !UNIT_RE.test(assetUnit)) fault('malformed', 'asset unit is malformed')
      checkFrom(from, count)
      // The cursor block's time bounds the events worth positioning.
      const blocks = await call(`/blocks?block_height=eq.${from.blockHeight}&select=block_height,block_time`, 'block')
      const b = Array.isArray(blocks) && blocks.length === 1 && isObj(blocks[0]) ? blocks[0] as Record<string, unknown> : null
      if (!b || b.block_height !== from.blockHeight || !nonNegInt(b.block_time)) fault('unavailable', 'block: the cursor block is not indexed yet; will retry')
      const fromTime = (b as Record<string, number>).block_time

      const history = await call(
        `/asset_history?_asset_policy=${assetUnit.slice(0, 56)}&_asset_name=${assetUnit.slice(56)}`, 'asset history')
      if (!Array.isArray(history) || history.length > 1) fault('malformed', 'asset history: expected at most one asset')
      const events = (history as unknown[]).length === 0 ? [] : (history as Array<Record<string, unknown>>)[0].minting_txs
      if (!Array.isArray(events)) fault('malformed', 'asset history: no event list')
      const pending: Array<{ txHash: string; time: number }> = []
      const seen = new Set<string>()
      for (const e of events as unknown[]) {
        if (!isObj(e) || typeof e.tx_hash !== 'string' || !HEX64.test(e.tx_hash) || !nonNegInt(e.block_time)) {
          fault('malformed', 'asset history: malformed event')
        }
        const ev = e as Record<string, unknown>
        const h = (ev.tx_hash as string).toLowerCase()
        if ((ev.block_time as number) >= fromTime && !seen.has(h)) { seen.add(h); pending.push({ txHash: h, time: ev.block_time as number }) }
      }
      if (pending.length > maxAssetEvents) fault('unavailable', 'asset history: too many events after the cursor for one read; will retry')
      // Oldest first. One slot is one second, so distinct blocks have distinct
      // times: positioning WHOLE time groups keeps every unpositioned event
      // strictly later than every positioned one.
      pending.sort((a, b) => a.time - b.time)
      const placed: Position[] = []
      let next = 0
      while (next < pending.length) {
        let end = Math.min(pending.length, next + TX_INFO_BATCH)
        while (end < pending.length && pending[end].time === pending[end - 1].time) end++
        placed.push(...(await positions(pending.slice(next, end).map(e => e.txHash))))
        next = end
        if (placed.filter(p => atOrAfter(p, from)).length >= count) break
      }
      const result = placed.filter(p => atOrAfter(p, from)).sort(byPosition)
      // Fewer than `count` only when every event after the cursor was positioned: the true end.
      return result.slice(0, count).map(p => ({ txHash: p.txHash, blockHeight: p.blockHeight, txIndex: p.txIndex }))
    },

    async confirmedTransaction(txHash: string): Promise<ConfirmedTx> {
      const hash = checkHash(txHash)
      const body = await call('/tx_cbor', 'transaction CBOR', { _tx_hashes: [hash] })
      if (!Array.isArray(body)) fault('malformed', 'transaction CBOR: expected a list')
      if ((body as unknown[]).length === 0) fault('not-found', 'transaction CBOR: not found')
      const r = (body as unknown[])[0]
      if ((body as unknown[]).length !== 1 || !isObj(r) || String(r.tx_hash).toLowerCase() !== hash) {
        fault('malformed', 'transaction CBOR: provider returned a different transaction')
      }
      const row = r as Record<string, unknown>
      if (!nonNegInt(row.block_height)) fault('malformed', 'transaction CBOR: no confirmed block height')
      if (typeof row.cbor !== 'string' || !/^([0-9a-fA-F]{2})+$/.test(row.cbor)) fault('malformed', 'transaction CBOR: not hex')
      return { txHash: hash, blockHeight: row.block_height as number, cbor: (row.cbor as string).toLowerCase() }
    },

    async transactionOutputs(txHash: string): Promise<CardanoOutputs> {
      const hash = checkHash(txHash)
      const r = (await txInfo([hash], true)).get(hash) as Record<string, unknown>
      if (!Array.isArray(r.outputs)) fault('malformed', 'transaction outputs: no output list')
      const outputs = (r.outputs as unknown[]).map((o, i) => {
        if (!isObj(o) || !nonNegInt(o.tx_index) || typeof o.value !== 'string' || !UINT.test(o.value)
            || !isObj(o.payment_addr) || typeof (o.payment_addr as Record<string, unknown>).bech32 !== 'string'
            || !Array.isArray(o.asset_list) || (o.tx_hash !== undefined && String(o.tx_hash).toLowerCase() !== hash)) {
          return fault('malformed', `transaction outputs: output ${i} is malformed`)
        }
        const assets: Array<{ unit: string; quantity: string }> = []
        for (const a of o.asset_list as unknown[]) {
          if (!isObj(a) || typeof a.policy_id !== 'string' || typeof a.quantity !== 'string' || !UINT.test(a.quantity)) {
            return fault('malformed', `transaction outputs: output ${o.tx_index} has a malformed asset`)
          }
          const unit = `${a.policy_id}${typeof a.asset_name === 'string' ? a.asset_name : ''}`.toLowerCase()
          if (!UNIT_RE.test(unit) || assets.some(x => x.unit === unit)) {
            return fault('malformed', `transaction outputs: output ${o.tx_index} has a malformed or repeated asset`)
          }
          assets.push({ unit, quantity: a.quantity })
        }
        return {
          index: o.tx_index as number,
          address: (o.payment_addr as Record<string, string>).bech32,
          lovelace: o.value as string,
          assets,
        }
      }).sort((a, b) => a.index - b.index)
      // Regular outputs are exactly 0..n-1, as in the transaction body; collateral is listed separately.
      outputs.forEach((o, i) => { if (o.index !== i) fault('malformed', 'transaction outputs: indexes are not contiguous') })
      return outputs
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

/** Koios reader for the recipient-address locator (throws `CardanoReaderError`). */
export function createKoiosLocatorReader(opts: KoiosReaderOptions = {}): CardanoMintReader {
  const r = koiosMintReads(opts)
  const wrap = (k: ProviderFaultKind, m: string) => new CardanoReaderError(k, m)
  return {
    addressTransactions: (address, from, count) => as(() => r.addressTransactions(address, from, count), wrap),
    confirmedTransaction: (txHash) => as(() => r.confirmedTransaction(txHash), wrap),
    transactionOutputs: (txHash) => as(() => r.transactionOutputs(txHash), wrap),
    tip: () => as(() => r.tip(), wrap),
  }
}

/** Koios reader for the global USDCx audit, over mint/burn events (throws `AuditReaderError`). */
export function createKoiosAuditReader(opts: KoiosReaderOptions = {}): UsdcxAssetReader {
  const r = koiosMintReads(opts)
  const wrap = (k: ProviderFaultKind, m: string) => new AuditReaderError(k, m)
  return {
    assetTransactions: (unit, from, count) => as(() => r.assetTransactions(unit, from, count), wrap),
    confirmedTransaction: (txHash) => as(() => r.confirmedTransaction(txHash), wrap),
    transactionOutputs: (txHash) => as(() => r.transactionOutputs(txHash), wrap),
    tip: () => as(() => r.tip(), wrap),
  }
}
