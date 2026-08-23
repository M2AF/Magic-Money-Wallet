import { describe, it, expect } from 'vitest'
import { parseHex, rgbToHsl, contrastRatio, relativeLuminance } from './color'
import {
  deriveThemeTokens,
  textContrast,
  accentContrast,
  toneOf,
  swatchOf,
  DEFAULT_CUSTOM_COLORS,
  type CustomThemeColors
} from './theme-tokens'

const MOONLIGHT: CustomThemeColors = { bg: '#060b18', accent: '#00aaff', text: '#e8f4ff' }
const CRIMSON: CustomThemeColors = { bg: '#18060a', accent: '#ff3355', text: '#ffe8ec' }
const PAPER: CustomThemeColors = { bg: '#f6f2ea', accent: '#c9a227', text: '#3a3325' }

const L = (hex: string) => rgbToHsl(parseHex(hex)!).l

describe('tone', () => {
  it('flips on the background, not the text', () => {
    expect(toneOf('#060b18')).toBe('dark')
    expect(toneOf('#f6f2ea')).toBe('light')
    expect(toneOf('#000000')).toBe('dark')
    expect(toneOf('#ffffff')).toBe('light')
  })

  it('falls back to the default background when the hex is unusable', () => {
    expect(toneOf('not-a-colour')).toBe(toneOf(DEFAULT_CUSTOM_COLORS.bg))
  })
})

describe('deriveThemeTokens — dark', () => {
  const { tone, vars } = deriveThemeTokens(MOONLIGHT)

  it('reads as a dark theme with blur intact', () => {
    expect(tone).toBe('dark')
    expect(vars['--blur']).toBe('blur(20px)')
  })

  it('passes the three chosen colours through untouched', () => {
    expect(vars['--bg-deep']).toBe('#060b18')
    expect(vars['--accent']).toBe('#00aaff')
    expect(vars['--text-primary']).toBe('#e8f4ff')
  })

  it('stacks the surfaces upward from the page colour', () => {
    expect(L(vars['--bg-dark'])).toBeGreaterThan(L(vars['--bg-deep']))
    expect(L(vars['--bg-surface'])).toBeGreaterThan(L(vars['--bg-dark']))
  })

  it('reproduces the shipped Moonlight surfaces within a few points', () => {
    // Moonlight ships --bg-dark #0a0f1e (L 8.6) and --bg-surface #111c35 (L 15.7).
    expect(L(vars['--bg-dark'])).toBeCloseTo(8.6, 0)
    expect(Math.abs(L(vars['--bg-surface']) - 15.7)).toBeLessThan(2)
  })

  it('reproduces the shipped Moonlight muted text within a few channels', () => {
    // Moonlight ships --text-muted #3d5a7e — hand-picked, so the derivation is
    // only ever going to land in the neighbourhood. This guards the recipe
    // against drifting into flat grey, not against being pixel-identical.
    const got = parseHex(vars['--text-muted'])!
    const want = parseHex('#3d5a7e')!
    expect(Math.abs(got.r - want.r)).toBeLessThan(16)
    expect(Math.abs(got.g - want.g)).toBeLessThan(16)
    expect(Math.abs(got.b - want.b)).toBeLessThan(16)
  })

  it('emits the rgb triplets the derived tokens depend on', () => {
    expect(vars['--accent-rgb']).toBe('0, 170, 255')
    expect(vars['--bg-deep-rgb']).toBe('6, 11, 24')
    expect(vars['--bg-surface-rgb']).toBe(
      parseHex(vars['--bg-surface'])!.r + ', ' +
      parseHex(vars['--bg-surface'])!.g + ', ' +
      parseHex(vars['--bg-surface'])!.b
    )
  })

  it('makes the accent label readable against the page', () => {
    const ratio = contrastRatio(parseHex(vars['--accent-text'])!, parseHex(vars['--bg-deep'])!)
    expect(ratio).toBeGreaterThan(4.5)
  })

  it('keeps the ordinary text hierarchy from bright to dim', () => {
    const lum = (k: string) => relativeLuminance(parseHex(vars[k])!)
    expect(lum('--text-primary')).toBeGreaterThan(lum('--text-secondary'))
    expect(lum('--text-secondary')).toBeGreaterThan(lum('--text-muted'))
    expect(lum('--text-muted')).toBeGreaterThan(lum('--bg-deep'))
  })
})

describe('deriveThemeTokens — light', () => {
  const { tone, vars } = deriveThemeTokens(PAPER)

  it('drops the glassmorphism blur like White & Gold does', () => {
    expect(tone).toBe('light')
    expect(vars['--blur']).toBe('none')
  })

  it('lifts cards ABOVE the page instead of stacking darker', () => {
    expect(L(vars['--bg-surface'])).toBeGreaterThan(L(vars['--bg-deep']))
    expect(L(vars['--bg-dark'])).toBeLessThan(L(vars['--bg-deep']))
    // Cards are opaque paper, not a translucent pane.
    expect(vars['--bg-card']).toMatch(/^#/)
  })

  it('flips the App Hub card text to dark and drops its shadow', () => {
    expect(vars['--card-text']).toBe('#3a3325')
    expect(vars['--card-text-shadow']).toBe('none')
  })

  it('darkens the accent label so it reads on paper', () => {
    expect(L(vars['--accent-text'])).toBeLessThan(L(vars['--bg-deep']))
    const ratio = contrastRatio(parseHex(vars['--accent-text'])!, parseHex(vars['--bg-deep'])!)
    expect(ratio).toBeGreaterThan(4.5)
  })

  it('strengthens the borders, as gold on ivory needs', () => {
    expect(vars['--border']).toContain('0.3')
    expect(vars['--border-active']).toContain('0.65')
  })
})

describe('deriveThemeTokens — edges', () => {
  it('still separates the layers on pure black', () => {
    const { vars } = deriveThemeTokens({ bg: '#000000', accent: '#ff0000', text: '#ffffff' })
    expect(vars['--bg-deep']).toBe('#000000')
    expect(L(vars['--bg-surface'])).toBeGreaterThan(0)
    expect(vars['--bg-surface']).not.toBe('#000000')
  })

  it('still separates the layers on pure white', () => {
    const { tone, vars } = deriveThemeTokens({ bg: '#ffffff', accent: '#0000ff', text: '#111111' })
    expect(tone).toBe('light')
    expect(L(vars['--bg-dark'])).toBeLessThan(100)
    expect(vars['--bg-surface']).toBe('#ffffff')
  })

  it('flips the ink on a light accent so labels on buttons stay visible', () => {
    // Midnight's case: the accent IS white.
    const { vars } = deriveThemeTokens({ bg: '#000000', accent: '#ffffff', text: '#f5f5f5' })
    expect(vars['--on-accent']).toBe('#000000')
    expect(vars['--btn-primary-text']).toBe('#000000')
  })

  it('keeps white ink on a dark accent', () => {
    const { vars } = deriveThemeTokens({ bg: '#ffffff', accent: '#101820', text: '#101820' })
    expect(vars['--on-accent']).toBe('#ffffff')
  })

  it('never emits an empty or undefined token', () => {
    for (const colors of [MOONLIGHT, CRIMSON, PAPER, DEFAULT_CUSTOM_COLORS]) {
      for (const [name, value] of Object.entries(deriveThemeTokens(colors).vars)) {
        expect(name.startsWith('--'), name).toBe(true)
        expect(value, name).toBeTruthy()
        expect(value, name).not.toContain('NaN')
      }
    }
  })

  it('survives garbage input by falling back to the defaults', () => {
    const { vars } = deriveThemeTokens({ bg: 'oops', accent: '', text: '#zzz' })
    expect(vars['--bg-deep']).toBe(DEFAULT_CUSTOM_COLORS.bg)
    expect(vars['--accent']).toBe(DEFAULT_CUSTOM_COLORS.accent)
    expect(vars['--text-primary']).toBe(DEFAULT_CUSTOM_COLORS.text)
  })
})

describe('contrast readouts', () => {
  it('scores a readable pairing high and an unreadable one low', () => {
    expect(textContrast(MOONLIGHT)).toBeGreaterThan(7)
    expect(textContrast({ bg: '#333333', accent: '#00aaff', text: '#3a3a3a' })).toBeLessThan(1.5)
  })

  it('scores the accent against the background', () => {
    expect(accentContrast(MOONLIGHT)).toBeGreaterThan(4)
    expect(accentContrast({ bg: '#00aaff', accent: '#00aaff', text: '#fff' })).toBeCloseTo(1, 5)
  })
})

describe('swatches', () => {
  it('normalises to the [background, accent] pair the picker draws', () => {
    expect(swatchOf({ bg: '#0AF', accent: 'ff3355', text: '#fff' })).toEqual(['#00aaff', '#ff3355'])
  })
})
