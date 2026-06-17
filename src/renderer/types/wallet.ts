export interface WalletAddresses {
  evm: string
  solana: string
  cardano: string
  cardanoStake: string
  bitcoin: string
  polkadot: string
  accountIndex: number
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
}

export interface WalletToken {
  contractAddress: string
  name: string
  symbol: string
  decimals: number
  balance: string
  usdValue: string | null
  logoUri: string | null
  chain: string
  chainLabel: string
  chainColor: string
}

export interface TokensResult {
  tokens: WalletToken[]
  fetchedAt: number
  error: string | null
}

export interface WalletCollectible {
  id: string
  name: string
  description: string | null
  image: string | null
  collectionName: string | null
  chain: string
  chainLabel: string
  chainColor: string
  tokenId: string
  contractAddress: string
  contractType: string
}

export interface CollectiblesResult {
  items: WalletCollectible[]
  fetchedAt: number
  error: string | null
}

export type MainTab = 'portfolio' | 'market'

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
      sendSolana(to: string, amount: string): Promise<SendResult>
      sendCardano(to: string, amount: string): Promise<SendResult>
      // Phase 3
      getHistory(): Promise<AllHistory>
      getAccountIndex(): Promise<number>
      setAccount(index: number): Promise<WalletAddresses>
      deleteWallet(): Promise<boolean>
      // Phase 5
      getMarket(): Promise<MarketResult>
      searchMarket(query: string): Promise<MarketCoin[]>
      getCoinChart(coinId: string, days: string): Promise<Array<[number, number]>>
      getTokens(): Promise<TokensResult>
      getCollectibles(): Promise<CollectiblesResult>
      minimize(): void
      close(): void
    }
  }
}
