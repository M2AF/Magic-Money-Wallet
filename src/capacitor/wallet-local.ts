/**
 * wallet-local.ts — Capacitor window.wallet provider
 *
 * The Android counterpart of src/extension/bridge.ts, except there is no
 * process boundary: the shared handle() router from wallet-handlers.ts runs in
 * this same WebView, so every call is a direct in-process invocation (no
 * chrome.runtime messaging, no timeouts). Push events ride the in-process bus
 * from platform-capacitor.ts.
 *
 * The vite.capacitor config aliases wallet-handlers' './chrome-store' import to
 * capacitor-store.ts and './platform' to platform-capacitor.ts, so the router
 * transparently uses Preferences-backed storage and the local event bus.
 */

import type { ApprovedOrigin, DappChain } from '../main/dapp-permissions'

import { App as CapacitorApp } from '@capacitor/app'
import { handle, type Sender } from '../extension/wallet-handlers'
import { onUiEvent, offUiEvent, emitUiEvent } from './platform-capacitor'
import { helloStatus, helloEnroll, helloUnlock, helloRemove } from './biometric'
import {
  passkeyProviderStatus, enablePasskeyProvider, disablePasskeyProvider,
  openPasskeyProviderSettings,
} from './passkey-system-provider'
import {
  passkeySupported, createPasskeyMnemonic, verifyPasskeyWallet, importPasskeyMnemonic,
  linkPasskeyToWallet, passkeyLinked, passkeyUnlink,
} from './passkey'
import { updateCheck, updateGetState, updateInstall, isPlayStoreInstall } from './update-check'
import { setSecureScreen } from './app-info'
import { scanQr } from './qr-scan'
import { DappBrowser } from './dapp-browser'
import { DefaultBrowser } from './default-browser'
import { Downloader } from './downloader'
import { HOME_URL } from './BrowserOverlay'
import * as Bm from './browser-data-local'
import { registerLockListener } from './capacitor-store'
import { buildFillScript } from '../main/password-fill'
import { parsePasswordCsv } from '../main/password-csv'
import type { DefaultBrowserState, DownloadProgress, DownloadResult } from '../renderer/types/wallet'

// Our own UI is the privileged caller — same classification the extension gives
// its popup pages, so the PAGE_RPC_TYPES gate stays closed to dApp content only.
const UI_SENDER: Sender = { origin: 'wallet-ui', kind: 'extension' }

// ── Browser extras: bookmarks, saved passwords, autofill ─────────────────────
//
// Android mirror of the desktop's browser-store/password-vault/autofill trio.
// Two invariants carried over from the desktop implementation:
//   • the page identity always comes from the ACTIVE TAB (DappBrowser.getState),
//     never from a value a page or component passed in, and
//   • a fill only ever happens for an EXACT host match on an unlocked vault.
// The fill script itself is the shared one (password-fill.ts), so the desktop
// and Android behaviours cannot drift.

// Locking the wallet (explicit or idle expiry) must also close the saved-password
// vault — otherwise the browser's password manager would stay open and fillable
// behind a locked wallet. Desktop does this in ipc-handlers' lockEverything().
registerLockListener(() => {
  Bm.lockPasswords()
  resetAutofillGuard()
})

const errText = (e: unknown, fallback: string): string =>
  e instanceof Error && e.message ? e.message : fallback

function hostLabel(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

/** The active tab's live URL + title, straight from the native plugin. */
async function activePage(): Promise<{ url: string; title: string }> {
  try {
    const s = await DappBrowser.getState()
    const tab = s.tabs.find(t => t.id === s.activeTabId)
    return { url: s.url || tab?.url || '', title: tab?.title || '' }
  } catch {
    return { url: '', title: '' }
  }
}

async function browserPageState() {
  const page = await activePage()
  const host = page.url ? Bm.hostOf(page.url) : ''
  const web = /^https?:\/\//i.test(page.url)
  const unlocked = Bm.isPasswordVaultUnlocked()
  return {
    url: page.url,
    title: page.title,
    host,
    bookmarked: web ? await Bm.isBookmarked(page.url) : false,
    installed: web ? await Bm.isWebAppInstalled(page.url) : false,
    savedLogins: host && unlocked ? Bm.matchPasswordsForHost(host) : [],
    passwordsUnlocked: unlocked,
  }
}

/** Fill one saved login into the active tab, host-checked against that tab. */
async function fillSavedLogin(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!Bm.isPasswordVaultUnlocked()) return { ok: false, error: 'Unlock the password manager first' }
  const page = await activePage()
  const host = page.url ? Bm.hostOf(page.url) : ''
  if (!host) return { ok: false, error: 'This page has no address to match' }
  const match = Bm.matchPasswordsForHost(host).find(m => m.id === id)
  if (!match) return { ok: false, error: 'That login is not saved for this site' }

  let password: string
  try {
    password = Bm.revealPassword(id)
  } catch (e) {
    return { ok: false, error: errText(e, 'Could not read that saved password') }
  }

  try {
    const res = await DappBrowser.fillCredentials({ script: buildFillScript(match.username, password) })
    if (!res.ok) return { ok: false, error: 'No sign-in form was found on this page' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'The page would not accept the fill' }
  }
}

/** Only https (or loopback, for local dev) pages are eligible for auto-fill. */
function autofillOriginOk(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')
  } catch {
    return false
  }
}

// Host already auto-filled for the current document, so a page fills at most
// once; cleared when the active tab navigates (urlChanged).
let _autofilledHost: string | null = null

export function resetAutofillGuard(): void {
  _autofilledHost = null
}

/**
 * Decide whether to auto-fill the active tab. Exact-host matches only — a
 * related-domain match stays click-to-fill in the password panel — and never
 * auto-submits. Announced on the bus so the chrome can show a confirmation.
 */
export async function maybeAutofillActiveTab(): Promise<void> {
  if (!Bm.isPasswordVaultUnlocked()) return
  const page = await activePage()
  if (!page.url || !autofillOriginOk(page.url)) return
  const host = Bm.hostOf(page.url)
  if (!host || _autofilledHost === host) return
  const exact = Bm.matchPasswordsForHost(host).filter(m => m.host === host)
  if (exact.length === 0) return

  _autofilledHost = host
  const result = await fillSavedLogin(exact[0].id)
  if (result.ok) {
    emitUiEvent('cap:browser:autofill', { host, username: exact[0].username, more: exact.length - 1 })
  } else {
    _autofilledHost = null   // form vanished mid-fill — let a later form retry
  }
}

/** Re-probe the active tab (used after a late vault unlock). */
async function tryAutofillActiveTab(): Promise<void> {
  try {
    const probe = await DappBrowser.hasLoginForm()
    if (probe.hasForm) await maybeAutofillActiveTab()
  } catch { /* no browser open */ }
}

/**
 * CSV import. Android has no native file dialog exposed to the WebView, but the
 * Capacitor WebView implements onShowFileChooser, so a transient
 * <input type="file"> is the supported way to reach the system picker. The file
 * is read and parsed in-process; nothing is written to disk.
 */
function importPasswordsFromCsvFile(): Promise<{ added: number; skipped: number; total?: number; unreadable?: number; canceled?: boolean; error?: string }> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.csv,text/csv,text/plain'
    input.style.position = 'fixed'
    input.style.left = '-10000px'
    let settled = false
    const finish = (v: { added: number; skipped: number; total?: number; unreadable?: number; canceled?: boolean; error?: string }) => {
      if (settled) return
      settled = true
      input.remove()
      resolve(v)
    }
    // A dismissed picker fires no event on Android, so treat the window regaining
    // focus without a selection as a cancel rather than hanging the UI forever.
    const onFocus = () => {
      window.removeEventListener('focus', onFocus)
      setTimeout(() => { if (!input.files || input.files.length === 0) finish({ added: 0, skipped: 0, canceled: true }) }, 1200)
    }
    input.onchange = async () => {
      window.removeEventListener('focus', onFocus)
      const file = input.files?.[0]
      if (!file) { finish({ added: 0, skipped: 0, canceled: true }); return }
      try {
        const parsed = parsePasswordCsv(await file.text())
        if (parsed.error) { finish({ added: 0, skipped: parsed.skipped, total: parsed.total, error: parsed.error }); return }
        const merged = await Bm.mergePasswords(parsed.logins)
        finish({ ...merged, total: parsed.total, unreadable: parsed.skipped })
      } catch (e) {
        finish({ added: 0, skipped: 0, error: errText(e, 'The file could not be read') })
      }
    }
    document.body.appendChild(input)
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

function send<T = unknown>(type: string, ...args: unknown[]): Promise<T> {
  return handle({ type, args }, UI_SENDER) as Promise<T>
}

function normalizeWebUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const scheme = /\.onion(?:[/?#]|$)/i.test(trimmed) ? 'http' : 'https'
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `${scheme}://${trimmed}`
  try {
    const u = new URL(candidate)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

// Download progress fan-out. The native plugin gets exactly ONE listener, wired
// lazily on the first subscriber (nothing heavy runs at module load), and the
// renderer's DownloadProgressBar subscribes/unsubscribes through this set.
const downloadProgressListeners = new Set<(p: DownloadProgress) => void>()
let downloadProgressWired = false

function ensureDownloadProgressWired(): void {
  if (downloadProgressWired) return
  downloadProgressWired = true
  Downloader.addListener('progress', p => {
    for (const cb of downloadProgressListeners) {
      try { cb(p) } catch { /* one bad subscriber must not stop the rest */ }
    }
  }).catch(() => { downloadProgressWired = false })
}

// ── window.wallet implementation ──────────────────────────────────────────────

export function createCapacitorWallet() {
  const wallet = buildWallet()
  // Play installs must not self-update (store policy) — strip the update
  // surface so SettingsModal's `typeof updateCheck === 'function'` gate hides
  // the whole Software Update section. Async, but resolves long before the
  // user can open Settings; the same binary keeps the updater when sideloaded.
  isPlayStoreInstall().then(play => {
    if (!play) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = wallet as any
    delete w.updateCheck
    delete w.updateGetState
    delete w.updateInstall
  }).catch(() => {})
  return wallet
}

function buildWallet() {
  return {
    // Lifecycle
    isSetup:        ()                      => send<boolean>('wallet:is-setup'),
    isUnlocked:     ()                      => send<boolean>('wallet:is-unlocked'),
    unlock:         (password: string)      => send<boolean>('wallet:unlock', password),
    lock:           ()                      => send<boolean>('wallet:lock'),
    generate:       (words?: 12 | 24)       => send<string[]>('wallet:generate', words),
    // Passkey path: the ceremony must run HERE (the WebView is the only secure
    // origin), then the resulting phrase is stashed as the pending wallet.
    passkeySupported: () => passkeySupported(),
    generateWithPasskey: async (words?: 12 | 24) => {
      const mnemonic = await createPasskeyMnemonic(words)
      return { words: await send<string[]>('wallet:stash-pending', mnemonic) }
    },
    passkeyVerify: () => verifyPasskeyWallet(),
    importWithPasskey: async (words?: 12 | 24) => {
      const mnemonic = await importPasskeyMnemonic(words)
      return send('wallet:import', mnemonic)
    },
    // Link/unlink an EXISTING wallet to a passkey. Runs entirely in this
    // context — the WebView is both the WebAuthn origin and the store.
    passkeyLink: () => linkPasskeyToWallet(),
    passkeyLinked: () => passkeyLinked(),
    passkeyUnlink: () => passkeyUnlink(),
    validate:       (m: string)             => send<boolean>('wallet:validate', m),
    confirmBackup:  ()                      => send('wallet:confirm-backup'),
    setPassword:    (password: string)      => send<boolean>('wallet:set-password', password),
    import:         (m: string)             => send('wallet:import', m),
    deleteWallet:   ()                      => send<boolean>('wallet:delete'),

    // Data
    getAddresses:   ()                      => send('wallet:get-addresses'),
    getBalances:    ()                      => send('wallet:get-balances'),
    revealSeed:     (password: string)      => send<string[]>('wallet:reveal-seed', password),
    getHistory:     ()                      => send('wallet:get-history'),
    getAccountIndex:()                      => send<number>('wallet:get-account'),
    setAccount:     (i: number)             => send('wallet:set-account', i),
    setAgw:         (i: number, address: string | null) => send('wallet:set-agw', i, address),
    importAgwSigner: (i: number, secret: string) => send('wallet:import-agw-signer', i, secret),
    removeAgwSigner: (i: number) => send('wallet:remove-agw-signer', i),

    // Connected sites (revoke dApp access)
    getConnectedSites: ()             => send<ApprovedOrigin[]>('wallet:get-connected-sites'),
    revokeSite: (origin: string, chain?: DappChain) => send<ApprovedOrigin[]>('wallet:revoke-site', origin, chain),
    revokeAllSites: ()                => send<ApprovedOrigin[]>('wallet:revoke-all-sites'),

    // Transactions
    validateAddress: (c: string, t: string) => send<{ valid: boolean; reason?: string }>('wallet:validate-address', c, t),
    estimateFee:    (c: string, t: string, a: string) => send('wallet:estimate-fee', c, t, a),
    sendEvm:        (c: string, t: string, a: string) => send('wallet:send-evm', c, t, a),
    sendAgw:        (t: string, a: string, token?: { contractAddress: string; decimals: number }) => send('wallet:send-agw', t, a, token),
    sendSolana:     (t: string, a: string)            => send('wallet:send-solana', t, a),
    sendCardano:    (t: string, a: string)            => send('wallet:send-cardano', t, a),
    sendTron:       (t: string, a: string, token?: { contractAddress: string; decimals: number }) => send('wallet:send-tron', t, a, token),
    sendDogecoin:   (t: string, a: string)            => send('wallet:send-dogecoin', t, a),
    sendBitcoin:    (t: string, a: string)            => send('wallet:send-bitcoin', t, a),
    sendMonero:     (t: string, a: string)            => send('wallet:send-monero', t, a),
    sendZcash:      (t: string, a: string)            => send('wallet:send-zcash', t, a),
    // Midnight NIGHT send. Optional-method convention (see wallet.ts): the
    // presence of sendMidnight is what makes the Send button render on the
    // Midnight card, so these three must ship together.
    sendMidnight:   (t: string, a: string)            => send('wallet:send-midnight', t, a),
    getMidnightDustStatus: ()                         => send('wallet:get-midnight-dust-status'),
    registerMidnightDust:  ()                         => send('wallet:register-midnight-dust'),

    // Market
    getMarket:      ()                      => send('wallet:get-market'),
    searchMarket:   (q: string)             => send('wallet:search-market', q),
    getCoinChart:   (id: string, d: string) => send('wallet:get-coin-chart', id, d),
    getTokens:      ()                      => send('wallet:get-tokens'),
    getCollectibles:(excludeIds?: string[]) => send('wallet:get-collectibles', excludeIds),
    getNftFloor:    (c: string, a: string)  => send('wallet:get-nft-floor', c, a),
    swapGetQuote:   (req: unknown)          => send('swap:getQuote', req),
    swapExecute:    (quote: unknown)        => send('swap:execute', quote),
    swapCrossStatus:(req: unknown)          => send('swap:crossStatus', req),
    swapGetTokens:  (chain: string)         => send('swap:getTokenList', chain),
    ssEstimate:     (params: unknown)       => send('ss:estimate', params),
    ssCreateExchange:(params: unknown)      => send('ss:create-exchange', params),
    ssStatus:       (id: string)            => send('ss:status', id),
    xEstimate:      (params: unknown)       => send('xchange:estimate', params),
    xCreateExchange:(params: unknown)       => send('xchange:create', params),
    xStatus:        (provider: string, id: string) => send('xchange:status', provider, id),

    // Window controls (no-op on Android)
    minimize: () => {},
    close:    () => {},

    // NFT media → the phone's Downloads folder. The WebView ignores <a download>,
    // so this goes through the native Downloader plugin (MediaStore on API 29+).
    downloadFile: (url: string, filename: string): Promise<DownloadResult> =>
      Downloader.downloadFile({ url, filename })
        .catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : 'Download failed.' })),
    onDownloadProgress:  (cb: (p: DownloadProgress) => void) => { ensureDownloadProgressWired(); downloadProgressListeners.add(cb) },
    offDownloadProgress: (cb: (p: DownloadProgress) => void) => { downloadProgressListeners.delete(cb) },

    // Default browser — the manifest already declares the http/https filter, so
    // this is purely "ask Android to hand us the browser role".
    defaultBrowserGetState: (): Promise<DefaultBrowserState> =>
      DefaultBrowser.getStatus()
        .catch(() => ({ supported: false, registered: false, isDefault: false })),
    defaultBrowserRequest:  (): Promise<DefaultBrowserState> =>
      DefaultBrowser.requestDefault()
        .catch(() => ({ supported: false, registered: false, isDefault: false })),

    // In-app dApp browser — native WebViews via the DappBrowser plugin; the
    // BrowserOverlay component (mounted by CapApp) owns the chrome and reacts
    // to the cap:browser:* bus events these methods emit.
    openBrowser:     () => { emitUiEvent('cap:browser:open', { url: HOME_URL }) },
    closeBrowser:    () => { emitUiEvent('cap:browser:close', null) },
    // Persistent-tabs model (Android): the Browser is a first-class tab. showBrowser
    // reveals the existing session (or opens home if none); hideBrowser tucks it
    // away WITHOUT destroying tabs (the native WebViews are just hidden). The
    // wallet's bottom nav stays visible over the browser, so switching tabs is a
    // hide/show, not an open/close.
    showBrowser:     () => { emitUiEvent('cap:browser:show', null) },
    hideBrowser:     () => { emitUiEvent('cap:browser:hide', null) },
    // Open a URL as a NEW tab (App Hub long-press → "Open in New Tab"): adds a
    // tab to the existing session (revealing it if hidden), or starts the
    // browser with this URL if nothing is open yet.
    openBrowserInNewTab: (url: string) => {
      const safeUrl = normalizeWebUrl(url)
      if (safeUrl) emitUiEvent('cap:browser:newtab', { url: safeUrl })
    },
    onBrowserHidden: (cb: () => void) => onUiEvent('cap:browser:hidden', cb as (d: unknown) => void),
    offBrowserHidden:(cb: () => void) => offUiEvent('cap:browser:hidden', cb as (d: unknown) => void),
    // Live open-tab count → App shows a "saved tabs" dot on the Browser nav button.
    onBrowserTabCount:  (cb: (n: number) => void) => onUiEvent('cap:browser:tabs', cb as (d: unknown) => void),
    offBrowserTabCount: (cb: (n: number) => void) => offUiEvent('cap:browser:tabs', cb as (d: unknown) => void),
    browserBack:     () => { DappBrowser.goBack().catch(() => {}) },
    browserForward:  () => { DappBrowser.goForward().catch(() => {}) },
    browserReload:   () => { DappBrowser.reload().catch(() => {}) },
    browserHome:     () => { DappBrowser.navigate({ url: HOME_URL }).catch(() => {}) },
    browserNavigate: (url: string) => {
      const safeUrl = normalizeWebUrl(url)
      if (safeUrl) emitUiEvent('cap:browser:open', { url: safeUrl })
      return Promise.resolve()
    },
    browserGetState: () => DappBrowser.getState()
      .catch(() => ({ url: '', canBack: false, canForward: false, loading: false, tabs: [], activeTabId: -1 })),
    browserNewTab:       (url?: string) => { DappBrowser.newTab({ url: url ?? HOME_URL }).catch(() => {}) },
    browserSetActiveTab: (id: number) => { DappBrowser.selectTab({ tabId: id }).catch(() => {}) },
    browserCloseTab:     (id: number) => { DappBrowser.closeTab({ tabId: id }).catch(() => {}) },
    // BrowserOverlay drives its own toolbar off plugin events; only the closed
    // signal is re-broadcast on the bus for App.tsx's Browser-tab state.
    onBrowserUrl:        () => {},
    onBrowserLoading:    () => {},
    onBrowserNavState:   () => {},
    onBrowserTitle:      () => {},
    offBrowserUrl:       () => {},
    offBrowserLoading:   () => {},
    offBrowserNavState:  () => {},
    offBrowserTitle:     () => {},
    onBrowserClosed:     (cb: () => void) => onUiEvent('cap:browser:closed', cb as (d: unknown) => void),
    offBrowserClosed:    (cb: () => void) => offUiEvent('cap:browser:closed', cb as (d: unknown) => void),

    // ── Bookmarks + page state ────────────────────────────────────────────
    // Same method names the desktop preload exposes, so BookmarksPanel.tsx and
    // PasswordManager.tsx are reused verbatim on Android.
    browserGetPageState:   () => browserPageState(),
    browserToggleBookmark: async () => {
      const page = await activePage()
      if (/^https?:\/\//i.test(page.url)) {
        if (await Bm.isBookmarked(page.url)) await Bm.removeBookmarkByUrl(page.url)
        else await Bm.addBookmark(page.url, page.title || page.url)
      }
      return browserPageState()
    },
    browserListBookmarks:  () => Bm.getBookmarks(),
    browserRemoveBookmark: (id: string) => Bm.removeBookmark(id),
    browserRenameBookmark: (id: string, title: string) => Bm.renameBookmark(id, title),
    // Android apps are sandboxed: another browser's profile is unreadable, so
    // there is no bookmark/password profile import here — CSV only.
    browserImportBookmarks: async () => ({
      added: 0, skipped: 0, bookmarks: await Bm.getBookmarks(),
      error: 'Android apps cannot read another browser’s bookmarks. Export them to a file and import that instead.',
    }),

    // ── Save and share ────────────────────────────────────────────────────
    browserWebAppsSupported: () => Promise.resolve(true),
    browserListWebApps:      () => Bm.getWebApps(),
    browserInstallWebApp:    async () => {
      const page = await activePage()
      if (!/^https?:\/\//i.test(page.url)) {
        return { ok: false, apps: await Bm.getWebApps(), error: 'There is no page to install' }
      }
      const name = page.title || hostLabel(page.url)
      try {
        await DappBrowser.installShortcut({ url: page.url, name })
      } catch (e) {
        return { ok: false, apps: await Bm.getWebApps(), error: errText(e, 'Could not add the shortcut') }
      }
      return { ok: true, apps: await Bm.recordWebApp(page.url, name) }
    },
    // Removing the record only — Android gives no API to delete a shortcut the
    // launcher already pinned, so the UI says to remove it from the home screen.
    browserUninstallWebApp: (id: string) => Bm.forgetWebApp(id),
    browserCopyLink: async () => {
      const page = await activePage()
      if (!page.url) return { ok: false, error: 'There is no page to copy' }
      try {
        await navigator.clipboard.writeText(page.url)
        return { ok: true, url: page.url }
      } catch {
        return { ok: false, error: 'Could not copy the link' }
      }
    },
    // The phone-native equivalent of the desktop's mailto: hand-off — Android's
    // share sheet covers mail plus every other installed target.
    browserShareByEmail: async () => {
      const page = await activePage()
      if (!page.url) return { ok: false, error: 'There is no page to share' }
      try {
        await DappBrowser.sharePage({ url: page.url, title: page.title })
        return { ok: true }
      } catch (e) {
        return { ok: false, error: errText(e, 'Could not open the share sheet') }
      }
    },
    // Saving a full offline copy and screenshotting the native WebView have no
    // Android equivalent yet — reported rather than silently doing nothing.
    browserSavePage:    () => Promise.resolve({ ok: false, error: 'Saving pages is not available on Android yet' }),
    browserCapturePage: () => Promise.resolve({ ok: false, error: 'Screenshots are not available on Android yet' }),

    // ── Password manager ──────────────────────────────────────────────────
    passwordsStatus: () => Bm.passwordVaultStatus(),
    passwordsUnlock: async (password: string) => {
      const status = await Bm.unlockPasswords(password)
      // A login page may already be open — its one-shot form report fired while
      // the vault was locked, so re-check the active tab now (desktop parity).
      void tryAutofillActiveTab()
      return status
    },
    passwordsLock:   async () => { Bm.lockPasswords(); return Bm.passwordVaultStatus() },
    // Biometric unlock for the VAULT — additive, and gated on its own Keystore/
    // Enclave entry so it can never disturb the wallet's own enrollment.
    passwordsBioStatus: () => Bm.passwordBioStatus(),
    passwordsBioEnroll: () => Bm.enrollPasswordBio(),
    passwordsBioUnlock: async () => {
      const status = await Bm.unlockPasswordsWithBio()
      void tryAutofillActiveTab()
      return status
    },
    passwordsBioRemove: () => Bm.removePasswordBio(),
    passwordsList:   () => Promise.resolve(Bm.listPasswords()),
    passwordsReveal: (id: string) => Promise.resolve(Bm.revealPassword(id)),
    passwordsCopy:   async (id: string) => {
      await navigator.clipboard.writeText(Bm.revealPassword(id))
      return { ok: true }
    },
    passwordsSave:   (entry: { id?: string; url: string; username: string; password: string; note?: string }) =>
      Bm.savePassword(entry),
    passwordsDelete: (id: string) => Bm.deletePassword(id),
    // No Chromium profiles are reachable from an Android sandbox.
    passwordsImportSources: () => Promise.resolve([]),
    passwordsImport:        () => Promise.resolve({
      added: 0, skipped: 0,
      error: 'Android apps cannot read another browser’s saved passwords. Export them to a CSV and import that instead.',
    }),
    passwordsImportCsv: () => importPasswordsFromCsvFile(),
    browserFillPassword: (id: string) => fillSavedLogin(id),
    onBrowserAutofill:  (cb: (s: unknown) => void) => onUiEvent('cap:browser:autofill', cb as (d: unknown) => void),
    offBrowserAutofill: (cb: (s: unknown) => void) => offUiEvent('cap:browser:autofill', cb as (d: unknown) => void),

    // ChainLens profile (supabase-sync is stubbed on Android, like the extension)
    chainlensGetProfile:    ()              => send('chainlens:get-profile'),
    chainlensSync:          ()              => send('chainlens:sync'),
    chainlensUpdateProfile: (u: unknown)    => send('chainlens:update-profile', u),
    chainlensPickAvatar:    ()              => send('chainlens:pick-avatar'),

    // App version (SettingsModal footer + update check)
    getAppVersion: async () => (await CapacitorApp.getInfo()).version,

    // Biometric unlock (BiometricPrompt + Keystore — see biometric.ts)
    helloStatus,
    // Android 14+ system passkey provider. Enabling hands native ONLY the
    // account's webauthnRoot — never the seed (see passkey-system-provider).
    passkeyProviderStatus,
    passkeyProviderEnable: enablePasskeyProvider,
    passkeyProviderDisable: disablePasskeyProvider,
    passkeyProviderOpenSettings: openPasskeyProviderSettings,
    helloEnroll,
    helloUnlock,
    helloRemove,

    // Sideload update check against GitHub Releases (see update-check.ts).
    // Reports 'mac-available' — the shared SettingsModal renders that state as
    // "Download update vX / opens the download page", the sideload semantics.
    updateCheck,
    updateGetState,
    updateInstall,

    // Camera QR scan (WalletConnect pairing, send-address entry)
    scanQr,

    // FLAG_SECURE while a seed phrase is on screen (blocks screenshots and
    // blanks the Recents preview) — Android-only optional capability.
    setSecureScreen,

    // WalletConnect
    wcGetSessions:          () => send('wc:get-sessions'),
    wcGetPendingProposals:  () => send('wc:get-pending-proposals'),
    wcGetPendingRequests:   () => send('wc:get-pending-requests'),
    openSidePanel:          () => send('sidePanel:open'),
    closeSidePanel:         () => send('sidePanel:close'),
    web3GetPendingTx:          () => send('web3:get-pending-tx'),
    web3ApproveTx:             (id: string, chainId?: string) => send('web3:approve-tx', { id, chainId }),
    web3RejectTx:              (id: string) => send('web3:reject-tx', id),
    web3GetPendingSign:        () => send('web3:get-pending-sign'),
    web3ApproveSign:           (id: string) => send('web3:approve-sign', id),
    web3RejectSign:            (id: string) => send('web3:reject-sign', id),
    web3GetPendingConnections: () => send('web3:get-pending-connections'),
    web3ApproveConnection:     (id: string) => send('web3:approve-connection', { id }),
    web3RejectConnection:      (id: string) => send('web3:reject-connection', { id }),

    // Custom chains — same contract as Electron/extension, so the shared
    // DashboardPage "+" button and the token/NFT import modals work here too.
    // The handler cases come from the extension's switch (see `handle` above).
    getCustomChains:    () => send('wallet:get-custom-chains'),
    addCustomChain:     (chain: unknown) => send('wallet:add-custom-chain', chain),
    removeCustomChain:  (id: string) => send('wallet:remove-custom-chain', id),
    getCustomTokens:    () => send('wallet:get-custom-tokens'),
    resolveCustomToken: (chain: string, addr: string) => send('wallet:resolve-custom-token', chain, addr),
    importCustomToken:  (chain: string, addr: string) => send('wallet:import-custom-token', chain, addr),
    removeCustomToken:  (chain: string, addr: string) => send('wallet:remove-custom-token', chain, addr),
    getCustomNfts:      () => send('wallet:get-custom-nfts'),
    resolveCustomNft:   (chain: string, addr: string, id?: string) => send('wallet:resolve-custom-nft', chain, addr, id),
    importCustomNft:    (chain: string, addr: string, id: string) => send('wallet:import-custom-nft', chain, addr, id),
    removeCustomNft:    (chain: string, addr: string, id: string) => send('wallet:remove-custom-nft', chain, addr, id),

    // Testnet Mode — same contract as Electron/extension so SettingsModal works.
    getTestnetMode: () => send<boolean>('wallet:get-testnet-mode'),
    setTestnetMode: (enabled: boolean) => send('wallet:set-testnet-mode', enabled),

    // Privacy Mode — same contract as the Electron window.wallet API.
    getPrivacyMode: () => send<boolean>('wallet:get-privacy-mode'),
    setPrivacyMode: (enabled: boolean) => send('wallet:set-privacy-mode', enabled),

    // Background floor-valuation push (Collectibles tab renders before values).
    onCollectiblesUpdated:  (cb: (r: unknown) => void) => onUiEvent('collectibles:updated', cb),
    offCollectiblesUpdated: (cb: (r: unknown) => void) => offUiEvent('collectibles:updated', cb),

    // EVM network switcher — same contract as Electron/extension.
    web3GetChain:   () => send<string>('web3:get-chain'),
    web3GetChains:  () => send<Array<{ chainId: number; id: string; name: string; color: string }>>('web3:get-chains'),
    web3SetChain:   (chainId: number) => send<string>('web3:set-chain', chainId),
    onWeb3ChainChanged:  (cb: (hex: string) => void) => onUiEvent('web3:chain-changed', cb as (d: unknown) => void),
    offWeb3ChainChanged: (cb: (hex: string) => void) => offUiEvent('web3:chain-changed', cb as (d: unknown) => void),
    wcPair:                (uri: string) => send('wc:pair', uri),
    wcApproveSession:      (id: number)  => send('wc:approve-session', id),
    wcRejectSession:       (id: number)  => send('wc:reject-session', id),
    wcDisconnect:          (t: string)   => send('wc:disconnect', t),
    wcApproveRequest:      (id: number)  => send('wc:approve-request', id),
    wcRejectRequest:       (id: number)  => send('wc:reject-request', id),

    // WC push events
    onWcProposal:        (cb: (p: unknown) => void) => onUiEvent('wc:proposal', cb),
    onWcRequest:         (cb: (r: unknown) => void) => onUiEvent('wc:request', cb),
    onWcSessionsChanged: (cb: (s: unknown) => void) => onUiEvent('wc:sessions-changed', cb),
    offWcProposal:       (cb: (p: unknown) => void) => offUiEvent('wc:proposal', cb),
    offWcRequest:        (cb: (r: unknown) => void) => offUiEvent('wc:request', cb),
    offWcSessionsChanged:(cb: (s: unknown) => void) => offUiEvent('wc:sessions-changed', cb),

    // Auto-lock push (the store emits when the sliding session window expires) —
    // parity the extension bridge lacks; CapApp uses it to show the lock screen.
    onLocked:  (cb: () => void) => onUiEvent('wallet:locked', cb as (d: unknown) => void),
    offLocked: (cb: () => void) => offUiEvent('wallet:locked', cb as (d: unknown) => void),
  }
}
