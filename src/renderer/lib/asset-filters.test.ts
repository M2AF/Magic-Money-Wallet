/**
 * "Hide" is gone; every hidden entry becomes "spam" so nothing that was hidden
 * reappears, and the conversion outranks the old hide on every device.
 */
import { describe, it, expect } from 'vitest'
import { convertHiddenToSpam } from './asset-filters'
import { mergeFilterEntries } from '../../shared/asset-filter-key'

describe('convertHiddenToSpam', () => {
  it('turns hidden entries into spam and leaves the rest alone', () => {
    const out = convertHiddenToSpam({
      'base:t:0xaaa': { s: 'h', t: 100 },
      'base:t:0xbbb': { s: 's', t: 200 },
      'base:t:0xccc': { s: 'a', t: 300 },
    }, 1_000)
    expect(out).toEqual({
      'base:t:0xaaa': { s: 's', t: 1_000 },
      'base:t:0xbbb': { s: 's', t: 200 },
      'base:t:0xccc': { s: 'a', t: 300 },
    })
  })

  it('returns the same object when nothing is hidden (no needless save or push)', () => {
    const entries = { 'base:t:0xbbb': { s: 's' as const, t: 200 } }
    expect(convertHiddenToSpam(entries, 1_000)).toBe(entries)
  })

  it('the converted entry wins the profile merge against the old hide from another device', () => {
    const otherDevice = { 'base:t:0xaaa': { s: 'h' as const, t: 5_000 } }
    const converted = convertHiddenToSpam(otherDevice, 1_000)          // clock behind the hide
    expect(converted['base:t:0xaaa'].t).toBeGreaterThan(5_000)
    expect(mergeFilterEntries(otherDevice, converted)['base:t:0xaaa'].s).toBe('s')
  })
})
