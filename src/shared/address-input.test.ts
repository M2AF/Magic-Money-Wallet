import { describe, it, expect } from 'vitest'
import { resolveAddressInput, chainlensSearchUrl, CHAINLENS_SEARCH_URL } from './address-input'

const search = (q: string) => `${CHAINLENS_SEARCH_URL}?q=${encodeURIComponent(q)}`

describe('resolveAddressInput', () => {
  it('ignores blank input', () => {
    expect(resolveAddressInput('   ')).toBeNull()
  })

  it('keeps full http(s) URLs', () => {
    expect(resolveAddressInput('https://app.uniswap.org/swap?x=1')).toBe('https://app.uniswap.org/swap?x=1')
    expect(resolveAddressInput('HTTP://example.com')).toBe('http://example.com/')
  })

  it('adds https to bare domains, with paths and ports', () => {
    expect(resolveAddressInput('uniswap.org')).toBe('https://uniswap.org/')
    expect(resolveAddressInput('jpg.store/collection/x?y=1')).toBe('https://jpg.store/collection/x?y=1')
    expect(resolveAddressInput('localhost:3000')).toBe('https://localhost:3000/')
    expect(resolveAddressInput('192.168.1.1')).toBe('https://192.168.1.1/')
    expect(resolveAddressInput('xn--80ak6aa92e.com')).toBe('https://xn--80ak6aa92e.com/')
  })

  it('uses http for .onion hosts', () => {
    expect(resolveAddressInput('abcdefgh.onion/path')).toBe('http://abcdefgh.onion/path')
  })

  it('searches ChainLens for anything that is not an address', () => {
    expect(resolveAddressInput('uniswap')).toBe(search('uniswap'))
    expect(resolveAddressInput('cardano wallets')).toBe(search('cardano wallets'))
    expect(resolveAddressInput('what is 3.5% of 20')).toBe(search('what is 3.5% of 20'))
    expect(resolveAddressInput('3.5')).toBe(search('3.5'))
    expect(resolveAddressInput('0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'))
      .toBe(search('0x01faF6DFc230d755141D84d7cB980dd68f5Efe13'))
  })

  it('never navigates to non-web schemes — they become searches', () => {
    expect(resolveAddressInput('javascript:alert(1)')).toBe(search('javascript:alert(1)'))
    expect(resolveAddressInput('file:///C:/secret.txt')).toBe(search('file:///C:/secret.txt'))
  })

  it('collapses whitespace in the query', () => {
    expect(chainlensSearchUrl('  nft   marketplaces ')).toBe(search('nft marketplaces'))
  })
})
