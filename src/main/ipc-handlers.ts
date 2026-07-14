/**
 * ipc-handlers.ts — MagicMoney Wallet
 *
 * All IPC channels the renderer can invoke via the preload bridge.
 * The renderer ONLY gets back public addresses, balances, and status booleans.
 * Keys and mnemonics are consumed and discarded within these handlers.
 */

import { ipcMain, BrowserWindow, dialog, app } from 'electron'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { privateKeyToAccount } from 'viem/accounts'
import { ed25519 } from '@noble/curves/ed25519'
import {
  generateMnemonic,
  validateMnemonic,
  deriveAddresses,
  deriveTestnetAddresses,
  derivePrivacyAddresses,
  getSolanaKeypair,
  getBitcoinKey,
  getBitcoinTaprootKey
} from './wallet-core'
import {
  signBitcoinPsbt,
  signBitcoinMessage,
  broadcastBitcoin,
  getBitcoinAddressBalance,
  type PsbtSignRequest
} from './bitcoin'
import {
  saveMnemonic,
  loadMnemonic,
  walletExists,
  deleteWallet,
  saveAddresses,
  loadAddresses,
  effectiveAddresses,
  loadConfig,
  saveConfig,
  getApprovedOrigins,
  addApprovedOrigin,
  removeApprovedOrigin,
  clearApprovedOrigins,
  loadAgwOverride,
  saveAgwOverride,
  unlock,
  lock,
  isUnlocked,
  needsMigration,
  migrateLegacy,
  verifyPassword,
  hasHelloUnlock,
  enrollHello,
  unlockWithHello,
  removeHello,
  bioSupported,
  bioMethod,
  type WalletConfig
} from './secure-store'
import { resolveAccountAgw } from './agw'
import type { WalletAddresses } from './wallet-core'
import {
  openBrowserWindow,
  closeBrowserWindow,
  browserNavigate,
  browserBack,
  browserForward,
  browserReload,
  browserHome,
  browserNewTab,
  browserSetActiveTab,
  browserCloseTab,
  browserSuspendTabsMenu,
  browserResumeTabsMenu,
  getBrowserState,
  getMainWin,
  showApprovalWindow,
  emitDappEvent,
  notifyBrowserChrome,
  layoutSnap,
  layoutDetach,
  layoutToggle,
  getLayoutState,
  browserToggleMaximize,
  setChromeHeight
} from './browser-manager'
import { MONAD_RPCS, activeEvmChains, activePublicRpcs, defaultDappChainId, isTestnet, isPrivacy } from './chain-config'
import { getDappChainId, setDappChainId } from './dapp-chain'
import { startUpdateCheck, getUpdateState, installUpdate } from './update-manager'
import { openseaFetch, heliusRpcUrl, canOpensea, tatumRpcUrl } from './api-proxy'
import { fetchAllBalances } from './balance-fetcher'
import { fetchAllHistory } from './tx-history'
import { fetchMarketTop100, searchMarketCoins, fetchCoinChart } from './market-fetcher'
import { fetchAllTokens, fetchAllCollectibles } from './token-fetcher'
import { getSwapQuote, getSwapTokenList, getCrossSwapStatus, type SwapQuoteRequest, type SwapChain, type NormalizedSwapQuote, type CrossSwapStatusRequest } from './swap-proxy'
import { executeSwap } from './swap-executor'
import { ssEstimate, ssCreateExchange, ssGetStatus, type SsEstimateParams, type SsCreateParams } from './simpleswap-client'
import { xEstimate, xCreateExchange, xGetStatus, type XCreateParams, type ExchangeProvider } from './xchange-client'
import { syncWallets, getProfileByAddress, updateProfile } from './supabase-sync'
import {
  wcGetSessions, wcGetPendingProposals,
  wcPair, wcApproveSession, wcRejectSession,
  wcDisconnect, wcApproveRequest, wcRejectRequest
} from './wc-client'
import {
  estimateEvmFee,
  estimateSolanaFee,
  estimateCardanoFee,
  estimateTronFee,
  estimateDogecoinFee,
  estimateBitcoinFee,
  sendEvmTransaction,
  sendRawEvmTransaction,
  sendAgwTransaction,
  sendSolanaTransaction,
  sendCardanoTransaction,
  sendTronTransaction,
  sendDogecoinTransaction,
  sendBitcoinTransaction,
  estimateMoneroFee,
  estimateZcashFee,
  sendMoneroTransaction,
  sendZcashTransaction
} from './tx-sender'
import {
  cip30GetBalance, cip30GetUtxos, cip30GetRewardAddresses, cip30GetCollateral,
  cip30SignTx, cip30SignData, cip30SubmitTx, addressToHex,
} from './cardano-cip30'
import { describeEvmSend, describeTypedData } from './tx-describe'
import { validateAddress } from './address-validate'

// ── Key derivation helpers (used by web3 IPC) ──────────────────────────────

function deriveEvmKey(mnemonic: string, accountIndex: number): `0x${string}` {
  const seed = mnemonicToSeedSync(mnemonic)
  const hd = HDKey.fromMasterSeed(seed)
  const child = hd.derive(`m/44'/60'/${accountIndex}'/0/0`)
  if (!child.privateKey) throw new Error('Failed to derive private key')
  return `0x${Buffer.from(child.privateKey).toString('hex')}` as `0x${string}`
}

// ── dApp EVM chain state ─────────────────────────────────────────────────────
// The active network lives in dapp-chain.ts (getDappChainId/setDappChainId) so it
// can be shared with browser-manager, which RESETS it to Ethereum when the browser
// navigates to a new dApp origin — otherwise a prior dApp's chain (e.g. nad.fun on
// Monad) leaks into the next one (e.g. Compound → "unsupported network").

/**
 * Look up a supported EVM network by numeric chainId (shared chain-config).
 * Mode-aware: in Testnet Mode only testnet chains resolve, so dApp requests for
 * mainnet chainIds are rejected as unsupported (4902) and vice versa.
 */
function evmChainById(chainId: number) {
  return activeEvmChains(loadConfig()).find(c => c.chainId === chainId)
}

/**
 * Sign + broadcast a dApp's eth_sendTransaction on the currently-selected chain.
 * Delegates to the shared multi-chain sender (viem fills nonce/fees, EIP-1559,
 * per-chain RPC) instead of the old hand-rolled mainnet-only path.
 */
async function sendEvmFromDapp(
  mnemonic: string,
  accountIndex: number,
  tx: { to?: string; value?: string; data?: string; gas?: string; chainId?: string },
  config: WalletConfig
): Promise<string> {
  const chainId = tx.chainId ? (parseInt(tx.chainId, 16) || getDappChainId()) : getDappChainId()
  const { txHash } = await sendRawEvmTransaction(
    mnemonic,
    { to: tx.to ?? '', data: tx.data, value: tx.value, gas: tx.gas, chainId },
    config,
    accountIndex
  )
  return txHash
}

/**
 * M-9: signing, sending, and chain-switching require a CONNECTED origin. We
 * don't hard-reject with 4100 like the extension does — popup auth flows (AGW/
 * Privy "Login with Wallet") sign from popup origins that never called
 * eth_requestAccounts, so a hard reject would break them. Instead an unknown
 * origin gets the standard connect prompt first; only after the user explicitly
 * connects does the actual request proceed (with its own approval window).
 */
async function ensureConnectedOrigin(
  origin: string,
  addresses: WalletAddresses | null
): Promise<void> {
  if (getApprovedOrigins().includes(origin)) return
  const approved = await showApprovalWindow({
    title: 'Connect Wallet',
    heading: `${origin} wants to connect to your wallet`,
    detail: `EVM Address:\n${addresses?.evm ?? 'Not available'}`,
    confirmLabel: 'Connect',
    origin
  })
  if (!approved) {
    throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
  }
  addApprovedOrigin(origin)
}

// In-memory session cache of the confirmed mnemonic (cleared after save)
// This holds the phrase after generation/import but BEFORE the user sets a
// password (wallet:set-password), which is when it's actually persisted.
let _pendingMnemonic: string | null = null

// ── Idle auto-lock ────────────────────────────────────────────────────────────
// The decrypted mnemonic lives only in secure-store's memory after unlock. We
// clear it after a period with no activity and tell every window to show the
// unlock screen. touchActivity() is called from unlock + signing paths AND from
// genuine UI interaction (the renderer's throttled 'wallet:activity' ping — mouse/
// keyboard/scroll). Background polled reads (balances/tokens/NFTs) deliberately do
// NOT reset it, so the wallet still locks when the USER is idle but never locks
// mid-use while they're actively scrolling or typing.
const AUTO_LOCK_MS = 15 * 60_000
let _lockTimer: NodeJS.Timeout | null = null

function broadcastLocked(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.webContents.send('wallet:locked') } catch { /* window torn down */ }
  }
}

function touchActivity(): void {
  if (_lockTimer) { clearTimeout(_lockTimer); _lockTimer = null }
  if (!isUnlocked()) return
  _lockTimer = setTimeout(() => { lock(); broadcastLocked() }, AUTO_LOCK_MS)
}

/**
 * Resolve the Abstract Global Wallet for an account:
 *   agw      = manual override ?? on-chain linked AGW (no counterfactual guessing)
 *   agwOwned = this EOA is a real on-chain K1 owner of the AGW → direct send works.
 *              Most AGWs are owned by a Privy embedded signer, so this is usually
 *              false and the AGW is shown read-only (writes go via the portal).
 * Returns a new object — never mutates the input. On RPC failure agw is left
 * undefined so the next read retries.
 */
async function resolveAgw(addresses: WalletAddresses): Promise<WalletAddresses> {
  const override = loadAgwOverride(addresses.accountIndex ?? 0)
  const { agw, agwOwned } = await resolveAccountAgw(addresses.evm, override)
  return { ...addresses, agw, agwOwned }
}

/**
 * Load addresses, auto-migrating if newer fields (bitcoin, polkadot) are absent.
 * Wallets created before those chains were added won't have them in addresses.json.
 * The AGW is resolved + persisted lazily on first read (and re-resolved while it
 * remains unresolved, e.g. after an RPC failure).
 */
async function getFullAddresses() {
  let stored = loadAddresses()
  if (!stored) throw new Error('No addresses found — wallet not set up')
  if (!stored.bitcoin || !stored.bitcoinNested || !stored.bitcoinTaproot || !stored.polkadot || !stored.tron || !stored.dogecoin) {
    // Re-derive from mnemonic to fill in missing fields (drops any resolved agw)
    stored = await deriveAddresses(loadMnemonic(), stored.accountIndex ?? 0)
    saveAddresses(stored)
  }
  // Resolve the AGW once (agwOwned is always set afterwards, even when there's
  // no AGW — so this won't re-query the resolver on every read).
  if (stored.agwOwned === undefined) {
    stored = await resolveAgw(stored)
    saveAddresses(stored)
  }
  const config = loadConfig()
  // Testnet Mode: backfill the testnet-encoded address set (Bitcoin tb1…, Cardano
  // addr_test…) if it isn't cached yet. Needs the seed, so only while unlocked —
  // the Settings toggle derives it eagerly, this covers pre-existing configs.
  if (isTestnet(config) && !stored.testnet && isUnlocked()) {
    stored = { ...stored, testnet: await deriveTestnetAddresses(loadMnemonic(), stored.accountIndex ?? 0) }
    saveAddresses(stored)
  }
  // Privacy Mode: same lazy backfill for the privacy chain set (XMR/ZEC/NIGHT).
  // Also re-derives when a pre-Midnight cache lacks the midnight fields —
  // Electron main always derives them (ledger-v9 WASM is available here).
  if (isPrivacy(config) && (!stored.privacy || !stored.privacy.midnight) && isUnlocked()) {
    stored = { ...stored, privacy: await derivePrivacyAddresses(loadMnemonic(), stored.accountIndex ?? 0) }
    saveAddresses(stored)
  }
  // In Testnet Mode callers receive the testnet-substituted set (and no AGW).
  return effectiveAddresses(stored, config)
}

function getSenderOrigin(url: string): string {
  try { return new URL(url).origin } catch { return 'unknown' }
}

// ── Forwarded read-RPC de-dup + tiny TTL cache ───────────────────────────────
// Connected dApps poll the same reads repeatedly. Coalescing concurrent
// identical calls into one fetch (always safe — same params, same result) and
// briefly caching the highest-frequency block/gas reads cuts redundant Alchemy
// round-trips and main-thread JSON work while a dApp is connected.
const RPC_TTL_METHODS = new Set(['eth_blockNumber', 'eth_gasPrice'])
const rpcInflight = new Map<string, Promise<unknown>>()
const rpcTtlCache = new Map<string, { value: unknown; expires: number }>()

const MONAD_CHAIN_ID = 143
let _monadRpcCursor = 0

/**
 * RPC endpoints to try (in order) for the active chain. Monad rotates across its
 * public set (each has a low per-IP rate limit) so a chatty dApp's reads are spread
 * out and survive any one endpoint throttling/dropping. Every other chain tries its
 * primary (proxy/Alchemy or its own public node) first, then the keyless PUBLIC_RPCS
 * fallbacks — forwardEvmRpc only fails over on transport errors, so a real RPC error
 * (e.g. a revert) is still surfaced from the primary.
 */
function rpcUrlsForChain(chainId: number, config: WalletConfig): string[] {
  if (chainId === MONAD_CHAIN_ID && !isTestnet(config)) {
    const start = _monadRpcCursor++ % MONAD_RPCS.length
    return [...MONAD_RPCS.slice(start), ...MONAD_RPCS.slice(0, start)]
  }
  const chain = evmChainById(chainId) ?? activeEvmChains(config)[0]
  // Keyed Tatum gateway as the last-resort node for thin-coverage chains
  // (Abstract/HyperEVM) — mainnet only, undefined (dropped) otherwise.
  const tatum = isTestnet(config) ? undefined : tatumRpcUrl(chain.id, config)
  return [chain.rpcUrl(config), ...(activePublicRpcs(config)[chain.id] ?? []), ...(tatum ? [tatum] : [])]
}

async function forwardEvmRpc(method: string, params: unknown[], config: WalletConfig): Promise<unknown> {
  const key = `${getDappChainId()}|${method}|${JSON.stringify(params ?? [])}`

  if (RPC_TTL_METHODS.has(method)) {
    const hit = rpcTtlCache.get(key)
    if (hit && hit.expires > Date.now()) return hit.value
  }

  const existing = rpcInflight.get(key)
  if (existing) return existing

  const p = (async () => {
    const urls = rpcUrlsForChain(getDappChainId(), config)
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    let lastErr: unknown = null
    // Fall over only on transport-level failures (timeout, connection, 429/5xx).
    // A valid JSON-RPC error (e.g. a revert) is deterministic — surface it as-is
    // instead of pointlessly retrying every endpoint.
    for (const url of urls) {
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(8_000),
        })
      } catch (e) { lastErr = e; continue }
      if (!res.ok) { lastErr = new Error(`RPC ${res.status}`); continue }
      const data = await res.json().catch(() => null) as { result?: unknown; error?: { message: string } } | null
      if (!data) { lastErr = new Error('Malformed RPC response'); continue }
      if (data.error) throw new Error(data.error.message)
      if (RPC_TTL_METHODS.has(method)) {
        rpcTtlCache.set(key, { value: data.result, expires: Date.now() + 1000 })
      }
      return data.result
    }
    throw lastErr instanceof Error ? lastErr : new Error('All RPC endpoints failed')
  })()

  rpcInflight.set(key, p)
  try {
    return await p
  } finally {
    rpcInflight.delete(key)
  }
}

export function registerIpcHandlers(): void {
  // ── Check if wallet is already configured ──────────────────────────────
  ipcMain.handle('wallet:is-setup', () => walletExists())

  // ── Generate a new mnemonic (does NOT save it yet) ─────────────────────
  // The renderer shows the words; the user confirms backup; THEN we save.
  ipcMain.handle('wallet:generate', () => {
    _pendingMnemonic = generateMnemonic()
    // Return the words array for display — this is the ONLY time the
    // mnemonic is sent to the renderer, and only in the create flow.
    return _pendingMnemonic.split(' ')
  })

  // ── Validate any mnemonic string ───────────────────────────────────────
  ipcMain.handle('wallet:validate', (_event, mnemonic: string) =>
    validateMnemonic(mnemonic)
  )

  // ── Confirm backup: derive addresses; defer mnemonic save until password ─
  // Called after user confirms they've written down their seed phrase. The
  // phrase stays in _pendingMnemonic and is encrypted only at wallet:set-password.
  ipcMain.handle('wallet:confirm-backup', async () => {
    if (!_pendingMnemonic) throw new Error('No pending mnemonic — restart setup')
    const addresses = await deriveAddresses(_pendingMnemonic)
    saveAddresses(addresses)
    return addresses
  })

  // ── Import existing mnemonic ───────────────────────────────────────────
  // Derives + stashes the phrase; persistence happens at wallet:set-password.
  ipcMain.handle('wallet:import', async (_event, mnemonic: string) => {
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase — check your words and try again')
    }
    const cleaned = mnemonic.trim().toLowerCase().replace(/\s+/g, ' ')
    const addresses = await deriveAddresses(cleaned)
    saveAddresses(addresses)
    _pendingMnemonic = cleaned
    return addresses
  })

  // ── Set password: encrypt + persist the pending wallet (or migrate legacy) ─
  // The single point where the mnemonic is written to disk. Leaves it unlocked.
  ipcMain.handle('wallet:set-password', async (_event, password: string) => {
    if (typeof password !== 'string' || password.length < 8) {
      throw new Error('Password must be at least 8 characters')
    }
    if (_pendingMnemonic) {
      await saveMnemonic(_pendingMnemonic, password)
      _pendingMnemonic = null
      touchActivity()
      // fire-and-forget: sync to ChainLens profile now that we're unlocked
      const addresses = loadAddresses()
      if (addresses) syncWallets(addresses, loadConfig()).catch(() => {})
      return true
    }
    if (needsMigration()) {
      await migrateLegacy(password)
      touchActivity()
      return true
    }
    throw new Error('No wallet pending — restart setup')
  })

  // ── Unlock / lock / state ──────────────────────────────────────────────
  ipcMain.handle('wallet:unlock', async (_event, password: string) => {
    await unlock(password)   // throws 'Incorrect password' or 'NEEDS_MIGRATION'
    touchActivity()
    return true
  })
  ipcMain.handle('wallet:lock', () => {
    lock()
    if (_lockTimer) { clearTimeout(_lockTimer); _lockTimer = null }
    return true
  })
  // Renderer reports genuine user interaction (throttled) so the idle timer only
  // fires after real inactivity — not while the user is actively scrolling/typing.
  // Fire-and-forget; touchActivity() no-ops when the wallet is already locked.
  ipcMain.on('wallet:activity', () => touchActivity())

  // ── Biometric unlock (optional convenience factor; password kept) ─────────
  // status: can it be offered (platform + OS enrollment), is this wallet already
  // enrolled, and which method ('windows-hello' | 'touch-id') so the renderer can
  // label the UI. enroll/unlock trigger the OS consent UI.
  ipcMain.handle('wallet:hello-status', async () => ({
    supported: await bioSupported(),
    enrolled: hasHelloUnlock(),
    method: bioMethod(),
  }))
  ipcMain.handle('wallet:hello-enroll', async () => {
    await enrollHello()            // requires the wallet to be unlocked
    return true
  })
  ipcMain.handle('wallet:hello-unlock', async () => {
    await unlockWithHello()        // throws on cancel/failure
    touchActivity()
    return true
  })
  ipcMain.handle('wallet:hello-remove', async () => {
    await removeHello()
    return true
  })
  ipcMain.handle('wallet:is-unlocked', () => isUnlocked())
  ipcMain.handle('wallet:needs-migration', () => needsMigration())

  // ── Get stored public addresses ────────────────────────────────────────
  ipcMain.handle('wallet:get-addresses', () => getFullAddresses())

  // ── Fetch live balances from Alchemy / Helius / Blockfrost / Tatum ─────
  ipcMain.handle('wallet:get-balances', async () => {
    const addresses = await getFullAddresses()
    const config = loadConfig()
    return fetchAllBalances(addresses, config)
  })

  // ── Reveal seed phrase (settings screen) — password re-auth required ──────
  // The highest-sensitivity action: re-verify the password against the stored
  // blob even when the wallet is already unlocked, so a compromised renderer
  // can't silently call this and exfiltrate the phrase.
  ipcMain.handle('wallet:reveal-seed', async (_event, password: string) => {
    if (!(await verifyPassword(password))) {
      throw new Error('Incorrect password')
    }
    touchActivity()
    return loadMnemonic().split(' ')
  })

  // ── Delete wallet (wipe all local data) ───────────────────────────────
  ipcMain.handle('wallet:delete', () => {
    deleteWallet()
    return true
  })

  // ── Connected sites (revoke dApp access, like MetaMask/Phantom) ────────
  // The approved-origins allowlist is shared across every chain, so revoking
  // an origin disconnects it everywhere. If that origin is the dApp currently
  // open in the built-in browser, push accountsChanged []/disconnect so the
  // page reflects the disconnect immediately instead of on next reload.
  const currentDappOrigin = (): string => {
    try { return new URL(getBrowserState().url).origin } catch { return '' }
  }
  const notifyDappDisconnected = (): void => {
    emitDappEvent('eth', 'accountsChanged', [])
    emitDappEvent('solana', 'disconnect', null)
  }

  ipcMain.handle('wallet:get-connected-sites', () => getApprovedOrigins())

  ipcMain.handle('wallet:revoke-site', (_event, origin: string) => {
    if (typeof origin !== 'string' || !origin) return getApprovedOrigins()
    removeApprovedOrigin(origin)
    if (currentDappOrigin() === origin) notifyDappDisconnected()
    return getApprovedOrigins()
  })

  ipcMain.handle('wallet:revoke-all-sites', () => {
    clearApprovedOrigins()
    notifyDappDisconnected()
    return []
  })

  // ── dApp browser: active EVM network (toolbar switcher + awareness) ────
  // The current chain is reset to Ethereum when navigating to a new dApp origin
  // (browser-manager); these let the toolbar read it, list switchable networks,
  // and switch manually — which fires chainChanged to the dApp just like a dApp-
  // initiated wallet_switchEthereumChain.
  ipcMain.handle('web3:get-chain', () => `0x${getDappChainId().toString(16)}`)

  ipcMain.handle('web3:get-chains', () =>
    activeEvmChains(loadConfig()).map(c => ({ chainId: c.chainId, id: c.id, name: c.name, color: c.color }))
  )

  ipcMain.handle('web3:set-chain', (_event, chainId: number | string) => {
    const target = typeof chainId === 'string' ? parseInt(chainId, 16) : chainId
    if (!Number.isFinite(target) || !evmChainById(target)) {
      throw new Error('Unsupported network')
    }
    setDappChainId(target)
    const hex = `0x${target.toString(16)}`
    emitDappEvent('eth', 'chainChanged', hex)
    notifyBrowserChrome('web3:chain-changed', hex)
    return hex
  })

  // ── Phase 2: Fee estimation ────────────────────────────────────────────
  // chainId is a chain-config id: 'ethereum', 'arbitrum', 'solana', 'cardano', etc.
  // H-3: per-chain recipient validation for the Send form — real decodes of the
  // formats the senders can pay to, so wrong-chain pastes fail at the field.
  ipcMain.handle('wallet:validate-address', (_event, chainId: string, address: string) =>
    validateAddress(String(chainId), String(address), isTestnet(loadConfig())))

  ipcMain.handle('wallet:estimate-fee', async (
    _event,
    chainId: string,
    to: string,
    amount: string
  ) => {
    const config = loadConfig()
    // getFullAddresses migrates older wallets so tron/dogecoin addresses exist here.
    const addresses = await getFullAddresses()
    if (chainId === 'solana')   return estimateSolanaFee(config)
    if (chainId === 'cardano')  return estimateCardanoFee(addresses.cardano, config)
    if (chainId === 'tron')     return estimateTronFee(to, config)
    if (chainId === 'dogecoin') {
      if (!addresses.dogecoin) throw new Error('No Dogecoin address found')
      return estimateDogecoinFee(addresses.dogecoin, to, amount)
    }
    if (chainId === 'bitcoin') {
      if (!addresses.bitcoin) throw new Error('No Bitcoin address found')
      return estimateBitcoinFee(addresses.bitcoin, to, amount, loadMnemonic(), addresses.accountIndex ?? 0)
    }
    if (chainId === 'monero') return estimateMoneroFee(to, config)
    if (chainId === 'zcash') {
      if (!addresses.privacy?.zcashTransparent) throw new Error('No Zcash address found')
      return estimateZcashFee(addresses.privacy.zcashTransparent, to, amount)
    }
    return estimateEvmFee(addresses.evm, to, amount, config, chainId)
  })

  // ── Phase 2: Send EVM ─────────────────────────────────────────────────
  ipcMain.handle('wallet:send-evm', async (_event, chainId: string, to: string, amountEth: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    return sendEvmTransaction(mnemonic, to, amountEth, config, chainId, accountIndex)
  })

  // ── Send FROM the Abstract Global Wallet (smart account) on Abstract ────
  // Native ETH when token is omitted; ERC-20 transfer otherwise. Gated on
  // ownership — a watch-only (override) AGW cannot be signed for.
  ipcMain.handle('wallet:send-agw', async (
    _event,
    to: string,
    amount: string,
    token?: { contractAddress: string; decimals: number }
  ) => {
    const addresses = await getFullAddresses()
    if (!addresses.agw) throw new Error('No Abstract Global Wallet linked for this account')
    if (!addresses.agwOwned) throw new Error('This wallet can’t sign for the linked AGW — it is watch-only')
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    return sendAgwTransaction(mnemonic, to, amount, config, addresses.accountIndex ?? 0, { token, agwAddress: addresses.agw })
  })

  // ── Phase 2: Send Solana ──────────────────────────────────────────────
  ipcMain.handle('wallet:send-solana', async (_event, to: string, amountSol: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    return sendSolanaTransaction(mnemonic, to, amountSol, config, accountIndex)
  })

  // ── Phase 2: Send Cardano ─────────────────────────────────────────────
  ipcMain.handle('wallet:send-cardano', async (_event, to: string, amountAda: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    // getFullAddresses: in Testnet Mode this is the addr_test… address.
    const addresses = await getFullAddresses()
    if (!addresses.cardano) throw new Error('No Cardano address found')
    return sendCardanoTransaction(mnemonic, addresses.cardano, to, amountAda, config, addresses.accountIndex ?? 0)
  })

  // ── Send Tron (native TRX, or TRC-20 when token is provided) ──────────────
  ipcMain.handle('wallet:send-tron', async (
    _event,
    to: string,
    amount: string,
    token?: { contractAddress: string; decimals: number }
  ) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    return sendTronTransaction(mnemonic, to, amount, config, accountIndex, token)
  })

  // ── Send Dogecoin (legacy P2PKH UTXO) ─────────────────────────────────────
  ipcMain.handle('wallet:send-dogecoin', async (_event, to: string, amountDoge: string) => {
    const mnemonic = loadMnemonic()
    const addresses = await getFullAddresses()
    if (!addresses.dogecoin) throw new Error('No Dogecoin address found')
    return sendDogecoinTransaction(mnemonic, addresses.dogecoin, to, amountDoge, addresses.accountIndex ?? 0)
  })

  // ── Send Bitcoin (Native SegWit P2WPKH; inscription-safe) ─────────────────
  ipcMain.handle('wallet:send-bitcoin', async (_event, to: string, amountBtc: string) => {
    const mnemonic = loadMnemonic()
    const addresses = await getFullAddresses()
    if (!addresses.bitcoin) throw new Error('No Bitcoin address found')
    return sendBitcoinTransaction(mnemonic, addresses.bitcoin, to, amountBtc, addresses.accountIndex ?? 0)
  })

  // ── Send Monero (Privacy Mode; full-wallet WASM sync + relay) ─────────────
  ipcMain.handle('wallet:send-monero', async (_event, to: string, amountXmr: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    if (!isPrivacy(config)) throw new Error('Monero sends are only available in Privacy Mode')
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    return sendMoneroTransaction(mnemonic, to, amountXmr, config, accountIndex)
  })

  // ── Send Zcash (Privacy Mode; transparent pool) ───────────────────────────
  ipcMain.handle('wallet:send-zcash', async (_event, to: string, amountZec: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    if (!isPrivacy(config)) throw new Error('Zcash sends are only available in Privacy Mode')
    const addresses = await getFullAddresses()
    if (!addresses.privacy?.zcashTransparent) throw new Error('No Zcash address found')
    return sendZcashTransaction(mnemonic, addresses.privacy.zcashTransparent, to, amountZec, addresses.accountIndex ?? 0)
  })

  // ── Phase 3: Transaction history ──────────────────────────────────────
  ipcMain.handle('wallet:get-history', async () => {
    const config = loadConfig()
    // History providers (Alchemy transfers, Blockscout, Moralis…) are queried on
    // their MAINNET networks; since the EVM address is the same on testnets, the
    // result would be mainnet activity mislabeled as testnet. Show none instead.
    if (isTestnet(config)) return {}
    // No history providers for the privacy chains yet (and XMR history is
    // inherently non-queryable without a scan) — show none rather than the
    // hidden mainnet chains' history.
    if (isPrivacy(config)) return {}
    const addresses = await getFullAddresses()
    return fetchAllHistory(addresses, config)
  })

  // ── Phase 3: Multi-account ────────────────────────────────────────────
  ipcMain.handle('wallet:get-account', () => loadAddresses()?.accountIndex ?? 0)

  ipcMain.handle('wallet:set-account', async (_event, accountIndex: number) => {
    if (accountIndex < 0 || accountIndex > 9) throw new Error('Account index must be 0–9')
    const mnemonic = loadMnemonic()
    const derived = await deriveAddresses(mnemonic, accountIndex)
    let newAddresses = await resolveAgw(derived)
    const config = loadConfig()
    // Keep the testnet-encoded set in step with the account while the mode is on.
    if (isTestnet(config)) {
      newAddresses = { ...newAddresses, testnet: await deriveTestnetAddresses(mnemonic, accountIndex) }
    }
    // Same for the privacy chain set while Privacy Mode is on.
    if (isPrivacy(config)) {
      newAddresses = { ...newAddresses, privacy: await derivePrivacyAddresses(mnemonic, accountIndex) }
    }
    saveAddresses(newAddresses)
    return effectiveAddresses(newAddresses, config)
  })

  // ── Testnet Mode ──────────────────────────────────────────────────────────
  // Flips the whole wallet between mainnets and testnets (chain-config selectors
  // read config.testnetMode on every call). Enabling requires the unlocked seed
  // once, to derive + cache the testnet-encoded addresses (Bitcoin tb1…, Cardano
  // addr_test…) so later reads work from addresses.json even while locked.
  ipcMain.handle('wallet:get-testnet-mode', () => isTestnet(loadConfig()))

  ipcMain.handle('wallet:set-testnet-mode', async (_event, enabled: boolean) => {
    const on = !!enabled
    if (on) {
      if (!isUnlocked()) throw new Error('Unlock the wallet to enable Testnet Mode')
      const stored = loadAddresses()
      if (stored && !stored.testnet) {
        const testnet = await deriveTestnetAddresses(loadMnemonic(), stored.accountIndex ?? 0)
        saveAddresses({ ...stored, testnet })
      }
    }
    // Testnet and Privacy modes are mutually exclusive — enabling one clears the other.
    saveConfig(on ? { testnetMode: true, privacyMode: false } : { testnetMode: false })
    const config = loadConfig()

    // Reset the dApp browser to the mode's default chain (Sepolia ⟷ Ethereum) and
    // notify any connected dApp + the browser toolbar, exactly like a manual switch.
    const def = defaultDappChainId(config)
    setDappChainId(def)
    const hex = `0x${def.toString(16)}`
    emitDappEvent('eth', 'chainChanged', hex)
    notifyBrowserChrome('web3:chain-changed', hex)

    const addresses = loadAddresses()
    return {
      testnet: on,
      addresses: addresses ? effectiveAddresses(addresses, config) : null,
    }
  })

  // ── Privacy Mode ──────────────────────────────────────────────────────────
  // Filters the portfolio down to the privacy chains (XMR/ZEC/NIGHT — see
  // PRIVACY_CHAINS). Mutually exclusive with Testnet Mode: enabling either turns
  // the other off. Enabling requires the unlocked seed once, to derive + cache
  // the privacy address set (and stamp the Monero wallet birthday so scanning
  // starts near the chain tip instead of from genesis).
  ipcMain.handle('wallet:get-privacy-mode', () => isPrivacy(loadConfig()))

  ipcMain.handle('wallet:set-privacy-mode', async (_event, enabled: boolean) => {
    const on = !!enabled
    if (on) {
      if (!isUnlocked()) throw new Error('Unlock the wallet to enable Privacy Mode')
      const stored = loadAddresses()
      if (stored && (!stored.privacy || !stored.privacy.midnight)) {
        const privacy = await derivePrivacyAddresses(loadMnemonic(), stored.accountIndex ?? 0)
        saveAddresses({ ...stored, privacy })
      }
      saveConfig({ privacyMode: true, testnetMode: false })
      // Wallet birthday for Monero scanning — set once, never moved backward.
      // Stamped in the BACKGROUND: a node round-trip must not delay the
      // toggle's renderer reload. Until it lands, monero-impl falls back to
      // near-tip, so the first scan still starts at the right place.
      if (!loadConfig().moneroRestoreHeight) {
        void (async () => {
          try {
            const { fetchMoneroHeight } = await import('./monero')
            saveConfig({ moneroRestoreHeight: await fetchMoneroHeight() })
          } catch { /* height stays 0 → near-tip fallback */ }
        })()
      }
    } else {
      saveConfig({ privacyMode: false })
      // Stop the background Monero view-wallet scanner when leaving the mode.
      try { const { stopMoneroSync } = await import('./monero'); await stopMoneroSync() } catch { /* not started */ }
    }
    const config = loadConfig()
    const addresses = loadAddresses()
    return {
      privacy: isPrivacy(config),
      addresses: addresses ? effectiveAddresses(addresses, config) : null,
    }
  })

  // ── Abstract Global Wallet: set/clear the manual address override ──────────
  // address = null clears the override (falls back to auto-derive). Re-resolves
  // and persists the active account so the renderer gets the updated agw/agwOwned.
  ipcMain.handle('wallet:set-agw', async (_event, accountIndex: number, address: string | null) => {
    if (accountIndex < 0 || accountIndex > 9) throw new Error('Account index must be 0–9')
    if (address != null) {
      const trimmed = address.trim()
      if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) throw new Error('Invalid Abstract address — must be a 0x… EVM address')
      saveAgwOverride(accountIndex, trimmed)
    } else {
      saveAgwOverride(accountIndex, null)
    }
    const current = loadAddresses()
    if (current && (current.accountIndex ?? 0) === accountIndex) {
      const resolved = await resolveAgw(current)
      saveAddresses(resolved)
      return resolved
    }
    return current
  })

  // ── Phase 5: Market Watch ────────────────────────────────────────────────
  ipcMain.handle('wallet:get-market', () => fetchMarketTop100(loadConfig()))

  ipcMain.handle('wallet:search-market', (_event, query: string) =>
    searchMarketCoins(query, loadConfig())
  )

  ipcMain.handle('wallet:get-coin-chart', (_event, coinId: string, days: string) =>
    fetchCoinChart(coinId, days, loadConfig())
  )

  // ── Phase 5: Tokens + Collectibles ───────────────────────────────────────
  ipcMain.handle('wallet:get-tokens', async () => {
    const addresses = await getFullAddresses()
    const config = loadConfig()
    return fetchAllTokens(
      { evm: addresses.evm, solana: addresses.solana, cardano: addresses.cardano, tron: addresses.tron, agw: addresses.agw, bitcoinTaproot: addresses.bitcoinTaproot },
      config
    )
  })

  ipcMain.handle('wallet:get-collectibles', async (_event, excludeIds?: string[]) => {
    const addresses = await getFullAddresses()
    const config = loadConfig()
    // Returns as soon as items are fetched (with cached floor values applied);
    // the live floor pass then runs in the background and pushes the re-valued
    // list to the wallet window when it completes.
    return fetchAllCollectibles(
      addresses.evm, addresses.cardano, config, addresses.solana, addresses.agw,
      addresses.tron, excludeIds, addresses.bitcoinTaproot,
      (updated) => {
        const win = getMainWin()
        if (win && !win.isDestroyed()) win.webContents.send('collectibles:updated', updated)
      }
    )
  })

  // ── Phantom-style DEX swap (proxy quote + local signing) ─────────────────
  ipcMain.handle('swap:getQuote', async (_e, req: SwapQuoteRequest) => {
    return getSwapQuote(req, loadConfig())
  })

  ipcMain.handle('swap:execute', async (_e, quote: NormalizedSwapQuote) => {
    const stored = await getFullAddresses()
    return executeSwap(quote, loadMnemonic(), loadConfig(), stored.accountIndex ?? 0)
  })

  ipcMain.handle('swap:crossStatus', async (_e, req: CrossSwapStatusRequest) => {
    return getCrossSwapStatus(req, loadConfig())
  })

  ipcMain.handle('swap:getTokenList', async (_e, chain: SwapChain) => {
    return getSwapTokenList(chain, loadConfig())
  })

  // ── SimpleSwap cross-chain exchange (off-chain, deposit-address) ─────────
  ipcMain.handle('ss:estimate', async (_e, params: SsEstimateParams) => {
    return ssEstimate(params, loadConfig())
  })

  ipcMain.handle('ss:create-exchange', async (_e, params: SsCreateParams) => {
    return ssCreateExchange(params, loadConfig())
  })

  ipcMain.handle('ss:status', async (_e, id: string) => {
    return ssGetStatus(id, loadConfig())
  })

  // ── Deposit-address aggregator (SimpleSwap primary, ChangeNOW fallback) ───
  ipcMain.handle('xchange:estimate', async (_e, params: SsEstimateParams) => {
    return xEstimate(params, loadConfig())
  })

  ipcMain.handle('xchange:create', async (_e, params: XCreateParams) => {
    return xCreateExchange(params, loadConfig())
  })

  ipcMain.handle('xchange:status', async (_e, provider: ExchangeProvider, id: string) => {
    return xGetStatus(provider, id, loadConfig())
  })

  // ── NFT floor price via OpenSea (EVM) ─────────────────────────────────────
  // Chain slug mapping: wallet chain id → OpenSea chain slug
  const OPENSEA_CHAIN: Record<string, string> = {
    ethereum: 'ethereum', arbitrum: 'arbitrum', optimism: 'optimism',
    base: 'base', polygon: 'matic', avalanche: 'avalanche',
    blast: 'blast', zora: 'zora', abstract: 'abstract'
  }

  ipcMain.handle('wallet:get-nft-floor', async (_e, chain: string, contractAddress: string) => {
    const config = loadConfig()
    const osChain = OPENSEA_CHAIN[chain]
    if (!osChain || !canOpensea(config) || !contractAddress) {
      return { floor: null, currency: 'ETH', floorUsd: null }
    }
    try {
      // Step 1: get collection slug from contract
      const contractRes = await openseaFetch(`chain/${osChain}/contract/${contractAddress}`, config, 8_000)
      if (!contractRes.ok) return { floor: null, currency: 'ETH', floorUsd: null }
      const contractJson = await contractRes.json() as { collection?: string }
      const slug = contractJson.collection
      if (!slug) return { floor: null, currency: 'ETH', floorUsd: null }

      // Step 2: get floor price from collection stats
      const statsRes = await openseaFetch(`collections/${slug}/stats`, config, 8_000)
      if (!statsRes.ok) return { floor: null, currency: 'ETH', floorUsd: null }
      const statsJson = await statsRes.json() as {
        total?: { floor_price?: number; floor_price_symbol?: string }
      }
      const floor = statsJson.total?.floor_price
      const symbol = statsJson.total?.floor_price_symbol ?? 'ETH'
      if (floor == null) return { floor: null, currency: symbol, floorUsd: null }
      return { floor: floor.toFixed(4), currency: symbol, floorUsd: null }
    } catch {
      return { floor: null, currency: 'ETH', floorUsd: null }
    }
  })

  // ── Phase 6: Built-in browser controls ───────────────────────────────────
  ipcMain.on('browser:open',    () => openBrowserWindow())
  ipcMain.on('browser:close',   () => closeBrowserWindow())
  ipcMain.on('browser:back',    () => browserBack())
  ipcMain.on('browser:forward', () => browserForward())
  ipcMain.on('browser:reload',  () => browserReload())
  ipcMain.on('browser:home',    () => browserHome())
  ipcMain.on('browser:new-tab', (_event, url?: string) => browserNewTab(url))
  ipcMain.on('browser:set-active-tab', (_event, id: number) => browserSetActiveTab(id))
  ipcMain.on('browser:close-tab', (_event, id: number) => browserCloseTab(id))
  ipcMain.handle('browser:suspend-tabs-menu', () => browserSuspendTabsMenu())
  ipcMain.on('browser:resume-tabs-menu', () => browserResumeTabsMenu())
  ipcMain.handle('browser:navigate', (_event, url: string) => { browserNavigate(url) })
  ipcMain.handle('browser:get-state', () => getBrowserState())

  // ── Side-by-side window layout (Full Screen Mode) ─────────────────────────
  ipcMain.on('layout:snap',   (_event, side: 'left' | 'right') => layoutSnap(side === 'right' ? 'right' : 'left'))
  ipcMain.on('layout:detach', () => layoutDetach())
  ipcMain.on('layout:toggle', () => layoutToggle())
  ipcMain.on('browser:toggle-maximize', () => browserToggleMaximize())
  ipcMain.on('browser:set-chrome-height', (_event, h: number) => setChromeHeight(typeof h === 'number' ? h : 80))
  ipcMain.handle('layout:get-state', () => getLayoutState())

  // ── App version + in-app software update ──────────────────────────────────
  // Drives electron-updater (update-manager.ts). The renderer subscribes to the
  // 'update:status' push for live progress; 'update:check' also returns the
  // current snapshot so a freshly-opened Settings sheet has state immediately.
  ipcMain.handle('app:get-version', () => app.getVersion())
  ipcMain.handle('update:check', () => { startUpdateCheck({ silent: false }); return getUpdateState() })
  ipcMain.handle('update:get-state', () => getUpdateState())
  ipcMain.on('update:install', () => installUpdate())

  // ── Phase 6: Web3 dApp requests (from web3-inject preload) ───────────────
  ipcMain.handle('web3:request', async (
    event,
    { method, params }: { method: string; params: unknown[] }
  ) => {
    const addresses = loadAddresses()
    const config = loadConfig()
    const origin = getSenderOrigin(event.sender.getURL())
    touchActivity()

    try {
    switch (method) {
      // ── Connection ──────────────────────────────────────────────────────
      case 'eth_requestAccounts': {
        if (getApprovedOrigins().includes(origin) && addresses?.evm) return [addresses.evm]
        const approved = await showApprovalWindow({
          title: 'Connect Wallet',
          heading: `${origin} wants to connect to your wallet`,
          detail: `EVM Address:\n${addresses?.evm ?? 'Not available'}`,
          confirmLabel: 'Connect',
          origin
        })
        if (!approved) {
          const err = Object.assign(new Error('User rejected the request.'), { code: 4001 })
          throw err
        }
        addApprovedOrigin(origin)
        return [addresses?.evm ?? '']
      }

      case 'eth_accounts':
        return getApprovedOrigins().includes(origin) && addresses?.evm ? [addresses.evm] : []

      case 'eth_chainId':
        return `0x${getDappChainId().toString(16)}`

      case 'net_version':
        return String(getDappChainId())

      // ── Network switching ───────────────────────────────────────────────
      case 'wallet_switchEthereumChain': {
        const requested = (params[0] as { chainId?: string })?.chainId
        const target = requested ? parseInt(requested, 16) : NaN
        if (!Number.isFinite(target) || !evmChainById(target)) {
          // EIP-3326: 4902 = chain not added/recognized by the wallet.
          throw Object.assign(
            new Error(`This wallet doesn't support network 0x${(target || 0).toString(16)}.`),
            { code: 4902 }
          )
        }
        // H-2: an unconnected page must not steer the wallet's network. Same-chain
        // requests stay silent; an actual switch requires a connected origin.
        if (target !== getDappChainId()) await ensureConnectedOrigin(origin, addresses)
        setDappChainId(target)
        const hex = `0x${target.toString(16)}`
        emitDappEvent('eth', 'chainChanged', hex)
        notifyBrowserChrome('web3:chain-changed', hex)
        return null
      }

      case 'wallet_addEthereumChain': {
        // We only sign for networks we already have RPC for. If the requested
        // chain is one of those, treat it as a switch; otherwise reject clearly.
        const requested = (params[0] as { chainId?: string })?.chainId
        const target = requested ? parseInt(requested, 16) : NaN
        if (!Number.isFinite(target) || !evmChainById(target)) {
          throw Object.assign(
            new Error('This network is not supported by MagicMoney Wallet yet.'),
            { code: 4902 }
          )
        }
        // H-2: same connected-origin gate as wallet_switchEthereumChain.
        if (target !== getDappChainId()) await ensureConnectedOrigin(origin, addresses)
        setDappChainId(target)
        const hex = `0x${target.toString(16)}`
        emitDappEvent('eth', 'chainChanged', hex)
        notifyBrowserChrome('web3:chain-changed', hex)
        return null
      }

      case 'wallet_requestPermissions': {
        if (!getApprovedOrigins().includes(origin)) {
          const approved = await showApprovalWindow({
            title: 'Connect Wallet',
            heading: `${origin} wants permission to access your EVM account`,
            detail: `EVM Address:\n${addresses?.evm ?? 'Not available'}`,
            confirmLabel: 'Connect',
            origin
          })
          if (!approved) {
            throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
          }
          addApprovedOrigin(origin)
        }
        return [{ parentCapability: 'eth_accounts' }]
      }

      case 'wallet_getPermissions':
        return getApprovedOrigins().includes(origin) ? [{ parentCapability: 'eth_accounts' }] : []

      case 'wallet_revokePermissions':
        removeApprovedOrigin(origin)
        return null

      // ── Message signing ─────────────────────────────────────────────────
      case 'personal_sign': {
        await ensureConnectedOrigin(origin, addresses)
        const hexMsg = params[0] as string
        let displayText: string
        try {
          displayText = Buffer.from(hexMsg.replace(/^0x/, ''), 'hex').toString('utf8')
        } catch {
          displayText = hexMsg
        }
        const approved = await showApprovalWindow({
          title: 'Sign Message',
          heading: 'A dApp wants you to sign a message',
          detail: displayText.slice(0, 1000),
          confirmLabel: 'Sign',
          origin
        })
        if (!approved) {
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        }
        const mnemonic = loadMnemonic()
        const accountIndex = addresses?.accountIndex ?? 0
        const pk = deriveEvmKey(mnemonic, accountIndex)
        const account = privateKeyToAccount(pk)
        return account.signMessage({ message: { raw: hexMsg as `0x${string}` } })
      }

      case 'eth_sign':
        // M-4: refused outright. Raw-digest eth_sign is a blind-signing footgun,
        // and our previous implementation actually returned an EIP-191
        // (personal_sign-scheme) signature no eth_sign caller could verify.
        // dApps fall back to personal_sign / eth_signTypedData (MetaMask has
        // shipped the same refusal as its default since 2024).
        throw Object.assign(
          new Error('eth_sign is not supported for security reasons. Use personal_sign or eth_signTypedData_v4.'),
          { code: 4200 }
        )

      // ── Transaction ─────────────────────────────────────────────────────
      case 'eth_sendTransaction': {
        await ensureConnectedOrigin(origin, addresses)
        const tx = (params[0] ?? {}) as {
          to?: string; value?: string; data?: string; gas?: string
        }
        // H-1: format the amount with the ACTIVE chain's native symbol + full
        // decimals (viem formatEther), not integer-divided "0 ETH".
        const activeChain = evmChainById(getDappChainId())
        const approved = await showApprovalWindow({
          title: 'Send Transaction',
          heading: 'A dApp wants to send a transaction',
          detail: describeEvmSend(
            tx,
            activeChain?.nativeSymbol ?? 'ETH',
            activeChain?.name ?? `chain ${getDappChainId()}`
          ),
          confirmLabel: 'Send',
          origin
        })
        if (!approved) {
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        }
        const mnemonic = loadMnemonic()
        const accountIndex = addresses?.accountIndex ?? 0
        return sendEvmFromDapp(mnemonic, accountIndex, tx, config)
      }

      // ── Typed-data signing (EIP-712) — used by OpenSea / Seaport ────────
      case 'eth_signTypedData':
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4': {
        await ensureConnectedOrigin(origin, addresses)
        // v3/v4: params = [address, typedData]; legacy v1: params = [typedData, address]
        const rawPayload = method === 'eth_signTypedData' ? params[0] : params[1]
        let typed: {
          domain: Record<string, unknown>
          types: Record<string, unknown>
          primaryType: string
          message: Record<string, unknown>
        }
        try {
          typed = (typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload) as typeof typed
        } catch {
          throw Object.assign(new Error('Invalid typed data payload'), { code: -32602 })
        }
        // H-2: render the FULL message (spender/amount for approvals, with an
        // UNLIMITED warning) instead of just the primaryType.
        const detail = describeTypedData(typed)
        const looksLikeApproval = /permit/i.test(typed?.primaryType ?? '') || detail.includes('Token approval')
        const approved = await showApprovalWindow({
          title: 'Sign Typed Data',
          heading: 'A dApp wants you to sign structured data (EIP-712)',
          detail,
          confirmLabel: 'Sign',
          tone: looksLikeApproval ? 'danger' : 'primary',
          origin
        })
        if (!approved) {
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        }
        const mnemonic = loadMnemonic()
        const accountIndex = addresses?.accountIndex ?? 0
        const pk = deriveEvmKey(mnemonic, accountIndex)
        const account = privateKeyToAccount(pk)
        // viem's signTypedData is strongly generic; the payload is dynamic dApp input.
        return account.signTypedData(
          typed as unknown as Parameters<typeof account.signTypedData>[0]
        )
      }

      // ── Read-only: proxy to the active chain's RPC (de-duped + briefly cached) ──
      default:
        return forwardEvmRpc(method, params, config)
    }
    } catch (err) {
      // Normalize so dApps get a clean, readable error message, never a raw stack.
      // Coded errors (4001 user-reject, 4902 unknown chain) keep their message;
      // Electron IPC strips the custom `code` property, so the preload re-derives
      // the EIP-1193 code from the message text (see web3-inject `request` catch).
      if (err && typeof err === 'object' && 'code' in err) throw err
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(message || 'The wallet could not complete this request.')
    }
  })

  // ── Phase 6: Solana dApp requests ─────────────────────────────────────────
  ipcMain.handle('web3:solana-connect', async () => {
    const addresses = loadAddresses()
    const approved = await showApprovalWindow({
      title: 'Connect Solana Wallet',
      heading: 'A dApp wants to connect to your Solana wallet',
      detail: `Address:\n${addresses?.solana ?? 'Not available'}`,
      confirmLabel: 'Connect'
    })
    if (!approved) {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    }
    return addresses?.solana ?? ''
  })

  ipcMain.handle('web3:solana-sign-message', async (_event, messageBytes: number[]) => {
    const decoded = (() => { try { return Buffer.from(messageBytes).toString('utf8') } catch { return `${messageBytes.length} bytes` } })()
    const approved = await showApprovalWindow({
      title: 'Sign Solana Message',
      heading: 'A dApp wants to sign a message with your Solana wallet',
      detail: decoded.slice(0, 1000),
      confirmLabel: 'Sign'
    })
    if (!approved) {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    }
    // Ed25519-sign the raw message bytes with the Solana key. The Solana
    // secretKey is 64 bytes (32-byte seed + 32-byte pubkey); @noble/curves takes
    // the 32-byte seed as the private key. Returns the 64-byte signature as a
    // number[] so it serializes over IPC (preload rebuilds the Uint8Array).
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    const keypair = await getSolanaKeypair(loadMnemonic(), accountIndex)
    const seed = keypair.secretKey.slice(0, 32)
    const signature = ed25519.sign(Uint8Array.from(messageBytes), seed)
    return Array.from(signature)
  })

  // Sign (only) a serialized Solana transaction and return the signed bytes.
  // The dApp broadcasts it itself (Wallet Standard signTransaction).
  ipcMain.handle('web3:solana-sign-tx', async (_event, txBytes: number[]) => {
    const approved = await showApprovalWindow({
      title: 'Sign Solana Transaction',
      heading: 'A dApp wants you to sign a Solana transaction',
      detail: `Transaction (${txBytes.length} bytes)\nReview carefully — only sign if you trust this site.`,
      confirmLabel: 'Sign'
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    const keypair = await getSolanaKeypair(loadMnemonic(), accountIndex)
    const { VersionedTransaction } = await import('@solana/web3.js')
    const tx = VersionedTransaction.deserialize(Uint8Array.from(txBytes))
    tx.sign([keypair])
    return Array.from(tx.serialize())
  })

  // Sign AND broadcast a serialized Solana transaction via Helius
  // (Wallet Standard signAndSendTransaction). Returns the tx signature string.
  ipcMain.handle('web3:solana-sign-and-send', async (_event, input: { transaction?: number[] }) => {
    if (!input?.transaction) throw new Error('No transaction data provided')
    const approved = await showApprovalWindow({
      title: 'Send Solana Transaction',
      heading: 'A dApp wants to send a Solana transaction',
      detail: `Transaction (${input.transaction.length} bytes)\nReview carefully — only proceed if you trust this site.`,
      confirmLabel: 'Send'
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    const config = loadConfig()
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    const keypair = await getSolanaKeypair(loadMnemonic(), accountIndex)
    const { VersionedTransaction, Connection } = await import('@solana/web3.js')
    const tx = VersionedTransaction.deserialize(Uint8Array.from(input.transaction))
    tx.sign([keypair])
    const conn = new Connection(heliusRpcUrl(config), 'confirmed')
    const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' })
    return { signature }
  })

  // ── CIP-30 Cardano dApp requests ─────────────────────────────────────────
  // Connection state is tracked per-origin (shared with the EVM allowlist), so
  // approval survives reloads and is scoped to the site that asked — matching
  // the extension. A previously denied/closed approval leaves the origin out.
  ipcMain.handle('cardano:is-enabled', (event) =>
    getApprovedOrigins().includes(getSenderOrigin(event.sender.getURL()))
  )

  ipcMain.handle('cardano:enable', async (event) => {
    const origin = getSenderOrigin(event.sender.getURL())
    if (getApprovedOrigins().includes(origin)) return true
    const addresses = loadAddresses()
    const approved = await showApprovalWindow({
      title: 'Connect Cardano Wallet',
      heading: `${origin} wants to connect to your Cardano wallet`,
      detail: `Address:\n${addresses?.cardano ?? 'Not available'}`,
      confirmLabel: 'Connect',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    addApprovedOrigin(origin)
    return true
  })

  ipcMain.handle('cardano:get-network-id', () => 1)

  ipcMain.handle('cardano:get-balance', async () => {
    const addresses = loadAddresses()
    if (!addresses?.cardano) throw new Error('No Cardano wallet')
    const config = loadConfig()
    return cip30GetBalance(addresses.cardano, config)
  })

  ipcMain.handle('cardano:get-utxos', async () => {
    const addresses = loadAddresses()
    if (!addresses?.cardano) throw new Error('No Cardano wallet')
    const config = loadConfig()
    return cip30GetUtxos(addresses.cardano, config)
  })

  ipcMain.handle('cardano:get-collateral', async (_event, amountHex?: string) => {
    const addresses = loadAddresses()
    if (!addresses?.cardano) throw new Error('No Cardano wallet')
    const config = loadConfig()
    return cip30GetCollateral(addresses.cardano, config, amountHex)
  })

  ipcMain.handle('cardano:get-used-addresses', () => {
    const addresses = loadAddresses()
    // CIP-30 requires hex-encoded address bytes, not bech32 — dApps match these
    // against indexer-reported owner addresses to detect ownership.
    return addresses?.cardano ? [addressToHex(addresses.cardano)] : []
  })

  ipcMain.handle('cardano:get-unused-addresses', () => [])

  ipcMain.handle('cardano:get-change-address', () => {
    const addresses = loadAddresses()
    if (!addresses?.cardano) throw new Error('No Cardano wallet')
    return addressToHex(addresses.cardano)
  })

  ipcMain.handle('cardano:get-reward-addresses', async () => {
    const mnemonic = loadMnemonic()
    const addresses = loadAddresses()
    return cip30GetRewardAddresses(mnemonic, addresses?.accountIndex ?? 0)
  })

  ipcMain.handle('cardano:sign-tx', async (event, txHex: string, _partial: boolean) => {
    const origin = getSenderOrigin(event.sender.getURL())
    if (!getApprovedOrigins().includes(origin)) {
      throw Object.assign(new Error('Connect the wallet before signing.'), { code: 4100 })
    }
    const approved = await showApprovalWindow({
      title: 'Sign Transaction',
      heading: 'A dApp wants you to sign a Cardano transaction',
      detail: `Transaction:\n${txHex.slice(0, 200)}${txHex.length > 200 ? '…' : ''}`,
      confirmLabel: 'Sign',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    const mnemonic = loadMnemonic()
    const addresses = loadAddresses()
    try {
      return await cip30SignTx(txHex, mnemonic, addresses?.accountIndex ?? 0)
    } catch (err) {
      throw new Error(`Could not sign this Cardano transaction — the dApp may have sent it in an unexpected format. (${err instanceof Error ? err.message : String(err)})`)
    }
  })

  ipcMain.handle('cardano:sign-data', async (event, address: string, payloadHex: string) => {
    const origin = getSenderOrigin(event.sender.getURL())
    if (!getApprovedOrigins().includes(origin)) {
      throw Object.assign(new Error('Connect the wallet before signing.'), { code: 4100 })
    }
    const approved = await showApprovalWindow({
      title: 'Sign Data',
      heading: 'A dApp wants you to sign data with your Cardano wallet',
      detail: `Data:\n${payloadHex.slice(0, 200)}${payloadHex.length > 200 ? '…' : ''}`,
      confirmLabel: 'Sign',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    const mnemonic = loadMnemonic()
    const addresses = loadAddresses()
    const signingAddr = address || addresses?.cardano || ''
    try {
      return await cip30SignData(signingAddr, payloadHex, mnemonic, addresses?.accountIndex ?? 0)
    } catch (err) {
      throw new Error(`Could not sign this Cardano data payload. (${err instanceof Error ? err.message : String(err)})`)
    }
  })

  ipcMain.handle('cardano:submit-tx', async (_event, txHex: string) => {
    const config = loadConfig()
    return cip30SubmitTx(txHex, config)
  })

  // ── Bitcoin / Ordinals dApp provider (sats-connect/WBIP + Unisat) ─────────
  // Mirrors the Cardano CIP-30 flow: connect is approval-gated + the origin is
  // remembered; every signing request shows the approval modal with the origin.
  const btcAddrType = (addr: string, a: WalletAddresses): 'native' | 'nested' | 'taproot' =>
    addr === a.bitcoinNested ? 'nested' : addr === a.bitcoinTaproot ? 'taproot' : 'native'

  async function btcConnect(origin: string): Promise<WalletAddresses> {
    const a = await getFullAddresses()
    if (!getApprovedOrigins().includes(origin)) {
      const approved = await showApprovalWindow({
        title: 'Connect Bitcoin Wallet',
        heading: `${origin} wants to connect to your Bitcoin wallet`,
        detail: `Payment (SegWit):\n${a.bitcoin}\n\nOrdinals (Taproot):\n${a.bitcoinTaproot}`,
        confirmLabel: 'Connect',
        origin
      })
      if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      addApprovedOrigin(origin)
    }
    return a
  }

  ipcMain.handle('bitcoin:is-enabled', (event) =>
    getApprovedOrigins().includes(getSenderOrigin(event.sender.getURL())))

  // sats-connect getAddresses → { addresses: [{ address, publicKey, purpose, addressType }] }
  ipcMain.handle('bitcoin:request-addresses', async (event, purposes?: string[]) => {
    const origin = getSenderOrigin(event.sender.getURL())
    const a = await btcConnect(origin)
    const acct = a.accountIndex ?? 0
    const [nat, tap] = await Promise.all([getBitcoinKey(loadMnemonic(), acct), getBitcoinTaprootKey(loadMnemonic(), acct)])
    const all = [
      { address: a.bitcoin, publicKey: Buffer.from(nat.publicKey).toString('hex'), purpose: 'payment', addressType: 'p2wpkh' },
      { address: a.bitcoinTaproot, publicKey: Buffer.from(tap.publicKey.slice(1)).toString('hex'), purpose: 'ordinals', addressType: 'p2tr' },
    ]
    const want = purposes && purposes.length ? purposes : ['payment', 'ordinals']
    return { addresses: all.filter(x => want.includes(x.purpose)) }
  })

  // Unisat getAccounts (silent) / requestAccounts (prompt) → [payment address]
  ipcMain.handle('bitcoin:get-accounts', async (event) => {
    const origin = getSenderOrigin(event.sender.getURL())
    const a = await getFullAddresses()
    return getApprovedOrigins().includes(origin) && a.bitcoin ? [a.bitcoin] : []
  })
  ipcMain.handle('bitcoin:request-accounts', async (event) => {
    const a = await btcConnect(getSenderOrigin(event.sender.getURL()))
    return [a.bitcoin]
  })
  ipcMain.handle('bitcoin:get-public-key', async () => {
    const a = await getFullAddresses()
    const k = await getBitcoinKey(loadMnemonic(), a.accountIndex ?? 0)
    return Buffer.from(k.publicKey).toString('hex')
  })
  ipcMain.handle('bitcoin:get-balance', async () => {
    const a = await getFullAddresses()
    if (!a.bitcoin) throw new Error('No Bitcoin wallet')
    return getBitcoinAddressBalance(a.bitcoin)
  })

  ipcMain.handle('bitcoin:sign-psbt', async (event, psbt: string, opts?: Record<string, unknown>) => {
    const origin = getSenderOrigin(event.sender.getURL())
    if (!getApprovedOrigins().includes(origin)) throw Object.assign(new Error('Connect the wallet before signing.'), { code: 4100 })
    const approved = await showApprovalWindow({
      title: 'Sign Bitcoin Transaction',
      heading: `${origin} wants you to sign a Bitcoin PSBT`,
      detail: `PSBT:\n${String(psbt).slice(0, 180)}${String(psbt).length > 180 ? '…' : ''}`,
      confirmLabel: 'Sign',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    const a = await getFullAddresses()
    const o = (opts ?? {}) as { signInputs?: Record<string, number[]>; autoFinalized?: boolean; broadcast?: boolean }
    const req: PsbtSignRequest = { psbt: String(psbt), signInputs: o.signInputs, finalize: o.autoFinalized !== false, extractTx: !!o.broadcast }
    const signed = await signBitcoinPsbt(req, loadMnemonic(), a, a.accountIndex ?? 0)
    let txid: string | undefined
    if (o.broadcast && signed.txHex) txid = await broadcastBitcoin(signed.txHex)
    return { psbtHex: signed.psbtHex, psbtBase64: signed.psbtBase64, txid }
  })

  ipcMain.handle('bitcoin:sign-message', async (event, message: string, addressOrType?: string) => {
    const origin = getSenderOrigin(event.sender.getURL())
    if (!getApprovedOrigins().includes(origin)) throw Object.assign(new Error('Connect the wallet before signing.'), { code: 4100 })
    const approved = await showApprovalWindow({
      title: 'Sign Message',
      heading: `${origin} wants you to sign a message with your Bitcoin wallet`,
      detail: String(message).slice(0, 800),
      confirmLabel: 'Sign',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    const a = await getFullAddresses()
    // The 2nd arg may be an address (sats-connect) or a Unisat type ('ecdsa'/'bip322-simple').
    const type = addressOrType && (addressOrType.startsWith('bc1') || addressOrType.startsWith('3'))
      ? btcAddrType(addressOrType, a) : 'native'
    return signBitcoinMessage(String(message), type, loadMnemonic(), a.accountIndex ?? 0)
  })

  ipcMain.handle('bitcoin:push-psbt', async (_event, rawTxHex: string) => broadcastBitcoin(String(rawTxHex)))
  ipcMain.handle('bitcoin:push-tx', async (_event, rawTxHex: string) => broadcastBitcoin(String(rawTxHex)))

  // Unisat sendBitcoin(to, satoshis) — build+sign+broadcast from the payment address.
  ipcMain.handle('bitcoin:send', async (event, to: string, satoshis: number) => {
    const origin = getSenderOrigin(event.sender.getURL())
    if (!getApprovedOrigins().includes(origin)) throw Object.assign(new Error('Connect the wallet before sending.'), { code: 4100 })
    const a = await getFullAddresses()
    const btcAmount = (Number(satoshis) / 1e8).toFixed(8)
    const approved = await showApprovalWindow({
      title: 'Send Bitcoin',
      heading: `${origin} wants to send Bitcoin`,
      detail: `Send ${btcAmount} BTC\nTo: ${to}`,
      confirmLabel: 'Send',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    const res = await sendBitcoinTransaction(loadMnemonic(), a.bitcoin, String(to), btcAmount, a.accountIndex ?? 0)
    return res.txHash
  })

  // ── Config: get/set API keys ───────────────────────────────────────────
  ipcMain.handle('config:get', () => {
    const cfg = loadConfig()
    // Redact keys for display — only show that they're set
    return {
      alchemyKeySet: cfg.alchemyKey.length > 0,
      heliusKeySet: cfg.heliusKey.length > 0,
      blockfrostKeySet: cfg.blockfrostKey.length > 0
    }
  })

  ipcMain.handle('config:set', (_event, config: Partial<WalletConfig>) => {
    saveConfig(config)
    return true
  })

  // ── Phase 9: Avatar picker ────────────────────────────────────────────────
  ipcMain.handle('chainlens:pick-avatar', async () => {
    // Profile picker is a wallet action — keep it on the main wallet window.
    const avatarWin = getMainWin() ?? BrowserWindow.getAllWindows()[0]
    if (avatarWin && !avatarWin.isDestroyed()) {
      if (avatarWin.isMinimized()) avatarWin.restore()
      avatarWin.focus()
    }
    const { filePaths, canceled } = await dialog.showOpenDialog(avatarWin, {
      title: 'Choose Profile Photo',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return null
    const { readFileSync } = await import('fs')
    const buf = readFileSync(filePaths[0])
    const ext = filePaths[0].split('.').pop()?.toLowerCase() ?? 'jpg'
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', gif: 'image/gif', webp: 'image/webp'
    }
    return `data:${mimeMap[ext] ?? 'image/jpeg'};base64,${buf.toString('base64')}`
  })

  // ── Phase 10: WalletConnect ───────────────────────────────────────────────
  ipcMain.handle('wc:get-sessions',          () => wcGetSessions())
  ipcMain.handle('wc:get-pending-proposals', () => wcGetPendingProposals())
  ipcMain.handle('wc:pair',                  (_e, uri: string) => wcPair(uri))
  ipcMain.handle('wc:approve-session',       (_e, id: number) => wcApproveSession(id))
  ipcMain.handle('wc:reject-session',        (_e, id: number) => wcRejectSession(id))
  ipcMain.handle('wc:disconnect',            (_e, topic: string) => wcDisconnect(topic))
  ipcMain.handle('wc:approve-request',       (_e, id: number) => wcApproveRequest(id))
  ipcMain.handle('wc:reject-request',        (_e, id: number) => wcRejectRequest(id))

  // ── Phase 9: ChainLens profile sync ──────────────────────────────────────
  ipcMain.handle('chainlens:get-profile', async () => {
    const addresses = loadAddresses()
    if (!addresses?.evm) return null
    return getProfileByAddress(addresses.evm, loadConfig())
  })

  ipcMain.handle('chainlens:sync', async () => {
    const addresses = loadAddresses()
    if (!addresses?.evm) return { success: false, profile: null, error: 'No wallet found' }
    return syncWallets(addresses, loadConfig())
  })

  ipcMain.handle('chainlens:update-profile', async (_e, updates: { display_name?: string; avatar_url?: string }) => {
    const addresses = loadAddresses()
    if (!addresses?.evm) return { success: false, error: 'No wallet found' }
    const profile = await getProfileByAddress(addresses.evm, loadConfig())
    if (!profile) return { success: false, error: 'No ChainLens profile found' }
    return updateProfile(profile.id, updates, loadConfig())
  })
}
