import type { SsEstimateParams, SsEstimate, SsCreateParams, SsExchange } from './simpleswap'
import type { SwapQuoteRequest, SwapQuoteResponse, SwapExecuteResult, SwapTokenListResponse, NormalizedSwapQuote, SwapChain } from './swap'

export interface WalletAddresses {
  evm: string
  solana: string
  cardano: string
  cardanoStake: string
  bitcoin: string
  polkadot: string
  accountIndex: number
  // Abstract Global Wallet (smart account). agw = manual override ?? auto-derived.
  // agwOwned = this wallet's EOA can sign for it (required to send from it).
  agw?: string
  agwOwned?: boolean
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
export type { SwapMode, SwapProvider, SwapChain, SwapToken, SwapQuoteRequest, NormalizedSwapQuote, SwapQuoteResponse, SwapExecuteResult, SwapTokenListResponse } from './swap'

export type AppPage =
  | 'loading'
  | 'welcome'
  | 'create'
  | 'confirm'
  | 'import'
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

declare global {
  interface Window {
    wallet: {
      isSetup(): Promise<boolean>
      generate(): Promise<string[]>
      validate(mnemonic: string): Promise<boolean>
      confirmBackup(): Promise<WalletAddresses>
      import(mnemonic: string): Promise<WalletAddresses>
      getAddresses(): Promise<WalletAddresses | null>
      getBalances(): Promise<AllBalances>
      revealSeed(): Promise<string[]>
      // Phase 2
      estimateFee(chainId: string, to: string, amount: string): Promise<FeeEstimate>
      sendEvm(chainId: string, to: string, amount: string): Promise<SendResult>
      sendAgw(to: string, amount: string, token?: { contractAddress: string; decimals: number }): Promise<SendResult>
      sendSolana(to: string, amount: string): Promise<SendResult>
      sendCardano(to: string, amount: string): Promise<SendResult>
      // Phase 3
      getHistory(): Promise<AllHistory>
      getAccountIndex(): Promise<number>
      setAccount(index: number): Promise<WalletAddresses>
      setAgw(accountIndex: number, address: string | null): Promise<WalletAddresses | null>
      deleteWallet(): Promise<boolean>
      // Phase 5
      getMarket(): Promise<MarketResult>
      searchMarket(query: string): Promise<MarketCoin[]>
      getCoinChart(coinId: string, days: string): Promise<Array<[number, number]>>
      getTokens(): Promise<TokensResult>
      getCollectibles(): Promise<CollectiblesResult>
      getNftFloor(chain: string, contractAddress: string): Promise<NftFloorPrice>
      swapGetQuote(req: SwapQuoteRequest): Promise<SwapQuoteResponse>
      swapExecute(quote: NormalizedSwapQuote): Promise<SwapExecuteResult>
      swapGetTokens(chain: SwapChain): Promise<SwapTokenListResponse>
      ssEstimate(params: SsEstimateParams): Promise<SsEstimate>
      ssCreateExchange(params: SsCreateParams): Promise<SsExchange>
      ssStatus(id: string): Promise<SsExchange>
      minimize(): void
      close(): void
      // Phase 6: popup dApp browser
      openBrowser(): void
      closeBrowser(): void
      browserBack(): void
      browserForward(): void
      browserReload(): void
      browserHome(): void
      browserNavigate(url: string): Promise<void>
      browserGetState(): Promise<{ url: string; canBack: boolean; canForward: boolean; loading: boolean }>
      onBrowserUrl(cb: (url: string) => void): void
      onBrowserLoading(cb: (loading: boolean) => void): void
      onBrowserNavState(cb: (s: { canBack: boolean; canForward: boolean }) => void): void
      onBrowserTitle(cb: (title: string) => void): void
      offBrowserUrl(cb: (url: string) => void): void
      offBrowserLoading(cb: (loading: boolean) => void): void
      offBrowserNavState(cb: (s: { canBack: boolean; canForward: boolean }) => void): void
      offBrowserTitle(cb: (title: string) => void): void
      onBrowserClosed(cb: () => void): void
      offBrowserClosed(cb: () => void): void
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
