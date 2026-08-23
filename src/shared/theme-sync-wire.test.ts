import { describe, it, expect } from 'vitest'
import {
  sanitizeThemeEntries,
  mergeThemeEntries,
  liveThemeEntries,
  pruneThemeEntries,
  MAX_SYNCED_THEMES,
  MAX_THEME_ENTRIES,
  THEME_NAME_MAX,
  type ThemeEntries,
} from './theme-sync-wire'

const entry = (t: number, over: Record<string, unknown> = {}) => ({
  n: 'Sunset', c: { bg: '#121a2c', accent: '#ff9500', text: '#ffe9cf' }, t, ...over,
})

describe('sanitizeThemeEntries', () => {
  it('keeps a well-formed entry and lowercases its colours', () => {
    const out = sanitizeThemeEntries({ 'custom-a': entry(5, { c: { bg: '#121A2C', accent: '#FF9500', text: '#FFE9CF' } }) })
    expect(out['custom-a']).toEqual({
      n: 'Sunset', c: { bg: '#121a2c', accent: '#ff9500', text: '#ffe9cf' }, t: 5,
    })
  })

  it('refuses ids that are not custom-*, or are absurdly long', () => {
    const out = sanitizeThemeEntries({
      'midnight': entry(1),
      '': entry(1),
      ['custom-' + 'x'.repeat(200)]: entry(1),
      'custom-ok': entry(1),
    })
    expect(Object.keys(out)).toEqual(['custom-ok'])
  })

  it('drops an entry with an unusable colour rather than inventing one', () => {
    // Defaulting here would push a made-up colour that then WINS the merge and
    // overwrites the good copy on the other device.
    for (const bad of [{ bg: 'red' }, { accent: '#12345' }, { text: '' }, { bg: null }]) {
      const out = sanitizeThemeEntries({ 'custom-a': entry(5, { c: { ...entry(5).c, ...bad } }) })
      expect(out).toEqual({})
    }
    expect(sanitizeThemeEntries({ 'custom-a': { n: 'x', t: 5 } })).toEqual({})
  })

  it('requires a finite, non-negative timestamp — the merge has no other tiebreak', () => {
    for (const t of [undefined, null, NaN, Infinity, -1, 'soon']) {
      expect(sanitizeThemeEntries({ 'custom-a': entry(0, { t }) })).toEqual({})
    }
    expect(Object.keys(sanitizeThemeEntries({ 'custom-a': entry(0) }))).toEqual(['custom-a'])
  })

  it('trims a name and never leaves it empty', () => {
    const long = sanitizeThemeEntries({ 'custom-a': entry(1, { n: 'x'.repeat(200) }) })
    expect(long['custom-a'].n).toHaveLength(THEME_NAME_MAX)
    expect(sanitizeThemeEntries({ 'custom-a': entry(1, { n: '   ' }) })['custom-a'].n).toBe('Custom')
    expect(sanitizeThemeEntries({ 'custom-a': entry(1, { n: 42 }) })['custom-a'].n).toBe('Custom')
  })

  it('keeps a tombstone even though it carries no colours', () => {
    const out = sanitizeThemeEntries({ 'custom-a': { t: 9, d: 1 } })
    expect(out['custom-a']).toMatchObject({ t: 9, d: 1 })
  })

  it('survives garbage at the top level', () => {
    for (const bad of [null, undefined, 'nope', 42, [], [{ id: 1 }]]) {
      expect(sanitizeThemeEntries(bad)).toEqual({})
    }
  })

  it('caps how many entries a peer can push', () => {
    const many: Record<string, unknown> = {}
    for (let i = 0; i < MAX_THEME_ENTRIES + 40; i++) many[`custom-${i}`] = entry(i)
    expect(Object.keys(sanitizeThemeEntries(many))).toHaveLength(MAX_THEME_ENTRIES)
  })
})

describe('mergeThemeEntries', () => {
  it('takes the newer side per id', () => {
    const a: ThemeEntries = { 'custom-a': entry(10, { n: 'Old' }) }
    const b: ThemeEntries = { 'custom-a': entry(20, { n: 'New' }) }
    expect(mergeThemeEntries(a, b)['custom-a'].n).toBe('New')
    expect(mergeThemeEntries(b, a)['custom-a'].n).toBe('New')
  })

  it('keeps ids only one side has', () => {
    const merged = mergeThemeEntries({ 'custom-a': entry(1) }, { 'custom-b': entry(2) })
    expect(Object.keys(merged).sort()).toEqual(['custom-a', 'custom-b'])
  })

  it('lets a newer delete beat an older edit, and an older delete lose to a newer edit', () => {
    const edit = { 'custom-a': entry(10) }
    const del = { 'custom-a': { n: '', c: { bg: '', accent: '', text: '' }, t: 20, d: 1 as const } }
    expect(mergeThemeEntries(edit, del)['custom-a'].d).toBe(1)

    const staleDel = { 'custom-a': { n: '', c: { bg: '', accent: '', text: '' }, t: 5, d: 1 as const } }
    expect(mergeThemeEntries(staleDel, edit)['custom-a'].d).toBeUndefined()
  })

  it('is idempotent when a client re-pushes the same list', () => {
    const a: ThemeEntries = { 'custom-a': entry(10) }
    expect(mergeThemeEntries(a, a)).toEqual(a)
  })

  it('does not mutate its inputs', () => {
    const a: ThemeEntries = { 'custom-a': entry(1) }
    const b: ThemeEntries = { 'custom-a': entry(2) }
    mergeThemeEntries(a, b)
    expect(a['custom-a'].t).toBe(1)
    expect(b['custom-a'].t).toBe(2)
  })
})

describe('liveThemeEntries', () => {
  it('hides tombstones and returns newest first', () => {
    const list = liveThemeEntries({
      'custom-a': entry(1),
      'custom-b': entry(3),
      'custom-c': { n: '', c: { bg: '', accent: '', text: '' }, t: 99, d: 1 },
    })
    expect(list.map(([id]) => id)).toEqual(['custom-b', 'custom-a'])
  })

  it('caps at the slot count so a merge of two profiles cannot overflow the picker', () => {
    const entries: ThemeEntries = {}
    for (let i = 0; i < MAX_SYNCED_THEMES + 5; i++) entries[`custom-${i}`] = entry(i)
    const live = liveThemeEntries(entries)
    expect(live).toHaveLength(MAX_SYNCED_THEMES)
    // The newest survive the cap.
    expect(live[0][0]).toBe(`custom-${MAX_SYNCED_THEMES + 4}`)
  })
})

describe('pruneThemeEntries', () => {
  it('leaves a small map alone', () => {
    const small: ThemeEntries = { 'custom-a': entry(1) }
    expect(pruneThemeEntries(small)).toBe(small)
  })

  it('drops the oldest tombstones once over the ceiling, never a live theme', () => {
    const entries: ThemeEntries = {}
    for (let i = 0; i < 6; i++) entries[`live-custom-${i}`.replace('live-', '')] = entry(1000 + i)
    for (let i = 0; i < MAX_THEME_ENTRIES + 20; i++) {
      entries[`custom-dead${i}`] = { n: '', c: { bg: '', accent: '', text: '' }, t: i, d: 1 }
    }
    const pruned = pruneThemeEntries(entries)
    expect(Object.keys(pruned).length).toBeLessThanOrEqual(MAX_THEME_ENTRIES)
    for (let i = 0; i < 6; i++) expect(pruned[`custom-${i}`]).toBeTruthy()
    // Newest tombstones are the ones kept.
    expect(pruned[`custom-dead${MAX_THEME_ENTRIES + 19}`]).toBeTruthy()
    expect(pruned['custom-dead0']).toBeUndefined()
  })
})
