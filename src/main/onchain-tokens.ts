/**
 * onchain-tokens.ts — the THIRD and last asset tier: read tokens straight off
 * the chain, through keyless public RPCs, with no indexer and no API key.
 *
 * Tier 1 is Alchemy, tier 2 is Moralis. Both are keyed accounts with quotas, and
 * when Alchemy's monthly capacity ran out every EVM chain in the wallet went
 * blank at once. This tier has no quota to run out: `PUBLIC_RPCS` are keyless,
 * and Multicall3 is deployed at the SAME address on every chain we support.
 *
 * The hard part is not reading balances — it is knowing what to read.
 *
 * An ERC-20 balance lives in the token contract's own storage (`balanceOf`), not
 * in the account, so no node can answer "which tokens does this address hold".
 * There is exactly one on-chain route to that answer: scan `Transfer` logs for
 * incoming transfers. Keyless RPCs price that very differently — measured
 * 2026-08-28, Abstract and Robinhood serve a full-history query in ONE request,
 * while Ronin and World Chain cap `eth_getLogs` at 100 blocks (600k+ requests to
 * sweep their history, i.e. never). So discovery runs only where it is actually
 * affordable, and the chains where it IS affordable are almost exactly the ones
 * Moralis refuses — the two fallbacks cover each other's gaps.
 *
 * Candidates therefore come from four places, cheapest first:
 *   1. contracts this wallet already held (the on-disk metadata/balance caches),
 *   2. tokens the user imported by hand,
 *   3. a small bundled list of majors per chain,
 *   4. the Transfer-log sweep, where the chain's RPC allows it.
 *
 * Everything after that is one `eth_call` per ~300 contracts.
 */

import { encodeFunctionData, decodeFunctionResult, parseAbi } from 'viem'
import type { WalletConfig } from './secure-store'
import {
  loadOnchainScanCache, saveOnchainScanCache,
  loadTokenMetaCache, saveTokenMetaCache,
  loadTokenBalanceCache,
  type OnchainScanCacheEntry, type TokenMetaCacheEntry,
} from './secure-store'
import { PUBLIC_RPCS } from './chain-config'

/** Multicall3 — same address on every chain we support (verified on all 13 live). */
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'

const MULTICALL_ABI = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)',
])

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
])

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/**
 * Largest `eth_getLogs` block range each keyless RPC actually accepts, measured
 * against the live endpoints on 2026-08-28. `null` = no limit (one request does
 * the whole chain). A chain ABSENT from this map gets no discovery sweep:
 *
 *   ethereum   archive queries need a paid token
 *   arbitrum   full-range query times out
 *   polygon/optimism/base/avalanche  10k-2k ranges → 5k-47k requests, and all
 *              four are covered by Moralis anyway
 *   ronin, worldchain  100-block cap → 600k / 342k requests. Never.
 *
 * What remains is, almost exactly, the set Moralis cannot serve.
 */
const LOG_SCAN_RANGE: Record<string, number | null> = {
  abstract:  null,
  robinhood: null,
  soneium:   100_000,
  apechain:  100_000,
  zora:      100_000,
  gnosis:    100_000,
  blast:      10_000,
}

/**
 * Per-pass request budget for the sweep. Blast needs ~4,000 requests to reach
 * genesis; doing that in one pass would stall the token tab for minutes. The
 * cursor persists, so each launch walks a little further back and the work is
 * cumulative — the same doctrine as the NFT floor cache.
 */
const SCAN_REQUESTS_PER_PASS = 40

/** Contracts per `aggregate3` call. Kept modest so a public RPC won't refuse the payload. */
const MULTICALL_CHUNK = 300

/** Majors worth probing even when we have never seen the user hold them. */
const MAJOR_TOKENS: Record<string, string[]> = {
  ethereum:  ['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', '0xdAC17F958D2ee523a2206206994597C13D831ec7', '0x6B175474E89094C44Da98b954EedeAC495271d0F', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'],
  base:      ['0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', '0x4200000000000000000000000000000000000006'],
  arbitrum:  ['0xaf88d065e77c8cC2239327C5EDb3A432268e5831', '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'],
  optimism:  ['0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', '0x4200000000000000000000000000000000000006'],
  polygon:   ['0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270'],
  avalanche: ['0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7'],
  gnosis:    ['0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83', '0x4ECaBa5870353805a9F068101A40E0f32ed605C6', '0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d'],
  blast:     ['0x4300000000000000000000000000000000000003', '0x4300000000000000000000000000000000000004'],
  zora:      ['0x4200000000000000000000000000000000000006'],
  soneium:   ['0x4200000000000000000000000000000000000006'],
  abstract:  ['0x3439153EB7AF838Ad19d56E1571FBD09333C2809'],
  ronin:     ['0xc99a6A985eD2Cac1ef41640596C5A5f9F4E19Ef5', '0x0B7007c13325C48911F73A2daD5FA5dCBf808aDc'],
  worldchain: ['0x79A02482A880bCE3F13e09Da970dC34db4CD24d1', '0x4200000000000000000000000000000000000006'],
  apechain:  [],
  robinhood: [],
}

// ── keyless RPC with failover ────────────────────────────────────────────────

interface RpcError { message?: string }

/**
 * JSON-RPC against the chain's keyless public endpoints, trying each in turn.
 * Throws only when every endpoint failed, so callers treat that as "this tier is
 * unavailable" rather than "the wallet is empty".
 */
async function publicRpc<T>(chainId: string, method: string, params: unknown[], timeoutMs = 15_000): Promise<T> {
  const urls = PUBLIC_RPCS[chainId] ?? []
  let lastErr: unknown = new Error(`no public RPC for ${chainId}`)
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue }
      const json = await res.json() as { result?: T; error?: RpcError }
      if (json.error) { lastErr = new Error(json.error.message ?? 'rpc error'); continue }
      return json.result as T
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

// ── Multicall3 ───────────────────────────────────────────────────────────────

type Call = { target: `0x${string}`; allowFailure: boolean; callData: `0x${string}` }

/** One `aggregate3` round-trip. Individual failures come back as success:false. */
async function aggregate3(chainId: string, calls: Call[]): Promise<Array<{ success: boolean; returnData: `0x${string}` }>> {
  const data = encodeFunctionData({ abi: MULTICALL_ABI, functionName: 'aggregate3', args: [calls] })
  const raw = await publicRpc<`0x${string}`>(chainId, 'eth_call', [{ to: MULTICALL3, data }, 'latest'], 20_000)
  return decodeFunctionResult({ abi: MULTICALL_ABI, functionName: 'aggregate3', data: raw }) as Array<{ success: boolean; returnData: `0x${string}` }>
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

/** Non-zero `balanceOf` for each contract, via as few `eth_call`s as possible. */
async function readBalances(chainId: string, owner: string, contracts: string[]): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>()
  const callData = encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [owner as `0x${string}`] })
  for (const part of chunk(contracts, MULTICALL_CHUNK)) {
    const results = await aggregate3(chainId, part.map(c => ({
      target: c as `0x${string}`, allowFailure: true, callData,
    })))
    results.forEach((r, i) => {
      if (!r.success || !r.returnData || r.returnData === '0x') return
      try {
        const v = decodeFunctionResult({ abi: ERC20_ABI, functionName: 'balanceOf', data: r.returnData }) as bigint
        if (v > 0n) out.set(part[i].toLowerCase(), v)
      } catch { /* not an ERC-20, or a malformed return — skip */ }
    })
  }
  return out
}

/**
 * name/symbol/decimals for contracts we hold but have never resolved. Read
 * on-chain rather than from an indexer, which is what makes this tier
 * self-sufficient — and the results feed the shared metadata cache, so the
 * lookup is never repeated on any tier.
 */
async function readMetadata(chainId: string, contracts: string[]): Promise<Map<string, TokenMetaCacheEntry>> {
  const out = new Map<string, TokenMetaCacheEntry>()
  const sym = encodeFunctionData({ abi: ERC20_ABI, functionName: 'symbol' })
  const nam = encodeFunctionData({ abi: ERC20_ABI, functionName: 'name' })
  const dec = encodeFunctionData({ abi: ERC20_ABI, functionName: 'decimals' })
  // Three reads per contract, so a third of the usual chunk keeps the payload even.
  for (const part of chunk(contracts, Math.floor(MULTICALL_CHUNK / 3))) {
    const calls: Call[] = []
    for (const c of part) {
      calls.push({ target: c as `0x${string}`, allowFailure: true, callData: sym })
      calls.push({ target: c as `0x${string}`, allowFailure: true, callData: nam })
      calls.push({ target: c as `0x${string}`, allowFailure: true, callData: dec })
    }
    const results = await aggregate3(chainId, calls)
    const at = Date.now()
    part.forEach((c, i) => {
      const decode = <T,>(idx: number, fn: 'symbol' | 'name' | 'decimals'): T | null => {
        const r = results[i * 3 + idx]
        if (!r?.success || !r.returnData || r.returnData === '0x') return null
        try { return decodeFunctionResult({ abi: ERC20_ABI, functionName: fn, data: r.returnData }) as T } catch { return null }
      }
      const symbol = decode<string>(0, 'symbol')
      if (!symbol) return   // no symbol = not a token we can render
      // `Transfer(address,address,uint256)` is the SAME event signature for
      // ERC-20 and ERC-721, so the log sweep unavoidably turns up NFT
      // contracts. `decimals()` is the discriminator: ERC-20 requires it,
      // ERC-721 has no such function and the call returns empty. Without this
      // check NFTs were admitted with a defaulted 18 decimals, which rendered
      // "1 NFT held" as a 0.000000000000000001 token balance.
      const decimals = decode<number>(2, 'decimals')
      if (decimals == null) return
      out.set(c.toLowerCase(), {
        name: decode<string>(1, 'name') ?? 'Unknown Token',
        symbol,
        decimals: Number(decimals),
        logo: null,
        at,
      })
    })
  }
  return out
}

// ── Transfer-log discovery ───────────────────────────────────────────────────

interface RawLog { address: string }

/**
 * Sweep BACKWARD from the chain tip for incoming Transfers, adding every token
 * contract seen to the candidate set. Backward on purpose: the tokens a user
 * cares about are usually recent, so the first pass is the useful one and older
 * history fills in over later launches instead of gating the first render.
 *
 * Returns the contracts known so far (cached + newly found). Budgeted per pass
 * and resumable — the cursor is persisted even if the pass is cut short.
 */
async function discoverContracts(
  chainId: string,
  address: string,
  cache: Record<string, OnchainScanCacheEntry>
): Promise<string[]> {
  const key = `${chainId}:${address.toLowerCase()}`
  const entry: OnchainScanCacheEntry = cache[key] ?? { contracts: [], scannedDownTo: 0, scannedUpTo: 0, at: 0 }
  const found = new Set(entry.contracts)

  if (!(chainId in LOG_SCAN_RANGE)) return [...found]
  const range = LOG_SCAN_RANGE[chainId]
  const padded = `0x${address.toLowerCase().replace('0x', '').padStart(64, '0')}`
  const topics = [TRANSFER_TOPIC, null, padded]

  let height: number
  try {
    height = parseInt(await publicRpc<string>(chainId, 'eth_blockNumber', []), 16)
  } catch {
    return [...found]
  }

  const sweep = async (from: number, to: number): Promise<boolean> => {
    try {
      const logs = await publicRpc<RawLog[]>(chainId, 'eth_getLogs', [{
        fromBlock: `0x${Math.max(0, from).toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
        topics,
      }], 25_000)
      for (const l of logs ?? []) if (l.address) found.add(l.address.toLowerCase())
      return true
    } catch {
      return false
    }
  }

  if (range === null) {
    // One request covers everything this chain has ever done.
    if (await sweep(0, height)) {
      entry.scannedDownTo = 0
      entry.scannedUpTo = height
    }
  } else {
    // Blocks added since the last pass, then continue walking backward.
    if (entry.scannedUpTo > 0 && height > entry.scannedUpTo) {
      for (let from = entry.scannedUpTo + 1; from <= height; from += range) {
        if (!await sweep(from, Math.min(from + range - 1, height))) break
      }
      entry.scannedUpTo = height
    }
    let cursor = entry.scannedUpTo === 0 ? height : (entry.scannedDownTo || height)
    if (entry.scannedUpTo === 0) entry.scannedUpTo = height
    let budget = SCAN_REQUESTS_PER_PASS
    while (cursor > 0 && budget-- > 0) {
      const from = Math.max(0, cursor - range + 1)
      if (!await sweep(from, cursor)) break
      cursor = from - 1
      entry.scannedDownTo = Math.max(0, from)
    }
    if (cursor <= 0) entry.scannedDownTo = 0
  }

  entry.contracts = [...found]
  entry.at = Date.now()
  cache[key] = entry
  return entry.contracts
}

// ── the tier ─────────────────────────────────────────────────────────────────

export interface OnchainToken {
  contractAddress: string
  name: string
  symbol: string
  decimals: number
  rawBalance: string
}

/**
 * Every ERC-20 this address holds on `chainId` that we can find without an
 * indexer. `undefined` = the tier itself could not run (no public RPC, no
 * Multicall3 answer) — distinct from `[]`, which means "genuinely holds none of
 * the contracts we know to ask about".
 */
export async function fetchOnchainTokens(
  chainId: string,
  address: string,
  config: WalletConfig
): Promise<OnchainToken[] | undefined> {
  if (!PUBLIC_RPCS[chainId]?.length) return undefined
  try {
    const [metaDisk, balDisk, scanDisk] = await Promise.all([
      loadTokenMetaCache().catch(() => ({} as Record<string, TokenMetaCacheEntry>)),
      loadTokenBalanceCache().catch(() => ({})),
      loadOnchainScanCache().catch(() => ({} as Record<string, OnchainScanCacheEntry>)),
    ])

    const candidates = new Set<string>()
    // 1. Anything this wallet has ever been seen holding, on any tier.
    for (const k of Object.keys(metaDisk)) {
      const [net, contract] = k.split(':')
      if (net === chainId && contract) candidates.add(contract)
    }
    for (const [k, v] of Object.entries(balDisk)) {
      if (!k.startsWith(`${chainId}:`)) continue
      for (const b of v?.balances ?? []) candidates.add(b.contractAddress.toLowerCase())
    }
    // 2. Explicit user imports — they asked for these by name.
    for (const t of config.customTokens ?? []) {
      if (t.chain === chainId) candidates.add(t.contractAddress.toLowerCase())
    }
    // 3. Majors, so a first-ever USDC balance still shows during an outage.
    for (const m of MAJOR_TOKENS[chainId] ?? []) candidates.add(m.toLowerCase())
    // 4. The log sweep, where the chain's RPC makes it affordable.
    for (const c of await discoverContracts(chainId, address, scanDisk)) candidates.add(c)
    try { saveOnchainScanCache(scanDisk) } catch { /* best-effort */ }

    if (candidates.size === 0) return []

    const held = await readBalances(chainId, address, [...candidates])
    if (held.size === 0) return []

    // Resolve names for anything we hold but have never named.
    const unknown = [...held.keys()].filter(c => !metaDisk[`${chainId}:${c}`]?.symbol)
    if (unknown.length) {
      const fresh = await readMetadata(chainId, unknown)
      for (const [c, m] of fresh) metaDisk[`${chainId}:${c}`] = m
      if (fresh.size) { try { saveTokenMetaCache(metaDisk) } catch { /* best-effort */ } }
    }

    const out: OnchainToken[] = []
    for (const [contract, raw] of held) {
      const meta = metaDisk[`${chainId}:${contract}`]
      if (!meta?.symbol) continue   // unnameable — same rule as every other tier
      out.push({
        contractAddress: contract,
        name: meta.name || 'Unknown Token',
        symbol: meta.symbol,
        decimals: meta.decimals,
        rawBalance: raw.toString(),
      })
    }
    console.log(`[TOKEN] ${chainId} on-chain tier: ${candidates.size} candidates → ${out.length} held`)
    return out
  } catch (e) {
    console.warn(`[TOKEN] ${chainId} on-chain tier failed: ${String(e)}`)
    return undefined
  }
}
