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

import { App as CapacitorApp } from '@capacitor/app'
import { handle, type Sender } from '../extension/wallet-handlers'
import { onUiEvent, offUiEvent, emitUiEvent } from './platform-capacitor'
import { helloStatus, helloEnroll, helloUnlock, helloRemove } from './biometric'
import { updateCheck, updateGetState, updateInstall, isPlayStoreInstall } from './update-check'
import { setSecureScreen } from './app-info'
import { scanQr } from './qr-scan'
import { DappBrowser } from './dapp-browser'
import { HOME_URL } from './BrowserOverlay'

// Our own UI is the privileged caller — same classification the extension gives
// its popup pages, so the PAGE_RPC_TYPES gate stays closed to dApp content only.
const UI_SENDER: Sender = { origin: 'wallet-ui', kind: 'extension' }

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
    generate:       ()                      => send<string[]>('wallet:generate'),
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

    // Connected sites (revoke dApp access)
    getConnectedSites: ()             => send<string[]>('wallet:get-connected-sites'),
    revokeSite:     (origin: string)  => send<string[]>('wallet:revoke-site', origin),
    revokeAllSites: ()                => send<string[]>('wallet:revoke-all-sites'),

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

    // ChainLens profile (supabase-sync is stubbed on Android, like the extension)
    chainlensGetProfile:    ()              => send('chainlens:get-profile'),
    chainlensSync:          ()              => send('chainlens:sync'),
    chainlensUpdateProfile: (u: unknown)    => send('chainlens:update-profile', u),
    chainlensPickAvatar:    ()              => send('chainlens:pick-avatar'),

    // App version (SettingsModal footer + update check)
    getAppVersion: async () => (await CapacitorApp.getInfo()).version,

    // Biometric unlock (BiometricPrompt + Keystore — see biometric.ts)
    helloStatus,
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
