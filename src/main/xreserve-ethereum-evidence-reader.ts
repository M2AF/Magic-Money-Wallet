/**
 * xreserve-ethereum-evidence-reader.ts — read-only Ethereum MAINNET evidence
 * for ONE known xReserve source transaction, in the exact shape
 * `verifyXReserveEthereumDeposit` / `linkXReserveSourceToAttestation` accept.
 *
 * WHAT IT READS, in order, all from ONE endpoint (a "snapshot"):
 *   1. eth_chainId                                  — must be 0x1
 *   2. eth_getTransactionByHash(hash)               — null stays null
 *   3. eth_getTransactionReceipt(hash)              — null stays null
 *   4. eth_getBlockByNumber(receipt.blockNumber, false), only for a mined receipt
 *   5. eth_blockNumber                              — the tip
 *
 * ONE ENDPOINT PER SNAPSHOT. A transaction from one node paired with a receipt
 * or block from another can describe two different forks, so reads are never
 * mixed: if any read on an endpoint fails, the WHOLE snapshot restarts from
 * eth_chainId on the next endpoint. Endpoints, in priority order: the wallet's
 * Alchemy/proxy read endpoint (when available), then the configured public
 * mainnet RPCs (PUBLIC_RPCS.ethereum). Mainnet only — the testnet flag is
 * irrelevant here because Circle's xReserve deposit is a mainnet contract.
 *
 * NULL vs FAILURE. A well-formed JSON-RPC `result: null` is the node's own
 * answer ("unknown transaction" / "not mined yet") and is returned as null.
 * An RPC error, malformed envelope, HTTP failure, timeout or absent `result`
 * is a provider fault: it fails that endpoint and is NEVER turned into "not
 * found" or an empty receipt. When every endpoint fails, an
 * `EthereumEvidenceError` is thrown carrying only endpoint labels, methods,
 * HTTP statuses and JSON-RPC error codes — never a URL, client tag, API key or
 * a provider/thrown error message (which could echo any of those).
 *
 * WHAT IS CHECKED HERE vs IN THE VERIFIER. This reader validates envelopes,
 * value shapes and the identity bindings of the snapshot (the transaction and
 * receipt are for the requested hash; the block is the receipt's block; a
 * receipt never appears without its transaction). Everything about whether the
 * deposit is the approved one — sender, calldata, event, status, depth — is
 * the verifier's job, and its evidence consistency checks still run.
 *
 * No signing, no submission, no polling loop: one call = one snapshot.
 * Electron's main process should pass its Chromium `net.fetch` as `fetchFn`
 * (Node's fetch can hang there), as swap-proxy.ts does.
 */

import { alchemyRpcUrl, canAlchemy, proxyBase, proxyHeaders } from './api-proxy'
import { PUBLIC_RPCS, TESTNET_PUBLIC_RPCS } from './chain-config'
import { xreserveNetwork, type XReserveNetwork } from './xreserve-network'
import type { WalletConfig } from './secure-store'
import type { EthereumDepositEvidence } from './xreserve-ethereum-deposit-proof'

export type EvidenceFetchFn = (url: string, init?: RequestInit) => Promise<Response>

export type EvidenceMethod =
  | 'eth_chainId' | 'eth_getTransactionByHash' | 'eth_getTransactionReceipt'
  | 'eth_getBlockByNumber' | 'eth_blockNumber'

/** Why one endpoint's snapshot was abandoned. */
export type EndpointFaultKind =
  /** Non-2xx HTTP status. */
  | 'http'
  /** The request did not complete within the timeout. */
  | 'timeout'
  /** The transport threw (DNS, TLS, reset, …). */
  | 'network'
  /** The node answered with a JSON-RPC error object. */
  | 'rpc-error'
  /** The body is not a well-formed JSON-RPC 2.0 response to this request. */
  | 'malformed'
  /** The envelope has no `result` (or null where null is not a valid answer). */
  | 'missing-result'
  /** eth_chainId is not Ethereum mainnet. */
  | 'wrong-chain'
  /** The answers contradict each other or the requested hash. */
  | 'inconsistent'

export interface EndpointFault {
  /** 'wallet-rpc' or 'public-rpc-<n>' — never the URL. */
  endpoint: string
  /** The read that failed; null only for an unexpected internal failure. */
  method: EvidenceMethod | null
  kind: EndpointFaultKind
  /** HTTP status, for kind 'http'. */
  status?: number
  /** JSON-RPC error code, for kind 'rpc-error'. */
  rpcCode?: number
}

export type EvidenceErrorKind =
  /** The source hash is not a 32-byte hex hash. No request was made. */
  | 'invalid-input'
  /** The configuration yields no Ethereum endpoint. No request was made. */
  | 'no-endpoint'
  /** Every endpoint failed; see `attempts`. */
  | 'unavailable'

export class EthereumEvidenceError extends Error {
  readonly kind: EvidenceErrorKind
  readonly attempts: EndpointFault[]
  constructor(kind: EvidenceErrorKind, message: string, attempts: EndpointFault[] = []) {
    super(message)
    this.name = 'EthereumEvidenceError'
    this.kind = kind
    this.attempts = attempts
  }
}

export interface EvidenceEndpoint {
  label: string
  url: string
  headers: Record<string, string>
}

export interface EvidenceSnapshot {
  /** The lower-cased hash every read was made for. */
  sourceTxHash: string
  evidence: EthereumDepositEvidence
  /** Label of the single endpoint that produced the whole snapshot. */
  endpoint: string
  /** Endpoints abandoned before it, in order. */
  failedAttempts: EndpointFault[]
}

export interface ReadEvidenceOptions {
  fetchFn?: EvidenceFetchFn
  /** Per-request timeout; clamped to [100, 30 000] ms. Default 10 000. */
  timeoutMs?: number
  /** Override the endpoint list (tests). Defaults to `ethereumEvidenceEndpoints(config, network)`. */
  endpoints?: EvidenceEndpoint[]
  /**
   * xReserve network profile; mainnet when omitted. Its chain id is what
   * eth_chainId must return, and it selects the default endpoints.
   */
  network?: XReserveNetwork
}

const DEFAULT_TIMEOUT_MS = 10_000
const MIN_TIMEOUT_MS = 100
const MAX_TIMEOUT_MS = 30_000
/** Largest body accepted; a block header without transactions is far smaller. */
const MAX_BODY_CHARS = 5_000_000

const HASH_RE = /^0x[0-9a-fA-F]{64}$/
const QUANTITY_RE = /^0x(0|[1-9a-fA-F][0-9a-fA-F]*)$/

/**
 * The wallet's Ethereum mainnet read endpoints, in priority order: the
 * Alchemy/proxy endpoint when the wallet can reach one, then the configured
 * public mainnet RPCs. The proxy's client tag rides on the URL/header exactly
 * as elsewhere in the wallet; neither is ever surfaced by this module.
 */
export function ethereumEvidenceEndpoints(config: WalletConfig, network?: XReserveNetwork): EvidenceEndpoint[] {
  const net = xreserveNetwork(network)
  const mainnet = net.ethereum.chainId === 1
  const json = { 'Content-Type': 'application/json' }
  const list: EvidenceEndpoint[] = []
  if (canAlchemy(config)) {
    list.push({
      label: 'wallet-rpc',
      url: alchemyRpcUrl(mainnet ? 'eth-mainnet' : 'eth-sepolia', config),
      headers: proxyBase(config) ? proxyHeaders(config, json) : { ...json },
    })
  }
  const publicRpcs = (mainnet ? PUBLIC_RPCS : TESTNET_PUBLIC_RPCS).ethereum ?? []
  publicRpcs.forEach((url, i) => list.push({ label: `public-rpc-${i + 1}`, url, headers: { ...json } }))
  return list
}

/** Thrown inside one snapshot; caught by the endpoint loop. */
class SnapshotFault {
  constructor(readonly method: EvidenceMethod, readonly kind: EndpointFaultKind, readonly extra: { status?: number; rpcCode?: number } = {}) {}
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isHash = (v: unknown): v is string => typeof v === 'string' && HASH_RE.test(v)
const isQuantity = (v: unknown): v is string => typeof v === 'string' && QUANTITY_RE.test(v)

function clampTimeout(ms: number | undefined): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(ms)))
}

/**
 * One JSON-RPC call. Returns `result` exactly as sent (null included); every
 * other outcome is a SnapshotFault. The timeout also bounds a fetch that
 * ignores its abort signal, and covers reading the body.
 */
async function rpcCall(
  endpoint: EvidenceEndpoint, fetchFn: EvidenceFetchFn, timeoutMs: number,
  id: number, method: EvidenceMethod, params: unknown[], nullable: boolean,
): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new SnapshotFault(method, 'timeout')) }, timeoutMs)
  })
  const exchange = async (): Promise<string> => {
    let res: Response
    try {
      res = await fetchFn(endpoint.url, {
        method: 'POST',
        headers: endpoint.headers,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      })
    } catch {
      throw new SnapshotFault(method, controller.signal.aborted ? 'timeout' : 'network')
    }
    if (!res || typeof res.status !== 'number') throw new SnapshotFault(method, 'network')
    if (res.status < 200 || res.status > 299) throw new SnapshotFault(method, 'http', { status: res.status })
    try {
      return await res.text()
    } catch {
      throw new SnapshotFault(method, controller.signal.aborted ? 'timeout' : 'network')
    }
  }
  const pending = exchange()
  pending.catch(() => { /* a late failure after a timeout is already reported as the timeout */ })
  let text: string
  try {
    text = await Promise.race([pending, timedOut])
  } finally {
    clearTimeout(timer)
  }

  if (typeof text !== 'string' || text.length > MAX_BODY_CHARS) throw new SnapshotFault(method, 'malformed')
  let body: unknown
  try { body = JSON.parse(text) } catch { throw new SnapshotFault(method, 'malformed') }
  if (!isObj(body) || body.jsonrpc !== '2.0' || body.id !== id) throw new SnapshotFault(method, 'malformed')
  const hasError = Object.prototype.hasOwnProperty.call(body, 'error') && body.error !== undefined && body.error !== null
  const hasResult = Object.prototype.hasOwnProperty.call(body, 'result')
  if (hasError) {
    const code = isObj(body.error) && Number.isInteger(body.error.code) ? (body.error.code as number) : undefined
    throw new SnapshotFault(method, 'rpc-error', code === undefined ? {} : { rpcCode: code })
  }
  if (!hasResult || body.result === undefined) throw new SnapshotFault(method, 'missing-result')
  if (body.result === null && !nullable) throw new SnapshotFault(method, 'missing-result')
  return body.result
}

/** Read the complete snapshot from ONE endpoint, or throw a SnapshotFault. */
async function readSnapshot(
  endpoint: EvidenceEndpoint, hash: string, fetchFn: EvidenceFetchFn, timeoutMs: number, expectedChainId: bigint,
): Promise<EthereumDepositEvidence> {
  let id = 0
  const call = (method: EvidenceMethod, params: unknown[], nullable: boolean) =>
    rpcCall(endpoint, fetchFn, timeoutMs, ++id, method, params, nullable)

  // 1. The endpoint is the profile's chain (Ethereum mainnet by default).
  const chainId = await call('eth_chainId', [], false)
  if (!isQuantity(chainId)) throw new SnapshotFault('eth_chainId', 'malformed')
  if (BigInt(chainId) !== expectedChainId) throw new SnapshotFault('eth_chainId', 'wrong-chain')

  // 2. The transaction (null = this node does not know the hash).
  const transaction = await call('eth_getTransactionByHash', [hash], true)
  if (transaction !== null) {
    if (!isObj(transaction) || !isHash(transaction.hash)) throw new SnapshotFault('eth_getTransactionByHash', 'malformed')
    if (transaction.hash.toLowerCase() !== hash) throw new SnapshotFault('eth_getTransactionByHash', 'inconsistent')
    if (transaction.blockNumber !== null && transaction.blockNumber !== undefined && !isQuantity(transaction.blockNumber)) {
      throw new SnapshotFault('eth_getTransactionByHash', 'malformed')
    }
  }

  // 3. The receipt (null = not mined, or unknown).
  const receipt = await call('eth_getTransactionReceipt', [hash], true)
  if (receipt !== null) {
    if (!isObj(receipt) || !isHash(receipt.transactionHash) || !isQuantity(receipt.blockNumber)
        || !isHash(receipt.blockHash) || !Array.isArray(receipt.logs)) {
      throw new SnapshotFault('eth_getTransactionReceipt', 'malformed')
    }
    if (receipt.transactionHash.toLowerCase() !== hash) throw new SnapshotFault('eth_getTransactionReceipt', 'inconsistent')
    // A receipt for a transaction this same node just said it does not know.
    if (transaction === null) throw new SnapshotFault('eth_getTransactionReceipt', 'inconsistent')
  }

  // 4. The receipt's block, header only (null stays null: the verifier reports block-missing).
  let block: unknown = null
  if (receipt !== null) {
    const blockNumber = (receipt as { blockNumber: string }).blockNumber
    block = await call('eth_getBlockByNumber', [blockNumber, false], true)
    if (block !== null) {
      if (!isObj(block) || !isQuantity(block.number) || !isHash(block.hash)) throw new SnapshotFault('eth_getBlockByNumber', 'malformed')
      if (BigInt(block.number) !== BigInt(blockNumber)) throw new SnapshotFault('eth_getBlockByNumber', 'inconsistent')
    }
  }

  // 5. The tip, last, so it is at least as new as everything above.
  const tipBlockNumber = await call('eth_blockNumber', [], false)
  if (!isQuantity(tipBlockNumber)) throw new SnapshotFault('eth_blockNumber', 'malformed')

  return { transaction, receipt, block, tipBlockNumber }
}

/**
 * Read one evidence snapshot for `sourceTxHash` from the wallet's Ethereum
 * mainnet endpoints. Resolves with the evidence and the label of the single
 * endpoint that produced all of it; throws `EthereumEvidenceError` otherwise.
 */
export async function readXReserveEthereumEvidence(
  sourceTxHash: string, config: WalletConfig, opts: ReadEvidenceOptions = {},
): Promise<EvidenceSnapshot> {
  if (!isHash(sourceTxHash)) {
    throw new EthereumEvidenceError('invalid-input', 'Ethereum evidence: source transaction hash is malformed')
  }
  const hash = sourceTxHash.toLowerCase()
  let net: XReserveNetwork
  try { net = xreserveNetwork(opts.network) } catch {
    throw new EthereumEvidenceError('invalid-input', 'Ethereum evidence: unknown xReserve network')
  }
  const endpoints = opts.endpoints ?? ethereumEvidenceEndpoints(config, net)
  if (!endpoints.length) {
    throw new EthereumEvidenceError('no-endpoint', 'Ethereum evidence: no Ethereum mainnet endpoint is configured')
  }
  const fetchFn = opts.fetchFn ?? ((url: string, init?: RequestInit) => fetch(url, init))
  const timeoutMs = clampTimeout(opts.timeoutMs)

  const failedAttempts: EndpointFault[] = []
  for (const endpoint of endpoints) {
    try {
      const evidence = await readSnapshot(endpoint, hash, fetchFn, timeoutMs, BigInt(net.ethereum.chainId))
      return { sourceTxHash: hash, evidence, endpoint: endpoint.label, failedAttempts }
    } catch (e) {
      if (!(e instanceof SnapshotFault)) {
        // Unexpected (a bug, not a provider answer): record it without its message.
        failedAttempts.push({ endpoint: endpoint.label, method: null, kind: 'malformed' })
        continue
      }
      failedAttempts.push({ endpoint: endpoint.label, method: e.method, kind: e.kind, ...e.extra })
    }
  }
  const summary = failedAttempts
    .map(a => `${a.endpoint} ${a.method ?? 'snapshot'} ${a.kind}${a.status !== undefined ? ` ${a.status}` : ''}${a.rpcCode !== undefined ? ` ${a.rpcCode}` : ''}`)
    .join('; ')
  throw new EthereumEvidenceError('unavailable', `Ethereum evidence: every endpoint failed (${summary})`, failedAttempts)
}
