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

  // ── Data reads ────────────────────────────────────────────────────────
  getAddresses:  ()                  => ipcRenderer.invoke('wallet:get-addresses'),
  getBalances:   ()                  => ipcRenderer.invoke('wallet:get-balances'),
  revealSeed:    ()                  => ipcRenderer.invoke('wallet:reveal-seed'),

  // ── Phase 2: Send transactions ────────────────────────────────────────
  estimateFee:   (chain: string, to: string, amount: string) =>
    ipcRenderer.invoke('wallet:estimate-fee', chain, to, amount),
  sendEvm:       (to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-evm', to, amount),
  sendSolana:    (to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-solana', to, amount),
  sendCardano:   (to: string, amount: string) =>
    ipcRenderer.invoke('wallet:send-cardano', to, amount),

  // ── Danger zone ───────────────────────────────────────────────────────
  deleteWallet:  ()                  => ipcRenderer.invoke('wallet:delete'),

  // ── Window controls (custom titlebar) ────────────────────────────────
  minimize:      ()                  => ipcRenderer.send('window:minimize'),
  close:         ()                  => ipcRenderer.send('window:close'),
})
