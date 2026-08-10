/**
 * ipc-handlers.ts — MagicMoney Wallet
 *
 * All IPC channels the renderer can invoke via the preload bridge.
 * The renderer ONLY gets back public addresses, balances, and status booleans.
 * Keys and mnemonics are consumed and discarded within these handlers.
 */

import { ipcMain, BrowserWindow, dialog, app, clipboard, shell, type IpcMainInvokeEvent } from 'electron'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync, mnemonicToEntropy } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { blake2b } from '@noble/hashes/blake2b'
import { privateKeyToAccount } from 'viem/accounts'
import { ed25519 } from '@noble/curves/ed25519'
import { getCardanoStakeKey } from './cardano-pure'
import type { DappChain } from './dapp-permissions'
import { runPasskeyCeremony, verifyPasskeyPrf, importPasskeyPrf, passkeyCeremonySupported } from './passkey-window'
import { inAppBrowserEnv, walletEnv } from './passkey-manager'
import { reconcileChainLensPasskeys } from './passkey-reconcile-chainlens'
import { handlePasskeyCreate, handlePasskeyGet, handlePasskeyProbe, type PasskeyWirePayload } from './passkey-bridge'
import { encodePasskeyError } from './passkey-protocol'
import {
  generateMnemonic,
  mnemonicFromEntropy,
  toWordCount,
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
  getApprovedOriginRecords,
  hasOriginChain,
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
  hasPasskeyBackup,
  linkPasskey,
  mnemonicFromPasskeyBackup,
  removePasskeyBackup,
  enrollHello,
  unlockWithHello,
  removeHello,
  bioSupported,
  bioMethod,
  type WalletConfig,
  type CustomToken,
  type CustomNft
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
  getTorBrowserState,
  setTorBrowserMode,
  browserGetMagicGuardState,
  browserSetMagicGuardEnabled,
  browserSetMagicGuardForSite,
  getMainWin,
  showApprovalWindow,
  emitDappEvent,
  notifyBrowserChrome,
  layoutSnap,
  layoutDetach,
  layoutToggle,
  getLayoutState,
  browserToggleMaximize,
  setChromeHeight,
  openBrowserWithUrl,
  browserGetPageState,
  browserToggleBookmark,
  browserInstallPageAsApp,
  browserSavePage,
  browserCapturePage,
  browserActivePage,
  browserFillCredentials,
  browserAutofillFormFound,
  browserTryAutofillActiveTab,
  clearBrowsingData,
} from './browser-manager'
import { getBookmarks, removeBookmark, renameBookmark, mergeBookmarks, getWebApps } from './browser-store'
import { webAppsSupported, uninstallWebApp } from './web-apps'
import {
  passwordVaultStatus,
  unlockPasswords,
  lockPasswords,
  listPasswords,
  revealPassword,
  savePassword,
  deletePassword,
  mergePasswords,
  deletePasswordVault
} from './password-vault'
import { listImportSources, importPasswordsFrom, importBookmarksFrom, parsePasswordCsv } from './browser-import'
import { readFileSync } from 'fs'
import { join } from 'path'
import { downloadAsset } from './downloads'
import { getDefaultBrowserState, requestDefaultBrowser } from './default-browser'
import { MONAD_RPCS, activeEvmChains, activePublicRpcs, defaultDappChainId, isTestnet, isPrivacy, midnightNetworkFor } from './chain-config'
import {
  buildCustomChain, chainRemovalPatch, assertTokenImportable, assertNftImportable,
  removeTokenPatch, removeNftPatch, normalizeContractAddress, normalizeTokenId
} from './custom-chains'
import { getDappChainId, setDappChainId } from './dapp-chain'
import { startUpdateCheck, getUpdateState, installUpdate } from './update-manager'
import { heliusRpcUrl, tatumRpcUrl } from './api-proxy'
import { fetchAllBalances } from './balance-fetcher'
import { fetchAllHistory } from './tx-history'
import { fetchMarketTop100, searchMarketCoins, fetchCoinChart } from './market-fetcher'
import { fetchAllTokens, fetchAllCollectibles, fetchNftFloor, resolveCustomToken, resolveCustomNft } from './token-fetcher'
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
  sendZcashTransaction,
  type SendResult
} from './tx-sender'
import {
  cip30GetBalance, cip30GetUtxos, cip30GetRewardAddresses, cip30GetCollateral,
  cip30SignTx, cip30SignData, cip30SubmitTx, addressToHex,
} from './cardano-cip30'
import {
  summarizeCardanoTx, formatCardanoTxSummary, formatSignDataPayload,
} from './cardano-tx-inspect'
import {
  summarizeSolanaTx, formatSolanaTxSummary, formatSolanaMessage,
} from './solana-tx-inspect'
import {
  buildSiwsMessage, checkSiwsDomain, formatSiws, siwsWarnings, parseSiwsMessage,
  type SiwsInput,
} from './solana-siws'
import { fetchMidnightBalance } from './midnight'
import {
  activeMidnightNetwork, assertNetworkSupported, buildLegacyState,
  formatMidnightConnect, formatMidnightTransfer, midnightServiceUris,
  nightToStars, NIGHT_TOKEN_TYPE, STARS_PER_NIGHT,
  type MidnightAddressSet, type MidnightNetwork,
} from './midnight-connector'
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
  if (hasOriginChain(origin, 'evm')) return
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
  addApprovedOrigin(origin, 'evm')
}

// In-memory session cache of the confirmed mnemonic (cleared after save)
// This holds the phrase after generation/import but BEFORE the user sets a
// password (wallet:set-password), which is when it's actually persisted.
let _pendingMnemonic: string | null = null
// Set only when the pending wallet came from a passkey, so the user can ask
// whether that passkey reproduces it. Metadata only — no key material.
let _pendingPasskey: { id: string; transports: string[] } | null = null

/**
 * Shown whenever linking can't complete. Windows Hello mints PRF at
 * registration and refuses to evaluate it at assertion (measured across
 * Electron, Chrome and VS Code), and a phone reached over the hybrid tunnel is
 * never granted hmac-secret at all — so on desktop this is the expected outcome,
 * not a fault. Nothing is stored, and the wording must not imply the user did
 * anything wrong or that their wallet is affected.
 */
/**
 * Name shown in the OS passkey manager. MUST be unique per passkey: each one
 * yields different PRF bytes and therefore a DIFFERENT wallet, so identical
 * labels leave the user unable to tell which entry restores which wallet — and
 * picking the wrong one silently produces a valid, empty, wrong wallet. A date
 * alone collided for every passkey created on the same day.
 */
function passkeyLabel(): string {
  const when = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const tag = Math.random().toString(36).slice(2, 6)
  return `MagicMoney · ${when} · ${tag}`
}

const PASSKEY_LINK_UNSUPPORTED =
  'This device can’t read keys back from its passkeys, so a passkey could never restore this wallet. ' +
  'Nothing was changed and your wallet is unaffected — your seed phrase remains your backup. ' +
  'Passkey recovery currently works on Android.'
let _pendingPasskeyWords: 12 | 24 = 12

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

/**
 * Every path that clears the mnemonic must also clear the saved-password vault —
 * otherwise the browser's password manager would stay open (and fillable) behind a
 * locked wallet, which is exactly the state a walk-away attacker wants.
 */
function lockEverything(): void {
  lock()
  lockPasswords()
}

function touchActivity(): void {
  if (_lockTimer) { clearTimeout(_lockTimer); _lockTimer = null }
  if (!isUnlocked()) return
  _lockTimer = setTimeout(() => { lockEverything(); broadcastLocked() }, AUTO_LOCK_MS)
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
  // Also re-derives when a pre-Midnight-Preprod cache lacks the midnight field.
  if (isTestnet(config) && (!stored.testnet || !stored.testnet.midnight) && isUnlocked()) {
    stored = { ...stored, testnet: await deriveTestnetAddresses(loadMnemonic(), stored.accountIndex ?? 0) }
    saveAddresses(stored)
  }
  // Privacy Mode: same lazy backfill for the privacy chain set (XMR/ZEC/NIGHT).
  // Also re-derives when a pre-Midnight cache lacks the midnight fields —
  // Electron main always derives them (ledger-v9 WASM is available here).
  if (isPrivacy(config) && (!stored.privacy || !stored.privacy.midnight || !stored.privacy.midnightDust) && isUnlocked()) {
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
  // `words` is the user's 12/24 choice on the create screen; anything else
  // (including omitted, i.e. every older caller) falls back to 12.
  ipcMain.handle('wallet:generate', (_event, words?: unknown) => {
    _pendingMnemonic = generateMnemonic(toWordCount(words))
    _pendingPasskey = null
    // Return the words array for display — this is the ONLY time the
    // mnemonic is sent to the renderer, and only in the create flow.
    return _pendingMnemonic.split(' ')
  })

  // ── Generate a new mnemonic from a passkey (optional path) ─────────────
  // Same contract as wallet:generate — stashes a pending mnemonic and returns
  // the words — but the entropy comes from a WebAuthn PRF ceremony instead of
  // the system RNG. The result is ordinary BIP-39, so the rest of the create
  // flow (confirm-backup → set-password) is untouched.
  //
  // `reproducible` reports whether the passkey could re-derive its own output on
  // this device. It is display-only: the seed phrase is still shown and
  // confirmed either way, because Windows Hello can mint PRF at registration
  // and refuse to evaluate it at assertion (measured on Win11 26220).
  ipcMain.handle('wallet:generate-passkey', async (event, words?: unknown) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const result = await runPasskeyCeremony({
      parent,
      userName: passkeyLabel(),
    })
    const entropy = Uint8Array.from(Buffer.from(result.prfB64, 'base64'))
    try {
      _pendingMnemonic = mnemonicFromEntropy(entropy, toWordCount(words))
    } finally {
      entropy.fill(0)
    }
    // Remembered only for an optional, user-initiated reproducibility check
    // (below). Cleared with the pending mnemonic at set-password.
    _pendingPasskey = { id: result.credentialId, transports: result.transports }
    _pendingPasskeyWords = toWordCount(words)
    return { words: _pendingMnemonic.split(' ') }
  })

  // Optional: ask the passkey to reproduce the wallet we just made. Separate
  // from creation because it prompts again and FAILS LOUDLY on Windows Hello.
  // Compares derived mnemonics rather than holding raw entropy in memory.
  ipcMain.handle('wallet:passkey-verify', async event => {
    if (!_pendingPasskey || !_pendingMnemonic) throw new Error('No passkey wallet to check')
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const prfB64 = await verifyPasskeyPrf({ parent, credential: _pendingPasskey })
    if (!prfB64) return false
    const entropy = Uint8Array.from(Buffer.from(prfB64, 'base64'))
    try {
      return mnemonicFromEntropy(entropy, _pendingPasskeyWords) === _pendingMnemonic
    } catch {
      return false
    } finally {
      entropy.fill(0)
    }
  })

  // ── Link an EXISTING wallet to a passkey ───────────────────────────────
  // Creates a fresh passkey and wraps the unlocked phrase under its PRF output,
  // then immediately proves the round trip by unwrapping once. On platforms that
  // mint PRF at registration but refuse it at assertion (Windows Hello) that
  // check fails, and we delete the blob rather than leave the user believing
  // they have a recovery factor that can never be opened.
  ipcMain.handle('wallet:passkey-link', async event => {
    if (!isUnlocked()) throw new Error('Unlock the wallet first')
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    // The ceremony's own errors are written for wallet CREATION ("create a
    // wallet the normal way instead"), which is nonsense while linking an
    // existing one. Restate them for this context; a cancel stays a cancel.
    const result = await runPasskeyCeremony({
      parent,
      userName: passkeyLabel(),
    }).catch((e: unknown) => {
      const msg = String((e as Error)?.message ?? e)
      if (/cancel/i.test(msg)) throw new Error('Passkey setup was cancelled. Nothing changed.')
      throw new Error(PASSKEY_LINK_UNSUPPORTED)
    })
    const material = Uint8Array.from(Buffer.from(result.prfB64, 'base64'))
    try {
      await linkPasskey(material)
    } finally {
      material.fill(0)
    }

    const check = await verifyPasskeyPrf({
      parent,
      credential: { id: result.credentialId, transports: result.transports },
    })
    let ok = false
    if (check) {
      const again = Uint8Array.from(Buffer.from(check, 'base64'))
      try {
        ok = (await mnemonicFromPasskeyBackup(again)) === loadMnemonic()
      } catch { ok = false } finally { again.fill(0) }
    }
    if (!ok) {
      removePasskeyBackup()
      throw new Error(PASSKEY_LINK_UNSUPPORTED)
    }
    return true
  })

  ipcMain.handle('wallet:passkey-linked', () => hasPasskeyBackup())
  ipcMain.handle('wallet:passkey-unlink', () => { removePasskeyBackup(); return true })

  // Can this build offer the passkey option at all? The renderer can't answer
  // (file:// has no WebAuthn), so main reports platform capability instead.
  ipcMain.handle('wallet:passkey-supported', () => passkeyCeremonySupported())

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
    _pendingPasskey = null
    return addresses
  })

  // ── Import from a passkey ──────────────────────────────────────────────
  // The recovery counterpart of wallet:generate-passkey: re-derive the same
  // wallet from the same passkey. Lands in exactly the same pending state as a
  // typed import, so the rest of onboarding is untouched.
  //
  // `words` matters — the SAME passkey yields a different wallet at 12 vs 24
  // (12 truncates the PRF to its leading 128 bits), so the user must restore
  // with the length they created. The UI asks.
  ipcMain.handle('wallet:import-passkey', async (event, words?: unknown) => {
    const parent = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const prfB64 = await importPasskeyPrf({ parent })
    if (!prfB64) {
      throw new Error(
        'This device could not read a key from your passkey. Your passkey may be fine — some platforms cannot re-derive keys. Import your seed phrase instead.'
      )
    }
    const entropy = Uint8Array.from(Buffer.from(prfB64, 'base64'))
    let mnemonic: string
    try {
      // Two ways a passkey can reach a wallet, and they are not interchangeable:
      //  - LINKED: an existing seed was wrapped under this passkey. Unwrap it.
      //  - GENERATED: the wallet came from these PRF bytes. Re-derive it.
      // Try unwrapping first — if a blob exists it is the authoritative answer,
      // and deriving instead would silently produce a DIFFERENT wallet.
      if (hasPasskeyBackup()) {
        try {
          mnemonic = await mnemonicFromPasskeyBackup(entropy)
        } catch {
          // A linked wallet exists but THIS passkey cannot open it. Deriving
          // instead would hand back a real, empty, DIFFERENT wallet that looks
          // like a successful restore — funds could be sent to it. Fail loudly.
          throw new Error(
            'That passkey does not match the wallet linked on this device. Try the passkey you linked, or import your seed phrase.'
          )
        }
      } else {
        mnemonic = mnemonicFromEntropy(entropy, toWordCount(words))
      }
    } finally {
      entropy.fill(0)
    }
    const addresses = await deriveAddresses(mnemonic)
    saveAddresses(addresses)
    _pendingMnemonic = mnemonic
    _pendingPasskey = null
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
      _pendingPasskey = null
      // A pending mnemonic here means a DIFFERENT wallet just became the active
      // one (created or imported). Its dApp grants must start empty: inheriting
      // them would expose a brand-new address to every site the old wallet had
      // connected to, without the user ever approving it. The migration branch
      // below is the same wallet continuing, so it deliberately keeps them.
      clearApprovedOrigins()
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
    // Drop passkey rows the relying party has forgotten — the "Passkey not
    // recognised" failure, where we sign correctly with a credential the server
    // no longer has. Deliberately not awaited: unlock must not wait on the
    // network, and this can only ever remove rows the server positively
    // disowned, so a failure is the same as never having run.
    void reconcileChainLensPasskeys(walletEnv).catch(() => { /* best effort */ })
    return true
  })
  ipcMain.handle('wallet:lock', () => {
    lockEverything()
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
    // Saved site logins are encrypted under the wallet password, so wiping the
    // wallet leaves them permanently unopenable — remove them with it.
    deletePasswordVault()
    // dApp grants belong to the WALLET, not the install. Leaving them behind
    // meant the next wallet inherited every connection this one made, and would
    // hand its address to those sites with no approval step.
    clearApprovedOrigins()
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

  // Returns per-chain grant records so Settings can show what each site may
  // actually do, and revoke one chain without disconnecting the others.
  ipcMain.handle('wallet:get-connected-sites', () => getApprovedOriginRecords())

  ipcMain.handle('wallet:revoke-site', (_event, origin: string, chain?: DappChain) => {
    if (typeof origin !== 'string' || !origin) return getApprovedOriginRecords()
    removeApprovedOrigin(origin, chain)
    // Only signal a full disconnect once the site has no grants left.
    if (currentDappOrigin() === origin && !getApprovedOrigins().includes(origin)) notifyDappDisconnected()
    return getApprovedOriginRecords()
  })

  // Sign the in-app browser out of every site. Offered when a new wallet is
  // created (see SetPasswordPage) and never run without the user asking, since
  // it destroys real logins.
  ipcMain.handle('browser:clear-data', async () => {
    await clearBrowsingData()
    return true
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

  // ── Send NIGHT / DUST registration (Testnet/Privacy Mode; Midnight) ────────
  // Electron-only (see midnight-send.ts) — extension/Capacitor bridges simply
  // don't implement these, matching the optional-method WalletBridge pattern.
  // Network has no manual switcher: Testnet Mode -> Preprod, Privacy Mode ->
  // Mainnet (midnightNetworkFor in chain-config.ts); the two are already
  // mutually exclusive app-wide, so this can never be ambiguous.
  ipcMain.handle('wallet:get-midnight-dust-status', async () => {
    const config = loadConfig()
    const network = midnightNetworkFor(config)
    if (!network) throw new Error('Midnight is only available in Privacy Mode or Testnet Mode')
    const mnemonic = loadMnemonic()
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    const { getMidnightDustStatus } = await import('./midnight-send-manager')
    return getMidnightDustStatus(mnemonic, accountIndex, network)
  })

  ipcMain.handle('wallet:register-midnight-dust', async () => {
    const config = loadConfig()
    const network = midnightNetworkFor(config)
    if (!network) throw new Error('Midnight is only available in Privacy Mode or Testnet Mode')
    const mnemonic = loadMnemonic()
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    const { registerMidnightDustIfNeeded } = await import('./midnight-send-manager')
    return registerMidnightDustIfNeeded(mnemonic, accountIndex, network)
  })

  ipcMain.handle('wallet:send-midnight', async (_event, to: string, amountNight: string) => {
    const config = loadConfig()
    const network = midnightNetworkFor(config)
    if (!network) throw new Error('Midnight is only available in Privacy Mode or Testnet Mode')
    const stars = BigInt(Math.round(parseFloat(amountNight) * 1e6))
    if (stars <= 0n) throw new Error('Amount must be greater than 0')
    const mnemonic = loadMnemonic()
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    const { sendMidnightNight } = await import('./midnight-send-manager')
    const txId = await sendMidnightNight(mnemonic, accountIndex, network, to, stars)
    // No confirmed Preprod explorer URL — only link out for mainnet.
    const explorerUrl = network === 'mainnet' ? `https://midnightscan.io/tx/${txId}` : ''
    return { txHash: txId, explorerUrl } satisfies SendResult
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
  // ── Custom chains — user-added EVM networks (MetaMask-style manual add) ────
  ipcMain.handle('wallet:get-custom-chains', () => loadConfig().customChains ?? [])

  ipcMain.handle('wallet:add-custom-chain', async (_event, input: {
    name: string; chainId: number; nativeSymbol: string; rpcUrl: string; explorerUrl?: string
  }) => {
    // Validation, the duplicate checks and the RPC chain-id probe are shared with
    // the extension/Android handlers (custom-chains.ts) so the rules can't drift.
    const config = loadConfig()
    const chain = await buildCustomChain(input, config.customChains ?? [])
    saveConfig({ customChains: [...(config.customChains ?? []), chain] })
    return loadConfig().customChains
  })

  ipcMain.handle('wallet:remove-custom-chain', (_event, id: string) => {
    saveConfig(chainRemovalPatch(loadConfig(), String(id)))
    return loadConfig().customChains
  })

  // ── Imported ERC-20s on custom chains ("Import tokens") ───────────────────
  // Blockscout explorers are auto-detected in the token fetcher; this is the
  // manual fallback for custom chains whose explorer has no usable API.
  ipcMain.handle('wallet:get-custom-tokens', () => loadConfig().customTokens ?? [])

  // Read a contract's name/symbol/decimals + this wallet's balance, WITHOUT
  // saving — lets the import form show what it found before the user commits.
  ipcMain.handle('wallet:resolve-custom-token', async (_event, chainId: string, contractAddress: string) => {
    const addr = String(contractAddress ?? '').trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error('Enter a valid contract address (0x…)')
    const addresses = await getFullAddresses()
    return resolveCustomToken(String(chainId), addr, addresses.evm, loadConfig())
  })

  ipcMain.handle('wallet:import-custom-token', async (_event, chainId: string, contractAddress: string) => {
    const chain = String(chainId)
    const addr = normalizeContractAddress(contractAddress)
    const config = loadConfig()
    assertTokenImportable(config, chain, addr)

    // Resolving doubles as validation — a non-ERC-20 address throws here.
    const addresses = await getFullAddresses()
    const meta = await resolveCustomToken(chain, addr, addresses.evm, config)
    const token: CustomToken = {
      chain, contractAddress: addr,
      name: meta.name, symbol: meta.symbol, decimals: meta.decimals
    }
    saveConfig({ customTokens: [...(config.customTokens ?? []), token] })
    return loadConfig().customTokens
  })

  ipcMain.handle('wallet:remove-custom-token', (_event, chainId: string, contractAddress: string) => {
    const addr = String(contractAddress ?? '').trim().toLowerCase()
    saveConfig({ customTokens: removeTokenPatch(loadConfig(), String(chainId), addr) })
    return loadConfig().customTokens
  })

  // ── Imported NFTs on custom chains ────────────────────────────────────────
  ipcMain.handle('wallet:get-custom-nfts', () => loadConfig().customNfts ?? [])

  // Preview without saving: detect 721/1155, verify ownership, resolve artwork.
  // Omitting tokenId lists this wallet's tokens from an Enumerable ERC-721.
  ipcMain.handle('wallet:resolve-custom-nft', async (_event, chainId: string, contractAddress: string, tokenId?: string) => {
    const addr = String(contractAddress ?? '').trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) throw new Error('Enter a valid contract address (0x…)')
    const id = tokenId == null || String(tokenId).trim() === '' ? undefined : String(tokenId).trim()
    const addresses = await getFullAddresses()
    return resolveCustomNft(String(chainId), addr, id, addresses.evm, loadConfig())
  })

  ipcMain.handle('wallet:import-custom-nft', async (_event, chainId: string, contractAddress: string, tokenId: string) => {
    const chain = String(chainId)
    const addr = normalizeContractAddress(contractAddress)
    const id = normalizeTokenId(tokenId)
    const config = loadConfig()
    assertNftImportable(config, chain, addr, id)

    // Resolving doubles as validation: wrong contract, wrong id, or an NFT this
    // wallet doesn't own all throw here rather than being saved.
    const addresses = await getFullAddresses()
    const info = await resolveCustomNft(chain, addr, id, addresses.evm, config)
    const nft: CustomNft = { chain, contractAddress: addr, tokenId: id, type: info.type }
    saveConfig({ customNfts: [...(config.customNfts ?? []), nft] })
    return loadConfig().customNfts
  })

  ipcMain.handle('wallet:remove-custom-nft', (_event, chainId: string, contractAddress: string, tokenId: string) => {
    const addr = String(contractAddress ?? '').trim().toLowerCase()
    const id = String(tokenId ?? '').trim()
    saveConfig({ customNfts: removeNftPatch(loadConfig(), String(chainId), addr, id) })
    return loadConfig().customNfts
  })

  ipcMain.handle('wallet:get-testnet-mode', () => isTestnet(loadConfig()))

  ipcMain.handle('wallet:set-testnet-mode', async (_event, enabled: boolean) => {
    const on = !!enabled
    if (on) {
      if (!isUnlocked()) throw new Error('Unlock the wallet to enable Testnet Mode')
      const stored = loadAddresses()
      if (stored && (!stored.testnet || !stored.testnet.midnight)) {
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
      if (stored && (!stored.privacy || !stored.privacy.midnight || !stored.privacy.midnightDust)) {
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

    // Reset the dApp chain to the mode's default, exactly like the Testnet
    // toggle. Enabling Privacy clears testnetMode, so if the user was on a
    // testnet chain (e.g. Sepolia 11155111) the id would otherwise stay stale
    // and mismatch the mainnet set — which made the NetworkSwitcher fall back
    // to showing the TESTNET list while in mainnet.
    const def = defaultDappChainId(config)
    setDappChainId(def)
    const hex = `0x${def.toString(16)}`
    emitDappEvent('eth', 'chainChanged', hex)
    notifyBrowserChrome('web3:chain-changed', hex)

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
      { evm: addresses.evm, solana: addresses.solana, cardano: addresses.cardano, cardanoStake: addresses.cardanoStake, tron: addresses.tron, agw: addresses.agw, bitcoinTaproot: addresses.bitcoinTaproot },
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

  // ── NFT floor price via the shared OpenSea valuation path ─────────────────
  ipcMain.handle('wallet:get-nft-floor', async (_e, chain: string, contractAddress: string) => {
    return fetchNftFloor(chain, contractAddress, loadConfig())
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
  ipcMain.handle('browser:tor:get-state', () => getTorBrowserState())
  ipcMain.handle('browser:tor:set-mode', (_event, enabled: boolean) => setTorBrowserMode(enabled === true))
  ipcMain.handle('browser:guard:get-state', () => browserGetMagicGuardState())
  ipcMain.handle('browser:guard:set-enabled', (_event, enabled: boolean) => browserSetMagicGuardEnabled(enabled === true))
  ipcMain.handle('browser:guard:set-site-enabled', (_event, enabled: boolean) => browserSetMagicGuardForSite(enabled === true))
  // Open a URL from the WALLET UI in the built-in browser (never the OS one).
  ipcMain.on('browser:open-url', (_event, url: string) => openBrowserWithUrl(String(url ?? '')))

  // ── Bookmarks + page state (address-bar star, bookmarks panel) ────────────
  // browser:page-state is the single read the chrome renderer makes after every
  // navigation: is this page bookmarked, is it installed as an app, and do we
  // hold logins for it. Main derives all of that from the ACTIVE TAB itself.
  ipcMain.handle('browser:page-state', () => browserGetPageState())
  ipcMain.handle('browser:bookmarks:list', () => getBookmarks())
  ipcMain.handle('browser:bookmarks:toggle', () => browserToggleBookmark())
  ipcMain.handle('browser:bookmarks:remove', (_event, id: string) => removeBookmark(String(id ?? '')))
  ipcMain.handle('browser:bookmarks:rename', (_event, id: string, title: string) =>
    renameBookmark(String(id ?? ''), String(title ?? '')))
  ipcMain.handle('browser:bookmarks:import', (_event, sourceId: string) => {
    const result = importBookmarksFrom(String(sourceId ?? ''))
    if (result.error) return { added: 0, skipped: 0, error: result.error, bookmarks: getBookmarks() }
    const merged = mergeBookmarks(result.bookmarks)
    return { ...merged, bookmarks: getBookmarks() }
  })

  // ── Save and share (install as app, save page, screenshot, copy, QR) ──────
  ipcMain.handle('browser:apps:supported', () => webAppsSupported())
  ipcMain.handle('browser:apps:list', () => getWebApps())
  ipcMain.handle('browser:apps:install', () => browserInstallPageAsApp())
  ipcMain.handle('browser:apps:uninstall', (_event, id: string) => uninstallWebApp(String(id ?? '')))
  ipcMain.handle('browser:page:save', () => browserSavePage())
  ipcMain.handle('browser:page:capture', () => browserCapturePage())
  // Clipboard write happens in main: the chrome renderer often doesn't hold focus
  // (the dApp WebContentsView does), and navigator.clipboard silently fails there.
  ipcMain.handle('browser:page:copy-link', () => {
    const page = browserActivePage()
    if (!page?.url) return { ok: false as const, error: 'There is no page to copy' }
    clipboard.writeText(page.url)
    return { ok: true as const, url: page.url }
  })
  ipcMain.handle('browser:page:share-email', () => {
    const page = browserActivePage()
    if (!page?.url) return { ok: false as const, error: 'There is no page to share' }
    const mailto = `mailto:?subject=${encodeURIComponent(page.title || page.url)}&body=${encodeURIComponent(page.url)}`
    shell.openExternal(mailto)
    return { ok: true as const }
  })

  // ── Password manager (browser logins — NOT the wallet seed) ───────────────
  // The vault is unlocked separately from the wallet with the same password, and
  // every lock path (manual, idle, delete) clears it — see lockEverything().
  ipcMain.handle('passwords:status', () => passwordVaultStatus())
  ipcMain.handle('passwords:unlock', async (_event, password: string) => {
    if (!isUnlocked()) throw new Error('Unlock your wallet first')
    const status = await unlockPasswords(String(password ?? ''))
    touchActivity()
    // A login page may already be open — its preload's one-shot form report
    // fired while the vault was locked, so re-check the active tab now.
    void browserTryAutofillActiveTab()
    return status
  })
  ipcMain.handle('passwords:lock', () => { lockPasswords(); return passwordVaultStatus() })
  ipcMain.handle('passwords:list', () => listPasswords())
  // Reveal/copy is an explicit user action on an already-unlocked vault, so it
  // does not re-prompt — but it does count as activity against the idle timer.
  ipcMain.handle('passwords:reveal', (_event, id: string) => {
    touchActivity()
    return revealPassword(String(id ?? ''))
  })
  ipcMain.handle('passwords:save', (_event, input: { id?: string; url: string; username: string; password: string; note?: string }) => {
    touchActivity()
    return savePassword({
      id: typeof input?.id === 'string' ? input.id : undefined,
      url: String(input?.url ?? ''),
      username: String(input?.username ?? ''),
      password: String(input?.password ?? ''),
      note: typeof input?.note === 'string' ? input.note : undefined,
    })
  })
  ipcMain.handle('passwords:delete', (_event, id: string) => deletePassword(String(id ?? '')))
  ipcMain.handle('passwords:copy', (_event, id: string) => {
    touchActivity()
    clipboard.writeText(revealPassword(String(id ?? '')))
    return { ok: true as const }
  })
  ipcMain.handle('passwords:import-sources', () => listImportSources())
  // CSV import: main owns the file dialog AND the read, so the renderer never
  // touches a path. Accepts the standard Chrome/Edge/Brave/Bitwarden/LastPass
  // export shape (url,username,password with per-product column aliases).
  ipcMain.handle('passwords:import-csv', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      title: 'Import passwords from CSV',
      properties: ['openFile'],
      filters: [{ name: 'CSV files', extensions: ['csv', 'txt'] }],
    })
    if (canceled || filePaths.length === 0) return { added: 0, skipped: 0, canceled: true }
    let text: string
    try {
      text = readFileSync(filePaths[0], 'utf-8')
    } catch {
      return { added: 0, skipped: 0, error: 'The file could not be read' }
    }
    const parsed = parsePasswordCsv(text)
    if (parsed.error) return { added: 0, skipped: parsed.skipped, total: parsed.total, error: parsed.error }
    const merged = await mergePasswords(parsed.logins)
    return { ...merged, total: parsed.total, unreadable: parsed.skipped }
  })
  ipcMain.handle('passwords:import', async (_event, sourceId: string) => {
    const result = await importPasswordsFrom(String(sourceId ?? ''))
    if (result.error) return { added: 0, skipped: result.skipped, total: result.total, error: result.error }
    const merged = await mergePasswords(result.logins)
    return { ...merged, total: result.total, unreadable: result.skipped }
  })
  // Fill a saved login into the current page. Host-checked in main against the
  // ACTIVE TAB — only from a click in the password panel.
  ipcMain.handle('browser:passwords:fill', (_event, id: string) => browserFillCredentials(String(id ?? '')))
  // Auto-fill: a dApp tab's preload saw a visible password field appear. The
  // event carries NOTHING — the tab comes from the sender id and the host from
  // that tab's own URL, so a page cannot request another site's credential.
  // Non-tab senders (wallet window, popups) simply don't resolve to a tab.
  ipcMain.on('autofill:form-found', (event) => { void browserAutofillFormFound(event.sender.id) })

  // ── Downloads (NFT media) ─────────────────────────────────────────────────
  // Saves straight to the OS Downloads folder from main. The renderer cannot do
  // this itself: <a download> is ignored cross-origin, and the resulting
  // navigation used to escape to the system default browser.
  // Progress is pushed back to the CALLING window only, so the wallet's top-edge
  // bar animates while the bytes arrive.
  ipcMain.handle('wallet:download-file', (event, url: string, suggestedName: string) =>
    downloadAsset(String(url ?? ''), String(suggestedName ?? 'download'), p => {
      if (!event.sender.isDestroyed()) event.sender.send('download:progress', p)
    }))

  // ── Default browser (Windows) ─────────────────────────────────────────────
  ipcMain.handle('default-browser:get-state', () => getDefaultBrowserState())
  ipcMain.handle('default-browser:request', () => requestDefaultBrowser())

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

  // ── Passkeys in the built-in browser (from the page-world shim) ──────────
  //
  // The shim (src/shared/passkey-shim.ts) runs in the dApp page's own world, so
  // NOTHING it sends about identity is trusted: the origin comes from
  // `event.sender.getURL()` — the tab we are actually showing — exactly as the
  // password-autofill path does. passkey-ceremony then rejects an rpId that
  // origin does not own, and rebuilds clientDataJSON around it.
  //
  // Errors are flattened to `MMPK:<CODE>:<message>` because Electron's IPC
  // strips custom error properties; the shim parses them back into the right
  // DOMException. Uncoded failures deliberately lose their message.
  const passkeyIpc = <T>(
    run: (env: typeof inAppBrowserEnv, origin: string, payload: PasskeyWirePayload) => Promise<T>
  ) => async (event: IpcMainInvokeEvent, payload: PasskeyWirePayload): Promise<T> => {
    touchActivity()
    try {
      return await run(inAppBrowserEnv, getSenderOrigin(event.sender.getURL()), payload ?? {})
    } catch (e) {
      throw new Error(encodePasskeyError(e))
    }
  }

  ipcMain.handle('passkey:create', passkeyIpc(handlePasskeyCreate))
  ipcMain.handle('passkey:get', passkeyIpc(handlePasskeyGet))
  ipcMain.handle('passkey:probe', passkeyIpc(handlePasskeyProbe))

  // The page-world shim's source, served to the SANDBOXED dApp preload, which
  // has no `fs` of its own. Synchronous because the shim must be in place before
  // the page's first script runs. Read once and cached — this fires for every
  // frame of every tab.
  let _shimSource: string | null = null
  ipcMain.on('passkey:shim-source', (event) => {
    if (_shimSource === null) {
      try {
        // Built by build:inject into out/inject, beside approval-preload.js —
        // not the electron-vite preload dir.
        _shimSource = readFileSync(join(__dirname, '../inject/passkey-shim.js'), 'utf8')
      } catch (e) {
        console.warn('[MagicMoney] passkey shim bundle missing:', e)
        _shimSource = ''
      }
    }
    event.returnValue = _shimSource
  })

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
        if (hasOriginChain(origin, 'evm') && addresses?.evm) return [addresses.evm]
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
        addApprovedOrigin(origin, 'evm')
        return [addresses?.evm ?? '']
      }

      case 'eth_accounts':
        return hasOriginChain(origin, 'evm') && addresses?.evm ? [addresses.evm] : []

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
        if (!hasOriginChain(origin, 'evm')) {
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
          addApprovedOrigin(origin, 'evm')
        }
        return [{ parentCapability: 'eth_accounts' }]
      }

      case 'wallet_getPermissions':
        return hasOriginChain(origin, 'evm') ? [{ parentCapability: 'eth_accounts' }] : []

      case 'wallet_revokePermissions':
        // Scoped: revoking EVM permissions must not silently disconnect the
        // site's Cardano or Bitcoin grants, which it never asked about.
        removeApprovedOrigin(origin, 'evm')
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
  // Every Solana handler below is gated on a SOLANA grant for the calling
  // origin, and passes that origin to the prompt. Previously none of them
  // checked the origin at all and none showed it, so any page in the dApp
  // browser could raise a signing prompt that gave no clue who was asking.
  function requireSolana(event: IpcMainInvokeEvent): string {
    const origin = getSenderOrigin(event.sender.getURL())
    if (!hasOriginChain(origin, 'solana')) {
      throw Object.assign(new Error('Connect the wallet before using the Solana API.'), { code: 4100 })
    }
    return origin
  }

  /** Decode + simulate for the prompt. Never throws — see solana-tx-inspect.ts. */
  async function describeSolanaTx(txBytes: Uint8Array) {
    const addresses = await getFullAddresses()
    return summarizeSolanaTx(txBytes, {
      ownAddress: addresses.solana ?? '',
      config: loadConfig(),
    })
  }

  ipcMain.handle('web3:solana-connect', async (event) => {
    const origin = getSenderOrigin(event.sender.getURL())
    const addresses = await getFullAddresses()
    if (hasOriginChain(origin, 'solana')) return addresses.solana ?? ''
    const approved = await showApprovalWindow({
      title: 'Connect Solana Wallet',
      heading: `${origin} wants to connect to your Solana wallet`,
      detail: [
        `Address:\n${addresses.solana ?? 'Not available'}`,
        '',
        'This site will be able to:',
        '  • see your Solana address and balances',
        '  • ask you to sign messages and transactions',
        '',
        'Every signature still needs your approval.',
      ].join('\n'),
      confirmLabel: 'Connect',
      origin
    })
    if (!approved) {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    }
    // Remember the grant so the site isn't re-prompted on every reload.
    addApprovedOrigin(origin, 'solana')
    return addresses.solana ?? ''
  })

  ipcMain.handle('web3:solana-sign-message', async (event, messageBytes: number[]) => {
    const origin = requireSolana(event)
    const detail = formatSolanaMessage(Uint8Array.from(messageBytes))

    // Most dApps do Sign In With Solana through plain signMessage rather than
    // the solana:signIn feature. Parse the domain back out of the message so
    // the same phishing check applies: the text can claim any site it likes,
    // but it cannot fake the origin the request actually came from.
    let warnings: string[] = []
    const siws = parseSiwsMessage(detail.startsWith('Message:\n') ? detail.slice(9) : '')
    if (siws) warnings = siwsWarnings(siws, checkSiwsDomain(siws.domain, origin))

    const approved = await showApprovalWindow({
      title: 'Sign Solana Message',
      heading: 'A dApp wants to sign a message with your Solana wallet',
      detail,
      warnings,
      tone: warnings.length > 0 ? 'danger' : 'primary',
      confirmLabel: 'Sign',
      origin
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

  // Sign In With Solana (solana:signIn). Structured fields let US verify the
  // domain the dApp claims against the origin actually asking — the check the
  // user cannot make when a site hands over an opaque signMessage payload.
  ipcMain.handle('web3:solana-sign-in', async (event, input: SiwsInput | undefined) => {
    const origin = requireSolana(event)
    const addresses = await getFullAddresses()
    const address = addresses.solana ?? ''
    const siws = input ?? {}

    const check = checkSiwsDomain(siws.domain, origin)
    const warnings = siwsWarnings(siws, check)

    const approved = await showApprovalWindow({
      title: 'Sign In',
      heading: `${check.originHost} wants you to sign in`,
      detail: formatSiws(siws, address, check),
      warnings,
      confirmLabel: 'Sign in',
      tone: warnings.length > 0 ? 'danger' : 'primary',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })

    // Bind the signed message to the domain we verified, not the one claimed.
    const message = buildSiwsMessage({ ...siws, domain: siws.domain ?? check.originHost }, address)
    const messageBytes = new TextEncoder().encode(message)
    const accountIndex = addresses.accountIndex ?? 0
    const keypair = await getSolanaKeypair(loadMnemonic(), accountIndex)
    const signature = ed25519.sign(messageBytes, keypair.secretKey.slice(0, 32))

    return {
      address,
      signedMessage: Array.from(messageBytes),
      signature: Array.from(signature),
      signatureType: 'ed25519' as const,
    }
  })

  // Sign (only) a serialized Solana transaction and return the signed bytes.
  // The dApp broadcasts it itself (Wallet Standard signTransaction).
  ipcMain.handle('web3:solana-sign-tx', async (event, txBytes: number[]) => {
    const origin = requireSolana(event)
    const summary = await describeSolanaTx(Uint8Array.from(txBytes))
    const approved = await showApprovalWindow({
      title: 'Sign Solana Transaction',
      heading: 'A dApp wants you to sign a Solana transaction',
      detail: formatSolanaTxSummary(summary, { includeWarnings: false }),
      warnings: summary.warnings,
      confirmLabel: 'Sign',
      tone: summary.warnings.length > 0 ? 'danger' : 'primary',
      origin
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
  ipcMain.handle('web3:solana-sign-and-send', async (event, input: { transaction?: number[] }) => {
    const origin = requireSolana(event)
    if (!input?.transaction) throw new Error('No transaction data provided')
    const summary = await describeSolanaTx(Uint8Array.from(input.transaction))
    const approved = await showApprovalWindow({
      title: 'Send Solana Transaction',
      heading: 'A dApp wants to send a Solana transaction',
      detail: formatSolanaTxSummary(summary, { includeWarnings: false }),
      warnings: summary.warnings,
      confirmLabel: 'Send',
      tone: summary.warnings.length > 0 ? 'danger' : 'primary',
      origin
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

  /**
   * Decode a dApp transaction for the approval prompt. Never throws — a decoder
   * failure must still produce a prompt (marked undecodable) rather than an
   * error the user reads as "signing is broken".
   *
   * The stake-key hash is best-effort: it only drives the "also signs with your
   * stake key" warning, so if the vault can't produce it we show the rest of the
   * summary instead of failing the whole prompt.
   */
  async function describeCardanoTx(txHex: string, ownAddress: string, accountIndex: number) {
    let stakeKeyHash: Uint8Array | undefined
    try {
      const entropy = mnemonicToEntropy(loadMnemonic(), wordlist)
      stakeKeyHash = blake2b(getCardanoStakeKey(entropy, accountIndex).pub, { dkLen: 28 })
    } catch { /* warning omitted rather than blocking the prompt */ }

    return summarizeCardanoTx(txHex, {
      ownAddresses: [ownAddress],
      stakeKeyHash,
      config: loadConfig(),
    })
  }

  // ── CIP-30 Cardano dApp requests ─────────────────────────────────────────
  // Every handler below is gated on a CARDANO grant for the calling origin, not
  // merely on the origin being known: reads leak holdings and submitTx
  // broadcasts, so an EVM-only connection must not reach any of them.
  const cardanoOrigin = (event: IpcMainInvokeEvent): string => getSenderOrigin(event.sender.getURL())

  /** Throws CIP-30 APIError.Refused unless the origin holds a Cardano grant. */
  function requireCardano(event: IpcMainInvokeEvent): string {
    const origin = cardanoOrigin(event)
    if (!hasOriginChain(origin, 'cardano')) {
      throw Object.assign(new Error('Connect the wallet before using the Cardano API.'), { code: 4100 })
    }
    return origin
  }

  /**
   * The Cardano address CIP-30 should expose. getFullAddresses() applies the
   * Testnet Mode substitution, so in Testnet Mode dApps see the addr_test…
   * address that matches the network id we report — loadAddresses() alone would
   * hand out a mainnet address while the wallet operates on Preprod.
   */
  async function cardanoAddress(): Promise<{ address: string; accountIndex: number }> {
    const addresses = await getFullAddresses()
    if (!addresses.cardano) throw new Error('No Cardano wallet')
    return { address: addresses.cardano, accountIndex: addresses.accountIndex ?? 0 }
  }

  ipcMain.handle('cardano:is-enabled', (event) => hasOriginChain(cardanoOrigin(event), 'cardano'))

  ipcMain.handle('cardano:enable', async (event) => {
    const origin = cardanoOrigin(event)
    if (hasOriginChain(origin, 'cardano')) return true
    const { address } = await cardanoAddress().catch(() => ({ address: '' }))
    const approved = await showApprovalWindow({
      title: 'Connect Cardano Wallet',
      heading: `${origin} wants to connect to your Cardano wallet`,
      // State the grant explicitly — the site can read holdings and ask for
      // signatures, and the user should know that before allowing it.
      detail: [
        `Address:\n${address || 'Not available'}`,
        '',
        'This site will be able to:',
        '  • see your Cardano address, balance and UTxOs',
        '  • ask you to sign transactions and data',
        '',
        'Every signature still needs your approval.',
      ].join('\n'),
      confirmLabel: 'Connect',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    addApprovedOrigin(origin, 'cardano')
    return true
  })

  // 1 = mainnet, 0 = testnet. Must track Testnet Mode: reporting mainnet while
  // handing out addr_test… addresses makes dApps build unusable transactions.
  ipcMain.handle('cardano:get-network-id', (event) => {
    requireCardano(event)
    return isTestnet(loadConfig()) ? 0 : 1
  })

  ipcMain.handle('cardano:get-balance', async (event) => {
    requireCardano(event)
    const { address } = await cardanoAddress()
    return cip30GetBalance(address, loadConfig())
  })

  ipcMain.handle('cardano:get-utxos', async (event) => {
    requireCardano(event)
    const { address } = await cardanoAddress()
    return cip30GetUtxos(address, loadConfig())
  })

  ipcMain.handle('cardano:get-collateral', async (event, amountHex?: string) => {
    requireCardano(event)
    const { address } = await cardanoAddress()
    return cip30GetCollateral(address, loadConfig(), amountHex)
  })

  ipcMain.handle('cardano:get-used-addresses', async (event) => {
    requireCardano(event)
    // CIP-30 requires hex-encoded address bytes, not bech32 — dApps match these
    // against indexer-reported owner addresses to detect ownership.
    const { address } = await cardanoAddress()
    return [addressToHex(address)]
  })

  ipcMain.handle('cardano:get-unused-addresses', (event) => {
    requireCardano(event)
    return []
  })

  ipcMain.handle('cardano:get-change-address', async (event) => {
    requireCardano(event)
    const { address } = await cardanoAddress()
    return addressToHex(address)
  })

  ipcMain.handle('cardano:get-reward-addresses', async (event) => {
    requireCardano(event)
    const { accountIndex } = await cardanoAddress()
    return cip30GetRewardAddresses(loadMnemonic(), accountIndex, isTestnet(loadConfig()))
  })

  ipcMain.handle('cardano:sign-tx', async (event, txHex: string, _partial: boolean) => {
    const origin = requireCardano(event)
    const { address, accountIndex } = await cardanoAddress()
    const summary = await describeCardanoTx(txHex, address, accountIndex)
    const approved = await showApprovalWindow({
      title: 'Sign Transaction',
      heading: 'A dApp wants you to sign a Cardano transaction',
      detail: formatCardanoTxSummary(summary, { includeWarnings: false }),
      warnings: summary.warnings,
      confirmLabel: 'Sign',
      tone: summary.warnings.length > 0 ? 'danger' : 'primary',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    try {
      return await cip30SignTx(txHex, loadMnemonic(), accountIndex)
    } catch (err) {
      throw new Error(`Could not sign this Cardano transaction — the dApp may have sent it in an unexpected format. (${err instanceof Error ? err.message : String(err)})`)
    }
  })

  ipcMain.handle('cardano:sign-data', async (event, address: string, payloadHex: string) => {
    const origin = requireCardano(event)
    const { address: ownAddress, accountIndex } = await cardanoAddress()
    const approved = await showApprovalWindow({
      title: 'Sign Data',
      heading: 'A dApp wants you to sign data with your Cardano wallet',
      detail: formatSignDataPayload(payloadHex),
      confirmLabel: 'Sign',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    try {
      return await cip30SignData(address || ownAddress, payloadHex, loadMnemonic(), accountIndex)
    } catch (err) {
      throw new Error(`Could not sign this Cardano data payload. (${err instanceof Error ? err.message : String(err)})`)
    }
  })

  // Broadcasting is a state change, so it is gated AND approved. Without this an
  // unconnected page could push arbitrary CBOR straight to the network.
  ipcMain.handle('cardano:submit-tx', async (event, txHex: string) => {
    const origin = requireCardano(event)
    const { address, accountIndex } = await cardanoAddress()
    const summary = await describeCardanoTx(txHex, address, accountIndex)
    const approved = await showApprovalWindow({
      title: 'Submit Transaction',
      heading: 'A dApp wants to broadcast a Cardano transaction',
      detail: formatCardanoTxSummary(summary, { includeWarnings: false }),
      warnings: summary.warnings,
      confirmLabel: 'Submit',
      tone: summary.warnings.length > 0 ? 'danger' : 'primary',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    return cip30SubmitTx(txHex, loadConfig())
  })

  // ── Midnight DApp Connector ──────────────────────────────────────────────
  // Serves BOTH generations of the connector API from one set of handlers (see
  // midnight-connector.ts). Nothing here imports the ledger WASM directly —
  // midnight-send-manager is dynamically imported inside the handlers that need
  // it, so the injected page-side shim stays WASM-free.

  function requireMidnight(event: IpcMainInvokeEvent): string {
    const origin = getSenderOrigin(event.sender.getURL())
    if (!hasOriginChain(origin, 'midnight')) {
      throw Object.assign(new Error('Connect the wallet before using the Midnight API.'), { code: 4100 })
    }
    return origin
  }

  /** Midnight addresses for the active mode, or throws with what to turn on. */
  async function midnightState(): Promise<{
    network: MidnightNetwork
    addresses: MidnightAddressSet
    accountIndex: number
  }> {
    const config = loadConfig()
    const network = activeMidnightNetwork(config)
    const stored = await getFullAddresses()
    // Testnet Mode keeps its Midnight set under `testnet`, Privacy Mode under
    // `privacy` — effectiveAddresses does not merge these, so pick explicitly.
    const set = network === 'preprod' ? stored.testnet : stored.privacy
    return {
      network,
      addresses: {
        unshielded: set?.midnight,
        shielded: set?.midnightShielded,
        dust: set?.midnightDust,
      },
      accountIndex: stored.accountIndex ?? 0,
    }
  }

  ipcMain.handle('midnight:is-enabled', (event) =>
    hasOriginChain(getSenderOrigin(event.sender.getURL()), 'midnight'))

  ipcMain.handle('midnight:enable', async (event, requestedNetwork?: string) => {
    const origin = getSenderOrigin(event.sender.getURL())
    const { network, addresses } = await midnightState()
    assertNetworkSupported(requestedNetwork, network)
    if (hasOriginChain(origin, 'midnight')) return true

    const approved = await showApprovalWindow({
      title: 'Connect Midnight Wallet',
      heading: `${origin} wants to connect to your Midnight wallet`,
      detail: formatMidnightConnect(origin, network, addresses),
      confirmLabel: 'Connect',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: -3 })
    addApprovedOrigin(origin, 'midnight')
    return true
  })

  ipcMain.handle('midnight:state', async (event) => {
    requireMidnight(event)
    const { addresses } = await midnightState()
    return buildLegacyState(addresses)
  })

  ipcMain.handle('midnight:addresses', async (event) => {
    requireMidnight(event)
    const { addresses } = await midnightState()
    return addresses
  })

  ipcMain.handle('midnight:service-uris', async (event) => {
    requireMidnight(event)
    const { network } = await midnightState()
    return midnightServiceUris(network)
  })

  ipcMain.handle('midnight:connection-status', async (event) => {
    const origin = getSenderOrigin(event.sender.getURL())
    if (!hasOriginChain(origin, 'midnight')) return { status: 'disconnected' as const }
    const { network } = await midnightState()
    return { status: 'connected' as const, networkId: network }
  })

  ipcMain.handle('midnight:balances', async (event) => {
    requireMidnight(event)
    const { network, addresses } = await midnightState()
    const { native, error } = await fetchMidnightBalance(addresses.unshielded, network)
    if (error && error !== 'coming-soon') throw new Error(error)
    // Raw base units (Stars), matching the connector spec's bigint-as-string.
    return { [NIGHT_TOKEN_TYPE]: String(BigInt(Math.round(native * Number(STARS_PER_NIGHT)))) }
  })

  ipcMain.handle('midnight:dust-balance', async (event) => {
    requireMidnight(event)
    const { network, accountIndex } = await midnightState()
    // PEEK — deliberately not getMidnightDustStatus(), which opens the whole
    // Midnight wallet (WASM + indexer sync) on the main process. A dApp read
    // must never trigger that: it locks up the UI, including any approval
    // window already on screen. Reports 0 when the wallet isn't open, which is
    // honest — no DUST is available to spend until it is.
    const { peekMidnightDustStatus } = await import('./midnight-send-manager')
    const status = peekMidnightDustStatus(accountIndex, network)
    return status?.ready ? '1' : '0'
  })

  // Legacy submitTransaction. We do not accept a pre-built transaction: it
  // would arrive as opaque bytes we cannot decode, so the user could not be
  // told what they are approving. dApps should use makeTransfer instead.
  ipcMain.handle('midnight:submit', () => {
    throw Object.assign(
      new Error(
        'MagicMoney cannot submit a pre-built Midnight transaction, because it '
        + 'cannot show you what that transaction does. Use makeTransfer so the '
        + 'wallet can build and describe the transfer itself.'
      ),
      { code: -1 }
    )
  })

  ipcMain.handle('midnight:transfer', async (event, to: string, amountNight: string) => {
    const origin = requireMidnight(event)
    const { network, accountIndex } = await midnightState()
    const stars = nightToStars(amountNight)

    // Validate BEFORE prompting. Opening the Midnight wallet to attempt a send
    // is a minute of WASM + indexer sync, so a wrong-network or malformed
    // address must fail here — not after the user approves and then watches the
    // app appear to hang while it works toward a send that cannot succeed.
    const check = validateAddress('midnight', to, network === 'preprod')
    if (!check.valid) throw Object.assign(new Error(check.reason ?? 'Invalid address'), { code: -1 })

    const approved = await showApprovalWindow({
      title: 'Send NIGHT',
      heading: 'A dApp wants to send NIGHT from your wallet',
      detail: formatMidnightTransfer(to, stars, network),
      confirmLabel: 'Send',
      origin
    })
    if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: -3 })

    const { registerMidnightDustIfNeeded, sendMidnightNight } = await import('./midnight-send-manager')
    const mnemonic = loadMnemonic()
    // Fees are paid in DUST, which only exists once NIGHT UTxOs are registered
    // to generate it — a first-time sender would otherwise just fail here.
    await registerMidnightDustIfNeeded(mnemonic, accountIndex, network)
    const txId = await sendMidnightNight(mnemonic, accountIndex, network, to, stars)
    return { txId, explorerUrl: network === 'mainnet' ? `https://midnightscan.io/tx/${txId}` : '' }
  })

  // ── Bitcoin / Ordinals dApp provider (sats-connect/WBIP + Unisat) ─────────
  // Mirrors the Cardano CIP-30 flow: connect is approval-gated + the origin is
  // remembered; every signing request shows the approval modal with the origin.
  const btcAddrType = (addr: string, a: WalletAddresses): 'native' | 'nested' | 'taproot' =>
    addr === a.bitcoinNested ? 'nested' : addr === a.bitcoinTaproot ? 'taproot' : 'native'

  async function btcConnect(origin: string): Promise<WalletAddresses> {
    const a = await getFullAddresses()
    if (!hasOriginChain(origin, 'bitcoin')) {
      const approved = await showApprovalWindow({
        title: 'Connect Bitcoin Wallet',
        heading: `${origin} wants to connect to your Bitcoin wallet`,
        detail: `Payment (SegWit):\n${a.bitcoin}\n\nOrdinals (Taproot):\n${a.bitcoinTaproot}`,
        confirmLabel: 'Connect',
        origin
      })
      if (!approved) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
      addApprovedOrigin(origin, 'bitcoin')
    }
    return a
  }

  ipcMain.handle('bitcoin:is-enabled', (event) =>
    hasOriginChain(getSenderOrigin(event.sender.getURL()), 'bitcoin'))

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
    return hasOriginChain(origin, 'bitcoin') && a.bitcoin ? [a.bitcoin] : []
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
    if (!hasOriginChain(origin, 'bitcoin')) throw Object.assign(new Error('Connect the wallet before signing.'), { code: 4100 })
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
    if (!hasOriginChain(origin, 'bitcoin')) throw Object.assign(new Error('Connect the wallet before signing.'), { code: 4100 })
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
    if (!hasOriginChain(origin, 'bitcoin')) throw Object.assign(new Error('Connect the wallet before sending.'), { code: 4100 })
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
