/**
 * tx-history.ts — MagicMoney Wallet
 *
 * Fetches recent transaction history for all supported chains.
 * - Alchemy:    all EVM chains with alchemyNetwork set (15 chains)
 * - Moralis:    monad (v2.2 wallet history, chain 0x8f) → Blockscout fallback
 * - Helius:     solana
 * - Blockfrost: cardano
 */

import type { WalletConfig } from './secure-store'
import { EVM_CHAINS } from './chain-config'
import { alchemyRpcUrl, heliusApiFetch, blockfrostFetch, moralisFetch, canMoralis } from './api-proxy'

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
}

export type AllHistory = Record<string, ChainHistory>

// ─── Alchemy EVM (ethereum, arbitrum, optimism, base, polygon, avalanche, blast)

type AlchemyTransfer = {
  hash: string
  from: string
  to: string | null
  value: number | null
  asset: string | null
  metadata: { blockTimestamp: string } | null
}

async function fetchAlchemyHistory(
  address: string,
  rpcUrl: string,
  explorerBase: string
): Promise<ChainHistory> {
  const query = (params: object) =>
    fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getAssetTransfers', params: [params] }),
      signal: AbortSignal.timeout(10_000)
    }).then(r => r.json() as Promise<{ result?: { transfers: AlchemyTransfer[] } }>)

  try {
    const [outJson, inJson] = await Promise.all([
      query({ fromBlock: '0x0', toBlock: 'latest', fromAddress: address, category: ['external'], maxCount: '0xa', withMetadata: true, excludeZeroValue: true }),
      query({ fromBlock: '0x0', toBlock: 'latest', toAddress: address,   category: ['external'], maxCount: '0xa', withMetadata: true, excludeZeroValue: true })
    ])

    const toRecord = (t: AlchemyTransfer, dir: 'in' | 'out'): TxRecord => ({
      hash: t.hash,
      direction: dir,
      amount: t.value != null ? t.value.toFixed(6) : null,
      symbol: t.asset ?? 'ETH',
      timestamp: t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp).getTime() : 0,
      counterparty: dir === 'out' ? (t.to ?? null) : t.from,
      explorerUrl: `${explorerBase}/${t.hash}`
    })

    const all = [
      ...(outJson.result?.transfers ?? []).map(t => toRecord(t, 'out')),
      ...(inJson.result?.transfers  ?? []).map(t => toRecord(t, 'in'))
    ]

    const seen = new Set<string>()
    const deduped = all.filter(t => !seen.has(t.hash) && seen.add(t.hash) as unknown as boolean)
    deduped.sort((a, b) => b.timestamp - a.timestamp)
    return { records: deduped.slice(0, 10), error: null }
  } catch (err) {
    return { records: [], error: String(err) }
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
  symbol: string
): Promise<ChainHistory> {
  try {
    const res = await fetch(
      `${blockscoutBase}/api/v2/addresses/${address}/transactions?limit=10`,
      { signal: AbortSignal.timeout(10_000) }
    )
    if (res.status === 404) return { records: [], error: null }
    if (!res.ok) return { records: [], error: `Explorer ${res.status}` }

    const json = await res.json() as { items?: BlockscoutTx[] }
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

// ─── Polkadot via Subscan ─────────────────────────────────────────────────────

async function fetchPolkadotHistory(address: string): Promise<ChainHistory> {
  if (!address) return { records: [], error: null }
  try {
    const res = await fetch('https://polkadot.api.subscan.io/api/scan/transfers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ address, row: 10, page: 0 }),
      signal:  AbortSignal.timeout(10_000)
    })
    if (!res.ok) return { records: [], error: `Subscan ${res.status}` }

    const json = await res.json() as {
      code: number
      data?: {
        transfers?: Array<{
          extrinsic_hash: string
          from: string
          to: string
          amount: string
          block_timestamp: number
        }>
      }
    }

    if (json.code !== 0 || !json.data?.transfers) return { records: [], error: null }

    const records: TxRecord[] = json.data.transfers.map(tx => {
      const direction: 'in' | 'out' | 'self' =
        tx.from === address && tx.to === address ? 'self' :
        tx.from === address ? 'out' : 'in'
      return {
        hash: tx.extrinsic_hash,
        direction,
        amount: parseFloat(tx.amount) > 0 ? parseFloat(tx.amount).toFixed(4) : null,
        symbol: 'DOT',
        timestamp: tx.block_timestamp * 1000,
        counterparty: direction === 'out' ? tx.to : tx.from,
        explorerUrl: `https://polkadot.subscan.io/extrinsic/${tx.extrinsic_hash}`
      }
    })

    return { records, error: null }
  } catch (err) {
    return { records: [], error: String(err) }
  }
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
    const res = await moralisFetch(`${address}/history?chain=0x8f&order=DESC&limit=10`, config, 10_000)
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

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function fetchAllHistory(
  addresses: { evm: string; solana: string; cardano: string | null; bitcoin?: string; polkadot?: string },
  config: WalletConfig
): Promise<AllHistory> {
  // Monad handled via Moralis (with Blockscout fallback); all others via Alchemy or Blockscout
  const alchemyChains    = EVM_CHAINS.filter(c => c.alchemyNetwork)
  const blockscoutChains = EVM_CHAINS.filter(c => c.blockscoutUrl && !c.alchemyNetwork && c.id !== 'monad')
  const etherscanChains  = EVM_CHAINS.filter(c => c.etherscanApiUrl && !c.alchemyNetwork && !c.blockscoutUrl)

  const results = await Promise.all([
    ...alchemyChains.map(c => fetchAlchemyHistory(
      addresses.evm,
      alchemyRpcUrl(c.alchemyNetwork!, config),
      c.explorerTx
    )),
    ...blockscoutChains.map(c => fetchBlockscoutHistory(addresses.evm, c.blockscoutUrl!, c.nativeSymbol)),
    ...etherscanChains.map(c  => fetchEtherscanHistory(addresses.evm, c.etherscanApiUrl!, c.nativeSymbol, c.explorerTx)),
    // Monad: Moralis (proven via NFTs) → Blockscout fallback
    fetchMoralisMonadHistory(
      addresses.evm, config, 'https://monadexplorer.com/tx',
      () => fetchBlockscoutHistory(addresses.evm, 'https://monadexplorer.com', 'MON')
    ),
    fetchSolanaHistory(addresses.solana, config),
    addresses.cardano
      ? fetchCardanoHistory(addresses.cardano, config)
      : Promise.resolve<ChainHistory>({ records: [], error: null }),
    fetchBitcoinHistory(addresses.bitcoin ?? ''),
    fetchPolkadotHistory(addresses.polkadot ?? '')
  ])

  const history: AllHistory = {}
  let i = 0
  alchemyChains.forEach(c    => { history[c.id] = results[i++] })
  blockscoutChains.forEach(c => { history[c.id] = results[i++] })
  etherscanChains.forEach(c  => { history[c.id] = results[i++] })
  history['monad']    = results[i++]
  history['solana']   = results[i++]
  history['cardano']  = results[i++]
  history['bitcoin']  = results[i++]
  history['polkadot'] = results[i++]

  return history
}
