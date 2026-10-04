import { describe, expect, it } from 'vitest'
import { swapExchangePreset } from './swap-exchange-preset'
import { SWAP_TOKEN_LISTS } from '../types/swap-tokens'

describe('exact exchange handoff identities', () => {
  const ada = SWAP_TOKEN_LISTS.cardano.find(t => t.symbol === 'ADA')!
  const sol = SWAP_TOKEN_LISTS.solana.find(t => t.symbol === 'SOL')!
  it('preserves the exact amount and both directions', () => {
    expect(swapExchangePreset(ada, sol, '20.000001')).toEqual({ fromKey: 'ada:ada', toKey: 'sol:sol', amount: '20.000001' })
    expect(swapExchangePreset(sol, ada, '0.123456789')).toEqual({ fromKey: 'sol:sol', toKey: 'ada:ada', amount: '0.123456789' })
  })
  it('does not map lookalike symbols, USDCx, wrong decimals or wrong chain', () => {
    expect(swapExchangePreset({ ...ada, address: 'ff'.repeat(28), symbol: 'ADA' }, sol, '20')).toBeNull()
    expect(swapExchangePreset(SWAP_TOKEN_LISTS.cardano.find(t => t.symbol === 'USDCx'), sol, '20')).toBeNull()
    expect(swapExchangePreset({ ...ada, decimals: 18 }, sol, '20')).toBeNull()
    expect(swapExchangePreset({ ...ada, chain: 'ethereum' }, sol, '20')).toBeNull()
    expect(swapExchangePreset(ada, ada, '20')).toBeNull()
  })
})
