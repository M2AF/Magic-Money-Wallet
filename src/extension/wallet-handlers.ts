/**
 * wallet-handlers.ts — Shared wallet message router
 *
 * The complete handle(msg, sender) switch plus approval queues — the browser
 * equivalent of src/main/ipc-handlers.ts. Extracted from background.ts so two
 * hosts can drive it:
 *   - Extension: background.ts (MV3 service worker via chrome.runtime.onMessage)
 *   - Android:   src/capacitor/wallet-local.ts (called directly, in-process)
 * Environment side effects (UI pushes, dApp broadcasts, approval surfacing) go
 * through './platform'; storage goes through './chrome-store' — both are
 * vite-aliased per build target. Private keys and mnemonics never leave this file.
 */

import { generateMnemonic, validateMnemonic, deriveAddresses, deriveTestnetAddresses, derivePrivacyAddresses, getSolanaKeypair, getBitcoinKey, getBitcoinTaprootKey, getPolkadotKey } from '../main/wallet-core'
import { signBitcoinPsbt, signBitcoinMessage, broadcastBitcoin, sendBitcoinTransaction as sendBtc, type PsbtSignRequest } from '../main/bitcoin'
import { fetchAllBalances } from '../main/balance-fetcher'
import { fetchAllHistory } from '../main/tx-history'
import { fetchMarketTop100, searchMarketCoins, fetchCoinChart } from '../main/market-fetcher'
import { fetchAllTokens, fetchAllCollectibles, fetchNftFloor, resolveCustomToken, resolveCustomNft } from '../main/token-fetcher'
import {
  buildCustomChain, chainRemovalPatch, assertTokenImportable, assertNftImportable,
  removeTokenPatch, removeNftPatch, normalizeContractAddress, normalizeTokenId,
  type CustomChainInput
} from '../main/custom-chains'
import type { CustomToken, CustomNft } from '../main/secure-store'
import { validateAddress } from '../main/address-validate'
// STATIC import — the MV3 service worker forbids dynamic import(), and after
// the privacy-chain refactor chain-config lives in a lazily-loaded shared chunk,
// so `await import('../main/chain-config')` throws
// "import() is disallowed on ServiceWorkerGlobalScope". Pulling every symbol the
// SW needs into this static import keeps chain-config in the eager background
// bundle. (This was the "network switcher shows only Chain 1" regression.)
import { isTestnet, activeEvmChains, defaultDappChainId, midnightNetworkFor, EVM_CHAINS, MONAD_RPCS, PUBLIC_RPCS } from '../main/chain-config'
// Per-target alias (see vite.extension/capacitor config): extension → offscreen
// proxy, Android → the real in-WebView manager.
import {
  getMidnightDustStatus, registerMidnightDustIfNeeded, sendMidnightNight,
} from './midnight-send-manager'
import { getSwapQuote, getSwapTokenList, getCrossSwapStatus, type SwapQuoteRequest, type SwapChain, type NormalizedSwapQuote, type CrossSwapStatusRequest } from '../main/swap-proxy'
import { executeSwap } from '../main/swap-executor'
import { ssEstimate, ssCreateExchange, ssGetStatus, type SsEstimateParams, type SsCreateParams } from '../main/simpleswap-client'
import { xEstimate, xCreateExchange, xGetStatus, type XCreateParams, type ExchangeProvider } from '../main/xchange-client'
import { estimateEvmFee, estimateSolanaFee, estimateCardanoFee, estimateTronFee, estimateDogecoinFee, estimateBitcoinFee, estimateZcashFee, estimateMoneroFee, sendEvmTransaction, sendRawEvmTransaction, sendAgwTransaction, sendSolanaTransaction, sendCardanoTransaction, sendTronTransaction, sendDogecoinTransaction, sendBitcoinTransaction, sendZcashTransaction, sendMoneroTransaction } from '../main/tx-sender'
// Monero wallet-birthday probe — plain fetch (monero-rpc), safe to static-import
// in the SW; avoids a forbidden dynamic import (see the chain-config note above).
import { fetchMoneroHeight } from '../main/monero'
import { resolveAccountAgw } from '../main/agw'
import { syncWallets, getProfileByAddress, updateProfile } from '../main/supabase-sync'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { privateKeyToAccount } from 'viem/accounts'
import * as store from './chrome-store'
import * as platform from './platform'
import {
  wcGetSessions, wcGetPendingProposals, wcGetPendingRequests,
  wcPair, wcApproveSession, wcRejectSession,
  wcDisconnect, wcApproveRequest, wcRejectRequest
} from './wc-ext'
import {
  cip30GetBalance, cip30GetUtxos, cip30GetRewardAddresses, cip30GetCollateral,
  cip30SignTx, cip30SignData, cip30SubmitTx, addressToHex,
} from './cardano-cip30'
import {
  summarizeCardanoTx, formatCardanoTxSummary, formatSignDataPayload, formatAda,
  type CardanoTxSummary,
} from '../main/cardano-tx-inspect'
import { getCardanoStakeKey } from '../main/cardano-pure'
import { grantForChainLabel, type DappChain } from '../main/dapp-permissions'
import {
  summarizeSolanaTx, formatSolanaTxSummary, formatSolanaMessage, formatSol,
  type SolanaTxSummary,
} from '../main/solana-tx-inspect'
import { mnemonicToEntropy } from '@scure/bip39'
import { wordlist as bip39Wordlist } from '@scure/bip39/wordlists/english'
import { blake2b as blake2bHash } from '@noble/hashes/blake2b'
import { alchemyRpcUrl, heliusRpcUrl } from '../main/api-proxy'

// ── In-memory pending mnemonic (lives only during the create/import flow) ────

let _pendingMnemonic: string | null = null

// ── Current chain (updated by wallet_switchEthereumChain / the popup switcher) ─
// In-memory for synchronous eth_chainId reads; persisted to chrome.storage so the
// user's selection survives the MV3 service worker sleeping/restarting (which
// would otherwise reset it to Ethereum and make dApps show "Wrong Network").

let _currentChainId = '0x1'
store.getCurrentChain().then(v => { if (v) _currentChainId = v }).catch(() => {})

// ── dApp connection approval queue ───────────────────────────────────────────

const _connectionQueue = new Map<string, {
  resolve: (value: unknown) => void
  reject:  (e: Error) => void
  origin:  string
  tabId:   number | undefined
  chain:   'evm' | 'solana' | 'cardano' | 'bitcoin' | 'polkadot'
}>()

// ── web3 transaction approval queue ──────────────────────────────────────────

const _web3TxQueue = new Map<string, {
  resolve: (r: unknown) => void
  reject: (e: Error) => void
  origin: string
  tx: Record<string, string>
  chainId: string
}>()

const _web3SignQueue = new Map<string, {
  resolve: () => void
  reject: (e: Error) => void
  origin: string
  chain: string
  method: string
  summary: string
  details?: string
}>()

async function requireApprovedOrigin(
  sender: Sender | undefined, action: string, chain: DappChain
): Promise<string> {
  const origin = sender?.origin ?? 'unknown'
  if (!(await store.hasOriginChain(origin, chain))) {
    throw Object.assign(new Error(`Connect the wallet before ${action}.`), { code: 4100 })
  }
  return origin
}

async function requestSignatureApproval(
  sender: Sender | undefined,
  req: { chain: string; method: string; summary: string; details?: string }
): Promise<void> {
  if (sender?.kind !== 'page') return
  // The grant is derived from the chain being signed for, so a site connected
  // for one chain cannot get a signing prompt for another.
  const origin = await requireApprovedOrigin(sender, 'signing', grantForChainLabel(req.chain))
  const id = crypto.randomUUID()
  return new Promise<void>((resolve, reject) => {
    _web3SignQueue.set(id, { resolve, reject, origin, ...req })
    platform.requestApproval('web3:sign-request', { id, origin, ...req })
    setTimeout(() => {
      if (_web3SignQueue.has(id)) {
        _web3SignQueue.delete(id)
        reject(Object.assign(new Error('Signature request timed out'), { code: 4001 }))
      }
    }, 120_000)
  })
}

function previewBytes(bytes: Uint8Array | number[] | string, max = 96): string {
  const text = typeof bytes === 'string'
    ? bytes
    : Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  return text.length > max ? `${text.slice(0, max)}...` : text
}

// ── Cardano dApp helpers ─────────────────────────────────────────────────────

/** Throws CIP-30 APIError.Refused unless the origin holds a Cardano grant. */
async function requireCardanoGrant(sender: Sender | undefined): Promise<string> {
  const origin = sender?.origin ?? 'unknown'
  if (!(await store.hasOriginChain(origin, 'cardano'))) {
    throw Object.assign(new Error('Connect the wallet before using the Cardano API.'), { code: 4100 })
  }
  return origin
}

/**
 * The Cardano address CIP-30 should expose. loadFullAddresses() applies the
 * Testnet Mode substitution, so in Testnet Mode dApps get the addr_test…
 * address matching the network id we report.
 */
async function cardanoDappAddress(): Promise<{ address: string; accountIndex: number }> {
  const addresses = await loadFullAddresses()
  if (!addresses?.cardano) throw new Error('No Cardano wallet')
  return { address: addresses.cardano, accountIndex: addresses.accountIndex ?? 0 }
}

/**
 * Decode a dApp transaction for the approval sheet. Never throws — a decoder
 * failure must still produce a prompt (marked undecodable) rather than an error
 * the user reads as "signing is broken". The stake-key hash is best-effort: it
 * only drives the "also signs with your stake key" warning.
 */
async function describeCardanoTxForApproval(
  txHex: string, ownAddress: string, accountIndex: number
): Promise<CardanoTxSummary> {
  let stakeKeyHash: Uint8Array | undefined
  try {
    const entropy = mnemonicToEntropy(await store.loadMnemonic(), bip39Wordlist)
    stakeKeyHash = blake2bHash(getCardanoStakeKey(entropy, accountIndex).pub, { dkLen: 28 })
  } catch { /* warning omitted rather than blocking the prompt */ }

  return summarizeCardanoTx(txHex, {
    ownAddresses: [ownAddress],
    stakeKeyHash,
    config: await store.loadConfig(),
  })
}

// ── Solana dApp helpers ──────────────────────────────────────────────────────

/** Decode + simulate for the approval sheet. Never throws — see solana-tx-inspect.ts. */
async function describeSolanaForApproval(txBytes: Uint8Array): Promise<SolanaTxSummary> {
  const addresses = await loadFullAddresses()
  return summarizeSolanaTx(txBytes, {
    ownAddress: addresses?.solana ?? '',
    config: await store.loadConfig(),
  })
}

/** One-line headline for the approval sheet's summary row. */
function solanaHeadline(s: SolanaTxSummary): string {
  if (s.error) return 'Sign an undecodable Solana transaction'
  if (s.simulation === 'failed') return 'Sign a transaction that fails simulation'
  if (s.netSol !== null && s.netSol < 0n) return `Send ${formatSol(-s.netSol)} SOL`
  if (s.netSol !== null && s.netSol > 0n) return `Receive ${formatSol(s.netSol)} SOL`
  return 'Sign Solana transaction'
}

/** One-line headline for the approval sheet's summary row. */
function cardanoApprovalHeadline(summary: CardanoTxSummary): string {
  if (summary.resolution === 'failed') return 'Sign an undecodable Cardano transaction'
  if (summary.netAda < 0n) return `Send ${formatAda(-summary.netAda)} ADA`
  if (summary.netAda > 0n) return `Receive ${formatAda(summary.netAda)} ADA`
  return 'Sign Cardano transaction'
}

// ── Monad RPC rotation ────────────────────────────────────────────────────────
// Monad's public RPCs each throttle under load (a chatty dApp like nad.fun blows
// past a single one's rate limit). Rotate reads across all of them and fall over
// on transport errors; sends use a viem fallback transport. Mirrors the Electron
// app (ipc-handlers.ts / tx-sender.ts).
let _monadRpcCursor = 0
function rotateMonadRpcs(list: readonly string[]): string[] {
  const start = _monadRpcCursor++ % list.length
  return [...list.slice(start), ...list.slice(0, start)]
}

// Apply an EVM chain switch from any source: update in-memory state, persist it,
// fire chainChanged to dApp tabs, and update the wallet UI (so the network
// switcher pill reflects dApp-initiated switches live). Returns the hex id.
function applyChainSwitch(hex: string): string {
  _currentChainId = hex
  store.setCurrentChain(hex).catch(() => {})
  platform.pushToDapps('chainChanged', hex)
  platform.pushToUi('web3:chain-changed', hex)
  return hex
}

// Whether a numeric chainId is one of the wallet's supported EVM chains. The
// dynamic import is module-cached, so repeated calls are cheap. Mode-aware:
// only the active network set (mainnet ⟷ testnet) validates.
async function isSupportedEvmChain(chainNum: number): Promise<boolean> {
  const config = await store.loadConfig()
  return activeEvmChains(config).some(c => c.chainId === chainNum)
}

// ── EVM key helper ────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function deriveEvmKey(): Promise<`0x${string}`> {
  const mnemonic = await store.loadMnemonic()
  const addresses = await store.loadAddresses()
  const idx = addresses?.accountIndex ?? 0
  const seed = mnemonicToSeedSync(mnemonic)
  const child = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/${idx}'/0/0`)
  if (!child.privateKey) throw new Error('Key derivation failed')
  return `0x${toHex(child.privateKey)}` as `0x${string}`
}

// ── Abstract Global Wallet resolution ─────────────────────────────────────────
// Mirrors ipc-handlers.ts: resolve the linked AGW (manual override ?? on-chain
// linked) once and persist agwOwned so we don't re-query the resolver each read.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveAgw(addresses: any): Promise<any> {
  const override = await store.loadAgwOverride(addresses.accountIndex ?? 0)
  const { agw, agwOwned } = await resolveAccountAgw(addresses.evm, override)
  return { ...addresses, agw, agwOwned }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
// One-shot guards for the Midnight address backfill in loadFullAddresses.
let _midnightBackfillTried = false
let _midnightTestnetBackfillTried = false

async function loadFullAddresses(): Promise<any> {
  const loaded = await store.loadAddresses()
  if (!loaded) throw new Error('No wallet')
  let stored = loaded
  // Auto-migrate wallets created before tron/dogecoin/taproot existed (re-derive fills them).
  if (!stored.tron || !stored.dogecoin || !stored.bitcoinNested || !stored.bitcoinTaproot) {
    stored = await deriveAddresses(await store.loadMnemonic(), stored.accountIndex ?? 0)
    await store.saveAddresses(stored)
  }
  if ((stored as { agwOwned?: boolean }).agwOwned === undefined) {
    stored = await resolveAgw(stored)
    await store.saveAddresses(stored)
  }
  const config = await store.loadConfig()
  // Testnet Mode: backfill + substitute the testnet-encoded set (mirrors the
  // Electron getFullAddresses). Needs the unlocked seed; the Settings toggle
  // derives it eagerly, so this only covers stale stores. Also re-derives when
  // a pre-Midnight-Preprod cache lacks the midnight field (one-shot guarded,
  // same doctrine as the privacy backfill below).
  if (config.testnetMode && (!stored.testnet || (!stored.testnet.midnight && !_midnightTestnetBackfillTried)) && (await store.isUnlocked())) {
    _midnightTestnetBackfillTried = true
    stored = { ...stored, testnet: await deriveTestnetAddresses(await store.loadMnemonic(), stored.accountIndex ?? 0) }
    await store.saveAddresses(stored)
  }
  // Privacy Mode: same lazy backfill for the privacy chain set (XMR/ZEC/NIGHT).
  // Also re-derives when a pre-Midnight cache lacks the midnight fields — the
  // extension derives them via its offscreen document, Android in-page. The
  // one-shot flag prevents a re-derive loop if this runtime's ledger loader
  // is genuinely broken (derivation succeeds but leaves midnight unset).
  if (config.privacyMode && !config.testnetMode && (!stored.privacy || ((!stored.privacy.midnight || !stored.privacy.midnightDust) && !_midnightBackfillTried)) && (await store.isUnlocked())) {
    _midnightBackfillTried = true
    stored = { ...stored, privacy: await derivePrivacyAddresses(await store.loadMnemonic(), stored.accountIndex ?? 0) }
    await store.saveAddresses(stored)
  }
  return store.effectiveAddresses(stored, config)
}

// ── Message router ────────────────────────────────────────────────────────────

export type Msg = { type: string; args: unknown[] }
export type Sender = { origin: string; tabId?: number; kind: 'page' | 'extension' }

export const PAGE_RPC_TYPES = new Set([
  'web3:request',
  'web3:solana:connect',
  'web3:solana:sign',
  'web3:solana:sign-tx',
  'web3:solana:sign-and-send',
  'cardano:is-enabled',
  'cardano:enable',
  'cardano:get-network-id',
  'cardano:get-balance',
  'cardano:get-utxos',
  'cardano:get-used-addresses',
  'cardano:get-unused-addresses',
  'cardano:get-change-address',
  'cardano:get-reward-addresses',
  'cardano:get-collateral',
  'cardano:sign-tx',
  'cardano:sign-data',
  'cardano:submit-tx',
  'bitcoin:get-accounts',
  'bitcoin:request-accounts',
  'bitcoin:request-addresses',
  'bitcoin:get-public-key',
  'bitcoin:get-balance',
  'bitcoin:sign-message',
  'bitcoin:sign-psbt',
  'bitcoin:push-psbt',
  'bitcoin:push-tx',
  'bitcoin:send',
  'polkadot:enable',
  'polkadot:get-accounts',
  'polkadot:sign-payload',
  'polkadot:sign-raw',
])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handle(msg: Msg, sender?: Sender): Promise<any> {
  const [a0, a1, a2] = msg.args ?? []
  if (sender?.kind === 'page' && !PAGE_RPC_TYPES.has(msg.type)) {
    throw Object.assign(new Error(`Method not available to web pages: ${msg.type}`), { code: 4100 })
  }

  switch (msg.type) {

    // ── Wallet lifecycle ───────────────────────────────────────────────────

    case 'wallet:is-setup':
      return store.walletExists()

    case 'wallet:is-unlocked':
      return store.isUnlocked()

    case 'wallet:unlock': {
      await store.unlock(String(a0))
      return true
    }

    case 'wallet:lock':
      await store.lock()
      return true

    case 'wallet:generate': {
      // generateMnemonic returns the space-separated phrase (see wallet-core);
      // split for display exactly like the Electron handler does.
      _pendingMnemonic = generateMnemonic()
      return _pendingMnemonic.split(' ')
    }

    case 'wallet:validate':
      return validateMnemonic(String(a0))

    case 'wallet:confirm-backup': {
      if (!_pendingMnemonic) throw new Error('No pending wallet — start over')
      const addresses = await deriveAddresses(_pendingMnemonic, 0)
      await store.saveAddresses(addresses)
      return addresses
    }

    case 'wallet:set-password': {
      const password = String(a0)
      if (!_pendingMnemonic) throw new Error('No pending wallet — start over')
      await store.saveMnemonic(_pendingMnemonic, password)
      _pendingMnemonic = null
      return true
    }

    case 'wallet:import': {
      const mnemonic = String(a0)
      if (!validateMnemonic(mnemonic)) throw new Error('Invalid mnemonic phrase')
      const addresses = await deriveAddresses(mnemonic, 0)
      await store.saveAddresses(addresses)
      _pendingMnemonic = mnemonic
      return addresses
    }

    case 'wallet:delete': {
      await store.deleteWallet()
      return true
    }

    // ── Connected sites (revoke dApp access, like MetaMask/Phantom) ─────────
    // Returns per-chain grant records so Settings can show what each site may
    // actually do, and revoke one chain without disconnecting the others.
    case 'wallet:get-connected-sites':
      return store.getApprovedOriginRecords()

    case 'wallet:revoke-site': {
      const origin = String(a0 ?? '')
      if (!origin) return store.getApprovedOriginRecords()
      const revokeScope = a1 ? (a1 as DappChain) : undefined
      await store.removeApprovedOrigin(origin, revokeScope)
      // Tell any open tab on that origin it's been disconnected (MetaMask
      // behavior) — but only once it has no grants left at all.
      if (!(await store.getApprovedOrigins()).includes(origin)) {
        platform.pushToDappOrigin(origin, 'accountsChanged', [])
      }
      return store.getApprovedOriginRecords()
    }

    case 'wallet:revoke-all-sites': {
      const all = await store.getApprovedOrigins()
      await store.clearApprovedOrigins()
      for (const origin of all) platform.pushToDappOrigin(origin, 'accountsChanged', [])
      return []
    }

    // ── Data reads ─────────────────────────────────────────────────────────

    case 'wallet:get-addresses': {
      if (!(await store.loadAddresses())) return null
      return loadFullAddresses()
    }

    case 'wallet:get-balances': {
      const addresses = await loadFullAddresses()
      const config = await store.loadConfig()
      return fetchAllBalances(addresses, config)
    }

    case 'wallet:reveal-seed': {
      if (!(await store.verifyPassword(String(a0 ?? '')))) {
        throw new Error('Incorrect password')
      }
      const mnemonic = await store.loadMnemonic()
      return mnemonic.split(' ')
    }

    case 'wallet:get-history': {
      const addresses = await store.loadAddresses()
      if (!addresses) throw new Error('No wallet')
      const config = await store.loadConfig()
      // Mainnet history providers would mislabel mainnet activity as testnet
      // (same EVM address) — show none instead. Mirrors the Electron handler.
      if (config.testnetMode) return {}
      return fetchAllHistory(addresses, config)
    }

    case 'wallet:get-account': {
      const addresses = await store.loadAddresses()
      return addresses?.accountIndex ?? 0
    }

    case 'wallet:set-account': {
      const idx = Number(a0)
      const mnemonic = await store.loadMnemonic()
      const derived = await deriveAddresses(mnemonic, idx)
      let addresses = await resolveAgw(derived)
      const config = await store.loadConfig()
      // Keep the testnet-encoded set in step with the account while the mode is on.
      if (config.testnetMode) {
        addresses = { ...addresses, testnet: await deriveTestnetAddresses(mnemonic, idx) }
      }
      // Same for the privacy chain set while Privacy Mode is on.
      if (config.privacyMode && !config.testnetMode) {
        addresses = { ...addresses, privacy: await derivePrivacyAddresses(mnemonic, idx) }
      }
      await store.saveAddresses(addresses)
      return store.effectiveAddresses(addresses, config)
    }

    // ── Midnight NIGHT send (mirrors the Electron wallet:*-midnight IPC) ────
    // The manager is aliased per target: the extension proxies to its offscreen
    // document (the SW can't host the WASM or survive the multi-minute DUST
    // sync); Android runs it directly in the WebView.

    case 'wallet:get-midnight-dust-status': {
      const config = await store.loadConfig()
      const network = midnightNetworkFor(config)
      if (!network) throw new Error('Midnight is only available in Privacy Mode or Testnet Mode')
      const accountIndex = (await store.loadAddresses())?.accountIndex ?? 0
      return getMidnightDustStatus(await store.loadMnemonic(), accountIndex, network)
    }

    case 'wallet:register-midnight-dust': {
      const config = await store.loadConfig()
      const network = midnightNetworkFor(config)
      if (!network) throw new Error('Midnight is only available in Privacy Mode or Testnet Mode')
      const accountIndex = (await store.loadAddresses())?.accountIndex ?? 0
      return registerMidnightDustIfNeeded(await store.loadMnemonic(), accountIndex, network)
    }

    case 'wallet:send-midnight': {
      const config = await store.loadConfig()
      const network = midnightNetworkFor(config)
      if (!network) throw new Error('Midnight is only available in Privacy Mode or Testnet Mode')
      const stars = BigInt(Math.round(parseFloat(String(a1)) * 1e6))
      if (stars <= 0n) throw new Error('Amount must be greater than 0')
      const accountIndex = (await store.loadAddresses())?.accountIndex ?? 0
      const txId = await sendMidnightNight(await store.loadMnemonic(), accountIndex, network, String(a0), stars)
      // No confirmed Preprod explorer — only link out on mainnet.
      return {
        txHash: txId,
        explorerUrl: network === 'mainnet' ? `https://midnightscan.io/tx/${txId}` : '',
      }
    }

    // ── Custom chains — user-added EVM networks ─────────────────────────────
    // Mirrors the Electron wallet:*-custom-chain/token/nft IPC. The rules live
    // in custom-chains.ts so all three targets validate identically; the
    // fetchers (balance/token/tx-sender) already read config.customChains, so
    // assets and sends need no extra wiring here.

    case 'wallet:get-custom-chains': {
      return (await store.loadConfig()).customChains ?? []
    }

    case 'wallet:add-custom-chain': {
      const config = await store.loadConfig()
      const chain = await buildCustomChain(a0 as CustomChainInput, config.customChains ?? [])
      await store.saveConfig({ customChains: [...(config.customChains ?? []), chain] })
      return (await store.loadConfig()).customChains
    }

    case 'wallet:remove-custom-chain': {
      await store.saveConfig(chainRemovalPatch(await store.loadConfig(), String(a0)))
      return (await store.loadConfig()).customChains
    }

    case 'wallet:get-custom-tokens': {
      return (await store.loadConfig()).customTokens ?? []
    }

    case 'wallet:resolve-custom-token': {
      const addr = normalizeContractAddress(a1)
      const addresses = await loadFullAddresses()
      return resolveCustomToken(String(a0), addr, addresses.evm, await store.loadConfig())
    }

    case 'wallet:import-custom-token': {
      const chain = String(a0)
      const addr = normalizeContractAddress(a1)
      const config = await store.loadConfig()
      assertTokenImportable(config, chain, addr)
      // Resolving doubles as validation — a non-ERC-20 address throws here.
      const addresses = await loadFullAddresses()
      const meta = await resolveCustomToken(chain, addr, addresses.evm, config)
      const token: CustomToken = {
        chain, contractAddress: addr,
        name: meta.name, symbol: meta.symbol, decimals: meta.decimals
      }
      await store.saveConfig({ customTokens: [...(config.customTokens ?? []), token] })
      return (await store.loadConfig()).customTokens
    }

    case 'wallet:remove-custom-token': {
      const addr = String(a1 ?? '').trim().toLowerCase()
      await store.saveConfig({ customTokens: removeTokenPatch(await store.loadConfig(), String(a0), addr) })
      return (await store.loadConfig()).customTokens
    }

    case 'wallet:get-custom-nfts': {
      return (await store.loadConfig()).customNfts ?? []
    }

    case 'wallet:resolve-custom-nft': {
      const addr = normalizeContractAddress(a1)
      const id = a2 == null || String(a2).trim() === '' ? undefined : String(a2).trim()
      const addresses = await loadFullAddresses()
      return resolveCustomNft(String(a0), addr, id, addresses.evm, await store.loadConfig())
    }

    case 'wallet:import-custom-nft': {
      const chain = String(a0)
      const addr = normalizeContractAddress(a1)
      const id = normalizeTokenId(a2)
      const config = await store.loadConfig()
      assertNftImportable(config, chain, addr, id)
      const addresses = await loadFullAddresses()
      const info = await resolveCustomNft(chain, addr, id, addresses.evm, config)
      const nft: CustomNft = { chain, contractAddress: addr, tokenId: id, type: info.type }
      await store.saveConfig({ customNfts: [...(config.customNfts ?? []), nft] })
      return (await store.loadConfig()).customNfts
    }

    case 'wallet:remove-custom-nft': {
      const addr = String(a1 ?? '').trim().toLowerCase()
      const id = String(a2 ?? '').trim()
      await store.saveConfig({ customNfts: removeNftPatch(await store.loadConfig(), String(a0), addr, id) })
      return (await store.loadConfig()).customNfts
    }

    // ── Testnet Mode (mirrors the Electron wallet:get/set-testnet-mode IPC) ──

    case 'wallet:get-testnet-mode': {
      const config = await store.loadConfig()
      return !!config.testnetMode
    }

    case 'wallet:set-testnet-mode': {
      const on = !!a0
      if (on) {
        if (!(await store.isUnlocked())) throw new Error('Unlock the wallet to enable Testnet Mode')
        const stored = await store.loadAddresses()
        if (stored && (!stored.testnet || !stored.testnet.midnight)) {
          const testnet = await deriveTestnetAddresses(await store.loadMnemonic(), stored.accountIndex ?? 0)
          await store.saveAddresses({ ...stored, testnet })
        }
      }
      await store.saveConfig({ testnetMode: on })
      // Reset the active chain to the mode's default (Sepolia ⟷ Ethereum) and
      // notify dApp tabs + the extension UI, exactly like a manual switch.
      const config = await store.loadConfig()
      applyChainSwitch(`0x${defaultDappChainId(config).toString(16)}`)
      const addresses = await store.loadAddresses()
      return { testnet: on, addresses: addresses ? store.effectiveAddresses(addresses, config) : null }
    }

    // ── Privacy Mode (mirrors the Electron wallet:get/set-privacy-mode IPC) ──

    case 'wallet:get-privacy-mode': {
      const config = await store.loadConfig()
      return !!config.privacyMode && !config.testnetMode
    }

    case 'wallet:set-privacy-mode': {
      const on = !!a0
      if (on) {
        if (!(await store.isUnlocked())) throw new Error('Unlock the wallet to enable Privacy Mode')
        const stored = await store.loadAddresses()
        if (stored && (!stored.privacy || !stored.privacy.midnight || !stored.privacy.midnightDust)) {
          const privacy = await derivePrivacyAddresses(await store.loadMnemonic(), stored.accountIndex ?? 0)
          await store.saveAddresses({ ...stored, privacy })
        }
        // Testnet and Privacy modes are mutually exclusive.
        await store.saveConfig({ privacyMode: true, testnetMode: false })
        // Monero wallet birthday — set once, never moved backward. Stamped in
        // the BACKGROUND (not awaited): a node round-trip must not delay the
        // toggle's renderer reload. Until it lands, monero-impl falls back to
        // near-tip, so scanning still starts correctly on the first balance.
        if (!(await store.loadConfig()).moneroRestoreHeight) {
          void (async () => {
            try {
              await store.saveConfig({ moneroRestoreHeight: await fetchMoneroHeight() })
            } catch { /* height stays 0 → near-tip fallback */ }
          })()
        }
      } else {
        await store.saveConfig({ privacyMode: false })
      }
      const config = await store.loadConfig()
      // Reset the active dApp chain to the mode's default — mirrors the Testnet
      // toggle. Without this, enabling Privacy (which clears testnetMode) leaves
      // a stale testnet chain id, and the NetworkSwitcher shows the testnet list
      // while in mainnet.
      applyChainSwitch(`0x${defaultDappChainId(config).toString(16)}`)
      const addresses = await store.loadAddresses()
      return { privacy: !!config.privacyMode, addresses: addresses ? store.effectiveAddresses(addresses, config) : null }
    }

    // ── Send transactions ──────────────────────────────────────────────────

    // H-3: mirrors the Electron wallet:validate-address handler.
    case 'wallet:validate-address': {
      const config = await store.loadConfig()
      return validateAddress(String(a0), String(a1), isTestnet(config))
    }

    case 'wallet:estimate-fee': {
      const [chain, to, amount] = [String(a0), String(a1), String(a2)]
      const config = await store.loadConfig()
      const addresses = await loadFullAddresses()
      if (!addresses) throw new Error('No wallet')
      // Match the shared tx-sender signatures (Electron calls these the same way).
      if (chain === 'solana') return estimateSolanaFee(config)
      if (chain === 'cardano') return estimateCardanoFee(addresses.cardano ?? '', config)
      if (chain === 'tron') return estimateTronFee(to, config)
      if (chain === 'dogecoin') {
        if (!addresses.dogecoin) throw new Error('No Dogecoin address found')
        return estimateDogecoinFee(addresses.dogecoin, to, amount)
      }
      if (chain === 'bitcoin') {
        if (!addresses.bitcoin) throw new Error('No Bitcoin address found')
        return estimateBitcoinFee(addresses.bitcoin, to, amount, await store.loadMnemonic(), addresses.accountIndex ?? 0)
      }
      if (chain === 'zcash') {
        if (!addresses.privacy?.zcashTransparent) throw new Error('No Zcash address found')
        return estimateZcashFee(addresses.privacy.zcashTransparent, to, amount)
      }
      if (chain === 'monero') return estimateMoneroFee(to, config)
      return estimateEvmFee(addresses.evm, to, amount, config, chain)
    }

    case 'wallet:send-evm': {
      const [chainId, to, amount] = [String(a0), String(a1), String(a2)]
      const mnemonic = await store.loadMnemonic()
      const config = await store.loadConfig()
      const addresses = await store.loadAddresses()
      return sendEvmTransaction(mnemonic, to, amount, config, chainId, addresses?.accountIndex ?? 0)
    }

    case 'wallet:send-solana': {
      const mnemonic = await store.loadMnemonic()
      const config = await store.loadConfig()
      return sendSolanaTransaction(mnemonic, String(a0), String(a1), config)
    }

    case 'wallet:send-cardano': {
      const addresses = await store.loadAddresses()
      const config = await store.loadConfig()
      if (!addresses) throw new Error('No wallet')
      const mnemonic = await store.loadMnemonic()
      return sendCardanoTransaction(mnemonic, addresses.cardano, String(a0), String(a1), config)
    }

    case 'wallet:send-tron': {
      const mnemonic = await store.loadMnemonic()
      const config = await store.loadConfig()
      const addresses = await store.loadAddresses()
      const token = a2 as { contractAddress: string; decimals: number } | undefined
      return sendTronTransaction(mnemonic, String(a0), String(a1), config, addresses?.accountIndex ?? 0, token)
    }

    case 'wallet:send-dogecoin': {
      const addresses = await loadFullAddresses()
      if (!addresses.dogecoin) throw new Error('No Dogecoin address found')
      const mnemonic = await store.loadMnemonic()
      return sendDogecoinTransaction(mnemonic, addresses.dogecoin, String(a0), String(a1), addresses.accountIndex ?? 0)
    }

    case 'wallet:send-bitcoin': {
      const addresses = await loadFullAddresses()
      if (!addresses.bitcoin) throw new Error('No Bitcoin address found')
      const mnemonic = await store.loadMnemonic()
      return sendBitcoinTransaction(mnemonic, addresses.bitcoin, String(a0), String(a1), addresses.accountIndex ?? 0)
    }

    case 'wallet:send-zcash': {
      const addresses = await loadFullAddresses()
      if (!addresses.privacy?.zcashTransparent) throw new Error('No Zcash address found')
      const mnemonic = await store.loadMnemonic()
      return sendZcashTransaction(mnemonic, addresses.privacy.zcashTransparent, String(a0), String(a1), addresses.accountIndex ?? 0)
    }

    case 'wallet:send-monero': {
      // Runs in the per-target Monero backend ('./monero' alias): the
      // extension proxies to its offscreen document; Android runs in-page.
      const config = await store.loadConfig()
      if (!config.privacyMode) throw new Error('Monero sends are only available in Privacy Mode')
      const mnemonic = await store.loadMnemonic()
      const addresses = await store.loadAddresses()
      return sendMoneroTransaction(mnemonic, String(a0), String(a1), config, addresses?.accountIndex ?? 0)
    }

    // ── Abstract Global Wallet: send + manual address override ──────────────
    case 'wallet:send-agw': {
      const to = String(a0)
      const amount = String(a1)
      const token = a2 as { contractAddress: string; decimals: number } | undefined
      const addresses = await loadFullAddresses()
      if (!addresses.agw) throw new Error('No Abstract Global Wallet linked for this account')
      if (!addresses.agwOwned) throw new Error('This wallet can’t sign for the linked AGW — it is watch-only')
      const mnemonic = await store.loadMnemonic()
      const config = await store.loadConfig()
      return sendAgwTransaction(mnemonic, to, amount, config, addresses.accountIndex ?? 0, { token, agwAddress: addresses.agw })
    }

    case 'wallet:set-agw': {
      const accountIndex = Number(a0)
      const address = a1 == null ? null : String(a1)
      if (accountIndex < 0 || accountIndex > 9) throw new Error('Account index must be 0–9')
      if (address != null) {
        const trimmed = address.trim()
        if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) throw new Error('Invalid Abstract address — must be a 0x… EVM address')
        await store.saveAgwOverride(accountIndex, trimmed)
      } else {
        await store.saveAgwOverride(accountIndex, null)
      }
      const current = await store.loadAddresses()
      if (current && (current.accountIndex ?? 0) === accountIndex) {
        const resolved = await resolveAgw(current)
        await store.saveAddresses(resolved)
        return resolved
      }
      return current
    }

    // ── Market ─────────────────────────────────────────────────────────────

    case 'wallet:get-market':
      return fetchMarketTop100(await store.loadConfig())

    case 'wallet:search-market':
      return searchMarketCoins(String(a0), await store.loadConfig())

    case 'wallet:get-coin-chart':
      return fetchCoinChart(String(a0), String(a1), await store.loadConfig())

    case 'wallet:get-tokens': {
      const addresses = await loadFullAddresses()
      const config = await store.loadConfig()
      return fetchAllTokens(
        { evm: addresses.evm, solana: addresses.solana, cardano: addresses.cardano, cardanoStake: addresses.cardanoStake, tron: addresses.tron, agw: addresses.agw, bitcoinTaproot: addresses.bitcoinTaproot },
        config
      )
    }

    case 'wallet:get-collectibles': {
      const addresses = await loadFullAddresses()
      const config = await store.loadConfig()
      const excludeIds = Array.isArray(a0) ? (a0 as string[]) : undefined
      // Returns as soon as items are fetched; the background floor pass pushes
      // the re-valued list to the popup/sidepanel when it completes.
      return fetchAllCollectibles(
        addresses.evm, addresses.cardano, config, addresses.solana, addresses.agw,
        addresses.tron, excludeIds, addresses.bitcoinTaproot,
        (updated) => { platform.pushToUi('collectibles:updated', updated) }
      )
    }

    case 'swap:getQuote': {
      const config = await store.loadConfig()
      return getSwapQuote(a0 as SwapQuoteRequest, config)
    }

    case 'swap:crossStatus': {
      const config = await store.loadConfig()
      return getCrossSwapStatus(a0 as CrossSwapStatusRequest, config)
    }

    case 'swap:execute': {
      const addresses = await store.loadAddresses()
      if (!addresses) throw new Error('No wallet')
      const config = await store.loadConfig()
      const mnemonic = await store.loadMnemonic()
      return executeSwap(a0 as NormalizedSwapQuote, mnemonic, config, addresses.accountIndex ?? 0)
    }

    case 'swap:getTokenList': {
      const config = await store.loadConfig()
      return getSwapTokenList(a0 as SwapChain, config)
    }

    case 'ss:estimate':
      return ssEstimate(a0 as SsEstimateParams, await store.loadConfig())

    case 'ss:create-exchange':
      return ssCreateExchange(a0 as SsCreateParams, await store.loadConfig())

    case 'ss:status':
      return ssGetStatus(String(a0), await store.loadConfig())

    case 'xchange:estimate':
      return xEstimate(a0 as SsEstimateParams, await store.loadConfig())

    case 'xchange:create':
      return xCreateExchange(a0 as XCreateParams, await store.loadConfig())

    case 'xchange:status':
      return xGetStatus(a0 as ExchangeProvider, String(a1), await store.loadConfig())

    case 'wallet:get-nft-floor':
      return fetchNftFloor(String(a0), String(a1), await store.loadConfig())

    // ── ChainLens profile ──────────────────────────────────────────────────

    case 'chainlens:get-profile': {
      const addresses = await store.loadAddresses()
      if (!addresses) return null
      const config = await store.loadConfig()
      return getProfileByAddress(addresses.evm, config)
    }

    case 'chainlens:sync': {
      const addresses = await store.loadAddresses()
      if (!addresses) return { success: false, profile: null, error: 'No wallet' }
      const config = await store.loadConfig()
      return syncWallets(addresses, config)
    }

    case 'chainlens:update-profile': {
      const updates = a0 as { display_name?: string; avatar_url?: string }
      const addresses = await store.loadAddresses()
      if (!addresses) return { success: false, error: 'No wallet' }
      const config = await store.loadConfig()
      return updateProfile(addresses.evm, updates, config)
    }

    // Extension can't open native file dialog — avatar picking not supported
    case 'chainlens:pick-avatar':
      return null

    // ── WalletConnect ──────────────────────────────────────────────────────

    case 'wc:get-sessions':          return wcGetSessions()
    case 'wc:get-pending-proposals': return wcGetPendingProposals()
    case 'wc:get-pending-requests':  return wcGetPendingRequests()
    case 'wc:pair':                 return wcPair(String(a0))
    case 'wc:approve-session':      return wcApproveSession(Number(a0))
    case 'wc:reject-session':       return wcRejectSession(Number(a0))
    case 'wc:disconnect':           return wcDisconnect(String(a0))
    case 'wc:approve-request':      return wcApproveRequest(Number(a0))
    case 'wc:reject-request':       return wcRejectRequest(Number(a0))

    // ── window.ethereum provider requests (from content.ts injection) ────

    // ── EVM chain switcher (extension UI, not web pages) ────────────────────
    // Drives the popup's NetworkSwitcher. Mirrors the Electron main-process
    // web3:get-chain / web3:get-chains / web3:set-chain IPC handlers.

    case 'web3:get-chain':
      return _currentChainId

    case 'web3:get-chains': {
      const config = await store.loadConfig()
      return activeEvmChains(config).map(c => ({ chainId: c.chainId, id: c.id, name: c.name, color: c.color }))
    }

    case 'web3:set-chain': {
      const target = typeof a0 === 'string' ? parseInt(a0, 16) : Number(a0)
      if (!Number.isFinite(target) || !(await isSupportedEvmChain(target))) {
        throw new Error('Unsupported network')
      }
      return applyChainSwitch(`0x${target.toString(16)}`)
    }

    case 'web3:request': {
      const { method, params = [] } = (a0 as { method: string; params?: unknown[] })
      const addresses = await store.loadAddresses()
      const senderOrigin = sender?.origin ?? 'unknown'

      switch (method) {

        // Passive check — return [] if not yet approved (no prompt)
        case 'eth_accounts': {
          if (!(await store.hasOriginChain(senderOrigin, 'evm'))) return []
          return addresses?.evm ? [addresses.evm] : []
        }

        // Active request — show approval prompt if not yet connected
        case 'eth_requestAccounts': {
          const approved = await store.getApprovedOrigins()
          if (approved.includes(senderOrigin)) {
            return addresses?.evm ? [addresses.evm] : []
          }
          // Queue approval — open popup and wait for user decision
          const id = crypto.randomUUID()
          return new Promise<string[]>((resolve, reject) => {
            _connectionQueue.set(id, { resolve: resolve as (value: unknown) => void, reject, origin: senderOrigin, tabId: sender?.tabId, chain: 'evm' })
            platform.requestApproval('web3:connection-request', { id, origin: senderOrigin })
            setTimeout(() => {
              if (_connectionQueue.has(id)) {
                _connectionQueue.delete(id)
                reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
              }
            }, 120_000)
          })
        }

        case 'eth_chainId':
          return _currentChainId

        case 'net_version':
          return String(parseInt(_currentChainId, 16))

        case 'personal_sign': {
          await requestSignatureApproval(sender, {
            chain: 'EVM',
            method: 'personal_sign',
            summary: 'Sign message',
            details: previewBytes(String(params[0] ?? '')),
          })
          const key = await deriveEvmKey()
          const acct = privateKeyToAccount(key)
          return acct.signMessage({ message: { raw: String(params[0]) as `0x${string}` } })
        }

        case 'eth_sign':
          // M-4: refused outright — raw-digest eth_sign is a blind-signing
          // footgun, and the old implementation returned an EIP-191
          // (personal_sign-scheme) signature no eth_sign caller could verify.
          // Mirrors the Electron handler (ipc-handlers.ts).
          throw Object.assign(
            new Error('eth_sign is not supported for security reasons. Use personal_sign or eth_signTypedData_v4.'),
            { code: 4200 }
          )

        case 'eth_signTypedData':
        case 'eth_signTypedData_v3':
        case 'eth_signTypedData_v4': {
          // v3/v4: params = [address, typedData]; legacy v1: params = [typedData, address]
          const rawPayload = method === 'eth_signTypedData' ? params[0] : params[1]
          const td = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload
          await requestSignatureApproval(sender, {
            chain: 'EVM',
            method,
            summary: `Sign typed data${td?.primaryType ? `: ${String(td.primaryType)}` : ''}`,
            details: previewBytes(JSON.stringify(td?.message ?? td ?? {})),
          })
          const key = await deriveEvmKey()
          const acct = privateKeyToAccount(key)
          const { EIP712Domain: _dom, ...types } = td.types ?? {}
          return acct.signTypedData({ domain: td.domain ?? {}, types, primaryType: td.primaryType, message: td.message })
        }

        case 'eth_sendTransaction': {
          await requireApprovedOrigin(sender, 'sending transactions', 'evm')
          const id = crypto.randomUUID()
          const tx = params[0] as Record<string, string>
          const txChainId = _currentChainId
          return new Promise((resolve, reject) => {
            const origin = sender?.origin ?? 'unknown'
            _web3TxQueue.set(id, { resolve, reject, origin, tx, chainId: txChainId })
            platform.requestApproval('web3:tx-request', { id, origin, chainId: txChainId, ...tx })
            setTimeout(() => {
              if (_web3TxQueue.has(id)) {
                _web3TxQueue.delete(id)
                reject(new Error('Transaction timed out — open the extension to approve'))
              }
            }, 120_000)
          })
        }

        // Switch to a different chain — validate, persist, fire chainChanged to all
        // tabs, and reflect in the extension UI. Unsupported chains reject with 4902
        // (EIP-3085), matching the Electron app.
        case 'wallet_switchEthereumChain': {
          const chainId = (params[0] as { chainId?: string })?.chainId
          const target = chainId ? parseInt(chainId, 16) : NaN
          if (!Number.isFinite(target) || !(await isSupportedEvmChain(target))) {
            throw Object.assign(
              new Error(`This wallet doesn't support network 0x${(target || 0).toString(16)}.`),
              { code: 4902 }
            )
          }
          // H-2: an unconnected page must not steer the wallet's network.
          // Same-chain requests stay silent; a real switch from a page needs a
          // connected origin (internal UI uses web3:set-chain, not this path).
          const targetHex = `0x${target.toString(16)}`
          if (sender?.kind === 'page' && targetHex !== _currentChainId) {
            await requireApprovedOrigin(sender, 'switching networks', 'evm')
          }
          applyChainSwitch(targetHex)
          return null
        }

        // We don't maintain a custom-chain list, but if the requested chain is one we
        // already support, honor it by switching (many dApps call add then switch).
        case 'wallet_addEthereumChain': {
          const addId = (params[0] as { chainId?: string })?.chainId
          const addTarget = addId ? parseInt(addId, 16) : NaN
          if (Number.isFinite(addTarget) && (await isSupportedEvmChain(addTarget))) {
            // H-2: same connected-origin gate as wallet_switchEthereumChain.
            const addHex = `0x${addTarget.toString(16)}`
            if (sender?.kind === 'page' && addHex !== _currentChainId) {
              await requireApprovedOrigin(sender, 'switching networks', 'evm')
            }
            applyChainSwitch(addHex)
          }
          return null
        }

        // EIP-2255 permissions
        case 'wallet_requestPermissions': {
          // Treat like eth_requestAccounts — prompt if not already approved
          if (!(await store.hasOriginChain(senderOrigin, 'evm'))) {
            await handle({ type: 'web3:request', args: [{ method: 'eth_requestAccounts', params: [] }] }, sender)
          }
          return [{ parentCapability: 'eth_accounts', caveats: [] }]
        }

        case 'wallet_getPermissions': {
          const approvedPerms = await store.getApprovedOrigins()
          if (!approvedPerms.includes(senderOrigin)) return []
          return [{ parentCapability: 'eth_accounts', caveats: [] }]
        }

        case 'wallet_revokePermissions': {
          await store.removeApprovedOrigin(senderOrigin, 'evm')
          platform.pushToDapps('accountsChanged', [])
          return null
        }

        // Proxy all other read-only RPC calls to the current chain's endpoint.
        // Monad rotates across its public set so a chatty dApp's reads survive any
        // one endpoint throttling; other chains use their single URL.
        default: {
          const chainNum = parseInt(_currentChainId, 16) || 1
          const rpcCfg = await store.loadConfig()
          const chainDef = EVM_CHAINS.find(c => c.chainId === chainNum)
          // Monad rotates its public set; every other chain tries its primary first
          // then the keyless PUBLIC_RPCS fallbacks (loop fails over on transport errors).
          const urls = chainNum === 143
            ? rotateMonadRpcs(MONAD_RPCS)
            : [chainDef?.rpcUrl(rpcCfg) ?? alchemyRpcUrl('eth-mainnet', rpcCfg), ...(chainDef ? (PUBLIC_RPCS[chainDef.id] ?? []) : [])]
          const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
          let lastErr: unknown = null
          for (const url of urls) {
            let rpcRes: Response
            // Only fail over on transport errors (timeout/connection/429/5xx);
            // a valid JSON-RPC error (e.g. revert) is surfaced as-is.
            try {
              rpcRes = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(8_000)
              })
            } catch (e) { lastErr = e; continue }
            if (!rpcRes.ok) { lastErr = new Error(`RPC error ${rpcRes.status}: ${method}`); continue }
            const rpcJson = await rpcRes.json().catch(() => null) as { result?: unknown; error?: { message: string; code?: number } } | null
            if (!rpcJson) { lastErr = new Error('Malformed RPC response'); continue }
            if (rpcJson.error) throw Object.assign(new Error(rpcJson.error.message), { code: rpcJson.error.code })
            return rpcJson.result
          }
          throw lastErr instanceof Error ? lastErr : new Error(`RPC failed: ${method}`)
        }
      }
    }

    // ── Bitcoin (window.unisat) dApp handlers ────────────────────────────────

    case 'bitcoin:get-accounts': {
      const btcAddrs = await store.loadAddresses()
      return btcAddrs?.bitcoin ? [btcAddrs.bitcoin] : []
    }

    case 'bitcoin:request-accounts': {
      const btcOrigin = sender?.origin ?? 'unknown'
      if (await store.hasOriginChain(btcOrigin, 'bitcoin')) {
        const btcAddrs = await store.loadAddresses()
        return btcAddrs?.bitcoin ? [btcAddrs.bitcoin] : []
      }
      const btcId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        _connectionQueue.set(btcId, { resolve, reject, origin: btcOrigin, tabId: sender?.tabId, chain: 'bitcoin' })
        platform.requestApproval('web3:connection-request', { id: btcId, origin: btcOrigin })
        setTimeout(() => {
          if (_connectionQueue.has(btcId)) {
            _connectionQueue.delete(btcId)
            reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
          }
        }, 120_000)
      })
    }

    case 'bitcoin:request-addresses': {
      const btcOrigin = sender?.origin ?? 'unknown'
      const toHex = (u: Uint8Array) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('')
      const build = async () => {
        const a = await loadFullAddresses()
        const acct = a.accountIndex ?? 0
        const mn = await store.loadMnemonic()
        const [nat, tap] = await Promise.all([getBitcoinKey(mn, acct), getBitcoinTaprootKey(mn, acct)])
        const all = [
          { address: a.bitcoin, publicKey: toHex(nat.publicKey), purpose: 'payment', addressType: 'p2wpkh' },
          { address: a.bitcoinTaproot, publicKey: toHex(tap.publicKey.slice(1)), purpose: 'ordinals', addressType: 'p2tr' },
        ]
        const want = Array.isArray(a0) ? (a0 as string[]) : ['payment', 'ordinals']
        return { addresses: all.filter(x => want.includes(x.purpose)) }
      }
      if (await store.hasOriginChain(btcOrigin, 'bitcoin')) return build()
      const reqId = crypto.randomUUID()
      await new Promise<void>((resolve, reject) => {
        _connectionQueue.set(reqId, { resolve: () => resolve(), reject, origin: btcOrigin, tabId: sender?.tabId, chain: 'bitcoin' })
        platform.requestApproval('web3:connection-request', { id: reqId, origin: btcOrigin })
        setTimeout(() => { if (_connectionQueue.has(reqId)) { _connectionQueue.delete(reqId); reject(Object.assign(new Error('User rejected the request.'), { code: 4001 })) } }, 120_000)
      })
      return build()
    }

    case 'bitcoin:get-public-key': {
      const btcMnemonic = await store.loadMnemonic()
      const btcAddrs = await store.loadAddresses()
      const { publicKey: btcPub } = await getBitcoinKey(btcMnemonic, btcAddrs?.accountIndex ?? 0)
      return Array.from(btcPub).map(b => b.toString(16).padStart(2, '0')).join('')
    }

    case 'bitcoin:get-balance': {
      const btcAddrs = await store.loadAddresses()
      if (!btcAddrs?.bitcoin) throw new Error('No Bitcoin wallet')
      const btcRes = await fetch(`https://mempool.space/api/address/${btcAddrs.bitcoin}`, { signal: AbortSignal.timeout(10_000) })
      if (!btcRes.ok) throw new Error(`mempool.space error: ${btcRes.status}`)
      const btcData = await btcRes.json() as {
        chain_stats: { funded_txo_sum: number; spent_txo_sum: number }
        mempool_stats: { funded_txo_sum: number; spent_txo_sum: number }
      }
      const confirmed   = btcData.chain_stats.funded_txo_sum   - btcData.chain_stats.spent_txo_sum
      const unconfirmed = btcData.mempool_stats.funded_txo_sum - btcData.mempool_stats.spent_txo_sum
      return { confirmed, unconfirmed, total: confirmed + unconfirmed }
    }

    case 'bitcoin:sign-message': {
      // BIP-137 over the Native-SegWit key (the old inline impl used a P2PKH header).
      await requestSignatureApproval(sender, {
        chain: 'Bitcoin',
        method: 'signMessage',
        summary: 'Sign Bitcoin message',
        details: previewBytes(String(a0 ?? '')),
      })
      const btcAddrs = await store.loadAddresses()
      return signBitcoinMessage(String(a0), 'native', await store.loadMnemonic(), btcAddrs?.accountIndex ?? 0)
    }

    case 'bitcoin:sign-psbt': {
      const btcOrigin = sender?.origin ?? 'unknown'
      if (!(await store.hasOriginChain(btcOrigin, 'bitcoin'))) throw Object.assign(new Error('Connect the wallet before signing.'), { code: 4100 })
      await requestSignatureApproval(sender, {
        chain: 'Bitcoin',
        method: 'signPsbt',
        summary: 'Sign Bitcoin PSBT',
        details: previewBytes(String(a0 ?? '')),
      })
      const btcAddrs = await loadFullAddresses()
      const o = (a1 ?? {}) as { signInputs?: Record<string, number[]>; autoFinalized?: boolean; broadcast?: boolean }
      const req: PsbtSignRequest = { psbt: String(a0), signInputs: o.signInputs, finalize: o.autoFinalized !== false, extractTx: !!o.broadcast }
      const signed = await signBitcoinPsbt(req, await store.loadMnemonic(), btcAddrs, btcAddrs.accountIndex ?? 0)
      let txid: string | undefined
      if (o.broadcast && signed.txHex) txid = await broadcastBitcoin(signed.txHex)
      return { psbtHex: signed.psbtHex, psbtBase64: signed.psbtBase64, txid }
    }

    case 'bitcoin:push-psbt': {
      const rawTxHex = String(a0)
      const pushRes = await fetch('https://mempool.space/api/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: rawTxHex,
        signal: AbortSignal.timeout(15_000)
      })
      if (!pushRes.ok) throw new Error(`Broadcast failed: ${pushRes.status}`)
      return await pushRes.text()
    }

    case 'bitcoin:send': {
      const btcOrigin = sender?.origin ?? 'unknown'
      if (!(await store.hasOriginChain(btcOrigin, 'bitcoin'))) throw Object.assign(new Error('Connect the wallet before sending.'), { code: 4100 })
      await requestSignatureApproval(sender, {
        chain: 'Bitcoin',
        method: 'sendBitcoin',
        summary: `Send ${(Number(a1) / 1e8).toFixed(8)} BTC`,
        details: `To ${String(a0)}`,
      })
      const btcAddrs = await loadFullAddresses()
      const btcAmount = (Number(a1) / 1e8).toFixed(8)
      const res = await sendBtc(await store.loadMnemonic(), btcAddrs.bitcoin, String(a0), btcAmount, btcAddrs.accountIndex ?? 0)
      return res.txHash
    }

    // ── Polkadot (window.injectedWeb3) dApp handlers ──────────────────────────

    case 'polkadot:enable': {
      const dotOrigin = sender?.origin ?? 'unknown'
      if (await store.hasOriginChain(dotOrigin, 'polkadot')) return true
      const dotId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        _connectionQueue.set(dotId, { resolve, reject, origin: dotOrigin, tabId: sender?.tabId, chain: 'polkadot' })
        platform.requestApproval('web3:connection-request', { id: dotId, origin: dotOrigin })
        setTimeout(() => {
          if (_connectionQueue.has(dotId)) {
            _connectionQueue.delete(dotId)
            reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
          }
        }, 120_000)
      })
    }

    case 'polkadot:get-accounts': {
      const dotAddrs = await store.loadAddresses()
      if (!dotAddrs?.polkadot) return []
      return [{ address: dotAddrs.polkadot, name: 'MagicMoney', type: 'ed25519' }]
    }

    case 'polkadot:sign-payload': {
      const dotPayload = a0 as { method?: string; [k: string]: unknown }
      await requestSignatureApproval(sender, {
        chain: 'Polkadot',
        method: 'signPayload',
        summary: 'Sign Polkadot payload',
        details: previewBytes(JSON.stringify(dotPayload)),
      })
      const dotMnemonic = await store.loadMnemonic()
      const dotAddrs = await store.loadAddresses()
      const { privateKey: dotPriv } = await getPolkadotKey(dotMnemonic, dotAddrs?.accountIndex ?? 0)
      const { ed25519: dotEd } = await import('@noble/curves/ed25519')
      const { blake2b: dotBlake } = await import('@noble/hashes/blake2b')
      const methodHex = (dotPayload.method ?? '').replace(/^0x/, '')
      const dataBytes = new Uint8Array((methodHex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)))
      const toSign = dataBytes.length > 256 ? dotBlake(dataBytes, { dkLen: 32 }) : dataBytes
      const sig = dotEd.sign(toSign, dotPriv)
      return { id: Math.floor(Math.random() * 0xffffff), signature: `0x${Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('')}` }
    }

    case 'polkadot:sign-raw': {
      const dotRaw = a0 as { data?: string }
      await requestSignatureApproval(sender, {
        chain: 'Polkadot',
        method: 'signRaw',
        summary: 'Sign Polkadot raw data',
        details: previewBytes(dotRaw.data ?? ''),
      })
      const dotMnemonic = await store.loadMnemonic()
      const dotAddrs = await store.loadAddresses()
      const { privateKey: dotPriv2 } = await getPolkadotKey(dotMnemonic, dotAddrs?.accountIndex ?? 0)
      const { ed25519: dotEd2 } = await import('@noble/curves/ed25519')
      const dataHex = (dotRaw.data ?? '').replace(/^0x/, '')
      const dataBytes = new Uint8Array((dataHex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)))
      const sig = dotEd2.sign(dataBytes, dotPriv2)
      return { id: Math.floor(Math.random() * 0xffffff), signature: `0x${Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('')}` }
    }

    // ── dApp connection approval ───────────────────────────────────────────────

    case 'web3:get-pending-connections':
      return [..._connectionQueue.entries()].map(([id, { origin }]) => ({ id, origin }))

    case 'web3:approve-connection': {
      const { id } = a0 as { id: string }
      const entry = _connectionQueue.get(id)
      if (!entry) throw new Error('Connection request not found')
      _connectionQueue.delete(id)
      const connAddresses = await store.loadAddresses()
      // Scope the grant to the chain the site actually asked to connect for.
      await store.addApprovedOrigin(entry.origin, entry.chain as DappChain)
      if (entry.chain === 'cardano' || entry.chain === 'polkadot') {
        entry.resolve(true)
      } else if (entry.chain === 'solana') {
        entry.resolve(connAddresses?.solana ?? '')
      } else if (entry.chain === 'bitcoin') {
        entry.resolve(connAddresses?.bitcoin ? [connAddresses.bitcoin] : [])
      } else {
        const addrs = connAddresses?.evm ? [connAddresses.evm] : []
        entry.resolve(addrs)
        platform.pushToDappTab(entry.tabId, 'connect',         { chainId: _currentChainId })
        platform.pushToDappTab(entry.tabId, 'accountsChanged', addrs)
      }
      return true
    }

    case 'web3:reject-connection': {
      const { id } = a0 as { id: string }
      const entry = _connectionQueue.get(id)
      if (entry) {
        entry.reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
        _connectionQueue.delete(id)
      }
      return true
    }

    case 'web3:get-pending-tx':
      return [..._web3TxQueue.entries()].map(([id, { tx, chainId: c, origin }]) => ({ id, origin, chainId: c, ...tx }))

    case 'web3:approve-tx': {
      const { id } = a0 as { id: string; chainId?: string }
      const entry = _web3TxQueue.get(id)
      if (!entry) throw new Error('Pending transaction not found')
      _web3TxQueue.delete(id)
      // Delegate to the SHARED multi-chain sender (same code the Electron app uses
      // for dApp sends). It builds the viem client with a real per-chain object —
      // which carries the EIP-1559 fee config — and the shared evmTransport (Monad
      // RPC rotation + keyed Ankr/Tatum fallback). The old hand-rolled path used
      // `chain: null`, so viem had to auto-derive fees over live RPC; on Monad that
      // preparation hung and the dApp timed out after Approve.
      const config = await store.loadConfig()
      const addresses = await store.loadAddresses()
      const numId = parseInt(entry.chainId ?? '1', 16) || 1
      try {
        const { txHash } = await sendRawEvmTransaction(
          await store.loadMnemonic(),
          { to: entry.tx.to ?? '', data: entry.tx.data, value: entry.tx.value, gas: entry.tx.gas, chainId: numId },
          config,
          addresses?.accountIndex ?? 0
        )
        entry.resolve(txHash)
        return txHash
      } catch (err) {
        const clean = err instanceof Error ? err : new Error(String(err))
        entry.reject(clean)
        throw clean
      }
    }

    case 'web3:reject-tx': {
      const id = String(a0)
      const entry = _web3TxQueue.get(id)
      if (entry) { entry.reject(new Error('User rejected the transaction')); _web3TxQueue.delete(id) }
      return true
    }

    case 'web3:get-pending-sign':
      return [..._web3SignQueue.entries()].map(([id, req]) => ({ id, origin: req.origin, chain: req.chain, method: req.method, summary: req.summary, details: req.details }))

    case 'web3:approve-sign': {
      const id = String(a0)
      const entry = _web3SignQueue.get(id)
      if (!entry) throw new Error('Pending signature request not found')
      _web3SignQueue.delete(id)
      entry.resolve()
      return true
    }

    case 'web3:reject-sign': {
      const id = String(a0)
      const entry = _web3SignQueue.get(id)
      if (entry) { entry.reject(Object.assign(new Error('User rejected the signature request'), { code: 4001 })); _web3SignQueue.delete(id) }
      return true
    }

    // ── window.solana provider requests ───────────────────────────────────

    case 'web3:solana:connect': {
      const solOrigin = sender?.origin ?? 'unknown'
      const addresses = await store.loadAddresses()
      if (!addresses?.solana) throw new Error('No Solana wallet')
      if (await store.hasOriginChain(solOrigin, 'solana')) return addresses.solana
      const solId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        _connectionQueue.set(solId, { resolve, reject, origin: solOrigin, tabId: sender?.tabId, chain: 'solana' })
        platform.requestApproval('web3:connection-request', { id: solId, origin: solOrigin })
        setTimeout(() => {
          if (_connectionQueue.has(solId)) {
            _connectionQueue.delete(solId)
            reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
          }
        }, 120_000)
      })
    }

    case 'web3:solana:sign': {
      const bytes = new Uint8Array(a0 as number[])
      await requestSignatureApproval(sender, {
        chain: 'Solana',
        method: 'signMessage',
        summary: 'Sign Solana message',
        details: formatSolanaMessage(bytes),
      })
      const mnemonic = await store.loadMnemonic()
      const addresses = await store.loadAddresses()
      const keypair = await getSolanaKeypair(mnemonic, addresses?.accountIndex ?? 0)
      // @solana/web3.js Keypair has NO .sign() method. Ed25519-sign the raw
      // message bytes with the 32-byte seed (secretKey = seed||pubkey).
      const { ed25519 } = await import('@noble/curves/ed25519')
      return Array.from(ed25519.sign(bytes, keypair.secretKey.slice(0, 32)))
    }

    case 'web3:solana:sign-and-send': {
      const input = a0 as { transaction?: number[] | Uint8Array }
      if (!input?.transaction) throw new Error('No transaction data provided')
      const txBytes = input.transaction instanceof Uint8Array ? input.transaction : new Uint8Array(input.transaction as number[])
      const sendSummary = await describeSolanaForApproval(txBytes)
      await requestSignatureApproval(sender, {
        chain: 'Solana',
        method: 'signAndSendTransaction',
        summary: solanaHeadline(sendSummary),
        details: formatSolanaTxSummary(sendSummary),
      })
      const solMnemonic = await store.loadMnemonic()
      const solAddresses = await store.loadAddresses()
      const solConfig = await store.loadConfig()
      const { VersionedTransaction, Connection: SolConnection } = await import('@solana/web3.js')
      const solKeypair = await getSolanaKeypair(solMnemonic, solAddresses?.accountIndex ?? 0)
      const solTx = VersionedTransaction.deserialize(txBytes)
      solTx.sign([solKeypair])
      const solConn = new SolConnection(heliusRpcUrl(solConfig), 'confirmed')
      const solSig = await solConn.sendRawTransaction(solTx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' })
      return { signature: solSig }
    }

    case 'web3:solana:sign-tx': {
      const txBytes = new Uint8Array(a0 as number[])
      const signSummary = await describeSolanaForApproval(txBytes)
      await requestSignatureApproval(sender, {
        chain: 'Solana',
        method: 'signTransaction',
        summary: solanaHeadline(signSummary),
        details: formatSolanaTxSummary(signSummary),
      })
      const solMnemonic2 = await store.loadMnemonic()
      const solAddresses2 = await store.loadAddresses()
      const { VersionedTransaction: VT2 } = await import('@solana/web3.js')
      const solKeypair2 = await getSolanaKeypair(solMnemonic2, solAddresses2?.accountIndex ?? 0)
      const solTx2 = VT2.deserialize(txBytes)
      solTx2.sign([solKeypair2])
      return Array.from(solTx2.serialize())
    }

    // ── CIP-30 Cardano dApp connectivity ──────────────────────────────────
    // Gated on a CARDANO grant, not merely a known origin: the reads expose
    // holdings and submit-tx broadcasts, so an EVM-only connection must not
    // reach them. Mirrors the Electron handlers in ../main/ipc-handlers.ts.

    case 'cardano:is-enabled':
      return store.hasOriginChain(sender?.origin ?? 'unknown', 'cardano')

    case 'cardano:enable': {
      const senderOriginCardano = sender?.origin ?? 'unknown'
      if (await store.hasOriginChain(senderOriginCardano, 'cardano')) return true
      const id = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        _connectionQueue.set(id, { resolve, reject, origin: senderOriginCardano, tabId: sender?.tabId, chain: 'cardano' })
        platform.requestApproval('web3:connection-request', { id, origin: senderOriginCardano })
        setTimeout(() => {
          if (_connectionQueue.has(id)) {
            _connectionQueue.delete(id)
            reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
          }
        }, 120_000)
      })
    }

    // 1 = mainnet, 0 = testnet. Must track Testnet Mode — reporting mainnet
    // while handing out addr_test… addresses makes dApps build unusable txs.
    case 'cardano:get-network-id': {
      await requireCardanoGrant(sender)
      return (await store.loadConfig()).testnetMode ? 0 : 1
    }

    case 'cardano:get-balance': {
      await requireCardanoGrant(sender)
      const { address } = await cardanoDappAddress()
      return cip30GetBalance(address, await store.loadConfig())
    }

    case 'cardano:get-utxos': {
      await requireCardanoGrant(sender)
      const { address } = await cardanoDappAddress()
      return cip30GetUtxos(address, await store.loadConfig())
    }

    case 'cardano:get-collateral': {
      await requireCardanoGrant(sender)
      const { address } = await cardanoDappAddress()
      return cip30GetCollateral(address, await store.loadConfig(), a0 ? String(a0) : undefined)
    }

    case 'cardano:get-used-addresses': {
      await requireCardanoGrant(sender)
      // CIP-30 requires hex-encoded address bytes, not bech32.
      const { address } = await cardanoDappAddress()
      return [addressToHex(address)]
    }

    case 'cardano:get-unused-addresses':
      await requireCardanoGrant(sender)
      return []

    case 'cardano:get-change-address': {
      await requireCardanoGrant(sender)
      const { address } = await cardanoDappAddress()
      return addressToHex(address)
    }

    case 'cardano:get-reward-addresses': {
      await requireCardanoGrant(sender)
      const { accountIndex } = await cardanoDappAddress()
      const cfg = await store.loadConfig()
      return cip30GetRewardAddresses(await store.loadMnemonic(), accountIndex, !!cfg.testnetMode)
    }

    case 'cardano:sign-tx': {
      const txHex = String(a0)
      const { address, accountIndex } = await cardanoDappAddress()
      const summary = await describeCardanoTxForApproval(txHex, address, accountIndex)
      await requestSignatureApproval(sender, {
        chain: 'Cardano',
        method: 'signTx',
        summary: cardanoApprovalHeadline(summary),
        details: formatCardanoTxSummary(summary),
      })
      try {
        return await cip30SignTx(txHex, await store.loadMnemonic(), accountIndex)
      } catch (err) {
        throw new Error(`Could not sign this Cardano transaction — the dApp may have sent it in an unexpected format. (${err instanceof Error ? err.message : String(err)})`)
      }
    }

    case 'cardano:sign-data': {
      const [addrArg, payloadHex] = [String(a0), String(a1)]
      await requestSignatureApproval(sender, {
        chain: 'Cardano',
        method: 'signData',
        summary: 'Sign Cardano data',
        details: formatSignDataPayload(payloadHex),
      })
      const { address, accountIndex } = await cardanoDappAddress()
      try {
        return await cip30SignData(addrArg || address, payloadHex, await store.loadMnemonic(), accountIndex)
      } catch (err) {
        throw new Error(`Could not sign this Cardano data payload. (${err instanceof Error ? err.message : String(err)})`)
      }
    }

    // Broadcasting is a state change, so it is gated AND approved — without
    // this an unconnected page could push arbitrary CBOR straight to the network.
    case 'cardano:submit-tx': {
      const submitHex = String(a0)
      const { address, accountIndex } = await cardanoDappAddress()
      const summary = await describeCardanoTxForApproval(submitHex, address, accountIndex)
      await requestSignatureApproval(sender, {
        chain: 'Cardano',
        method: 'submitTx',
        summary: 'Broadcast Cardano transaction',
        details: formatCardanoTxSummary(summary),
      })
      return cip30SubmitTx(submitHex, await store.loadConfig())
    }

    // ── Side panel ────────────────────────────────────────────────────────

    case 'sidePanel:open':
      return platform.openSidePanel()

    case 'sidePanel:close':
      return platform.closeSidePanel()

    // ── Window controls (no-op in extension) ──────────────────────────────
    case 'window:minimize':
    case 'window:close':
      return

    default:
      throw new Error(`Unknown message type: ${msg.type}`)
  }
}
