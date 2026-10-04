/**
 * Ethereum evidence reader. No network: every endpoint is a fake JSON-RPC node
 * serving the public transaction 0x9695d030… recorded read-only (below). The
 * credentials in this file are fake markers used to prove they never reach an
 * error message.
 */
import { describe, it, expect } from 'vitest'
import {
  readXReserveEthereumEvidence, ethereumEvidenceEndpoints, EthereumEvidenceError,
  type EvidenceEndpoint, type EvidenceFetchFn,
} from './xreserve-ethereum-evidence-reader'
import { verifyXReserveEthereumDeposit } from './xreserve-ethereum-deposit-proof'
import { PUBLIC_RPCS } from './chain-config'
import type { WalletConfig } from './secure-store'

/**
 * Ethereum mainnet, recorded read-only 2026-09-29 01:36 UTC from ethereum-rpc.publicnode.com:
 * eth_getTransactionByHash / eth_getTransactionReceipt / eth_getBlockByNumber(receipt.blockNumber, false)
 * (header trimmed to the fields read) / eth_blockNumber.
 */
const ETH_TX = {
 "type": "0x2",
 "chainId": "0x1",
 "nonce": "0x41",
 "gas": "0x336dc",
 "maxFeePerGas": "0x3ffae82",
 "maxPriorityFeePerGas": "0x27053",
 "to": "0x8888888199b2df864bf678259607d6d5ebb4e3ce",
 "value": "0x0",
 "accessList": [],
 "input": "0xfaadb53b00000000000000000000000000000000000000000000000000000000713f8ff90000000000000000000000000000000000000000000000000000000000002714000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48000000000000000000000000000000000000000000000000000000000098968000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000005f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
 "r": "0xc5c393efd815a0a532bc77e451c887324a965de2582b49b0b6950ab5077467e4",
 "s": "0x3af7d5bc4994210dcda0c47b9d647aaad16223cbd0e9187a3ae7f77bc0d5e079",
 "yParity": "0x0",
 "v": "0x0",
 "hash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
 "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
 "blockNumber": "0x18da052",
 "transactionIndex": "0x95",
 "from": "0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863",
 "gasPrice": "0x36fe7e1",
 "blockTimestamp": "0x6ab736d3"
}

const ETH_RECEIPT = {
 "type": "0x2",
 "status": "0x1",
 "cumulativeGasUsed": "0x180c8fc",
 "logs": [
  {
   "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
   "topics": [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x000000000000000000000000d0402a74d8d05e7c4a78e5e01fed14f94c0f4863",
    "0x0000000000000000000000008888888199b2df864bf678259607d6d5ebb4e3ce"
   ],
   "data": "0x00000000000000000000000000000000000000000000000000000000713f8ff9",
   "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
   "blockNumber": "0x18da052",
   "blockTimestamp": "0x6ab736d3",
   "transactionHash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
   "transactionIndex": "0x95",
   "logIndex": "0x629",
   "removed": false
  },
  {
   "address": "0x8888888199b2df864bf678259607d6d5ebb4e3ce",
   "topics": [
    "0x2eef4ec627e0f99d1cc55f26e234a6066090b7bc0b3f61245f1f2d7c91d3e563",
    "0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "0x000000000000000000000000d0402a74d8d05e7c4a78e5e01fed14f94c0f4863",
    "0x000000011c75c5b878c190e7861f938a23e8d1c6914fc23f5df9058d678363c9"
   ],
   "data": "0x00000000000000000000000000000000000000000000000000000000713f8ff900000000000000000000000000000000000000000000000000000000000027149ea9794d33dbcef3f77718e903816e877ab2577f4d7ee653638f1f60fc671dd6000000000000000000000000000000000000000000000000000000000098968000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000005f000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
   "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
   "blockNumber": "0x18da052",
   "blockTimestamp": "0x6ab736d3",
   "transactionHash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
   "transactionIndex": "0x95",
   "logIndex": "0x62a",
   "removed": false
  },
  {
   "address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
   "topics": [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x0000000000000000000000008888888199b2df864bf678259607d6d5ebb4e3ce",
    "0x00000000000000000000000077777777dcc4d5a8b6e418fd04d8997ef11000ee"
   ],
   "data": "0x00000000000000000000000000000000000000000000000000000000713f8ff9",
   "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
   "blockNumber": "0x18da052",
   "blockTimestamp": "0x6ab736d3",
   "transactionHash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
   "transactionIndex": "0x95",
   "logIndex": "0x62b",
   "removed": false
  },
  {
   "address": "0x77777777dcc4d5a8b6e418fd04d8997ef11000ee",
   "topics": [
    "0x4174a9435a04d04d274c76779cad136a41fde6937c56241c09ab9d3c7064a1a9",
    "0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "0x000000000000000000000000866e992217e0bfb8371f9ad32a53dcc47d1aa04e",
    "0x0000000000000000000000008888888199b2df864bf678259607d6d5ebb4e3ce"
   ],
   "data": "0x00000000000000000000000000000000000000000000000000000000713f8ff9",
   "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
   "blockNumber": "0x18da052",
   "blockTimestamp": "0x6ab736d3",
   "transactionHash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
   "transactionIndex": "0x95",
   "logIndex": "0x62c",
   "removed": false
  }
 ],
 "logsBloom": "0x80000000400000000000000000000200000000000000000000000000000001000000000000000800000202010000400000000000000000000008000010000040000000000000000008000018000000000004000000000000000000000000000100000000000000000000000000000000000001000000000000008011000000000000000000000000000000020000000200000000010000080000000000400000000000040000200000000000000000000000000000000000001000040000000000000002000000000000000000000000000000000000000000000400000000000000000000000000000208000000000004004000000000000000000000000000",
 "transactionHash": "0x9695d030fb33ac1267ca78847684331ec6a87b508fe51cfbc91d01d560504fa2",
 "transactionIndex": "0x95",
 "blockHash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
 "blockNumber": "0x18da052",
 "gasUsed": "0x1d7a5",
 "effectiveGasPrice": "0x36fe7e1",
 "from": "0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863",
 "to": "0x8888888199b2df864bf678259607d6d5ebb4e3ce",
 "contractAddress": null
}

const ETH_BLOCK = {
 "number": "0x18da052",
 "hash": "0xeb9c295e637b33151422cee390848f8ba1feb02558275a7550312914693061aa",
 "parentHash": "0x8e2749cc83d14e64a07835853e20aea68b7f757ae6011d60d53eb6282fc8011a",
 "timestamp": "0x6ab736d3"
}

const ETH_TIP = '0x18df282'

const HASH = ETH_TX.hash
const SENDER = '0xd0402a74d8d05e7c4a78e5e01fed14f94c0f4863'
const APPROVED = { recipient: 'addr1vyw8t3dc0rqepeuxr7fc5glg68rfzn7z8awljpvdv7pk8jgktrtax', amountRaw: 1_899_991_033n, maxFeeRaw: 10_000_000n }
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))

const BASE_CONFIG = {
  alchemyKey: '', ankrKey: '', heliusKey: '', blockfrostKey: '', tatumKey: '', moralisKey: '', openseaKey: '',
  ordiscanKey: '', anvilKey: '', supabaseUrl: '', supabaseKey: '', walletConnectProjectId: '',
  swapProxyUrl: '', clientToken: '', simpleSwapApiKey: '', testnetMode: false, privacyMode: false,
  torBrowserEnabled: false, torBrowserPort: 9050, moneroRestoreHeight: 0,
} as unknown as WalletConfig
const PROXY_CONFIG = { ...BASE_CONFIG, swapProxyUrl: 'https://proxy.example', clientToken: 'CLIENTTAG-SECRET' } as WalletConfig
const DIRECT_CONFIG = { ...BASE_CONFIG, alchemyKey: 'ALCHEMYKEY-SECRET' } as WalletConfig

/** Three fake endpoints with secret-bearing URLs. */
const EP: EvidenceEndpoint[] = [
  { label: 'wallet-rpc', url: 'https://proxy.example/rpc/alchemy/eth-mainnet?mm_client=CLIENTTAG-SECRET', headers: { 'x-mm-client': 'CLIENTTAG-SECRET' } },
  { label: 'public-rpc-1', url: 'https://one.example/APIKEY-SECRET', headers: {} },
  { label: 'public-rpc-2', url: 'https://two.example/', headers: {} },
]

type Reply =
  | { result: unknown } | { error: unknown } | { envelope: unknown } | { raw: string }
  | { status: number } | { throws: true } | { hang: true }
interface NodeSpec { chainId?: Reply; tx?: Reply; receipt?: Reply; block?: Reply; tip?: Reply }
interface Call { url: string; method: string; params: unknown[]; id: number; headers: Record<string, string> }

/** The recorded chain, as a healthy mainnet node answers it. */
const healthy = (): Required<NodeSpec> => ({
  chainId: { result: '0x1' }, tx: { result: clone(ETH_TX) }, receipt: { result: clone(ETH_RECEIPT) },
  block: { result: clone(ETH_BLOCK) }, tip: { result: ETH_TIP },
})

const KEY: Record<string, keyof NodeSpec> = {
  eth_chainId: 'chainId', eth_getTransactionByHash: 'tx', eth_getTransactionReceipt: 'receipt',
  eth_getBlockByNumber: 'block', eth_blockNumber: 'tip',
}

/** A fake fetch serving each endpoint URL from its own NodeSpec (healthy by default). */
function network(nodes: Record<string, NodeSpec>) {
  const calls: Call[] = []
  const fetchFn: EvidenceFetchFn = async (url, init) => {
    const req = JSON.parse(String(init?.body)) as { id: number; method: string; params: unknown[] }
    calls.push({ url, method: req.method, params: req.params, id: req.id, headers: (init?.headers ?? {}) as Record<string, string> })
    const spec = { ...healthy(), ...(nodes[url] ?? {}) }
    const reply = spec[KEY[req.method]]
    if ('throws' in reply) throw new TypeError(`fetch failed: ${url}`)
    if ('hang' in reply) return new Promise<Response>(() => { /* never settles, ignores the signal */ })
    if ('status' in reply) return new Response(`upstream error at ${url}`, { status: reply.status })
    if ('raw' in reply) return new Response(reply.raw, { status: 200 })
    const body = 'envelope' in reply ? reply.envelope : { jsonrpc: '2.0', id: req.id, ...reply }
    return new Response(JSON.stringify(body), { status: 200 })
  }
  return { fetchFn, calls, methodsAt: (url: string) => calls.filter(c => c.url === url).map(c => c.method) }
}

const read = (fetchFn: EvidenceFetchFn, hash: string = HASH, timeoutMs?: number) =>
  readXReserveEthereumEvidence(hash, BASE_CONFIG, { fetchFn, endpoints: EP, timeoutMs })

async function readError(p: Promise<unknown>): Promise<EthereumEvidenceError> {
  try { await p } catch (e) { expect(e).toBeInstanceOf(EthereumEvidenceError); return e as EthereumEvidenceError }
  throw new Error('expected an EthereumEvidenceError')
}

const verify = (evidence: unknown) => verifyXReserveEthereumDeposit({
  sourceTxHash: HASH, approved: APPROVED, approvedSender: SENDER,
  evidence: evidence as never, minConfirmations: 12,
})

const FULL = ['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_getBlockByNumber', 'eth_blockNumber']

describe('endpoints come from the wallet configuration', () => {
  it('proxy first (client tag on URL and header), then the configured public mainnet RPCs', () => {
    const eps = ethereumEvidenceEndpoints(PROXY_CONFIG)
    expect(eps.map(e => e.label)).toEqual(['wallet-rpc', ...PUBLIC_RPCS.ethereum.map((_, i) => `public-rpc-${i + 1}`)])
    expect(eps[0].url).toBe('https://proxy.example/rpc/alchemy/eth-mainnet?mm_client=CLIENTTAG-SECRET')
    expect(eps[0].headers).toMatchObject({ 'Content-Type': 'application/json', 'x-mm-client': 'CLIENTTAG-SECRET' })
    expect(eps.slice(1).map(e => e.url)).toEqual(PUBLIC_RPCS.ethereum)
  })

  it('a user Alchemy key (no proxy) is the direct endpoint without a client header; no key at all means public only', () => {
    const direct = ethereumEvidenceEndpoints(DIRECT_CONFIG)
    expect(direct[0]).toMatchObject({ label: 'wallet-rpc', url: 'https://eth-mainnet.g.alchemy.com/v2/ALCHEMYKEY-SECRET' })
    expect(direct[0].headers).not.toHaveProperty('x-mm-client')
    expect(ethereumEvidenceEndpoints(BASE_CONFIG).map(e => e.label)[0]).toBe('public-rpc-1')
  })
})

describe('one complete snapshot', () => {
  it('reads chainId, transaction, receipt, the receipt block (header only) and the tip, in order, from one endpoint', async () => {
    const net = network({})
    const snap = await read(net.fetchFn, HASH.toUpperCase().replace('0X', '0x'))
    expect(net.calls.map(c => c.method)).toEqual(FULL)
    expect(new Set(net.calls.map(c => c.url))).toEqual(new Set([EP[0].url]))
    expect(net.calls.map(c => c.id)).toEqual([1, 2, 3, 4, 5])
    expect(net.calls[1].params).toEqual([HASH])
    expect(net.calls[2].params).toEqual([HASH])
    expect(net.calls[3].params).toEqual([ETH_RECEIPT.blockNumber, false])
    expect(net.calls[0].headers).toMatchObject({ 'x-mm-client': 'CLIENTTAG-SECRET' })
    expect(snap).toEqual({
      sourceTxHash: HASH, endpoint: 'wallet-rpc', failedAttempts: [],
      evidence: { transaction: ETH_TX, receipt: ETH_RECEIPT, block: ETH_BLOCK, tipBlockNumber: ETH_TIP },
    })
  })

  it('the recorded public deposit stays not-approved/calldata-mismatch (its 95-zero-byte hookData)', async () => {
    const snap = await read(network({}).fetchFn)
    expect(verify(snap.evidence)).toMatchObject({ state: 'not-approved', code: 'calldata-mismatch' })
  })
})

describe('real nulls stay null', () => {
  it('an unknown transaction: tx and receipt null, no block read, verifier says pending/not-found', async () => {
    const net = network({ [EP[0].url]: { tx: { result: null }, receipt: { result: null } } })
    const snap = await read(net.fetchFn)
    expect(net.calls.map(c => c.method)).toEqual(['eth_chainId', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_blockNumber'])
    expect(snap.evidence).toEqual({ transaction: null, receipt: null, block: null, tipBlockNumber: ETH_TIP })
    expect(verify(snap.evidence)).toMatchObject({ state: 'pending', code: 'not-found' })
  })

  it('a not-yet-mined transaction: tx present with null block fields, receipt null, no block read (never an empty receipt)', async () => {
    const pending = { ...clone(ETH_TX), blockHash: null, blockNumber: null, transactionIndex: null }
    const net = network({ [EP[0].url]: { tx: { result: pending }, receipt: { result: null } } })
    const snap = await read(net.fetchFn)
    expect(net.methodsAt(EP[0].url)).not.toContain('eth_getBlockByNumber')
    expect(snap.evidence).toMatchObject({ transaction: pending, receipt: null, block: null })
    expect(snap.endpoint).toBe('wallet-rpc')
  })

  it('a null block for a mined receipt stays null — not a provider error, not an empty block', async () => {
    const snap = await read(network({ [EP[0].url]: { block: { result: null } } }).fetchFn)
    expect(snap.evidence.block).toBeNull()
    expect(snap.endpoint).toBe('wallet-rpc')
  })
})

describe('provider faults are never "not found"', () => {
  it('an RPC error on the receipt fails the endpoint; it is not read as a null receipt', async () => {
    const net = network({
      [EP[0].url]: { receipt: { error: { code: -32000, message: 'header not found' } } },
      [EP[1].url]: { receipt: { error: { code: -32005, message: 'limit exceeded' } } },
      [EP[2].url]: { receipt: { error: { code: -32603, message: 'internal' } } },
    })
    const err = await readError(read(net.fetchFn))
    expect(err.kind).toBe('unavailable')
    expect(err.attempts).toEqual([
      { endpoint: 'wallet-rpc', method: 'eth_getTransactionReceipt', kind: 'rpc-error', rpcCode: -32000 },
      { endpoint: 'public-rpc-1', method: 'eth_getTransactionReceipt', kind: 'rpc-error', rpcCode: -32005 },
      { endpoint: 'public-rpc-2', method: 'eth_getTransactionReceipt', kind: 'rpc-error', rpcCode: -32603 },
    ])
  })

  it('an RPC error on one endpoint versus a real null on the next: the null comes back, from the next endpoint only', async () => {
    const net = network({
      [EP[0].url]: { tx: { error: { code: -32000, message: 'x' } } },
      [EP[1].url]: { tx: { result: null }, receipt: { result: null } },
    })
    const snap = await read(net.fetchFn)
    expect(snap).toMatchObject({ endpoint: 'public-rpc-1', evidence: { transaction: null, receipt: null, block: null } })
    expect(snap.failedAttempts).toEqual([{ endpoint: 'wallet-rpc', method: 'eth_getTransactionByHash', kind: 'rpc-error', rpcCode: -32000 }])
  })

  const faults: Array<[string, NodeSpec, Record<string, unknown>]> = [
    ['result absent', { receipt: { envelope: { jsonrpc: '2.0', id: 3 } } }, { method: 'eth_getTransactionReceipt', kind: 'missing-result' }],
    ['null chainId', { chainId: { result: null } }, { method: 'eth_chainId', kind: 'missing-result' }],
    ['null tip', { tip: { result: null } }, { method: 'eth_blockNumber', kind: 'missing-result' }],
    ['error and result together', { tx: { envelope: { jsonrpc: '2.0', id: 2, result: null, error: { code: 1 } } } }, { method: 'eth_getTransactionByHash', kind: 'rpc-error', rpcCode: 1 }],
    ['error without a code', { tx: { error: 'nope' } }, { method: 'eth_getTransactionByHash', kind: 'rpc-error' }],
    ['HTTP 429', { receipt: { status: 429 } }, { method: 'eth_getTransactionReceipt', kind: 'http', status: 429 }],
    ['HTTP 500', { chainId: { status: 500 } }, { method: 'eth_chainId', kind: 'http', status: 500 }],
    ['transport failure', { block: { throws: true } }, { method: 'eth_getBlockByNumber', kind: 'network' }],
    ['non-JSON body', { tx: { raw: '<html>502</html>' } }, { method: 'eth_getTransactionByHash', kind: 'malformed' }],
    ['wrong jsonrpc version', { tx: { envelope: { jsonrpc: '1.0', id: 2, result: null } } }, { method: 'eth_getTransactionByHash', kind: 'malformed' }],
    ['wrong response id', { tx: { envelope: { jsonrpc: '2.0', id: 99, result: null } } }, { method: 'eth_getTransactionByHash', kind: 'malformed' }],
    ['batch-shaped body', { tx: { raw: '[{"jsonrpc":"2.0","id":2,"result":null}]' } }, { method: 'eth_getTransactionByHash', kind: 'malformed' }],
    ['non-hex chainId', { chainId: { result: 1 } }, { method: 'eth_chainId', kind: 'malformed' }],
    ['transaction without a hash', { tx: { result: { ...clone(ETH_TX), hash: undefined } } }, { method: 'eth_getTransactionByHash', kind: 'malformed' }],
    ['transaction as an empty object', { tx: { result: {} } }, { method: 'eth_getTransactionByHash', kind: 'malformed' }],
    ['receipt as an empty object', { receipt: { result: {} } }, { method: 'eth_getTransactionReceipt', kind: 'malformed' }],
    ['receipt with a decimal block number', { receipt: { result: { ...clone(ETH_RECEIPT), blockNumber: '26058834' } } }, { method: 'eth_getTransactionReceipt', kind: 'malformed' }],
    ['receipt without logs', { receipt: { result: { ...clone(ETH_RECEIPT), logs: undefined } } }, { method: 'eth_getTransactionReceipt', kind: 'malformed' }],
    ['block without a hash', { block: { result: { ...clone(ETH_BLOCK), hash: null } } }, { method: 'eth_getBlockByNumber', kind: 'malformed' }],
    ['tip as a tag', { tip: { result: 'latest' } }, { method: 'eth_blockNumber', kind: 'malformed' }],
    ['transaction for another hash', { tx: { result: { ...clone(ETH_TX), hash: `0x${'ab'.repeat(32)}` } } }, { method: 'eth_getTransactionByHash', kind: 'inconsistent' }],
    ['receipt for another hash', { receipt: { result: { ...clone(ETH_RECEIPT), transactionHash: `0x${'ab'.repeat(32)}` } } }, { method: 'eth_getTransactionReceipt', kind: 'inconsistent' }],
    ['receipt while the transaction is unknown', { tx: { result: null } }, { method: 'eth_getTransactionReceipt', kind: 'inconsistent' }],
    ['a different block than requested', { block: { result: { ...clone(ETH_BLOCK), number: '0x18da053' } } }, { method: 'eth_getBlockByNumber', kind: 'inconsistent' }],
  ]
  for (const [name, spec, fault] of faults) {
    it(`${name} → ${fault.kind}, the endpoint is abandoned and the snapshot restarts on the next`, async () => {
      const net = network({ [EP[0].url]: spec })
      const snap = await read(net.fetchFn)
      expect(snap.failedAttempts).toEqual([{ endpoint: 'wallet-rpc', ...fault }])
      expect(snap.endpoint).toBe('public-rpc-1')
      expect(net.methodsAt(EP[1].url)).toEqual(FULL)
      expect(snap.evidence).toEqual({ transaction: ETH_TX, receipt: ETH_RECEIPT, block: ETH_BLOCK, tipBlockNumber: ETH_TIP })
    })
  }

  it('a request that never answers (and ignores its abort signal) times out within the bound', async () => {
    const net = network({ [EP[0].url]: { receipt: { hang: true } } })
    const started = Date.now()
    const snap = await read(net.fetchFn, HASH, 100)
    expect(Date.now() - started).toBeLessThan(5_000)
    expect(snap.failedAttempts).toEqual([{ endpoint: 'wallet-rpc', method: 'eth_getTransactionReceipt', kind: 'timeout' }])
    expect(snap.endpoint).toBe('public-rpc-1')
  })
})

describe('chain and endpoint rules', () => {
  it('a non-mainnet chainId fails that endpoint before any transaction read', async () => {
    const net = network({ [EP[0].url]: { chainId: { result: '0xaa36a7' } } })
    const snap = await read(net.fetchFn)
    expect(net.methodsAt(EP[0].url)).toEqual(['eth_chainId'])
    expect(snap.failedAttempts).toEqual([{ endpoint: 'wallet-rpc', method: 'eth_chainId', kind: 'wrong-chain' }])
    expect(snap.endpoint).toBe('public-rpc-1')
  })

  it('every endpoint on the wrong chain → unavailable, never evidence', async () => {
    const wrong: NodeSpec = { chainId: { result: '0x89' } }
    const err = await readError(read(network({ [EP[0].url]: wrong, [EP[1].url]: wrong, [EP[2].url]: wrong }).fetchFn))
    expect(err.kind).toBe('unavailable')
    expect(err.attempts.map(a => a.kind)).toEqual(['wrong-chain', 'wrong-chain', 'wrong-chain'])
  })

  it('failover restarts the WHOLE snapshot: nothing read from the failed endpoint survives', async () => {
    const firstTx = { ...clone(ETH_TX), gas: '0x1' }        // marker: only the first endpoint serves this
    const net = network({
      [EP[0].url]: { tx: { result: firstTx }, tip: { status: 503 } },   // fails on the very last read
      [EP[1].url]: { tip: { result: '0x18df283' } },
    })
    const snap = await read(net.fetchFn)
    expect(net.calls.map(c => `${c.url === EP[0].url ? 'A' : 'B'}:${c.method}`)).toEqual([
      ...FULL.map(m => `A:${m}`), ...FULL.map(m => `B:${m}`),
    ])
    expect(net.calls.filter(c => c.url === EP[1].url).map(c => c.id)).toEqual([1, 2, 3, 4, 5])
    expect(snap.endpoint).toBe('public-rpc-1')
    expect(snap.evidence.transaction).toEqual(ETH_TX)
    expect(snap.evidence.tipBlockNumber).toBe('0x18df283')
    expect(net.calls.some(c => c.url === EP[2].url)).toBe(false)
  })

  it('rejects a malformed hash, and an empty endpoint list, without any request', async () => {
    const net = network({})
    for (const bad of ['', '0x1234', HASH.slice(2), `${HASH}00`, `0x${'g'.repeat(64)}`, null, 42]) {
      expect((await readError(read(net.fetchFn, bad as string))).kind).toBe('invalid-input')
    }
    const none = await readError(readXReserveEthereumEvidence(HASH, BASE_CONFIG, { fetchFn: net.fetchFn, endpoints: [] }))
    expect(none.kind).toBe('no-endpoint')
    expect(net.calls).toEqual([])
  })
})

describe('errors carry no URL, client tag or key', () => {
  it('provider messages, thrown transport errors and HTTP bodies that echo secrets never reach the error', async () => {
    const echo = 'bad key ALCHEMYKEY-SECRET at https://proxy.example?mm_client=CLIENTTAG-SECRET'
    const net = network({
      [EP[0].url]: { tx: { error: { code: -32001, message: echo, data: echo } } },
      [EP[1].url]: { chainId: { throws: true } },
      [EP[2].url]: { receipt: { status: 401 } },
    })
    const err = await readError(read(net.fetchFn))
    const surfaced = `${err.message} ${err.stack ?? ''} ${JSON.stringify(err)} ${JSON.stringify(err.attempts)}`
    for (const secret of ['SECRET', 'proxy.example', 'one.example', 'two.example', 'mm_client', 'https://', 'bad key', 'fetch failed', 'upstream error']) {
      expect(surfaced).not.toContain(secret)
    }
    expect(err.message).toBe('Ethereum evidence: every endpoint failed (wallet-rpc eth_getTransactionByHash rpc-error -32001; '
      + 'public-rpc-1 eth_chainId network; public-rpc-2 eth_getTransactionReceipt http 401)')
  })

  it('the real wallet endpoints (proxy tag, direct key) stay out of errors too', async () => {
    const fetchFn: EvidenceFetchFn = async (url) => { throw new TypeError(`connect ECONNREFUSED ${url}`) }
    for (const config of [PROXY_CONFIG, DIRECT_CONFIG]) {
      const err = await readError(readXReserveEthereumEvidence(HASH, config, { fetchFn }))
      const surfaced = `${err.message} ${JSON.stringify(err.attempts)}`
      expect(surfaced).not.toMatch(/SECRET|proxy\.example|alchemy\.com|mm_client|publicnode|drpc|1rpc|ECONNREFUSED/)
      expect(err.attempts.every(a => a.kind === 'network')).toBe(true)
    }
  })
})
