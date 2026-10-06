import { describe, it, expect, vi } from 'vitest'
import { handleStablecoinPlan, type StablecoinPlanHost } from './stablecoin-route-handler'
import { STABLECOIN_INTERMEDIATES } from '../shared/stablecoin-route'
import type { WalletConfig } from './secure-store'

const CARDANO = 'addr1q950qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqcg9c9h'
const EVM = '0x720f28c62b844e7dd8705ab0a7651f3f575384f4'
const req = {
  fromToken: { address: '279c909f348e533da5808898f87f9a14bb2c3dfbbacccd631d927a3f534e454b', symbol: 'SNEK', decimals: 0 },
  toChain: 'ethereum',
  toToken: { address: '0x6982508145454Ce325dDbE47a25d4ec3d2311933', symbol: 'PEPE', decimals: 18 },
  sellAmountRaw: '10000', slippageBps: 50,
}

function host(config: Partial<WalletConfig> = {}): StablecoinPlanHost & { quote: ReturnType<typeof vi.fn> } {
  const quote = vi.fn(async () => ({ quote: { provider: 'minswap', buyAmountRaw: '26000000', minBuyAmountRaw: '25000000', expiresAt: 1 } as never, error: null }))
  return {
    quote,
    loadConfig: async () => ({ network: 'mainnet', ...config }) as WalletConfig,
    loadAddresses: async () => ({ cardano: CARDANO, evm: EVM, solana: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV' }),
    deps: { quote, prepareEthereum: vi.fn(), prepareSolana: vi.fn() },
  }
}

describe('handleStablecoinPlan', () => {
  it('plans with the wallet\'s OWN addresses; no fee ceiling, so Circle is not called', async () => {
    const h = host()
    const r = await handleStablecoinPlan({ ...req, recipient: '0xattacker', cardanoAddress: 'addr1evil' }, h)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.recipient).toBe(EVM)
    expect(r.value.legs[1].status).toBe('needs-fee-cap')
    expect(r.value.executable).toBe(false)
    expect(h.deps!.prepareEthereum).not.toHaveBeenCalled()
    expect(h.quote.mock.calls[0][0]).toMatchObject({ taker: CARDANO, toToken: STABLECOIN_INTERMEDIATES.cardano.address })
  })

  it('is mainnet-only', async () => {
    expect(await handleStablecoinPlan(req, host({ testnetMode: true } as Partial<WalletConfig>))).toMatchObject({ ok: false })
  })

  it('refuses malformed requests', async () => {
    for (const bad of [
      null, { ...req, toChain: 'base' }, { ...req, sellAmountRaw: '0' }, { ...req, sellAmountRaw: '1.5' },
      { ...req, slippageBps: 0 }, { ...req, fromToken: { ...req.fromToken, address: 'SNEK' } },
      { ...req, toToken: { ...req.toToken, address: 'not-an-address' } }, { ...req, toToken: { ...req.toToken, decimals: 99 } },
    ]) expect((await handleStablecoinPlan(bad, host())).ok).toBe(false)
  })

  it('an account without a destination address cannot plan', async () => {
    const h = { ...host(), loadAddresses: async () => ({ cardano: CARDANO }) }
    expect(await handleStablecoinPlan(req, h)).toMatchObject({ ok: false })
  })
})
