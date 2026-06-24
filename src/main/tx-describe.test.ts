import { describe, it, expect } from 'vitest'
import { formatNativeValue, summarizeEvmSend, describeTypedData } from './tx-describe'

// H-1 regression: amounts were integer-divided, so anything < 1 showed "0 ETH"
// and the symbol was always "ETH". These tests pin the correct behaviour.
describe('formatNativeValue (H-1)', () => {
  it('formats a sub-1 amount instead of "0 ETH"', () => {
    expect(formatNativeValue('0x6f05b59d3b20000', 'ETH')).toBe('0.5 ETH') // 0.5e18 wei
  })
  it('uses the chain native symbol', () => {
    expect(formatNativeValue('0xde0b6b3a7640000', 'POL')).toBe('1 POL')   // 1e18 wei
  })
  it('handles zero and missing values', () => {
    expect(formatNativeValue('0x0', 'ETH')).toBe('0 ETH')
    expect(formatNativeValue(undefined, 'BNB')).toBe('0 BNB')
  })
  it('summarizes a send with the correct amount + symbol', () => {
    const s = summarizeEvmSend({ to: '0x1234567890abcdef1234', value: '0x6f05b59d3b20000' }, 'AVAX')
    expect(s).toContain('0.5 AVAX')
  })
})

// H-2 regression: typed-data approvals showed only the primaryType. These pin
// that the full message + an UNLIMITED-allowance warning are surfaced.
describe('describeTypedData (H-2)', () => {
  it('flags an unlimited Permit approval with the spender', () => {
    const max = (2n ** 256n - 1n).toString()
    const out = describeTypedData({
      primaryType: 'Permit',
      domain: { name: 'USD Coin' },
      message: { spender: '0xSpenderAddress', value: max, deadline: 1999999999 },
    })
    expect(out).toContain('Spender: 0xSpenderAddress')
    expect(out).toMatch(/UNLIMITED/)
  })

  it('renders the full message tree for arbitrary typed data', () => {
    const out = describeTypedData({
      primaryType: 'Order',
      message: { maker: '0xMaker', amount: '100', nested: { token: '0xToken' } },
    })
    expect(out).toContain('maker: 0xMaker')
    expect(out).toContain('amount: 100')
    expect(out).toContain('token: 0xToken')
  })

  it('shows a finite Permit amount as-is (not flagged unlimited)', () => {
    const out = describeTypedData({
      primaryType: 'Permit',
      message: { spender: '0xabc', value: '1000000' },
    })
    expect(out).toContain('Amount: 1000000')
    expect(out).not.toMatch(/UNLIMITED/)
  })
})
