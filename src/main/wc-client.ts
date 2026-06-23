/**
 * wc-client.ts — WalletConnect v2 integration
 *
 * Lives in the main process so it can access the mnemonic for signing.
 * Renderer receives serialised, key-free data via IPC events.
 */

// ── Node.js 20 global polyfills — must run before WalletConnect imports ───────

// 1. WebSocket — Node 20 has no native global WebSocket
// eslint-disable-next-line @typescript-eslint/no-require-imports
if (typeof globalThis.WebSocket === 'undefined') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).WebSocket = require('ws')
}

// 2. Web Crypto — WalletConnect relay uses crypto.subtle for session encryption.
//    Node 20 has webcrypto but it may not be bound to globalThis.crypto.subtle.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _nodeCrypto = require('crypto')
if (!globalThis.crypto) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).crypto = _nodeCrypto.webcrypto
} else if (!globalThis.crypto.subtle) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis.crypto as any).subtle = _nodeCrypto.webcrypto.subtle
}

import SignClient from '@walletconnect/sign-client'
import type { SignClientTypes, SessionTypes } from '@walletconnect/types'
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { getSdkError } from '@walletconnect/utils'
import { BrowserWindow } from 'electron'
import { HDKey } from '@scure/bip32'
import { mnemonicToSeedSync } from '@scure/bip39'
import { privateKeyToAccount } from 'viem/accounts'
import nacl from 'tweetnacl'
import { loadConfig, loadMnemonic, loadAddresses } from './secure-store'
import { getSolanaKeypair } from './wallet-core'
import { alchemyRpcUrl } from './api-proxy'

// ── EVM chains we advertise support for ──────────────────────────────────────

const SUPPORTED_CHAIN_IDS = [1, 137, 42161, 10, 8453, 56, 43114, 250]
const SUPPORTED_METHODS = [
  'eth_sendTransaction',
  'eth_signTransaction',
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'wallet_switchEthereumChain'
]

// ── Solana chains ─────────────────────────────────────────────────────────────

const SOLANA_CHAINS = [
  'solana:mainnet',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZTGhw',
  'solana:devnet',
  'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
]
const SOLANA_METHODS = ['solana_signMessage', 'solana_signTransaction', 'solana_signAndSendTransaction']

// ── Base58 encode/decode ──────────────────────────────────────────────────────

const _B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

function b58Decode(s: string): Uint8Array {
  const bytes = [0]
  for (const c of s) {
    let carry = _B58.indexOf(c)
    if (carry < 0) throw new Error(`Invalid base58 char: ${c}`)
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8 }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8 }
  }
  for (const c of s) { if (c === '1') bytes.push(0); else break }
  return new Uint8Array(bytes.reverse())
}

function b58Encode(bytes: Uint8Array): string {
  const digits = [0]
  for (const byte of bytes) {
    let carry = byte
    for (let i = 0; i < digits.length; i++) { carry += digits[i] << 8; digits[i] = carry % 58; carry = Math.floor(carry / 58) }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58) }
  }
  let result = ''
  for (let i = bytes.length - 1; i >= 0 && bytes[i] === 0; i--) result += '1'
  for (let i = digits.length - 1; i >= 0; i--) result += _B58[digits[i]]
  return result
}

function decodeFlexible(s: string): Uint8Array {
  return /[+/=]/.test(s) ? Uint8Array.from(Buffer.from(s, 'base64')) : b58Decode(s)
}

// ── Alchemhy RPC map — falls back to public RPC for other chains ─────────────

function getRpc(chainId: number): string {
  const config = loadConfig()
  const alchemyNet: Record<number, string> = {
    1:     'eth-mainnet',
    137:   'polygon-mainnet',
    42161: 'arb-mainnet',
    10:    'opt-mainnet',
    8453:  'base-mainnet'
  }
  const publicMap: Record<number, string> = {
    56:    'https://bsc-dataseed.binance.org',
    43114: 'https://api.avax.network/ext/bc/C/rpc',
    250:   'https://rpc.ftm.tools'
  }
  const net = alchemyNet[chainId]
  if (net) return alchemyRpcUrl(net, config)
  return publicMap[chainId] ?? alchemyRpcUrl('eth-mainnet', config)
}

// ── State ─────────────────────────────────────────────────────────────────────

let _client: InstanceType<typeof SignClient> | null = null
let _initPromise: Promise<void> | null = null
const _proposals = new Map<number, SignClientTypes.EventArguments['session_proposal']>()
const _requests  = new Map<number, SignClientTypes.EventArguments['session_request']>()

function pushAll(channel: string, data: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    try { win.webContents.send(channel, data) } catch {}
  }
}

// ── Serialisers (strip keys, keep display data) ───────────────────────────────

export interface WcSession {
  topic: string
  peerName: string
  peerIcon: string | null
  peerUrl: string
  expiry: number
  accounts: string[]
}

export interface WcProposal {
  id: number
  peerName: string
  peerIcon: string | null
  peerUrl: string
  requiredChains: string[]
  optionalChains: string[]
  requiredMethods: string[]
}

export interface WcRequest {
  id: number
  topic: string
  peerName: string
  peerIcon: string | null
  chainId: string
  method: string
  params: unknown[]
  humanReadable: string
}

function serSession(s: SessionTypes.Struct): WcSession {
  const m = s.peer.metadata
  return {
    topic: s.topic,
    peerName: m.name,
    peerIcon: m.icons?.[0] ?? null,
    peerUrl: m.url,
    expiry: s.expiry,
    accounts: Object.values(s.namespaces).flatMap(ns =>
      (ns as { accounts?: string[] }).accounts ?? []
    )
  }
}

function serProposal(p: SignClientTypes.EventArguments['session_proposal']): WcProposal {
  const m   = p.params.proposer.metadata
  const req = p.params.requiredNamespaces ?? {}
  const opt = p.params.optionalNamespaces ?? {}
  return {
    id: p.id,
    peerName: m.name,
    peerIcon: m.icons?.[0] ?? null,
    peerUrl: m.url,
    requiredChains: Object.values(req).flatMap(ns => (ns as { chains?: string[] }).chains ?? []),
    optionalChains: Object.values(opt).flatMap(ns => (ns as { chains?: string[] }).chains ?? []),
    requiredMethods: Object.values(req).flatMap(ns => (ns as { methods?: string[] }).methods ?? [])
  }
}

function humanReadable(method: string, params: unknown[]): string {
  try {
    if (method === 'personal_sign') {
      const hex = String(params[0])
      return hex.startsWith('0x')
        ? Buffer.from(hex.slice(2), 'hex').toString('utf8').slice(0, 400)
        : hex.slice(0, 400)
    }
    if (method === 'eth_sign') {
      const hex = String(params[1])
      return hex.startsWith('0x')
        ? Buffer.from(hex.slice(2), 'hex').toString('utf8').slice(0, 400)
        : hex.slice(0, 400)
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
  } catch {
    return method
  }
}

function serRequest(r: SignClientTypes.EventArguments['session_request']): WcRequest {
  const session = _client?.session.get(r.topic)
  const m = session?.peer.metadata
  return {
    id: r.id,
    topic: r.topic,
    peerName: m?.name ?? 'Unknown dApp',
    peerIcon: m?.icons?.[0] ?? null,
    chainId: r.params.chainId,
    method: r.params.request.method,
    params: r.params.request.params,
    humanReadable: humanReadable(r.params.request.method, r.params.request.params)
  }
}

// ── Key helpers ───────────────────────────────────────────────────────────────

function deriveEvmKey(): `0x${string}` {
  const mnemonic = loadMnemonic()
  const idx = loadAddresses()?.accountIndex ?? 0
  const seed = mnemonicToSeedSync(mnemonic)
  const child = HDKey.fromMasterSeed(seed).derive(`m/44'/60'/${idx}'/0/0`)
  if (!child.privateKey) throw new Error('Key derivation failed')
  return `0x${Buffer.from(child.privateKey).toString('hex')}`
}

// ── File-based storage (replaces indexedDB which doesn't exist in Node.js) ───

class FileStorage {
  private data: Record<string, unknown> = {}
  private filePath: string

  constructor() {
    this.filePath = join(app.getPath('userData'), 'wc-sessions.json')
    if (existsSync(this.filePath)) {
      try { this.data = JSON.parse(readFileSync(this.filePath, 'utf-8')) } catch { this.data = {} }
    }
  }

  private save() {
    mkdirSync(dirname(this.filePath), { recursive: true })
    writeFileSync(this.filePath, JSON.stringify(this.data))
  }

  async getKeys(): Promise<string[]> { return Object.keys(this.data) }
  async getEntries<T = unknown>(): Promise<[string, T][]> { return Object.entries(this.data) as [string, T][] }
  async getItem<T = unknown>(key: string): Promise<T | undefined> { return this.data[key] as T | undefined }
  async setItem<T = unknown>(key: string, value: T): Promise<void> { this.data[key] = value; this.save() }
  async removeItem(key: string): Promise<void> { delete this.data[key]; this.save() }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

async function _doInit(): Promise<void> {
  const config = loadConfig()
  _client = await SignClient.init({
    projectId: config.walletConnectProjectId,
    logger: 'debug',
    storage: new FileStorage(),
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

  _client.on('session_delete', () => {
    pushAll('wc:sessions-changed', wcGetSessions())
  })

  _client.on('session_expire', () => {
    pushAll('wc:sessions-changed', wcGetSessions())
  })
}

/** Ensures the client is initialised — retries if startup failed. */
async function ensureClient(): Promise<void> {
  if (_client) return
  if (!_initPromise) _initPromise = _doInit().catch(e => { _initPromise = null; throw e })
  await _initPromise
  if (!_client) throw new Error('WalletConnect failed to initialise')
}

export async function initWalletConnect(): Promise<void> {
  _initPromise = _doInit()
  try {
    await _initPromise
  } catch (e) {
    _initPromise = null
    console.error('[WC] init failed:', e)
  }
}

// ── Public API (called by IPC handlers) ──────────────────────────────────────

export function wcGetSessions(): WcSession[] {
  if (!_client) return []
  return _client.session.getAll().map(serSession)
}

export function wcGetPendingProposals(): WcProposal[] {
  return [..._proposals.values()].map(serProposal)
}

export async function wcPair(uri: string): Promise<void> {
  await ensureClient()
  // Fire-and-forget: pair() blocks until relay ACK which can take several seconds.
  // The session_proposal event fires asynchronously — we don't need to wait.
  _client!.pair({ uri }).catch(e => console.error('[WC] pair error:', e))
}

export async function wcApproveSession(proposalId: number): Promise<WcSession> {
  await ensureClient()
  if (!_client) throw new Error('WalletConnect not initialised')
  const proposal = _proposals.get(proposalId)
  if (!proposal) throw new Error('Proposal not found')

  const addresses = loadAddresses()
  const reqNs = proposal.params.requiredNamespaces ?? {}
  const optNs = proposal.params.optionalNamespaces ?? {}
  const namespaces: SessionTypes.Namespaces = {}

  if (reqNs.eip155 || optNs.eip155) {
    const chains  = [...new Set([...(reqNs.eip155?.chains ?? []), ...(optNs.eip155?.chains ?? [])])]
    const methods = [...new Set([...(reqNs.eip155?.methods ?? []), ...(optNs.eip155?.methods ?? []), ...SUPPORTED_METHODS])]
    const events  = [...new Set([...(reqNs.eip155?.events  ?? []), ...(optNs.eip155?.events  ?? []), 'chainChanged', 'accountsChanged'])]
    const evmAddr = addresses?.evm ?? ''
    namespaces.eip155 = { chains, methods, events, accounts: chains.map(c => `${c}:${evmAddr}`) }
  }

  if (reqNs.solana || optNs.solana) {
    const chains  = [...new Set([...(reqNs.solana?.chains ?? []), ...(optNs.solana?.chains ?? [])])]
    const methods = [...new Set([...(reqNs.solana?.methods ?? []), ...(optNs.solana?.methods ?? []), ...SOLANA_METHODS])]
    const events  = [...new Set([...(reqNs.solana?.events  ?? []), ...(optNs.solana?.events  ?? [])])]
    const solAddr = addresses?.solana ?? ''
    namespaces.solana = { chains, methods, events, accounts: chains.map(c => `${c}:${solAddr}`) }
  }

  if (Object.keys(namespaces).length === 0) {
    throw new Error('No supported namespaces in this proposal')
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

  try {
    // ── Solana requests ────────────────────────────────────────────────────
    if (req.params.chainId.startsWith('solana:')) {
      const mnemonic = loadMnemonic()
      const addresses = loadAddresses()
      const keypair = await getSolanaKeypair(mnemonic, addresses?.accountIndex ?? 0)

      if (method === 'solana_signMessage') {
        const p = (Array.isArray(params) ? params[0] : params) as { message: string; pubkey?: string }
        const msgBytes = decodeFlexible(p.message)
        const sigBytes = nacl.sign.detached(msgBytes, keypair.secretKey)
        await _client.respond({ topic: req.topic, response: { id: req.id, jsonrpc: '2.0', result: { signature: b58Encode(sigBytes) } } })
      } else if (method === 'solana_signTransaction' || method === 'solana_signAndSendTransaction') {
        throw new Error('Solana transaction signing via WalletConnect is not yet supported. Use the wallet send screen.')
      } else {
        throw new Error(`Unsupported Solana method: ${method}`)
      }
      _requests.delete(requestId)
      return
    }

    // ── EVM requests ───────────────────────────────────────────────────────
    const key = deriveEvmKey()
    const account = privateKeyToAccount(key)
    let result: string

    if (method === 'personal_sign') {
      const raw = String(params[0]) as `0x${string}`
      result = await account.signMessage({ message: { raw } })
    } else if (method === 'eth_sign') {
      const raw = String(params[1]) as `0x${string}`
      result = await account.signMessage({ message: { raw } })
    } else if (method === 'eth_signTypedData_v4' || method === 'eth_signTypedData') {
      const td = JSON.parse(String(params[1]))
      const { EIP712Domain: _dom, ...types } = td.types ?? {}
      result = await account.signTypedData({ domain: td.domain ?? {}, types, primaryType: td.primaryType, message: td.message })
    } else if (method === 'eth_sendTransaction') {
      const { createWalletClient, http } = await import('viem')
      const chainId = parseInt(req.params.chainId.split(':')[1] ?? '1')
      const tx = params[0] as { to?: `0x${string}`; value?: string; data?: `0x${string}`; gas?: string }
      const walletClient = createWalletClient({ account, transport: http(getRpc(chainId)) })
      result = await walletClient.sendTransaction({
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
  await _client.respond({
    topic: req.topic,
    response: { id: req.id, jsonrpc: '2.0', error: getSdkError('USER_REJECTED') }
  })
  _requests.delete(requestId)
}
