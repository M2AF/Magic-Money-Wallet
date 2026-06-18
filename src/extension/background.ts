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

// ── Global error logging (service workers crash silently without this) ────────

self.addEventListener('error', e => console.error('[SW] uncaught error:', e.message, e.error))
self.addEventListener('unhandledrejection', e => console.error('[SW] unhandled rejection:', e.reason))

// ── In-memory pending mnemonic (lives only during the create/import flow) ────

let _pendingMnemonic: string | null = null

// ── web3 transaction approval queue ──────────────────────────────────────────

const _web3TxQueue = new Map<string, {
  resolve: (r: unknown) => void
  reject: (e: Error) => void
  tx: Record<string, string>
}>()

// ── WalletConnect startup ─────────────────────────────────────────────────────

initWalletConnect().catch(e => console.error('[WC] startup error:', e))

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handle(msg: Msg): Promise<any> {
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

      switch (method) {
        case 'eth_accounts':
        case 'eth_requestAccounts':
          if (!addresses?.evm) return []
          return [addresses.evm]

        case 'eth_chainId':
          return '0x1'

        case 'net_version':
          return '1'

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
          // Store pending — push event to popup, which shows approval UI
          const id = crypto.randomUUID()
          const tx = params[0] as Record<string, string>
          return new Promise((resolve, reject) => {
            _web3TxQueue.set(id, { resolve, reject, tx })
            // Notify popup (if open) and try to open it
            chrome.runtime.sendMessage({ type: 'web3:tx-request', data: { id, ...tx } }).catch(() => {})
            try { chrome.action.openPopup() } catch { /* not available in all versions */ }
            setTimeout(() => {
              if (_web3TxQueue.has(id)) {
                _web3TxQueue.delete(id)
                reject(new Error('Transaction timed out — open the extension to approve'))
              }
            }, 120_000)
          })
        }

        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain':
          return null

        default:
          throw new Error(`Method not supported via window.ethereum: ${method}`)
      }
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

chrome.runtime.onMessage.addListener((message: Msg, _sender, sendResponse) => {
  handle(message)
    .then(result => sendResponse({ ok: true, result }))
    .catch(err => sendResponse({ ok: false, error: String(err) }))
  return true // keep channel open for async response
})
