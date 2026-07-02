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
  generate:      ()                  => ipcRenderer.invoke('wallet:generate'),
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

  // ── Phase 3: History + multi-account ─────────────────────────────────
  getHistory:      ()                  => ipcRenderer.invoke('wallet:get-history'),
  getAccountIndex: ()                  => ipcRenderer.invoke('wallet:get-account'),
  setAccount:      (index: number)     => ipcRenderer.invoke('wallet:set-account', index),
  setAgw:          (accountIndex: number, address: string | null) =>
    ipcRenderer.invoke('wallet:set-agw', accountIndex, address),

  // ── Phase 5: Market Watch + Tokens + Collectibles ────────────────────
  getMarket:       ()                  => ipcRenderer.invoke('wallet:get-market'),
  searchMarket:    (query: string)     => ipcRenderer.invoke('wallet:search-market', query),
  getCoinChart:    (id: string, days: string) => ipcRenderer.invoke('wallet:get-coin-chart', id, days),
  getTokens:       ()                  => ipcRenderer.invoke('wallet:get-tokens'),
  getCollectibles: (excludeIds?: string[]) => ipcRenderer.invoke('wallet:get-collectibles', excludeIds),
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
  revokeSite:    (origin: string)    => ipcRenderer.invoke('wallet:revoke-site', origin),
  revokeAllSites:()                  => ipcRenderer.invoke('wallet:revoke-all-sites'),

  // ── Danger zone ───────────────────────────────────────────────────────
  deleteWallet:  ()                  => ipcRenderer.invoke('wallet:delete'),

  // ── Window controls (custom titlebar) ────────────────────────────────
  minimize:      ()                  => ipcRenderer.send('window:minimize'),
  close:         ()                  => ipcRenderer.send('window:close'),

  // ── Side-by-side window layout (Full Screen Mode) ────────────────────
  layoutSnap:     (side: 'left' | 'right') => ipcRenderer.send('layout:snap', side),
  layoutDetach:   ()                 => ipcRenderer.send('layout:detach'),
  layoutToggle:   ()                 => ipcRenderer.send('layout:toggle'),
  layoutGetState: ()                 => ipcRenderer.invoke('layout:get-state'),
  onLayoutChanged:  (cb: (s: { snapped: boolean; side: 'left' | 'right' | null; browserOpen: boolean }) => void) =>
    ipcRenderer.on('layout:changed', (_e, v) => cb(v)),
  offLayoutChanged: (cb: (s: { snapped: boolean; side: 'left' | 'right' | null; browserOpen: boolean }) => void) =>
    ipcRenderer.removeListener('layout:changed', cb as never),

  // ── Phase 6: Built-in dApp browser (popup) ───────────────────────────
  openBrowser:     ()               => ipcRenderer.send('browser:open'),
  closeBrowser:    ()               => ipcRenderer.send('browser:close'),
  browserBack:     ()               => ipcRenderer.send('browser:back'),
  browserForward:  ()               => ipcRenderer.send('browser:forward'),
  browserReload:   ()               => ipcRenderer.send('browser:reload'),
  browserHome:     ()               => ipcRenderer.send('browser:home'),
  browserNavigate: (url: string)    => ipcRenderer.invoke('browser:navigate', url),
  browserGetState: ()               => ipcRenderer.invoke('browser:get-state'),
  browserNewTab:      (url?: string) => ipcRenderer.send('browser:new-tab', url),
  browserSetActiveTab: (id: number)  => ipcRenderer.send('browser:set-active-tab', id),
  browserCloseTab:     (id: number)  => ipcRenderer.send('browser:close-tab', id),
  browserSuspendTabsMenu: ()         => ipcRenderer.invoke('browser:suspend-tabs-menu'),
  browserResumeTabsMenu:  ()         => ipcRenderer.send('browser:resume-tabs-menu'),

  onBrowserUrl:      (cb: (url: string) => void)                                    => ipcRenderer.on('browser:url',       (_e, v) => cb(v)),
  onBrowserLoading:  (cb: (loading: boolean) => void)                               => ipcRenderer.on('browser:loading',   (_e, v) => cb(v)),
  onBrowserNavState: (cb: (s: { canBack: boolean; canForward: boolean }) => void)   => ipcRenderer.on('browser:nav-state', (_e, v) => cb(v)),
  onBrowserTitle:    (cb: (title: string) => void)                                  => ipcRenderer.on('browser:title',     (_e, v) => cb(v)),
  onBrowserTabs:     (cb: (s: { activeTabId: number; tabs: Array<{ id: number; title: string; url: string; loading: boolean }> }) => void) => ipcRenderer.on('browser:tabs', (_e, v) => cb(v)),

  offBrowserUrl:      (cb: (url: string) => void)                                   => ipcRenderer.removeListener('browser:url',       cb as never),
  offBrowserLoading:  (cb: (loading: boolean) => void)                              => ipcRenderer.removeListener('browser:loading',   cb as never),
  offBrowserNavState: (cb: (s: { canBack: boolean; canForward: boolean }) => void)  => ipcRenderer.removeListener('browser:nav-state', cb as never),
  offBrowserTitle:    (cb: (title: string) => void)                                 => ipcRenderer.removeListener('browser:title',     cb as never),
  offBrowserTabs:     (cb: (s: { activeTabId: number; tabs: Array<{ id: number; title: string; url: string; loading: boolean }> }) => void) => ipcRenderer.removeListener('browser:tabs', cb as never),

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
