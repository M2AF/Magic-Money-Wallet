/**
 * Guarded Base -> Solana cbADA signing. Execution is disabled in production.
 * These tests open the path only with testOnlyEnabledGate() (which refuses to
 * exist outside Vitest), a FAKE chain and well-known test keys (Anvil #0/#1).
 * Nothing reaches a network, and nothing is broadcast anywhere.
 */
import { describe, it, expect, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, getAddress, type Hex } from 'viem'
import {
  sendCbAdaApproval, sendCbAdaBridge, CcipExecutionDisabled, productionGate, testOnlyEnabledGate, BASE_CHAIN_ID,
  type CbAdaExecuteDeps, type UnsignedBaseTx,
} from './cbada-ccip-execute'
import { BASE_SOLANA_ONRAMP, CBADA_CCIP_EXECUTION_ENABLED, CcipSendError } from './cbada-ccip-send'
import { CBADA } from './cbada-ccip'
import { journeyMapStore, createJourneyWriteQueue } from './journey-store'
import { createJourney, approveLeg, authorizeCcipBridge, type StablecoinJourney } from '../shared/stablecoin-journey'

const KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // Anvil #0, public test key
const OTHER_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' // Anvil #1
const account = privateKeyToAccount(KEY)
const other = privateKeyToAccount(OTHER_KEY)
const SOL = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'
const AMOUNT = '10000000'
const FEE = 1_384_650_232_086_707n
const GAS_EST = 150_000n
const MAX_FEE_PER_GAS = 10n ** 9n // 1 gwei
const GAS_CEILING = (GAS_EST * 120n / 100n) * MAX_FEE_PER_GAS * 2n
const BASE_CB = { chain: 'base' as const, address: CBADA.base.token, symbol: 'cbADA', decimals: 6 }
const SOL_CB = { chain: 'solana' as const, address: CBADA.solana.token, symbol: 'cbADA', decimals: 6 }

function authorizedJourney(over: { amount?: string; maxFee?: bigint; gasCeiling?: bigint } = {}): StablecoinJourney {
  const amount = over.amount ?? AMOUNT
  let j = createJourney({ id: 'j1', walletId: 'w', now: 1, bridge: 'ccip-cbada', recipient: SOL, source: BASE_CB, usdcx: BASE_CB, usdc: SOL_CB, destination: SOL_CB })
  j = approveLeg(j, 'bridge', amount, 2, amount)
  return authorizeCcipBridge(j, {
    sender: account.address, accountIndex: 0, maxCcipFeeWei: ((over.maxFee ?? FEE * 2n)).toString(),
    maxApprovalGasWei: (over.gasCeiling ?? GAS_CEILING).toString(), maxSendGasWei: (over.gasCeiling ?? GAS_CEILING).toString(),
  }, 3)
}

function fakeClient(over: Record<string, unknown> = {}) {
  const v: Record<string, unknown> = {
    getFee: FEE, allowance: 10_000_000n, isChainSupported: true, getOnRamp: BASE_SOLANA_ONRAMP, isSupportedChain: true,
    getToken: CBADA.base.token,
    getCurrentRateLimiterState: [{ tokens: CBADA.laneCapacityRaw, lastUpdated: 0, isEnabled: true, capacity: CBADA.laneCapacityRaw, rate: 1n },
      { tokens: 0n, lastUpdated: 0, isEnabled: false, capacity: 0n, rate: 0n }],
    walletCbAda: 50_000_000n, poolCbAda: 0n, eth: 10n ** 17n, gas: GAS_EST, maxFeePerGas: MAX_FEE_PER_GAS, ...over,
  }
  return {
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: unknown[] }) => {
      if (functionName === 'balanceOf') return (args?.[0] as string)?.toLowerCase() === CBADA.base.pool.toLowerCase() ? v.poolCbAda : v.walletCbAda
      if (v[functionName] instanceof Error) throw v[functionName]
      return v[functionName]
    }),
    getBalance: vi.fn(async () => v.eth),
    call: vi.fn(async () => ({ data: ('0x' + 'ab'.repeat(32)) as Hex })),
    estimateGas: vi.fn(async () => v.gas as bigint),
    estimateFeesPerGas: vi.fn(async () => ({ maxFeePerGas: v.maxFeePerGas as bigint, maxPriorityFeePerGas: 10n ** 6n })),
  } as never
}

type SignMode = 'honest' | 'tamper' | 'wrong-hash' | 'other-key' | 'more-gas' | 'unsigned'
function setup(opts: { client?: ReturnType<typeof fakeClient>; saveFails?: boolean; broadcast?: (s: Hex) => Promise<string>; sign?: SignMode;
  gate?: CbAdaExecuteDeps['gate']; signer?: { address: string; accountIndex: number } } = {}) {
  let map: Record<string, string> = {}
  const order: string[] = []
  const store = journeyMapStore(async () => ({ ...map }), async (m) => {
    if (opts.saveFails) throw new Error('disk full')
    order.push('save'); map = { ...m }
  }, createJourneyWriteQueue())
  const sign = vi.fn(async (tx: UnsignedBaseTx) => {
    order.push('sign')
    const mode = opts.sign ?? 'honest'
    const signer = mode === 'other-key' ? other : account
    const req = {
      chainId: tx.chainId, to: tx.to as Hex, value: BigInt(tx.value), nonce: tx.nonce, type: 'eip1559' as const,
      data: (mode === 'tamper' ? tx.data.slice(0, -2) + (tx.data.endsWith('ff') ? '00' : 'ff') : tx.data) as Hex,
      gas: mode === 'more-gas' ? BigInt(tx.gas) * 10n : BigInt(tx.gas),
      maxFeePerGas: BigInt(tx.maxFeePerGas), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas),
    }
    if (mode === 'unsigned') {
      const { serializeTransaction } = await import('viem')
      const serialized = serializeTransaction(req)
      return { serialized, txHash: keccak256(serialized) }
    }
    const serialized = await signer.signTransaction(req)
    return { serialized, txHash: mode === 'wrong-hash' ? '0x' + 'ee'.repeat(32) : keccak256(serialized) }
  })
  const broadcast = vi.fn(opts.broadcast ?? (async (s: Hex) => { order.push('broadcast'); return keccak256(s) }))
  const deps: CbAdaExecuteDeps = {
    gate: 'gate' in opts ? opts.gate as CbAdaExecuteDeps['gate'] : testOnlyEnabledGate(), client: opts.client ?? fakeClient(),
    currentSigner: async () => opts.signer ?? { address: account.address, accountIndex: 0 },
    nonce: async () => 7, sign, broadcast, store, now: () => 10,
  }
  return { deps, sign, broadcast, order, map: () => map, store }
}

describe('the execution gate', () => {
  it('is off in production; refuses before reading or signing anything', async () => {
    expect(CBADA_CCIP_EXECUTION_ENABLED).toBe(false)
    const client = fakeClient()
    const s = setup({ client, gate: productionGate() })
    await expect(sendCbAdaBridge(authorizedJourney(), s.deps)).rejects.toThrow(CcipExecutionDisabled)
    await expect(sendCbAdaApproval(authorizedJourney(), s.deps)).rejects.toThrow(CcipExecutionDisabled)
    expect((client as { readContract: ReturnType<typeof vi.fn> }).readContract).not.toHaveBeenCalled()
    expect(s.sign).not.toHaveBeenCalled()
  })

  it('a flag supplied as a plain object (as an IPC argument would be) can never open it', async () => {
    for (const forged of [{ enabled: true }, Object.freeze({ enabled: true }), JSON.parse('{"enabled":true}'), true, undefined]) {
      const s = setup({ gate: forged as never })
      await expect(sendCbAdaBridge(authorizedJourney(), s.deps)).rejects.toThrow(CcipExecutionDisabled)
      expect(s.sign).not.toHaveBeenCalled()
    }
  })
})

describe('sendCbAdaBridge — terms come only from the stored authorization', () => {
  it('fresh reads -> validate -> simulate -> gas fits -> sign -> check signed bytes -> SAVE -> broadcast once', async () => {
    const s = setup()
    const r = await sendCbAdaBridge(authorizedJourney(), s.deps)
    expect(r.state).toBe('submitted')
    expect(s.order).toEqual(['sign', 'save', 'broadcast'])
    expect((JSON.parse(s.map().j1) as StablecoinJourney).legs[1]).toMatchObject({ state: 'submitted', txHash: (r as { txHash: string }).txHash })
    expect(s.sign.mock.calls[0][0]).toMatchObject({ chainId: BASE_CHAIN_ID, to: getAddress(CBADA.base.router), value: FEE.toString(), nonce: 7,
      gas: (GAS_EST * 120n / 100n).toString(), maxFeePerGas: MAX_FEE_PER_GAS.toString() })
  })

  it('the Base pool holding zero is not a gate for Base -> Solana', async () => {
    expect((await sendCbAdaBridge(authorizedJourney(), setup({ client: fakeClient({ poolCbAda: 0n }) }).deps)).state).toBe('submitted')
  })

  it('a journey whose terms were never authorized is refused', async () => {
    const j = { ...authorizedJourney(), authorization: null }
    await expect(sendCbAdaBridge(j, setup().deps)).rejects.toThrow(/never authorized/)
  })

  it('a different signer or account than the authorized one is refused', async () => {
    await expect(sendCbAdaBridge(authorizedJourney(), setup({ signer: { address: other.address, accountIndex: 0 } }).deps)).rejects.toThrow(/not the account that authorized/)
    await expect(sendCbAdaBridge(authorizedJourney(), setup({ signer: { address: account.address, accountIndex: 1 } }).deps)).rejects.toThrow(/not the account that authorized/)
  })

  it('the stored authorization cannot be raised afterwards', async () => {
    const s = setup()
    const j = authorizedJourney()
    await s.store.put(j)
    const raised = { ...j, authorization: { ...j.authorization!, maxCcipFeeWei: (FEE * 100n).toString() } }
    await expect(s.store.put(raised)).rejects.toThrow(/never change/)
    expect(() => authorizeCcipBridge(j, { ...j.authorization!, maxCcipFeeWei: '1' }, 4)).toThrow(/already authorized/)
  })

  it('a live fee above the authorized ceiling, or gas above its ceiling, stops before signing', async () => {
    const fee = setup({ client: fakeClient({ getFee: FEE * 3n }) })
    await expect(sendCbAdaBridge(authorizedJourney(), fee.deps)).rejects.toThrow(/above the authorized ceiling/)
    const gas = setup({ client: fakeClient({ maxFeePerGas: MAX_FEE_PER_GAS * 100n }) })
    await expect(sendCbAdaBridge(authorizedJourney(), gas.deps)).rejects.toThrow(/gas would exceed/)
    expect(fee.sign).not.toHaveBeenCalled()
    expect(gas.sign).not.toHaveBeenCalled()
  })

  it('fails closed: unreadable pool identity, unreadable gas, ETH for the fee but not the gas', async () => {
    for (const over of [{ getToken: null }, { getCurrentRateLimiterState: null },
      { getCurrentRateLimiterState: [{ tokens: 0n, capacity: CBADA.laneCapacityRaw, isEnabled: true }] },
      { gas: null }, { eth: FEE }, { getFee: new Error('rpc') }, { walletCbAda: 1n }, { isChainSupported: false }]) {
      const s = setup({ client: fakeClient(over) })
      await expect(sendCbAdaBridge(authorizedJourney(), s.deps)).rejects.toThrow(CcipSendError)
      expect(s.sign).not.toHaveBeenCalled()
    }
  })

  it('signed bytes are checked before anything is saved: hash, signer, calldata, gas, signature', async () => {
    for (const [mode, pattern] of [
      ['wrong-hash', /does not match the signed transaction/], ['other-key', /other than the authorized sender/],
      ['tamper', /different calldata/], ['more-gas', /more network gas than authorized/], ['unsigned', /not validly signed/],
    ] as const) {
      const s = setup({ sign: mode })
      await expect(sendCbAdaBridge(authorizedJourney(), s.deps)).rejects.toThrow(pattern)
      expect(s.order).toEqual(['sign'])
      expect(s.broadcast).not.toHaveBeenCalled()
    }
  })

  it('if the hash cannot be saved, nothing is broadcast', async () => {
    const s = setup({ saveFails: true })
    await expect(sendCbAdaBridge(authorizedJourney(), s.deps)).rejects.toThrow(/disk full/)
    expect(s.broadcast).not.toHaveBeenCalled()
  })

  it('a failed broadcast is recorded as uncertain and NOT retried; the step is never sent again', async () => {
    const s = setup({ broadcast: async () => { throw new Error('timeout') } })
    const r = await sendCbAdaBridge(authorizedJourney(), s.deps)
    expect(r).toMatchObject({ state: 'uncertain', reason: 'timeout' })
    expect(s.broadcast).toHaveBeenCalledTimes(1)
    const stored = JSON.parse(s.map().j1) as StablecoinJourney
    expect(stored.legs[1]).toMatchObject({ state: 'uncertain', txHash: (r as { txHash: string }).txHash })
    await expect(sendCbAdaBridge(stored, s.deps)).rejects.toThrow(/never sent again/)
  })

  it('an allowance that is still short stops the send (approve first)', async () => {
    await expect(sendCbAdaBridge(authorizedJourney(), setup({ client: fakeClient({ allowance: 0n }) }).deps)).rejects.toThrow(/not yet approved/)
  })
})

describe('sendCbAdaApproval', () => {
  it('not needed when the allowance already covers the amount', async () => {
    const s = setup()
    expect(await sendCbAdaApproval(authorizedJourney(), s.deps)).toEqual({ state: 'not-needed' })
    expect(s.sign).not.toHaveBeenCalled()
  })

  it('sends the EXACT-amount approval with its hash saved first; a second approval is never sent', async () => {
    const s = setup({ client: fakeClient({ allowance: 0n }) })
    const r = await sendCbAdaApproval(authorizedJourney(), s.deps)
    expect(r.state).toBe('submitted')
    expect(s.order).toEqual(['sign', 'save', 'broadcast'])
    expect(s.sign.mock.calls[0][0]).toMatchObject({ to: getAddress(CBADA.base.token), value: '0' })
    const stored = JSON.parse(s.map().j1) as StablecoinJourney
    expect(stored.legs[1]).toMatchObject({ state: 'approved', approvalTxHash: (r as { txHash: string }).txHash, txHash: null })
    await expect(sendCbAdaApproval(stored, s.deps)).rejects.toThrow(/not re-sent/)
    expect(s.sign).toHaveBeenCalledTimes(1)
  })

  it('needs ETH for the fee plus BOTH gas ceilings before approving', async () => {
    const s = setup({ client: fakeClient({ allowance: 0n, eth: FEE + GAS_CEILING }) })
    await expect(sendCbAdaApproval(authorizedJourney(), s.deps)).rejects.toThrow(/maximum network gas/)
    expect(s.sign).not.toHaveBeenCalled()
  })
})
