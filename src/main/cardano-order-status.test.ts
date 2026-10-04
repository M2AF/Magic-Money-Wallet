/**
 * Minswap order status: finding the transaction that spent the order, and
 * classifying it from that transaction's own inputs and outputs.
 *
 * Blockfrost is mocked with a small in-memory chain; every request is recorded
 * so "no rescans" is asserted from the requests themselves. The order datums
 * are the REAL ones from the recorded live builds (src/main/__fixtures__/minswap).
 * Live, read-only verification against a completed mainnet order is recorded
 * separately in docs/CARDANO-SWAP-DISCOVERY.md — nothing here is live evidence.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const bf = vi.hoisted(() => ({ handler: null as null | ((path: string) => { status: number; body?: unknown }), calls: [] as string[] }))
vi.mock('./api-proxy', async (orig) => ({
  ...(await orig<typeof import('./api-proxy')>()),
  blockfrostFetch: vi.fn(async (path: string) => {
    bf.calls.push(path)
    const r = bf.handler!(path)
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status })
  }),
}))

import {
  getMinswapOrderStatus, __clearMinswapScanCursors, SCAN_TX_LOOKUPS_PER_POLL,
  MINSWAP_UNEXPLAINED_SPEND_MESSAGE, type MinswapOrderScanCursor,
} from './cardano-swap'
import { getCrossSwapStatus, type CrossSwapStatusRequest, type CrossSwapStatus } from './swap-proxy'
import type { SettledSwapSession } from '../shared/swap-settlement'
import { splitTxRoot, hexToBytesStrict } from './cardano-swap-validate'
import { decodeCbor, CborMap } from './cardano-tx-inspect'
import { CARDANO_USDCX_UNIT } from '../shared/swap-token-identity'
import type { WalletConfig } from './secure-store'

const FIX = join(__dirname, '__fixtures__', 'minswap')
const load = (name: string) => JSON.parse(readFileSync(join(FIX, `${name}.json`), 'utf8'))
function orderDatumHex(txHex: string): string {
  const body = decodeCbor(splitTxRoot(hexToBytesStrict(txHex)).body) as CborMap
  for (const out of body.getInt(1) as unknown[]) {
    if (out instanceof CborMap && out.getInt(2) !== undefined) return Buffer.from((out.getInt(2) as [bigint, Uint8Array])[1]).toString('hex')
  }
  throw new Error('no order output')
}

const WALLET = 'addr1q8008tnk6x22qh7xl38znc5p6c52hp8wtfrxaq0yrer9az8fahsvrvjs2nte6d95crak93gphy32u868qqtx3s4r5dxqxpj8mk'
// The V2 order script, staked to WALLET — the address the recorded builds pay the order to.
const ORDER_ADDR = 'addr1z8p79rpkcdz8x9d6tft0x0dx5mwuzac2sa4gm8cvkw5hcn8fahsvrvjs2nte6d95crak93gphy32u868qqtx3s4r5dxqvxwxue'
const USDCX = CARDANO_USDCX_UNIT.mainnet
const SNEK = '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b'
const ORDER_TX = 'aa'.repeat(32)
const ORDER_HEIGHT = 1000
const h = (n: number) => n.toString(16).padStart(64, '0')

/** USDCx 10.0 sold for SNEK: swapAmount 10_000_000, max batcher fee 2 ADA (live datum). */
const TOKEN_SELL_DATUM = orderDatumHex(load('usdcx-snek-2hop').buildTx.cbor)
/** 20 ADA sold for USDCx: swapAmount 20_000_000, max batcher fee 2 ADA (live datum). */
const ADA_SELL_DATUM = orderDatumHex(load('ada-usdcx-1hop').buildTx.cbor)

type Amt = Record<string, string>
const amount = (a: Amt) => Object.entries(a).map(([unit, quantity]) => ({ unit, quantity }))
const out = (address: string, a: Amt, i = 0, extra: Record<string, unknown> = {}) =>
  ({ address, amount: amount(a), output_index: i, ...extra })
const inp = (address: string, a: Amt, txHash: string, i: number) =>
  ({ address, amount: amount(a), tx_hash: txHash, output_index: i })

interface Chain {
  orderOutput: Record<string, unknown>
  txs: Record<string, { inputs: unknown[]; outputs: unknown[] }>
  /** Wallet history after the order, oldest first. */
  history: Array<{ tx_hash: string; tx_index: number; block_height: number }>
  fail?: (path: string) => number | null
}

function install(chain: Chain) {
  bf.calls = []
  bf.handler = (path) => {
    const failed = chain.fail?.(path)
    if (failed) return { status: failed, body: { error: 'x' } }
    if (path === `txs/${ORDER_TX}/utxos`) {
      return { status: 200, body: { inputs: [], outputs: [out(WALLET, { lovelace: '1000000' }, 0), chain.orderOutput] } }
    }
    if (path === `txs/${ORDER_TX}`) return { status: 200, body: { block_height: ORDER_HEIGHT, index: 3 } }
    const utxo = /^txs\/([0-9a-f]{64})\/utxos$/.exec(path)
    if (utxo) {
      const tx = chain.txs[utxo[1]]
      return tx ? { status: 200, body: tx } : { status: 200, body: { inputs: [], outputs: [] } }
    }
    const list = /^addresses\/[^/]+\/transactions\?order=asc&count=(\d+)&from=(\d+):(\d+)$/.exec(path)
    if (list) {
      const [count, bh, bi] = [Number(list[1]), Number(list[2]), Number(list[3])]
      const all = [{ tx_hash: ORDER_TX, tx_index: 3, block_height: ORDER_HEIGHT }, ...chain.history]
      const rows = all.filter(t => t.block_height > bh || (t.block_height === bh && t.tx_index >= bi)).slice(0, count)
      return { status: 200, body: rows }
    }
    return { status: 404, body: { error: 'Not Found' } }
  }
}

const cfg = {} as WalletConfig
const req = (over: Partial<CrossSwapStatusRequest> = {}): CrossSwapStatusRequest => ({
  provider: 'minswap', txHash: ORDER_TX, fromChain: 'cardano', toChain: 'cardano',
  recipient: WALLET, expectedToTokenAddress: SNEK, minBuyAmountRaw: '15000', ...over,
})

/** A token-sell order output; `consumed` undefined = the field is absent (fallback path). */
const tokenOrder = (consumed?: string | null) => out(ORDER_ADDR, { lovelace: '4000000', [USDCX]: '10000000' }, 1, {
  inline_datum: TOKEN_SELL_DATUM, ...(consumed === undefined ? {} : { consumed_by_tx: consumed }),
})
const adaOrder = (consumed?: string | null) => out(ORDER_ADDR, { lovelace: '24000000' }, 1, {
  inline_datum: ADA_SELL_DATUM, ...(consumed === undefined ? {} : { consumed_by_tx: consumed }),
})
const BATCHER = 'addr1vxnrj2ne3vmgpz36v9usqu9pju0kqmr2u6pwuzztmu0z0msyvr7kg'
const spendOrder = inp(ORDER_ADDR, {}, ORDER_TX, 1)

/** Later wallet transactions that do NOT touch the order, one per block. */
const unrelated = (n: number, fromBlock = ORDER_HEIGHT + 1) => Array.from({ length: n }, (_, i) =>
  ({ tx_hash: h(i + 1), tx_index: 0, block_height: fromBlock + i }))
const fill = (hash: string) => ({ [hash]: {
  inputs: [spendOrder, inp(BATCHER, { lovelace: '5000000' }, 'bb'.repeat(32), 0)],
  outputs: [out(WALLET, { lovelace: '2100000', [SNEK]: '16100' })],
} })

beforeEach(() => { __clearMinswapScanCursors() })

describe('indexed lookup: consumed_by_tx on the order output', () => {
  it('ordinary fill: the bought token arrived — completed, measured net', async () => {
    const spender = 'cc'.repeat(32)
    install({ orderOutput: tokenOrder(spender), txs: fill(spender), history: [] })
    const s = await getMinswapOrderStatus(req(), cfg)
    expect(s.state).toBe('completed')
    expect(s.delivered?.amountRaw).toBe('16100')
    expect(s.destTxHash).toBe(spender)
    expect(bf.calls).toEqual([`txs/${ORDER_TX}/utxos`, `txs/${spender}/utxos`])   // no scan at all
  })

  it('ordinary refund (cancel): the sold token came back, net of the owner\'s own fee inputs', async () => {
    const spender = 'dd'.repeat(32)
    install({ orderOutput: tokenOrder(spender), history: [], txs: { [spender]: {
      // The owner's cancel: their own coin pays the fee, the order's contents come home.
      inputs: [spendOrder, inp(WALLET, { lovelace: '5000000' }, 'ee'.repeat(32), 0)],
      outputs: [out(WALLET, { lovelace: '8700000', [USDCX]: '10000000' })],
    } } })
    const s = await getMinswapOrderStatus(req(), cfg)
    expect(s.state).toBe('refunded')
    expect(s.delivered).toMatchObject({ address: USDCX, amountRaw: '10000000' })
  })

  it('ADA sold, then cancelled: refunded only because the ADA sold came back', async () => {
    const spender = 'd1'.repeat(32)
    install({ orderOutput: adaOrder(spender), history: [], txs: { [spender]: {
      inputs: [spendOrder, inp(WALLET, { lovelace: '3000000' }, 'ee'.repeat(32), 0)],
      outputs: [out(WALLET, { lovelace: '26800000' })],
    } } })
    const s = await getMinswapOrderStatus(req({ expectedToTokenAddress: USDCX }), cfg)
    expect(s.state).toBe('refunded')
    expect(s.delivered).toMatchObject({ address: 'lovelace', amountRaw: '23800000' })
  })

  it('ADA sold and filled: the returned deposit is NOT mistaken for a refund', async () => {
    const spender = 'd2'.repeat(32)
    install({ orderOutput: adaOrder(spender), history: [], txs: { [spender]: {
      inputs: [spendOrder],
      outputs: [out(WALLET, { lovelace: '2150000', [USDCX]: '5070000' })],
    } } })
    const s = await getMinswapOrderStatus(req({ expectedToTokenAddress: USDCX }), cfg)
    expect(s.state).toBe('completed')
    expect(s.delivered?.amountRaw).toBe('5070000')
  })

  it('ADA bought: the deposit is separated from the purchase, using the order\'s own datum', async () => {
    const spender = 'd3'.repeat(32)
    install({ orderOutput: tokenOrder(spender), history: [], txs: { [spender]: {
      inputs: [spendOrder], outputs: [out(WALLET, { lovelace: '8000000' })],
    } } })
    const s = await getMinswapOrderStatus(req({ expectedToTokenAddress: 'lovelace' }), cfg)
    expect(s.state).toBe('completed')
    // 8 ADA arrived; the order locked 4 ADA of which 2 was max batcher fee → 2 ADA deposit.
    expect(s.delivered?.amountRaw).toBe('6000000')
  })

  it('an unspent order (consumed_by_tx null) is open on indexed evidence, with no scan', async () => {
    install({ orderOutput: tokenOrder(null), txs: {}, history: unrelated(3) })
    const s = await getMinswapOrderStatus(req(), cfg)
    expect(s.state).toBe('source-confirmed')
    expect(s.providerSubstatus).toBe('ORDER_OPEN')
    expect(bf.calls).toEqual([`txs/${ORDER_TX}/utxos`])
  })

  it('a spender with neither the bought nor the sold token is UNEXPLAINED — never a refund', async () => {
    const spender = 'ef'.repeat(32)
    install({ orderOutput: tokenOrder(spender), history: [], txs: { [spender]: {
      inputs: [spendOrder], outputs: [out(BATCHER, { lovelace: '4000000', [USDCX]: '10000000' })],
    } } })
    const s = await getMinswapOrderStatus(req(), cfg)
    expect(s.state).toBe('unknown')
    expect(s.providerSubstatus).toBe('UNEXPLAINED')
    expect(s.destTxHash).toBe(spender)
    // …and the full status path keeps that wording instead of the generic one.
    const full = await getCrossSwapStatus(req(), cfg)
    expect(full.state).toBe('unknown')
    expect(full.message).toBe(MINSWAP_UNEXPLAINED_SPEND_MESSAGE)
  })

  it('a partial return of the sold token is unexplained, not a refund', async () => {
    const spender = 'e1'.repeat(32)
    install({ orderOutput: tokenOrder(spender), history: [], txs: { [spender]: {
      inputs: [spendOrder], outputs: [out(WALLET, { lovelace: '2000000', [USDCX]: '5000000' })],
    } } })
    expect((await getMinswapOrderStatus(req(), cfg)).providerSubstatus).toBe('UNEXPLAINED')
  })

  it('a fill below the approved minimum is still reported as a shortfall by the full status path', async () => {
    const spender = 'cc'.repeat(32)
    install({ orderOutput: tokenOrder(spender), txs: fill(spender), history: [] })
    const s = await getCrossSwapStatus(req({ minBuyAmountRaw: '20000' }), cfg)
    expect(s.state).toBe('partial')
  })
})

describe('fallback scan (consumed_by_tx absent): bounded, resumable, never a false "open"', () => {
  const utxoLookups = () => bf.calls.filter(c => /^txs\/[0-9a-f]{64}\/utxos$/.test(c) && c !== `txs/${ORDER_TX}/utxos`)

  it('finds a spender at position 26 across two polls, without re-reading the first 20', async () => {
    const history = unrelated(30)
    const spender = history[25].tx_hash
    install({ orderOutput: tokenOrder(undefined), txs: fill(spender), history })

    const first = await getMinswapOrderStatus(req(), cfg)
    expect(first.state).toBe('unknown')                         // NOT "open": the scan is incomplete
    expect(first.providerSubstatus).toBe('SCAN_INCOMPLETE')
    expect(utxoLookups()).toHaveLength(SCAN_TX_LOOKUPS_PER_POLL)
    expect(first.orderScanCursor).toMatchObject({ blockHeight: history[19].block_height, txIndex: 0 })

    install({ orderOutput: tokenOrder(undefined), txs: fill(spender), history })
    const second = await getMinswapOrderStatus(req(), cfg)
    expect(second.state).toBe('completed')
    expect(second.destTxHash).toBe(spender)
    expect(utxoLookups().map(c => c.split('/')[1])).toEqual(history.slice(20, 26).map(t => t.tx_hash))
  })

  it('finds a spender past the first 100 later transactions (Blockfrost\'s page 2), reading each once', async () => {
    const history = unrelated(160)
    const spender = history[129].tx_hash
    const read: string[] = []
    let polls = 0
    let s
    do {
      install({ orderOutput: tokenOrder(undefined), txs: fill(spender), history })
      s = await getMinswapOrderStatus(req(), cfg)
      read.push(...utxoLookups().map(c => c.split('/')[1]))
      polls++
    } while (s.state === 'unknown' && polls < 20)
    expect(s.state).toBe('completed')
    expect(read).toEqual(history.slice(0, 130).map(t => t.tx_hash))   // every one once, in order, no rescans
    expect(polls).toBe(Math.ceil(130 / SCAN_TX_LOOKUPS_PER_POLL))
  })

  it('reports the order open only after a COMPLETE scan finds no spender', async () => {
    const history = unrelated(25)
    install({ orderOutput: tokenOrder(undefined), txs: {}, history })
    expect((await getMinswapOrderStatus(req(), cfg)).state).toBe('unknown')   // 20 of 25 read
    install({ orderOutput: tokenOrder(undefined), txs: {}, history })
    const done = await getMinswapOrderStatus(req(), cfg)
    expect(done.state).toBe('source-confirmed')
    expect(done.providerSubstatus).toBe('ORDER_OPEN')
    expect(utxoLookups()).toHaveLength(5)
  })

  it('an API failure midway is unknown, keeps the progress made, and the next poll resumes there', async () => {
    const history = unrelated(30)
    const spender = history[27].tx_hash
    install({
      orderOutput: tokenOrder(undefined), txs: fill(spender), history,
      fail: (path) => (path === `txs/${history[9].tx_hash}/utxos` ? 500 : null),
    })
    const failed = await getMinswapOrderStatus(req(), cfg)
    expect(failed.state).toBe('unknown')
    expect(failed.orderScanCursor).toMatchObject({ blockHeight: history[8].block_height })

    install({ orderOutput: tokenOrder(undefined), txs: fill(spender), history })
    const resumed = await getMinswapOrderStatus(req(), cfg)
    expect(utxoLookups()[0]).toBe(`txs/${history[9].tx_hash}/utxos`)   // picks up at the failed one
    expect(resumed.state).toBe('completed')
  })

  it('a rate limit is a retryable unknown, never "open"', async () => {
    install({ orderOutput: tokenOrder(undefined), txs: {}, history: unrelated(3),
      fail: (path) => (path.startsWith('addresses/') ? 429 : null) })
    const s = await getMinswapOrderStatus(req(), cfg)
    expect(s.state).toBe('unknown')
    expect(s.message).toMatch(/rate-limiting; will retry/)
  })

  it('after a restart, a PERSISTED cursor resumes the scan (no in-memory state)', async () => {
    const history = unrelated(30)
    const spender = history[24].tx_hash
    install({ orderOutput: tokenOrder(undefined), txs: fill(spender), history })
    const first = await getMinswapOrderStatus(req(), cfg)
    const persisted = first.orderScanCursor as MinswapOrderScanCursor

    __clearMinswapScanCursors()   // the process restarted; only the session's copy survives
    install({ orderOutput: tokenOrder(undefined), txs: fill(spender), history })
    const s = await getMinswapOrderStatus(req({ orderScanCursor: persisted }), cfg)
    expect(s.state).toBe('completed')
    expect(utxoLookups()[0]).toBe(`txs/${history[20].tx_hash}/utxos`)

    // A cursor for a DIFFERENT order is ignored rather than trusted.
    __clearMinswapScanCursors()
    install({ orderOutput: tokenOrder(undefined), txs: fill(spender), history })
    await getMinswapOrderStatus(req({ orderScanCursor: { ...persisted, orderRef: `${'ff'.repeat(32)}#1` } }), cfg)
    expect(utxoLookups()[0]).toBe(`txs/${history[0].tx_hash}/utxos`)
  })
})

describe('the scan cursor is persisted on the swap session', () => {
  it('reconcile stores the cursor the reader returned, and hands it back on the next poll', async () => {
    const { openSession, noteSwapBroadcast, reconcileSessions, orderScanCursorOf, __resetSwapSessions } = await import('./swap-sessions')
    __resetSwapSessions()
    const identity = { walletId: 'w', accountIndex: 0, environment: 'mainnet' as const, sourceAddress: WALLET, destinationAddress: WALLET }
    const quote = {
      provider: 'minswap', fromChain: 'cardano', toChain: 'cardano', fromTokenAddress: USDCX, toTokenAddress: SNEK,
      fromTokenSymbol: 'USDCx', toTokenSymbol: 'SNEK', sellAmountRaw: '10000000', buyAmountRaw: '16184',
      minBuyAmountRaw: '15855', toAddress: WALLET, appFee: null, txData: {}, cardanoOrder: { protocol: 'MinswapV2' },
    } as never
    await openSession('i1', quote, identity, { from: 6, to: 0 })
    await noteSwapBroadcast('i1', ORDER_TX, null, null)

    const cursor: MinswapOrderScanCursor = { orderRef: `${ORDER_TX}#1`, blockHeight: 1020, txIndex: 0 }
    const seen: Array<MinswapOrderScanCursor | null> = []
    const fetchStatus = async (session: SettledSwapSession): Promise<CrossSwapStatus> => {
      seen.push(orderScanCursorOf(session))
      return { status: 'pending', state: 'unknown', error: null, providerStatus: 'UNKNOWN',
        providerSubstatus: 'SCAN_INCOMPLETE', message: 'still searching', orderScanCursor: cursor }
    }
    const after = await reconcileSessions(identity, fetchStatus)
    expect(orderScanCursorOf(after[0])).toEqual(cursor)
    expect(after[0].message).toBe('still searching')          // precise reason kept, not the generic one
    await reconcileSessions(identity, fetchStatus)
    expect(seen).toEqual([null, cursor])
    __resetSwapSessions()
  })
})
