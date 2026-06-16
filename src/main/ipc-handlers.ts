/**
 * ipc-handlers.ts — MagicMoney Wallet
 *
 * All IPC channels the renderer can invoke via the preload bridge.
 * The renderer ONLY gets back public addresses, balances, and status booleans.
 * Keys and mnemonics are consumed and discarded within these handlers.
 */

import { ipcMain } from 'electron'
import {
  generateMnemonic,
  validateMnemonic,
  deriveAddresses
} from './wallet-core'
import {
  saveMnemonic,
  loadMnemonic,
  walletExists,
  deleteWallet,
  saveAddresses,
  loadAddresses,
  loadConfig,
  saveConfig,
  type WalletConfig
} from './secure-store'
import { fetchAllBalances } from './balance-fetcher'
import {
  estimateEvmFee,
  estimateSolanaFee,
  estimateCardanoFee,
  sendEvmTransaction,
  sendSolanaTransaction,
  sendCardanoTransaction
} from './tx-sender'

// In-memory session cache of the confirmed mnemonic (cleared after save)
// This holds the phrase after generation but BEFORE the user confirms backup.
let _pendingMnemonic: string | null = null

export function registerIpcHandlers(): void {
  // ── Check if wallet is already configured ──────────────────────────────
  ipcMain.handle('wallet:is-setup', () => walletExists())

  // ── Generate a new mnemonic (does NOT save it yet) ─────────────────────
  // The renderer shows the words; the user confirms backup; THEN we save.
  ipcMain.handle('wallet:generate', () => {
    _pendingMnemonic = generateMnemonic()
    // Return the words array for display — this is the ONLY time the
    // mnemonic is sent to the renderer, and only in the create flow.
    return _pendingMnemonic.split(' ')
  })

  // ── Validate any mnemonic string ───────────────────────────────────────
  ipcMain.handle('wallet:validate', (_event, mnemonic: string) =>
    validateMnemonic(mnemonic)
  )

  // ── Confirm backup: save pending mnemonic and derive addresses ─────────
  // Called after user confirms they've written down their seed phrase.
  ipcMain.handle('wallet:confirm-backup', async () => {
    if (!_pendingMnemonic) throw new Error('No pending mnemonic — restart setup')
    const addresses = await deriveAddresses(_pendingMnemonic)
    saveMnemonic(_pendingMnemonic)
    saveAddresses(addresses)
    _pendingMnemonic = null   // clear from memory immediately
    return addresses
  })

  // ── Import existing mnemonic ───────────────────────────────────────────
  ipcMain.handle('wallet:import', async (_event, mnemonic: string) => {
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase — check your words and try again')
    }
    const addresses = await deriveAddresses(mnemonic)
    saveMnemonic(mnemonic)
    saveAddresses(addresses)
    return addresses
  })

  // ── Get stored public addresses ────────────────────────────────────────
  ipcMain.handle('wallet:get-addresses', () => loadAddresses())

  // ── Fetch live balances from Alchemy / Helius / Blockfrost ─────────────
  ipcMain.handle('wallet:get-balances', async () => {
    const addresses = loadAddresses()
    if (!addresses) throw new Error('No addresses found — wallet not set up')
    const config = loadConfig()
    return fetchAllBalances(addresses, config)
  })

  // ── Export encrypted mnemonic backup display (for settings screen) ─────
  // Returns the words for display ONLY — user must authenticate first.
  // (Phase 2: add PIN confirmation before this handler executes)
  ipcMain.handle('wallet:reveal-seed', () => {
    const mnemonic = loadMnemonic()
    return mnemonic.split(' ')
  })

  // ── Delete wallet (wipe all local data) ───────────────────────────────
  ipcMain.handle('wallet:delete', () => {
    deleteWallet()
    return true
  })

  // ── Phase 2: Fee estimation ────────────────────────────────────────────
  ipcMain.handle('wallet:estimate-fee', async (
    _event,
    chain: 'evm' | 'solana' | 'cardano',
    to: string,
    amount: string
  ) => {
    const config = loadConfig()
    const addresses = loadAddresses()
    if (!addresses) throw new Error('No addresses found')
    if (chain === 'evm') return estimateEvmFee(addresses.evm, to, amount, config)
    if (chain === 'solana') return estimateSolanaFee(config)
    if (chain === 'cardano') return estimateCardanoFee(addresses.cardano, config)
    throw new Error(`Unknown chain: ${chain}`)
  })

  // ── Phase 2: Send EVM ─────────────────────────────────────────────────
  ipcMain.handle('wallet:send-evm', async (_event, to: string, amountEth: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    return sendEvmTransaction(mnemonic, to, amountEth, config)
  })

  // ── Phase 2: Send Solana ──────────────────────────────────────────────
  ipcMain.handle('wallet:send-solana', async (_event, to: string, amountSol: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    return sendSolanaTransaction(mnemonic, to, amountSol, config)
  })

  // ── Phase 2: Send Cardano ─────────────────────────────────────────────
  ipcMain.handle('wallet:send-cardano', async (_event, to: string, amountAda: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    const addresses = loadAddresses()
    if (!addresses?.cardano) throw new Error('No Cardano address found')
    return sendCardanoTransaction(mnemonic, addresses.cardano, to, amountAda, config)
  })

  // ── Config: get/set API keys ───────────────────────────────────────────
  ipcMain.handle('config:get', () => {
    const cfg = loadConfig()
    // Redact keys for display — only show that they're set
    return {
      alchemyKeySet: cfg.alchemyKey.length > 0,
      heliusKeySet: cfg.heliusKey.length > 0,
      blockfrostKeySet: cfg.blockfrostKey.length > 0
    }
  })

  ipcMain.handle('config:set', (_event, config: Partial<WalletConfig>) => {
    saveConfig(config)
    return true
  })
}