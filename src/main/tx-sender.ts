/**
 * tx-sender.ts — MagicMoney Wallet Phase 2
 *
 * Transaction building, signing, and broadcasting for EVM, Solana, Cardano.
 * All private key material is derived here and never returned to the caller.
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  fallback,
  parseEther,
  parseUnits,
  encodeFunctionData,
  parseAbi,
  defineChain,
  type Chain,
  type Transport
} from 'viem'
import {
  mainnet,
  arbitrum,
  optimism,
  base,
  polygon,
  avalanche,
  blast,
  bsc,
  gnosis,
  ronin,
  zora,
  sepolia,
  arbitrumSepolia,
  optimismSepolia,
  baseSepolia,
  polygonAmoy,
  avalancheFuji,
  blastSepolia,
  gnosisChiado,
  zoraSepolia
} from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL
} from '@solana/web3.js'
import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { getEvmPrivateKey, getSolanaKeypair } from './wallet-core'
import {
  getCardanoSpendingKey,
  buildCardanoTx,
  decodeCardanoAddress,
  type CardanoUtxo
} from './cardano-pure'
import type { WalletConfig } from './secure-store'
import { alchemyRpcUrl, heliusRpcUrl, blockfrostFetch, ankrRpcUrl, tatumRpcUrl } from './api-proxy'
import {
  MONAD_RPCS, PUBLIC_RPCS, EVM_CHAINS as EVM_CHAIN_DEFS,
  TESTNET_EVM_CHAINS as TESTNET_EVM_CHAIN_DEFS, TESTNET_PUBLIC_RPCS, TESTNET_KOIOS_URL, isTestnet
} from './chain-config'
import { koiosAddressUtxos, koiosSubmitTx } from './cardano-koios'

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface SendResult {
  txHash: string
  explorerUrl: string
}

export interface FeeEstimate {
  fee: string          // human-readable, e.g. "0.000021"
  feeSymbol: string    // e.g. "ETH"
  feeUsd: string | null
}

// Tron + Dogecoin senders live in their own modules (TRON HTTP API / UTXO signing
// are unlike the viem-centric EVM path here). Re-exported so callers import from one
// place, mirroring how Cardano signing lives in cardano-pure.ts.
export { sendTronTransaction, estimateTronFee } from './tron'
export { sendDogecoinTransaction, estimateDogecoinFee } from './dogecoin'
export { sendBitcoinTransaction, estimateBitcoinFee } from './bitcoin'
// Privacy Mode chains. './monero' lazy-imports the ~10 MB monero-ts WASM
// internally, so these re-exports cost nothing until a Monero call happens.
export { sendMoneroTransaction, estimateMoneroFee } from './monero'
export { sendZcashTransaction, estimateZcashFee } from './zcash'

// ─── EVM ──────────────────────────────────────────────────────────────────────

// Custom chains not yet exported by viem 2.21
const monad = defineChain({ id: 143, name: 'Monad', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.monad.xyz'] } } })
const abstractChain = defineChain({ id: 2741, name: 'Abstract', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://api.mainnet.abs.xyz'] } } })
const apeChain = defineChain({ id: 33139, name: 'ApeChain', nativeCurrency: { name: 'ApeCoin', symbol: 'APE', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.apechain.com/http'] } } })
const robinhood = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.mainnet.chain.robinhood.com'] } } })
const soneium = defineChain({ id: 1868, name: 'Soneium', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.soneium.org'] } } })
const worldchain = defineChain({ id: 480, name: 'WorldChain', nativeCurrency: { name: 'Worldcoin', symbol: 'WLD', decimals: 18 }, rpcUrls: { default: { http: ['https://worldchain-mainnet.g.alchemy.com/public'] } } })
const hyperEvm = defineChain({ id: 998, name: 'HyperEVM', nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.hyperliquid.xyz/evm'] } } })

interface EvmChainEntry {
  chain: Chain
  rpcUrl: (cfg: WalletConfig) => string
  explorer: string
  nativeSymbol: string
}

// Exported for chain-parity tests (M-8): every chain advertised elsewhere
// (chain-config, swap layer) must have a sender entry here, or users can see
// balances/quotes for a chain they can't actually transact on (the BSC bug).
export const EVM_CHAINS: Record<string, EvmChainEntry> = {
  ethereum:   { chain: mainnet,       rpcUrl: cfg => alchemyRpcUrl('eth-mainnet', cfg),     explorer: 'https://etherscan.io/tx',                               nativeSymbol: 'ETH'  },
  arbitrum:   { chain: arbitrum,      rpcUrl: cfg => alchemyRpcUrl('arb-mainnet', cfg),     explorer: 'https://arbiscan.io/tx',                                nativeSymbol: 'ETH'  },
  optimism:   { chain: optimism,      rpcUrl: cfg => alchemyRpcUrl('opt-mainnet', cfg),     explorer: 'https://optimistic.etherscan.io/tx',                    nativeSymbol: 'ETH'  },
  base:       { chain: base,          rpcUrl: cfg => alchemyRpcUrl('base-mainnet', cfg),    explorer: 'https://basescan.org/tx',                               nativeSymbol: 'ETH'  },
  polygon:    { chain: polygon,       rpcUrl: cfg => alchemyRpcUrl('polygon-mainnet', cfg), explorer: 'https://polygonscan.com/tx',                            nativeSymbol: 'POL'  },
  avalanche:  { chain: avalanche,     rpcUrl: cfg => alchemyRpcUrl('avax-mainnet', cfg),    explorer: 'https://snowtrace.io/tx',                               nativeSymbol: 'AVAX' },
  blast:      { chain: blast,         rpcUrl: cfg => alchemyRpcUrl('blast-mainnet', cfg),   explorer: 'https://blastscan.io/tx',                               nativeSymbol: 'ETH'  },
  // BSC: advertised by the swap layer (swap-proxy/executor + UI token lists) but
  // had no sender entry, so BSC swaps quoted then threw (M-1). Public RPC for
  // broadcast, matching the other non-Alchemy chains here.
  bsc:        { chain: bsc,           rpcUrl: () => 'https://bsc-dataseed.binance.org',                            explorer: 'https://bscscan.com/tx',                                nativeSymbol: 'BNB'  },
  gnosis:     { chain: gnosis,        rpcUrl: () => 'https://rpc.gnosischain.com',                                  explorer: 'https://gnosisscan.io/tx',                              nativeSymbol: 'XDAI' },
  monad:      { chain: monad,         rpcUrl: () => 'https://rpc.monad.xyz',                                        explorer: 'https://monadexplorer.com/tx',                          nativeSymbol: 'MON'  },
  abstract:   { chain: abstractChain, rpcUrl: () => 'https://api.mainnet.abs.xyz',                                  explorer: 'https://abscan.org/tx',                                 nativeSymbol: 'ETH'  },
  apechain:   { chain: apeChain,      rpcUrl: () => 'https://rpc.apechain.com/http',                                explorer: 'https://apescan.io/tx',                                 nativeSymbol: 'APE'  },
  robinhood:  { chain: robinhood,     rpcUrl: cfg => alchemyRpcUrl('robinhood-mainnet', cfg), explorer: 'https://robinhoodchain.blockscout.com/tx',              nativeSymbol: 'ETH'  },
  ronin:      { chain: ronin,         rpcUrl: () => 'https://api.roninchain.com/rpc',                               explorer: 'https://app.roninchain.com/tx',                         nativeSymbol: 'RON'  },
  soneium:    { chain: soneium,       rpcUrl: () => 'https://rpc.soneium.org',                                      explorer: 'https://soneium.blockscout.com/tx',                     nativeSymbol: 'ETH'  },
  worldchain: { chain: worldchain,    rpcUrl: () => 'https://worldchain-mainnet.g.alchemy.com/public',              explorer: 'https://worldchain-mainnet.explorer.alchemy.com/tx',    nativeSymbol: 'WLD'  },
  zora:       { chain: zora,          rpcUrl: () => 'https://rpc.zora.energy',                                      explorer: 'https://explorer.zora.energy/tx',                       nativeSymbol: 'ETH'  },
  hyperevm:   { chain: hyperEvm,      rpcUrl: () => 'https://rpc.hyperliquid.xyz/evm',                              explorer: 'https://purrsec.com/tx',                                nativeSymbol: 'HYPE' }
}

// ─── Testnet Mode sender entries (same string ids as mainnet) ─────────────────
// viem ships the Sepolia-family chains; the rest are defined inline (matching
// chain-config TESTNET_EVM_CHAINS chainIds/RPCs).
const monadTestnet = defineChain({ id: 10143, name: 'Monad Testnet', nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 }, rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } }, testnet: true })
const abstractTestnet = defineChain({ id: 11124, name: 'Abstract Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://api.testnet.abs.xyz'] } }, testnet: true })
const apeChainCurtis = defineChain({ id: 33111, name: 'ApeChain Curtis', nativeCurrency: { name: 'ApeCoin', symbol: 'APE', decimals: 18 }, rpcUrls: { default: { http: ['https://curtis.rpc.caldera.xyz/http'] } }, testnet: true })
const robinhoodTestnet = defineChain({ id: 46630, name: 'Robinhood Chain Testnet', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } }, testnet: true })
const roninSaigon = defineChain({ id: 2021, name: 'Ronin Saigon', nativeCurrency: { name: 'Ronin', symbol: 'RON', decimals: 18 }, rpcUrls: { default: { http: ['https://saigon-testnet.roninchain.com/rpc'] } }, testnet: true })
const soneiumMinato = defineChain({ id: 1946, name: 'Soneium Minato', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.minato.soneium.org'] } }, testnet: true })
const worldchainSepolia = defineChain({ id: 4801, name: 'World Chain Sepolia', nativeCurrency: { name: 'Worldcoin', symbol: 'WLD', decimals: 18 }, rpcUrls: { default: { http: ['https://worldchain-sepolia.g.alchemy.com/public'] } }, testnet: true })
const hyperEvmTestnet = defineChain({ id: 998, name: 'HyperEVM Testnet', nativeCurrency: { name: 'Hyperliquid', symbol: 'HYPE', decimals: 18 }, rpcUrls: { default: { http: ['https://rpc.hyperliquid-testnet.xyz/evm'] } }, testnet: true })

export const TESTNET_EVM_SENDERS: Record<string, EvmChainEntry> = {
  ethereum:   { chain: sepolia,           rpcUrl: cfg => alchemyRpcUrl('eth-sepolia', cfg),        explorer: 'https://sepolia.etherscan.io/tx',                       nativeSymbol: 'ETH'  },
  arbitrum:   { chain: arbitrumSepolia,   rpcUrl: cfg => alchemyRpcUrl('arb-sepolia', cfg),        explorer: 'https://sepolia.arbiscan.io/tx',                        nativeSymbol: 'ETH'  },
  optimism:   { chain: optimismSepolia,   rpcUrl: cfg => alchemyRpcUrl('opt-sepolia', cfg),        explorer: 'https://sepolia-optimism.etherscan.io/tx',              nativeSymbol: 'ETH'  },
  base:       { chain: baseSepolia,       rpcUrl: cfg => alchemyRpcUrl('base-sepolia', cfg),       explorer: 'https://sepolia.basescan.org/tx',                       nativeSymbol: 'ETH'  },
  polygon:    { chain: polygonAmoy,       rpcUrl: cfg => alchemyRpcUrl('polygon-amoy', cfg),       explorer: 'https://amoy.polygonscan.com/tx',                       nativeSymbol: 'POL'  },
  avalanche:  { chain: avalancheFuji,     rpcUrl: () => 'https://api.avax-test.network/ext/bc/C/rpc', explorer: 'https://testnet.snowtrace.io/tx',                    nativeSymbol: 'AVAX' },
  blast:      { chain: blastSepolia,      rpcUrl: cfg => alchemyRpcUrl('blast-sepolia', cfg),      explorer: 'https://sepolia.blastscan.io/tx',                       nativeSymbol: 'ETH'  },
  gnosis:     { chain: gnosisChiado,      rpcUrl: () => 'https://rpc.chiadochain.net',             explorer: 'https://gnosis-chiado.blockscout.com/tx',               nativeSymbol: 'XDAI' },
  monad:      { chain: monadTestnet,      rpcUrl: () => 'https://testnet-rpc.monad.xyz',           explorer: 'https://testnet.monadexplorer.com/tx',                  nativeSymbol: 'MON'  },
  abstract:   { chain: abstractTestnet,   rpcUrl: () => 'https://api.testnet.abs.xyz',             explorer: 'https://sepolia.abscan.org/tx',                         nativeSymbol: 'ETH'  },
  apechain:   { chain: apeChainCurtis,    rpcUrl: () => 'https://curtis.rpc.caldera.xyz/http',     explorer: 'https://curtis.explorer.caldera.xyz/tx',                nativeSymbol: 'APE'  },
  robinhood:  { chain: robinhoodTestnet,  rpcUrl: cfg => alchemyRpcUrl('robinhood-testnet', cfg),  explorer: 'https://explorer.testnet.chain.robinhood.com/tx',       nativeSymbol: 'ETH'  },
  ronin:      { chain: roninSaigon,       rpcUrl: () => 'https://saigon-testnet.roninchain.com/rpc', explorer: 'https://saigon-app.roninchain.com/tx',                nativeSymbol: 'RON'  },
  soneium:    { chain: soneiumMinato,     rpcUrl: () => 'https://rpc.minato.soneium.org',          explorer: 'https://soneium-minato.blockscout.com/tx',              nativeSymbol: 'ETH'  },
  worldchain: { chain: worldchainSepolia, rpcUrl: () => 'https://worldchain-sepolia.g.alchemy.com/public', explorer: 'https://worldchain-sepolia.explorer.alchemy.com/tx', nativeSymbol: 'WLD' },
  zora:       { chain: zoraSepolia,       rpcUrl: () => 'https://sepolia.rpc.zora.energy',         explorer: 'https://sepolia.explorer.zora.energy/tx',               nativeSymbol: 'ETH'  },
  hyperevm:   { chain: hyperEvmTestnet,   rpcUrl: () => 'https://rpc.hyperliquid-testnet.xyz/evm', explorer: 'https://testnet.purrsec.com/tx',                        nativeSymbol: 'HYPE' }
}

// User-added networks (config.customChains) get a sender entry built on the fly,
// so estimate/send resolve them instead of silently falling back to the
// `entries.ethereum` default (which would broadcast on the wrong chain).
function customEvmSenders(config: WalletConfig): Record<string, EvmChainEntry> {
  const out: Record<string, EvmChainEntry> = {}
  for (const c of config.customChains ?? []) {
    out[c.id] = {
      chain: defineChain({
        id: c.chainId,
        name: c.name,
        nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 },
        rpcUrls: { default: { http: [c.rpcUrl] } }
      }),
      rpcUrl: () => c.rpcUrl,
      explorer: c.explorerTx,
      nativeSymbol: c.nativeSymbol
    }
  }
  return out
}

/** Sender entries for the active mode — every lookup below goes through this. */
function evmEntries(config: WalletConfig): Record<string, EvmChainEntry> {
  if (isTestnet(config)) return TESTNET_EVM_SENDERS
  const custom = customEvmSenders(config)
  // Built-ins spread last so a custom entry can never shadow a supported chain.
  return Object.keys(custom).length === 0 ? EVM_CHAINS : { ...custom, ...EVM_CHAINS }
}

// Keyless public fallbacks keyed by numeric EVM chain id (derived from chain-config
// so the string-keyed PUBLIC_RPCS doesn't have to be duplicated here).
const PUBLIC_RPCS_BY_CHAIN_ID: Record<number, string[]> = Object.fromEntries(
  EVM_CHAIN_DEFS
    .filter(c => c.chainId != null)
    .map(c => [c.chainId as number, PUBLIC_RPCS[c.id] ?? []])
)
const TESTNET_PUBLIC_RPCS_BY_CHAIN_ID: Record<number, string[]> = Object.fromEntries(
  TESTNET_EVM_CHAIN_DEFS
    .filter(c => c.chainId != null)
    .map(c => [c.chainId as number, TESTNET_PUBLIC_RPCS[c.id] ?? []])
)
// numeric chainId → our string chain id, so we can resolve the keyed Ankr fallback.
const ID_BY_CHAIN_ID: Record<number, string> = Object.fromEntries(
  EVM_CHAIN_DEFS.filter(c => c.chainId != null).map(c => [c.chainId as number, c.id])
)

// Build the transport for estimates/sends. Monad rotates its whole public set
// (each endpoint has a tiny rate limit). Every other chain tries its primary
// (proxy/Alchemy or own public node) FIRST and only fails over to the keyless
// PUBLIC_RPCS on a transport error (timeout/connection/5xx) — a normal broadcast
// still goes to the proxy; public nodes are the safety net when it's unreachable.
function evmTransport(entry: EvmChainEntry, config: WalletConfig): Transport {
  if (entry.chain.id === 143) return fallback(MONAD_RPCS.map(u => http(u, { timeout: 8_000 })))
  const publicByChainId = isTestnet(config) ? TESTNET_PUBLIC_RPCS_BY_CHAIN_ID : PUBLIC_RPCS_BY_CHAIN_ID
  const urls = [entry.rpcUrl(config), ...(publicByChainId[entry.chain.id] ?? [])]
  // Ankr slugs are mainnet-only — never appended in testnet mode (it would
  // silently broadcast to MAINNET for a same-id testnet chain).
  const sid = isTestnet(config) ? undefined : ID_BY_CHAIN_ID[entry.chain.id]
  const ankr = sid ? ankrRpcUrl(sid, config) : undefined
  if (ankr) urls.push(ankr)   // keyed Ankr as the reliable last-resort fallback
  const tatum = sid ? tatumRpcUrl(sid, config) : undefined
  if (tatum) urls.push(tatum) // keyed Tatum gateway (Abstract/HyperEVM thin nodes)
  return urls.length > 1
    ? fallback(urls.map(u => http(u, { timeout: 10_000 })))
    : http(urls[0])
}

export async function estimateEvmFee(
  from: string,
  to: string,
  amountEth: string,
  config: WalletConfig,
  chainId = 'ethereum'
): Promise<FeeEstimate> {
  const entries = evmEntries(config)
  const entry = entries[chainId] ?? entries.ethereum
  const transport = evmTransport(entry, config)
  const client = createPublicClient({ chain: entry.chain, transport })

  const [gasEstimate, feeData] = await Promise.all([
    client.estimateGas({
      account: from as `0x${string}`,
      to: to as `0x${string}`,
      value: parseEther(amountEth)
    }),
    client.estimateFeesPerGas().catch(() => null)
  ])

  // Use EIP-1559 maxFeePerGas when available, fall back to legacy gasPrice
  const gasPrice = feeData?.maxFeePerGas ?? await client.getGasPrice()
  const feeWei = gasEstimate * gasPrice
  const feeNative = Number(feeWei) / 1e18
  const feeSymbol = entry.nativeSymbol

  let feeUsd: string | null = null
  // Custom chains have no known CoinGecko id — the 'ethereum' fallback in
  // getCoingeckoId would price their native token as ETH, so skip USD entirely.
  if (!isTestnet(config) && !chainId.startsWith('custom-')) {
    try {
      const priceRes = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(getCoingeckoId(chainId))}&vs_currencies=usd`,
        { signal: AbortSignal.timeout(5_000) }
      )
      const priceJson = await priceRes.json() as Record<string, { usd?: number }>
      const price = Object.values(priceJson)[0]?.usd ?? 0
      if (price > 0) feeUsd = `$${(feeNative * price).toFixed(4)}`
    } catch { /* price optional */ }
  }

  return { fee: feeNative.toFixed(8), feeSymbol, feeUsd }
}

function getCoingeckoId(chainId: string): string {
  const map: Record<string, string> = {
    ethereum: 'ethereum', arbitrum: 'ethereum', optimism: 'ethereum',
    base: 'ethereum', blast: 'ethereum', soneium: 'ethereum', zora: 'ethereum', abstract: 'ethereum',
    robinhood: 'ethereum',
    polygon: 'matic-network', avalanche: 'avalanche-2', gnosis: 'xdai',
    monad: 'monad-token', apechain: 'apecoin', ronin: 'ronin',
    worldchain: 'worldcoin-wld', hyperevm: 'hyperliquid'
  }
  return map[chainId] ?? 'ethereum'
}

export async function sendEvmTransaction(
  mnemonic: string,
  to: string,
  amountEth: string,
  config: WalletConfig,
  chainId = 'ethereum',
  accountIndex = 0
): Promise<SendResult> {
  const entries = evmEntries(config)
  const entry = entries[chainId] ?? entries.ethereum
  const pk = await getEvmPrivateKey(mnemonic, accountIndex)
  const account = privateKeyToAccount(pk)
  const transport = evmTransport(entry, config)
  const walletClient = createWalletClient({ chain: entry.chain, transport, account })

  const hash = await walletClient.sendTransaction({
    to: to as `0x${string}`,
    value: parseEther(amountEth)
  })

  // Custom chains may have no explorer — '' hides the link (SendModal guards on
  // truthiness, and '/0xhash' would otherwise be a broken relative link).
  return { txHash: hash, explorerUrl: entry.explorer ? `${entry.explorer}/${hash}` : '' }
}

// Reverse lookup: numeric EVM chain id → chain entry (for raw/swap txs)
function evmEntryByChainId(chainId: number, config: WalletConfig): EvmChainEntry | null {
  for (const entry of Object.values(evmEntries(config))) {
    if (entry.chain.id === chainId) return entry
  }
  return null
}

export interface RawEvmTx {
  to: string
  data?: string
  value?: string   // hex ("0x..") or decimal string of wei
  gas?: string     // hex or decimal gas limit
  chainId: number
}

const toBig = (v?: string): bigint | undefined =>
  (v == null || v === '' || v === '0x') ? undefined : BigInt(v)

/**
 * Sign + broadcast an arbitrary EVM transaction (to/data/value) on the chain
 * identified by numeric chainId. Used for swap routes (SwapKit returns calldata).
 * viem fills nonce + fees; gas limit is taken from the caller when provided.
 */
export async function sendRawEvmTransaction(
  mnemonic: string,
  tx: RawEvmTx,
  config: WalletConfig,
  accountIndex = 0
): Promise<SendResult> {
  const entry = evmEntryByChainId(tx.chainId, config)
  if (!entry) throw new Error(`Unsupported EVM network (chainId ${tx.chainId}) — can't sign here yet.`)

  const pk = await getEvmPrivateKey(mnemonic, accountIndex)
  const account = privateKeyToAccount(pk)
  const walletClient = createWalletClient({ chain: entry.chain, transport: evmTransport(entry, config), account })

  let hash: `0x${string}`
  try {
    hash = await walletClient.sendTransaction({
      to: tx.to as `0x${string}`,
      data: (tx.data && tx.data !== '0x' ? tx.data : undefined) as `0x${string}` | undefined,
      value: toBig(tx.value) ?? 0n,
      gas: toBig(tx.gas),
    })
  } catch (err) {
    // viem wraps RPC failures as a generic "unknown RPC error". Log the full chain
    // so the real reason (fees / nonce / revert) is visible in the terminal.
    const e = err as { shortMessage?: string; details?: string; cause?: { message?: string; details?: string } }
    console.error(`[tx-sender] broadcast failed on chainId ${tx.chainId} — full error:`, err)
    console.error('[tx-sender] shortMessage:', e.shortMessage, '| details:', e.details, '| cause:', e.cause)
    throw new Error(e.cause?.details || e.cause?.message || e.shortMessage || (err as Error).message || 'Transaction failed')
  }

  return { txHash: hash, explorerUrl: `${entry.explorer}/${hash}` }
}

// ─── Abstract Global Wallet (smart account) send ──────────────────────────────

const ERC20_TRANSFER_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])

/**
 * Send native ETH or an ERC-20 FROM the Abstract Global Wallet (smart account)
 * on Abstract. The signer is this wallet's EOA — only valid when it is the AGW's
 * initial signer, so callers MUST gate on `agwOwned`. @abstract-foundation/agw-client
 * builds + signs the zkSync EIP-712 (type-113) account-abstraction transaction and
 * auto-deploys the smart account on its first send. The AGW pays its own gas, so it
 * must hold a little ETH (no paymaster sponsorship wired up here).
 */
export async function sendAgwTransaction(
  mnemonic: string,
  to: string,
  amount: string,
  config: WalletConfig,
  accountIndex = 0,
  opts?: { token?: { contractAddress: string; decimals: number }; agwAddress?: string }
): Promise<SendResult> {
  // AGW is hidden in Testnet Mode (renderer gates it too) — hard-stop here so a
  // stale renderer can't accidentally fire a MAINNET Abstract transaction.
  if (isTestnet(config)) throw new Error('AGW sends are unavailable in Testnet Mode')

  const pk = await getEvmPrivateKey(mnemonic, accountIndex)
  const signer = privateKeyToAccount(pk)

  // Lazy-load the heavy SDK + zkSync-configured chain only when actually sending.
  const { createAbstractClient } = await import('@abstract-foundation/agw-client')
  const { abstract } = await import('viem/chains')

  const agwClient = await createAbstractClient({
    signer,
    chain: abstract,
    transport: http(EVM_CHAINS.abstract.rpcUrl(config)),
    ...(opts?.agwAddress ? { address: opts.agwAddress as `0x${string}` } : {})
  })

  const explorer = EVM_CHAINS.abstract.explorer

  let hash: `0x${string}`
  if (opts?.token) {
    const data = encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: 'transfer',
      args: [to as `0x${string}`, parseUnits(amount, opts.token.decimals)]
    })
    hash = await agwClient.sendTransaction({ to: opts.token.contractAddress as `0x${string}`, data })
  } else {
    hash = await agwClient.sendTransaction({ to: to as `0x${string}`, value: parseEther(amount) })
  }

  return { txHash: hash, explorerUrl: `${explorer}/${hash}` }
}

/** Block until an EVM tx is mined (used to sequence ERC-20 approval before the swap). */
export async function waitForEvmReceipt(chainId: number, hash: string, config: WalletConfig): Promise<void> {
  const entry = evmEntryByChainId(chainId, config)
  if (!entry) return
  const client = createPublicClient({ chain: entry.chain, transport: evmTransport(entry, config) })
  await client.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 120_000 })
}

// ─── Solana ───────────────────────────────────────────────────────────────────

export async function estimateSolanaFee(config: WalletConfig): Promise<FeeEstimate> {
  // Simple transfers on Solana cost 5000 lamports (0.000005 SOL)
  const feeLamports = 5000
  const feeSol = feeLamports / LAMPORTS_PER_SOL

  let feeUsd: string | null = null
  if (!isTestnet(config)) {
    try {
      const priceRes = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd'
      )
      const priceJson = await priceRes.json() as { solana?: { usd: number } }
      const price = priceJson.solana?.usd ?? 0
      if (price > 0) feeUsd = `$${(feeSol * price).toFixed(6)}`
    } catch { /* price optional */ }
  }

  return { fee: feeSol.toFixed(9), feeSymbol: 'SOL', feeUsd }
}

export async function sendSolanaTransaction(
  mnemonic: string,
  to: string,
  amountSol: string,
  config: WalletConfig,
  accountIndex = 0
): Promise<SendResult> {
  const keypair = await getSolanaKeypair(mnemonic, accountIndex)
  // Testnet Mode: devnet — same address, keyless canonical RPC.
  const connection = new Connection(
    isTestnet(config) ? 'https://api.devnet.solana.com' : heliusRpcUrl(config),
    'confirmed'
  )

  const lamports = Math.round(parseFloat(amountSol) * LAMPORTS_PER_SOL)
  if (lamports <= 0) throw new Error('Amount must be greater than 0')

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: new PublicKey(to),
      lamports
    })
  )

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash()
  tx.recentBlockhash = blockhash
  tx.feePayer = keypair.publicKey
  tx.sign(keypair)

  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed'
  })

  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight })

  const cluster = isTestnet(config) ? '?cluster=devnet' : ''
  return { txHash: sig, explorerUrl: `https://solscan.io/tx/${sig}${cluster}` }
}

// ─── Cardano ──────────────────────────────────────────────────────────────────

async function fetchUtxos(address: string, config: WalletConfig): Promise<CardanoUtxo[]> {
  // Testnet Mode: Blockfrost keys are network-scoped (mainnet key 403s on
  // preprod), so preprod UTXOs come from keyless Koios preprod directly.
  if (isTestnet(config)) {
    const koiosPreprod = await koiosAddressUtxos(address, TESTNET_KOIOS_URL)
    if (koiosPreprod) return koiosPreprod
    throw new Error('Could not fetch Cardano preprod UTXOs (Koios unavailable)')
  }

  try {
    const res = await blockfrostFetch(`addresses/${address}/utxos`, config)
    if (res.status === 404) return []   // address has no funds on-chain (definitive)
    if (res.ok) {
      const utxos = await res.json() as Array<{
        tx_hash: string
        tx_index: number
        amount: Array<{ unit: string; quantity: string }>
      }>
      return utxos.map(u => ({
        txHash: u.tx_hash,
        txIndex: u.tx_index,
        lovelace: BigInt(u.amount.find(a => a.unit === 'lovelace')?.quantity ?? '0')
      }))
    }
    // Non-404 error — fall through to the keyless Koios fallback below.
  } catch { /* Blockfrost unreachable — fall through to Koios */ }

  const koios = await koiosAddressUtxos(address)
  if (koios) return koios
  throw new Error('Could not fetch Cardano UTXOs (Blockfrost and Koios both unavailable)')
}

export async function estimateCardanoFee(
  _address: string,
  config: WalletConfig
): Promise<FeeEstimate> {
  // Fixed 0.17 ADA — adequate for a simple transfer (real min ≈ 0.16 ADA for ~280 bytes)
  const feeLovelace = 170000n
  const feeAda = Number(feeLovelace) / 1e6

  let feeUsd: string | null = null
  try {
    const priceRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=cardano&vs_currencies=usd'
    )
    const priceJson = await priceRes.json() as { cardano?: { usd: number } }
    const price = priceJson.cardano?.usd ?? 0
    if (price > 0) feeUsd = `$${(feeAda * price).toFixed(4)}`
  } catch { /* price optional */ }

  return { fee: feeAda.toFixed(6), feeSymbol: 'ADA', feeUsd }
}

export async function sendCardanoTransaction(
  mnemonic: string,
  fromAddress: string,
  toAddress: string,
  amountAda: string,
  config: WalletConfig,
  accountIndex = 0
): Promise<SendResult> {
  const cleaned = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
  const entropy = mnemonicToEntropy(cleaned, wordlist)
  const spendKey = getCardanoSpendingKey(entropy, accountIndex)

  const amountLovelace = BigInt(Math.round(parseFloat(amountAda) * 1_000_000))
  if (amountLovelace <= 0n) throw new Error('Amount must be greater than 0')

  // Fetch UTXOs and select enough to cover amount + fee
  const allUtxos = await fetchUtxos(fromAddress, config)
  if (allUtxos.length === 0) throw new Error('No UTXOs found — address has no funds on-chain')

  // Sort descending by value, pick until we have enough
  allUtxos.sort((a, b) => (b.lovelace > a.lovelace ? 1 : -1))
  const FEE = 170000n
  const needed = amountLovelace + FEE

  const selected: CardanoUtxo[] = []
  let sum = 0n
  for (const utxo of allUtxos) {
    selected.push(utxo)
    sum += utxo.lovelace
    if (sum >= needed) break
  }
  if (sum < needed) {
    throw new Error(
      `Insufficient funds: have ${(Number(sum) / 1e6).toFixed(6)} ADA, need ${(Number(needed) / 1e6).toFixed(6)} ADA`
    )
  }

  const toAddrBytes = decodeCardanoAddress(toAddress)
  const fromAddrBytes = decodeCardanoAddress(fromAddress)

  const { txCbor, txHash } = buildCardanoTx(
    selected,
    toAddrBytes,
    fromAddrBytes,
    amountLovelace,
    spendKey
  )

  // Testnet Mode: broadcast via keyless Koios preprod (Blockfrost keys are
  // network-scoped, so the mainnet proxy route can't submit preprod txs).
  if (isTestnet(config)) {
    await koiosSubmitTx(txCbor, TESTNET_KOIOS_URL)
    return { txHash, explorerUrl: `https://preprod.cardanoscan.io/transaction/${txHash}` }
  }

  // Submit via Blockfrost (proxy injects project_id; CBOR body passed through).
  // If Blockfrost is unreachable or rejects on transport grounds, fall back to the
  // keyless Koios /submittx so a down primary doesn't block the broadcast. (An
  // INVALID tx will be rejected by both — we then surface the Blockfrost reason.)
  let submitRes: Response | null = null
  try {
    submitRes = await blockfrostFetch('tx/submit', config, 20_000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/cbor' },
      body: new Uint8Array(txCbor)   // fresh ArrayBuffer-backed copy → valid BodyInit
    })
  } catch { submitRes = null }

  if (submitRes && submitRes.ok) {
    return { txHash, explorerUrl: `https://cardanoscan.io/transaction/${txHash}` }
  }

  try {
    await koiosSubmitTx(txCbor)
    return { txHash, explorerUrl: `https://cardanoscan.io/transaction/${txHash}` }
  } catch (koiosErr) {
    if (submitRes) {
      const body = await submitRes.json().catch(() => ({})) as { message?: string }
      throw new Error(`Submit failed (${submitRes.status}): ${body.message ?? submitRes.statusText}`)
    }
    throw koiosErr instanceof Error ? koiosErr : new Error('Cardano submit failed')
  }
}

