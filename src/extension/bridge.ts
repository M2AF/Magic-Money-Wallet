/**
 * bridge.ts — Extension window.wallet shim
 *
 * Creates a window.wallet-compatible object that routes calls to the
 * background service worker via chrome.runtime.sendMessage.
 *
 * This replaces src/preload/index.ts (Electron contextBridge + ipcRenderer).
 */

import type { ApprovedOrigin, DappChain } from '../main/dapp-permissions'
import type { SendAsset } from '../main/tx-sender'

type MsgResult = { ok: true; result: unknown } | { ok: false; error: string }

// Heavy aggregation calls fan out across ~18 chains and enrich every result
// with external price APIs (CoinGecko / DexScreener). They routinely take far
// longer than a single RPC call, so they get a generous timeout — otherwise a
// wallet with many tokens gets cut off mid-fetch and the data silently drops.
// (Electron's ipcRenderer.invoke has no timeout, which is why these work there.)
const SLOW_TYPES = new Set([
  'wallet:get-balances',
  'wallet:get-history',
  'wallet:get-tokens',
  'wallet:get-collectibles',
  // AGW resolution does on-chain RPC roundtrips (ExclusiveDelegateResolver +
  // ownership check) on first read — too slow for the snappy 8s budget.
  'wallet:get-addresses',
  'wallet:set-agw',
  'wallet:set-account',
  'swap:getQuote',
  'swap:crossStatus',
  'swap:getTokenList',
  'ss:estimate',
  'ss:create-exchange',
  'ss:status',
  'xchange:estimate',
  'xchange:create',
  'xchange:status',
  'wallet:get-market',
  'wallet:search-market',
  'wallet:get-coin-chart',
  'wallet:get-nft-floor',
  // Non-blocking, but the FIRST call spins up the offscreen document and loads
  // the Midnight WASM before it can report progress.
  'wallet:get-midnight-dust-status',
])

// Swap execution can sign an approval, wait for it to mine, then sign the swap —
// well beyond the heavy-fetch budget. Give it room (SW stays alive while active).
const VERY_SLOW_TYPES = new Set(['swap:execute'])

// Midnight's DUST wallet walks a NETWORK-WIDE merkle tree before it can pay a
// fee — minutes on a first run (measured ~4 min mainnet / ~36 min preprod on
// desktop), and these two block on it. Anything shorter would abort a sync that
// is progressing perfectly well, so they get a deliberately huge budget; the
// offscreen document does the work and the UI polls dust-status meanwhile.
const MIDNIGHT_BLOCKING_TYPES = new Set([
  'wallet:register-midnight-dust',
  'wallet:send-midnight',
])

function send<T = unknown>(type: string, ...args: unknown[]): Promise<T> {
  // Snappy calls keep a tight 8s budget so the popup never hangs on "Loading…"
  // if the SW is down; heavy data fetches get 45s; on-chain execution gets 180s.
  const timeoutMs = MIDNIGHT_BLOCKING_TYPES.has(type) ? 45 * 60_000
    : VERY_SLOW_TYPES.has(type) ? 180_000
    : SLOW_TYPES.has(type) ? 45_000
    : 8_000
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Background not responding — try closing and reopening the extension')), timeoutMs)

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

function normalizeWebUrl(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(candidate)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
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
    generate:       (words?: 12 | 24)       => send<string[]>('wallet:generate', words),
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
    // `asset` omitted = native send; set = ERC-20/SPL/native-asset token or NFT.
    estimateFee:    (c: string, t: string, a: string, s?: SendAsset) => send('wallet:estimate-fee', c, t, a, s),
    sendEvm:        (c: string, t: string, a: string, s?: SendAsset) => send('wallet:send-evm', c, t, a, s),
    sendAgw:        (t: string, a: string, s?: SendAsset) => send('wallet:send-agw', t, a, s),
    sendSolana:     (t: string, a: string, s?: SendAsset) => send('wallet:send-solana', t, a, s),
    sendCardano:    (t: string, a: string, s?: SendAsset) => send('wallet:send-cardano', t, a, s),
    sendTron:       (t: string, a: string, s?: SendAsset) => send('wallet:send-tron', t, a, s),
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

    // Window controls (no-op in extension)
    minimize: () => {},
    close:    () => {},

    // Browser tab — in the extension the user's real browser is the browser,
    // so openBrowser lands on the ChainLens site and browserNavigate opens any
    // URL the AppHub requests directly in a new tab.
    openBrowser:     () => { chrome.tabs.create({ url: 'https://www.chainlensnft.info/' }) },
    closeBrowser:    () => {},
    browserBack:     () => {},
    browserForward:  () => {},
    browserReload:   () => {},
    browserHome:     () => {},
    browserNavigate: (url: string) => {
      const safeUrl = normalizeWebUrl(url)
      if (safeUrl) chrome.tabs.create({ url: safeUrl })
      return Promise.resolve()
    },
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
    assetFiltersGet:        ()              => send('assetfilters:get'),
    assetFiltersPush:       (e: unknown)    => send('assetfilters:push', e),
    customThemesGet:        ()              => send('themes:get'),
    customThemesPush:       (e: unknown)    => send('themes:push', e),
    chainlensPickAvatar:    ()              => send('chainlens:pick-avatar'),

    // ── ChainLens Messenger ──────────────────────────────────────────────
    chatStatus:       ()                                     => send('chat:status'),
    chatReset:        ()                                     => send('chat:reset'),
    chatWorld:        (after?: number | null)                => send('chat:world', after),
    chatSendWorld:    (t: 'text' | 'gif', c: string)         => send('chat:send-world', t, c),
    chatDeleteWorld:  (id: number)                           => send('chat:delete-world', id),
    chatFriends:      ()                                     => send('chat:friends'),
    chatAddFriend:    (id: string)                           => send('chat:add-friend', id),
    chatAcceptFriend: (id: number)                           => send('chat:accept-friend', id),
    chatRemoveFriend: (id: number)                           => send('chat:remove-friend', id),
    chatDirect:       (f: string, after?: number | null)     => send('chat:direct', f, after),
    chatSendDirect:   (f: string, t: 'text' | 'gif', c: string) => send('chat:send-direct', f, t, c),
    chatDeleteDirect: (f: string, id: number)                => send('chat:delete-direct', f, id),
    chatUnread:       ()                                     => send('chat:unread'),
    chatMarkRead:     (id: number, f?: string | null)        => send('chat:mark-read', id, f),
    chatGifs:         (q: string)                            => send('chat:gifs', q),

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

    // Custom chains — same contract as the Electron window.wallet API, so the
    // shared DashboardPage "+" button and import modals light up here too
    // (they're gated on `typeof window.wallet.getCustomChains === 'function'`).
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

    // Testnet Mode — same contract as the Electron window.wallet API so the
    // shared SettingsModal toggle works in both.
    getTestnetMode: () => send<boolean>('wallet:get-testnet-mode'),
    setTestnetMode: (enabled: boolean) => send('wallet:set-testnet-mode', enabled),

    // Privacy Mode — same contract as the Electron window.wallet API.
    getPrivacyMode: () => send<boolean>('wallet:get-privacy-mode'),
    setPrivacyMode: (enabled: boolean) => send('wallet:set-privacy-mode', enabled),

    // Background floor-valuation push (Collectibles tab renders before values).
    onCollectiblesUpdated:  (cb: (r: unknown) => void) => on('collectibles:updated', cb as (d: unknown) => void),
    offCollectiblesUpdated: (cb: (r: unknown) => void) => off('collectibles:updated', cb as (d: unknown) => void),

    // EVM network switcher — same contract as the Electron window.wallet API so the
    // shared NetworkSwitcher component works in both. Chain state lives in the SW.
    web3GetChain:   () => send<string>('web3:get-chain'),
    web3GetChains:  () => send<Array<{ chainId: number; id: string; name: string; color: string }>>('web3:get-chains'),
    web3SetChain:   (chainId: number) => send<string>('web3:set-chain', chainId),
    onWeb3ChainChanged:  (cb: (hex: string) => void) => on('web3:chain-changed', cb as (d: unknown) => void),
    offWeb3ChainChanged: (cb: (hex: string) => void) => off('web3:chain-changed', cb as (d: unknown) => void),
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
