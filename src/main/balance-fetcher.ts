/**
 * balance-fetcher.ts — MagicMoney Wallet Phase 4
 *
 * Fetches native balances for all 18 networks in parallel.
 * Prices are resolved via a single batched CoinGecko call fired concurrently.
 * Each chain fails independently — errors surface per-chain, never globally.
 */

import { base58 } from '@scure/base'
import { blake2b } from '@noble/hashes/blake2b'
import type { WalletConfig } from './secure-store'
import { EVM_CHAINS, CHAIN_MAP, type ChainDef } from './chain-config'

export interface ChainBalance {
  native: string            // human-readable, e.g. "1.2345"
  symbol: string            // e.g. "ETH"
  usdValue: string | null   // e.g. "$2,341.22" — null if price unavailable
  tokenCount: number
  error: string | null
  priceChange24h: number | null  // e.g. 2.34 (percent)
  sparkline: number[] | null     // ~168 hourly prices over 7d
}

export interface AllBalances {
  chains: Record<string, ChainBalance>
  fetchedAt: number
  portfolioSparkline: number[] | null  // aggregated 7d portfolio value in USD
}

// ─── Market data batch fetch (price + 24h change + 7d sparkline) ─────────────

interface MarketData {
  price: number
  change24h: number | null
  sparkline: number[] | null
}

async function fetchMarketData(ids: string[]): Promise<Record<string, MarketData>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return {}
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${unique.join(',')}&sparkline=true&price_change_percentage=24h&order=id_asc&per_page=250`,
      { signal: AbortSignal.timeout(12_000) }
    )
    if (!res.ok) return {}
    const json = await res.json() as Array<{
      id: string
      current_price: number
      price_change_percentage_24h: number | null
      sparkline_in_7d?: { price: number[] }
    }>
    const out: Record<string, MarketData> = {}
    for (const coin of json) {
      out[coin.id] = {
        price: coin.current_price ?? 0,
        change24h: coin.price_change_percentage_24h ?? null,
        sparkline: coin.sparkline_in_7d?.price ?? null
      }
    }
    return out
  } catch {
    return {}
  }
}

function usd(amount: number, price: number): string {
  return `$${(amount * price).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
}

// ─── EVM via JSON-RPC ─────────────────────────────────────────────────────────

async function fetchEvmNative(
  chain: ChainDef,
  address: string,
  config: WalletConfig
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  const url = chain.rpcUrl(config)
  const abort = AbortSignal.timeout(10_000)

  try {
    const balRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }),
      signal: abort
    })

    if (!balRes.ok) return { native: 0, tokenCount: 0, error: `RPC ${balRes.status}` }

    const balJson = await balRes.json() as { result?: string; error?: { message: string } }
    if (balJson.error) return { native: 0, tokenCount: 0, error: balJson.error.message }

    const native = Number(BigInt(balJson.result ?? '0x0')) / 1e18

    // Token count: Alchemy method for Alchemy chains, Blockscout v2 for others
    let tokenCount = 0
    if (chain.alchemyNetwork) {
      try {
        const ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000'
        const tokRes = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'alchemy_getTokenBalances', params: [address, 'erc20'] }),
          signal: AbortSignal.timeout(8_000)
        })
        if (tokRes.ok) {
          const tokJson = await tokRes.json() as { result?: { tokenBalances?: Array<{ tokenBalance: string }> } }
          tokenCount = (tokJson.result?.tokenBalances ?? []).filter(t => t.tokenBalance !== ZERO).length
        }
      } catch { /* optional */ }
    } else if (chain.blockscoutUrl) {
      try {
        const tokRes = await fetch(
          `${chain.blockscoutUrl}/api/v2/addresses/${address}/token-balances`,
          { signal: AbortSignal.timeout(8_000) }
        )
        if (tokRes.ok) {
          const tokJson = await tokRes.json() as Array<{ value: string }>
          tokenCount = tokJson.filter(t => t.value !== '0').length
        }
      } catch { /* optional */ }
    } else if (chain.etherscanApiUrl) {
      try {
        const tokRes = await fetch(
          `${chain.etherscanApiUrl}/api?module=account&action=tokenlist&address=${address}`,
          { signal: AbortSignal.timeout(8_000) }
        )
        if (tokRes.ok) {
          const tokJson = await tokRes.json() as { status: string; result: unknown[] | string }
          if (tokJson.status === '1' && Array.isArray(tokJson.result)) {
            tokenCount = tokJson.result.length
          }
        }
      } catch { /* optional */ }
    }

    return { native, tokenCount, error: null }
  } catch (err) {
    const msg = String(err)
    return { native: 0, tokenCount: 0, error: msg.includes('abort') || msg.includes('timeout') ? 'Timed out' : 'Network error' }
  }
}

// ─── Bitcoin via mempool.space ────────────────────────────────────────────────

async function fetchBitcoinNative(
  address: string
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  if (!address) return { native: 0, tokenCount: 0, error: 'No address' }
  try {
    const res = await fetch(`https://mempool.space/api/address/${address}`, {
      signal: AbortSignal.timeout(10_000)
    })
    if (!res.ok) return { native: 0, tokenCount: 0, error: `Mempool ${res.status}` }
    const json = await res.json() as {
      chain_stats:   { funded_txo_sum: number; spent_txo_sum: number }
      mempool_stats: { funded_txo_sum: number; spent_txo_sum: number }
    }
    const confirmed = json.chain_stats.funded_txo_sum   - json.chain_stats.spent_txo_sum
    const pending   = json.mempool_stats.funded_txo_sum - json.mempool_stats.spent_txo_sum
    return { native: (confirmed + pending) / 1e8, tokenCount: 0, error: null }
  } catch (err) {
    const msg = String(err)
    return { native: 0, tokenCount: 0, error: msg.includes('abort') ? 'Timed out' : 'Network error' }
  }
}

// ─── Polkadot via Substrate RPC (Tatum gateway) + SCALE decode ───────────────
// Storage key: TWOX_128("System") + TWOX_128("Account") + BLAKE2_128_CONCAT(pubkey32)
// Both TWOX_128 portions are constants derivable from the Polkadot runtime source.
const DOT_SYSTEM_ACCOUNT_PREFIX = '26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9'

async function fetchPolkadotNative(
  address: string,
  tatumKey: string
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  if (!address || !tatumKey) return { native: 0, tokenCount: 0, error: 'No address or key' }
  try {
    // SS58 decode: [networkPrefix(1), pubkey(32), checksum(2)] = 35 bytes
    const raw = base58.decode(address)
    if (raw.length !== 35) return { native: 0, tokenCount: 0, error: 'Invalid address' }
    const pubkey = raw.slice(1, 33)

    // BLAKE2_128_CONCAT = blake2b(pubkey, 16 bytes) + pubkey
    const hash128 = blake2b(pubkey, { dkLen: 16 })
    const storageKey = '0x' + DOT_SYSTEM_ACCOUNT_PREFIX +
      Buffer.from(hash128).toString('hex') +
      Buffer.from(pubkey).toString('hex')

    const res = await fetch('https://polkadot-mainnet.gateway.tatum.io', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': tatumKey },
      body:    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'state_getStorage', params: [storageKey] }),
      signal:  AbortSignal.timeout(10_000)
    })
    if (!res.ok) return { native: 0, tokenCount: 0, error: `RPC ${res.status}` }

    const json = await res.json() as { result?: string | null }
    const hex = json.result
    // null or 0x = account not yet on-chain (zero balance)
    if (!hex || hex === '0x') return { native: 0, tokenCount: 0, error: null }

    // SCALE AccountInfo: nonce(4) consumers(4) providers(4) sufficients(4) free(16) reserved(16) ...
    const bytes = Buffer.from(hex.slice(2), 'hex')
    if (bytes.length < 32) return { native: 0, tokenCount: 0, error: null }

    const lo = bytes.readBigUInt64LE(16)
    const hi = bytes.readBigUInt64LE(24)
    const planck = lo + hi * BigInt('18446744073709551616')  // hi * 2^64
    return { native: Number(planck) / 1e10, tokenCount: 0, error: null }
  } catch (err) {
    const msg = String(err)
    return { native: 0, tokenCount: 0, error: msg.includes('abort') ? 'Timed out' : 'Network error' }
  }
}

// ─── Solana via Helius ────────────────────────────────────────────────────────

async function fetchSolanaNative(
  address: string,
  config: WalletConfig
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  const url = CHAIN_MAP['solana'].rpcUrl(config)
  try {
    const [balRes, tokRes] = await Promise.all([
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] }),
        signal: AbortSignal.timeout(10_000)
      }),
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 2,
          method: 'getTokenAccountsByOwner',
          params: [address, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]
        }),
        signal: AbortSignal.timeout(10_000)
      })
    ])

    if (!balRes.ok) return { native: 0, tokenCount: 0, error: `Helius ${balRes.status}` }

    const balJson = await balRes.json() as { result: { value: number } }
    const native = balJson.result.value / 1e9
    let tokenCount = 0
    if (tokRes.ok) {
      const tokJson = await tokRes.json() as { result: { value: unknown[] } }
      tokenCount = tokJson.result?.value?.length ?? 0
    }
    return { native, tokenCount, error: null }
  } catch (err) {
    return { native: 0, tokenCount: 0, error: String(err).includes('abort') ? 'Timed out' : 'Network error' }
  }
}

// ─── Cardano via Blockfrost ───────────────────────────────────────────────────

async function fetchCardanaNative(
  address: string | null,
  stakeAddress: string | null,
  config: WalletConfig
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  if (!address) return { native: 0, tokenCount: 0, error: 'No Cardano address — re-import your wallet' }

  const base = 'https://cardano-mainnet.blockfrost.io/api/v0'
  const headers = { project_id: config.blockfrostKey }

  try {
    let lovelace = 0
    let tokenCount = 0
    let resolvedStake = stakeAddress

    const addrRes = await fetch(`${base}/addresses/${address}`, { headers, signal: AbortSignal.timeout(10_000) })

    if (addrRes.ok) {
      const addrJson = await addrRes.json() as {
        amount?: Array<{ unit: string; quantity: string }>
        stake_address?: string
      }
      tokenCount = Math.max(0, (addrJson.amount?.length ?? 1) - 1)
      lovelace = Number(addrJson.amount?.find(a => a.unit === 'lovelace')?.quantity ?? '0')
      if (addrJson.stake_address) resolvedStake = addrJson.stake_address
    } else if (addrRes.status !== 404) {
      const body = await addrRes.json().catch(() => ({})) as { message?: string }
      return { native: 0, tokenCount: 0, error: `Blockfrost ${addrRes.status}: ${body.message ?? addrRes.statusText}` }
    }

    if (resolvedStake) {
      try {
        const acctRes = await fetch(`${base}/accounts/${resolvedStake}`, { headers, signal: AbortSignal.timeout(8_000) })
        if (acctRes.ok) {
          const acctJson = await acctRes.json() as { controlled_amount?: string }
          if (acctJson.controlled_amount) lovelace = Number(acctJson.controlled_amount)
        }
      } catch { /* keep per-address balance */ }
    }

    return { native: lovelace / 1e6, tokenCount, error: null }
  } catch (err) {
    return { native: 0, tokenCount: 0, error: String(err).includes('abort') ? 'Timed out' : 'Network error' }
  }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function fetchAllBalances(
  addresses: { evm: string; solana: string; cardano: string | null; cardanoStake?: string | null; bitcoin?: string; polkadot?: string; agw?: string },
  config: WalletConfig
): Promise<AllBalances> {
  const allIds = [...EVM_CHAINS.map(c => c.coingeckoId), 'solana', 'cardano', 'bitcoin', 'polkadot']

  const COMING_SOON = { native: 0, tokenCount: 0, error: 'coming-soon' }

  // Abstract Global Wallet native ETH lives at a different address than the EOA,
  // so the per-chain EOA fetch above misses it. Fetch it concurrently.
  const abstractDef = CHAIN_MAP['abstract']
  const hasAgw = !!addresses.agw && addresses.agw.toLowerCase() !== addresses.evm.toLowerCase()
  const NO_AGW = { native: 0, tokenCount: 0, error: 'no-agw' }

  // Fire market data + all chain fetches concurrently
  const [prices, ...rawResults] = await Promise.all([
    fetchMarketData(allIds),
    ...EVM_CHAINS.map(chain =>
      chain.comingSoon ? Promise.resolve(COMING_SOON) : fetchEvmNative(chain, addresses.evm, config)
    ),
    fetchSolanaNative(addresses.solana, config),
    fetchCardanaNative(addresses.cardano ?? null, addresses.cardanoStake ?? null, config),
    addresses.bitcoin
      ? fetchBitcoinNative(addresses.bitcoin)
      : Promise.resolve<typeof COMING_SOON>({ native: 0, tokenCount: 0, error: 'No address' }),
    addresses.polkadot
      ? fetchPolkadotNative(addresses.polkadot, config.tatumKey)
      : Promise.resolve<typeof COMING_SOON>({ native: 0, tokenCount: 0, error: 'No address' }),
    (hasAgw && abstractDef)
      ? fetchEvmNative(abstractDef, addresses.agw!, config)
      : Promise.resolve<typeof NO_AGW>(NO_AGW)
  ])

  const marketMap  = prices as Record<string, MarketData>
  const evmRaw    = rawResults.slice(0, EVM_CHAINS.length) as Array<{ native: number; tokenCount: number; error: string | null }>
  const solanaRaw = rawResults[EVM_CHAINS.length]     as { native: number; tokenCount: number; error: string | null }
  const cardanoRaw= rawResults[EVM_CHAINS.length + 1] as { native: number; tokenCount: number; error: string | null }
  const bitcoinRaw= rawResults[EVM_CHAINS.length + 2] as { native: number; tokenCount: number; error: string | null }
  const polkadotRaw=rawResults[EVM_CHAINS.length + 3] as { native: number; tokenCount: number; error: string | null }
  const agwRaw    = rawResults[EVM_CHAINS.length + 4] as { native: number; tokenCount: number; error: string | null }

  const toBalance = (chain: ChainDef, raw: typeof solanaRaw, decimals = 6): ChainBalance => {
    const market = marketMap[chain.coingeckoId]
    if (raw.error) {
      return { native: '—', symbol: chain.nativeSymbol, usdValue: null, tokenCount: 0, error: raw.error, priceChange24h: null, sparkline: null }
    }
    const price = market?.price ?? 0
    return {
      native: raw.native.toFixed(decimals),
      symbol: chain.nativeSymbol,
      usdValue: price > 0 ? usd(raw.native, price) : null,
      tokenCount: raw.tokenCount,
      error: null,
      priceChange24h: market?.change24h ?? null,
      sparkline: market?.sparkline ?? null
    }
  }

  const chains: Record<string, ChainBalance> = {}

  EVM_CHAINS.forEach((chain, i) => {
    chains[chain.id] = toBalance(chain, evmRaw[i])
  })

  chains['solana']   = toBalance(CHAIN_MAP['solana'],   solanaRaw)
  chains['cardano']  = toBalance(CHAIN_MAP['cardano'],  cardanoRaw)
  chains['bitcoin']  = toBalance(CHAIN_MAP['bitcoin'],  bitcoinRaw,  8)
  chains['polkadot'] = toBalance(CHAIN_MAP['polkadot'], polkadotRaw, 4)

  // Abstract Global Wallet native ETH — surfaced as its own entry so it both
  // counts toward the portfolio total (the dashboard sums Object.values(chains))
  // and can be badged as the smart wallet. Only added when it holds ETH, to
  // avoid an empty card when the AGW is token/NFT-only or absent.
  if (abstractDef && hasAgw && !agwRaw.error && agwRaw.native > 0) {
    chains['abstract-agw'] = toBalance(abstractDef, agwRaw)
  }

  // Aggregate 7d portfolio sparkline — group by coingeckoId to avoid double-counting
  // (e.g. ETH balance across Ethereum + Arbitrum + Base etc.)
  const portfolioSparkline = (() => {
    const groups = new Map<string, { native: number; sparkline: number[] }>()
    for (const [id, balance] of Object.entries(chains)) {
      if (!balance || balance.error || !balance.sparkline) continue
      const chainDef = CHAIN_MAP[id]
      if (!chainDef) continue
      const native = parseFloat(balance.native) || 0
      const existing = groups.get(chainDef.coingeckoId)
      if (existing) {
        existing.native += native
      } else {
        groups.set(chainDef.coingeckoId, { native, sparkline: balance.sparkline })
      }
    }
    if (groups.size === 0) return null
    const len = Math.min(...[...groups.values()].map(g => g.sparkline.length))
    if (len < 2) return null
    const result: number[] = []
    for (let t = 0; t < len; t++) {
      let total = 0
      for (const group of groups.values()) total += group.native * (group.sparkline[t] ?? 0)
      result.push(total)
    }
    return result
  })()

  return { chains, fetchedAt: Date.now(), portfolioSparkline }
}
