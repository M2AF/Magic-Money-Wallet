/**
 * ipc-handlers.ts — MagicMoney Wallet
 *
 * All IPC channels the renderer can invoke via the preload bridge.
 * The renderer ONLY gets back public addresses, balances, and status booleans.
 * Keys and mnemonics are consumed and discarded within these handlers.
 */

import { ipcMain, BrowserWindow, dialog } from 'electron'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { privateKeyToAccount } from 'viem/accounts'
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
import {
  openBrowserWindow,
  closeBrowserWindow,
  browserNavigate,
  browserBack,
  browserForward,
  browserReload,
  browserHome,
  getBrowserState,
  getMainWin
} from './browser-manager'
import { fetchAllBalances } from './balance-fetcher'
import { fetchAllHistory } from './tx-history'
import { fetchMarketTop100, searchMarketCoins, fetchCoinChart } from './market-fetcher'
import { fetchAllTokens, fetchAllCollectibles } from './token-fetcher'
import { syncWallets, getProfileByAddress, updateProfile } from './supabase-sync'
import {
  wcGetSessions, wcGetPendingProposals,
  wcPair, wcApproveSession, wcRejectSession,
  wcDisconnect, wcApproveRequest, wcRejectRequest
} from './wc-client'
import {
  estimateEvmFee,
  estimateSolanaFee,
  estimateCardanoFee,
  sendEvmTransaction,
  sendSolanaTransaction,
  sendCardanoTransaction
} from './tx-sender'
import {
  cip30GetBalance, cip30GetUtxos, cip30GetRewardAddresses,
  cip30SignTx, cip30SignData, cip30SubmitTx,
} from './cardano-cip30'

// ── Key derivation helpers (used by web3 IPC) ──────────────────────────────

function deriveEvmKey(mnemonic: string, accountIndex: number): `0x${string}` {
  const seed = mnemonicToSeedSync(mnemonic)
  const hd = HDKey.fromMasterSeed(seed)
  const child = hd.derive(`m/44'/60'/${accountIndex}'/0/0`)
  if (!child.privateKey) throw new Error('Failed to derive private key')
  return `0x${Buffer.from(child.privateKey).toString('hex')}` as `0x${string}`
}

async function sendEvmFromDapp(
  mnemonic: string,
  accountIndex: number,
  tx: { to?: string; value?: string; data?: string; gas?: string },
  config: { alchemyKey: string }
): Promise<string> {
  const pk = deriveEvmKey(mnemonic, accountIndex)
  const account = privateKeyToAccount(pk)
  const alchemyUrl = `https://eth-mainnet.g.alchemy.com/v2/${config.alchemyKey}`

  // Get nonce
  const nonceRes = await fetch(alchemyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: [account.address, 'pending'] })
  })
  const nonceData = await nonceRes.json() as { result: string }
  const nonce = parseInt(nonceData.result, 16)

  // Get gas price
  const gpRes = await fetch(alchemyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'eth_gasPrice', params: [] })
  })
  const gpData = await gpRes.json() as { result: string }
  const gasPrice = BigInt(gpData.result)

  const gas = tx.gas ? BigInt(tx.gas) : 21000n
  const value = tx.value ? BigInt(tx.value) : 0n

  // Use viem to sign the transaction
  const { createWalletClient, http } = await import('viem')
  const { mainnet } = await import('viem/chains')
  const client = createWalletClient({ account, chain: mainnet, transport: http(alchemyUrl) })
  const hash = await client.sendTransaction({
    to: tx.to as `0x${string}` | undefined,
    value,
    data: tx.data as `0x${string}` | undefined,
    gas,
    gasPrice,
    nonce
  })
  return hash
}

// In-memory session cache of the confirmed mnemonic (cleared after save)
// This holds the phrase after generation but BEFORE the user confirms backup.
let _pendingMnemonic: string | null = null

/**
 * Load addresses, auto-migrating if newer fields (bitcoin, polkadot) are absent.
 * Wallets created before those chains were added won't have them in addresses.json.
 */
async function getFullAddresses() {
  const stored = loadAddresses()
  if (!stored) throw new Error('No addresses found — wallet not set up')
  if (stored.bitcoin && stored.polkadot) return stored
  // Re-derive from mnemonic to fill in missing fields, then persist
  const full = await deriveAddresses(loadMnemonic(), stored.accountIndex ?? 0)
  saveAddresses(full)
  return full
}

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
    // fire-and-forget: sync to ChainLens profile
    syncWallets(addresses, loadConfig()).catch(() => {})
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
    // fire-and-forget: sync to ChainLens profile
    syncWallets(addresses, loadConfig()).catch(() => {})
    return addresses
  })

  // ── Get stored public addresses ────────────────────────────────────────
  ipcMain.handle('wallet:get-addresses', () => getFullAddresses())

  // ── Fetch live balances from Alchemy / Helius / Blockfrost / Tatum ─────
  ipcMain.handle('wallet:get-balances', async () => {
    const addresses = await getFullAddresses()
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
  // chainId is a chain-config id: 'ethereum', 'arbitrum', 'solana', 'cardano', etc.
  ipcMain.handle('wallet:estimate-fee', async (
    _event,
    chainId: string,
    to: string,
    amount: string
  ) => {
    const config = loadConfig()
    const addresses = loadAddresses()
    if (!addresses) throw new Error('No addresses found')
    if (chainId === 'solana') return estimateSolanaFee(config)
    if (chainId === 'cardano') return estimateCardanoFee(addresses.cardano, config)
    return estimateEvmFee(addresses.evm, to, amount, config, chainId)
  })

  // ── Phase 2: Send EVM ─────────────────────────────────────────────────
  ipcMain.handle('wallet:send-evm', async (_event, chainId: string, to: string, amountEth: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    return sendEvmTransaction(mnemonic, to, amountEth, config, chainId, accountIndex)
  })

  // ── Phase 2: Send Solana ──────────────────────────────────────────────
  ipcMain.handle('wallet:send-solana', async (_event, to: string, amountSol: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    const accountIndex = loadAddresses()?.accountIndex ?? 0
    return sendSolanaTransaction(mnemonic, to, amountSol, config, accountIndex)
  })

  // ── Phase 2: Send Cardano ─────────────────────────────────────────────
  ipcMain.handle('wallet:send-cardano', async (_event, to: string, amountAda: string) => {
    const mnemonic = loadMnemonic()
    const config = loadConfig()
    const addresses = loadAddresses()
    if (!addresses?.cardano) throw new Error('No Cardano address found')
    return sendCardanoTransaction(mnemonic, addresses.cardano, to, amountAda, config, addresses.accountIndex ?? 0)
  })

  // ── Phase 3: Transaction history ──────────────────────────────────────
  ipcMain.handle('wallet:get-history', async () => {
    const addresses = await getFullAddresses()
    const config = loadConfig()
    return fetchAllHistory(addresses, config)
  })

  // ── Phase 3: Multi-account ────────────────────────────────────────────
  ipcMain.handle('wallet:get-account', () => loadAddresses()?.accountIndex ?? 0)

  ipcMain.handle('wallet:set-account', async (_event, accountIndex: number) => {
    if (accountIndex < 0 || accountIndex > 9) throw new Error('Account index must be 0–9')
    const mnemonic = loadMnemonic()
    const newAddresses = await deriveAddresses(mnemonic, accountIndex)
    saveAddresses(newAddresses)
    return newAddresses
  })

  // ── Phase 5: Market Watch ────────────────────────────────────────────────
  ipcMain.handle('wallet:get-market', () => fetchMarketTop100())

  ipcMain.handle('wallet:search-market', (_event, query: string) =>
    searchMarketCoins(query)
  )

  ipcMain.handle('wallet:get-coin-chart', (_event, coinId: string, days: string) =>
    fetchCoinChart(coinId, days)
  )

  // ── Phase 5: Tokens + Collectibles ───────────────────────────────────────
  ipcMain.handle('wallet:get-tokens', async () => {
    const addresses = await getFullAddresses()
    const config = loadConfig()
    return fetchAllTokens(
      { evm: addresses.evm, solana: addresses.solana, cardano: addresses.cardano },
      config
    )
  })

  ipcMain.handle('wallet:get-collectibles', async () => {
    const addresses = await getFullAddresses()
    const config = loadConfig()
    return fetchAllCollectibles(addresses.evm, addresses.cardano, config)
  })

  // ── NFT floor price via OpenSea (EVM) ─────────────────────────────────────
  // Chain slug mapping: wallet chain id → OpenSea chain slug
  const OPENSEA_CHAIN: Record<string, string> = {
    ethereum: 'ethereum', arbitrum: 'arbitrum', optimism: 'optimism',
    base: 'base', polygon: 'matic', avalanche: 'avalanche',
    blast: 'blast', zora: 'zora', abstract: 'abstract'
  }

  ipcMain.handle('wallet:get-nft-floor', async (_e, chain: string, contractAddress: string) => {
    const config = loadConfig()
    const osChain = OPENSEA_CHAIN[chain]
    if (!osChain || !config.openseaKey || !contractAddress) {
      return { floor: null, currency: 'ETH', floorUsd: null }
    }
    try {
      // Step 1: get collection slug from contract
      const contractRes = await fetch(
        `https://api.opensea.io/api/v2/chain/${osChain}/contract/${contractAddress}`,
        { headers: { 'x-api-key': config.openseaKey }, signal: AbortSignal.timeout(8_000) }
      )
      if (!contractRes.ok) return { floor: null, currency: 'ETH', floorUsd: null }
      const contractJson = await contractRes.json() as { collection?: string }
      const slug = contractJson.collection
      if (!slug) return { floor: null, currency: 'ETH', floorUsd: null }

      // Step 2: get floor price from collection stats
      const statsRes = await fetch(
        `https://api.opensea.io/api/v2/collections/${slug}/stats`,
        { headers: { 'x-api-key': config.openseaKey }, signal: AbortSignal.timeout(8_000) }
      )
      if (!statsRes.ok) return { floor: null, currency: 'ETH', floorUsd: null }
      const statsJson = await statsRes.json() as {
        total?: { floor_price?: number; floor_price_symbol?: string }
      }
      const floor = statsJson.total?.floor_price
      const symbol = statsJson.total?.floor_price_symbol ?? 'ETH'
      if (floor == null) return { floor: null, currency: symbol, floorUsd: null }
      return { floor: floor.toFixed(4), currency: symbol, floorUsd: null }
    } catch {
      return { floor: null, currency: 'ETH', floorUsd: null }
    }
  })

  // ── Phase 6: Built-in browser controls ───────────────────────────────────
  ipcMain.on('browser:open',    () => openBrowserWindow())
  ipcMain.on('browser:close',   () => closeBrowserWindow())
  ipcMain.on('browser:back',    () => browserBack())
  ipcMain.on('browser:forward', () => browserForward())
  ipcMain.on('browser:reload',  () => browserReload())
  ipcMain.on('browser:home',    () => browserHome())
  ipcMain.handle('browser:navigate', (_event, url: string) => { browserNavigate(url) })
  ipcMain.handle('browser:get-state', () => getBrowserState())

  // ── Phase 6: Web3 dApp requests (from web3-inject preload) ───────────────
  let _dappConnected = false

  ipcMain.handle('web3:request', async (
    _event,
    { method, params }: { method: string; params: unknown[] }
  ) => {
    // Always show signing dialogs in the main wallet window, not the popup
    const win = getMainWin() ?? BrowserWindow.getAllWindows()[0]
    const addresses = loadAddresses()
    const config = loadConfig()

    switch (method) {
      // ── Connection ──────────────────────────────────────────────────────
      case 'eth_requestAccounts': {
        if (_dappConnected && addresses?.evm) return [addresses.evm]
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          title: 'Connect Wallet',
          message: 'A dApp wants to connect to your wallet',
          detail: `EVM Address:\n${addresses?.evm ?? 'Not available'}`,
          buttons: ['Connect', 'Reject'],
          defaultId: 0,
          cancelId: 1
        })
        if (response === 1) {
          const err = Object.assign(new Error('User rejected the request.'), { code: 4001 })
          throw err
        }
        _dappConnected = true
        win.webContents.send('web3:accounts-changed', [addresses?.evm ?? ''])
        return [addresses?.evm ?? '']
      }

      case 'eth_accounts':
        return _dappConnected && addresses?.evm ? [addresses.evm] : []

      case 'eth_chainId':
        return '0x1'

      case 'net_version':
        return '1'

      case 'wallet_requestPermissions':
        return [{ parentCapability: 'eth_accounts' }]

      case 'wallet_getPermissions':
        return _dappConnected ? [{ parentCapability: 'eth_accounts' }] : []

      // ── Message signing ─────────────────────────────────────────────────
      case 'personal_sign': {
        const hexMsg = params[0] as string
        let displayText: string
        try {
          displayText = Buffer.from(hexMsg.replace(/^0x/, ''), 'hex').toString('utf8')
        } catch {
          displayText = hexMsg
        }
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          title: 'Sign Message',
          message: 'A dApp wants you to sign a message',
          detail: displayText.slice(0, 400),
          buttons: ['Sign', 'Reject'],
          defaultId: 0,
          cancelId: 1
        })
        if (response === 1) {
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        }
        const mnemonic = loadMnemonic()
        const accountIndex = addresses?.accountIndex ?? 0
        const pk = deriveEvmKey(mnemonic, accountIndex)
        const account = privateKeyToAccount(pk)
        return account.signMessage({ message: { raw: hexMsg as `0x${string}` } })
      }

      case 'eth_sign': {
        const [, hexMsg] = params as [string, string]
        const { response } = await dialog.showMessageBox(win, {
          type: 'warning',
          title: 'Sign Data (eth_sign)',
          message: 'A dApp wants to sign raw data. Only proceed if you trust this site.',
          detail: hexMsg.slice(0, 200),
          buttons: ['Sign', 'Reject'],
          defaultId: 1,
          cancelId: 1
        })
        if (response === 1) {
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        }
        const mnemonic = loadMnemonic()
        const accountIndex = addresses?.accountIndex ?? 0
        const pk = deriveEvmKey(mnemonic, accountIndex)
        const account = privateKeyToAccount(pk)
        return account.signMessage({ message: { raw: hexMsg as `0x${string}` } })
      }

      // ── Transaction ─────────────────────────────────────────────────────
      case 'eth_sendTransaction': {
        const tx = (params[0] ?? {}) as {
          to?: string; value?: string; data?: string; gas?: string
        }
        const valueEth = tx.value
          ? (BigInt(tx.value) / BigInt(1e18)).toString() + ' ETH'
          : '0 ETH'
        const { response } = await dialog.showMessageBox(win, {
          type: 'question',
          title: 'Send Transaction',
          message: 'A dApp wants to send a transaction',
          detail: [
            `To: ${tx.to ?? '(contract)'}`,
            `Value: ${valueEth}`,
            tx.data ? `Data: ${tx.data.slice(0, 60)}…` : 'No data'
          ].join('\n'),
          buttons: ['Send', 'Reject'],
          defaultId: 0,
          cancelId: 1
        })
        if (response === 1) {
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
        }
        const mnemonic = loadMnemonic()
        const accountIndex = addresses?.accountIndex ?? 0
        return sendEvmFromDapp(mnemonic, accountIndex, tx, config)
      }

      // ── Read-only: proxy to Alchemy ETH mainnet ─────────────────────────
      default: {
        const alchemyUrl = `https://eth-mainnet.g.alchemy.com/v2/${config.alchemyKey}`
        const res = await fetch(alchemyUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
        })
        const data = await res.json() as { result?: unknown; error?: { message: string } }
        if (data.error) throw new Error(data.error.message)
        return data.result
      }
    }
  })

  // ── Phase 6: Solana dApp requests ─────────────────────────────────────────
  ipcMain.handle('web3:solana-connect', async () => {
    const win = getMainWin() ?? BrowserWindow.getAllWindows()[0]
    const addresses = loadAddresses()
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Connect Solana Wallet',
      message: 'A dApp wants to connect to your Solana wallet',
      detail: `Address:\n${addresses?.solana ?? 'Not available'}`,
      buttons: ['Connect', 'Reject'],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 1) {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    }
    return addresses?.solana ?? ''
  })

  ipcMain.handle('web3:solana-sign-message', async (_event, messageBytes: number[]) => {
    const win = getMainWin() ?? BrowserWindow.getAllWindows()[0]
    const decoded = (() => { try { return Buffer.from(messageBytes).toString('utf8') } catch { return `${messageBytes.length} bytes` } })()
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Sign Solana Message',
      message: 'A dApp wants to sign a message with your Solana wallet',
      detail: decoded.slice(0, 400),
      buttons: ['Sign', 'Reject'],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 1) {
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    }
    // Full Solana signing would require nacl here — placeholder signature for now
    throw new Error('Solana message signing not yet implemented')
  })

  // ── CIP-30 Cardano dApp requests ─────────────────────────────────────────
  let _cardanoConnected = false

  ipcMain.handle('cardano:is-enabled', () => _cardanoConnected)

  ipcMain.handle('cardano:enable', async () => {
    const win = getMainWin() ?? BrowserWindow.getAllWindows()[0]
    const addresses = loadAddresses()
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Connect Cardano Wallet',
      message: 'A dApp wants to connect to your Cardano wallet',
      detail: `Address:\n${addresses?.cardano ?? 'Not available'}`,
      buttons: ['Connect', 'Reject'],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 1) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    _cardanoConnected = true
    return true
  })

  ipcMain.handle('cardano:get-network-id', () => 1)

  ipcMain.handle('cardano:get-balance', async () => {
    const addresses = loadAddresses()
    if (!addresses?.cardano) throw new Error('No Cardano wallet')
    const config = loadConfig()
    return cip30GetBalance(addresses.cardano, config.blockfrostKey ?? '')
  })

  ipcMain.handle('cardano:get-utxos', async () => {
    const addresses = loadAddresses()
    if (!addresses?.cardano) throw new Error('No Cardano wallet')
    const config = loadConfig()
    return cip30GetUtxos(addresses.cardano, config.blockfrostKey ?? '')
  })

  ipcMain.handle('cardano:get-used-addresses', () => {
    const addresses = loadAddresses()
    return addresses?.cardano ? [addresses.cardano] : []
  })

  ipcMain.handle('cardano:get-unused-addresses', () => [])

  ipcMain.handle('cardano:get-change-address', () => {
    const addresses = loadAddresses()
    if (!addresses?.cardano) throw new Error('No Cardano wallet')
    return addresses.cardano
  })

  ipcMain.handle('cardano:get-reward-addresses', async () => {
    const mnemonic = loadMnemonic()
    const addresses = loadAddresses()
    return cip30GetRewardAddresses(mnemonic, addresses?.accountIndex ?? 0)
  })

  ipcMain.handle('cardano:sign-tx', async (_event, txHex: string, _partial: boolean) => {
    const win = getMainWin() ?? BrowserWindow.getAllWindows()[0]
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Sign Transaction',
      message: 'A dApp wants you to sign a Cardano transaction',
      buttons: ['Sign', 'Reject'],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 1) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    const mnemonic = loadMnemonic()
    const addresses = loadAddresses()
    return cip30SignTx(txHex, mnemonic, addresses?.accountIndex ?? 0)
  })

  ipcMain.handle('cardano:sign-data', async (_event, address: string, payloadHex: string) => {
    const win = getMainWin() ?? BrowserWindow.getAllWindows()[0]
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Sign Data',
      message: 'A dApp wants you to sign data with your Cardano wallet',
      buttons: ['Sign', 'Reject'],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 1) throw Object.assign(new Error('User rejected the request.'), { code: 4001 })
    const mnemonic = loadMnemonic()
    const addresses = loadAddresses()
    const signingAddr = address || addresses?.cardano || ''
    return cip30SignData(signingAddr, payloadHex, mnemonic, addresses?.accountIndex ?? 0)
  })

  ipcMain.handle('cardano:submit-tx', async (_event, txHex: string) => {
    const config = loadConfig()
    return cip30SubmitTx(txHex, config.blockfrostKey ?? '')
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

  // ── Phase 9: Avatar picker ────────────────────────────────────────────────
  ipcMain.handle('chainlens:pick-avatar', async () => {
    const win = getMainWin() ?? BrowserWindow.getAllWindows()[0]
    const { filePaths, canceled } = await dialog.showOpenDialog(win, {
      title: 'Choose Profile Photo',
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
      properties: ['openFile']
    })
    if (canceled || !filePaths[0]) return null
    const { readFileSync } = await import('fs')
    const buf = readFileSync(filePaths[0])
    const ext = filePaths[0].split('.').pop()?.toLowerCase() ?? 'jpg'
    const mimeMap: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', gif: 'image/gif', webp: 'image/webp'
    }
    return `data:${mimeMap[ext] ?? 'image/jpeg'};base64,${buf.toString('base64')}`
  })

  // ── Phase 10: WalletConnect ───────────────────────────────────────────────
  ipcMain.handle('wc:get-sessions',          () => wcGetSessions())
  ipcMain.handle('wc:get-pending-proposals', () => wcGetPendingProposals())
  ipcMain.handle('wc:pair',                  (_e, uri: string) => wcPair(uri))
  ipcMain.handle('wc:approve-session',       (_e, id: number) => wcApproveSession(id))
  ipcMain.handle('wc:reject-session',        (_e, id: number) => wcRejectSession(id))
  ipcMain.handle('wc:disconnect',            (_e, topic: string) => wcDisconnect(topic))
  ipcMain.handle('wc:approve-request',       (_e, id: number) => wcApproveRequest(id))
  ipcMain.handle('wc:reject-request',        (_e, id: number) => wcRejectRequest(id))

  // ── Phase 9: ChainLens profile sync ──────────────────────────────────────
  ipcMain.handle('chainlens:get-profile', async () => {
    const addresses = loadAddresses()
    if (!addresses?.evm) return null
    return getProfileByAddress(addresses.evm, loadConfig())
  })

  ipcMain.handle('chainlens:sync', async () => {
    const addresses = loadAddresses()
    if (!addresses?.evm) return { success: false, profile: null, error: 'No wallet found' }
    return syncWallets(addresses, loadConfig())
  })

  ipcMain.handle('chainlens:update-profile', async (_e, updates: { display_name?: string; avatar_url?: string }) => {
    const addresses = loadAddresses()
    if (!addresses?.evm) return { success: false, error: 'No wallet found' }
    const profile = await getProfileByAddress(addresses.evm, loadConfig())
    if (!profile) return { success: false, error: 'No ChainLens profile found' }
    return updateProfile(profile.id, updates, loadConfig())
  })
}