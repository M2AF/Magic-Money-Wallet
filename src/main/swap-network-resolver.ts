/**
 * swap-network-resolver.ts — which networks the swap UI may offer, decided in the
 * privileged layer by joining the wallet's REGISTRY with measured CAPABILITY.
 *
 * WHY A JOIN AND NOT A LIST
 *
 * The renderer used to carry `DEX_CHAINS`, nine chains typed out by hand. It had
 * drifted in both directions: it offered `bsc`, which this wallet has no network
 * for at all, and it omitted eleven chains the Networks tab shows and the
 * providers do route — Robinhood Chain, Arc, Abstract, HyperEVM among them. A
 * hand-kept list beside another hand-kept list is a list that will disagree.
 *
 * So identity comes from `chain-config.ts` (the same registry the Networks tab
 * uses) and capability from `swap-networks.ts` (measured, dated), and they are
 * joined here by CHAIN ID. Neither file restates the other.
 *
 * IMPORTED NETWORKS
 *
 * A custom network is matched to capability by its chain id, and that id is
 * confirmed against the RPC the user imported before it counts. Matching on the
 * imported NAME would let "Arc" point anywhere; matching on an unverified
 * declared id would let a network claim to be a chain it is not, and providers
 * would then be asked to quote for the wrong chain. A custom network that
 * cannot be verified, or that matches nothing, stays fully usable everywhere
 * else in the wallet — it simply says why swaps are unavailable.
 *
 * Capability for an import is resolved DYNAMICALLY, against the chains our
 * providers actually route (`/swap/chains`) and against the wallet's own
 * executor. It used to be resolved against the static matrix alone, which was
 * an architectural dead end: the registry forbids an import from sharing a
 * built-in's chain id, and every matrix entry IS a built-in, so no import could
 * ever match one however well supported the chain was.
 *
 * PROVIDER-AGGREGATED (2026-09-21): the dynamic fallback used to consult LI.FI
 * and Relay alone, which made those two the new permanent boundary in their
 * place. It now consults every provider the Worker has an execution adapter
 * for (0x, 1inch, Uniswap, Rango, SwapKit too), so a chain routed only by one
 * of those can still qualify. Same-chain and cross-chain are kept distinct —
 * 0x/1inch/Uniswap never do cross-chain, SwapKit/Relay are not queried
 * same-chain here — see `SAME_CHAIN_EVM_PROVIDERS` / `CROSS_CHAIN_EVM_PROVIDERS`
 * in swap-proxy.ts, which mirror the Worker's own routing table exactly.
 *
 * Four things must hold before an import becomes swap-eligible:
 *   1. IDENTITY  — its RPC confirms the chain id it claims;
 *   2. PROVIDER  — a provider we have an execution adapter for routes that id;
 *   3. SIGNING   — the executor can build and sign for it (`customEvmSenders`);
 *   4. TRACKING  — settlement for it runs through the same session store.
 * Gas and simulation are inherited from the EVM path, which is the same code a
 * built-in uses once (3) holds.
 *
 * The user's RPC URL is never sent to the backend. The wallet calls it directly
 * to confirm the chain id; the backend is only asked which chains the PROVIDERS
 * support.
 *
 * Testnet/mainnet separation is inherited, not re-implemented: `activeEvmChains`
 * returns the testnet set in Testnet Mode, and testnet ids match no capability
 * entry, so swaps are unavailable there for a stated reason.
 */

import { activeEvmChains, isTestnet, customChainDefs } from './chain-config'
import { customEvmSenders } from './tx-sender'
import {
  getSwapProviderChains, unionOfExecutableChains, providersForChainId,
  SAME_CHAIN_EVM_PROVIDERS, CROSS_CHAIN_EVM_PROVIDERS,
} from './swap-proxy'
import type { WalletConfig } from './secure-store'
import {
  swapCapability, capabilityForChainId, type SwapNetworkOption,
} from '../shared/swap-networks'
export type { SwapNetworkOption }

const SOLANA_OPTION: SwapNetworkOption = {
  id: 'solana', label: 'Solana', chainId: null, color: '#14F195',
  source: true, destination: true, reason: null, status: 'verified', isCustom: false,
}

/**
 * Confirm an imported network really is the chain it claims to be.
 *
 * `eth_chainId` is asked of the user's own RPC URL. A mismatch means the import
 * is wrong or the endpoint moved; either way the declared id must not be used to
 * pick a provider. Cached per URL for the process lifetime because this runs on
 * every picker open.
 */
const verifiedCustomIds = new Map<string, number | null>()

export async function verifyCustomChainId(
  rpcUrl: string, declared: number, fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (verifiedCustomIds.has(rpcUrl)) return verifiedCustomIds.get(rpcUrl) === declared
  let seen: number | null = null
  try {
    const res = await fetchImpl(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(6000),
    })
    const body = await res.json() as { result?: string }
    if (typeof body?.result === 'string') {
      const parsed = Number.parseInt(body.result, 16)
      if (Number.isFinite(parsed)) seen = parsed
    }
  } catch {
    seen = null
  }
  verifiedCustomIds.set(rpcUrl, seen)
  return seen === declared
}

/** Test seam. */
export function __clearCustomChainIdCache(): void { verifiedCustomIds.clear() }

/**
 * The networks the swap picker may show, with a reason for every exclusion.
 *
 * Built-in chains are trusted from the registry. Imported ones additionally have
 * their chain id confirmed against their own RPC before any capability applies.
 */
export async function resolveSwapNetworks(
  config: WalletConfig, fetchImpl: typeof fetch = fetch,
): Promise<SwapNetworkOption[]> {
  const testnet = isTestnet(config)
  const customIds = new Set(customChainDefs(config).map(c => c.chainId).filter((n): n is number => n != null))
  const out: SwapNetworkOption[] = []

  // Provider coverage, only fetched when there is an import that might need it.
  const hasCustom = !testnet && customIds.size > 0
  const providerChains = hasCustom
    ? await getSwapProviderChains(config)
    : { version: 2, builtAt: 0, providers: {}, lifi: [] as number[], relay: [] as number[], fetchedAt: 0, stale: true }
  // Only providers we can actually EXECUTE count, across ALL of them — not only
  // LI.FI and Relay. A chain listed by a provider with no execution adapter is
  // discoverable, not swappable.
  const executable = new Set<number>(unionOfExecutableChains(providerChains))
  const signerChains = hasCustom
    ? new Set(Object.values(customEvmSenders(config)).map(e => e.chain.id))
    : new Set<number>()

  for (const chain of activeEvmChains(config)) {
    // `ChainDef.chainId` is optional across the registry's chain types. An EVM
    // entry without one cannot be matched to a provider by identity at all.
    const cid = chain.chainId
    if (cid == null) continue
    const isCustom = customIds.has(cid)
    const base = {
      id: chain.id, label: chain.name, chainId: cid,
      color: chain.color, isCustom,
    }

    if (testnet) {
      out.push({
        ...base, source: false, destination: false, status: 'unsupported',
        reason: 'Swap providers quote mainnet routes only, so swaps are unavailable in Testnet Mode.',
      })
      continue
    }

    // Built-ins resolve by their registry id; imports must prove their id first.
    let capability = isCustom ? null : swapCapability(chain.id)
    if (isCustom) {
      const ok = await verifyCustomChainId(chain.rpcUrl(config), cid, fetchImpl)
      if (!ok) {
        out.push({
          ...base, source: false, destination: false, status: 'unsupported',
          reason:
            `Swaps are unavailable on ${chain.name} because its RPC did not confirm chain id `
            + `${cid}. Everything else on this network still works.`,
        })
        continue
      }
      capability = capabilityForChainId(cid)

      // No static entry — which is the normal case for an import, since the
      // matrix only ever describes built-ins. Fall back to live provider
      // coverage plus the wallet's own signing capability.
      if (!capability) {
        const routed = executable.has(cid)
        const signable = signerChains.has(cid)
        if (routed && signable) {
          const allProviders = providersForChainId(providerChains, cid)
          const sameChainProviders = allProviders.filter(p => (SAME_CHAIN_EVM_PROVIDERS as readonly string[]).includes(p))
          const crossChainProviders = allProviders.filter(p => (CROSS_CHAIN_EVM_PROVIDERS as readonly string[]).includes(p))
          capability = {
            id: chain.id, chainId: cid, signing: 'evm-eoa',
            sameChain: sameChainProviders,
            crossChainSource: crossChainProviders,
            crossChainDestination: crossChainProviders,
            discovery: true,
            // Listed and signable is not the same as a measured pair, and it is
            // not claimed to be.
            status: 'implemented-unverified',
            reason: null,
            evidence: `imported network: chain id ${cid} confirmed by its own RPC; routed same-chain by `
              + `${sameChainProviders.join(' + ') || 'none'}, cross-chain by `
              + `${crossChainProviders.join(' + ') || 'none'} (provider evidence built `
              + `${new Date(providerChains.builtAt || providerChains.fetchedAt).toISOString()}`
              + `${providerChains.stale ? ', STALE' : ''})`,
          }
        } else {
          out.push({
            ...base, source: false, destination: false, status: 'unsupported',
            reason: !signable
              ? `Swaps are unavailable on ${chain.name}: this wallet cannot build transactions for chain `
                + `${cid}. Everything else on this network still works.`
              : `Swaps are unavailable on ${chain.name}: no swap provider we can execute routes chain ${cid}. `
                + 'Everything else on this network still works.',
          })
          continue
        }
      }
    }

    if (!capability) {
      out.push({
        ...base, source: false, destination: false, status: 'unsupported',
        reason: isCustom
          ? `No swap provider configured here routes chain ${cid}, so swaps are unavailable on `
            + `${chain.name}. Everything else on this network still works.`
          : `Swaps are not enabled on ${chain.name} yet.`,
      })
      continue
    }

    out.push({
      ...base,
      source: capability.sameChain.length > 0 || capability.crossChainSource.length > 0,
      destination: capability.sameChain.length > 0 || capability.crossChainDestination.length > 0,
      reason: capability.reason,
      status: capability.status,
    })
  }

  // Solana is not in the EVM registry and has no chain id to join on.
  if (!testnet) out.push(SOLANA_OPTION)

  // Cardano likewise: capability comes from the matrix, same-chain only. It is
  // left out of Testnet Mode because the Minswap aggregator quotes mainnet only.
  const cardano = swapCapability('cardano')
  if (!testnet && cardano && cardano.status !== 'blocked' && cardano.sameChain.length > 0) {
    out.push({
      id: 'cardano', label: 'Cardano', chainId: null, color: '#2A7DEA',
      source: true, destination: true,
      reason: cardano.reason, status: cardano.status, isCustom: false,
      sameChainOnly: cardano.crossChainSource.length === 0 && cardano.crossChainDestination.length === 0,
    })
  }
  return out
}
