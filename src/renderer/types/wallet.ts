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
      // Phase 2: send — chainId is the chain-config id string
      estimateFee(chainId: string, to: string, amount: string): Promise<FeeEstimate>
      sendEvm(chainId: string, to: string, amount: string): Promise<SendResult>
      sendSolana(to: string, amount: string): Promise<SendResult>
      sendCardano(to: string, amount: string): Promise<SendResult>
      // Phase 3: history + multi-account
      getHistory(): Promise<AllHistory>
      getAccountIndex(): Promise<number>
      setAccount(index: number): Promise<WalletAddresses>
      deleteWallet(): Promise<boolean>
      minimize(): void
      close(): void
    }
  }
}
