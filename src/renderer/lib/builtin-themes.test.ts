import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import {
  builtinSwatch,
  isBuiltinThemeId,
  isThemeColors,
  matchingBuiltin,
  planAbsorbShipped,
  sameColors,
  sanitizeBuiltinOverrides,
  themeDef,
  THEMES,
  type BuiltinThemeId
} from './builtin-themes'
import { swatchOf, type CustomThemeColors } from './theme-tokens'
import type { ThemeEntries } from '../../shared/theme-sync-wire'

const HEX = /^#[0-9a-f]{6}$/

describe('the shipped table', () => {
  it('is twelve themes with unique ids and names', () => {
    expect(THEMES).toHaveLength(12)
    expect(new Set(THEMES.map(t => t.id)).size).toBe(12)
    expect(new Set(THEMES.map(t => t.name)).size).toBe(12)
  })

  it('gives every theme three usable colours and a swatch', () => {
    for (const t of THEMES) {
      expect(HEX.test(t.colors.bg), `${t.id} bg`).toBe(true)
      expect(HEX.test(t.colors.accent), `${t.id} accent`).toBe(true)
      expect(HEX.test(t.colors.text), `${t.id} text`).toBe(true)
      expect(t.swatch).toHaveLength(2)
      expect(HEX.test(t.swatch[0]), `${t.id} swatch bg`).toBe(true)
      expect(HEX.test(t.swatch[1]), `${t.id} swatch accent`).toBe(true)
    }
  })

  it('carries the six themes the user made, by the names they were given', () => {
    // These were custom themes before they were promoted, so the names are the
    // user's own spelling — "milady" is lowercase on purpose.
    const promoted = ['cardano', 'milady', 'monad', 'abstract', 'bitcoin', 'sappy-seals']
    for (const id of promoted) {
      const def = THEMES.find(t => t.id === id)
      expect(def, id).toBeDefined()
      // Derived, not hand-tuned: nothing in index.css knows these ids.
      expect(def!.css).toBeUndefined()
    }
    expect(THEMES.find(t => t.id === 'milady')!.name).toBe('milady')
    expect(THEMES.find(t => t.id === 'sappy-seals')!.name).toBe('Sappy Seals')
  })

  it('resolves ids, and refuses ones it does not ship', () => {
    expect(isBuiltinThemeId('bitcoin')).toBe(true)
    expect(isBuiltinThemeId('custom-abc')).toBe(false)
    expect(isBuiltinThemeId(null)).toBe(false)
    expect(themeDef('monad').name).toBe('Monad')
  })
})

/**
 * The drift this file exists to catch: a `css: true` theme's `colors` are what
 * the editor opens with, so if they stop matching the block in index.css then
 * "edit it, then revert" silently changes the theme. Reading the stylesheet is
 * the only way to assert the two agree.
 */
describe('hand-tuned themes match their stylesheet block', () => {
  const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8')

  /** The first `{ … }` block for a selector, or null. */
  function block(selector: string): string | null {
    const at = css.indexOf(selector)
    if (at === -1) return null
    const open = css.indexOf('{', at)
    const close = css.indexOf('}', open)
    return open === -1 || close === -1 ? null : css.slice(open + 1, close)
  }

  function token(body: string, name: string): string | null {
    return body.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase() ?? null
  }

  for (const def of THEMES.filter(t => t.css)) {
    it(`${def.id}`, () => {
      // Moonlight is the un-attributed default: its tokens are the base :root.
      const body = def.id === 'moonlight'
        ? block(':root {')
        : block(`:root[data-theme='${def.id}']:not([data-derived])`)
      expect(body, `no block found for ${def.id}`).not.toBeNull()
      expect(token(body!, '--bg-deep')).toBe(def.colors.bg)
      expect(token(body!, '--accent')).toBe(def.colors.accent)
      expect(token(body!, '--text-primary')).toBe(def.colors.text)
    })
  }

  it('leaves every hand-tuned rule opted out of data-derived', () => {
    // A rule that forgot the guard would keep painting its original colours over
    // a recoloured theme — the White & Gold ivory gradient being the worst case.
    const unguarded = [...css.matchAll(/:root\[data-theme='([a-z-]+)'\](?!:not\(\[data-derived\]\))/g)]
    expect(unguarded.map(m => m[0])).toEqual([])
  })
})

describe('matchingBuiltin', () => {
  it('finds a theme that is colour-for-colour one we now ship', () => {
    for (const def of THEMES) expect(matchingBuiltin(def.colors)).toBe(def.id)
  })

  it('ignores the case the colours were written in', () => {
    const bitcoin = THEMES.find(t => t.id === 'bitcoin')!.colors
    expect(matchingBuiltin({ ...bitcoin, accent: bitcoin.accent.toUpperCase() })).toBe('bitcoin')
  })

  it('leaves a near-miss alone — that is somebody tweaking a theme', () => {
    const bitcoin = THEMES.find(t => t.id === 'bitcoin')!.colors
    expect(matchingBuiltin({ ...bitcoin, accent: '#f2a901' })).toBeNull()
    expect(matchingBuiltin({ bg: '#123456', accent: '#654321', text: '#abcdef' })).toBeNull()
  })

  it('compares all three colours, not just the background', () => {
    expect(sameColors(
      { bg: '#ffffff', accent: '#52f293', text: '#000000' },
      { bg: '#ffffff', accent: '#000000', text: '#000000' },
    )).toBe(false)
  })
})

describe('sanitizeBuiltinOverrides', () => {
  const colors: CustomThemeColors = { bg: '#101010', accent: '#20ff20', text: '#fafafa' }

  it('keeps a well-formed override and lowercases it', () => {
    const out = sanitizeBuiltinOverrides({ bitcoin: { bg: '#101010', accent: '#20FF20', text: '#FAFAFA' } })
    expect(out).toEqual({ bitcoin: colors })
  })

  it('drops ids the app does not ship, including custom-theme ids', () => {
    expect(sanitizeBuiltinOverrides({ 'custom-abc': colors, nope: colors })).toEqual({})
  })

  it('drops an entry whose colours are not three full hex triplets', () => {
    expect(sanitizeBuiltinOverrides({ bitcoin: { bg: '#101010', accent: 'red', text: '#fafafa' } })).toEqual({})
    expect(sanitizeBuiltinOverrides({ bitcoin: { bg: '#101010', accent: '#20ff20' } })).toEqual({})
    expect(sanitizeBuiltinOverrides({ bitcoin: { bg: '#fff', accent: '#20ff20', text: '#fafafa' } })).toEqual({})
    expect(sanitizeBuiltinOverrides({ bitcoin: null })).toEqual({})
  })

  it('survives garbage instead of a map', () => {
    for (const bad of [null, undefined, 'x', 7, [colors]]) {
      expect(sanitizeBuiltinOverrides(bad)).toEqual({})
    }
  })

  it('keeps the good entries when one is bad', () => {
    const out = sanitizeBuiltinOverrides({ bitcoin: colors, monad: { bg: 'nope' } })
    expect(Object.keys(out)).toEqual(['bitcoin'])
  })
})

describe('isThemeColors', () => {
  it('accepts three hex triplets and nothing else', () => {
    expect(isThemeColors({ bg: '#000000', accent: '#ffffff', text: '#123456' })).toBe(true)
    expect(isThemeColors({ bg: '#000', accent: '#ffffff', text: '#123456' })).toBe(false)
    expect(isThemeColors('#000000')).toBe(false)
    expect(isThemeColors(null)).toBe(false)
  })
})

describe('builtinSwatch', () => {
  const def = THEMES.find(t => t.id === 'matrix')!

  it('shows the shipped pair while the theme is untouched', () => {
    expect(builtinSwatch(def)).toEqual(def.swatch)
    expect(builtinSwatch(def, null)).toEqual(def.swatch)
  })

  it('follows the override, so the picker dot shows the recolour', () => {
    const mine: CustomThemeColors = { bg: '#221100', accent: '#ff8800', text: '#ffffff' }
    expect(builtinSwatch(def, mine)).toEqual(swatchOf(mine))
    expect(builtinSwatch(def, mine)).not.toEqual(def.swatch)
  })
})

describe('planAbsorbShipped', () => {
  const bitcoin = THEMES.find(t => t.id === 'bitcoin')!.colors
  const monad = THEMES.find(t => t.id === 'monad')!.colors
  const mine: CustomThemeColors = { bg: '#101018', accent: '#8be9fd', text: '#f0f0ff' }
  const entry = (c: CustomThemeColors, n = 'x'): ThemeEntries[string] => ({ n, c, t: 1 })

  it('does nothing when no custom theme is a copy of a shipped one', () => {
    const plan = planAbsorbShipped({ 'custom-a': entry(mine) }, 'custom-a')
    expect(plan).toEqual({ tombstone: [], moveTo: null })
  })

  it('folds away every copy of a theme that now ships', () => {
    const plan = planAbsorbShipped({
      'custom-a': entry(bitcoin, 'Bitcoin'),
      'custom-b': entry(monad, 'Monad'),
      'custom-c': entry(mine, 'Mine'),
    }, null)
    expect(plan.tombstone.sort()).toEqual(['custom-a', 'custom-b'])
    expect(plan.moveTo).toBeNull()
  })

  it('moves the selection onto the built-in when the copy was being worn', () => {
    const plan = planAbsorbShipped({ 'custom-a': entry(bitcoin) }, 'custom-a')
    expect(plan.moveTo).toBe('bitcoin')
  })

  it('leaves the selection alone when a different theme was being worn', () => {
    const plan = planAbsorbShipped(
      { 'custom-a': entry(bitcoin), 'custom-b': entry(mine) }, 'custom-b',
    )
    expect(plan.tombstone).toEqual(['custom-a'])
    expect(plan.moveTo).toBeNull()
  })

  it('never touches a theme that is only nearly a built-in', () => {
    const nearly = { ...bitcoin, text: '#abacab' }
    expect(planAbsorbShipped({ 'custom-a': entry(nearly) }, null).tombstone).toEqual([])
  })

  it('skips tombstones — re-deleting one would push a pointless newer record', () => {
    const dead: ThemeEntries = {
      'custom-a': { n: '', c: { bg: '', accent: '', text: '' }, t: 5, d: 1 },
    }
    expect(planAbsorbShipped(dead, null).tombstone).toEqual([])
  })

  it('is empty for an empty store, so a fresh install writes nothing', () => {
    expect(planAbsorbShipped({}, null)).toEqual({ tombstone: [], moveTo: null })
  })
})

describe('ids the rest of the app depends on', () => {
  it('never collides with a custom theme id', () => {
    // theme.ts routes on `custom-` first; a built-in starting with it would be
    // unreachable and would be looked up in the wrong store.
    for (const t of THEMES) expect(t.id.startsWith('custom-')).toBe(false)
  })

  it('is safe to stamp into data-theme and into a CSS selector', () => {
    for (const t of THEMES) expect(t.id).toMatch(/^[a-z][a-z0-9-]*$/)
  })

  it('keeps moonlight first — theme.ts falls back to THEMES[0]', () => {
    const first: BuiltinThemeId = 'moonlight'
    expect(THEMES[0].id).toBe(first)
  })
})
