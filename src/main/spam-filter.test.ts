import { describe, it, expect } from 'vitest'
import { isSuspectedSpamToken } from './spam-filter'

const t = (name: string, symbol: string, usdValue: string | null = null) => ({ name, symbol, usdValue })

describe('spam-filter isSuspectedSpamToken', () => {
  // Real samples observed on the public Foundry test wallet during the audit.
  it('flags phishing airdrops seen in the wild', () => {
    expect(isSuspectedSpamToken(t('!Ads BTC Casino www.MaticSlot.io', '!Ads BTC Casino'))).toBe(true)
    expect(isSuspectedSpamToken(t('# halving-btc.net', '$ Check: halving-btc.net to claim your WBTC'))).toBe(true)
    expect(isSuspectedSpamToken(t('ETHENA `', '$ CLAiM : ethena-v2.com ]'))).toBe(true)
    expect(isSuspectedSpamToken(t('ETHENA *', '$ CLAiM ON eth-ethens.com $'))).toBe(true)
    expect(isSuspectedSpamToken(t('$ NFTGiftX.com', '$ Visit NFTGiftX.com to claim'))).toBe(true)
    expect(isSuspectedSpamToken(t('$Blast', '$Blast rewards on getblast.io'))).toBe(true)
    expect(isSuspectedSpamToken(t('Voucher for uniswap-pool.org', 'UNI-V'))).toBe(true)
    expect(isSuspectedSpamToken(t('Free Airdrop Token', 'FREE'))).toBe(true)
  })

  it('never flags a token with a positive USD value (yearn.finance guardrail)', () => {
    expect(isSuspectedSpamToken(t('yearn.finance', 'YFI', '$8,412.55'))).toBe(false)
    expect(isSuspectedSpamToken(t('$ CLAiM : ethena-v2.com', 'SCAM', '$1.23'))).toBe(false)
  })

  it('leaves ordinary tokens alone', () => {
    expect(isSuspectedSpamToken(t('USD Coin', 'USDC'))).toBe(false)
    expect(isSuspectedSpamToken(t('Wrapped Ether', 'WETH'))).toBe(false)
    expect(isSuspectedSpamToken(t('Tether USD', 'USDT', '$2.51'))).toBe(false)
    expect(isSuspectedSpamToken(t('DOLPHINX', '🐬 DOLPHINX'))).toBe(false)
    expect(isSuspectedSpamToken(t('Pepe', 'PEPE', '$0.04'))).toBe(false)
  })

  it('treats $0.00 valuations as unpriced (scam mints price-format to zero)', () => {
    expect(isSuspectedSpamToken(t('# halving-btc.net', 'WBTC-CLAIM', '$0.00'))).toBe(true)
  })
})
