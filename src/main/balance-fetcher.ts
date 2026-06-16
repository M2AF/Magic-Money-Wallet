/**
 * balance-fetcher.ts — MagicMoney Wallet
 *
 * Fetches native balances and token counts from:
 *   - Alchemy    → EVM (Ethereum mainnet, and same address on Monad/Abstract)
 *   - Helius     → Solana
 *   - Blockfrost → Cardano
 */

import type { WalletConfig } from './secure-store'

export interface ChainBalance {
  native: string       // human-readable amount e.g. "1.2345"
  symbol: string       // e.g. "ETH"
  usdValue: string | null  // e.g. "$2,341.22" — null if price unavailable
  tokenCount: number   // number of distinct tokens held
  error: string | null // set if the fetch failed
}

export interface AllBalances {
  evm: ChainBalance
  solana: ChainBalance
  cardano: ChainBalance
  fetchedAt: number   // unix timestamp ms
}

// ─── EVM via Alchemy ─────────────────────────────────────────────────────────

async function fetchEvmBalance(address: string, alchemyKey: string): Promise<ChainBalance> {
  const url = `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`

  try {
    // Native ETH balance
    const balRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_getBalance',
        params: [address, 'latest']
      })
    })
    const balJson = await balRes.json() as { result: string }
    const weiHex = balJson.result
    const eth = Number(BigInt(weiHex)) / 1e18

    // Token balances (ERC-20)
    const tokRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2,
        method: 'alchemy_getTokenBalances',
        params: [address, 'erc20']
      })
    })
    const tokJson = await tokRes.json() as {
      result?: { tokenBalances?: Array<{ tokenBalance: string }> }
    }
    const nonZeroTokens = (tokJson.result?.tokenBalances ?? [])
      .filter(t => t.tokenBalance !== '0x0000000000000000000000000000000000000000000000000000000000000000')

    // ETH price from Alchemy's token price API
    let usdValue: string | null = null
    try {
      const priceRes = await fetch(
        `https://api.g.alchemy.com/prices/v1/${alchemyKey}/tokens/by-symbol?symbols=ETH`
      )
      const priceJson = await priceRes.json() as {
        data?: Array<{ prices?: Array<{ value: string }> }>
      }
      const price = Number(priceJson.data?.[0]?.prices?.[0]?.value ?? 0)
      if (price > 0) {
        usdValue = `$${(eth * price).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      }
    } catch { /* price is optional */ }

    return {
      native: eth.toFixed(6),
      symbol: 'ETH',
      usdValue,
      tokenCount: nonZeroTokens.length,
      error: null
    }
  } catch (err) {
    return {
      native: '—',
      symbol: 'ETH',
      usdValue: null,
      tokenCount: 0,
      error: String(err)
    }
  }
}

// ─── Solana via Helius ───────────────────────────────────────────────────────

async function fetchSolanaBalance(address: string, heliusKey: string): Promise<ChainBalance> {
  const url = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`

  try {
    // Native SOL balance
    const balRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'getBalance',
        params: [address]
      })
    })
    const balJson = await balRes.json() as { result: { value: number } }
    const sol = balJson.result.value / 1e9  // lamports → SOL

    // Token accounts via Helius DAS
    const tokRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2,
        method: 'getTokenAccountsByOwner',
        params: [
          address,
          { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' },
          { encoding: 'jsonParsed' }
        ]
      })
    })
    const tokJson = await tokRes.json() as { result: { value: unknown[] } }
    const tokenCount = tokJson.result?.value?.length ?? 0

    // SOL price from CoinGecko (public, no key needed)
    let usdValue: string | null = null
    try {
      const priceRes = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
      )
      const priceJson = await priceRes.json() as { solana?: { usd: number } }
      const price = priceJson.solana?.usd ?? 0
      if (price > 0) {
        usdValue = `$${(sol * price).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      }
    } catch { /* price is optional */ }

    return { native: sol.toFixed(6), symbol: 'SOL', usdValue, tokenCount, error: null }
  } catch (err) {
    return { native: '—', symbol: 'SOL', usdValue: null, tokenCount: 0, error: String(err) }
  }
}

// ─── Cardano via Blockfrost ──────────────────────────────────────────────────

async function fetchCardanoBalance(
  address: string | null,
  stakeAddress: string | null,
  blockfrostKey: string
): Promise<ChainBalance> {
  if (!address) {
    return {
      native: '—', symbol: 'ADA', usdValue: null, tokenCount: 0,
      error: 'No Cardano address — re-import your wallet'
    }
  }

  const baseUrl = 'https://cardano-mainnet.blockfrost.io/api/v0'
  const headers = { project_id: blockfrostKey }

  try {
    let adaLovelace = 0
    let tokenCount = 0
    let resolvedStake = stakeAddress

    // ── 1. Query the specific payment address ────────────────────────────────
    const addrRes = await fetch(`${baseUrl}/addresses/${address}`, { headers })

    if (addrRes.ok) {
      const addrJson = await addrRes.json() as {
        amount?: Array<{ unit: string; quantity: string }>
        stake_address?: string
      }
      tokenCount = (addrJson.amount?.length ?? 1) - 1
      adaLovelace = Number(addrJson.amount?.find(a => a.unit === 'lovelace')?.quantity ?? '0')
      // Prefer the stake address Blockfrost reports (authoritative)
      if (addrJson.stake_address) resolvedStake = addrJson.stake_address
    } else if (addrRes.status !== 404) {
      const errBody = await addrRes.json().catch(() => ({})) as { message?: string }
      return {
        native: '—', symbol: 'ADA', usdValue: null, tokenCount: 0,
        error: `Blockfrost ${addrRes.status}: ${errBody.message ?? addrRes.statusText}`
      }
    }
    // status 404 → address not on-chain yet; fall through to the stake lookup
    // using the locally-derived stake address below.

    // ── 2. Use the stake address for the TOTAL controlled balance ────────────
    // /addresses/{addr} only shows balance at ONE address. A Cardano wallet
    // spreads funds across many addresses (change outputs, etc.) that all share
    // one stake key. /accounts/{stake_addr} returns controlled_amount — the sum
    // across every UTxO tied to that stake key. Because we derive the stake
    // address locally, this works even before the payment address is on-chain.
    if (resolvedStake) {
      try {
        const acctRes = await fetch(`${baseUrl}/accounts/${resolvedStake}`, { headers })
        if (acctRes.ok) {
          const acctJson = await acctRes.json() as { controlled_amount?: string }
          if (acctJson.controlled_amount) {
            adaLovelace = Number(acctJson.controlled_amount)
          }
        }
        // acctRes 404 = stake key never registered/seen → keep adaLovelace as-is (0)
      } catch { /* keep single-address balance */ }
    }

    const ada = adaLovelace / 1e6

    // ADA price from CoinGecko
    let usdValue: string | null = null
    try {
      const priceRes = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd'
      )
      const priceJson = await priceRes.json() as { cardano?: { usd: number } }
      const price = priceJson.cardano?.usd ?? 0
      if (price > 0) {
        usdValue = `$${(ada * price).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
      }
    } catch { /* price is optional */ }

    return { native: ada.toFixed(6), symbol: 'ADA', usdValue, tokenCount, error: null }
  } catch (err) {
    return { native: '—', symbol: 'ADA', usdValue: null, tokenCount: 0, error: String(err) }
  }
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

export async function fetchAllBalances(
  addresses: { evm: string; solana: string; cardano: string | null; cardanoStake?: string | null },
  config: WalletConfig
): Promise<AllBalances> {
  const [evm, solana, cardano] = await Promise.all([
    fetchEvmBalance(addresses.evm, config.alchemyKey),
    fetchSolanaBalance(addresses.solana, config.heliusKey),
    fetchCardanoBalance(addresses.cardano, addresses.cardanoStake ?? null, config.blockfrostKey)
  ])

  return { evm, solana, cardano, fetchedAt: Date.now() }
}