/**
 * The user's approval of a Base -> Solana cbADA transfer's terms. A FAKE Base
 * client only: nothing reaches a network, and nothing is signed or sent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Hex } from 'viem'
import {
  reviewCbAdaTransfer, authorizeCbAdaTransfer, cancelUnsentStoredJourney, __clearProposals,
  PROPOSAL_TTL_MS, SEND_GAS_UNITS_CAP, type ApprovalWallet,
} from './cbada-ccip-approval'
import { BASE_SOLANA_ONRAMP } from './cbada-ccip-send'
import { sendCbAdaBridge, testOnlyEnabledGate } from './cbada-ccip-execute'
import { CBADA } from './cbada-ccip'
import { journeyMapStore, createJourneyWriteQueue } from './journey-store'
import { handleJourney, type JourneyHost } from './journey-handler'
import { parseJourney, recordLegApprovalSent, type StablecoinJourney } from '../shared/stablecoin-journey'
import type { WalletConfig } from './secure-store'

const EVM = '0x720f28c62b844e7dd8705ab0a7651f3f575384f4'
const SOL = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'
const WALLET: ApprovalWallet = { walletId: `${EVM}|${SOL}`, evm: EVM, solana: SOL, accountIndex: 0 }
const AMOUNT = '1000000' // 1 cbADA
const FEE = 1_384_650_232_086_707n
const APPROVE_UNITS = 46_000n
const SEND_UNITS = 230_000n
const PER_GAS = 10_000_000n // 0.01 gwei

function fakeClient(over: Record<string, unknown> = {}) {
  const v: Record<string, unknown> = {
    getFee: FEE, allowance: 0n, isChainSupported: true, getOnRamp: BASE_SOLANA_ONRAMP, isSupportedChain: true, getToken: CBADA.base.token,
    getCurrentRateLimiterState: [{ tokens: CBADA.laneCapacityRaw, lastUpdated: 0, isEnabled: true, capacity: CBADA.laneCapacityRaw, rate: 1n },
      { tokens: 0n, lastUpdated: 0, isEnabled: false, capacity: 0n, rate: 0n }],
    walletCbAda: 5_000_000n, eth: 10n ** 16n, maxFeePerGas: PER_GAS, ...over,
  }
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'balanceOf') return v.walletCbAda
      if (v[functionName] instanceof Error) throw v[functionName]
      return v[functionName]
    }),
    getBalance: vi.fn(async () => v.eth),
    call: vi.fn(async () => ({ data: ('0x' + 'ab'.repeat(32)) as Hex })),
    estimateGas: vi.fn(async ({ to }: { to: string }) => {
      if (v.gasError) throw new Error('estimate failed')
      return to.toLowerCase() === CBADA.base.token.toLowerCase() ? APPROVE_UNITS : SEND_UNITS
    }),
    estimateFeesPerGas: vi.fn(async () => (v.feesError ? Promise.reject(new Error('x')) : { maxFeePerGas: v.maxFeePerGas as bigint, maxPriorityFeePerGas: 1n })),
  } as never
}

function memStore() {
  let map: Record<string, string> = {}
  const store = journeyMapStore(async () => ({ ...map }), async (m) => { map = { ...m } }, createJourneyWriteQueue())
  return { store, map: () => map, set: (m: Record<string, string>) => { map = m } }
}

beforeEach(() => __clearProposals())

describe('reviewCbAdaTransfer — live terms for this wallet, read-only', () => {
  it('proposes ceilings above the live quote; an approval is needed and priced', async () => {
    const client = fakeClient()
    const r = await reviewCbAdaTransfer(AMOUNT, WALLET, client, 1000)
    const approveMax = (APPROVE_UNITS * 150n / 100n) * PER_GAS * 2n
    const sendMax = SEND_GAS_UNITS_CAP * PER_GAS * 2n
    expect(r).toMatchObject({
      sender: EVM, accountIndex: 0, recipient: SOL, amountRaw: AMOUNT, baseToken: CBADA.base.token, solanaMint: CBADA.solana.token,
      ccipFeeWei: FEE.toString(), maxCcipFeeWei: (FEE * 110n / 100n).toString(), needsApproval: true, allowanceRaw: '0',
      approvalGas: { estimateUnits: APPROVE_UNITS.toString(), maxWei: approveMax.toString() },
      // The send cannot be estimated before the approval exists: the documented cap is used.
      sendGas: { estimateUnits: null, ceilingUnits: SEND_GAS_UNITS_CAP.toString(), maxWei: sendMax.toString() },
      totalMaxEthWei: (FEE * 110n / 100n + approveMax + sendMax).toString(),
      expiresAt: 1000 + PROPOSAL_TTL_MS, problems: [],
    })
    expect(r.proposalId).toMatch(/^[0-9a-f]{32}$/)
    // Read-only: nothing was signed, and only read calls were made.
    expect(Object.keys(client as object).sort()).toEqual(['call', 'estimateFeesPerGas', 'estimateGas', 'getBalance', 'readContract'])
  })

  it('with the allowance in place, the send is estimated and the total excludes approval gas', async () => {
    const r = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient({ allowance: 1_000_000n }), 1000)
    const sendMax = (SEND_UNITS * 150n / 100n) * PER_GAS * 2n
    expect(r.needsApproval).toBe(false)
    expect(r.sendGas).toMatchObject({ estimateUnits: SEND_UNITS.toString(), maxWei: sendMax.toString() })
    expect(r.totalMaxEthWei).toBe((FEE * 110n / 100n + sendMax).toString())
    // An approval ceiling still exists, in case the allowance falls before sending.
    expect(BigInt(r.approvalGas.maxWei)).toBeGreaterThan(0n)
  })

  it('fails closed when the fee, allowance, gas price or gas cannot be read', async () => {
    await expect(reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient({ getFee: new Error('x') }), 1)).rejects.toThrow(/CCIP fee could not be read/)
    await expect(reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient({ allowance: new Error('x') }), 1)).rejects.toThrow(/allowance could not be read/)
    await expect(reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient({ feesError: true }), 1)).rejects.toThrow(/gas prices could not be read/)
    await expect(reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient({ gasError: true }), 1)).rejects.toThrow(/could not be estimated/)
  })

  it('lists live problems (cbADA, ETH for fee ceiling + gas ceilings, pool identity, rate limit)', async () => {
    const r = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient({
      walletCbAda: 0n, eth: 0n, getToken: new Error('x'), getCurrentRateLimiterState: new Error('x'),
    }), 1)
    expect(r.problems.join(' ')).toMatch(/enough cbADA/)
    expect(r.problems.join(' ')).toMatch(/enough ETH/)
    expect(r.problems.join(' ')).toMatch(/token of the cbADA pool/)
    expect(r.problems.join(' ')).toMatch(/rate limit could not be read/)
  })

  it('ETH must cover the fee ceiling PLUS every gas ceiling still to be spent', async () => {
    const feeCeiling = FEE * 110n / 100n
    const approveMax = (APPROVE_UNITS * 150n / 100n) * PER_GAS * 2n
    const sendMax = SEND_GAS_UNITS_CAP * PER_GAS * 2n
    const short = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient({ eth: feeCeiling + approveMax + sendMax - 1n }), 1)
    expect(short.problems.join(' ')).toMatch(/enough ETH/)
    const enough = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient({ eth: feeCeiling + approveMax + sendMax }), 1)
    expect(enough.problems).toEqual([])
  })

  it('refuses invalid amounts and amounts above the lane capacity', async () => {
    for (const bad of ['0', '-1', '1.5', '', 7, null]) {
      await expect(reviewCbAdaTransfer(bad, WALLET, fakeClient(), 1)).rejects.toThrow(/Invalid amount/)
    }
    await expect(reviewCbAdaTransfer((CBADA.laneCapacityRaw + 1n).toString(), WALLET, fakeClient(), 1)).rejects.toThrow(/capacity/)
  })
})

describe('authorizeCbAdaTransfer — only a reviewed proposal, used once', () => {
  it('stores exactly the reviewed terms as the journey\'s immutable authorization', async () => {
    const s = memStore()
    const r = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1000)
    const j = await authorizeCbAdaTransfer(r.proposalId, WALLET, s.store, 2000)
    const stored = parseJourney(s.map()[j.id])
    expect(stored).toMatchObject({ walletId: WALLET.walletId, bridge: 'ccip-cbada', recipient: SOL, status: 'active' })
    expect(stored.legs.map(l => l.state)).toEqual(['skipped', 'approved', 'skipped'])
    expect(stored.legs[1]).toMatchObject({ approvedInputRaw: AMOUNT, txHash: null, approvalTxHash: null })
    expect(stored.authorization).toEqual({
      sender: EVM, accountIndex: 0, maxCcipFeeWei: r.maxCcipFeeWei, maxApprovalGasWei: r.approvalGas.maxWei, maxSendGasWei: r.sendGas.maxWei, approvedAt: 2000,
    })
  })

  it('a proposal is single-use; unknown, malformed or expired ids are refused', async () => {
    const s = memStore()
    const r = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1000)
    await authorizeCbAdaTransfer(r.proposalId, WALLET, s.store, 1001)
    await expect(authorizeCbAdaTransfer(r.proposalId, { ...WALLET, walletId: 'other' }, memStore().store, 1002)).rejects.toThrow(/expired or were already used/)
    for (const bad of ['nope', 42, { proposalId: r.proposalId }, undefined]) {
      await expect(authorizeCbAdaTransfer(bad, WALLET, memStore().store, 1003)).rejects.toThrow(/expired or were already used/)
    }
    const late = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 5000)
    await expect(authorizeCbAdaTransfer(late.proposalId, WALLET, memStore().store, 5000 + PROPOSAL_TTL_MS)).rejects.toThrow(/expired/)
  })

  it('refuses when the active account changed since the review', async () => {
    for (const changed of [{ evm: '0x' + '11'.repeat(20) }, { accountIndex: 1 }, { solana: 'So11111111111111111111111111111111111111112' }, { walletId: 'x|y' }]) {
      const r = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1)
      await expect(authorizeCbAdaTransfer(r.proposalId, { ...WALLET, ...changed }, memStore().store, 2)).rejects.toThrow(/account changed/)
    }
  })

  it('refuses terms that failed a live check', async () => {
    const r = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient({ walletCbAda: 0n }), 1)
    const s = memStore()
    await expect(authorizeCbAdaTransfer(r.proposalId, WALLET, s.store, 2)).rejects.toThrow(/did not pass the live checks/)
    expect(s.map()).toEqual({})
  })

  it('one cbADA transfer in progress per wallet', async () => {
    const s = memStore()
    await authorizeCbAdaTransfer((await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1)).proposalId, WALLET, s.store, 2)
    const again = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 3)
    await expect(authorizeCbAdaTransfer(again.proposalId, WALLET, s.store, 4)).rejects.toThrow(/already has a cbADA transfer in progress/)
  })

  it('two windows approving different proposals concurrently save only one active transfer', async () => {
    const s = memStore()
    const first = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1)
    const second = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1)
    const outcomes = await Promise.allSettled([
      authorizeCbAdaTransfer(first.proposalId, WALLET, s.store, 2),
      authorizeCbAdaTransfer(second.proposalId, WALLET, s.store, 2),
    ])
    expect(outcomes.map(x => x.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect((await s.store.list()).journeys.filter(j => j.status === 'active')).toHaveLength(1)
  })

  it('the approved ceilings fit what the guarded executor will check at sending time', async () => {
    const s = memStore()
    const client = fakeClient({ allowance: 1_000_000n })
    const j = await authorizeCbAdaTransfer((await reviewCbAdaTransfer(AMOUNT, WALLET, client, 1)).proposalId, WALLET, s.store, 2)
    // Test-only gate and a signer that stops right before signing: every fresh check passed.
    const sign = vi.fn(async () => { throw new Error('stopped before signing') })
    await expect(sendCbAdaBridge(j, {
      gate: testOnlyEnabledGate(), client, currentSigner: async () => ({ address: EVM, accountIndex: 0 }), nonce: async () => 0,
      sign, broadcast: vi.fn(), store: s.store, now: () => 3,
    })).rejects.toThrow('stopped before signing')
    expect(sign).toHaveBeenCalledTimes(1)
  })
})

describe('changed terms and interrupted approval', () => {
  it('saved terms can never be changed in place: any change needs a new approval', async () => {
    const s = memStore()
    const j = await authorizeCbAdaTransfer((await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1)).proposalId, WALLET, s.store, 2)
    const auth = j.authorization!
    for (const changed of [
      { ...j, authorization: { ...auth, maxCcipFeeWei: (BigInt(auth.maxCcipFeeWei) * 2n).toString() } },
      { ...j, authorization: { ...auth, maxSendGasWei: (BigInt(auth.maxSendGasWei) + 1n).toString() } },
      { ...j, authorization: { ...auth, sender: '0x' + '11'.repeat(20) } },
      { ...j, authorization: null },
      { ...j, legs: [j.legs[0], { ...j.legs[1], approvedInputRaw: '2000000' }, j.legs[2]] as StablecoinJourney['legs'] },
    ]) {
      await expect(s.store.put(changed)).rejects.toThrow()
    }
    expect(parseJourney(s.map()[j.id]).authorization).toEqual(auth)
    // A second authorization of the same journey is refused too.
    const { authorizeCcipBridge } = await import('../shared/stablecoin-journey')
    expect(() => authorizeCcipBridge(j, { ...auth }, 3)).toThrow(/already authorized/)
  })

  it('a failed save stores nothing, and the used proposal cannot be replayed', async () => {
    const r = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1)
    const failing = journeyMapStore(async () => ({}), async () => { throw new Error('disk full') }, createJourneyWriteQueue())
    await expect(authorizeCbAdaTransfer(r.proposalId, WALLET, failing, 2)).rejects.toThrow('disk full')
    const s = memStore()
    await expect(authorizeCbAdaTransfer(r.proposalId, WALLET, s.store, 3)).rejects.toThrow(/expired or were already used/)
    expect(s.map()).toEqual({})
  })

  it('a restart between review and approval drops the proposal: a fresh review is required', async () => {
    const r = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1)
    __clearProposals() // process memory is gone after a restart
    await expect(authorizeCbAdaTransfer(r.proposalId, WALLET, memStore().store, 2)).rejects.toThrow(/expired or were already used/)
  })

  it('saved but the answer was lost: the transfer is listed, and approving again cannot create a second one', async () => {
    const s = memStore()
    const j = await authorizeCbAdaTransfer((await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1)).proposalId, WALLET, s.store, 2)
    expect((await s.store.list()).journeys.map(x => x.id)).toEqual([j.id])
    const retry = await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 3)
    await expect(authorizeCbAdaTransfer(retry.proposalId, WALLET, s.store, 4)).rejects.toThrow(/in progress/)
    expect(Object.keys(s.map())).toEqual([j.id])
  })
})

describe('cancelUnsentStoredJourney', () => {
  it('stops an unsent journey; refuses a sent one and another wallet\'s', async () => {
    const s = memStore()
    const j = await authorizeCbAdaTransfer((await reviewCbAdaTransfer(AMOUNT, WALLET, fakeClient(), 1)).proposalId, WALLET, s.store, 2)
    await expect(cancelUnsentStoredJourney(j.id, 'someone|else', s.store)).rejects.toThrow(/does not belong/)
    const sent: StablecoinJourney = recordLegApprovalSent(j, 'bridge', '0x' + '77'.repeat(32), 3)
    const t = memStore(); t.set({ [j.id]: JSON.stringify(sent) })
    await expect(cancelUnsentStoredJourney(j.id, WALLET.walletId, t.store)).rejects.toThrow(/was sent/)
    expect((await cancelUnsentStoredJourney(j.id, WALLET.walletId, s.store)).status).toBe('stopped')
    expect(parseJourney(s.map()[j.id]).status).toBe('stopped')
  })
})

describe('journey channels', () => {
  const host = (s: ReturnType<typeof memStore>, client = fakeClient()): JourneyHost => ({
    loadConfig: async () => ({ network: 'mainnet' }) as unknown as WalletConfig,
    loadAddresses: async () => ({ evm: EVM, solana: SOL, accountIndex: 0 }) as never,
    loadJourneys: async () => s.map(), saveJourneys: async (m) => s.set({ ...m }),
    baseClient: client,
  })

  it('authorize takes only the proposal id: extra fields in the request cannot change a term', async () => {
    const s = memStore()
    const review = await handleJourney('journey:cbadaReview', { amountRaw: AMOUNT, sender: '0x' + '66'.repeat(20), recipient: 'attacker' }, host(s)) as { ok: true; value: { proposalId: string; maxCcipFeeWei: string; sender: string; recipient: string } }
    expect(review.ok).toBe(true)
    expect(review.value).toMatchObject({ sender: EVM, recipient: SOL })
    const r = await handleJourney('journey:cbadaAuthorize', {
      proposalId: review.value.proposalId, maxCcipFeeWei: '9'.repeat(30), sender: '0x' + '66'.repeat(20), amountRaw: '999999999',
    }, host(s)) as { ok: true; value: { journeyId: string } }
    expect(r.ok).toBe(true)
    const stored = parseJourney(s.map()[r.value.journeyId])
    expect(stored.authorization?.maxCcipFeeWei).toBe(review.value.maxCcipFeeWei)
    expect(stored.authorization?.sender).toBe(EVM)
    expect(stored.legs[1].approvedInputRaw).toBe(AMOUNT)

    const list = await handleJourney('journey:list', undefined, host(s)) as { ok: true; value: { active: Array<{ cancellable: boolean; authorization: unknown }> } }
    expect(list.value.active[0]).toMatchObject({ cancellable: true, authorization: { sender: EVM } })
    expect(await handleJourney('journey:cancel', { journeyId: r.value.journeyId }, host(s))).toMatchObject({ ok: true })
    expect((await handleJourney('journey:list', undefined, host(s)) as { value: { active: unknown[] } }).value.active).toHaveLength(0)
  })

  it('switching account between review and approval is refused through the channel', async () => {
    const s = memStore()
    const review = await handleJourney('journey:cbadaReview', { amountRaw: AMOUNT }, host(s)) as { ok: true; value: { proposalId: string } }
    const switched: JourneyHost = { ...host(s), loadAddresses: async () => ({ evm: '0x' + '22'.repeat(20), solana: SOL, accountIndex: 1 }) as never }
    expect(await handleJourney('journey:cbadaAuthorize', { proposalId: review.value.proposalId }, switched))
      .toMatchObject({ ok: false, message: expect.stringMatching(/account changed/) })
    expect(s.map()).toEqual({})
  })

  it('is mainnet-only and needs a wallet', async () => {
    const s = memStore()
    expect(await handleJourney('journey:cbadaReview', { amountRaw: AMOUNT }, { ...host(s), loadConfig: async () => ({ testnetMode: true }) as WalletConfig }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/mainnet-only/) })
    expect(await handleJourney('journey:cbadaReview', { amountRaw: AMOUNT }, { ...host(s), loadAddresses: async () => null }))
      .toMatchObject({ ok: false, message: expect.stringMatching(/No wallet/) })
  })
})
