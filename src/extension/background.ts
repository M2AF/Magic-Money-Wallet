/**
 * background.ts — MagicMoney Extension Service Worker
 *
 * Handles all wallet operations via chrome.runtime.onMessage.
 * This is the equivalent of src/main/ipc-handlers.ts in the Electron app.
 * Private keys and mnemonics never leave this file.
 */

import { generateMnemonic, validateMnemonic, deriveAddresses, getSolanaKeypair } from '../main/wallet-core'
import { fetchAllBalances } from '../main/balance-fetcher'
import { fetchAllHistory } from '../main/tx-history'
import { fetchMarketTop100, searchMarketCoins, fetchCoinChart } from '../main/market-fetcher'
import { fetchAllTokens, fetchAllCollectibles } from '../main/token-fetcher'
import { estimateEvmFee, estimateSolanaFee, estimateCardanoFee, sendEvmTransaction, sendSolanaTransaction, sendCardanoTransaction } from '../main/tx-sender'
import { syncWallets, getProfileByAddress, updateProfile } from '../main/supabase-sync'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { privateKeyToAccount } from 'viem/accounts'
import * as store from './chrome-store'
import {
  initWalletConnect, wcGetSessions, wcGetPendingProposals, wcGetPendingRequests,
  wcPair, wcApproveSession, wcRejectSession,
  wcDisconnect, wcApproveRequest, wcRejectRequest
} from './wc-ext'
import {
  cip30GetBalance, cip30GetUtxos, cip30GetRewardAddresses,
  cip30SignTx, cip30SignData, cip30SubmitTx,
} from './cardano-cip30'

// ── Global error logging (service workers crash silently without this) ────────

self.addEventListener('error', e => console.error('[SW] uncaught error:', e.message, e.error))
self.addEventListener('unhandledrejection', e => console.error('[SW] unhandled rejection:', e.reason))

// ── In-memory pending mnemonic (lives only during the create/import flow) ────

let _pendingMnemonic: string | null = null

// ── Current chain (updated by wallet_switchEthereumChain) ────────────────────

let _currentChainId = '0x1'

// ── dApp connection approval queue ───────────────────────────────────────────

const _connectionQueue = new Map<string, {
  resolve: (value: unknown) => void
  reject:  (e: Error) => void
  origin:  string
  tabId:   number | undefined
  chain:   'evm' | 'cardano'
}>()

// ── web3 transaction approval queue ──────────────────────────────────────────

const _web3TxQueue = new Map<string, {
  resolve: (r: unknown) => void
  reject: (e: Error) => void
  tx: Record<string, string>
}>()

// ── Approval popup (works from service worker — no user gesture required) ────
// chrome.action.openPopup() requires a user gesture and silently fails in MV3
// service workers. chrome.windows.create() has no such restriction.

let _approvalWindowId: number | null = null

function openApprovalPopup(): void {
  if (_approvalWindowId !== null) {
    // Popup already open — just focus it
    chrome.windows.update(_approvalWindowId, { focused: true }).catch(() => {
      _approvalWindowId = null
      openApprovalPopup()  // window was closed, open a new one
    })
    return
  }
  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 380,
    height: 620,
    focused: true
  }, (win) => {
    if (!win?.id) return
    _approvalWindowId = win.id
    chrome.windows.onRemoved.addListener(function onClosed(id) {
      if (id === _approvalWindowId) {
        _approvalWindowId = null
        chrome.windows.onRemoved.removeListener(onClosed)
      }
    })
  })
}

// ── WalletConnect startup ─────────────────────────────────────────────────────

initWalletConnect().catch(e => console.error('[WC] startup error:', e))

// ── Push EIP-1193 events to all tabs ─────────────────────────────────────────

function broadcastEthEvent(event: string, data: unknown) {
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: 'eth:event', event, data }).catch(() => {})
      }
    }
  })
}

// ── EVM key helper ────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function deriveEvmKey(): Promise<`0x${string}`> {
  const mnemonic = await store.loadMnemonic()
  const addresses = await store.loadAddresses()
  const idx = addresses?.accountIndex ?? 0
  const seed = mnemonicToSeedSync(mnemonic)
  const child = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/${idx}'/0/0`)
  if (!child.privateKey) throw new Error('Key derivation failed')
  return `0x${toHex(child.privateKey)}` as `0x${string}`
}

// ── Message router ────────────────────────────────────────────────────────────

type Msg = { type: string; args: unknown[] }
type Sender = { origin: string; tabId?: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handle(msg: Msg, sender?: Sender): Promise<any> {
  const [a0, a1, a2] = msg.args ?? []

  switch (msg.type) {

    // ── Wallet lifecycle ───────────────────────────────────────────────────

    case 'wallet:is-setup':
      return store.walletExists()

    case 'wallet:is-unlocked':
      return store.isUnlocked()

    case 'wallet:unlock': {
      await store.unlock(String(a0))
      return true
    }

    case 'wallet:lock':
      await store.lock()
      return true

    case 'wallet:generate': {
      const words = generateMnemonic()
      _pendingMnemonic = words.join(' ')
      return words
    }

    case 'wallet:validate':
      return validateMnemonic(String(a0))

    case 'wallet:confirm-backup': {
      if (!_pendingMnemonic) throw new Error('No pending wallet — start over')
      const addresses = await deriveAddresses(_pendingMnemonic, 0)
      await store.saveAddresses(addresses)
      return addresses
    }

    case 'wallet:set-password': {
      const password = String(a0)
      if (!_pendingMnemonic) throw new Error('No pending wallet — start over')
      await store.saveMnemonic(_pendingMnemonic, password)
      _pendingMnemonic = null
      return true
    }

    case 'wallet:import': {
      const mnemonic = String(a0)
      if (!validateMnemonic(mnemonic)) throw new Error('Invalid mnemonic phrase')
      const addresses = await deriveAddresses(mnemonic, 0)
      await store.saveAddresses(addresses)
      _pendingMnemonic = mnemonic
      return addresses
    }

    case 'wallet:delete': {
      await store.deleteWallet()
      return true
    }

    // ── Data reads ─────────────────────────────────────────────────────────

    case 'wallet:get-addresses':
      return store.loadAddresses()

    case 'wallet:get-balances': {
      const addresses = await store.loadAddresses()
      if (!addresses) throw new Error('No wallet')
      const config = await store.loadConfig()
      return fetchAllBalances(addresses, config)
    }

    case 'wallet:reveal-seed': {
      const mnemonic = await store.loadMnemonic()
      return mnemonic.split(' ')
    }

    case 'wallet:get-history': {
      const addresses = await store.loadAddresses()
      if (!addresses) throw new Error('No wallet')
      const config = await store.loadConfig()
      return fetchAllHistory(addresses, config)
    }

    case 'wallet:get-account': {
      const addresses = await store.loadAddresses()
      return addresses?.accountIndex ?? 0
    }

    case 'wallet:set-account': {
      const idx = Number(a0)
      const mnemonic = await store.loadMnemonic()
      const addresses = await deriveAddresses(mnemonic, idx)
      await store.saveAddresses(addresses)
      return addresses
    }

    // ── Send transactions ──────────────────────────────────────────────────

    case 'wallet:estimate-fee': {
      const [chain, to, amount] = [String(a0), String(a1), String(a2)]
      const config = await store.loadConfig()
      const addresses = await store.loadAddresses()
      if (!addresses) throw new Error('No wallet')
      if (chain === 'solana') return estimateSolanaFee(addresses.solana, to, amount, config)
      if (chain === 'cardano') return estimateCardanoFee(addresses.cardano, to, amount, config)
      return estimateEvmFee(chain, addresses.evm, to, amount, config)
    }

    case 'wallet:send-evm': {
      const [chainId, to, amount] = [String(a0), String(a1), String(a2)]
      const pk = await deriveEvmKey()
      const config = await store.loadConfig()
      return sendEvmTransaction(chainId, pk, to, amount, config)
    }

    case 'wallet:send-solana': {
      const mnemonic = await store.loadMnemonic()
      const config = await store.loadConfig()
      return sendSolanaTransaction(mnemonic, String(a0), String(a1), config)
    }

    case 'wallet:send-cardano': {
      const addresses = await store.loadAddresses()
      const config = await store.loadConfig()
      if (!addresses) throw new Error('No wallet')
      const mnemonic = await store.loadMnemonic()
      return sendCardanoTransaction(mnemonic, addresses.cardano, String(a0), String(a1), config)
    }

    // ── Market ─────────────────────────────────────────────────────────────

    case 'wallet:get-market':
      return fetchMarketTop100()

    case 'wallet:search-market':
      return searchMarketCoins(String(a0))

    case 'wallet:get-coin-chart':
      return fetchCoinChart(String(a0), String(a1))

    case 'wallet:get-tokens': {
      const addresses = await store.loadAddresses()
      if (!addresses) throw new Error('No wallet')
      const config = await store.loadConfig()
      return fetchAllTokens(addresses, config)
    }

    case 'wallet:get-collectibles': {
      const addresses = await store.loadAddresses()
      if (!addresses) throw new Error('No wallet')
      const config = await store.loadConfig()
      return fetchAllCollectibles(addresses.evm, addresses.cardano, config)
    }

    case 'wallet:get-nft-floor':
      return { floor: null, currency: 'ETH', floorUsd: null }

    // ── ChainLens profile ──────────────────────────────────────────────────

    case 'chainlens:get-profile': {
      const addresses = await store.loadAddresses()
      if (!addresses) return null
      const config = await store.loadConfig()
      return getProfileByAddress(addresses.evm, config)
    }

    case 'chainlens:sync': {
      const addresses = await store.loadAddresses()
      if (!addresses) return { success: false, profile: null, error: 'No wallet' }
      const config = await store.loadConfig()
      return syncWallets(addresses, config)
    }

    case 'chainlens:update-profile': {
      const updates = a0 as { display_name?: string; avatar_url?: string }
      const addresses = await store.loadAddresses()
      if (!addresses) return { success: false, error: 'No wallet' }
      const config = await store.loadConfig()
      return updateProfile(addresses.evm, updates, config)
    }

    // Extension can't open native file dialog — avatar picking not supported
    case 'chainlens:pick-avatar':
      return null

    // ── WalletConnect ──────────────────────────────────────────────────────

    case 'wc:get-sessions':          return wcGetSessions()
    case 'wc:get-pending-proposals': return wcGetPendingProposals()
    case 'wc:get-pending-requests':  return wcGetPendingRequests()
    case 'wc:pair':                 return wcPair(String(a0))
    case 'wc:approve-session':      return wcApproveSession(Number(a0))
    case 'wc:reject-session':       return wcRejectSession(Number(a0))
    case 'wc:disconnect':           return wcDisconnect(String(a0))
    case 'wc:approve-request':      return wcApproveRequest(Number(a0))
    case 'wc:reject-request':       return wcRejectRequest(Number(a0))

    // ── window.ethereum provider requests (from content.ts injection) ────

    case 'web3:request': {
      const { method, params = [] } = (a0 as { method: string; params?: unknown[] })
      const addresses = await store.loadAddresses()
      const senderOrigin = sender?.origin ?? 'unknown'

      switch (method) {

        // Passive check — return [] if not yet approved (no prompt)
        case 'eth_accounts': {
          const approved = await store.getApprovedOrigins()
          if (!approved.includes(senderOrigin)) return []
          return addresses?.evm ? [addresses.evm] : []
        }

        // Active request — show approval prompt if not yet connected
        case 'eth_requestAccounts': {
          const approved = await store.getApprovedOrigins()
          if (approved.includes(senderOrigin)) {
            return addresses?.evm ? [addresses.evm] : []
          }
          // Queue approval — open popup and wait for user decision
          const id = crypto.randomUUID()
          return new Promise<string[]>((resolve, reject) => {
            _connectionQueue.set(id, { resolve, reject, origin: senderOrigin, tabId: sender?.tabId, chain: 'evm' })
            chrome.runtime.sendMessage({ type: 'web3:connection-request', data: { id, origin: senderOrigin } }).catch(() => {})
            openApprovalPopup()
            setTimeout(() => {
              if (_connectionQueue.has(id)) {
                _connectionQueue.delete(id)
                reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
              }
            }, 120_000)
          })
        }

        case 'eth_chainId':
          return _currentChainId

        case 'net_version':
          return String(parseInt(_currentChainId, 16))

        case 'personal_sign': {
          const key = await deriveEvmKey()
          const acct = privateKeyToAccount(key)
          return acct.signMessage({ message: { raw: String(params[0]) as `0x${string}` } })
        }

        case 'eth_sign': {
          const key = await deriveEvmKey()
          const acct = privateKeyToAccount(key)
          return acct.signMessage({ message: { raw: String(params[1]) as `0x${string}` } })
        }

        case 'eth_signTypedData_v4':
        case 'eth_signTypedData': {
          const key = await deriveEvmKey()
          const acct = privateKeyToAccount(key)
          const td = JSON.parse(String(params[1]))
          const { EIP712Domain: _dom, ...types } = td.types ?? {}
          return acct.signTypedData({ domain: td.domain ?? {}, types, primaryType: td.primaryType, message: td.message })
        }

        case 'eth_sendTransaction': {
          const id = crypto.randomUUID()
          const tx = params[0] as Record<string, string>
          return new Promise((resolve, reject) => {
            _web3TxQueue.set(id, { resolve, reject, tx })
            chrome.runtime.sendMessage({ type: 'web3:tx-request', data: { id, ...tx } }).catch(() => {})
            openApprovalPopup()
            setTimeout(() => {
              if (_web3TxQueue.has(id)) {
                _web3TxQueue.delete(id)
                reject(new Error('Transaction timed out — open the extension to approve'))
              }
            }, 120_000)
          })
        }

        // Switch to a different chain — update state and fire chainChanged to all tabs
        case 'wallet_switchEthereumChain': {
          const chainId = (params[0] as { chainId?: string })?.chainId
          if (chainId) {
            _currentChainId = chainId
            broadcastEthEvent('chainChanged', chainId)
          }
          return null
        }

        case 'wallet_addEthereumChain':
          return null

        // EIP-2255 permissions
        case 'wallet_requestPermissions': {
          // Treat like eth_requestAccounts — prompt if not already approved
          const approvedPerms = await store.getApprovedOrigins()
          if (!approvedPerms.includes(senderOrigin)) {
            await handle({ type: 'web3:request', args: [{ method: 'eth_requestAccounts', params: [] }] }, sender)
          }
          return [{ parentCapability: 'eth_accounts', caveats: [] }]
        }

        case 'wallet_getPermissions': {
          const approvedPerms = await store.getApprovedOrigins()
          if (!approvedPerms.includes(senderOrigin)) return []
          return [{ parentCapability: 'eth_accounts', caveats: [] }]
        }

        case 'wallet_revokePermissions': {
          await store.removeApprovedOrigin(senderOrigin)
          broadcastEthEvent('accountsChanged', [])
          return null
        }

        default:
          throw new Error(`Method not supported via window.ethereum: ${method}`)
      }
    }

    // ── dApp connection approval ───────────────────────────────────────────────

    case 'web3:get-pending-connections':
      return [..._connectionQueue.entries()].map(([id, { origin }]) => ({ id, origin }))

    case 'web3:approve-connection': {
      const { id } = a0 as { id: string }
      const entry = _connectionQueue.get(id)
      if (!entry) throw new Error('Connection request not found')
      _connectionQueue.delete(id)
      const connAddresses = await store.loadAddresses()
      await store.addApprovedOrigin(entry.origin)
      if (entry.chain === 'cardano') {
        entry.resolve(true)
      } else {
        const addrs = connAddresses?.evm ? [connAddresses.evm] : []
        entry.resolve(addrs)
        if (entry.tabId != null) {
          chrome.tabs.sendMessage(entry.tabId, { type: 'eth:event', event: 'connect',         data: { chainId: _currentChainId } }).catch(() => {})
          chrome.tabs.sendMessage(entry.tabId, { type: 'eth:event', event: 'accountsChanged', data: addrs }).catch(() => {})
        }
      }
      return true
    }

    case 'web3:reject-connection': {
      const { id } = a0 as { id: string }
      const entry = _connectionQueue.get(id)
      if (entry) {
        entry.reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
        _connectionQueue.delete(id)
      }
      return true
    }

    case 'web3:get-pending-tx':
      return [..._web3TxQueue.entries()].map(([id, { tx }]) => ({ id, ...tx }))

    case 'web3:approve-tx': {
      const { id, chainId } = a0 as { id: string; chainId?: string }
      const entry = _web3TxQueue.get(id)
      if (!entry) throw new Error('Pending transaction not found')
      _web3TxQueue.delete(id)
      const { createWalletClient, http, parseEther } = await import('viem')
      const config = await store.loadConfig()
      const { EVM_CHAINS } = await import('../main/chain-config')
      const numId = parseInt(chainId ?? '1')
      const chain = Object.values(EVM_CHAINS).find(c => c.chainId === numId) ?? EVM_CHAINS[0]
      const key = await deriveEvmKey()
      const acct = privateKeyToAccount(key)
      const wc = createWalletClient({ account: acct, transport: http(chain.rpcUrl(config)), chain: null as unknown as undefined })
      const hash = await wc.sendTransaction({
        to: entry.tx.to as `0x${string}`,
        value: entry.tx.value ? BigInt(entry.tx.value) : undefined,
        data: entry.tx.data as `0x${string}` | undefined,
        gas: entry.tx.gas ? BigInt(entry.tx.gas) : undefined,
      })
      entry.resolve(hash)
      return hash
    }

    case 'web3:reject-tx': {
      const id = String(a0)
      const entry = _web3TxQueue.get(id)
      if (entry) { entry.reject(new Error('User rejected the transaction')); _web3TxQueue.delete(id) }
      return true
    }

    // ── window.solana provider requests ───────────────────────────────────

    case 'web3:solana:connect': {
      const addresses = await store.loadAddresses()
      if (!addresses?.solana) throw new Error('No Solana wallet')
      return addresses.solana
    }

    case 'web3:solana:sign': {
      const bytes = new Uint8Array(a0 as number[])
      const mnemonic = await store.loadMnemonic()
      const keypair = await getSolanaKeypair(mnemonic)
      return Array.from(keypair.sign(bytes))
    }

    case 'web3:solana:sign-and-send':
      throw new Error('Solana transaction signing not yet implemented — use the wallet send screen')

    case 'web3:solana:sign-tx':
      throw new Error('Solana transaction signing not yet implemented — use the wallet send screen')

    // ── CIP-30 Cardano dApp connectivity ──────────────────────────────────

    case 'cardano:is-enabled': {
      const approvedCardano = await store.getApprovedOrigins()
      return approvedCardano.includes(sender?.origin ?? 'unknown')
    }

    case 'cardano:enable': {
      const senderOriginCardano = sender?.origin ?? 'unknown'
      const approvedCardanoOrigins = await store.getApprovedOrigins()
      if (approvedCardanoOrigins.includes(senderOriginCardano)) return true
      const id = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        _connectionQueue.set(id, { resolve, reject, origin: senderOriginCardano, tabId: sender?.tabId, chain: 'cardano' })
        chrome.runtime.sendMessage({ type: 'web3:connection-request', data: { id, origin: senderOriginCardano } }).catch(() => {})
        openApprovalPopup()
        setTimeout(() => {
          if (_connectionQueue.has(id)) {
            _connectionQueue.delete(id)
            reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
          }
        }, 120_000)
      })
    }

    case 'cardano:get-network-id':
      return 1 // mainnet

    case 'cardano:get-balance': {
      const addresses = await store.loadAddresses()
      if (!addresses?.cardano) throw new Error('No Cardano wallet')
      const config = await store.loadConfig()
      return cip30GetBalance(addresses.cardano, config.blockfrostKey ?? '')
    }

    case 'cardano:get-utxos': {
      const addresses = await store.loadAddresses()
      if (!addresses?.cardano) throw new Error('No Cardano wallet')
      const config = await store.loadConfig()
      return cip30GetUtxos(addresses.cardano, config.blockfrostKey ?? '')
    }

    case 'cardano:get-used-addresses': {
      const addresses = await store.loadAddresses()
      return addresses?.cardano ? [addresses.cardano] : []
    }

    case 'cardano:get-unused-addresses':
      return []

    case 'cardano:get-change-address': {
      const addresses = await store.loadAddresses()
      if (!addresses?.cardano) throw new Error('No Cardano wallet')
      return addresses.cardano
    }

    case 'cardano:get-reward-addresses': {
      const mnemonic = await store.loadMnemonic()
      const addresses = await store.loadAddresses()
      const accountIdx = addresses?.accountIndex ?? 0
      return cip30GetRewardAddresses(mnemonic, accountIdx)
    }

    case 'cardano:sign-tx': {
      const [txHex, _partial] = [String(a0), Boolean(a1)]
      const mnemonic = await store.loadMnemonic()
      const addresses = await store.loadAddresses()
      const accountIdx = addresses?.accountIndex ?? 0
      return cip30SignTx(txHex, mnemonic, accountIdx)
    }

    case 'cardano:sign-data': {
      const [addrArg, payloadHex] = [String(a0), String(a1)]
      const mnemonic = await store.loadMnemonic()
      const addresses = await store.loadAddresses()
      const accountIdx = addresses?.accountIndex ?? 0
      const signingAddr = addrArg || addresses?.cardano || ''
      return cip30SignData(signingAddr, payloadHex, mnemonic, accountIdx)
    }

    case 'cardano:submit-tx': {
      const config = await store.loadConfig()
      return cip30SubmitTx(String(a0), config.blockfrostKey ?? '')
    }

    // ── Side panel ────────────────────────────────────────────────────────

    case 'sidePanel:open': {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const windowId = tabs[0]?.windowId
      if (windowId !== undefined) await (chrome.sidePanel as any).open({ windowId })
      return true
    }

    case 'sidePanel:close': {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
      const tabId = tabs[0]?.id
      if (tabId !== undefined) {
        await (chrome.sidePanel as any).setOptions({ tabId, enabled: false })
        // Re-enable after close so the user can reopen it later
        setTimeout(() => {
          (chrome.sidePanel as any).setOptions({ tabId, enabled: true }).catch(() => {})
        }, 600)
      }
      return true
    }

    // ── Window controls (no-op in extension) ──────────────────────────────
    case 'window:minimize':
    case 'window:close':
      return

    default:
      throw new Error(`Unknown message type: ${msg.type}`)
  }
}

// ── Message listener ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: Msg, rawSender, sendResponse) => {
  const senderOrigin = rawSender.origin
    ?? (rawSender.url ? (() => { try { return new URL(rawSender.url!).origin } catch { return 'unknown' } })() : 'extension')
  const sender: Sender = { origin: senderOrigin, tabId: rawSender.tab?.id }
  handle(message, sender)
    .then(result => sendResponse({ ok: true, result }))
    .catch(err => sendResponse({ ok: false, error: String(err) }))
  return true // keep channel open for async response
})
