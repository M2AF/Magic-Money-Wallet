import { describe, it, expect, vi } from 'vitest'
import { journeyMapStore, restoreJourneys, createJourneyWriteQueue, JourneyStoreError } from './journey-store'
import { handleJourneyList, handleJourneyPlan, type JourneyHost } from './journey-handler'
import { createJourney, approveLeg, recordLegSubmitted, recordLegOutcome, type StablecoinJourney } from '../shared/stablecoin-journey'
import { STABLECOIN_INTERMEDIATES } from '../shared/stablecoin-route'
import type { WalletConfig } from './secure-store'

const SNEK = { chain: 'cardano' as const, address: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b', symbol: 'SNEK', decimals: 0 }
const PEPE = { chain: 'ethereum' as const, address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', symbol: 'PEPE', decimals: 18 }
const make = (id: string, now = 1) => createJourney({ id, walletId: 'w', now, bridge: 'xreserve-cardano-ethereum', recipient: '0xabc',
  source: SNEK, usdcx: STABLECOIN_INTERMEDIATES.cardano, usdc: STABLECOIN_INTERMEDIATES.ethereum, destination: PEPE })

function memory(initial: Record<string, string> = {}, opts: { slowSave?: boolean } = {}) {
  let map = { ...initial }
  const save = vi.fn(async (m: Record<string, string>) => {
    if (opts.slowSave) await new Promise(r => setTimeout(r, 5))
    map = { ...m }
  })
  return { load: async () => ({ ...map }), save, peek: () => map }
}

describe('journeyMapStore', () => {
  it('round-trips journeys through the platform map', async () => {
    const m = memory()
    const s = journeyMapStore(m.load, m.save, createJourneyWriteQueue())
    await s.put(make('a'))
    expect(await s.get('a')).toEqual(make('a'))
    expect((await s.list()).journeys.map(j => j.id)).toEqual(['a'])
    expect(await s.get('missing')).toBeNull()
  })

  it('concurrent saves through one queue do not drop each other', async () => {
    const m = memory({}, { slowSave: true })
    const q = createJourneyWriteQueue()
    // Two store objects over the same map, as two router calls would create.
    await Promise.all([journeyMapStore(m.load, m.save, q).put(make('a')), journeyMapStore(m.load, m.save, q).put(make('b'))])
    expect(Object.keys(m.peek()).sort()).toEqual(['a', 'b'])
  })

  it('refuses every regression of a stored journey', async () => {
    const m = memory()
    const s = journeyMapStore(m.load, m.save, createJourneyWriteQueue())
    let j = approveLeg(make('a'), 'source-swap', '10', 2, '10')
    j = recordLegSubmitted(j, 'source-swap', 'aa'.repeat(32), 3)
    await s.put(j)
    const swapHash = (x: StablecoinJourney, h: string | null) => ({ ...x, legs: [{ ...x.legs[0], txHash: h }, x.legs[1], x.legs[2]] }) as StablecoinJourney
    await expect(s.put(swapHash(j, 'bb'.repeat(32)))).rejects.toThrow(/never replaced/)
    await expect(s.put({ ...j, recipient: '0xother' })).rejects.toThrow(/identity/)
    const done = recordLegOutcome(j, 'source-swap', { state: 'confirmed', measuredOutputRaw: '5' }, 4)
    await s.put(done)
    await expect(s.put({ ...done, legs: [{ ...done.legs[0], measuredOutputRaw: '6' }, done.legs[1], done.legs[2]] } as StablecoinJourney)).rejects.toThrow(/confirmed step/)
    const stopped = { ...done, status: 'stopped' as const }
    await s.put(stopped)
    await expect(s.put({ ...stopped, status: 'active' })).rejects.toThrow(/reopened/)
  })

  it('an unreadable record is reported and kept; it is never overwritten', async () => {
    const m = memory({ a: '{"broken"', b: JSON.stringify(make('b')) })
    const s = journeyMapStore(m.load, m.save, createJourneyWriteQueue())
    expect(await s.list()).toMatchObject({ unreadable: ['a'], journeys: [expect.objectContaining({ id: 'b' })] })
    await expect(s.put(make('a'))).rejects.toThrow(JourneyStoreError)
    await expect(s.get('a')).rejects.toThrow(/unreadable/)
    await s.put(make('c'))
    expect(m.peek().a).toBe('{"broken"')
  })

  it('a damaged map is an error, never "no journeys"', async () => {
    const s = journeyMapStore(async () => { throw new Error('The stored journeys are unreadable; they were left untouched.') }, vi.fn(), createJourneyWriteQueue())
    await expect(s.list()).rejects.toThrow(/unreadable/)
    await expect(s.put(make('a'))).rejects.toThrow(/unreadable/)
  })

  it('refuses ids that cannot be keys, and anything the parser would not read back', async () => {
    const m = memory()
    const s = journeyMapStore(m.load, m.save, createJourneyWriteQueue())
    await expect(s.put(make('bad id!'))).rejects.toThrow(/Invalid journey id/)
    await expect(s.put({ ...make('x'), legs: [{ ...make('x').legs[0], cbor: '84' } as never, make('x').legs[1], make('x').legs[2]] })).rejects.toThrow()
    expect(m.save).not.toHaveBeenCalled()
  })
})

describe('restoreJourneys', () => {
  it('resumes active journeys of any age and lists the hashes to read from the chain, never to re-send', async () => {
    let a = approveLeg(make('a', 1), 'source-swap', '10', 2, '10')
    a = recordLegOutcome(recordLegSubmitted(a, 'source-swap', 'aa'.repeat(32), 3), 'source-swap', { state: 'uncertain' }, 4)
    const finished = { ...make('z', 0), status: 'stopped' as const }
    const m = memory({ a: JSON.stringify(a), z: JSON.stringify(finished), broken: 'x' })
    const r = await restoreJourneys(journeyMapStore(m.load, m.save, createJourneyWriteQueue()))
    expect(r.active.map(j => j.id)).toEqual(['a'])
    expect(r.awaitingEvidence).toEqual([{ journeyId: 'a', role: 'source-swap', txHash: 'aa'.repeat(32), providerRef: null }])
    expect(r.finished.map(j => j.id)).toEqual(['z'])
    expect(r.unreadable).toEqual(['broken'])
    expect(m.save).not.toHaveBeenCalled()
  })
})

describe('journey handlers', () => {
  const host = (over: Partial<JourneyHost> = {}): JourneyHost => ({
    loadConfig: async () => ({ network: 'mainnet' }) as unknown as WalletConfig,
    loadAddresses: async () => ({ cardano: 'addr1q950qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqcg9c9h', evm: '0x720f28c62b844e7dd8705ab0a7651f3f575384f4', solana: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV' }),
    loadJourneys: async () => ({}), saveJourneys: vi.fn(),
    deps: { quote: vi.fn(async () => ({ quote: null, error: 'no route' })), prepareEthereum: vi.fn(), prepareSolana: vi.fn(),
      ccip: { feeBaseToSolana: vi.fn(async () => null), baseReleaseLiquidity: vi.fn(async () => 0n) } },
    ...over,
  })
  const req = {
    fromChain: 'base', fromToken: { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
    toChain: 'solana', toToken: { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 },
    sellAmountRaw: '100000000', slippageBps: 50,
  }

  it('plans with the wallet\'s own addresses; unsupported pairs, testnet and bad input are refused', async () => {
    const h = host()
    const r = await handleJourneyPlan({ ...req, recipient: 'attacker' }, h)
    expect(r.ok).toBe(true)
    expect((h.deps!.quote as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({ taker: '0x720f28c62b844e7dd8705ab0a7651f3f575384f4' })
    expect(await handleJourneyPlan({ ...req, toChain: 'ethereum' }, h)).toMatchObject({ ok: false })
    expect(await handleJourneyPlan(req, host({ loadConfig: async () => ({ testnetMode: true }) as WalletConfig }))).toMatchObject({ ok: false })
    expect(await handleJourneyPlan({ ...req, sellAmountRaw: '0' }, h)).toMatchObject({ ok: false })
    expect(await handleJourneyPlan({ ...req, toToken: { ...req.toToken, address: 'nope' } }, h)).toMatchObject({ ok: false })
  })

  it('lists persisted journeys read-only', async () => {
    const saveJourneys = vi.fn()
    // make() journeys belong to wallet 'w'; the host's wallet is 0x720f...|7EcD..., so they are counted, not shown.
    const mine = { ...make('m'), walletId: '0x720f28c62b844e7dd8705ab0a7651f3f575384f4|7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV' }
    const r = await handleJourneyList(host({ loadJourneys: async () => ({ a: JSON.stringify(make('a')), m: JSON.stringify(mine) }), saveJourneys }))
    expect(r).toMatchObject({ ok: true, value: { active: [{ id: 'm' }], otherWallets: 1, awaitingEvidence: 0, finished: 0, unreadable: [] } })
    expect(saveJourneys).not.toHaveBeenCalled()
  })
})
