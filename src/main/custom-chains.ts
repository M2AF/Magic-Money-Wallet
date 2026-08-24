/**
 * custom-chains.ts — shared logic for user-added EVM networks.
 *
 * Store access differs per target (Electron's sync secure-store, the
 * extension's async chrome.storage, Capacitor's Preferences), but the RULES
 * must not: the same validation, the same RPC chain-id probe, the same
 * duplicate checks, the same error strings. Everything platform-agnostic lives
 * here so Electron / extension / Android can't drift apart — a mismatch would
 * mean a network that validates on desktop and silently misbehaves on mobile.
 *
 * The fetchers (balance-fetcher, token-fetcher, tx-sender) already take config
 * as a parameter, so they need no per-target work: once these entries are in
 * config.customChains the assets and sends follow on every target.
 */
import type { CustomChain, CustomToken, CustomNft } from './secure-store'
import { EVM_CHAINS } from './chain-config'

export interface CustomChainInput {
  name: string
  chainId: number | string
  nativeSymbol: string
  rpcUrl: string
  explorerUrl?: string
}

/** The subset of config these helpers read — keeps them store-agnostic. */
export interface CustomAssetConfig {
  customChains?: CustomChain[]
  customTokens?: CustomToken[]
  customNfts?: CustomNft[]
  testnetMode?: boolean
}

export function normalizeContractAddress(value: unknown): string {
  const addr = String(value ?? '').trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(addr)) throw new Error('Enter a valid contract address (0x…)')
  return addr
}

export function normalizeTokenId(value: unknown): string {
  const id = String(value ?? '').trim()
  if (!/^[0-9]{1,78}$/.test(id)) throw new Error('Token ID must be a whole number')
  return id
}

/**
 * Ask the RPC which chain it actually serves. A mismatch against the typed id
 * is fatal: every later send would be signed for the wrong chain.
 */
export async function probeChainId(rpcUrl: string): Promise<number> {
  let reported: number
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
      signal: AbortSignal.timeout(10_000)
    })
    const json = await res.json() as { result?: string }
    reported = parseInt(json.result ?? '', 16)
  } catch {
    throw new Error('Could not reach the RPC URL — check the address and your connection')
  }
  if (!Number.isInteger(reported)) throw new Error('The RPC did not answer like an EVM node (eth_chainId failed)')
  return reported
}

/**
 * Validate a manual "Add a Network" submission and return the entry to persist.
 * Throws a user-facing message on any problem; never touches the store.
 */
export async function buildCustomChain(
  input: CustomChainInput,
  existing: CustomChain[] = []
): Promise<CustomChain> {
  const name = String(input?.name ?? '').trim()
  const nativeSymbol = String(input?.nativeSymbol ?? '').trim().toUpperCase()
  const rpcUrl = String(input?.rpcUrl ?? '').trim()
  // Store the explorer ORIGIN (drop a trailing /tx a user might paste, plus any
  // trailing slashes): chain-config appends '/tx' for links and '/api/v2' for
  // the Blockscout token/NFT probes.
  const explorerUrl = String(input?.explorerUrl ?? '').trim()
    .replace(/\/+$/, '').replace(/\/tx$/i, '').replace(/\/+$/, '')
  const chainId = Number(input?.chainId)

  if (!name) throw new Error('Enter a network name')
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('Chain ID must be a positive whole number')
  if (!/^https?:\/\/.+/.test(rpcUrl)) throw new Error('RPC URL must start with http:// or https://')
  if (!nativeSymbol || nativeSymbol.length > 12) throw new Error('Enter a currency symbol (e.g. MON)')
  if (explorerUrl && !/^https?:\/\/.+/.test(explorerUrl)) throw new Error('Block explorer must be a http(s) URL')

  if (EVM_CHAINS.some(c => c.chainId === chainId)) {
    throw new Error(`Chain ID ${chainId} is already supported natively`)
  }
  if (existing.some(c => c.chainId === chainId)) {
    throw new Error(`A custom network with chain ID ${chainId} already exists`)
  }

  const reported = await probeChainId(rpcUrl)
  if (reported !== chainId) {
    throw new Error(`The RPC reports chain ID ${reported}, not ${chainId} — double-check both fields`)
  }

  return { id: `custom-${chainId}`, name, chainId, nativeSymbol, rpcUrl, explorerUrl }
}

/**
 * Config patch for removing a network: its imported tokens and NFTs go too, or
 * they linger as orphans no chain can resolve (and would reappear if the same
 * network were added again).
 */
export function chainRemovalPatch(config: CustomAssetConfig, id: string): {
  customChains: CustomChain[]
  customTokens: CustomToken[]
  customNfts: CustomNft[]
} {
  const chainId = String(id)
  return {
    customChains: (config.customChains ?? []).filter(c => c.id !== chainId),
    customTokens: (config.customTokens ?? []).filter(t => t.chain !== chainId),
    customNfts: (config.customNfts ?? []).filter(n => n.chain !== chainId)
  }
}

/**
 * Every EVM network an asset can be imported on: the built-in chains plus the
 * user-added ones. Import was custom-network-only at first — the built-ins are
 * auto-detected, so it read as redundant — but auto-detection is provider-driven
 * and misses plenty (fresh deploys, thin-liquidity ERC-20s, NFTs the indexer
 * hasn't picked up). A manual import is the fallback on ANY EVM network now.
 */
export function importableChainIds(config: CustomAssetConfig): Set<string> {
  return new Set([
    ...EVM_CHAINS.map(c => c.id),
    ...(config.customChains ?? []).map(c => c.id),
  ])
}

/**
 * Shared front half of both import guards.
 *
 * The Testnet Mode check is not cosmetic: chain-config's testnet defs reuse the
 * SAME chain ids as mainnet ('ethereum' is Sepolia in Testnet Mode), and a
 * stored import records only that id — so a token imported on Sepolia would
 * resurface on mainnet Ethereum as a bogus holding. The UI hides the button in
 * Testnet Mode; this is the matching backend guard.
 */
function assertImportableChain(config: CustomAssetConfig, chain: string): void {
  if (config.testnetMode) throw new Error('Turn off Testnet Mode to import an asset')
  if (!importableChainIds(config).has(chain)) throw new Error('Unknown network')
}

/** Guard a token import: known network, not already imported. */
export function assertTokenImportable(config: CustomAssetConfig, chain: string, contractAddress: string): void {
  assertImportableChain(config, chain)
  if ((config.customTokens ?? []).some(t => t.chain === chain && t.contractAddress === contractAddress)) {
    throw new Error('That token is already imported')
  }
}

/** Guard an NFT import: known network, not already imported. */
export function assertNftImportable(
  config: CustomAssetConfig, chain: string, contractAddress: string, tokenId: string
): void {
  assertImportableChain(config, chain)
  if ((config.customNfts ?? []).some(n => n.chain === chain && n.contractAddress === contractAddress && n.tokenId === tokenId)) {
    throw new Error('That NFT is already imported')
  }
}

export function removeTokenPatch(config: CustomAssetConfig, chain: string, contractAddress: string): CustomToken[] {
  return (config.customTokens ?? []).filter(t => !(t.chain === chain && t.contractAddress === contractAddress))
}

export function removeNftPatch(
  config: CustomAssetConfig, chain: string, contractAddress: string, tokenId: string
): CustomNft[] {
  return (config.customNfts ?? []).filter(
    n => !(n.chain === chain && n.contractAddress === contractAddress && n.tokenId === tokenId)
  )
}
