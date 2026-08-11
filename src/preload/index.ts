/**
 * preload/index.ts — MagicMoney Wallet
 *
 * The ONLY channel between renderer and main process.
 * The raw ipcRenderer is NEVER exposed — only these explicit, typed methods.
 * No private keys or mnemonics ever pass through here (they stay in main).
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('wallet', {
  // ── Wallet lifecycle ──────────────────────────────────────────────────
  isSetup:       ()                  => ipcRenderer.invoke('wallet:is-setup'),
  generate:      (words?: 12 | 24)   => ipcRenderer.invoke('wallet:generate', words),
  // Optional passkey path — same result shape as generate(), plus whether the
  // passkey could reproduce its own entropy on this device.
  generateWithPasskey: (words?: 12 | 24) => ipcRenderer.invoke('wallet:generate-passkey', words),
  passkeySupported:    ()                => ipcRenderer.invoke('wallet:passkey-supported'),
  passkeyVerify:       ()                => ipcRenderer.invoke('wallet:passkey-verify'),
  importWithPasskey:   (words?: 12 | 24) => ipcRenderer.invoke('wallet:import-passkey', words),
  // Link/unlink an EXISTING wallet to a passkey (envelope encryption).
  passkeyLink:         ()                => ipcRenderer.invoke('wallet:passkey-link'),
  passkeyLinked:       ()                => ipcRenderer.invoke('wallet:passkey-linked'),
  passkeyUnlink:       ()                => ipcRenderer.invoke('wallet:passkey-unlink'),
  clearBrowsingData:   ()                => ipcRenderer.invoke('browser:clear-data'),
  validate:      (mnemonic: string)  => ipcRenderer.invoke('wallet:validate', mnemonic),
  confirmBackup: ()                  => ipcRenderer.invoke('wallet:confirm-backup'),
  import:        (mnemonic: string)  => ipcRenderer.invoke('wallet:import', mnemonic),

  // ── Password / lock lifecycle ─────────────────────────────────────────
  setPassword:    (password: string) => ipcRenderer.invoke('wallet:set-password', password),
  unlock:         (password: string) => ipcRenderer.invoke('wallet:unlock', password),
  lock:           ()                 => ipcRenderer.invoke('wallet:lock'),
  isUnlocked:     ()                 => ipcRenderer.invoke('wallet:is-unlocked'),
  needsMigration: ()                 => ipcRenderer.invoke('wallet:needs-migration'),
  onLocked:       (cb: () => void)   => ipcRenderer.on('wallet:locked', () => cb()),
  offLocked:      (cb: () => void)   => ipcRenderer.removeListener('wallet:locked', cb as never),
  // Fire-and-forget user-activity ping that resets main's idle auto-lock timer.
  reportActivity: ()                 => ipcRenderer.send('wallet:activity'),
  // Windows Hello unlock (optional convenience factor; password kept as recovery).
  helloStatus:    ()                 => ipcRenderer.invoke('wallet:hello-status'),
  helloEnroll:    ()                 => ipcRenderer.invoke('wallet:hello-enroll'),
  helloUnlock:    ()                 => ipcRenderer.invoke('wallet:hello-unlock'),
  helloRemove:    ()                 => ipcRenderer.invoke('wallet:hello-remove'),

  // ── Data reads ────────────────────────────────────────────────────────
  getAddresses:  ()                  => ipcRenderer.invoke('wallet:get-addresses'),
  getBalances:   ()                  => ipcRenderer.invoke('wallet:get-balances'),
  revealSeed:    (password: string)  => ipcRenderer.invoke('wallet:reveal-seed', password),

  // ── Phase 2: Send transactions ────────────────────────────────────────
  validateAddress: (chain: string, to: string) =>
    ipcRenderer.invoke('wallet:validate-address', chain, to),
  estimateFee:   (chain: string, to: string, amount: string) =>
    ipcRenderer.invoke('wallet:estimate-fee', chain, to, amount),
  sendEvm:       (chainId: string, to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-evm', chainId, to, amount),
  sendAgw:       (to: string, amount: string, token?: { contractAddress: string; decimals: number }) =>
    ipcRenderer.invoke('wallet:send-agw', to, amount, token),
  sendSolana:    (to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-solana', to, amount),
  sendCardano:   (to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-cardano', to, amount),
  sendBitcoin:   (to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-bitcoin', to, amount),
  sendTron:      (to: string, amount: string, token?: { contractAddress: string; decimals: number }) =>
    ipcRenderer.invoke('wallet:send-tron', to, amount, token),
  sendDogecoin:  (to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-dogecoin', to, amount),
  sendMonero:    (to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-monero', to, amount),
  sendZcash:     (to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-zcash', to, amount),
  sendMidnight:  (to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-midnight', to, amount),
  getMidnightDustStatus:   () => ipcRenderer.invoke('wallet:get-midnight-dust-status'),
  registerMidnightDust:    () => ipcRenderer.invoke('wallet:register-midnight-dust'),

  // ── Phase 3: History + multi-account ─────────────────────────────────
  getHistory:      ()                  => ipcRenderer.invoke('wallet:get-history'),
  getAccountIndex: ()                  => ipcRenderer.invoke('wallet:get-account'),
  setAccount:      (index: number)     => ipcRenderer.invoke('wallet:set-account', index),

  // ── Testnet Mode ──────────────────────────────────────────────────────
  // Custom chains — user-added EVM networks
  getCustomChains:   ()                => ipcRenderer.invoke('wallet:get-custom-chains'),
  addCustomChain:    (chain: unknown)  => ipcRenderer.invoke('wallet:add-custom-chain', chain),
  removeCustomChain: (id: string)      => ipcRenderer.invoke('wallet:remove-custom-chain', id),
  // Imported ERC-20s on those networks
  getCustomTokens:    ()                            => ipcRenderer.invoke('wallet:get-custom-tokens'),
  resolveCustomToken: (chain: string, addr: string) => ipcRenderer.invoke('wallet:resolve-custom-token', chain, addr),
  importCustomToken:  (chain: string, addr: string) => ipcRenderer.invoke('wallet:import-custom-token', chain, addr),
  removeCustomToken:  (chain: string, addr: string) => ipcRenderer.invoke('wallet:remove-custom-token', chain, addr),
  // Imported NFTs on those networks
  getCustomNfts:    ()                                             => ipcRenderer.invoke('wallet:get-custom-nfts'),
  resolveCustomNft: (chain: string, addr: string, id?: string)      => ipcRenderer.invoke('wallet:resolve-custom-nft', chain, addr, id),
  importCustomNft:  (chain: string, addr: string, id: string)       => ipcRenderer.invoke('wallet:import-custom-nft', chain, addr, id),
  removeCustomNft:  (chain: string, addr: string, id: string)       => ipcRenderer.invoke('wallet:remove-custom-nft', chain, addr, id),

  getTestnetMode:  ()                  => ipcRenderer.invoke('wallet:get-testnet-mode'),
  setTestnetMode:  (enabled: boolean)  => ipcRenderer.invoke('wallet:set-testnet-mode', enabled),

  // ── Privacy Mode ──────────────────────────────────────────────────────
  getPrivacyMode:  ()                  => ipcRenderer.invoke('wallet:get-privacy-mode'),
  setPrivacyMode:  (enabled: boolean)  => ipcRenderer.invoke('wallet:set-privacy-mode', enabled),
  setAgw:          (accountIndex: number, address: string | null) =>
    ipcRenderer.invoke('wallet:set-agw', accountIndex, address),
  importAgwSigner: (accountIndex: number, secret: string) =>
    ipcRenderer.invoke('wallet:import-agw-signer', accountIndex, secret),
  removeAgwSigner: (accountIndex: number) =>
    ipcRenderer.invoke('wallet:remove-agw-signer', accountIndex),

  // ── Phase 5: Market Watch + Tokens + Collectibles ────────────────────
  getMarket:       ()                  => ipcRenderer.invoke('wallet:get-market'),
  searchMarket:    (query: string)     => ipcRenderer.invoke('wallet:search-market', query),
  getCoinChart:    (id: string, days: string) => ipcRenderer.invoke('wallet:get-coin-chart', id, days),
  getTokens:       ()                  => ipcRenderer.invoke('wallet:get-tokens'),
  getCollectibles: (excludeIds?: string[]) => ipcRenderer.invoke('wallet:get-collectibles', excludeIds),
  // Pushed when the background floor-valuation pass finishes (getCollectibles
  // returns before floors resolve so the tab renders immediately).
  onCollectiblesUpdated:  (cb: (r: unknown) => void) => ipcRenderer.on('collectibles:updated', (_e, v) => cb(v)),
  offCollectiblesUpdated: (cb: (r: unknown) => void) => ipcRenderer.removeListener('collectibles:updated', cb as never),
  getNftFloor:     (chain: string, contractAddress: string) =>
    ipcRenderer.invoke('wallet:get-nft-floor', chain, contractAddress),
  swapGetQuote:    (req: unknown)      => ipcRenderer.invoke('swap:getQuote', req),
  swapExecute:     (quote: unknown)    => ipcRenderer.invoke('swap:execute', quote),
  swapCrossStatus: (req: unknown)      => ipcRenderer.invoke('swap:crossStatus', req),
  swapGetTokens:   (chain: string)     => ipcRenderer.invoke('swap:getTokenList', chain),
  ssEstimate:      (params: unknown)   => ipcRenderer.invoke('ss:estimate', params),
  ssCreateExchange:(params: unknown)   => ipcRenderer.invoke('ss:create-exchange', params),
  ssStatus:        (id: string)        => ipcRenderer.invoke('ss:status', id),
  xEstimate:       (params: unknown)   => ipcRenderer.invoke('xchange:estimate', params),
  xCreateExchange: (params: unknown)   => ipcRenderer.invoke('xchange:create', params),
  xStatus:         (provider: string, id: string) => ipcRenderer.invoke('xchange:status', provider, id),

  // ── Connected sites (revoke dApp access) ──────────────────────────────
  getConnectedSites: ()              => ipcRenderer.invoke('wallet:get-connected-sites'),
  revokeSite:    (origin: string, chain?: string) => ipcRenderer.invoke('wallet:revoke-site', origin, chain),
  revokeAllSites:()                  => ipcRenderer.invoke('wallet:revoke-all-sites'),

  // ── Downloads (NFT media → OS Downloads folder) ───────────────────────
  downloadFile:  (url: string, suggestedName: string) =>
    ipcRenderer.invoke('wallet:download-file', url, suggestedName),
  onDownloadProgress:  (cb: (p: unknown) => void) => ipcRenderer.on('download:progress', (_e, v) => cb(v)),
  offDownloadProgress: (cb: (p: unknown) => void) => ipcRenderer.removeListener('download:progress', cb as never),

  // ── Default browser (Windows: register + open Settings to confirm) ────
  defaultBrowserGetState: ()         => ipcRenderer.invoke('default-browser:get-state'),
  defaultBrowserRequest:  ()         => ipcRenderer.invoke('default-browser:request'),

  // ── Danger zone ───────────────────────────────────────────────────────
  deleteWallet:  ()                  => ipcRenderer.invoke('wallet:delete'),

  // ── Window controls (custom titlebar) ────────────────────────────────
  minimize:      ()                  => ipcRenderer.send('window:minimize'),
  close:         ()                  => ipcRenderer.send('window:close'),

  // ── Side-by-side window layout (Full Screen Mode) ────────────────────
  layoutSnap:     (side: 'left' | 'right') => ipcRenderer.send('layout:snap', side),
  layoutDetach:   ()                 => ipcRenderer.send('layout:detach'),
  layoutToggle:   ()                 => ipcRenderer.send('layout:toggle'),
  browserToggleMaximize: ()          => ipcRenderer.send('browser:toggle-maximize'),
  browserSetChromeHeight: (h: number) => ipcRenderer.send('browser:set-chrome-height', h),
  layoutGetState: ()                 => ipcRenderer.invoke('layout:get-state'),
  onLayoutChanged:  (cb: (s: { snapped: boolean; side: 'left' | 'right' | null; browserOpen: boolean; maximized: boolean }) => void) =>
    ipcRenderer.on('layout:changed', (_e, v) => cb(v)),
  offLayoutChanged: (cb: (s: { snapped: boolean; side: 'left' | 'right' | null; browserOpen: boolean; maximized: boolean }) => void) =>
    ipcRenderer.removeListener('layout:changed', cb as never),

  // ── App version + in-app software update (Electron only) ─────────────────
  getAppVersion:   ()                => ipcRenderer.invoke('app:get-version'),
  updateCheck:     ()                => ipcRenderer.invoke('update:check'),
  updateGetState:  ()                => ipcRenderer.invoke('update:get-state'),
  updateInstall:   ()                => ipcRenderer.send('update:install'),
  onUpdateStatus:  (cb: (s: unknown) => void) => ipcRenderer.on('update:status', (_e, v) => cb(v)),
  offUpdateStatus: (cb: (s: unknown) => void) => ipcRenderer.removeListener('update:status', cb as never),

  // ── Phase 6: Built-in dApp browser (popup) ───────────────────────────
  openBrowser:     ()               => ipcRenderer.send('browser:open'),
  // Open a URL from the wallet UI in the built-in browser (opens/focuses it).
  openInAppBrowser: (url: string)   => ipcRenderer.send('browser:open-url', url),
  closeBrowser:    ()               => ipcRenderer.send('browser:close'),
  browserBack:     ()               => ipcRenderer.send('browser:back'),
  browserForward:  ()               => ipcRenderer.send('browser:forward'),
  browserReload:   ()               => ipcRenderer.send('browser:reload'),
  browserHome:     ()               => ipcRenderer.send('browser:home'),
  browserNavigate: (url: string)    => ipcRenderer.invoke('browser:navigate', url),
  browserGetState: ()               => ipcRenderer.invoke('browser:get-state'),
  browserGetTorState: ()            => ipcRenderer.invoke('browser:tor:get-state'),
  browserSetTorMode: (enabled: boolean) => ipcRenderer.invoke('browser:tor:set-mode', enabled),
  browserGetMagicGuardState: ()               => ipcRenderer.invoke('browser:guard:get-state'),
  browserSetMagicGuardEnabled: (enabled: boolean)     => ipcRenderer.invoke('browser:guard:set-enabled', enabled),
  browserSetMagicGuardForSite: (enabled: boolean)     => ipcRenderer.invoke('browser:guard:set-site-enabled', enabled),
  browserNewTab:      (url?: string) => ipcRenderer.send('browser:new-tab', url),
  browserSetActiveTab: (id: number)  => ipcRenderer.send('browser:set-active-tab', id),
  browserCloseTab:     (id: number)  => ipcRenderer.send('browser:close-tab', id),
  browserSuspendTabsMenu: ()         => ipcRenderer.invoke('browser:suspend-tabs-menu'),
  browserResumeTabsMenu:  ()         => ipcRenderer.send('browser:resume-tabs-menu'),

  // ── Bookmarks + current-page state (address-bar star, bookmarks panel) ─
  browserGetPageState:    ()                => ipcRenderer.invoke('browser:page-state'),
  browserToggleBookmark:  ()                => ipcRenderer.invoke('browser:bookmarks:toggle'),
  browserListBookmarks:   ()                => ipcRenderer.invoke('browser:bookmarks:list'),
  browserRemoveBookmark:  (id: string)      => ipcRenderer.invoke('browser:bookmarks:remove', id),
  browserRenameBookmark:  (id: string, title: string) => ipcRenderer.invoke('browser:bookmarks:rename', id, title),
  browserImportBookmarks: (sourceId: string) => ipcRenderer.invoke('browser:bookmarks:import', sourceId),

  // ── Save and share (install as app, save page, screenshot, copy, email) ─
  browserWebAppsSupported: ()          => ipcRenderer.invoke('browser:apps:supported'),
  browserListWebApps:      ()          => ipcRenderer.invoke('browser:apps:list'),
  browserInstallWebApp:    ()          => ipcRenderer.invoke('browser:apps:install'),
  browserUninstallWebApp:  (id: string) => ipcRenderer.invoke('browser:apps:uninstall', id),
  browserSavePage:         ()          => ipcRenderer.invoke('browser:page:save'),
  browserCapturePage:      ()          => ipcRenderer.invoke('browser:page:capture'),
  browserCopyLink:         ()          => ipcRenderer.invoke('browser:page:copy-link'),
  browserShareByEmail:     ()          => ipcRenderer.invoke('browser:page:share-email'),

  // ── Password manager (browser logins; never the wallet seed) ───────────
  passwordsStatus:        ()                 => ipcRenderer.invoke('passwords:status'),
  passwordsUnlock:        (password: string) => ipcRenderer.invoke('passwords:unlock', password),
  passwordsLock:          ()                 => ipcRenderer.invoke('passwords:lock'),
  passwordsList:          ()                 => ipcRenderer.invoke('passwords:list'),
  passwordsReveal:        (id: string)       => ipcRenderer.invoke('passwords:reveal', id),
  passwordsCopy:          (id: string)       => ipcRenderer.invoke('passwords:copy', id),
  passwordsSave:          (entry: unknown)   => ipcRenderer.invoke('passwords:save', entry),
  passwordsDelete:        (id: string)       => ipcRenderer.invoke('passwords:delete', id),
  passwordsImportSources: ()                 => ipcRenderer.invoke('passwords:import-sources'),
  passwordsImport:        (sourceId: string) => ipcRenderer.invoke('passwords:import', sourceId),
  passwordsImportCsv:     ()                 => ipcRenderer.invoke('passwords:import-csv'),
  browserFillPassword:    (id: string)       => ipcRenderer.invoke('browser:passwords:fill', id),

  onBrowserUrl:      (cb: (url: string) => void)                                    => ipcRenderer.on('browser:url',       (_e, v) => cb(v)),
  onBrowserLoading:  (cb: (loading: boolean) => void)                               => ipcRenderer.on('browser:loading',   (_e, v) => cb(v)),
  onBrowserNavState: (cb: (s: { canBack: boolean; canForward: boolean }) => void)   => ipcRenderer.on('browser:nav-state', (_e, v) => cb(v)),
  onBrowserTitle:    (cb: (title: string) => void)                                  => ipcRenderer.on('browser:title',     (_e, v) => cb(v)),
  onBrowserTabs:     (cb: (s: { activeTabId: number; tabs: Array<{ id: number; title: string; url: string; loading: boolean }> }) => void) => ipcRenderer.on('browser:tabs', (_e, v) => cb(v)),
  onBrowserTorState: (cb: (s: unknown) => void) => ipcRenderer.on('browser:tor-state', (_e, v) => cb(v)),
  onBrowserGuardState: (cb: (s: unknown) => void) => ipcRenderer.on('browser:guard-state', (_e, v) => cb(v)),
  // Pushed after a saved login was auto-filled into the active page.
  onBrowserAutofill:  (cb: (s: unknown) => void) => ipcRenderer.on('browser:autofill-filled', (_e, v) => cb(v)),
  offBrowserAutofill: (cb: (s: unknown) => void) => ipcRenderer.removeListener('browser:autofill-filled', cb as never),
  // Transient status text from main (download finished, etc).
  onBrowserToast:  (cb: (m: string) => void) => ipcRenderer.on('browser:toast', (_e, v) => cb(v)),
  offBrowserToast: (cb: (m: string) => void) => ipcRenderer.removeListener('browser:toast', cb as never),
  // True while a page is in HTML5 fullscreen — the chrome hides itself.
  onBrowserFullscreen:  (cb: (v: boolean) => void) => ipcRenderer.on('browser:fullscreen', (_e, v) => cb(v)),
  offBrowserFullscreen: (cb: (v: boolean) => void) => ipcRenderer.removeListener('browser:fullscreen', cb as never),

  offBrowserUrl:      (cb: (url: string) => void)                                   => ipcRenderer.removeListener('browser:url',       cb as never),
  offBrowserLoading:  (cb: (loading: boolean) => void)                              => ipcRenderer.removeListener('browser:loading',   cb as never),
  offBrowserNavState: (cb: (s: { canBack: boolean; canForward: boolean }) => void)  => ipcRenderer.removeListener('browser:nav-state', cb as never),
  offBrowserTitle:    (cb: (title: string) => void)                                 => ipcRenderer.removeListener('browser:title',     cb as never),
  offBrowserTabs:     (cb: (s: { activeTabId: number; tabs: Array<{ id: number; title: string; url: string; loading: boolean }> }) => void) => ipcRenderer.removeListener('browser:tabs', cb as never),
  offBrowserTorState: (cb: (s: unknown) => void) => ipcRenderer.removeListener('browser:tor-state', cb as never),
  offBrowserGuardState: (cb: (s: unknown) => void) => ipcRenderer.removeListener('browser:guard-state', cb as never),

  // Fired when the popup is closed (so the wallet can update the Browser button state)
  onBrowserClosed:    (cb: () => void)  => ipcRenderer.on('browser:closed',  () => cb()),
  offBrowserClosed:   (cb: () => void)  => ipcRenderer.removeListener('browser:closed', cb as never),

  // ── dApp browser: active EVM network (toolbar switcher + awareness) ───
  web3GetChain:   ()                => ipcRenderer.invoke('web3:get-chain'),
  web3GetChains:  ()                => ipcRenderer.invoke('web3:get-chains'),
  web3SetChain:   (chainId: number) => ipcRenderer.invoke('web3:set-chain', chainId),
  onWeb3ChainChanged:  (cb: (hex: string) => void) => ipcRenderer.on('web3:chain-changed', (_e, v) => cb(v)),
  offWeb3ChainChanged: (cb: (hex: string) => void) => ipcRenderer.removeListener('web3:chain-changed', cb as never),

  // ── Phase 10: WalletConnect ───────────────────────────────────────────────
  wcGetSessions:          ()                  => ipcRenderer.invoke('wc:get-sessions'),
  wcGetPendingProposals:  ()                  => ipcRenderer.invoke('wc:get-pending-proposals'),
  wcPair:                 (uri: string)       => ipcRenderer.invoke('wc:pair', uri),
  wcApproveSession:       (id: number)        => ipcRenderer.invoke('wc:approve-session', id),
  wcRejectSession:        (id: number)        => ipcRenderer.invoke('wc:reject-session', id),
  wcDisconnect:           (topic: string)     => ipcRenderer.invoke('wc:disconnect', topic),
  wcApproveRequest:       (id: number)        => ipcRenderer.invoke('wc:approve-request', id),
  wcRejectRequest:        (id: number)        => ipcRenderer.invoke('wc:reject-request', id),
  onWcProposal:           (cb: (p: unknown) => void) => ipcRenderer.on('wc:proposal',          (_e, v) => cb(v)),
  onWcRequest:            (cb: (r: unknown) => void) => ipcRenderer.on('wc:request',            (_e, v) => cb(v)),
  onWcSessionsChanged:    (cb: (s: unknown) => void) => ipcRenderer.on('wc:sessions-changed',   (_e, v) => cb(v)),
  offWcProposal:          (cb: (p: unknown) => void) => ipcRenderer.removeListener('wc:proposal',          cb as never),
  offWcRequest:           (cb: (r: unknown) => void) => ipcRenderer.removeListener('wc:request',            cb as never),
  offWcSessionsChanged:   (cb: (s: unknown) => void) => ipcRenderer.removeListener('wc:sessions-changed',   cb as never),

  // ── Phase 9: ChainLens profile sync ──────────────────────────────────────
  chainlensGetProfile:    ()                                                   => ipcRenderer.invoke('chainlens:get-profile'),
  chainlensSync:          ()                                                   => ipcRenderer.invoke('chainlens:sync'),
  chainlensUpdateProfile: (updates: { display_name?: string; avatar_url?: string }) =>
    ipcRenderer.invoke('chainlens:update-profile', updates),
  chainlensPickAvatar:    ()                                                   => ipcRenderer.invoke('chainlens:pick-avatar'),
})
