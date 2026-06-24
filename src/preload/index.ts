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
  swapGetTokens:   (chain: string)     => ipcRenderer.invoke('swap:getTokenList', chain),
  ssEstimate:      (params: unknown)   => ipcRenderer.invoke('ss:estimate', params),
  ssCreateExchange:(params: unknown)   => ipcRenderer.invoke('ss:create-exchange', params),
  ssStatus:        (id: string)        => ipcRenderer.invoke('ss:status', id),

  // ── Danger zone ───────────────────────────────────────────────────────
  deleteWallet:  ()                  => ipcRenderer.invoke('wallet:delete'),

  // ── Window controls (custom titlebar) ────────────────────────────────
  minimize:      ()                  => ipcRenderer.send('window:minimize'),
  close:         ()                  => ipcRenderer.send('window:close'),

  // ── Phase 6: Built-in dApp browser (popup) ───────────────────────────
  openBrowser:     ()               => ipcRenderer.send('browser:open'),
  closeBrowser:    ()               => ipcRenderer.send('browser:close'),
  browserBack:     ()               => ipcRenderer.send('browser:back'),
  browserForward:  ()               => ipcRenderer.send('browser:forward'),
  browserReload:   ()               => ipcRenderer.send('browser:reload'),
  browserHome:     ()               => ipcRenderer.send('browser:home'),
  browserNavigate: (url: string)    => ipcRenderer.invoke('browser:navigate', url),
  browserGetState: ()               => ipcRenderer.invoke('browser:get-state'),

  onBrowserUrl:      (cb: (url: string) => void)                                    => ipcRenderer.on('browser:url',       (_e, v) => cb(v)),
  onBrowserLoading:  (cb: (loading: boolean) => void)                               => ipcRenderer.on('browser:loading',   (_e, v) => cb(v)),
  onBrowserNavState: (cb: (s: { canBack: boolean; canForward: boolean }) => void)   => ipcRenderer.on('browser:nav-state', (_e, v) => cb(v)),
  onBrowserTitle:    (cb: (title: string) => void)                                  => ipcRenderer.on('browser:title',     (_e, v) => cb(v)),

  offBrowserUrl:      (cb: (url: string) => void)                                   => ipcRenderer.removeListener('browser:url',       cb as never),
  offBrowserLoading:  (cb: (loading: boolean) => void)                              => ipcRenderer.removeListener('browser:loading',   cb as never),
  offBrowserNavState: (cb: (s: { canBack: boolean; canForward: boolean }) => void)  => ipcRenderer.removeListener('browser:nav-state', cb as never),
  offBrowserTitle:    (cb: (title: string) => void)                                 => ipcRenderer.removeListener('browser:title',     cb as never),

  // Fired when the popup is closed (so the wallet can update the Browser button state)
  onBrowserClosed:    (cb: () => void)  => ipcRenderer.on('browser:closed',  () => cb()),
  offBrowserClosed:   (cb: () => void)  => ipcRenderer.removeListener('browser:closed', cb as never),

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
