/**
 * background.ts — MagicMoney Extension Service Worker
 *
 * Handles all wallet operations via chrome.runtime.onMessage.
 * This is the equivalent of src/main/ipc-handlers.ts in the Electron app.
 * Private keys and mnemonics never leave this file.
 */

import { generateMnemonic, validateMnemonic, deriveAddresses, getSolanaKeypair, getBitcoinKey, getBitcoinTaprootKey, getPolkadotKey } from '../main/wallet-core'
import { signBitcoinPsbt, signBitcoinMessage, broadcastBitcoin, sendBitcoinTransaction as sendBtc, type PsbtSignRequest } from '../main/bitcoin'
import { fetchAllBalances } from '../main/balance-fetcher'
import { fetchAllHistory } from '../main/tx-history'
import { fetchMarketTop100, searchMarketCoins, fetchCoinChart } from '../main/market-fetcher'
import { fetchAllTokens, fetchAllCollectibles } from '../main/token-fetcher'
import { getSwapQuote, getSwapTokenList, getCrossSwapStatus, type SwapQuoteRequest, type SwapChain, type NormalizedSwapQuote, type CrossSwapStatusRequest } from '../main/swap-proxy'
import { executeSwap } from '../main/swap-executor'
import { ssEstimate, ssCreateExchange, ssGetStatus, type SsEstimateParams, type SsCreateParams } from '../main/simpleswap-client'
import { xEstimate, xCreateExchange, xGetStatus, type XCreateParams, type ExchangeProvider } from '../main/xchange-client'
import { estimateEvmFee, estimateSolanaFee, estimateCardanoFee, estimateTronFee, estimateDogecoinFee, estimateBitcoinFee, sendEvmTransaction, sendAgwTransaction, sendSolanaTransaction, sendCardanoTransaction, sendTronTransaction, sendDogecoinTransaction, sendBitcoinTransaction } from '../main/tx-sender'
import { resolveAccountAgw } from '../main/agw'
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
  cip30GetBalance, cip30GetUtxos, cip30GetRewardAddresses, cip30GetCollateral,
  cip30SignTx, cip30SignData, cip30SubmitTx, addressToHex,
} from './cardano-cip30'
import { alchemyRpcUrl, heliusRpcUrl } from '../main/api-proxy'

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
  chain:   'evm' | 'cardano' | 'bitcoin' | 'polkadot'
}>()

// ── web3 transaction approval queue ──────────────────────────────────────────

const _web3TxQueue = new Map<string, {
  resolve: (r: unknown) => void
  reject: (e: Error) => void
  tx: Record<string, string>
  chainId: string
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

// ── Monad RPC rotation ────────────────────────────────────────────────────────
// Monad's public RPCs each throttle under load (a chatty dApp like nad.fun blows
// past a single one's rate limit). Rotate reads across all of them and fall over
// on transport errors; sends use a viem fallback transport. Mirrors the Electron
// app (ipc-handlers.ts / tx-sender.ts).
let _monadRpcCursor = 0
function rotateMonadRpcs(list: readonly string[]): string[] {
  const start = _monadRpcCursor++ % list.length
  return [...list.slice(start), ...list.slice(0, start)]
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

// Push an EIP-1193 event to ONLY the tabs whose page matches `origin`. Used when a
// single site is revoked so other connected dApps in other tabs aren't disturbed.
function emitEthEventToOrigin(origin: string, event: string, data: unknown) {
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      if (tab.id == null || !tab.url) continue
      let tabOrigin = ''
      try { tabOrigin = new URL(tab.url).origin } catch { continue }
      if (tabOrigin === origin) {
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

// ── Abstract Global Wallet resolution ─────────────────────────────────────────
// Mirrors ipc-handlers.ts: resolve the linked AGW (manual override ?? on-chain
// linked) once and persist agwOwned so we don't re-query the resolver each read.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveAgw(addresses: any): Promise<any> {
  const override = await store.loadAgwOverride(addresses.accountIndex ?? 0)
  const { agw, agwOwned } = await resolveAccountAgw(addresses.evm, override)
  return { ...addresses, agw, agwOwned }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadFullAddresses(): Promise<any> {
  let stored = await store.loadAddresses()
  if (!stored) throw new Error('No wallet')
  // Auto-migrate wallets created before tron/dogecoin/taproot existed (re-derive fills them).
  if (!stored.tron || !stored.dogecoin || !stored.bitcoinNested || !stored.bitcoinTaproot) {
    stored = await deriveAddresses(await store.loadMnemonic(), stored.accountIndex ?? 0)
    await store.saveAddresses(stored)
  }
  if ((stored as { agwOwned?: boolean }).agwOwned === undefined) {
    stored = await resolveAgw(stored)
    await store.saveAddresses(stored)
  }
  return stored
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

    // ── Connected sites (revoke dApp access, like MetaMask/Phantom) ─────────
    case 'wallet:get-connected-sites':
      return store.getApprovedOrigins()

    case 'wallet:revoke-site': {
      const origin = String(a0 ?? '')
      if (!origin) return store.getApprovedOrigins()
      await store.removeApprovedOrigin(origin)
      // Tell any open tab on that origin it's been disconnected (MetaMask behavior).
      emitEthEventToOrigin(origin, 'accountsChanged', [])
      return store.getApprovedOrigins()
    }

    case 'wallet:revoke-all-sites': {
      const all = await store.getApprovedOrigins()
      await store.clearApprovedOrigins()
      for (const origin of all) emitEthEventToOrigin(origin, 'accountsChanged', [])
      return []
    }

    // ── Data reads ─────────────────────────────────────────────────────────

    case 'wallet:get-addresses': {
      if (!(await store.loadAddresses())) return null
      return loadFullAddresses()
    }

    case 'wallet:get-balances': {
      const addresses = await loadFullAddresses()
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
      const derived = await deriveAddresses(mnemonic, idx)
      const addresses = await resolveAgw(derived)
      await store.saveAddresses(addresses)
      return addresses
    }

    // ── Send transactions ──────────────────────────────────────────────────

    case 'wallet:estimate-fee': {
      const [chain, to, amount] = [String(a0), String(a1), String(a2)]
      const config = await store.loadConfig()
      const addresses = await loadFullAddresses()
      if (!addresses) throw new Error('No wallet')
      // Match the shared tx-sender signatures (Electron calls these the same way).
      if (chain === 'solana') return estimateSolanaFee(config)
      if (chain === 'cardano') return estimateCardanoFee(addresses.cardano ?? '', config)
      if (chain === 'tron') return estimateTronFee(to, config)
      if (chain === 'dogecoin') {
        if (!addresses.dogecoin) throw new Error('No Dogecoin address found')
        return estimateDogecoinFee(addresses.dogecoin, to, amount)
      }
      if (chain === 'bitcoin') {
        if (!addresses.bitcoin) throw new Error('No Bitcoin address found')
        return estimateBitcoinFee(addresses.bitcoin, to, amount, await store.loadMnemonic(), addresses.accountIndex ?? 0)
      }
      return estimateEvmFee(addresses.evm, to, amount, config, chain)
    }

    case 'wallet:send-evm': {
      const [chainId, to, amount] = [String(a0), String(a1), String(a2)]
      const mnemonic = await store.loadMnemonic()
      const config = await store.loadConfig()
      const addresses = await store.loadAddresses()
      return sendEvmTransaction(mnemonic, to, amount, config, chainId, addresses?.accountIndex ?? 0)
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

    case 'wallet:send-tron': {
      const mnemonic = await store.loadMnemonic()
      const config = await store.loadConfig()
      const addresses = await store.loadAddresses()
      const token = a2 as { contractAddress: string; decimals: number } | undefined
      return sendTronTransaction(mnemonic, String(a0), String(a1), config, addresses?.accountIndex ?? 0, token)
    }

    case 'wallet:send-dogecoin': {
      const addresses = await loadFullAddresses()
      if (!addresses.dogecoin) throw new Error('No Dogecoin address found')
      const mnemonic = await store.loadMnemonic()
      return sendDogecoinTransaction(mnemonic, addresses.dogecoin, String(a0), String(a1), addresses.accountIndex ?? 0)
    }

    case 'wallet:send-bitcoin': {
      const addresses = await loadFullAddresses()
      if (!addresses.bitcoin) throw new Error('No Bitcoin address found')
      const mnemonic = await store.loadMnemonic()
      return sendBitcoinTransaction(mnemonic, addresses.bitcoin, String(a0), String(a1), addresses.accountIndex ?? 0)
    }

    // ── Abstract Global Wallet: send + manual address override ──────────────
    case 'wallet:send-agw': {
      const to = String(a0)
      const amount = String(a1)
      const token = a2 as { contractAddress: string; decimals: number } | undefined
      const addresses = await loadFullAddresses()
      if (!addresses.agw) throw new Error('No Abstract Global Wallet linked for this account')
      if (!addresses.agwOwned) throw new Error('This wallet can’t sign for the linked AGW — it is watch-only')
      const mnemonic = await store.loadMnemonic()
      const config = await store.loadConfig()
      return sendAgwTransaction(mnemonic, to, amount, config, addresses.accountIndex ?? 0, { token, agwAddress: addresses.agw })
    }

    case 'wallet:set-agw': {
      const accountIndex = Number(a0)
      const address = a1 == null ? null : String(a1)
      if (accountIndex < 0 || accountIndex > 9) throw new Error('Account index must be 0–9')
      if (address != null) {
        const trimmed = address.trim()
        if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) throw new Error('Invalid Abstract address — must be a 0x… EVM address')
        await store.saveAgwOverride(accountIndex, trimmed)
      } else {
        await store.saveAgwOverride(accountIndex, null)
      }
      const current = await store.loadAddresses()
      if (current && (current.accountIndex ?? 0) === accountIndex) {
        const resolved = await resolveAgw(current)
        await store.saveAddresses(resolved)
        return resolved
      }
      return current
    }

    // ── Market ─────────────────────────────────────────────────────────────

    case 'wallet:get-market':
      return fetchMarketTop100()

    case 'wallet:search-market':
      return searchMarketCoins(String(a0))

    case 'wallet:get-coin-chart':
      return fetchCoinChart(String(a0), String(a1))

    case 'wallet:get-tokens': {
      const addresses = await loadFullAddresses()
      const config = await store.loadConfig()
      return fetchAllTokens(
        { evm: addresses.evm, solana: addresses.solana, cardano: addresses.cardano, tron: addresses.tron, agw: addresses.agw, bitcoinTaproot: addresses.bitcoinTaproot },
        config
      )
    }

    case 'wallet:get-collectibles': {
      const addresses = await loadFullAddresses()
      const config = await store.loadConfig()
      const excludeIds = Array.isArray(a0) ? (a0 as string[]) : undefined
      return fetchAllCollectibles(addresses.evm, addresses.cardano, config, addresses.solana, addresses.agw, addresses.tron, excludeIds, addresses.bitcoinTaproot)
    }

    case 'swap:getQuote': {
      const config = await store.loadConfig()
      return getSwapQuote(a0 as SwapQuoteRequest, config)
    }

    case 'swap:crossStatus': {
      const config = await store.loadConfig()
      return getCrossSwapStatus(a0 as CrossSwapStatusRequest, config)
    }

    case 'swap:execute': {
      const addresses = await store.loadAddresses()
      if (!addresses) throw new Error('No wallet')
      const config = await store.loadConfig()
      const mnemonic = await store.loadMnemonic()
      return executeSwap(a0 as NormalizedSwapQuote, mnemonic, config, addresses.accountIndex ?? 0)
    }

    case 'swap:getTokenList': {
      const config = await store.loadConfig()
      return getSwapTokenList(a0 as SwapChain, config)
    }

    case 'ss:estimate':
      return ssEstimate(a0 as SsEstimateParams, await store.loadConfig())

    case 'ss:create-exchange':
      return ssCreateExchange(a0 as SsCreateParams, await store.loadConfig())

    case 'ss:status':
      return ssGetStatus(String(a0), await store.loadConfig())

    case 'xchange:estimate':
      return xEstimate(a0 as SsEstimateParams, await store.loadConfig())

    case 'xchange:create':
      return xCreateExchange(a0 as XCreateParams, await store.loadConfig())

    case 'xchange:status':
      return xGetStatus(a0 as ExchangeProvider, String(a1), await store.loadConfig())

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
            chrome.runtime.sendMessage({ type: 'web3:connection-request', data: { id, origin: senderOrigin } }).catch(() => openApprovalPopup())
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

        case 'eth_signTypedData':
        case 'eth_signTypedData_v3':
        case 'eth_signTypedData_v4': {
          const key = await deriveEvmKey()
          const acct = privateKeyToAccount(key)
          // v3/v4: params = [address, typedData]; legacy v1: params = [typedData, address]
          const rawPayload = method === 'eth_signTypedData' ? params[0] : params[1]
          const td = typeof rawPayload === 'string' ? JSON.parse(rawPayload) : rawPayload
          const { EIP712Domain: _dom, ...types } = td.types ?? {}
          return acct.signTypedData({ domain: td.domain ?? {}, types, primaryType: td.primaryType, message: td.message })
        }

        case 'eth_sendTransaction': {
          const id = crypto.randomUUID()
          const tx = params[0] as Record<string, string>
          const txChainId = _currentChainId
          return new Promise((resolve, reject) => {
            _web3TxQueue.set(id, { resolve, reject, tx, chainId: txChainId })
            chrome.runtime.sendMessage({ type: 'web3:tx-request', data: { id, chainId: txChainId, ...tx } }).catch(() => openApprovalPopup())
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

        // Proxy all other read-only RPC calls to the current chain's endpoint.
        // Monad rotates across its public set so a chatty dApp's reads survive any
        // one endpoint throttling; other chains use their single URL.
        default: {
          const chainNum = parseInt(_currentChainId, 16) || 1
          const { EVM_CHAINS: evmCfg, MONAD_RPCS, PUBLIC_RPCS } = await import('../main/chain-config')
          const rpcCfg = await store.loadConfig()
          const chainDef = evmCfg.find(c => c.chainId === chainNum)
          // Monad rotates its public set; every other chain tries its primary first
          // then the keyless PUBLIC_RPCS fallbacks (loop fails over on transport errors).
          const urls = chainNum === 143
            ? rotateMonadRpcs(MONAD_RPCS)
            : [chainDef?.rpcUrl(rpcCfg) ?? alchemyRpcUrl('eth-mainnet', rpcCfg), ...(chainDef ? (PUBLIC_RPCS[chainDef.id] ?? []) : [])]
          const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
          let lastErr: unknown = null
          for (const url of urls) {
            let rpcRes: Response
            // Only fail over on transport errors (timeout/connection/429/5xx);
            // a valid JSON-RPC error (e.g. revert) is surfaced as-is.
            try {
              rpcRes = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
                signal: AbortSignal.timeout(8_000)
              })
            } catch (e) { lastErr = e; continue }
            if (!rpcRes.ok) { lastErr = new Error(`RPC error ${rpcRes.status}: ${method}`); continue }
            const rpcJson = await rpcRes.json().catch(() => null) as { result?: unknown; error?: { message: string; code?: number } } | null
            if (!rpcJson) { lastErr = new Error('Malformed RPC response'); continue }
            if (rpcJson.error) throw Object.assign(new Error(rpcJson.error.message), { code: rpcJson.error.code })
            return rpcJson.result
          }
          throw lastErr instanceof Error ? lastErr : new Error(`RPC failed: ${method}`)
        }
      }
    }

    // ── Bitcoin (window.unisat) dApp handlers ────────────────────────────────

    case 'bitcoin:get-accounts': {
      const btcAddrs = await store.loadAddresses()
      return btcAddrs?.bitcoin ? [btcAddrs.bitcoin] : []
    }

    case 'bitcoin:request-accounts': {
      const btcOrigin = sender?.origin ?? 'unknown'
      const btcApproved = await store.getApprovedOrigins()
      if (btcApproved.includes(btcOrigin)) {
        const btcAddrs = await store.loadAddresses()
        return btcAddrs?.bitcoin ? [btcAddrs.bitcoin] : []
      }
      const btcId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        _connectionQueue.set(btcId, { resolve, reject, origin: btcOrigin, tabId: sender?.tabId, chain: 'bitcoin' })
        chrome.runtime.sendMessage({ type: 'web3:connection-request', data: { id: btcId, origin: btcOrigin } }).catch(() => openApprovalPopup())
        setTimeout(() => {
          if (_connectionQueue.has(btcId)) {
            _connectionQueue.delete(btcId)
            reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
          }
        }, 120_000)
      })
    }

    case 'bitcoin:request-addresses': {
      const btcOrigin = sender?.origin ?? 'unknown'
      const toHex = (u: Uint8Array) => Array.from(u).map(b => b.toString(16).padStart(2, '0')).join('')
      const build = async () => {
        const a = await loadFullAddresses()
        const acct = a.accountIndex ?? 0
        const mn = await store.loadMnemonic()
        const [nat, tap] = await Promise.all([getBitcoinKey(mn, acct), getBitcoinTaprootKey(mn, acct)])
        const all = [
          { address: a.bitcoin, publicKey: toHex(nat.publicKey), purpose: 'payment', addressType: 'p2wpkh' },
          { address: a.bitcoinTaproot, publicKey: toHex(tap.publicKey.slice(1)), purpose: 'ordinals', addressType: 'p2tr' },
        ]
        const want = Array.isArray(a0) ? (a0 as string[]) : ['payment', 'ordinals']
        return { addresses: all.filter(x => want.includes(x.purpose)) }
      }
      if ((await store.getApprovedOrigins()).includes(btcOrigin)) return build()
      const reqId = crypto.randomUUID()
      await new Promise<void>((resolve, reject) => {
        _connectionQueue.set(reqId, { resolve: () => resolve(), reject, origin: btcOrigin, tabId: sender?.tabId, chain: 'bitcoin' })
        chrome.runtime.sendMessage({ type: 'web3:connection-request', data: { id: reqId, origin: btcOrigin } }).catch(() => openApprovalPopup())
        setTimeout(() => { if (_connectionQueue.has(reqId)) { _connectionQueue.delete(reqId); reject(Object.assign(new Error('User rejected the request.'), { code: 4001 })) } }, 120_000)
      })
      return build()
    }

    case 'bitcoin:get-public-key': {
      const btcMnemonic = await store.loadMnemonic()
      const btcAddrs = await store.loadAddresses()
      const { publicKey: btcPub } = await getBitcoinKey(btcMnemonic, btcAddrs?.accountIndex ?? 0)
      return Array.from(btcPub).map(b => b.toString(16).padStart(2, '0')).join('')
    }

    case 'bitcoin:get-balance': {
      const btcAddrs = await store.loadAddresses()
      if (!btcAddrs?.bitcoin) throw new Error('No Bitcoin wallet')
      const btcRes = await fetch(`https://mempool.space/api/address/${btcAddrs.bitcoin}`, { signal: AbortSignal.timeout(10_000) })
      if (!btcRes.ok) throw new Error(`mempool.space error: ${btcRes.status}`)
      const btcData = await btcRes.json() as {
        chain_stats: { funded_txo_sum: number; spent_txo_sum: number }
        mempool_stats: { funded_txo_sum: number; spent_txo_sum: number }
      }
      const confirmed   = btcData.chain_stats.funded_txo_sum   - btcData.chain_stats.spent_txo_sum
      const unconfirmed = btcData.mempool_stats.funded_txo_sum - btcData.mempool_stats.spent_txo_sum
      return { confirmed, unconfirmed, total: confirmed + unconfirmed }
    }

    case 'bitcoin:sign-message': {
      // BIP-137 over the Native-SegWit key (the old inline impl used a P2PKH header).
      const btcAddrs = await store.loadAddresses()
      return signBitcoinMessage(String(a0), 'native', await store.loadMnemonic(), btcAddrs?.accountIndex ?? 0)
    }

    case 'bitcoin:sign-psbt': {
      const btcOrigin = sender?.origin ?? 'unknown'
      if (!(await store.getApprovedOrigins()).includes(btcOrigin)) throw Object.assign(new Error('Connect the wallet before signing.'), { code: 4100 })
      const btcAddrs = await loadFullAddresses()
      const o = (a1 ?? {}) as { signInputs?: Record<string, number[]>; autoFinalized?: boolean; broadcast?: boolean }
      const req: PsbtSignRequest = { psbt: String(a0), signInputs: o.signInputs, finalize: o.autoFinalized !== false, extractTx: !!o.broadcast }
      const signed = await signBitcoinPsbt(req, await store.loadMnemonic(), btcAddrs, btcAddrs.accountIndex ?? 0)
      let txid: string | undefined
      if (o.broadcast && signed.txHex) txid = await broadcastBitcoin(signed.txHex)
      return { psbtHex: signed.psbtHex, psbtBase64: signed.psbtBase64, txid }
    }

    case 'bitcoin:push-psbt': {
      const rawTxHex = String(a0)
      const pushRes = await fetch('https://mempool.space/api/tx', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: rawTxHex,
        signal: AbortSignal.timeout(15_000)
      })
      if (!pushRes.ok) throw new Error(`Broadcast failed: ${pushRes.status}`)
      return await pushRes.text()
    }

    case 'bitcoin:send': {
      const btcOrigin = sender?.origin ?? 'unknown'
      if (!(await store.getApprovedOrigins()).includes(btcOrigin)) throw Object.assign(new Error('Connect the wallet before sending.'), { code: 4100 })
      const btcAddrs = await loadFullAddresses()
      const btcAmount = (Number(a1) / 1e8).toFixed(8)
      const res = await sendBtc(await store.loadMnemonic(), btcAddrs.bitcoin, String(a0), btcAmount, btcAddrs.accountIndex ?? 0)
      return res.txHash
    }

    // ── Polkadot (window.injectedWeb3) dApp handlers ──────────────────────────

    case 'polkadot:enable': {
      const dotOrigin = sender?.origin ?? 'unknown'
      const dotApproved = await store.getApprovedOrigins()
      if (dotApproved.includes(dotOrigin)) return true
      const dotId = crypto.randomUUID()
      return new Promise((resolve, reject) => {
        _connectionQueue.set(dotId, { resolve, reject, origin: dotOrigin, tabId: sender?.tabId, chain: 'polkadot' })
        chrome.runtime.sendMessage({ type: 'web3:connection-request', data: { id: dotId, origin: dotOrigin } }).catch(() => openApprovalPopup())
        setTimeout(() => {
          if (_connectionQueue.has(dotId)) {
            _connectionQueue.delete(dotId)
            reject(Object.assign(new Error('User rejected the request.'), { code: 4001 }))
          }
        }, 120_000)
      })
    }

    case 'polkadot:get-accounts': {
      const dotAddrs = await store.loadAddresses()
      if (!dotAddrs?.polkadot) return []
      return [{ address: dotAddrs.polkadot, name: 'MagicMoney', type: 'ed25519' }]
    }

    case 'polkadot:sign-payload': {
      const dotPayload = a0 as { method?: string; [k: string]: unknown }
      const dotMnemonic = await store.loadMnemonic()
      const dotAddrs = await store.loadAddresses()
      const { privateKey: dotPriv } = await getPolkadotKey(dotMnemonic, dotAddrs?.accountIndex ?? 0)
      const { ed25519: dotEd } = await import('@noble/curves/ed25519')
      const { blake2b: dotBlake } = await import('@noble/hashes/blake2b')
      const methodHex = (dotPayload.method ?? '').replace(/^0x/, '')
      const dataBytes = new Uint8Array((methodHex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)))
      const toSign = dataBytes.length > 256 ? dotBlake(dataBytes, { dkLen: 32 }) : dataBytes
      const sig = dotEd.sign(toSign, dotPriv)
      return { id: Math.floor(Math.random() * 0xffffff), signature: `0x${Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('')}` }
    }

    case 'polkadot:sign-raw': {
      const dotRaw = a0 as { data?: string }
      const dotMnemonic = await store.loadMnemonic()
      const dotAddrs = await store.loadAddresses()
      const { privateKey: dotPriv2 } = await getPolkadotKey(dotMnemonic, dotAddrs?.accountIndex ?? 0)
      const { ed25519: dotEd2 } = await import('@noble/curves/ed25519')
      const dataHex = (dotRaw.data ?? '').replace(/^0x/, '')
      const dataBytes = new Uint8Array((dataHex.match(/.{2}/g) ?? []).map(h => parseInt(h, 16)))
      const sig = dotEd2.sign(dataBytes, dotPriv2)
      return { id: Math.floor(Math.random() * 0xffffff), signature: `0x${Array.from(sig).map(b => b.toString(16).padStart(2, '0')).join('')}` }
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
      if (entry.chain === 'cardano' || entry.chain === 'polkadot') {
        entry.resolve(true)
      } else if (entry.chain === 'bitcoin') {
        entry.resolve(connAddresses?.bitcoin ? [connAddresses.bitcoin] : [])
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
      return [..._web3TxQueue.entries()].map(([id, { tx, chainId: c }]) => ({ id, chainId: c, ...tx }))

    case 'web3:approve-tx': {
      const { id } = a0 as { id: string; chainId?: string }
      const entry = _web3TxQueue.get(id)
      if (!entry) throw new Error('Pending transaction not found')
      _web3TxQueue.delete(id)
      const { createWalletClient, http, fallback, parseEther } = await import('viem')
      const config = await store.loadConfig()
      const { EVM_CHAINS, MONAD_RPCS, PUBLIC_RPCS } = await import('../main/chain-config')
      const numId = parseInt(entry.chainId ?? '1', 16) || 1
      const chain = EVM_CHAINS.find(c => c.chainId === numId) ?? EVM_CHAINS[0]
      const key = await deriveEvmKey()
      const acct = privateKeyToAccount(key)
      // Monad rotates its whole public set. Every other chain tries its primary
      // (proxy/Alchemy or own node) first and only fails over to the keyless
      // PUBLIC_RPCS on a transport error, so a normal broadcast still hits the proxy.
      const sendUrls = [chain.rpcUrl(config), ...(PUBLIC_RPCS[chain.id] ?? [])]
      const transport = numId === 143
        ? fallback(MONAD_RPCS.map(u => http(u, { timeout: 8_000 })))
        : sendUrls.length > 1
          ? fallback(sendUrls.map(u => http(u, { timeout: 10_000 })))
          : http(sendUrls[0])
      const wc = createWalletClient({ account: acct, transport, chain: null as unknown as undefined })
      let hash: `0x${string}`
      try {
        hash = await wc.sendTransaction({
          to: entry.tx.to as `0x${string}`,
          value: entry.tx.value ? BigInt(entry.tx.value) : undefined,
          data: entry.tx.data as `0x${string}` | undefined,
          gas: entry.tx.gas ? BigInt(entry.tx.gas) : undefined,
        })
      } catch (err) {
        // viem wraps the RPC failure as a generic "unknown RPC error". Log the FULL
        // chain (shortMessage / details / cause) to the service-worker console so the
        // real Monad reason is visible, and surface that instead of the wrapper.
        const e = err as { shortMessage?: string; details?: string; metaMessages?: string[]; cause?: { message?: string; details?: string; data?: unknown } }
        console.error('[MagicMoney] Monad send failed — full error:', err)
        console.error('[MagicMoney] shortMessage:', e.shortMessage)
        console.error('[MagicMoney] details:', e.details)
        console.error('[MagicMoney] cause:', e.cause)
        const reason = e.cause?.details || e.cause?.message || e.shortMessage || e.details || (err as Error).message || 'Transaction failed'
        const clean = new Error(reason)
        entry.reject(clean)
        throw clean
      }
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
      const addresses = await store.loadAddresses()
      const keypair = await getSolanaKeypair(mnemonic, addresses?.accountIndex ?? 0)
      // @solana/web3.js Keypair has NO .sign() method. Ed25519-sign the raw
      // message bytes with the 32-byte seed (secretKey = seed||pubkey).
      const { ed25519 } = await import('@noble/curves/ed25519')
      return Array.from(ed25519.sign(bytes, keypair.secretKey.slice(0, 32)))
    }

    case 'web3:solana:sign-and-send': {
      const input = a0 as { transaction?: number[] | Uint8Array }
      if (!input?.transaction) throw new Error('No transaction data provided')
      const txBytes = input.transaction instanceof Uint8Array ? input.transaction : new Uint8Array(input.transaction as number[])
      const solMnemonic = await store.loadMnemonic()
      const solAddresses = await store.loadAddresses()
      const solConfig = await store.loadConfig()
      const { VersionedTransaction, Connection: SolConnection } = await import('@solana/web3.js')
      const solKeypair = await getSolanaKeypair(solMnemonic, solAddresses?.accountIndex ?? 0)
      const solTx = VersionedTransaction.deserialize(txBytes)
      solTx.sign([solKeypair])
      const solConn = new SolConnection(heliusRpcUrl(solConfig), 'confirmed')
      const solSig = await solConn.sendRawTransaction(solTx.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed' })
      return { signature: solSig }
    }

    case 'web3:solana:sign-tx': {
      const txBytes = new Uint8Array(a0 as number[])
      const solMnemonic2 = await store.loadMnemonic()
      const solAddresses2 = await store.loadAddresses()
      const { VersionedTransaction: VT2 } = await import('@solana/web3.js')
      const solKeypair2 = await getSolanaKeypair(solMnemonic2, solAddresses2?.accountIndex ?? 0)
      const solTx2 = VT2.deserialize(txBytes)
      solTx2.sign([solKeypair2])
      return Array.from(solTx2.serialize())
    }

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
        chrome.runtime.sendMessage({ type: 'web3:connection-request', data: { id, origin: senderOriginCardano } }).catch(() => openApprovalPopup())
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
      return cip30GetBalance(addresses.cardano, config)
    }

    case 'cardano:get-utxos': {
      const addresses = await store.loadAddresses()
      if (!addresses?.cardano) throw new Error('No Cardano wallet')
      const config = await store.loadConfig()
      return cip30GetUtxos(addresses.cardano, config)
    }

    case 'cardano:get-collateral': {
      const addresses = await store.loadAddresses()
      if (!addresses?.cardano) throw new Error('No Cardano wallet')
      const config = await store.loadConfig()
      return cip30GetCollateral(addresses.cardano, config, a0 ? String(a0) : undefined)
    }

    case 'cardano:get-used-addresses': {
      const addresses = await store.loadAddresses()
      // CIP-30 requires hex-encoded address bytes, not bech32.
      return addresses?.cardano ? [addressToHex(addresses.cardano)] : []
    }

    case 'cardano:get-unused-addresses':
      return []

    case 'cardano:get-change-address': {
      const addresses = await store.loadAddresses()
      if (!addresses?.cardano) throw new Error('No Cardano wallet')
      return addressToHex(addresses.cardano)
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
      try {
        return await cip30SignTx(txHex, mnemonic, accountIdx)
      } catch (err) {
        throw new Error(`Could not sign this Cardano transaction — the dApp may have sent it in an unexpected format. (${err instanceof Error ? err.message : String(err)})`)
      }
    }

    case 'cardano:sign-data': {
      const [addrArg, payloadHex] = [String(a0), String(a1)]
      const mnemonic = await store.loadMnemonic()
      const addresses = await store.loadAddresses()
      const accountIdx = addresses?.accountIndex ?? 0
      const signingAddr = addrArg || addresses?.cardano || ''
      try {
        return await cip30SignData(signingAddr, payloadHex, mnemonic, accountIdx)
      } catch (err) {
        throw new Error(`Could not sign this Cardano data payload. (${err instanceof Error ? err.message : String(err)})`)
      }
    }

    case 'cardano:submit-tx': {
      const config = await store.loadConfig()
      return cip30SubmitTx(String(a0), config)
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
