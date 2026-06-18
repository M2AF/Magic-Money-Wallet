/**
 * bridge.ts — Extension window.wallet shim
 *
 * Creates a window.wallet-compatible object that routes calls to the
 * background service worker via chrome.runtime.sendMessage.
 *
 * This replaces src/preload/index.ts (Electron contextBridge + ipcRenderer).
 */

type MsgResult = { ok: true; result: unknown } | { ok: false; error: string }

function send<T = unknown>(type: string, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    // 8-second timeout so the popup never hangs on "Loading…" if the SW is down
    const timer = setTimeout(() => reject(new Error('Background not responding — try closing and reopening the extension')), 8000)

    chrome.runtime.sendMessage({ type, args }, (response: MsgResult) => {
      clearTimeout(timer)
      if (chrome.runtime.lastError) {
        // "Receiving end does not exist" = SW sleeping — retry once after 300ms
        const msg = chrome.runtime.lastError.message ?? ''
        if (msg.includes('Receiving end') || msg.includes('Could not establish')) {
          setTimeout(() => {
            chrome.runtime.sendMessage({ type, args }, (r2: MsgResult) => {
              if (chrome.runtime.lastError || !r2) { reject(new Error(chrome.runtime.lastError?.message ?? 'No response')); return }
              if (r2.ok) resolve(r2.result as T)
              else reject(new Error(r2.error))
            })
          }, 300)
          return
        }
        reject(new Error(msg))
        return
      }
      if (!response) { reject(new Error('No response from background')); return }
      if (response.ok) resolve(response.result as T)
      else reject(new Error(response.error))
    })
  })
}

// ── Push event registry (background → popup via chrome.runtime.onMessage) ────

const _listenerMap = new WeakMap<Function, (msg: { type: string; data: unknown }) => void>()

function on(channel: string, cb: (data: unknown) => void) {
  const wrapped = (msg: { type: string; data: unknown }) => {
    if (msg?.type === channel) cb(msg.data)
  }
  _listenerMap.set(cb, wrapped)
  chrome.runtime.onMessage.addListener(wrapped)
}

function off(channel: string, cb: (data: unknown) => void) {
  const wrapped = _listenerMap.get(cb)
  if (wrapped) {
    chrome.runtime.onMessage.removeListener(wrapped)
    _listenerMap.delete(cb)
  }
}

// ── window.wallet implementation ──────────────────────────────────────────────

export function createExtensionWallet() {
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
    revealSeed:     ()                      => send<string[]>('wallet:reveal-seed'),
    getHistory:     ()                      => send('wallet:get-history'),
    getAccountIndex:()                      => send<number>('wallet:get-account'),
    setAccount:     (i: number)             => send('wallet:set-account', i),

    // Transactions
    estimateFee:    (c: string, t: string, a: string) => send('wallet:estimate-fee', c, t, a),
    sendEvm:        (c: string, t: string, a: string) => send('wallet:send-evm', c, t, a),
    sendSolana:     (t: string, a: string)            => send('wallet:send-solana', t, a),
    sendCardano:    (t: string, a: string)            => send('wallet:send-cardano', t, a),

    // Market
    getMarket:      ()                      => send('wallet:get-market'),
    searchMarket:   (q: string)             => send('wallet:search-market', q),
    getCoinChart:   (id: string, d: string) => send('wallet:get-coin-chart', id, d),
    getTokens:      ()                      => send('wallet:get-tokens'),
    getCollectibles:()                      => send('wallet:get-collectibles'),
    getNftFloor:    (c: string, a: string)  => send('wallet:get-nft-floor', c, a),

    // Window controls (no-op in extension)
    minimize: () => {},
    close:    () => {},

    // Browser tab (no-op in extension — user's browser IS the browser)
    openBrowser:     () => {},
    closeBrowser:    () => {},
    browserBack:     () => {},
    browserForward:  () => {},
    browserReload:   () => {},
    browserHome:     () => {},
    browserNavigate: () => Promise.resolve(),
    browserGetState: () => Promise.resolve({ url: '', canBack: false, canForward: false, loading: false }),
    onBrowserUrl:        () => {},
    onBrowserLoading:    () => {},
    onBrowserNavState:   () => {},
    onBrowserTitle:      () => {},
    offBrowserUrl:       () => {},
    offBrowserLoading:   () => {},
    offBrowserNavState:  () => {},
    offBrowserTitle:     () => {},
    onBrowserClosed:     () => {},
    offBrowserClosed:    () => {},

    // ChainLens profile
    chainlensGetProfile:    ()              => send('chainlens:get-profile'),
    chainlensSync:          ()              => send('chainlens:sync'),
    chainlensUpdateProfile: (u: unknown)    => send('chainlens:update-profile', u),
    chainlensPickAvatar:    ()              => send('chainlens:pick-avatar'),

    // WalletConnect
    wcGetSessions:          () => send('wc:get-sessions'),
    wcGetPendingProposals:  () => send('wc:get-pending-proposals'),
    wcGetPendingRequests:   () => send('wc:get-pending-requests'),
    web3GetPendingTx:       () => send('web3:get-pending-tx'),
    web3ApproveTx:          (id: string, chainId?: string) => send('web3:approve-tx', { id, chainId }),
    web3RejectTx:           (id: string) => send('web3:reject-tx', id),
    wcPair:                (uri: string) => send('wc:pair', uri),
    wcApproveSession:      (id: number)  => send('wc:approve-session', id),
    wcRejectSession:       (id: number)  => send('wc:reject-session', id),
    wcDisconnect:          (t: string)   => send('wc:disconnect', t),
    wcApproveRequest:      (id: number)  => send('wc:approve-request', id),
    wcRejectRequest:       (id: number)  => send('wc:reject-request', id),

    // WC push events (background pushes to all extension pages)
    onWcProposal:        (cb: (p: unknown) => void) => on('wc:proposal', cb),
    onWcRequest:         (cb: (r: unknown) => void) => on('wc:request', cb),
    onWcSessionsChanged: (cb: (s: unknown) => void) => on('wc:sessions-changed', cb),
    offWcProposal:       (cb: (p: unknown) => void) => off('wc:proposal', cb),
    offWcRequest:        (cb: (r: unknown) => void) => off('wc:request', cb),
    offWcSessionsChanged:(cb: (s: unknown) => void) => off('wc:sessions-changed', cb),
  }
}
