import { describe, expect, it } from 'vitest'
import { percentOfRaw, rawToDecimalString } from './swap-amount'

describe('rawToDecimalString', () => {
  it('formats exactly, without exponent notation or trailing zeros', () => {
    expect(rawToDecimalString(1500000000000000000n, 18)).toBe('1.5')
    expect(rawToDecimalString(1n, 18)).toBe('0.000000000000000001')
    expect(rawToDecimalString(123n, 0)).toBe('123')
    expect(rawToDecimalString(0n, 6)).toBe('0')
  })
})

describe('percentOfRaw', () => {
  it('takes 25/50/75% of the exact base units', () => {
    expect(percentOfRaw('1000000000000000000', 25, 18)).toBe('0.25')
    expect(percentOfRaw('1000000000000000000', 50, 18)).toBe('0.5')
    expect(percentOfRaw('1000000000000000000', 75, 18)).toBe('0.75')
    expect(percentOfRaw('2500000', 50, 6)).toBe('1.25')
  })

  it('stays exact above 2^53 and rounds down, never over the balance', () => {
    expect(percentOfRaw('123456789012345678901234567', 25, 18)).toBe('30864197.253086419725308641')
    expect(percentOfRaw('3', 50, 0)).toBe('1')
    expect(percentOfRaw('1', 25, 9)).toBe('0')
  })

  it('rejects malformed input', () => {
    expect(percentOfRaw('', 50, 18)).toBe('0')
    expect(percentOfRaw('1,000', 50, 18)).toBe('0')
    expect(percentOfRaw('1000', 0, 18)).toBe('0')
    expect(percentOfRaw('1000', 101, 18)).toBe('0')
    expect(percentOfRaw('1000', 50, -1)).toBe('0')
  })
})
