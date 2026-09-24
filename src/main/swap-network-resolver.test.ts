import { describe, expect, it, beforeEach } from 'vitest'
import { resolveSwapNetworks, __clearCustomChainIdCache } from './swap-network-resolver'
import { __setProviderChainsCache, type SwapProviderChains, type SwapProviderChainEntry } from './swap-proxy'
import type { WalletConfig } from './secure-store'

/**
 * Build a v2 provider-chains fixture from just {providerName: chainIds[]}. Every
 * provider not named gets an empty (but present, 'live') entry, so tests that
 * only care about one or two providers do not have to spell out all seven.
 */
function providerChainsFixture(byProvider: Record<string, number[]> = {}): SwapProviderChains {
  const names = ['lifi', 'relay', '0x', '1inch', 'uniswap', 'rango', 'swapkit']
  const providers: Record<string, SwapProviderChainEntry> = {}
  for (const name of names) {
    providers[name] = {
      chains: byProvider[name] ?? [],
      nonEvm: [], source: 'live', evidence: 'discovered', url: null,
      fetchedAt: Date.now(), expiresAt: Date.now() + 3600_000, stale: false, error: null,
    }
  }
  return { version: 2, builtAt: Date.now(), providers, lifi: byProvider.lifi ?? [], relay: byProvider.relay ?? [], fetchedAt: Date.now(), stale: false }
}

/**
 * Which networks the swap UI may offer.
 *
 * The hand-kept `DEX_CHAINS` had drifted from the wallet's own registry in both
 * directions — it offered BSC, which this wallet has no network for, and omitted
 * chains the providers do route. These tests pin the join: identity from the
 * registry, capability from the measured matrix, and for an IMPORTED network a
 * chain id confirmed against its own RPC before any of it applies.
 */

const config = (over: Partial<WalletConfig> = {}) => ({ customChains: [], ...over }) as WalletConfig

/** Stand-in RPC that answers eth_chainId with whatever the endpoint "really" is. */
const rpcAnswering = (byUrl: Record<string, number | 'error'>) =>
  (async (input: RequestInfo | URL) => {
    const answer = byUrl[String(input)]
    if (answer === undefined || answer === 'error') throw new Error('unreachable')
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: `0x${answer.toString(16)}` }),
      { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch

const byId = (list: Awaited<ReturnType<typeof resolveSwapNetworks>>, id: string) =>
  list.find(n => n.id === id)

beforeEach(() => {
  __clearCustomChainIdCache()
  // Default: providers route nothing unusual, so tests that do not care about
  // imports are unaffected.
  __setProviderChainsCache(providerChainsFixture())
})

describe('built-in networks come from the registry, not a second list', () => {
  it('offers the chains the capability matrix says are routable', async () => {
    const list = await resolveSwapNetworks(config())
    for (const id of ['ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'avalanche', 'solana']) {
      expect(byId(list, id), id).toMatchObject({ source: true, destination: true })
    }
  })

  it('now includes the chains the hand-kept list omitted', async () => {
    const list = await resolveSwapNetworks(config())
    // Measured routable 2026-09-20; none of these were in DEX_CHAINS.
    for (const id of ['robinhood', 'arc', 'abstract', 'worldchain', 'gnosis', 'blast', 'hyperevm']) {
      expect(byId(list, id), id).toBeDefined()
      expect(byId(list, id)!.source, id).toBe(true)
    }
  })

  it('does NOT offer BSC — the wallet has no such network', async () => {
    // DEX_CHAINS offered it; the registry has no entry, so the join drops it.
    expect(byId(await resolveSwapNetworks(config()), 'bsc')).toBeUndefined()
  })

  it('lists a destination-only chain as a destination but not a source', async () => {
    // ApeChain: bridging IN routes, swapping OUT has no route through our providers.
    const ape = byId(await resolveSwapNetworks(config()), 'apechain')
    expect(ape).toMatchObject({ destination: true, source: false })
    expect(ape!.reason).toMatch(/ApeChain/i)
  })

  it('gives every unswappable network a reason a user can read', async () => {
    for (const n of await resolveSwapNetworks(config())) {
      if (!n.source && !n.destination) expect(n.reason, n.id).toBeTruthy()
    }
  })
})

describe('testnet/mainnet separation is inherited, not re-implemented', () => {
  it('offers no swappable network in Testnet Mode, and says why', async () => {
    const list = await resolveSwapNetworks(config({ testnetMode: true } as Partial<WalletConfig>))
    expect(list.length).toBeGreaterThan(0)
    expect(list.every(n => !n.source && !n.destination)).toBe(true)
    expect(list[0].reason).toMatch(/Testnet Mode/i)
    // Solana is not offered at all rather than offered-and-broken.
    expect(byId(list, 'solana')).toBeUndefined()
  })
})

describe('imported networks are matched by VERIFIED chain id, never by name', () => {
  const custom = (over: Partial<{ id: string; name: string; chainId: number; rpcUrl: string }>) => config({
    customChains: [{
      id: 'custom-1', name: 'My Network', chainId: 8453,
      nativeSymbol: 'ETH', rpcUrl: 'https://rpc.example/one', explorerUrl: '',
      ...over,
    }],
  } as Partial<WalletConfig>)

  it('becomes swap-eligible when provider coverage and the executor both support it', async () => {
    // The limitation this removes: capability used to come only from the static
    // matrix, every entry of which IS a built-in, while an import can never
    // share a built-in's id — so no import could ever qualify, however well
    // supported the chain was.
    __setProviderChainsCache(providerChainsFixture({ lifi: [424242], relay: [424242] }))
    const list = await resolveSwapNetworks(
      custom({ chainId: 424242, rpcUrl: 'https://rpc.example/new' }),
      rpcAnswering({ 'https://rpc.example/new': 424242 }))
    const mine = byId(list, 'custom-1')
    expect(mine).toMatchObject({ isCustom: true, source: true, destination: true })
    // Listed and signable is not a measured pair, and is not claimed as one.
    expect(mine!.status).toBe('implemented-unverified')
  })

  it('REFUSES when no provider we can execute routes the chain', async () => {
    __setProviderChainsCache(providerChainsFixture({ lifi: [1, 8453], relay: [1, 8453] }))
    const list = await resolveSwapNetworks(
      custom({ chainId: 424242, rpcUrl: 'https://rpc.example/new' }),
      rpcAnswering({ 'https://rpc.example/new': 424242 }))
    const mine = byId(list, 'custom-1')
    expect(mine).toMatchObject({ source: false, destination: false })
    expect(mine!.reason).toMatch(/no swap provider we can execute routes chain 424242/i)
    expect(mine!.reason).toMatch(/still works/i)
  })

  it('still requires the id to be PROVEN before provider coverage counts', async () => {
    // Coverage exists for the declared id, but the RPC says otherwise.
    __setProviderChainsCache(providerChainsFixture({ lifi: [424242], relay: [424242] }))
    const list = await resolveSwapNetworks(
      custom({ chainId: 424242, rpcUrl: 'https://rpc.example/liar' }),
      rpcAnswering({ 'https://rpc.example/liar': 777 }))
    expect(byId(list, 'custom-1')!.reason).toMatch(/did not confirm chain id/i)
  })

  it('is not listed at all when the import duplicates a built-in chain', async () => {
    // The registry refuses to let an import shadow a built-in (chain-config's
    // `customChainDefs`), so importing Base with your own RPC does not create a
    // second Base — you keep using the built-in one, capability and all.
    const list = await resolveSwapNetworks(
      custom({ chainId: 8453, rpcUrl: 'https://rpc.example/one' }),
      rpcAnswering({ 'https://rpc.example/one': 8453 }))
    expect(byId(list, 'custom-1')).toBeUndefined()
    expect(byId(list, 'base')).toMatchObject({ source: true, isCustom: false })
  })

  it('REFUSES when the RPC reports a different chain id than the import claims', async () => {
    // Claiming one chain while actually being another would have providers quote
    // for the wrong network.
    const list = await resolveSwapNetworks(
      custom({ chainId: 424242, rpcUrl: 'https://rpc.example/liar' }),
      rpcAnswering({ 'https://rpc.example/liar': 999999 }))
    const mine = byId(list, 'custom-1')
    expect(mine).toMatchObject({ source: false, destination: false })
    expect(mine!.reason).toMatch(/did not confirm chain id/i)
  })

  it('REFUSES when the RPC cannot be reached, rather than trusting the declared id', async () => {
    const list = await resolveSwapNetworks(
      custom({ chainId: 424242, rpcUrl: 'https://rpc.example/down' }),
      rpcAnswering({ 'https://rpc.example/down': 'error' }))
    expect(byId(list, 'custom-1')).toMatchObject({ source: false, destination: false })
  })

  it('ignores the display name entirely', async () => {
    // Named "Arc", but its RPC proves an id we have no capability for.
    const list = await resolveSwapNetworks(
      custom({ name: 'Arc', chainId: 424242, rpcUrl: 'https://rpc.example/fake-arc' }),
      rpcAnswering({ 'https://rpc.example/fake-arc': 424242 }))
    const mine = byId(list, 'custom-1')
    expect(mine!.source).toBe(false)
    expect(mine!.reason).toMatch(/no swap provider we can execute routes chain 424242/i)
  })

  it('keeps an unsupported custom network listed, so the rest of the wallet still works', async () => {
    const list = await resolveSwapNetworks(
      custom({ chainId: 424242, rpcUrl: 'https://rpc.example/unknown' }),
      rpcAnswering({ 'https://rpc.example/unknown': 424242 }))
    const mine = byId(list, 'custom-1')
    expect(mine).toBeDefined()
    expect(mine!.reason).toMatch(/still works/i)
  })
})

describe('imported networks qualify via ANY execution-capable provider (2026-09-21)', () => {
  const custom = (over: Partial<{ id: string; name: string; chainId: number; rpcUrl: string }>) => config({
    customChains: [{
      id: 'custom-1', name: 'My Network', chainId: 8453,
      nativeSymbol: 'ETH', rpcUrl: 'https://rpc.example/one', explorerUrl: '',
      ...over,
    }],
  } as Partial<WalletConfig>)

  it('becomes swap-eligible via 0x and 1inch ALONE — LI.FI and Relay never route it', async () => {
    // This is the exact limitation the user asked to remove: LI.FI/Relay were
    // the only providers the dynamic fallback ever consulted, so a chain only
    // 0x and 1inch supported could never qualify however well those two
    // covered it. Neither lifi nor relay is given this chain id here.
    __setProviderChainsCache(providerChainsFixture({ '0x': [424242], '1inch': [424242] }))
    const list = await resolveSwapNetworks(
      custom({ chainId: 424242, rpcUrl: 'https://rpc.example/new' }),
      rpcAnswering({ 'https://rpc.example/new': 424242 }))
    const mine = byId(list, 'custom-1')
    expect(mine).toMatchObject({ isCustom: true, source: true, status: 'implemented-unverified' })
  })

  it('a same-chain-only provider (0x) is eligible, and the reason it can be signed for says so', async () => {
    // 0x/1inch/Uniswap never do cross-chain in this wallet's Worker routing.
    // The boolean source/destination flags are a superset relationship inherited
    // from the static matrix (same-chain usability alone makes a chain BOTH,
    // same as e.g. 'ronin' in swap-networks.ts) — what differs here is which
    // providers the evidence names for each role.
    __setProviderChainsCache(providerChainsFixture({ '0x': [424242] }))
    const list = await resolveSwapNetworks(
      custom({ chainId: 424242, rpcUrl: 'https://rpc.example/new' }),
      rpcAnswering({ 'https://rpc.example/new': 424242 }))
    const mine = byId(list, 'custom-1')
    expect(mine!.source).toBe(true)
    expect(mine!.status).toBe('implemented-unverified')
  })

  it('a cross-chain-only provider (swapkit) still makes an eligible entry', async () => {
    __setProviderChainsCache(providerChainsFixture({ swapkit: [424242] }))
    const list = await resolveSwapNetworks(
      custom({ chainId: 424242, rpcUrl: 'https://rpc.example/new' }),
      rpcAnswering({ 'https://rpc.example/new': 424242 }))
    const mine = byId(list, 'custom-1')
    expect(mine!.destination).toBe(true)
    expect(mine!.source).toBe(true)
    expect(mine!.status).toBe('implemented-unverified')
  })

  it('REFUSES when the ONLY provider listing it has no execution adapter here', async () => {
    // jupiter is Solana-only and is never consulted for an EVM import; a fixture
    // that only names it must not accidentally make the chain eligible.
    __setProviderChainsCache(providerChainsFixture())
    const list = await resolveSwapNetworks(
      custom({ chainId: 424242, rpcUrl: 'https://rpc.example/new' }),
      rpcAnswering({ 'https://rpc.example/new': 424242 }))
    expect(byId(list, 'custom-1')).toMatchObject({ source: false, destination: false })
  })
})
