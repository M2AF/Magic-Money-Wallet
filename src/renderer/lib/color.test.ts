import { describe, it, expect } from 'vitest'
import {
  parseHex,
  parseColor,
  toHex,
  toRgbTriplet,
  toHslString,
  rgbToHsl,
  hslToRgb,
  rgbToHsv,
  hsvToRgb,
  mix,
  shiftLightness,
  withLightness,
  rotateHue,
  capSaturation,
  relativeLuminance,
  contrastRatio,
  readableOn,
  isLight
} from './color'

describe('parsing', () => {
  it('reads long and short hex, with or without #', () => {
    expect(parseHex('#00aaff')).toEqual({ r: 0, g: 170, b: 255 })
    expect(parseHex('00AAFF')).toEqual({ r: 0, g: 170, b: 255 })
    expect(parseHex('#0af')).toEqual({ r: 0, g: 170, b: 255 })
    expect(parseHex('  #0af  ')).toEqual({ r: 0, g: 170, b: 255 })
  })

  it('rejects anything that is not a hex colour', () => {
    for (const bad of ['', '#', '#0affff0', 'rebeccapurple', '#gg0000', '#0aff']) {
      expect(parseHex(bad)).toBeNull()
    }
  })

  it('accepts the other notations the editor field allows', () => {
    expect(parseColor('rgb(0, 170, 255)')).toEqual({ r: 0, g: 170, b: 255 })
    expect(parseColor('0, 170, 255')).toEqual({ r: 0, g: 170, b: 255 })
    expect(toHex(parseColor('hsl(200, 100%, 50%)')!)).toBe('#00aaff')
    expect(toHex(parseColor('200, 100%, 50%')!)).toBe('#00aaff')
  })

  it('rejects out-of-range rgb rather than clamping silently', () => {
    expect(parseColor('300, 0, 0')).toBeNull()
    expect(parseColor('-1, 0, 0')).toBeNull()
    expect(parseColor('nonsense')).toBeNull()
    expect(parseColor('1, 2')).toBeNull()
  })
})

describe('formatting', () => {
  it('round-trips hex', () => {
    expect(toHex({ r: 0, g: 170, b: 255 })).toBe('#00aaff')
    expect(toHex({ r: 255, g: 255, b: 255 })).toBe('#ffffff')
    expect(toHex({ r: 0, g: 0, b: 0 })).toBe('#000000')
  })

  it('clamps and rounds fractional channels', () => {
    expect(toHex({ r: -5, g: 170.4, b: 300 })).toBe('#00aaff')
    expect(toRgbTriplet({ r: 0.6, g: 170, b: 255 })).toBe('1, 170, 255')
  })

  it('formats hsl', () => {
    expect(toHslString({ r: 0, g: 170, b: 255 })).toBe('hsl(200, 100%, 50%)')
  })
})

describe('conversions', () => {
  const samples = ['#00aaff', '#ff3355', '#a24dff', '#00ff41', '#c9a227', '#ffffff', '#000000', '#7f7f7f']

  it('rgb -> hsl -> rgb is lossless to the nearest channel', () => {
    for (const hex of samples) {
      expect(toHex(hslToRgb(rgbToHsl(parseHex(hex)!)))).toBe(hex)
    }
  })

  it('rgb -> hsv -> rgb is lossless to the nearest channel', () => {
    for (const hex of samples) {
      expect(toHex(hsvToRgb(rgbToHsv(parseHex(hex)!)))).toBe(hex)
    }
  })

  it('reports greys as unsaturated with hue 0', () => {
    expect(rgbToHsl({ r: 127, g: 127, b: 127 })).toMatchObject({ h: 0, s: 0 })
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 })
  })
})

describe('manipulation', () => {
  it('mixes linearly and clamps t', () => {
    const black = { r: 0, g: 0, b: 0 }
    const white = { r: 255, g: 255, b: 255 }
    expect(toHex(mix(black, white, 0.5))).toBe('#808080')
    expect(toHex(mix(black, white, -1))).toBe('#000000')
    expect(toHex(mix(black, white, 2))).toBe('#ffffff')
  })

  it('shifts lightness without changing hue', () => {
    const base = parseHex('#00aaff')!
    const lifted = shiftLightness(base, 10)
    expect(rgbToHsl(lifted).l).toBeCloseTo(rgbToHsl(base).l + 10, 5)
    expect(rgbToHsl(lifted).h).toBeCloseTo(rgbToHsl(base).h, 5)
  })

  it('clamps lightness at the ends instead of wrapping', () => {
    expect(toHex(shiftLightness(parseHex('#000000')!, -20))).toBe('#000000')
    expect(toHex(shiftLightness(parseHex('#ffffff')!, 20))).toBe('#ffffff')
    expect(rgbToHsl(withLightness(parseHex('#00aaff')!, 80)).l).toBeCloseTo(80, 5)
  })

  it('rotates hue with wraparound', () => {
    const h = rgbToHsl(rotateHue(parseHex('#00aaff')!, 200)).h
    expect(h).toBeCloseTo((200 + 200) % 360, 4)
  })

  it('caps saturation only when it is over the limit', () => {
    const vivid = parseHex('#00aaff')!
    expect(rgbToHsl(capSaturation(vivid, 60)).s).toBeCloseTo(60, 4)
    const dull = hslToRgb({ h: 200, s: 20, l: 50 })
    expect(toHex(capSaturation(dull, 60))).toBe(toHex(dull))
  })
})

describe('contrast', () => {
  it('matches the WCAG reference points', () => {
    const white = { r: 255, g: 255, b: 255 }
    const black = { r: 0, g: 0, b: 0 }
    expect(relativeLuminance(white)).toBeCloseTo(1, 5)
    expect(relativeLuminance(black)).toBeCloseTo(0, 5)
    expect(contrastRatio(white, black)).toBeCloseTo(21, 4)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    const a = parseHex('#00aaff')!
    const b = parseHex('#0a0f1e')!
    expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10)
  })

  it('picks the readable ink for a fill', () => {
    expect(toHex(readableOn(parseHex('#ffffff')!))).toBe('#000000')
    expect(toHex(readableOn(parseHex('#0a0f1e')!))).toBe('#ffffff')
    // Midnight's accent IS white — the glyphs on it must flip to black.
    expect(toHex(readableOn(parseHex('#ffffff')!))).toBe('#000000')
  })

  it('classifies the shipped theme backgrounds correctly', () => {
    expect(isLight(parseHex('#fdfbf6')!)).toBe(true)   // White & Gold
    expect(isLight(parseHex('#0a0f1e')!)).toBe(false)  // Moonlight
    expect(isLight(parseHex('#000000')!)).toBe(false)  // Midnight / Matrix
    expect(isLight(parseHex('#1e0a10')!)).toBe(false)  // Crimson
  })
})
