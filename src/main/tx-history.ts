/**
 * tx-history.ts — MagicMoney Wallet
 *
 * Fetches recent transaction history for all supported chains.
 * - Alchemy:    all EVM chains with alchemyNetwork set, Monad ('monad-mainnet'),
 *               and the Abstract Global Wallet under its own address
 * - Moralis:    monad fallback (v2.2 wallet history, chain 0x8f)
 * - Helius:     solana
 * - Blockfrost: cardano
 * - Statescan:  polkadot (Asset Hub + relay chain, public, keyless)
 *
 * A ChainHistory distinguishes three outcomes the UI must not blur:
 *   records = [] and error = null       → the provider answered: no activity
 *   error set                           → the provider is unavailable
 *   unsupported = true (error set too)  → no provider can index this network
 * `coverage` names what an answering provider does NOT index, so an empty or
 * short list is not read as complete.
 */

import type { WalletConfig } from './secure-store'
import { DOGE_API_BASE, activeEvmChains, isTestnet as isTestnetConfig } from './chain-config'
import { alchemyRpcUrl, heliusApiFetch, blockfrostFetch, moralisFetch, canMoralis } from './api-proxy'
import { tronAddrToHex } from './tron'
import { isSuspectedSpamToken } from './spam-filter'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface TxRecord {
  hash: string
  direction: 'in' | 'out' | 'self'
  amount: string | null
  symbol: string
  timestamp: number
  counterparty: string | null
  explorerUrl: string
}

export interface ChainHistory {
  records: TxRecord[]
  error: string | null
  /** No provider can index this network (as opposed to one failing right now). */
  unsupported?: boolean
  /** What the answering provider does not index, shown beside the list. */
  coverage?: string | null
}

const unsupported = (reason: string): ChainHistory => ({ records: [], error: reason, unsupported: true })

export type AllHistory = Record<string, ChainHistory>

// ─── Alchemy EVM (asset transfers) ────────────────────────────────────────────

type AlchemyTransfer = {
  hash: string
  blockNum?: string
  from: string
  to: string | null
  value: number | null
  asset: string | null
  category?: string
  metadata: { blockTimestamp: string } | null
}

type AlchemyTransfersResponse = { result?: { transfers: AlchemyTransfer[] }; error?: unknown }

/**
 * Networks where alchemy_getAssetTransfers accepts the 'internal' category
 * (native value moved by a contract call: refunds, payouts, unwraps). Measured
 * 2026-09-23 on every wallet network: every other one answers "The 'internal'
 * category is not supported" — Abstract and Monad included.
 */
export const ALCHEMY_INTERNAL_NETWORKS = new Set(['eth-mainnet', 'polygon-mainnet', 'base-mainnet', 'arc-mainnet'])

export const NO_INTERNAL_COVERAGE =
  'Native coin sent to this address by a contract (a refund or payout, for example) is not indexed on this network.'

const HISTORY_LIMIT = 10

const isTokenTransfer = (t: AlchemyTransfer) => t.category !== 'external' && t.category !== 'internal'

/**
 * Alchemy omits `metadata.blockTimestamp` on several networks (measured on
 * Avalanche, Blast, Gnosis, Abstract and ApeChain), which left those rows dated
 * 1970. Their block times are read in one batched request; a block that still
 * has no time keeps 0 and the list shows no date for it.
 */
async function blockTimes(rpcUrl: string, blocks: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (blocks.length === 0) return out
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(blocks.map((b, id) => ({ jsonrpc: '2.0', id, method: 'eth_getBlockByNumber', params: [b, false] }))),
      signal: AbortSignal.timeout(10_000)
    })
    const json = await res.json().catch(() => null) as Array<{ id: number; result?: { timestamp?: string } | null }> | null
    for (const r of Array.isArray(json) ? json : []) {
      const ts = r.result?.timestamp
      if (ts && blocks[r.id]) out.set(blocks[r.id], Number(BigInt(ts)) * 1000)
    }
  } catch { /* undated rows are shown undated */ }
  return out
}

async function fetchAlchemyHistory(
  address: string,
  rpcUrl: string,
  explorerBase: string,
  network: string,
  nativeSymbol = 'ETH',
): Promise<ChainHistory> {
  const internal = ALCHEMY_INTERNAL_NETWORKS.has(network)
  const category = ['external', 'erc20', 'erc721', 'erc1155', ...(internal ? ['internal'] : [])]
  const query = async (params: object): Promise<AlchemyTransfer[]> => {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers', params: [params] }),
      signal: AbortSignal.timeout(10_000)
    })
    const json = await res.json().catch(() => null) as AlchemyTransfersResponse | null
    // A proxy refusal ({"error":"Unknown network"}) or a JSON-RPC error is an
    // unavailable provider — never an empty history.
    if (!res.ok || !json || json.error || !Array.isArray(json.result?.transfers)) {
      const e = json?.error
      const msg = typeof e === 'string' ? e : (e as { message?: string } | undefined)?.message
      throw new Error(`Alchemy ${res.status}${msg ? `: ${msg}` : ''}`)
    }
    return json.result!.transfers
  }

  try {
    // Newest first: without `order: 'desc'` Alchemy returns the OLDEST transfers,
    // so a 10-row "recent" list showed an account's first ten transfers. 50 per
    // side leaves room for real rows after scam airdrops are filtered out.
    const common = { fromBlock: '0x0', toBlock: 'latest', category, order: 'desc', maxCount: '0x32', withMetadata: true, excludeZeroValue: true }
    const [out, inc] = await Promise.all([
      query({ ...common, fromAddress: address }),
      query({ ...common, toAddress: address }),
    ])

    // Scam airdrops put phishing copy in the token name ("$ CLAIM ON airstake.lol").
    // Listing them would lend the wallet's credibility to the link, so token
    // transfers the shared spam heuristic flags are left out, and counted.
    let hiddenSpam = 0
    const keep = (t: AlchemyTransfer) => {
      if (!isTokenTransfer(t) || !t.asset) return true
      if (!isSuspectedSpamToken({ name: t.asset, symbol: t.asset, usdValue: null })) return true
      hiddenSpam++
      return false
    }
    const tagged = [
      ...out.filter(keep).map(t => ({ t, dir: 'out' as const })),
      ...inc.filter(keep).map(t => ({ t, dir: 'in' as const })),
    ]

    const blockOf = (t: AlchemyTransfer) => (t.blockNum ? BigInt(t.blockNum) : 0n)
    tagged.sort((a, b) => (blockOf(b.t) > blockOf(a.t) ? 1 : blockOf(b.t) < blockOf(a.t) ? -1 : 0))

    // One row per transfer: a swap moves one asset out and another in under the
    // same hash, and both belong in the history. A transfer to oneself shows once.
    const seen = new Set<string>()
    const rows: Array<{ t: AlchemyTransfer; record: TxRecord }> = []
    for (const { t, dir } of tagged) {
      const counterparty = dir === 'out' ? (t.to ?? null) : t.from
      const self = counterparty?.toLowerCase() === address.toLowerCase()
      const amount = t.value != null && t.value > 0 ? t.value.toFixed(6) : null
      const symbol = t.asset ?? (isTokenTransfer(t) ? 'token' : nativeSymbol)
      const key = `${t.hash}|${self ? 'self' : dir}|${symbol}|${amount}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ t, record: {
        hash: t.hash,
        direction: self ? 'self' : dir,
        amount,
        symbol,
        timestamp: t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp).getTime() : 0,
        counterparty,
        explorerUrl: `${explorerBase}/${t.hash}`
      } })
      if (rows.length === HISTORY_LIMIT) break
    }

    const undated = [...new Set(rows.filter(r => !r.record.timestamp && r.t.blockNum).map(r => r.t.blockNum!))]
    const times = await blockTimes(rpcUrl, undated)
    const records = rows.map(({ t, record }) =>
      record.timestamp || !t.blockNum ? record : { ...record, timestamp: times.get(t.blockNum) ?? 0 })

    const gaps = [
      internal ? null : NO_INTERNAL_COVERAGE,
      hiddenSpam > 0 ? `${hiddenSpam} suspected scam-token transfer${hiddenSpam === 1 ? '' : 's'} hidden.` : null,
    ].filter(Boolean)
    return { records, error: null, coverage: gaps.length ? gaps.join(' ') : null }
  } catch (err) {
    return { records: [], error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Blockscout v2 EVM (gnosis, monad, abstract, soneium, worldchain, zora) ───

type BlockscoutTx = {
  hash: string
  from: { hash: string }
  to: { hash: string } | null
  value: string
  timestamp: string
}

async function fetchBlockscoutHistory(
  address: string,
  blockscoutBase: string,
  symbol: string,
  unsupportedOn404 = false,
): Promise<ChainHistory> {
  try {
    const res = await fetch(
      `${blockscoutBase}/api/v2/addresses/${address}/transactions?limit=10`,
      { signal: AbortSignal.timeout(10_000) }
    )
    // Blockscout answers an address it has never seen with a JSON 404: no
    // activity. An HTML 404 means the host has no Blockscout API at all
    // (purrsec.com, HyperEVM's configured explorer, does this for every address).
    if (res.status === 404) {
      if ((res.headers.get('content-type') ?? '').includes('json')) return { records: [], error: null }
      return unsupportedOn404
        ? unsupported('This explorer does not provide a compatible transaction-history API.')
        : { records: [], error: 'Explorer has no transaction-history API (404)' }
    }
    if (!res.ok) return { records: [], error: `Explorer ${res.status}` }

    // An explorer that answers with its web page instead of Blockscout's JSON
    // (a user-added network's explorer often does) has no usable history API.
    const json = await res.json().catch(() => null) as { items?: BlockscoutTx[] } | null
    if (!json || !Array.isArray(json.items)) return unsupportedOn404
      ? unsupported('This explorer does not provide a compatible transaction-history API.')
      : { records: [], error: 'Explorer returned an unexpected response' }
    const addr = address.toLowerCase()

    const records: TxRecord[] = (json.items ?? []).slice(0, 10).map(tx => {
      const from = tx.from?.hash?.toLowerCase() ?? ''
      const to   = tx.to?.hash?.toLowerCase()  ?? null
      let direction: 'in' | 'out' | 'self' = 'self'
      if (from === addr && to !== addr) direction = 'out'
      else if (to === addr && from !== addr) direction = 'in'

      const wei = BigInt(tx.value ?? '0')
      return {
        hash: tx.hash,
        direction,
        amount: wei > 0n ? (Number(wei) / 1e18).toFixed(6) : null,
        symbol,
        timestamp: tx.timestamp ? new Date(tx.timestamp).getTime() : 0,
        counterparty: direction === 'out' ? (tx.to?.hash ?? null) : tx.from?.hash ?? null,
        explorerUrl: `${blockscoutBase}/tx/${tx.hash}`
      }
    })

    return { records, error: null }
  } catch (err) {
    return { records: [], error: String(err) }
  }
}

// ─── Etherscan-compatible API (apechain/apescan) ─────────────────────────────

type EtherscanTx = {
  hash: string
  from: string
  to: string
  value: string
  timeStamp: string
  isError: string
}

async function fetchEtherscanHistory(
  address: string,
  apiUrl: string,
  symbol: string,
  explorerBase: string
): Promise<ChainHistory> {
  try {
    const res = await fetch(
      `${apiUrl}/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=10`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!res.ok) return { records: [], error: `Explorer ${res.status}` }

    const json = await res.json() as { status: string; message: string; result: EtherscanTx[] | string }

    // status "0" with empty result means no txs (not an error)
    if (json.status === '0') {
      if (!Array.isArray(json.result) || json.result.length === 0) return { records: [], error: null }
      return { records: [], error: json.message ?? null }
    }
    if (!Array.isArray(json.result)) return { records: [], error: null }

    const addr = address.toLowerCase()
    const records: TxRecord[] = json.result
      .filter(tx => tx.isError === '0')
      .slice(0, 10)
      .map(tx => {
        const from = tx.from.toLowerCase()
        const to   = tx.to.toLowerCase()
        let direction: 'in' | 'out' | 'self' = 'self'
        if (from === addr && to !== addr) direction = 'out'
        else if (to === addr && from !== addr) direction = 'in'

        const wei = BigInt(tx.value ?? '0')
        return {
          hash: tx.hash,
          direction,
          amount: wei > 0n ? (Number(wei) / 1e18).toFixed(6) : null,
          symbol,
          timestamp: parseInt(tx.timeStamp) * 1000,
          counterparty: direction === 'out' ? tx.to : tx.from,
          explorerUrl: `${explorerBase}/${tx.hash}`
        }
      })

    return { records, error: null }
  } catch (err) {
    return { records: [], error: String(err) }
  }
}

// ─── Generic Tatum Data API history ──────────────────────────────────────────

type TatumTx = {
  hash: string
  address: string
  counterAddress: string | null
  amount: string
  transactionType: string
  transactionSubtype: 'incoming' | 'outgoing' | 'self'
  timestamp: number
}

async function fetchTatumHistory(
  address: string,
  tatumKey: string,
  chain: string,
  symbol: string,
  explorerBase: string,
  fallback?: () => Promise<ChainHistory>
): Promise<ChainHistory> {
  if (!tatumKey) {
    return fallback ? fallback() : { records: [], error: 'No Tatum key' }
  }

  try {
    const res = await fetch(
      `https://api.tatum.io/v4/data/transaction/history?chain=${chain}&addresses=${address}&pageSize=10`,
      { headers: { 'x-api-key': tatumKey }, signal: AbortSignal.timeout(10_000) }
    )

    if (!res.ok) {
      return fallback ? fallback() : { records: [], error: `Tatum ${res.status}` }
    }

    const json = await res.json() as { data?: TatumTx[] }
    const records: TxRecord[] = (json.data ?? []).slice(0, 10).map(tx => {
      const direction: 'in' | 'out' | 'self' =
        tx.transactionSubtype === 'incoming' ? 'in' :
        tx.transactionSubtype === 'outgoing' ? 'out' : 'self'

      const abs = Math.abs(parseFloat(tx.amount ?? '0'))
      const ts  = tx.timestamp > 1e12 ? tx.timestamp : tx.timestamp * 1000

      return {
        hash: tx.hash,
        direction,
        amount: abs > 0 ? abs.toFixed(8) : null,
        symbol,
        timestamp: ts,
        counterparty: tx.counterAddress ?? null,
        explorerUrl: `${explorerBase}/${tx.hash}`
      }
    })

    return { records, error: null }
  } catch {
    return fallback ? fallback() : { records: [], error: 'Network error' }
  }
}

// ─── Solana via Helius ────────────────────────────────────────────────────────

async function fetchSolanaHistory(address: string, config: WalletConfig): Promise<ChainHistory> {
  try {
    const res = await heliusApiFetch(`v0/addresses/${address}/transactions?limit=10`, config)
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(`Helius ${res.status}: ${body.error ?? res.statusText}`)
    }

    const txns = await res.json() as Array<{
      signature: string
      timestamp: number
      nativeTransfers?: Array<{ fromUserAccount: string; toUserAccount: string; amount: number }>
    }>

    const records: TxRecord[] = txns.map(tx => {
      const nt = tx.nativeTransfers?.[0]
      let direction: 'in' | 'out' | 'self' = 'self'
      let amount: string | null = null
      let counterparty: string | null = null

      if (nt) {
        if (nt.fromUserAccount === address) {
          direction = 'out'; amount = (nt.amount / 1e9).toFixed(6); counterparty = nt.toUserAccount
        } else if (nt.toUserAccount === address) {
          direction = 'in'; amount = (nt.amount / 1e9).toFixed(6); counterparty = nt.fromUserAccount
        }
      }

      return { hash: tx.signature, direction, amount, symbol: 'SOL', timestamp: tx.timestamp * 1000, counterparty, explorerUrl: `https://solscan.io/tx/${tx.signature}` }
    })

    return { records, error: null }
  } catch (err) {
    return { records: [], error: String(err) }
  }
}

// ─── Cardano via Blockfrost ───────────────────────────────────────────────────

async function fetchCardanoHistory(address: string, config: WalletConfig): Promise<ChainHistory> {
  try {
    const listRes = await blockfrostFetch(`addresses/${address}/transactions?order=desc&count=10`, config)
    if (listRes.status === 404) return { records: [], error: null }
    if (!listRes.ok) {
      const body = await listRes.json().catch(() => ({})) as { message?: string }
      throw new Error(`Blockfrost ${listRes.status}: ${body.message ?? listRes.statusText}`)
    }

    const txList = await listRes.json() as Array<{ tx_hash: string; block_time: number }>

    const records = await Promise.all(
      txList.slice(0, 10).map(async ({ tx_hash, block_time }): Promise<TxRecord> => {
        const fallback: TxRecord = { hash: tx_hash, direction: 'self', amount: null, symbol: 'ADA', timestamp: block_time * 1000, counterparty: null, explorerUrl: `https://cardanoscan.io/transaction/${tx_hash}` }
        try {
          const utxoRes = await blockfrostFetch(`txs/${tx_hash}/utxos`, config)
          if (!utxoRes.ok) return fallback

          const utxos = await utxoRes.json() as {
            inputs:  Array<{ address: string; amount: Array<{ unit: string; quantity: string }> }>
            outputs: Array<{ address: string; amount: Array<{ unit: string; quantity: string }> }>
          }

          const isSpender = utxos.inputs.some(i => i.address === address)
          const direction  = isSpender ? 'out' : 'in'
          const relevant   = isSpender ? utxos.inputs : utxos.outputs
          const lovelace   = relevant.filter(u => u.address === address).reduce((sum, u) => {
            const ada = u.amount.find(a => a.unit === 'lovelace')
            return sum + BigInt(ada?.quantity ?? '0')
          }, 0n)
          const other = isSpender
            ? utxos.outputs.find(o => o.address !== address)?.address ?? null
            : utxos.inputs.find(i => i.address !== address)?.address ?? null

          return { hash: tx_hash, direction, amount: lovelace > 0n ? (Number(lovelace) / 1e6).toFixed(6) : null, symbol: 'ADA', timestamp: block_time * 1000, counterparty: other, explorerUrl: `https://cardanoscan.io/transaction/${tx_hash}` }
        } catch {
          return fallback
        }
      })
    )

    return { records, error: null }
  } catch (err) {
    return { records: [], error: String(err) }
  }
}

// ─── Bitcoin via mempool.space ────────────────────────────────────────────────

async function fetchBitcoinHistory(address: string): Promise<ChainHistory> {
  if (!address) return { records: [], error: null }
  try {
    const res = await fetch(`https://mempool.space/api/address/${address}/txs`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return { records: [], error: `Mempool ${res.status}` }

    const txs = await res.json() as Array<{
      txid: string
      vin: Array<{ prevout: { scriptpubkey_address?: string; value: number } | null }>
      vout: Array<{ scriptpubkey_address?: string; value: number }>
      status: { block_time?: number }
    }>

    const records: TxRecord[] = txs.slice(0, 10).map(tx => {
      const senderAddrs = tx.vin.map(v => v.prevout?.scriptpubkey_address)
      const isSpender = senderAddrs.includes(address)

      let direction: 'in' | 'out' | 'self' = 'self'
      let satoshis = 0
      let counterparty: string | null = null

      if (isSpender) {
        direction = 'out'
        const toOthers = tx.vout.filter(v => v.scriptpubkey_address !== address)
        satoshis    = toOthers.reduce((s, v) => s + v.value, 0)
        counterparty = toOthers[0]?.scriptpubkey_address ?? null
      } else {
        direction = 'in'
        const toMe = tx.vout.filter(v => v.scriptpubkey_address === address)
        satoshis    = toMe.reduce((s, v) => s + v.value, 0)
        counterparty = senderAddrs.find(a => a !== address) ?? null
      }

      return {
        hash: tx.txid,
        direction,
        amount: satoshis > 0 ? (satoshis / 1e8).toFixed(8) : null,
        symbol: 'BTC',
        timestamp: (tx.status.block_time ?? Math.floor(Date.now() / 1000)) * 1000,
        counterparty: counterparty ?? null,
        explorerUrl: `https://mempool.space/tx/${tx.txid}`
      }
    })

    return { records, error: null }
  } catch (err) {
    return { records: [], error: String(err) }
  }
}

// ─── Dogecoin via BlockCypher Address Full ────────────────────────────────────

type DogecoinFullTx = {
  hash: string
  inputs?: Array<{ addresses?: string[] }>
  outputs?: Array<{ addresses?: string[]; value?: number }>
  received?: string
  confirmed?: string | null
  block_height?: number
}

async function fetchDogecoinHistory(address: string): Promise<ChainHistory> {
  if (!address) return { records: [], error: null }
  try {
    const res = await fetch(`${DOGE_API_BASE}/addrs/${encodeURIComponent(address)}/full?limit=10`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return { records: [], error: `BlockCypher ${res.status}` }
    const json = await res.json() as { txs?: DogecoinFullTx[]; error?: string }
    if (json.error) return { records: [], error: json.error }

    const records: TxRecord[] = (json.txs ?? []).slice(0, 10).map(tx => {
      const inputs = (tx.inputs ?? []).flatMap(input => input.addresses ?? [])
      const outputs = tx.outputs ?? []
      const isSpender = inputs.includes(address)
      const relevant = isSpender
        ? outputs.filter(output => !(output.addresses ?? []).includes(address))
        : outputs.filter(output => (output.addresses ?? []).includes(address))
      const koinu = relevant.reduce((sum, output) => sum + BigInt(Math.max(0, Math.trunc(output.value ?? 0))), 0n)
      const direction: TxRecord['direction'] = isSpender
        ? (outputs.some(output => (output.addresses ?? []).includes(address)) ? 'self' : 'out')
        : 'in'
      const counterpartyOutput = isSpender
        ? outputs.find(output => !(output.addresses ?? []).includes(address))
        : undefined
      const counterparty = counterpartyOutput?.addresses?.[0]
        ?? inputs.find(input => input !== address)
        ?? null
      const blockTime = tx.confirmed ?? tx.received ?? null
      return {
        hash: tx.hash,
        direction,
        amount: koinu > 0n ? (Number(koinu) / 1e8).toFixed(8) : null,
        symbol: 'DOGE',
        timestamp: blockTime ? new Date(blockTime).getTime() : 0,
        counterparty,
        explorerUrl: `https://dogechain.info/tx/${tx.hash}`,
      }
    })
    return { records, error: null }
  } catch (err) {
    return { records: [], error: String(err) }
  }
}

// ─── TronGrid: TRX and TRC-20 account history ─────────────────────────────────

type TronNativeTx = {
  txID?: string
  block_timestamp?: number
  raw_data?: { contract?: Array<{ type?: string; parameter?: { value?: Record<string, unknown> } }> }
  ret?: Array<{ contractRet?: string }>
}

type TronTokenTx = {
  transaction_id?: string
  block_timestamp?: number
  from?: string
  to?: string
  value?: string
  token_info?: { address?: string; symbol?: string; decimals?: number }
}

function tronAddressEquals(a: string | undefined, b: string, addressHex: string): boolean {
  if (!a) return false
  const normalized = a.toLowerCase().replace(/^0x/, '')
  return normalized === b.toLowerCase() || normalized === addressHex || normalized === `41${addressHex}`
}

function formatTokenAmount(raw: string, decimals: number): string | null {
  if (!/^[0-9]+$/.test(raw) || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null
  const padded = raw.padStart(decimals + 1, '0')
  if (decimals === 0) return padded
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '').slice(0, 8)
  return fraction ? `${whole}.${fraction}` : whole
}

async function fetchTronHistory(address: string): Promise<ChainHistory> {
  if (!address) return { records: [], error: null }
  try {
    const hexAddress = tronAddrToHex(address).toLowerCase()
    const base = `https://api.trongrid.io/v1/accounts/${encodeURIComponent(address)}/transactions`
    const [nativeRes, tokenRes] = await Promise.all([
      fetch(`${base}?only_confirmed=true&limit=20&order_by=block_timestamp%2Cdesc`, {
        headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000),
      }),
      fetch(`${base}/trc20?only_confirmed=true&limit=20&order_by=block_timestamp%2Cdesc`, {
        headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000),
      }),
    ])
    if (!nativeRes.ok && !tokenRes.ok) {
      return { records: [], error: `TronGrid ${nativeRes.status}/${tokenRes.status}` }
    }

    const [nativeJson, tokenJson] = await Promise.all([
      nativeRes.ok ? nativeRes.json() as Promise<{ data?: TronNativeTx[] }> : Promise.resolve({ data: [] }),
      tokenRes.ok ? tokenRes.json() as Promise<{ data?: TronTokenTx[] }> : Promise.resolve({ data: [] }),
    ])
    const records: TxRecord[] = []
    for (const tx of nativeJson.data ?? []) {
      const contract = tx.raw_data?.contract?.find(c => c.type === 'TransferContract')
      const value = contract?.parameter?.value
      if (!tx.txID || !value) continue
      const from = typeof value.owner_address === 'string' ? value.owner_address : undefined
      const to = typeof value.to_address === 'string' ? value.to_address : undefined
      const fromMe = tronAddressEquals(from, address, hexAddress)
      const toMe = tronAddressEquals(to, address, hexAddress)
      if (!fromMe && !toMe) continue
      const amountSun = BigInt(String(value.amount ?? '0'))
      records.push({
        hash: tx.txID,
        direction: fromMe && toMe ? 'self' : fromMe ? 'out' : 'in',
        amount: amountSun > 0n ? formatTokenAmount(amountSun.toString(), 6) : null,
        symbol: 'TRX',
        timestamp: tx.block_timestamp ?? 0,
        counterparty: fromMe ? to ?? null : from ?? null,
        explorerUrl: `https://tronscan.org/#/transaction/${tx.txID}`,
      })
    }
    for (const tx of tokenJson.data ?? []) {
      if (!tx.transaction_id || !tx.from || !tx.to) continue
      const fromMe = tronAddressEquals(tx.from, address, hexAddress)
      const toMe = tronAddressEquals(tx.to, address, hexAddress)
      if (!fromMe && !toMe) continue
      const decimals = tx.token_info?.decimals ?? 0
      records.push({
        hash: tx.transaction_id,
        direction: fromMe && toMe ? 'self' : fromMe ? 'out' : 'in',
        amount: formatTokenAmount(tx.value ?? '0', decimals),
        symbol: tx.token_info?.symbol || 'TRC-20',
        timestamp: tx.block_timestamp ?? 0,
        counterparty: fromMe ? tx.to : tx.from,
        explorerUrl: `https://tronscan.org/#/transaction/${tx.transaction_id}`,
      })
    }
    records.sort((a, b) => b.timestamp - a.timestamp)
    return { records: records.slice(0, 20), error: null }
  } catch (err) {
    return { records: [], error: String(err) }
  }
}

// ─── Polkadot via Statescan (Asset Hub + relay chain) ─────────────────────────
//
// Subscan now refuses keyless requests ("Subscan API strictly requires an API
// key", measured 2026-09-23). Statescan's public APIs answer without a key and
// with CORS. DOT balances and transfers moved from the relay chain to Asset Hub
// in the November 2025 migration, so both are read: Asset Hub for current
// activity, the relay chain for everything before it.

type StatescanTransfer = {
  indexer: { blockHeight: number; blockTime: number; eventIndex: number; extrinsicIndex?: number }
  from: string
  to: string
  balance: string
  isNativeAsset?: boolean
}

export const POLKADOT_HISTORY_SOURCES = [
  { api: 'https://ahp-api.statescan.io', explorer: 'https://assethub-polkadot.statescan.io' },
  { api: 'https://polkadot-api.statescan.io', explorer: 'https://polkadot.statescan.io' },
] as const

export const POLKADOT_COVERAGE = 'DOT transfers only; other Asset Hub assets are not listed here.'

async function fetchPolkadotHistory(address: string): Promise<ChainHistory> {
  if (!address) return { records: [], error: null }
  const read = async (src: typeof POLKADOT_HISTORY_SOURCES[number]): Promise<TxRecord[]> => {
    const res = await fetch(`${src.api}/accounts/${address}/transfers?page=0&page_size=${HISTORY_LIMIT}`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) throw new Error(`Statescan ${res.status}`)
    const json = await res.json().catch(() => null) as { items?: StatescanTransfer[] } | null
    if (!json || !Array.isArray(json.items)) throw new Error('Statescan returned an unexpected response')
    return json.items.filter(t => t.isNativeAsset !== false).map(t => {
      const { blockHeight, blockTime, eventIndex, extrinsicIndex } = t.indexer
      const direction: 'in' | 'out' | 'self' =
        t.from === address && t.to === address ? 'self' : t.from === address ? 'out' : 'in'
      const planck = BigInt(t.balance || '0')
      // Statescan has no extrinsic hash; its own links are block-index based.
      const id = extrinsicIndex != null ? `${blockHeight}-${extrinsicIndex}` : `${blockHeight}-e${eventIndex}`
      return {
        hash: id,
        direction,
        amount: planck > 0n ? (Number(planck) / 1e10).toFixed(4) : null,
        symbol: 'DOT',
        timestamp: blockTime,
        counterparty: direction === 'out' ? t.to : t.from,
        explorerUrl: extrinsicIndex != null
          ? `${src.explorer}/#/extrinsics/${blockHeight}-${extrinsicIndex}`
          : `${src.explorer}/#/blocks/${blockHeight}`,
      }
    })
  }
  const results = await Promise.allSettled(POLKADOT_HISTORY_SOURCES.map(read))
  const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
  // One source down would leave a list that looks complete but is not.
  if (failed.length > 0) {
    return { records: [], error: failed.map(f => (f.reason instanceof Error ? f.reason.message : String(f.reason))).join('; ') }
  }
  const records = results.flatMap(r => (r as PromiseFulfilledResult<TxRecord[]>).value)
  records.sort((a, b) => b.timestamp - a.timestamp)
  return { records: records.slice(0, HISTORY_LIMIT), error: null, coverage: POLKADOT_COVERAGE }
}

// ─── Monad via Moralis (mirrors ChainLens) ────────────────────────────────────

type MoralisTx = {
  hash?: string
  transaction_hash?: string
  from_address?: string
  to_address?: string | null
  value?: string
  block_timestamp?: string
}

async function fetchMoralisMonadHistory(
  address: string,
  config: WalletConfig,
  explorerBase: string,
  fallback?: () => Promise<ChainHistory>
): Promise<ChainHistory> {
  if (!canMoralis(config)) return fallback ? fallback() : { records: [], error: 'No Moralis key' }

  try {
    // Moralis's wallet-history endpoint is /wallets/{address}/history. The bare
    // /{address}/history this used to call does not exist (Moralis answers
    // "Cannot GET"), so Monad history always fell through to the fallback.
    const res = await moralisFetch(`wallets/${address}/history?chain=0x8f&order=DESC&limit=10`, config, 10_000)
    if (!res.ok) {
      return fallback ? fallback() : { records: [], error: `Moralis ${res.status}` }
    }

    const json = await res.json() as { result?: MoralisTx[] }
    const addr = address.toLowerCase()

    const records: TxRecord[] = (json.result ?? [])
      .filter(tx => tx.block_timestamp)
      .slice(0, 10)
      .map(tx => {
        const hash = tx.hash ?? tx.transaction_hash ?? ''
        const from = tx.from_address?.toLowerCase() ?? ''
        const to   = tx.to_address?.toLowerCase() ?? null
        let direction: 'in' | 'out' | 'self' = 'self'
        if (from === addr && to !== addr) direction = 'out'
        else if (to === addr && from !== addr) direction = 'in'

        const value = parseFloat(tx.value ?? '0') / 1e18
        return {
          hash,
          direction,
          amount: value > 0 ? value.toFixed(6) : null,
          symbol: 'MON',
          timestamp: tx.block_timestamp ? new Date(tx.block_timestamp).getTime() : 0,
          counterparty: direction === 'out' ? (tx.to_address ?? null) : (tx.from_address ?? null),
          explorerUrl: `${explorerBase}/${hash}`
        }
      })

    // Moralis returned nothing usable — fall back to the block explorer
    if (records.length === 0 && fallback) return fallback()
    return { records, error: null }
  } catch {
    return fallback ? fallback() : { records: [], error: 'Network error' }
  }
}

// ─── Alchemy-indexed networks outside the balance registry ────────────────────
//
// Alchemy indexes transfers on these networks (verified 2026-09-23 with the
// Worker's key) although their balances and tokens use other providers, so
// the network is named here rather than as the chain's `alchemyNetwork`.

export const HISTORY_ALCHEMY_NETWORKS: Readonly<Record<string, string>> = {
  monad: 'monad-mainnet',
  hyperevm: 'hyperliquid-mainnet',
}

/** Alchemy first; the older provider only when Alchemy is refused. */
async function fetchAlchemyThen(
  address: string, config: WalletConfig, network: string, explorerBase: string, nativeSymbol: string,
  fallback: () => Promise<ChainHistory>,
): Promise<ChainHistory> {
  const alchemy = await fetchAlchemyHistory(address, alchemyRpcUrl(network, config), explorerBase, network, nativeSymbol)
  if (!alchemy.error) return alchemy
  // A Worker without this network on its allowlist refuses it.
  const older = await fallback()
  if (!older.error) return older
  return { records: [], error: `${alchemy.error}; ${older.error}`, unsupported: older.unsupported }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/** History key for the Abstract Global Wallet: matches its balance entry. */
export const AGW_HISTORY_KEY = 'abstract-agw'

export async function fetchAllHistory(
  addresses: {
    evm: string
    solana: string
    cardano: string | null
    bitcoin?: string
    polkadot?: string
    tron?: string
    dogecoin?: string
    agw?: string
  },
  config: WalletConfig
): Promise<AllHistory> {
  // Use the active registry so custom EVM chains with a Blockscout-compatible
  // explorer are included without maintaining another list of networks.
  const tasks: Array<[string, Promise<ChainHistory>]> = []
  for (const chain of activeEvmChains(config)) {
    const historyNetwork = HISTORY_ALCHEMY_NETWORKS[chain.id]
    if (historyNetwork && !chain.alchemyNetwork) {
      // Moralis is Monad's older path (its free plan is currently paused).
      const fallback = chain.id === 'monad'
        ? () => fetchMoralisMonadHistory(addresses.evm, config, chain.explorerTx)
        : chain.blockscoutUrl
          ? () => fetchBlockscoutHistory(addresses.evm, chain.blockscoutUrl!, chain.nativeSymbol)
          : () => Promise.resolve(unsupported('No indexed transaction-history provider is configured for this network.'))
      tasks.push([chain.id, fetchAlchemyThen(addresses.evm, config, historyNetwork, chain.explorerTx, chain.nativeSymbol, fallback)])
    } else if (chain.alchemyNetwork) {
      tasks.push([chain.id, fetchAlchemyHistory(
        addresses.evm, alchemyRpcUrl(chain.alchemyNetwork, config), chain.explorerTx, chain.alchemyNetwork, chain.nativeSymbol
      )])
    } else if (chain.blockscoutUrl) {
      tasks.push([chain.id, fetchBlockscoutHistory(
        addresses.evm, chain.blockscoutUrl, chain.nativeSymbol, chain.id.startsWith('custom-')
      )])
    } else if (chain.etherscanApiUrl) {
      tasks.push([chain.id, fetchEtherscanHistory(addresses.evm, chain.etherscanApiUrl, chain.nativeSymbol, chain.explorerTx)])
    } else {
      tasks.push([chain.id, Promise.resolve(unsupported('No indexed transaction-history provider is configured for this network.'))])
    }
  }
  tasks.push(
    ['solana', fetchSolanaHistory(addresses.solana, config)],
    ['cardano', addresses.cardano
      ? fetchCardanoHistory(addresses.cardano, config)
      : Promise.resolve<ChainHistory>({ records: [], error: null })],
    ['bitcoin', fetchBitcoinHistory(addresses.bitcoin ?? '')],
    ['polkadot', fetchPolkadotHistory(addresses.polkadot ?? '')],
    ['tron', fetchTronHistory(addresses.tron ?? '')],
    ['dogecoin', fetchDogecoinHistory(addresses.dogecoin ?? '')],
  )
  // The Abstract Global Wallet is its own smart-contract account: its history is
  // read under ITS address and kept apart from the regular Abstract account's.
  const agw = addresses.agw
  if (agw && agw.toLowerCase() !== addresses.evm.toLowerCase() && !isTestnetConfig(config)) {
    const abstract = activeEvmChains(config).find(c => c.id === 'abstract')
    if (abstract?.alchemyNetwork) {
      tasks.push([AGW_HISTORY_KEY, fetchAlchemyHistory(
        agw, alchemyRpcUrl(abstract.alchemyNetwork, config), abstract.explorerTx, abstract.alchemyNetwork, abstract.nativeSymbol
      )])
    }
  }
  const entries = await Promise.all(tasks.map(async ([chain, promise]) => [chain, await promise] as const))
  const history: AllHistory = {}
  for (const [chain, result] of entries) history[chain] = result

  return history
}
