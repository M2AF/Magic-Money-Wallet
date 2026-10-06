/**
 * Stablecoin route planning: composition of the existing quote path and the
 * bridge preparation adapters. Dependencies are fakes; the adapters themselves
 * are tested against live fixtures in their own files. No network.
 */
import { describe, it, expect, vi } from 'vitest'
import { planStablecoinRoute, cardanoRemoteDepositor, type StablecoinRouteDeps, type StablecoinRouteRequest } from './stablecoin-route-plan'
import { ProviderFault } from './xreserve-cardano-provider'
import { STABLECOIN_INTERMEDIATES, bridgeCapability } from '../shared/stablecoin-route'
import type { SwapQuoteRequest } from './swap-proxy'
import { encodeCardanoAddress } from './cardano-tx-inspect'
import { decodeCardanoAddress } from './cardano-pure'

const WALLET = 'addr1q950qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqcg9c9h'
const SNEK = { address: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b', symbol: 'SNEK', decimals: 0 }
const USDCX = STABLECOIN_INTERMEDIATES.cardano
const PEPE = { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', symbol: 'PEPE', decimals: 18 }
const BONK = { address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', symbol: 'BONK', decimals: 5 }
const EVM_RECIPIENT = '0x720f28c62b844e7dd8705ab0a7651f3f575384f4'
const SOL_RECIPIENT = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'

const quoteOf = (req: SwapQuoteRequest, out: string, min = out) => ({
  quote: { provider: req.fromChain === 'cardano' ? 'minswap' : 'lifi', buyAmountRaw: out, minBuyAmountRaw: min,
    bridgeTool: req.fromChain === 'cardano' ? 'Danogo CLMM' : 'LI.FI', expiresAt: 1000 + out.length } as never,
  error: null,
})

function deps(over: Partial<StablecoinRouteDeps> = {}): StablecoinRouteDeps & { calls: SwapQuoteRequest[] } {
  const calls: SwapQuoteRequest[] = []
  return {
    calls,
    quote: vi.fn(async (req: SwapQuoteRequest) => {
      calls.push(req)
      // SNEK -> USDCx: expect 26.0, guaranteed 25.0. USDC -> token: 1000x.
      return req.fromChain === 'cardano' ? quoteOf(req, '26000000', '25000000') : quoteOf(req, (BigInt(req.sellAmountRaw) * 1000n).toString())
    }),
    prepareEthereum: vi.fn(async (input) => ({
      network: 'mainnet', recipient: input.recipient, remoteDepositor: input.remoteDepositor, destinationDomain: 0,
      amountRaw: (BigInt(input.amount.replace('.', ''))).toString(), maxFeeRaw: '2000000',
      burnAmountRaw: '0', maxBlockHeight: '1', encoded: '0x', transferSpecHash: '0x' + 'ab'.repeat(32), executable: false,
    }) as never),
    prepareSolana: vi.fn(async (input) => ({
      destination: 'solana', mintRecipient: '0x', remoteDepositor: input.remoteDepositor,
      amountRaw: BigInt(input.amount.replace('.', '')).toString(), burnFeeRaw: '1015650', burnAmountRaw: '0',
      forwardingMaxFeeRaw: BigInt(input.forwardingMaxFee.replace('.', '')).toString(), minFinalityThreshold: 2000,
      maxBlockHeight: '1', encoded: '0x', transferSpecHash: '0x' + 'cd'.repeat(32), recipientConvention: 'unverified', executable: false,
    }) as never),
    ...over,
  }
}

const ethReq = (over: Partial<StablecoinRouteRequest> = {}): StablecoinRouteRequest => ({
  source: SNEK, sellAmountRaw: '10000', destination: { chain: 'ethereum', token: PEPE, recipient: EVM_RECIPIENT },
  cardanoAddress: WALLET, slippageBps: 50, burnFeeCapRaw: '2000000', ...over,
})

describe('planStablecoinRoute — SNEK -> USDCx -> Ethereum USDC -> PEPE', () => {
  it('composes three legs on floors and never marks the plan executable', async () => {
    const d = deps()
    const plan = await planStablecoinRoute(ethReq(), d)
    const [src, bridge, dst] = plan.legs
    expect(src).toMatchObject({ status: 'quoted', from: { address: SNEK.address }, to: { address: USDCX.address }, minOutRaw: '25000000', via: 'Danogo CLMM' })
    // Bridge asks for the source FLOOR less the fee cap: 25 - 2 = 23 USDC.
    expect(d.prepareEthereum).toHaveBeenCalledWith(expect.objectContaining({ amount: '23.000000', maxFeeRaw: '2000000', recipient: EVM_RECIPIENT }))
    expect(bridge).toMatchObject({ status: 'prepared', usdcxInRaw: '25000000', releaseRaw: '23000000', destinationFloorRaw: '23000000' })
    expect(dst).toMatchObject({ status: 'quoted', inputBasis: 'indicative', sellAmountRaw: '23000000', from: { address: STABLECOIN_INTERMEDIATES.ethereum.address } })
    expect(plan.executable).toBe(false)
    expect(plan.indicativeFinalMinRaw).toBe('23000000000')
    expect(plan.expiresAt).toBe(Math.min(src.expiresAt!, dst.expiresAt!))
    expect(plan.legs[1].capability.blockers.join(' ')).toMatch(/not yet been validated/)
  })

  it('the bridge depositor is the measured key-hash form of the wallet', async () => {
    const d = deps()
    await planStablecoinRoute(ethReq(), d)
    expect((d.prepareEthereum as ReturnType<typeof vi.fn>).mock.calls[0][0].remoteDepositor).toBe(cardanoRemoteDepositor(WALLET))
    expect(cardanoRemoteDepositor(WALLET)).toMatch(/^0x00000001[0-9a-f]{56}$/)
  })

  it('USDCx already held: the source leg is skipped and the exact amount bridges', async () => {
    const d = deps()
    const plan = await planStablecoinRoute(ethReq({ source: { address: USDCX.address, symbol: 'USDCx', decimals: 6 }, sellAmountRaw: '5000000' }), d)
    expect(plan.legs[0].status).toBe('skipped')
    expect(d.calls.filter(c => c.fromChain === 'cardano')).toHaveLength(0)
    expect(plan.legs[1]).toMatchObject({ usdcxInRaw: '5000000', releaseRaw: '3000000' })
  })

  it('USDC wanted on Ethereum: the destination leg is skipped', async () => {
    const plan = await planStablecoinRoute(ethReq({ destination: { chain: 'ethereum', token: { address: STABLECOIN_INTERMEDIATES.ethereum.address.toLowerCase(), symbol: 'USDC', decimals: 6 }, recipient: EVM_RECIPIENT } }), deps())
    expect(plan.legs[2].status).toBe('skipped')
    expect(plan.indicativeFinalMinRaw).toBe('23000000')
  })

  it('no fee ceiling: the bridge is not priced, but both swap legs are still discovered', async () => {
    const d = deps()
    const plan = await planStablecoinRoute(ethReq({ burnFeeCapRaw: undefined }), d)
    expect(plan.legs[1].status).toBe('needs-fee-cap')
    expect(d.prepareEthereum).not.toHaveBeenCalled()
    expect(plan.legs[2]).toMatchObject({ status: 'quoted', sellAmountRaw: '25000000', inputBasis: 'indicative' })
    expect(plan.indicativeFinalMinRaw).toBeNull()
  })

  it('Circle unavailable: the bridge says why; swap legs are still discovered', async () => {
    const d = deps({ prepareEthereum: vi.fn(async () => { throw new ProviderFault('unavailable', 'Circle withdrawal: HTTP 503') }) })
    const plan = await planStablecoinRoute(ethReq(), d)
    expect(plan.legs[1]).toMatchObject({ status: 'unavailable', reason: 'Circle withdrawal: HTTP 503' })
    expect(plan.legs[0].status).toBe('quoted')
    expect(plan.legs[2].status).toBe('quoted')
  })

  it('no source liquidity: an explicit unavailable route, no guessed conversion', async () => {
    const d = deps({ quote: vi.fn(async () => ({ quote: null, error: 'No route could be offered safely for this swap.' })) })
    const plan = await planStablecoinRoute(ethReq(), d)
    expect(plan.legs[0]).toMatchObject({ status: 'unavailable', reason: 'No route could be offered safely for this swap.' })
    expect(plan.legs[1].status).toBe('waiting-on-source')
    expect(plan.legs[2].status).toBe('unavailable')
    expect(d.prepareEthereum).not.toHaveBeenCalled()
  })

  it('an amount that does not cover the fee ceiling is below minimum', async () => {
    const d = deps({ quote: vi.fn(async (req: SwapQuoteRequest) => quoteOf(req, '2000000', '1500000')) })
    expect((await planStablecoinRoute(ethReq(), d)).legs[1].status).toBe('below-minimum')
  })
})

describe('planStablecoinRoute — Solana via Arc forwarding', () => {
  const solReq = (over: Partial<StablecoinRouteRequest> = {}): StablecoinRouteRequest => ethReq({
    destination: { chain: 'solana', token: BONK, recipient: SOL_RECIPIENT }, forwardingFeeCapRaw: '1000000', ...over,
  })

  it('subtracts the forwarding ceiling from what can arrive, and quotes the Solana leg on that floor', async () => {
    const d = deps()
    const plan = await planStablecoinRoute(solReq(), d)
    expect(d.prepareSolana).toHaveBeenCalledWith(expect.objectContaining({ amount: '23.000000', forwardingMaxFee: '1.000000', fastFinality: false, solanaRecipient: SOL_RECIPIENT }))
    expect(plan.legs[1]).toMatchObject({ status: 'prepared', releaseRaw: '23000000', forwardingMaxFeeRaw: '1000000', destinationFloorRaw: '22000000' })
    expect(plan.legs[2]).toMatchObject({ sellAmountRaw: '22000000', from: { address: STABLECOIN_INTERMEDIATES.solana.address } })
    expect(plan.legs[1].capability.blockers.join(' ')).toMatch(/token account/)
  })

  it('without a forwarding ceiling the Solana bridge is not priced', async () => {
    expect((await planStablecoinRoute(solReq({ forwardingFeeCapRaw: undefined }), deps())).legs[1].status).toBe('needs-fee-cap')
  })
})

describe('bridge capability and depositor', () => {
  it('only Ethereum and Solana are bridge destinations; neither is executable', () => {
    expect(bridgeCapability('ethereum')).toMatchObject({ status: 'prepare-only', executable: false })
    expect(bridgeCapability('solana')).toMatchObject({ status: 'prepare-only', executable: false })
    expect(bridgeCapability('base')).toMatchObject({ status: 'unavailable', id: null })
  })
  it('refuses script-credential and malformed addresses as depositors', () => {
    // The wallet's own bytes with the header switched to type 1 (script payment, key stake).
    const bytes = decodeCardanoAddress(WALLET)
    const script = encodeCardanoAddress(Uint8Array.from([0x11, ...bytes.slice(1)]))
    expect(decodeCardanoAddress(script)[0] >> 4).toBe(1)
    expect(() => cardanoRemoteDepositor(script)).toThrow(/key-hash/)
    expect(() => cardanoRemoteDepositor('not-an-address')).toThrow(ProviderFault)
  })
  it('a bad sell amount is refused', async () => {
    await expect(planStablecoinRoute(ethReq({ sellAmountRaw: '0' }), deps())).rejects.toThrow(ProviderFault)
  })
})
