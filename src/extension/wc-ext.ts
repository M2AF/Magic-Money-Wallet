/**
 * wc-ext.ts — WalletConnect v2 for the browser extension
 *
 * Adapted from src/main/wc-client.ts:
 *  - FileStorage → chrome.storage.local (no filesystem in service workers)
 *  - pushAll → chrome.runtime.sendMessage (no BrowserWindow)
 *  - loadConfig / loadAddresses / loadMnemonic → async chrome-store
 */

// WebSocket and WebCrypto are available natively in MV3 service workers — no polyfills needed

import SignClient from '@walletconnect/sign-client'
import type { SignClientTypes, SessionTypes } from '@walletconnect/types'
import { getSdkError, buildApprovedNamespaces } from '@walletconnect/utils'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { privateKeyToAccount } from 'viem/accounts'
import { loadConfig, loadAddresses, loadMnemonic } from './chrome-store'

// ── EVM chains ────────────────────────────────────────────────────────────────

const SUPPORTED_CHAIN_IDS = [1, 137, 42161, 10, 8453, 56, 43114, 250]
const SUPPORTED_METHODS = [
  'eth_sendTransaction', 'eth_signTransaction', 'personal_sign',
  'eth_sign', 'eth_signTypedData', 'eth_signTypedData_v4', 'wallet_switchEthereumChain'
]

async function getRpc(chainId: number): Promise<string> {
  const { alchemyKey } = await loadConfig()
  const alchemyMap: Record<number, string> = {
    1:     `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    137:   `https://polygon-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    42161: `https://arb-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    10:    `https://opt-mainnet.g.alchemy.com/v2/${alchemyKey}`,
    8453:  `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`
  }
  const publicMap: Record<number, string> = {
    56:    'https://bsc-dataseed.binance.org',
    43114: 'https://api.avax.network/ext/bc/C/rpc',
    250:   'https://rpc.ftm.tools'
  }
  return alchemyMap[chainId] ?? publicMap[chainId] ?? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}`
}

// ── State ─────────────────────────────────────────────────────────────────────

let _client: InstanceType<typeof SignClient> | null = null
let _initPromise: Promise<void> | null = null
const _proposals = new Map<number, SignClientTypes.EventArguments['session_proposal']>()
const _requests  = new Map<number, SignClientTypes.EventArguments['session_request']>()

function pushAll(channel: string, data: unknown) {
  chrome.runtime.sendMessage({ type: channel, data }).catch(() => {})
}

// ── Serialisers ───────────────────────────────────────────────────────────────

export interface WcSession {
  topic: string; peerName: string; peerIcon: string | null
  peerUrl: string; expiry: number; accounts: string[]
}
export interface WcProposal {
  id: number; peerName: string; peerIcon: string | null; peerUrl: string
  requiredChains: string[]; optionalChains: string[]; requiredMethods: string[]
}
export interface WcRequest {
  id: number; topic: string; peerName: string; peerIcon: string | null
  chainId: string; method: string; params: unknown[]; humanReadable: string
}

function serSession(s: SessionTypes.Struct): WcSession {
  const m = s.peer.metadata
  return {
    topic: s.topic, peerName: m.name, peerIcon: m.icons?.[0] ?? null,
    peerUrl: m.url, expiry: s.expiry,
    accounts: Object.values(s.namespaces).flatMap(ns => (ns as { accounts?: string[] }).accounts ?? [])
  }
}

function serProposal(p: SignClientTypes.EventArguments['session_proposal']): WcProposal {
  const m = p.params.proposer.metadata
  const req = p.params.requiredNamespaces ?? {}
  const opt = p.params.optionalNamespaces ?? {}
  return {
    id: p.id, peerName: m.name, peerIcon: m.icons?.[0] ?? null, peerUrl: m.url,
    requiredChains: Object.values(req).flatMap(ns => (ns as { chains?: string[] }).chains ?? []),
    optionalChains: Object.values(opt).flatMap(ns => (ns as { chains?: string[] }).chains ?? []),
    requiredMethods: Object.values(req).flatMap(ns => (ns as { methods?: string[] }).methods ?? [])
  }
}

function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)))
  return new TextDecoder().decode(bytes).slice(0, 400)
}

function humanReadable(method: string, params: unknown[]): string {
  try {
    if (method === 'personal_sign') {
      const hex = String(params[0])
      return hex.startsWith('0x') ? hexToUtf8(hex.slice(2)) : hex.slice(0, 400)
    }
    if (method === 'eth_sign') {
      const hex = String(params[1])
      return hex.startsWith('0x') ? hexToUtf8(hex.slice(2)) : hex.slice(0, 400)
    }
    if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') {
      const td = JSON.parse(String(params[1]))
      return `Sign typed data — ${td.primaryType ?? 'unknown'}`
    }
    if (method === 'eth_sendTransaction') {
      const tx = params[0] as { to?: string; value?: string; data?: string }
      const wei = tx.value ? parseInt(tx.value, 16) : 0
      const eth = (wei / 1e18).toFixed(6)
      const hasData = tx.data && tx.data !== '0x'
      return `Send ${eth} ETH to ${tx.to ? tx.to.slice(0, 10) + '…' : 'contract'}${hasData ? ' (contract call)' : ''}`
    }
    return method
  } catch { return method }
}

function serRequest(r: SignClientTypes.EventArguments['session_request']): WcRequest {
  const session = _client?.session.get(r.topic)
  const m = session?.peer.metadata
  return {
    id: r.id, topic: r.topic, peerName: m?.name ?? 'Unknown dApp',
    peerIcon: m?.icons?.[0] ?? null, chainId: r.params.chainId,
    method: r.params.request.method, params: r.params.request.params,
    humanReadable: humanReadable(r.params.request.method, r.params.request.params)
  }
}

// ── Chrome storage adapter for WC sessions ────────────────────────────────────

class ChromeStorage {
  async getKeys(): Promise<string[]> {
    const all = await chrome.storage.local.get(null)
    return Object.keys(all).filter(k => k.startsWith('wc@'))
  }
  async getEntries<T = unknown>(): Promise<[string, T][]> {
    const all = await chrome.storage.local.get(null)
    return Object.entries(all).filter(([k]) => k.startsWith('wc@')) as [string, T][]
  }
  async getItem<T = unknown>(key: string): Promise<T | undefined> {
    const r = await chrome.storage.local.get(key)
    return r[key] as T | undefined
  }
  async setItem<T = unknown>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  }
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key)
  }
}

// ── Key derivation ────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function deriveEvmKey(): Promise<`0x${string}`> {
  const mnemonic = await loadMnemonic()
  const addresses = await loadAddresses()
  const idx = addresses?.accountIndex ?? 0
  const seed = mnemonicToSeedSync(mnemonic)
  const child = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/${idx}'/0/0`)
  if (!child.privateKey) throw new Error('Key derivation failed')
  return `0x${toHex(child.privateKey)}`
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function _doInit(): Promise<void> {
  const config = await loadConfig()
  _client = await SignClient.init({
    projectId: config.walletConnectProjectId,
    storage: new ChromeStorage(),
    metadata: {
      name: 'MagicMoney Wallet',
      description: 'Multi-chain self-custody wallet by ChainLens',
      url: 'https://chainlensnft.info',
      icons: ['https://chainlensnft.info/favicon.png']
    }
  })

  _client.on('session_proposal', proposal => {
    _proposals.set(proposal.id, proposal)
    pushAll('wc:proposal', serProposal(proposal))
  })
  _client.on('session_request', request => {
    _requests.set(request.id, request)
    pushAll('wc:request', serRequest(request))
  })
  _client.on('session_delete', () => pushAll('wc:sessions-changed', wcGetSessions()))
  _client.on('session_expire', () => pushAll('wc:sessions-changed', wcGetSessions()))
}

async function ensureClient(): Promise<void> {
  if (_client) return
  if (!_initPromise) _initPromise = _doInit().catch(e => { _initPromise = null; throw e })
  await _initPromise
  if (!_client) throw new Error('WalletConnect failed to initialise')
}

export async function initWalletConnect(): Promise<void> {
  _initPromise = _doInit()
  try { await _initPromise } catch (e) { _initPromise = null; console.error('[WC] init failed:', e) }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function wcGetSessions(): WcSession[] {
  if (!_client) return []
  return _client.session.getAll().map(serSession)
}

export function wcGetPendingProposals(): WcProposal[] {
  return [..._proposals.values()].map(serProposal)
}

export function wcGetPendingRequests(): WcRequest[] {
  return [..._requests.values()].map(serRequest)
}

export async function wcPair(uri: string): Promise<void> {
  await ensureClient()
  _client!.pair({ uri }).catch(e => console.error('[WC] pair error:', e))
}

export async function wcApproveSession(proposalId: number): Promise<WcSession> {
  await ensureClient()
  if (!_client) throw new Error('WalletConnect not initialised')
  const proposal = _proposals.get(proposalId)
  if (!proposal) throw new Error('Proposal not found')
  const addresses = await loadAddresses()
  const evmAddress = addresses?.evm
  if (!evmAddress) throw new Error('No wallet address found')

  const chainIds = SUPPORTED_CHAIN_IDS.map(id => `eip155:${id}`)
  const accounts = chainIds.map(c => `${c}:${evmAddress}`)

  let namespaces: SessionTypes.Namespaces
  try {
    namespaces = buildApprovedNamespaces({
      proposal: proposal.params,
      supportedNamespaces: { eip155: { chains: chainIds, methods: SUPPORTED_METHODS, events: ['chainChanged', 'accountsChanged'], accounts } }
    })
  } catch {
    namespaces = { eip155: { chains: chainIds, methods: SUPPORTED_METHODS, events: ['chainChanged', 'accountsChanged'], accounts } }
  }

  const { topic, acknowledged } = await _client.approve({ id: proposalId, namespaces })
  await acknowledged()
  _proposals.delete(proposalId)
  pushAll('wc:sessions-changed', wcGetSessions())
  return serSession(_client.session.get(topic))
}

export async function wcRejectSession(proposalId: number): Promise<void> {
  if (!_client) throw new Error('WalletConnect not initialised')
  await _client.reject({ id: proposalId, reason: getSdkError('USER_REJECTED') })
  _proposals.delete(proposalId)
}

export async function wcDisconnect(topic: string): Promise<void> {
  if (!_client) throw new Error('WalletConnect not initialised')
  await _client.disconnect({ topic, reason: getSdkError('USER_DISCONNECTED') })
  pushAll('wc:sessions-changed', wcGetSessions())
}

export async function wcApproveRequest(requestId: number): Promise<void> {
  if (!_client) throw new Error('WalletConnect not initialised')
  const req = _requests.get(requestId)
  if (!req) throw new Error('Request not found')

  const { method, params } = req.params.request
  const key = await deriveEvmKey()
  const account = privateKeyToAccount(key)
  let result: string

  try {
    if (method === 'personal_sign') {
      result = await account.signMessage({ message: { raw: String(params[0]) as `0x${string}` } })
    } else if (method === 'eth_sign') {
      result = await account.signMessage({ message: { raw: String(params[1]) as `0x${string}` } })
    } else if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') {
      const td = JSON.parse(String(params[1]))
      const { EIP712Domain: _dom, ...types } = td.types ?? {}
      result = await account.signTypedData({ domain: td.domain ?? {}, types, primaryType: td.primaryType, message: td.message })
    } else if (method === 'eth_sendTransaction') {
      const { createWalletClient, http } = await import('viem')
      const chainId = parseInt(req.params.chainId.split(':')[1] ?? '1')
      const tx = params[0] as { to?: `0x${string}`; value?: string; data?: `0x${string}`; gas?: string }
      const wc = createWalletClient({ account, transport: http(await getRpc(chainId)) })
      result = await wc.sendTransaction({
        to: tx.to, value: tx.value ? BigInt(tx.value) : undefined,
        data: tx.data, gas: tx.gas ? BigInt(tx.gas) : undefined, chain: null
      })
    } else {
      throw new Error(`Unsupported method: ${method}`)
    }
    await _client.respond({ topic: req.topic, response: { id: req.id, jsonrpc: '2.0', result } })
  } catch (e) {
    await _client.respond({ topic: req.topic, response: { id: req.id, jsonrpc: '2.0', error: { code: 4001, message: String(e) } } })
  }
  _requests.delete(requestId)
}

export async function wcRejectRequest(requestId: number): Promise<void> {
  if (!_client) throw new Error('WalletConnect not initialised')
  const req = _requests.get(requestId)
  if (!req) throw new Error('Request not found')
  await _client.respond({ topic: req.topic, response: { id: req.id, jsonrpc: '2.0', error: getSdkError('USER_REJECTED') } })
  _requests.delete(requestId)
}
