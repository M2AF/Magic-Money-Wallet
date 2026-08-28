/**
 * The keyless on-chain token tier: Multicall3 reads + Transfer-log discovery.
 *
 * Hermetic — every RPC is stubbed. The live counterpart is
 * `scripts/onchain-tier-smoke.mjs`, which runs the same path against real public
 * RPCs and is what proved the Multicall3 encoding correct in the first place.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeFunctionData, encodeFunctionResult, parseAbi, encodeAbiParameters } from 'viem'

let metaDisk: Record<string, { name: string; symbol: string; decimals: number; logo: string | null; at: number }> = {}
let scanDisk: Record<string, { contracts: string[]; scannedDownTo: number; scannedUpTo: number; at: number }> = {}
let balDisk: Record<string, { balances: Array<{ contractAddress: string; tokenBalance: string }>; at: number }> = {}

vi.mock('./secure-store', () => ({
  loadTokenMetaCache: vi.fn(async () => metaDisk),
  saveTokenMetaCache: vi.fn((m: typeof metaDisk) => { metaDisk = m }),
  loadTokenBalanceCache: vi.fn(async () => balDisk),
  loadOnchainScanCache: vi.fn(async () => scanDisk),
  saveOnchainScanCache: vi.fn((m: typeof scanDisk) => { scanDisk = m }),
}))

import { fetchOnchainTokens } from './onchain-tokens'

const MULTICALL_ABI = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[] returnData)',
])
const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
])

const OWNER = '0x1111111111111111111111111111111111111111'
const GOOD = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'   // a real ERC-20
const NFT  = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'   // ERC-721: no decimals()

const config = { customTokens: [], testnetMode: false } as never

const uint = (n: bigint) => encodeAbiParameters([{ type: 'uint256' }], [n])
const EMPTY = '0x' as const

/**
 * A stand-in node. `holdings` maps contract → raw balance; anything in `nfts`
 * answers balanceOf but reverts on decimals(), exactly like a real ERC-721.
 */
function stubChain(opts: {
  holdings: Record<string, bigint>
  nfts?: string[]
  logsByContract?: string[]
  height?: number
}) {
  const { holdings, nfts = [], logsByContract = [], height = 1_000 } = opts
  const calls: Array<{ method: string; params: unknown }> = []

  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: unknown[] }
    calls.push({ method: body.method, params: body.params })

    if (body.method === 'eth_blockNumber') {
      return new Response(JSON.stringify({ result: '0x' + height.toString(16) }))
    }
    if (body.method === 'eth_getLogs') {
      return new Response(JSON.stringify({ result: logsByContract.map(a => ({ address: a })) }))
    }
    if (body.method === 'eth_call') {
      const { args } = decodeFunctionData({
        abi: MULTICALL_ABI,
        data: (body.params as Array<{ data: `0x${string}` }>)[0].data,
      })
      const batch = args![0] as ReadonlyArray<{ target: string; callData: `0x${string}` }>
      const returnData = batch.map(c => {
        const target = c.target.toLowerCase()
        const fn = decodeFunctionData({ abi: ERC20_ABI, data: c.callData }).functionName
        if (fn === 'balanceOf') {
          const v = holdings[target]
          return v ? { success: true, returnData: uint(v) } : { success: true, returnData: uint(0n) }
        }
        if (fn === 'decimals') {
          // The ERC-721 discriminator: no decimals() on an NFT contract.
          return nfts.includes(target)
            ? { success: false, returnData: EMPTY }
            : { success: true, returnData: encodeFunctionResult({ abi: ERC20_ABI, functionName: 'decimals', result: 6 }) }
        }
        if (fn === 'symbol') {
          return { success: true, returnData: encodeFunctionResult({ abi: ERC20_ABI, functionName: 'symbol', result: nfts.includes(target) ? 'PUNK' : 'GOOD' }) }
        }
        return { success: true, returnData: encodeFunctionResult({ abi: ERC20_ABI, functionName: 'name', result: nfts.includes(target) ? 'Punks' : 'Good Token' }) }
      })
      return new Response(JSON.stringify({
        result: encodeFunctionResult({ abi: MULTICALL_ABI, functionName: 'aggregate3', result: returnData }),
      }))
    }
    throw new Error(`unexpected ${body.method}`)
  }))
  return calls
}

beforeEach(() => { metaDisk = {}; scanDisk = {}; balDisk = {} })
afterEach(() => { vi.unstubAllGlobals() })

describe('on-chain token tier', () => {
  it('reads balances and resolves metadata straight off the chain', async () => {
    balDisk = { [`robinhood:${OWNER.toLowerCase()}`]: { balances: [{ contractAddress: GOOD, tokenBalance: '0x1' }], at: Date.now() } }
    stubChain({ holdings: { [GOOD]: 2_500_000n } })

    const rows = await fetchOnchainTokens('robinhood', OWNER, config)

    expect(rows).toEqual([
      { contractAddress: GOOD, name: 'Good Token', symbol: 'GOOD', decimals: 6, rawBalance: '2500000' },
    ])
    // Metadata read on-chain is banked for every other tier to reuse.
    expect(metaDisk[`robinhood:${GOOD}`]).toMatchObject({ symbol: 'GOOD', decimals: 6 })
  })

  it('excludes ERC-721 contracts the log sweep turns up', async () => {
    // Transfer(address,address,uint256) is identical for ERC-20 and ERC-721, so
    // discovery WILL surface NFT contracts. Holding one must not render as a
    // dust token balance.
    stubChain({ holdings: { [GOOD]: 1_000_000n, [NFT]: 3n }, nfts: [NFT], logsByContract: [GOOD, NFT] })

    const rows = await fetchOnchainTokens('robinhood', OWNER, config)

    expect(rows?.map(r => r.contractAddress)).toEqual([GOOD])
  })

  it('discovers contracts from Transfer logs and persists the sweep cursor', async () => {
    const DISCOVERED = '0xcccccccccccccccccccccccccccccccccccccccc'
    stubChain({ holdings: { [DISCOVERED]: 42n }, logsByContract: [DISCOVERED], height: 5_000 })

    const rows = await fetchOnchainTokens('robinhood', OWNER, config)

    expect(rows?.map(r => r.contractAddress)).toEqual([DISCOVERED])
    // Robinhood serves unbounded getLogs, so one pass covers all of history.
    const entry = scanDisk[`robinhood:${OWNER.toLowerCase()}`]
    expect(entry.contracts).toContain(DISCOVERED)
    expect(entry).toMatchObject({ scannedDownTo: 0, scannedUpTo: 5_000 })
  })

  it('does not sweep logs on a chain whose RPC caps the range too low', async () => {
    // Ronin allows 100 blocks — 600k requests for its history, so discovery is
    // deliberately not attempted there.
    const calls = stubChain({ holdings: {} })

    await fetchOnchainTokens('ronin', OWNER, config)

    expect(calls.some(c => c.method === 'eth_getLogs')).toBe(false)
  })

  it('reports unavailable (not empty) when the chain has no public RPC', async () => {
    stubChain({ holdings: {} })
    expect(await fetchOnchainTokens('not-a-chain', OWNER, config)).toBeUndefined()
  })
})
