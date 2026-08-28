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
import {
  EVM_CHAINS, CHAIN_MAP, PUBLIC_RPCS, SOLANA_RPCS, BITCOIN_ESPLORA, DOGE_API_BASE,
  TESTNET_EVM_CHAINS, TESTNET_CHAIN_MAP, TESTNET_PUBLIC_RPCS, TESTNET_SOLANA_RPCS,
  TESTNET_BITCOIN_ESPLORA, TESTNET4_BITCOIN_ESPLORA, TESTNET_KOIOS_URL, isTestnet,
  PRIVACY_CHAINS, PRIVACY_CHAIN_MAP, isPrivacy, customChainDefs,
  type ChainDef
} from './chain-config'
import { fetchZcashBalance } from './zcash'
import { fetchMoneroBalance } from './monero'
import { fetchMidnightBalance } from './midnight'
import type { PrivacyAddresses, TestnetAddresses } from './wallet-core'
import { seedNativeUsd } from './native-prices'
import { getTokenBalances } from './alchemy-cache'
import { tatumFetch, blockfrostFetch, canTatum, rpcReadWithFallback, ankrRpcUrl, tatumRpcUrl } from './api-proxy'
import { koiosAddressLovelace } from './cardano-koios'
import { tronApiPost } from './tron'

export interface ChainBalance {
  native: string            // human-readable, e.g. "1.2345"
  symbol: string            // e.g. "ETH"
  /**
   * USD value of the native holding. RAW NUMBER — the wallet prices everything
   * in USD but displays it in the user's chosen currency, so both the FX
   * conversion and the formatting happen in the renderer (lib/currency.ts).
   * null if no price is available.
   */
  usdValue: number | null
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

// Last-good market data, kept so a transient CoinGecko 429 (the keyless
// coins/markets endpoint rate-limits under the concurrency we hit on dashboard
// mount — balances racing the token/NFT-floor simple/price calls) serves the
// previous prices instead of zeroing every USD value. Mirrors native-prices.ts.
const marketCache = new Map<string, MarketData>()

async function fetchMarketData(ids: string[]): Promise<Record<string, MarketData>> {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return {}

  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${unique.join(',')}&sparkline=true&price_change_percentage=24h&order=id_asc&per_page=250`

  const fresh: Record<string, MarketData> = {}
  // One retry on 429 — almost always transient burst contention that clears.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000) })
      if (res.status === 429 && attempt === 0) {
        await new Promise(r => setTimeout(r, 1200))
        continue
      }
      if (!res.ok) break
      const json = await res.json() as Array<{
        id: string
        current_price: number
        price_change_percentage_24h: number | null
        sparkline_in_7d?: { price: number[] }
      }>
      for (const coin of json) {
        const md: MarketData = {
          price: coin.current_price ?? 0,
          change24h: coin.price_change_percentage_24h ?? null,
          sparkline: coin.sparkline_in_7d?.price ?? null
        }
        fresh[coin.id] = md
        if (md.price > 0) marketCache.set(coin.id, md)  // remember last good
      }
      break
    } catch {
      break
    }
  }

  // Prefer fresh values; fall back to the last-known price per id so a failed or
  // partial fetch never nulls USD across the whole portfolio.
  const out: Record<string, MarketData> = {}
  for (const id of unique) {
    const md = fresh[id] ?? marketCache.get(id)
    if (md) out[id] = md
  }
  return out
}

function usd(amount: number, price: number): number {
  return amount * price
}

// ─── EVM via JSON-RPC ─────────────────────────────────────────────────────────

async function fetchEvmNative(
  chain: ChainDef,
  address: string,
  config: WalletConfig
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  try {
    // Native balance: proxy/Alchemy first, then public fallbacks so a throttled
    // key shows a balance instead of "—". Token count below stays Alchemy-only.
    // Ankr slugs are mainnet-only, so that fallback is skipped in testnet mode
    // (it would silently answer with a MAINNET balance for the testnet chain).
    const publicRpcs = isTestnet(config) ? TESTNET_PUBLIC_RPCS : PUBLIC_RPCS
    // Tail of the ladder (mainnet only): keyed Ankr, then keyed Tatum gateway —
    // the last-resort nodes for chains with thin/no public RPC (Abstract, HyperEVM).
    const urls = [
      chain.rpcUrl(config),
      ...(publicRpcs[chain.id] ?? []),
      isTestnet(config) ? undefined : ankrRpcUrl(chain.id, config),
      isTestnet(config) ? undefined : tatumRpcUrl(chain.id, config),
    ]
    const balJson = await rpcReadWithFallback(
      urls, { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] }, 10_000
    ) as { result?: string; error?: { message: string } } | null

    if (!balJson) return { native: 0, tokenCount: 0, error: 'RPC error' }
    if (balJson.error) return { native: 0, tokenCount: 0, error: balJson.error.message }

    const native = Number(BigInt(balJson.result ?? '0x0')) / 1e18

    // Token count: Alchemy method for Alchemy chains, Blockscout v2 for others.
    // The Alchemy branch shares one coalesced alchemy_getTokenBalances call with
    // the token fetcher (alchemy-cache.ts) so the concurrent mount burst doesn't
    // hit this expensive method twice per chain.
    let tokenCount = 0
    if (chain.alchemyNetwork) {
      tokenCount = (await getTokenBalances(chain.alchemyNetwork, address, config)).length
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
  address: string,
  esplora: string[] = BITCOIN_ESPLORA
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  if (!address) return { native: 0, tokenCount: 0, error: 'No address' }
  // Try each Esplora host in turn — they share the identical /address/{addr}
  // response, so blockstream.info covers for mempool.space when it's down.
  let lastErr: string | null = null
  for (const base of esplora) {
    try {
      const res = await fetch(`${base}/address/${address}`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) { lastErr = `Esplora ${res.status}`; continue }
      const json = await res.json() as {
        chain_stats:   { funded_txo_sum: number; spent_txo_sum: number }
        mempool_stats: { funded_txo_sum: number; spent_txo_sum: number }
      }
      const confirmed = json.chain_stats.funded_txo_sum   - json.chain_stats.spent_txo_sum
      const pending   = json.mempool_stats.funded_txo_sum - json.mempool_stats.spent_txo_sum
      return { native: (confirmed + pending) / 1e8, tokenCount: 0, error: null }
    } catch (err) {
      lastErr = String(err).includes('abort') ? 'Timed out' : 'Network error'
    }
  }
  return { native: 0, tokenCount: 0, error: lastErr ?? 'Network error' }
}

// Total BTC across all three address types (Native SegWit + Nested SegWit + Taproot).
// A Taproot inscription UTXO's sat value still counts toward holdings; the send path
// (bitcoin.ts) is what prevents inscriptions from being spent as fees/change.
async function fetchBitcoinTotal(
  addrs: { bitcoin?: string; bitcoinNested?: string; bitcoinTaproot?: string },
  esplora: string[] = BITCOIN_ESPLORA
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  const list = [addrs.bitcoin, addrs.bitcoinNested, addrs.bitcoinTaproot].filter((a): a is string => !!a)
  if (list.length === 0) return { native: 0, tokenCount: 0, error: 'No address' }
  const results = await Promise.all(list.map(a => fetchBitcoinNative(a, esplora)))
  const native = results.reduce((sum, r) => sum + (r.native || 0), 0)
  // Only surface an error if EVERY address failed — one host hiccup shouldn't blank the card.
  const allErrored = results.every(r => r.error)
  return { native, tokenCount: 0, error: allErrored ? (results[0].error ?? 'Network error') : null }
}

// ─── Tron via TRON HTTP API (Alchemy) ─────────────────────────────────────────

async function fetchTronNative(
  address: string | undefined,
  config: WalletConfig
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  if (!address) return { native: 0, tokenCount: 0, error: 'No address' }
  try {
    // Proxy/Alchemy first, then keyless TronGrid fallback (so Tron shows a balance
    // even before the Worker's /rpc/alchemy-tron route is deployed).
    // An un-activated account returns `{}` (no balance field) — zero, not an error.
    const json = await tronApiPost<{ balance?: number }>('wallet/getaccount', { address, visible: true }, config, 10_000)
    return { native: (json?.balance ?? 0) / 1e6, tokenCount: 0, error: null }
  } catch (err) {
    return { native: 0, tokenCount: 0, error: String(err).includes('abort') ? 'Timed out' : 'Network error' }
  }
}

// ─── Dogecoin via BlockCypher — Blockchair fallback ───────────────────────────

async function fetchDogecoinNative(
  address: string | undefined
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  if (!address) return { native: 0, tokenCount: 0, error: 'No address' }
  // Three keyless sources tried in order — BlockCypher's free tier 429s readily, so
  // Dogechain.info (the most reliable keyless balance API) goes first; the others
  // are fallbacks. 1 DOGE = 1e8 koinu. First source that answers wins.
  let lastErr: string | null = null

  // 1) Dogechain.info — { balance: "1.23", success: 1 } with balance already in DOGE.
  try {
    const res = await fetch(`https://dogechain.info/api/v1/address/balance/${address}`, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      const j = await res.json() as { balance?: string; success?: number }
      if (j.success === 1 && j.balance != null) return { native: parseFloat(j.balance) || 0, tokenCount: 0, error: null }
    }
    lastErr = `Dogechain ${res.status}`
  } catch (err) {
    lastErr = String(err).includes('abort') ? 'Timed out' : 'Network error'
  }

  // 2) BlockCypher — final_balance in koinu, incl. mempool.
  try {
    const res = await fetch(`${DOGE_API_BASE}/addrs/${address}/balance`, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      const json = await res.json() as { final_balance?: number }
      return { native: (json.final_balance ?? 0) / 1e8, tokenCount: 0, error: null }
    }
    lastErr = `BlockCypher ${res.status}`
  } catch { /* try the next source */ }

  // 3) Blockchair — { data: { <addr>: { address: { balance } } } } in koinu.
  try {
    const res = await fetch(`https://api.blockchair.com/dogecoin/dashboards/address/${address}`, { signal: AbortSignal.timeout(10_000) })
    if (res.ok) {
      const json = await res.json() as { data?: Record<string, { address?: { balance?: number } }> }
      const bal = json.data?.[address]?.address?.balance
      if (typeof bal === 'number') return { native: bal / 1e8, tokenCount: 0, error: null }
    }
  } catch { /* fall through to lastErr */ }

  return { native: 0, tokenCount: 0, error: lastErr ?? 'Network error' }
}

// ─── Polkadot via Substrate RPC (Tatum gateway) + SCALE decode ───────────────
// Storage key: TWOX_128("System") + TWOX_128("Account") + BLAKE2_128_CONCAT(pubkey32)
// Both TWOX_128 portions are constants derivable from the Polkadot runtime source.
const DOT_SYSTEM_ACCOUNT_PREFIX = '26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9'

async function fetchPolkadotNative(
  address: string,
  config: WalletConfig
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  if (!address) return { native: 0, tokenCount: 0, error: 'No address' }
  if (!canTatum(config)) return { native: 0, tokenCount: 0, error: 'No Tatum key or proxy' }
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

    const res = await tatumFetch('polkadot',
      { jsonrpc: '2.0', id: 1, method: 'state_getStorage', params: [storageKey] },
      config, 10_000)
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
  // Testnet Mode: devnet RPC (keyless) replaces the Helius proxy + mainnet publics.
  const url = (isTestnet(config) ? TESTNET_CHAIN_MAP : CHAIN_MAP)['solana'].rpcUrl(config)
  try {
    // Native balance: Helius proxy first, then public Solana RPCs (drop-in JSON-RPC)
    // so a throttled key still shows SOL. Token-account enrichment stays Helius-only.
    const [balJson, tokRes] = await Promise.all([
      rpcReadWithFallback(
        [url, ...(isTestnet(config) ? TESTNET_SOLANA_RPCS : SOLANA_RPCS), isTestnet(config) ? undefined : ankrRpcUrl('solana', config)],
        { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] },
        10_000
      ) as Promise<{ result?: { value: number }; error?: { message?: string } } | null>,
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

    if (!balJson) return { native: 0, tokenCount: 0, error: 'RPC error' }

    const native = (balJson.result?.value ?? 0) / 1e9
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

  try {
    let lovelace = 0
    let tokenCount = 0
    let resolvedStake = stakeAddress

    const addrRes = await blockfrostFetch(`addresses/${address}`, config, 10_000)

    if (addrRes.ok) {
      const addrJson = await addrRes.json() as {
        amount?: Array<{ unit: string; quantity: string }>
        stake_address?: string
      }
      tokenCount = Math.max(0, (addrJson.amount?.length ?? 1) - 1)
      lovelace = Number(addrJson.amount?.find(a => a.unit === 'lovelace')?.quantity ?? '0')
      if (addrJson.stake_address) resolvedStake = addrJson.stake_address
    } else if (addrRes.status !== 404) {
      // Blockfrost errored (not a missing address) — fall back to keyless Koios so
      // ADA balance still shows. Token count isn't mirrored on this path (enrichment).
      const koiosLovelace = await koiosAddressLovelace(address)
      if (koiosLovelace != null) return { native: koiosLovelace / 1e6, tokenCount: 0, error: null }
      const body = await addrRes.json().catch(() => ({})) as { message?: string }
      return { native: 0, tokenCount: 0, error: `Blockfrost ${addrRes.status}: ${body.message ?? addrRes.statusText}` }
    }

    if (resolvedStake) {
      try {
        const acctRes = await blockfrostFetch(`accounts/${resolvedStake}`, config, 8_000)
        if (acctRes.ok) {
          const acctJson = await acctRes.json() as { controlled_amount?: string }
          if (acctJson.controlled_amount) lovelace = Number(acctJson.controlled_amount)
        }
      } catch { /* keep per-address balance */ }
    }

    return { native: lovelace / 1e6, tokenCount, error: null }
  } catch (err) {
    // Blockfrost unreachable — last-chance keyless Koios fallback for ADA balance.
    const koiosLovelace = await koiosAddressLovelace(address)
    if (koiosLovelace != null) return { native: koiosLovelace / 1e6, tokenCount: 0, error: null }
    return { native: 0, tokenCount: 0, error: String(err).includes('abort') ? 'Timed out' : 'Network error' }
  }
}

// ─── Cardano preprod (Testnet Mode) via keyless Koios ─────────────────────────
// Blockfrost project keys are network-scoped (a mainnet key 403s on preprod), so
// testnet Cardano reads skip Blockfrost entirely and use Koios preprod.

async function fetchCardanoPreprod(
  address: string | null
): Promise<{ native: number; tokenCount: number; error: string | null }> {
  if (!address) return { native: 0, tokenCount: 0, error: 'No address' }
  const lovelace = await koiosAddressLovelace(address, TESTNET_KOIOS_URL)
  if (lovelace == null) return { native: 0, tokenCount: 0, error: 'Network error' }
  return { native: lovelace / 1e6, tokenCount: 0, error: null }
}

// ─── Testnet orchestrator ─────────────────────────────────────────────────────
// Separate from the mainnet path on purpose: no prices/sparklines (CoinGecko has
// none for testnets), no Dogecoin/Polkadot/AGW (no testnet data provider), and
// Bitcoin appears twice (Testnet3 + Testnet4 — same tb1 addresses, different
// chains). Callers pass effectiveAddresses() so bitcoin/cardano are already the
// testnet-encoded ones.

async function fetchAllBalancesTestnet(
  addresses: { evm: string; solana: string; cardano: string | null; bitcoin?: string; bitcoinNested?: string; bitcoinTaproot?: string; tron?: string; testnet?: TestnetAddresses },
  config: WalletConfig
): Promise<AllBalances> {
  const btcAddrs = { bitcoin: addresses.bitcoin, bitcoinNested: addresses.bitcoinNested, bitcoinTaproot: addresses.bitcoinTaproot }
  const NO_ADDR = { native: 0, tokenCount: 0, error: 'No address' }

  const rawResults = await Promise.all([
    ...TESTNET_EVM_CHAINS.map(chain => fetchEvmNative(chain, addresses.evm, config)),
    fetchSolanaNative(addresses.solana, config),
    fetchCardanoPreprod(addresses.cardano ?? null),
    addresses.bitcoin ? fetchBitcoinTotal(btcAddrs, TESTNET_BITCOIN_ESPLORA)  : Promise.resolve(NO_ADDR),
    addresses.bitcoin ? fetchBitcoinTotal(btcAddrs, TESTNET4_BITCOIN_ESPLORA) : Promise.resolve(NO_ADDR),
    fetchTronNative(addresses.tron, config),
    // NIGHT is unshielded — same public-by-address indexer read as mainnet,
    // just pointed at the Preprod indexer (see fetchMidnightBalance).
    fetchMidnightBalance(addresses.testnet?.midnight, 'preprod').then(r => ({ ...r, tokenCount: 0 })),
  ])

  const toBalance = (chain: ChainDef, raw: { native: number; tokenCount: number; error: string | null }, decimals = 6): ChainBalance => {
    if (raw.error) {
      return { native: '—', symbol: chain.nativeSymbol, usdValue: null, tokenCount: 0, error: raw.error, priceChange24h: null, sparkline: null }
    }
    return { native: raw.native.toFixed(decimals), symbol: chain.nativeSymbol, usdValue: null, tokenCount: raw.tokenCount, error: null, priceChange24h: null, sparkline: null }
  }

  const chains: Record<string, ChainBalance> = {}
  TESTNET_EVM_CHAINS.forEach((chain, i) => {
    chains[chain.id] = toBalance(chain, rawResults[i])
  })
  const n = TESTNET_EVM_CHAINS.length
  chains['solana']           = toBalance(TESTNET_CHAIN_MAP['solana'],           rawResults[n])
  chains['cardano']          = toBalance(TESTNET_CHAIN_MAP['cardano'],          rawResults[n + 1])
  chains['bitcoin']          = toBalance(TESTNET_CHAIN_MAP['bitcoin'],          rawResults[n + 2], 8)
  chains['bitcoin-testnet4'] = toBalance(TESTNET_CHAIN_MAP['bitcoin-testnet4'], rawResults[n + 3], 8)
  chains['tron']             = toBalance(TESTNET_CHAIN_MAP['tron'],             rawResults[n + 4])
  chains['midnight']         = toBalance(TESTNET_CHAIN_MAP['midnight'],         rawResults[n + 5])

  return { chains, fetchedAt: Date.now(), portfolioSparkline: null }
}

// ─── Privacy Mode orchestrator ────────────────────────────────────────────────
// Privacy chains are mainnets, so unlike the testnet path, prices ARE fetched.
// Every target has a real Monero backend now ('./monero' is per-target: Electron
// main / extension offscreen document / Capacitor WebView worker).

async function fetchAllBalancesPrivacy(
  privacy: PrivacyAddresses | undefined,
  config: WalletConfig
): Promise<AllBalances> {
  const allIds = PRIVACY_CHAINS.map(c => c.coingeckoId)

  const [prices, moneroRaw, zcashRaw, midnightRaw] = await Promise.all([
    fetchMarketData(allIds),
    fetchMoneroBalance(privacy, config),
    privacy?.zcashTransparent
      ? fetchZcashBalance(privacy.zcashTransparent)
      : Promise.resolve({ native: 0, error: 'No address' }),
    // NIGHT is unshielded — public balance by address via the indexer. Falls
    // back to the Coming-Soon card state when the address isn't derived yet
    // (browser targets, until ledger-v9 loads there).
    fetchMidnightBalance(privacy?.midnight),
  ])

  const marketMap = prices as Record<string, MarketData>
  seedNativeUsd(Object.fromEntries(Object.entries(marketMap).map(([id, m]) => [id, m.price] as [string, number])))

  const toBalance = (chain: ChainDef, raw: { native: number; error: string | null }, decimals = 6): ChainBalance => {
    const market = marketMap[chain.coingeckoId]
    if (raw.error) {
      return { native: '—', symbol: chain.nativeSymbol, usdValue: null, tokenCount: 0, error: raw.error, priceChange24h: null, sparkline: null }
    }
    const price = market?.price ?? 0
    return {
      native: raw.native.toFixed(decimals),
      symbol: chain.nativeSymbol,
      usdValue: price > 0 ? usd(raw.native, price) : null,
      tokenCount: 0,
      error: null,
      priceChange24h: market?.change24h ?? null,
      sparkline: market?.sparkline ?? null
    }
  }

  const chains: Record<string, ChainBalance> = {
    monero: toBalance(PRIVACY_CHAIN_MAP['monero'], moneroRaw, 8),
    zcash: toBalance(PRIVACY_CHAIN_MAP['zcash'], zcashRaw, 8),
    midnight: toBalance(PRIVACY_CHAIN_MAP['midnight'], midnightRaw, 6),
  }

  return { chains, fetchedAt: Date.now(), portfolioSparkline: null }
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export async function fetchAllBalances(
  addresses: { evm: string; solana: string; cardano: string | null; cardanoStake?: string | null; bitcoin?: string; bitcoinNested?: string; bitcoinTaproot?: string; polkadot?: string; tron?: string; dogecoin?: string; agw?: string; privacy?: PrivacyAddresses; testnet?: TestnetAddresses },
  config: WalletConfig
): Promise<AllBalances> {
  if (isTestnet(config)) return fetchAllBalancesTestnet(addresses, config)
  if (isPrivacy(config)) return fetchAllBalancesPrivacy(addresses.privacy, config)

  // User-added networks ride the same EVM pipeline (their own RPC, no
  // coingeckoId → balance shows without a USD value).
  const evmChains = [...EVM_CHAINS, ...customChainDefs(config)]

  const allIds = [...EVM_CHAINS.map(c => c.coingeckoId), 'solana', 'cardano', 'bitcoin', 'polkadot', 'tron', 'dogecoin']

  const COMING_SOON = { native: 0, tokenCount: 0, error: 'coming-soon' }

  // Abstract Global Wallet native ETH lives at a different address than the EOA,
  // so the per-chain EOA fetch above misses it. Fetch it concurrently.
  const abstractDef = CHAIN_MAP['abstract']
  const hasAgw = !!addresses.agw && addresses.agw.toLowerCase() !== addresses.evm.toLowerCase()
  const NO_AGW = { native: 0, tokenCount: 0, error: 'no-agw' }

  // Per-source timing: everything below runs concurrently, so the SLOWEST
  // source gates the whole portfolio header. One summary line (slowest first)
  // makes the straggler visible in every console — desktop devtools, the
  // extension SW inspector, and Android logcat.
  const timings: Array<[string, number]> = []
  const timed = <T,>(label: string, p: Promise<T>): Promise<T> => {
    const start = Date.now()
    return p.finally(() => { timings.push([label, Date.now() - start]) })
  }

  // Fire market data + all chain fetches concurrently
  const t0 = Date.now()
  const [prices, ...rawResults] = await Promise.all([
    timed('market', fetchMarketData(allIds)),
    ...evmChains.map(chain =>
      chain.comingSoon ? Promise.resolve(COMING_SOON) : timed(chain.id, fetchEvmNative(chain, addresses.evm, config))
    ),
    timed('solana', fetchSolanaNative(addresses.solana, config)),
    timed('cardano', fetchCardanaNative(addresses.cardano ?? null, addresses.cardanoStake ?? null, config)),
    addresses.bitcoin
      ? timed('bitcoin', fetchBitcoinTotal(addresses))
      : Promise.resolve<typeof COMING_SOON>({ native: 0, tokenCount: 0, error: 'No address' }),
    addresses.polkadot
      ? timed('polkadot', fetchPolkadotNative(addresses.polkadot, config))
      : Promise.resolve<typeof COMING_SOON>({ native: 0, tokenCount: 0, error: 'No address' }),
    (hasAgw && abstractDef)
      ? timed('agw', fetchEvmNative(abstractDef, addresses.agw!, config))
      : Promise.resolve<typeof NO_AGW>(NO_AGW),
    timed('tron', fetchTronNative(addresses.tron, config)),
    timed('dogecoin', fetchDogecoinNative(addresses.dogecoin))
  ])
  timings.sort((a, b) => b[1] - a[1])
  console.log(`[balance] all sources in ${Date.now() - t0}ms — slowest: ${timings.slice(0, 8).map(([l, ms]) => `${l} ${ms}ms`).join(', ')}`)

  const marketMap  = prices as Record<string, MarketData>
  // Share these native prices with the token + NFT-floor valuation paths so they
  // reuse them instead of each firing their own (keyless, 429-prone) CoinGecko call.
  seedNativeUsd(Object.fromEntries(Object.entries(marketMap).map(([id, m]) => [id, m.price] as [string, number])))
  const evmRaw    = rawResults.slice(0, evmChains.length) as Array<{ native: number; tokenCount: number; error: string | null }>
  const solanaRaw = rawResults[evmChains.length]     as { native: number; tokenCount: number; error: string | null }
  const cardanoRaw= rawResults[evmChains.length + 1] as { native: number; tokenCount: number; error: string | null }
  const bitcoinRaw= rawResults[evmChains.length + 2] as { native: number; tokenCount: number; error: string | null }
  const polkadotRaw=rawResults[evmChains.length + 3] as { native: number; tokenCount: number; error: string | null }
  const agwRaw    = rawResults[evmChains.length + 4] as { native: number; tokenCount: number; error: string | null }
  const tronRaw   = rawResults[evmChains.length + 5] as { native: number; tokenCount: number; error: string | null }
  const dogecoinRaw=rawResults[evmChains.length + 6] as { native: number; tokenCount: number; error: string | null }

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

  evmChains.forEach((chain, i) => {
    chains[chain.id] = toBalance(chain, evmRaw[i])
  })

  chains['solana']   = toBalance(CHAIN_MAP['solana'],   solanaRaw)
  chains['cardano']  = toBalance(CHAIN_MAP['cardano'],  cardanoRaw)
  chains['bitcoin']  = toBalance(CHAIN_MAP['bitcoin'],  bitcoinRaw,  8)
  chains['polkadot'] = toBalance(CHAIN_MAP['polkadot'], polkadotRaw, 4)
  chains['tron']     = toBalance(CHAIN_MAP['tron'],     tronRaw,     6)
  chains['dogecoin'] = toBalance(CHAIN_MAP['dogecoin'], dogecoinRaw, 8)

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
