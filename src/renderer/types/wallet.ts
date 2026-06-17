export interface WalletAddresses {
  evm: string
  solana: string
  cardano: string
  cardanoStake: string
  accountIndex: number
}

export interface ChainBalance {
  native: string
  symbol: string
  usdValue: string | null
  tokenCount: number
  error: string | null
}

export interface AllBalances {
  evm: ChainBalance
  solana: ChainBalance
  cardano: ChainBalance
  fetchedAt: number
}

export interface TxRecord {
  hash: string
  direction: 'in' | 'out' | 'self'
  amount: string | null
  symbol: string
  timestamp: number          // unix ms
  counterparty: string | null
  explorerUrl: string
}

export interface ChainHistory {
  records: TxRecord[]
  error: string | null
}

export interface AllHistory {
  evm: ChainHistory
  solana: ChainHistory
  cardano: ChainHistory
}

export type AppPage =
  | 'loading'
  | 'welcome'
  | 'create'
  | 'confirm'
  | 'import'
  | 'dashboard'

export type SendChain = 'evm' | 'solana' | 'cardano'

export interface FeeEstimate {
  fee: string
  feeSymbol: string
  feeUsd: string | null
}

export interface SendResult {
  txHash: string
  explorerUrl: string
}

// Extend window to include the preload bridge
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
      // Phase 2: send
      estimateFee(chain: SendChain, to: string, amount: string): Promise<FeeEstimate>
      sendEvm(to: string, amount: string): Promise<SendResult>
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