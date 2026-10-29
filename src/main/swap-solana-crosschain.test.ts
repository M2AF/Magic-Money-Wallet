import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SolanaSwapCostEstimate } from './solana-swap-cost'
import type { WalletConfig } from './secure-store'
import { describeSolanaSimulationFailure } from './solana-simulation-failure'

const cost = vi.hoisted(() => ({ estimateSolanaSwapCost: vi.fn() }))
vi.mock('./solana-swap-cost', async orig => ({ ...(await orig<typeof import('./solana-swap-cost')>()), ...cost }))
import { getSwapQuote, setSwapFetch, type SwapQuoteRequest } from './swap-proxy'

const cfg = { swapProxyUrl: 'https://worker.test', clientToken: '' } as unknown as WalletConfig
const req: SwapQuoteRequest = {
  fromChain: 'solana', toChain: 'base', fromToken: 'So11111111111111111111111111111111111111112',
  toToken: '0x0000000000000000000000000000000000000000', fromSymbol: 'SOL', toSymbol: 'ETH',
  sellAmountRaw: '8000000000', slippageBps: 50,
  taker: '3noTuHnQdHkat2w5rBx18vAACMzFUvB5LodEe5vMN98d', toAddress: '0x01faF6DFc230d755141D84d7cB980dd68f5Efe13',
}
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
const mayan = 'mayan34VedncxdK2XobtvWFDXQASUTBXhUVzt2kKgny'
const failure = describeSolanaSimulationFailure({ InstructionError: [12, { Custom: 6025 }] }, [
  `Program ${mayan} failed: custom program error: 0x1789`,
  'Program wrapper consumed 3825 compute units', 'Program wrapper failed: custom program error: 0x1789',
])

function measurement(status: 'pass' | 'revert' | 'unavailable'): SolanaSwapCostEstimate {
  return {
    baseFeeLamports: '5000', priorityFeeLamports: '0', newAccounts: [], rentLamports: '0',
    otherTransferLamports: '0', saleLamports: req.sellAmountRaw, requiredLamports: '8000005000', costLamports: '5000',
    balanceLamports: '10000000000', complete: false, incompleteReason: 'bridge', measuredLamports: null,
    simulationStatus: status, simulationError: status === 'revert' ? failure : status === 'unavailable' ? 'RPC offline' : null,
  }
}
function quote(tool: string, noFee = false) {
  return {
    tool, estimate: {
      toAmount: '342102000000000000', toAmountMin: '340391490000000000', gasCosts: [],
      feeCosts: noFee ? [] : [{ token: { symbol: 'SOL', decimals: 9 }, included: true,
        feeSplit: { integratorFee: '80000000', lifiFee: '20000000', recipients: [{ name: 'ChainLens' }] } }],
    }, transactionRequest: { data: tool },
  }
}
let asked: URL[]
beforeEach(() => { asked = []; cost.estimateSolanaSwapCost.mockReset() })
afterEach(() => { setSwapFetch((input, init) => fetch(input, init)); vi.useRealTimers() })

function providers(choose: (url: URL) => unknown, workerQuotes: unknown[] = []) {
  setSwapFetch(async input => {
    const url = new URL(input)
    asked.push(url)
    if (url.hostname === 'li.quest') return json(choose(url))
    if (url.hostname === 'worker.test') return json({ candidates: workerQuotes, error: 'No other provider' })
    throw new Error(`Unexpected network request: ${url.origin}`)
  })
}

describe('SOL cross-chain source simulation and bounded bridge fallback', () => {
  it.each(['base', 'ethereum'] as const)('replaces reverting Mayan with a simulated alternative for %s ETH', async toChain => {
    providers(url => quote(url.searchParams.has('denyBridges') ? 'near' : 'mayan'))
    cost.estimateSolanaSwapCost.mockImplementation(async payload => measurement(payload === 'mayan' ? 'revert' : 'pass'))
    const out = await getSwapQuote({ ...req, toChain }, cfg)
    expect(out.quote?.bridgeTool).toBe('near')
    expect((out.quote?.solanaCost as SolanaSwapCostEstimate)?.simulationStatus).toBe('pass')
    expect(out.routing?.excluded.join(' ')).toContain('AmountInTooSmall')
    const lifi = asked.filter(u => u.hostname === 'li.quest')
    expect(lifi).toHaveLength(2)
    expect(lifi[1].searchParams.getAll('denyBridges')).toEqual(['mayan'])
    for (const key of ['fromAmount', 'fromAddress', 'toAddress', 'slippage', 'fee', 'fromToken', 'toToken', 'toChain']) {
      expect(lifi[1].searchParams.get(key)).toBe(lifi[0].searchParams.get(key))
    }
    expect(cost.estimateSolanaSwapCost.mock.calls.every(c => c[1] === req.taker)).toBe(true)
    expect(out.quote?.sellAmountRaw).toBe(req.sellAmountRaw)
    expect(out.quote?.toAddress).toBe(req.toAddress)
  })

  it('keeps a passing Mayan route without a bridge ban or extra quote', async () => {
    providers(() => quote('mayan'))
    cost.estimateSolanaSwapCost.mockResolvedValue(measurement('pass'))
    const out = await getSwapQuote(req, cfg)
    expect(out.quote?.bridgeTool).toBe('mayan')
    expect(asked.filter(u => u.hostname === 'li.quest')).toHaveLength(1)
  })

  it('bounds repeated program failures to two alternative bridge requests', async () => {
    providers(url => quote(['mayan', 'near', 'relay'][url.searchParams.getAll('denyBridges').length]))
    cost.estimateSolanaSwapCost.mockResolvedValue(measurement('revert'))
    const out = await getSwapQuote(req, cfg)
    expect(out.quote).toBeNull()
    expect(out.error).toContain('Nothing was sent')
    const lifi = asked.filter(u => u.hostname === 'li.quest')
    expect(lifi).toHaveLength(3)
    expect(lifi[2].searchParams.getAll('denyBridges')).toEqual(['mayan', 'near'])
  })

  it('rejects an upstream that ignores the denied bridge', async () => {
    providers(() => quote('mayan'))
    cost.estimateSolanaSwapCost.mockResolvedValue(measurement('revert'))
    const out = await getSwapQuote(req, cfg)
    expect(out.quote).toBeNull()
    expect(out.error).toContain('excluded bridge')
    expect(cost.estimateSolanaSwapCost).toHaveBeenCalledTimes(1)
  })

  it('does not turn RPC failure into a bridge rejection or offer an unverified payload', async () => {
    providers(() => quote('mayan'))
    cost.estimateSolanaSwapCost.mockResolvedValue(measurement('unavailable'))
    const out = await getSwapQuote(req, cfg)
    expect(out.quote).toBeNull()
    expect(out.error).toContain('simulation unavailable')
    expect(asked.filter(u => u.hostname === 'li.quest')).toHaveLength(1)
  })

  it('does not trust a Worker-supplied successful simulation when local RPC fails', async () => {
    // Obtain the real normalized shape, then replay it as an untrusted Worker result.
    providers(() => quote('mayan'))
    cost.estimateSolanaSwapCost.mockResolvedValue(measurement('pass'))
    const first = await getSwapQuote(req, cfg)
    providers(() => null, [first.quote])
    cost.estimateSolanaSwapCost.mockRejectedValue(new Error('RPC offline'))
    const out = await getSwapQuote(req, cfg)
    expect(out.quote).toBeNull()
    expect(out.error).toContain('simulation unavailable')
  })

  it('preserves the explicitly fee-free fallback and rejects no safety terms', async () => {
    providers(url => quote(url.searchParams.has('denyBridges') ? 'near' : 'mayan', true))
    cost.estimateSolanaSwapCost.mockImplementation(async payload => measurement(payload === 'mayan' ? 'revert' : 'pass'))
    const out = await getSwapQuote(req, cfg)
    expect(out.quote?.bridgeTool).toBe('near')
    expect(out.quote?.appFee?.verification).toBe('none-requested')
    expect(asked.filter(u => u.hostname === 'li.quest').at(-1)?.searchParams.has('fee')).toBe(false)
  })

  it('withholds a quote that expires while simulation runs', async () => {
    vi.useFakeTimers()
    providers(() => quote('mayan'))
    cost.estimateSolanaSwapCost.mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 31_000)
      return measurement('pass')
    })
    const out = await getSwapQuote(req, cfg)
    expect(out.quote).toBeNull()
    expect(out.error).toContain('expired during route checks')
  })

  it('bounds a hung simulation and does not treat it as a bridge failure', async () => {
    vi.useFakeTimers()
    providers(() => quote('mayan'))
    cost.estimateSolanaSwapCost.mockReturnValue(new Promise(() => {}))
    const result = getSwapQuote(req, cfg)
    await vi.advanceTimersByTimeAsync(10_001)
    const out = await result
    expect(out.quote).toBeNull()
    expect(out.error).toContain('simulation unavailable')
    expect(asked.filter(u => u.hostname === 'li.quest')).toHaveLength(1)
  })

  it('keeps a balance shortfall separate from a bridge input mismatch', async () => {
    providers(() => quote('mayan'))
    cost.estimateSolanaSwapCost.mockResolvedValue({ ...measurement('revert'), balanceLamports: '1000' })
    const out = await getSwapQuote(req, cfg)
    expect(out.quote).toBeNull()
    expect(out.error).toContain('SOL up front')
    expect(out.error).not.toContain('AmountInTooSmall')
    expect(asked.filter(u => u.hostname === 'li.quest')).toHaveLength(1)
  })
})

describe('real cost reader simulation evidence', () => {
  it('simulates unsigned bytes and distinguishes program errors from RPC errors', async () => {
    const { estimateSolanaSwapCost } = await vi.importActual<typeof import('./solana-swap-cost')>('./solana-swap-cost')
    const { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } = await import('@solana/web3.js')
    const payer = new PublicKey(req.taker)
    const tx = new VersionedTransaction(new TransactionMessage({
      payerKey: payer, recentBlockhash: '11111111111111111111111111111111',
      instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: SystemProgram.programId, lamports: 1 })],
    }).compileToV0Message())
    const simulate = vi.fn(async (unsigned: typeof tx, options: unknown) => {
      expect(unsigned.signatures.every(s => s.every(b => b === 0))).toBe(true)
      expect(options).toMatchObject({ sigVerify: false, replaceRecentBlockhash: true })
      return { value: { err: { InstructionError: [12, { Custom: 6025 }] }, logs: [
        `Program ${mayan} failed: custom program error: 0x1789`,
      ] } }
    })
    const rpc = {
      getMultipleAccountsInfo: async (keys: InstanceType<typeof PublicKey>[]) => keys.map(k => k.equals(payer) ? { lamports: 10_000_000, data: Buffer.alloc(0) } : null),
      simulateTransaction: simulate,
    } as unknown as import('@solana/web3.js').Connection
    const payload = Buffer.from(tx.serialize()).toString('base64')
    const rejected = await estimateSolanaSwapCost(payload, req.taker, rpc)
    expect(rejected?.simulationStatus).toBe('revert')
    expect(rejected?.simulationError).toContain('AmountInTooSmall')
    simulate.mockRejectedValueOnce(new Error('RPC offline'))
    const unavailable = await estimateSolanaSwapCost(payload, req.taker, rpc)
    expect(unavailable?.simulationStatus).toBe('unavailable')
    expect(unavailable?.simulationError).toBe('RPC offline')
  })
})

describe('program-specific Solana errors', () => {
  it('decodes Swift v2 6025 without blaming the wallet balance or global slippage', () => {
    expect(failure).toContain('AmountInTooSmall')
    expect(failure).not.toMatch(/Add SOL|increase slippage/)
    expect(describeSolanaSimulationFailure({ Custom: 6025 }, ['Program unrelated failed: custom program error: 0x1789']))
      .not.toContain('Mayan')
  })
  it('retains Anchor diagnostics that would be lost by only showing the log tail', () => {
    expect(describeSolanaSimulationFailure({}, ['Program log: AnchorError. Error Code: Example.', 'a', 'b', 'c', 'd']))
      .toContain('Error Code: Example')
  })
})
