/**
 * tx-history.ts — MagicMoney Wallet Phase 3
 *
 * Fetches recent transaction history for EVM, Solana, and Cardano.
 * Uses the same API providers as balance-fetcher (Alchemy, Helius, Blockfrost).
 */

import type { WalletConfig } from './secure-store'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface TxRecord {
  hash: string
  direction: 'in' | 'out' | 'self'
  amount: string | null      // human-readable, null if unknown
  symbol: string
  timestamp: number          // unix ms
  counterparty: string | null
  explorerUrl: string
}

export interface ChainHistory {
  records: TxRecord[]
  error: string | null
}

export interface AllHistory {
  evm: ChainHistory
  solana: ChainHistory
  cardano: ChainHistory
}

// ─── EVM via Alchemy ─────────────────────────────────────────────────────────

type AlchemyTransfer = {
  hash: string
  from: string
  to: string | null
  value: number | null
  asset: string | null
  metadata: { blockTimestamp: string } | null
}

async function fetchEvmHistory(address: string, alchemyKey: string): Promise<ChainHistory> {
  const url = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`

  const query = (params: object) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'alchemy_getAssetTransfers',
        params: [params]
      })
    }).then(r => r.json() as Promise<{ result?: { transfers: AlchemyTransfer[] } }>)

  try {
    const [outJson, inJson] = await Promise.all([
      query({
        fromBlock: '0x0', toBlock: 'latest',
        fromAddress: address,
        category: ['external'],
        maxCount: '0xa',
        withMetadata: true,
        excludeZeroValue: true
      }),
      query({
        fromBlock: '0x0', toBlock: 'latest',
        toAddress: address,
        category: ['external'],
        maxCount: '0xa',
        withMetadata: true,
        excludeZeroValue: true
      })
    ])

    const toRecord = (t: AlchemyTransfer, dir: 'in' | 'out'): TxRecord => ({
      hash: t.hash,
      direction: dir,
      amount: t.value != null ? t.value.toFixed(6) : null,
      symbol: t.asset ?? 'ETH',
      timestamp: t.metadata?.blockTimestamp
        ? new Date(t.metadata.blockTimestamp).getTime()
        : 0,
      counterparty: dir === 'out' ? (t.to ?? null) : t.from,
      explorerUrl: `https://etherscan.io/tx/${t.hash}`
    })

    const all = [
      ...(outJson.result?.transfers ?? []).map(t => toRecord(t, 'out')),
      ...(inJson.result?.transfers ?? []).map(t => toRecord(t, 'in'))
    ]

    // Deduplicate (self-sends appear in both queries), sort newest first
    const seen = new Set<string>()
    const deduped = all.filter(t => !seen.has(t.hash) && seen.add(t.hash) as unknown as boolean)
    deduped.sort((a, b) => b.timestamp - a.timestamp)

    return { records: deduped.slice(0, 10), error: null }
  } catch (err) {
    return { records: [], error: String(err) }
  }
}

// ─── Solana via Helius ────────────────────────────────────────────────────────

async function fetchSolanaHistory(address: string, heliusKey: string): Promise<ChainHistory> {
  try {
    const res = await fetch(
      `https://api.helius.xyz/v0/addresses/${address}/transactions?api-key=${heliusKey}&limit=10`
    )
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(`Helius ${res.status}: ${body.error ?? res.statusText}`)
    }

    const txns = await res.json() as Array<{
      signature: string
      timestamp: number
      nativeTransfers?: Array<{
        fromUserAccount: string
        toUserAccount: string
        amount: number
      }>
    }>

    const records: TxRecord[] = txns.map(tx => {
      const nt = tx.nativeTransfers?.[0]
      let direction: 'in' | 'out' | 'self' = 'self'
      let amount: string | null = null
      let counterparty: string | null = null

      if (nt) {
        if (nt.fromUserAccount === address) {
          direction = 'out'
          amount = (nt.amount / 1e9).toFixed(6)
          counterparty = nt.toUserAccount
        } else if (nt.toUserAccount === address) {
          direction = 'in'
          amount = (nt.amount / 1e9).toFixed(6)
          counterparty = nt.fromUserAccount
        }
      }

      return {
        hash: tx.signature,
        direction,
        amount,
        symbol: 'SOL',
        timestamp: tx.timestamp * 1000,
        counterparty,
        explorerUrl: `https://solscan.io/tx/${tx.signature}`
      }
    })

    return { records, error: null }
  } catch (err) {
    return { records: [], error: String(err) }
  }
}

// ─── Cardano via Blockfrost ───────────────────────────────────────────────────

async function fetchCardanoHistory(address: string, blockfrostKey: string): Promise<ChainHistory> {
  const BASE = 'https://cardano-mainnet.blockfrost.io/api/v0'
  const headers = { project_id: blockfrostKey }

  try {
    const listRes = await fetch(
      `${BASE}/addresses/${address}/transactions?order=desc&count=10`,
      { headers }
    )
    if (listRes.status === 404) return { records: [], error: null }
    if (!listRes.ok) {
      const body = await listRes.json().catch(() => ({})) as { message?: string }
      throw new Error(`Blockfrost ${listRes.status}: ${body.message ?? listRes.statusText}`)
    }

    const txList = await listRes.json() as Array<{ tx_hash: string; block_time: number }>

    const records = await Promise.all(
      txList.slice(0, 10).map(async ({ tx_hash, block_time }): Promise<TxRecord> => {
        const fallback: TxRecord = {
          hash: tx_hash,
          direction: 'self',
          amount: null,
          symbol: 'ADA',
          timestamp: block_time * 1000,
          counterparty: null,
          explorerUrl: `https://cardanoscan.io/transaction/${tx_hash}`
        }

        try {
          const utxoRes = await fetch(`${BASE}/txs/${tx_hash}/utxos`, { headers })
          if (!utxoRes.ok) return fallback

          const utxos = await utxoRes.json() as {
            inputs:  Array<{ address: string; amount: Array<{ unit: string; quantity: string }> }>
            outputs: Array<{ address: string; amount: Array<{ unit: string; quantity: string }> }>
          }

          const isSpender = utxos.inputs.some(i => i.address === address)
          const direction = isSpender ? 'out' : 'in'
          const relevant  = isSpender ? utxos.inputs : utxos.outputs

          const lovelace = relevant
            .filter(u => u.address === address)
            .reduce((sum, u) => {
              const ada = u.amount.find(a => a.unit === 'lovelace')
              return sum + BigInt(ada?.quantity ?? '0')
            }, 0n)

          const other = isSpender
            ? utxos.outputs.find(o => o.address !== address)?.address ?? null
            : utxos.inputs.find(i => i.address !== address)?.address ?? null

          return {
            hash: tx_hash,
            direction,
            amount: lovelace > 0n ? (Number(lovelace) / 1e6).toFixed(6) : null,
            symbol: 'ADA',
            timestamp: block_time * 1000,
            counterparty: other,
            explorerUrl: `https://cardanoscan.io/transaction/${tx_hash}`
          }
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

// ─── Orchestrator ────────────────────────────────────────────────────────────

export async function fetchAllHistory(
  addresses: { evm: string; solana: string; cardano: string | null },
  config: WalletConfig
): Promise<AllHistory> {
  const noHistory: ChainHistory = { records: [], error: null }

  const [evm, solana, cardano] = await Promise.all([
    fetchEvmHistory(addresses.evm, config.alchemyKey),
    fetchSolanaHistory(addresses.solana, config.heliusKey),
    addresses.cardano
      ? fetchCardanoHistory(addresses.cardano, config.blockfrostKey)
      : Promise.resolve(noHistory)
  ])

  return { evm, solana, cardano }
}
