export interface WalletAddresses {
  evm: string
  solana: string
  cardano: string | null
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

export type AppPage =
  | 'loading'
  | 'welcome'
  | 'create'
  | 'confirm'
  | 'import'
  | 'dashboard'

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
      deleteWallet(): Promise<boolean>
      minimize(): void
      close(): void
    }
  }
}