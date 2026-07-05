import type { SsEstimateParams, SsEstimate, SsCreateParams, SsExchange, XchangeEstimate, XchangeCreateParams, ExchangeProvider } from './simpleswap'
import type { SwapQuoteRequest, SwapQuoteResponse, SwapExecuteResult, SwapTokenListResponse, NormalizedSwapQuote, SwapChain, CrossSwapStatusRequest, CrossSwapStatus } from './swap'

// In-app software update status (Electron only). Mirrors update-manager.ts.
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'mac-available' | 'error'
  version?: string
  percent?: number
  error?: string
}

export interface WalletAddresses {
  evm: string
  solana: string
  cardano: string
  cardanoStake: string
  bitcoin: string          // Native SegWit (bc1q…) — payment
  bitcoinNested: string    // Nested SegWit (3…)
  bitcoinTaproot: string   // Taproot (bc1p…) — ordinals
  polkadot: string
  tron?: string
  dogecoin?: string
  accountIndex: number
  // Abstract Global Wallet (smart account). agw = manual override ?? auto-derived.
  // agwOwned = this wallet's EOA can sign for it (required to send from it).
  agw?: string
  agwOwned?: boolean
  // Testnet Mode: cached testnet-encoded set (Bitcoin tb1…, Cardano addr_test…).
  // While the mode is on, main substitutes these into the top-level fields before
  // returning, so the renderer rarely needs to read this directly.
  testnet?: {
    bitcoin: string
    bitcoinNested: string
    bitcoinTaproot: string
    cardano: string
    cardanoStake: string
  }
}

export interface ChainBalance {
  native: string
  symbol: string
  usdValue: string | null
  tokenCount: number
  error: string | null
  priceChange24h: number | null
  sparkline: number[] | null
}

export interface AllBalances {
  chains: Record<string, ChainBalance>
  fetchedAt: number
  portfolioSparkline: number[] | null
}

export interface TxRecord {
  hash: string
  direction: 'in' | 'out' | 'self'
  amount: string | null
  symbol: string
  timestamp: number
  counterparty: string | null
  explorerUrl: string
}

export interface ChainHistory {
  records: TxRecord[]
  error: string | null
}

export type AllHistory = Record<string, ChainHistory>

// ── Phase 5: Market Watch ────────────────────────────────────────────────────

export interface MarketCoin {
  id: string
  rank: number
  name: string
  symbol: string
  image: string
  price: number
  change24h: number | null
  marketCap: number | null
  sparkline: number[] | null
}

export interface MarketResult {
  coins: MarketCoin[]
  fetchedAt: number
  error: string | null
  source?: string
}

export interface WalletToken {
  contractAddress: string
  name: string
  symbol: string
  decimals: number
  balance: string
  usdValue: string | null
  nativeEquivalent: string | null
  nativeSymbol: string
  logoUri: string | null
  chain: string
  chainLabel: string
  chainColor: string
  source?: 'agw'   // asset lives in the Abstract Global Wallet (smart account)
}

export interface TokensResult {
  tokens: WalletToken[]
  fetchedAt: number
  error: string | null
}

export interface NftTrait {
  trait_type: string
  value: string
}

export interface WalletCollectible {
  id: string
  name: string
  description: string | null
  image: string | null
  animationUrl: string | null
  collectionName: string | null
  chain: string
  chainLabel: string
  chainColor: string
  tokenId: string
  contractAddress: string
  contractType: string
  traits: NftTrait[]
  source?: 'agw'   // NFT lives in the Abstract Global Wallet (smart account)
  floorPrice?: number | null   // collection floor in the chain's native unit
  usdValue?: string | null     // floor × native price, e.g. "$42.10"
}

export interface NftFloorPrice {
  floor: string | null
  currency: string
  floorUsd: string | null
}

export interface CollectiblesResult {
  items: WalletCollectible[]
  fetchedAt: number
  error: string | null
  chainResults: Record<string, { count: number; error: string | null }>
}

// ── Phase 10: WalletConnect ──────────────────────────────────────────────────

export interface WcSession {
  topic: string
  peerName: string
  peerIcon: string | null
  peerUrl: string
  expiry: number
  accounts: string[]
}

export interface WcProposal {
  id: number
  peerName: string
  peerIcon: string | null
  peerUrl: string
  requiredChains: string[]
  optionalChains: string[]
  requiredMethods: string[]
}

export interface WcRequest {
  id: number
  topic: string
  peerName: string
  peerIcon: string | null
  chainId: string
  method: string
  params: unknown[]
  humanReadable: string
}

// ── Phase 9: ChainLens Profile ───────────────────────────────────────────────

export interface ClWallet {
  id: string
  user_id: string
  chain: string
  address: string
  watch_only: boolean
  verified_at: string | null
  is_primary: boolean | null
  label: string | null
}

export interface ClLinkedAccount {
  id: string
  user_id: string
  provider: string
  provider_id: string
  display_name: string | null
  avatar_url: string | null
  email: string | null
}

export interface ClUser {
  id: string
  provider: string
  provider_id: string
  display_name: string | null
  avatar_url: string | null
  email: string | null
  created_at: string | null
  cl_wallets: ClWallet[]
  cl_linked_accounts: ClLinkedAccount[]
}

export interface ChainlensSyncResult {
  success: boolean
  profile: ClUser | null
  error: string | null
}

export type MainTab = 'portfolio' | 'market' | 'swap' | 'apphub' | 'profile'

// ─── DEX swap types live in ./swap (re-exported here for convenience) ─────────
export type { SwapMode, SwapProvider, SwapChain, SwapToken, SwapQuoteRequest, NormalizedSwapQuote, SwapQuoteResponse, SwapExecuteResult, SwapTokenListResponse, CrossSwapStatusRequest, CrossSwapStatus } from './swap'

export type AppPage =
  | 'loading'
  | 'welcome'
  | 'create'
  | 'confirm'
  | 'import'
  | 'setpassword'
  | 'unlock'
  | 'dashboard'

// chainId string from chain-config — e.g. 'ethereum', 'arbitrum', 'solana', 'cardano'
export type SendChain = string

export interface FeeEstimate {
  fee: string
  feeSymbol: string
  feeUsd: string | null
}

export interface SendResult {
  txHash: string
  explorerUrl: string
}

export interface BrowserTab {
  id: number
  title: string
  url: string
  loading: boolean
}

declare global {
  interface Window {
    wallet: {
      isSetup(): Promise<boolean>
      generate(): Promise<string[]>
      validate(mnemonic: string): Promise<boolean>
      confirmBackup(): Promise<WalletAddresses>
      import(mnemonic: string): Promise<WalletAddresses>
      // Password / lock lifecycle
      setPassword(password: string): Promise<boolean>
      unlock(password: string): Promise<boolean>
      lock(): Promise<boolean>
      isUnlocked(): Promise<boolean>
      needsMigration(): Promise<boolean>
      onLocked(cb: () => void): void
      offLocked(cb: () => void): void
      reportActivity?(): void
      // Biometric unlock — Windows Hello / Touch ID (optional; desktop only).
      // Absent on the extension bridge.
      helloStatus?(): Promise<{ supported: boolean; enrolled: boolean; method?: 'windows-hello' | 'touch-id' | null }>
      helloEnroll?(): Promise<boolean>
      helloUnlock?(): Promise<boolean>
      helloRemove?(): Promise<boolean>
      getAddresses(): Promise<WalletAddresses | null>
      getBalances(): Promise<AllBalances>
      revealSeed(password: string): Promise<string[]>
      // Phase 2
      estimateFee(chainId: string, to: string, amount: string): Promise<FeeEstimate>
      sendEvm(chainId: string, to: string, amount: string): Promise<SendResult>
      sendAgw(to: string, amount: string, token?: { contractAddress: string; decimals: number }): Promise<SendResult>
      sendSolana(to: string, amount: string): Promise<SendResult>
      sendCardano(to: string, amount: string): Promise<SendResult>
      sendBitcoin(to: string, amount: string): Promise<SendResult>
      sendTron(to: string, amount: string, token?: { contractAddress: string; decimals: number }): Promise<SendResult>
      sendDogecoin(to: string, amount: string): Promise<SendResult>
      // Phase 3
      getHistory(): Promise<AllHistory>
      getAccountIndex(): Promise<number>
      setAccount(index: number): Promise<WalletAddresses>
      // Testnet Mode
      getTestnetMode(): Promise<boolean>
      setTestnetMode(enabled: boolean): Promise<{ testnet: boolean; addresses: WalletAddresses | null }>
      setAgw(accountIndex: number, address: string | null): Promise<WalletAddresses | null>
      // Connected sites (revoke dApp access)
      getConnectedSites(): Promise<string[]>
      revokeSite(origin: string): Promise<string[]>
      revokeAllSites(): Promise<string[]>
      deleteWallet(): Promise<boolean>
      // Phase 5
      getMarket(): Promise<MarketResult>
      searchMarket(query: string): Promise<MarketCoin[]>
      getCoinChart(coinId: string, days: string): Promise<Array<[number, number]>>
      getTokens(): Promise<TokensResult>
      getCollectibles(excludeIds?: string[]): Promise<CollectiblesResult>
      // Pushed when the background floor-valuation pass finishes.
      onCollectiblesUpdated(cb: (r: CollectiblesResult) => void): void
      offCollectiblesUpdated(cb: (r: CollectiblesResult) => void): void
      getNftFloor(chain: string, contractAddress: string): Promise<NftFloorPrice>
      swapGetQuote(req: SwapQuoteRequest): Promise<SwapQuoteResponse>
      swapExecute(quote: NormalizedSwapQuote): Promise<SwapExecuteResult>
      swapCrossStatus(req: CrossSwapStatusRequest): Promise<CrossSwapStatus>
      swapGetTokens(chain: SwapChain): Promise<SwapTokenListResponse>
      ssEstimate(params: SsEstimateParams): Promise<SsEstimate>
      ssCreateExchange(params: SsCreateParams): Promise<SsExchange>
      ssStatus(id: string): Promise<SsExchange>
      xEstimate(params: SsEstimateParams): Promise<XchangeEstimate>
      xCreateExchange(params: XchangeCreateParams): Promise<SsExchange>
      xStatus(provider: ExchangeProvider, id: string): Promise<SsExchange>
      minimize(): void
      close(): void
      // Side-by-side window layout (Full Screen Mode) — Electron only; absent
      // from the extension bridge (optional, like helloStatus below).
      layoutSnap?(side: 'left' | 'right'): void
      layoutDetach?(): void
      layoutToggle?(): void
      browserToggleMaximize?(): void
      layoutGetState?(): Promise<{ snapped: boolean; side: 'left' | 'right' | null; browserOpen: boolean; maximized: boolean }>
      onLayoutChanged?(cb: (s: { snapped: boolean; side: 'left' | 'right' | null; browserOpen: boolean; maximized: boolean }) => void): void
      offLayoutChanged?(cb: (s: { snapped: boolean; side: 'left' | 'right' | null; browserOpen: boolean; maximized: boolean }) => void): void
      // App version + in-app software update — Electron only; absent from the
      // extension bridge (extensions self-update via the Chrome store).
      getAppVersion?(): Promise<string>
      updateCheck?(): Promise<UpdateStatus>
      updateGetState?(): Promise<UpdateStatus>
      updateInstall?(): void
      onUpdateStatus?(cb: (s: UpdateStatus) => void): void
      offUpdateStatus?(cb: (s: UpdateStatus) => void): void
      // Phase 6: popup dApp browser
      openBrowser(): void
      closeBrowser(): void
      browserBack(): void
      browserForward(): void
      browserReload(): void
      browserHome(): void
      browserNavigate(url: string): Promise<void>
      browserGetState(): Promise<{ url: string; canBack: boolean; canForward: boolean; loading: boolean; tabs: BrowserTab[]; activeTabId: number }>
      browserNewTab(url?: string): void
      browserSetActiveTab(id: number): void
      browserCloseTab(id: number): void
      browserSuspendTabsMenu(): Promise<string>
      browserResumeTabsMenu(): void
      onBrowserUrl(cb: (url: string) => void): void
      onBrowserLoading(cb: (loading: boolean) => void): void
      onBrowserNavState(cb: (s: { canBack: boolean; canForward: boolean }) => void): void
      onBrowserTitle(cb: (title: string) => void): void
      onBrowserTabs(cb: (s: { activeTabId: number; tabs: BrowserTab[] }) => void): void
      offBrowserUrl(cb: (url: string) => void): void
      offBrowserLoading(cb: (loading: boolean) => void): void
      offBrowserNavState(cb: (s: { canBack: boolean; canForward: boolean }) => void): void
      offBrowserTitle(cb: (title: string) => void): void
      offBrowserTabs(cb: (s: { activeTabId: number; tabs: BrowserTab[] }) => void): void
      onBrowserClosed(cb: () => void): void
      offBrowserClosed(cb: () => void): void
      // dApp browser: active EVM network (toolbar switcher + awareness)
      web3GetChain(): Promise<string>
      web3GetChains(): Promise<Array<{ chainId: number; id: string; name: string; color: string }>>
      web3SetChain(chainId: number): Promise<string>
      onWeb3ChainChanged(cb: (hex: string) => void): void
      offWeb3ChainChanged(cb: (hex: string) => void): void
      // Phase 9: ChainLens profile sync
      chainlensGetProfile(): Promise<ClUser | null>
      chainlensSync(): Promise<ChainlensSyncResult>
      chainlensUpdateProfile(updates: { display_name?: string; avatar_url?: string }): Promise<{ success: boolean; error: string | null }>
      chainlensPickAvatar(): Promise<string | null>
      // Phase 10: WalletConnect
      wcGetSessions(): Promise<WcSession[]>
      wcGetPendingProposals(): Promise<WcProposal[]>
      wcPair(uri: string): Promise<void>
      wcApproveSession(id: number): Promise<WcSession>
      wcRejectSession(id: number): Promise<void>
      wcDisconnect(topic: string): Promise<void>
      wcApproveRequest(id: number): Promise<void>
      wcRejectRequest(id: number): Promise<void>
      onWcProposal(cb: (p: WcProposal) => void): void
      onWcRequest(cb: (r: WcRequest) => void): void
      onWcSessionsChanged(cb: (s: WcSession[]) => void): void
      offWcProposal(cb: (p: WcProposal) => void): void
      offWcRequest(cb: (r: WcRequest) => void): void
      offWcSessionsChanged(cb: (s: WcSession[]) => void): void
    }
  }
}
