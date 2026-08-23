/**
 * color.ts — pure colour maths for the custom-theme editor.
 *
 * No DOM, no React: everything here is a plain function over numbers so the
 * derivation in theme-tokens.ts can be unit-tested under the node vitest
 * environment (see vitest.config.ts).
 *
 * Conventions: RGB channels are 0-255 (not necessarily integers until they are
 * formatted), H is 0-360, S/L/V are 0-100. Alpha is handled by the callers that
 * need it (tokens are emitted as `rgba(r, g, b, a)` strings).
 */

export interface RGB { r: number; g: number; b: number }
export interface HSL { h: number; s: number; l: number }
export interface HSV { h: number; s: number; v: number }

const clamp = (n: number, min: number, max: number) => n < min ? min : n > max ? max : n
export const clamp255 = (n: number) => clamp(Math.round(n), 0, 255)

/** Wrap a hue into [0, 360). */
export const normalizeHue = (h: number) => ((h % 360) + 360) % 360

// ── Parsing / formatting ─────────────────────────────────────────────────────

/**
 * Parse `#rgb`, `#rrggbb` (with or without the `#`). Returns null for anything
 * else so callers can keep an invalid input in the field without applying it.
 */
export function parseHex(input: string): RGB | null {
  const s = input.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    return {
      r: parseInt(s[0] + s[0], 16),
      g: parseInt(s[1] + s[1], 16),
      b: parseInt(s[2] + s[2], 16)
    }
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16)
    }
  }
  return null
}

export function toHex({ r, g, b }: RGB): string {
  const h = (n: number) => clamp255(n).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** `12, 34, 56` — the triplet form the CSS tokens use (see --accent-rgb). */
export function toRgbTriplet({ r, g, b }: RGB): string {
  return `${clamp255(r)}, ${clamp255(g)}, ${clamp255(b)}`
}

export function toRgbString(c: RGB): string {
  return `rgb(${toRgbTriplet(c)})`
}

export function toHslString(c: RGB): string {
  const { h, s, l } = rgbToHsl(c)
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`
}

/**
 * Accepts everything the editor's text field may hold: hex, `rgb(r,g,b)`,
 * `r, g, b`, `hsl(h, s%, l%)`, or `h, s%, l%`. Returns null when unparseable.
 */
export function parseColor(input: string): RGB | null {
  const s = input.trim()
  if (!s) return null

  const hex = parseHex(s)
  if (hex) return hex

  const nums = s.match(/-?\d+(\.\d+)?/g)
  if (!nums || nums.length < 3) return null
  const [a, b, c] = nums.slice(0, 3).map(Number)

  if (/^hsl/i.test(s) || (s.includes('%') && !/^rgb/i.test(s))) {
    return hslToRgb({ h: normalizeHue(a), s: clamp(b, 0, 100), l: clamp(c, 0, 100) })
  }
  if (a > 255 || b > 255 || c > 255 || a < 0 || b < 0 || c < 0) return null
  return { r: a, g: b, b: c }
}

// ── Conversions ──────────────────────────────────────────────────────────────

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  const l = (max + min) / 2

  let h = 0
  let s = 0
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1))
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
  }
  return { h: normalizeHue(h), s: clamp(s * 100, 0, 100), l: l * 100 }
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const hn = normalizeHue(h)
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1))
  const m = ln - c / 2

  let rgb: [number, number, number]
  if (hn < 60) rgb = [c, x, 0]
  else if (hn < 120) rgb = [x, c, 0]
  else if (hn < 180) rgb = [0, c, x]
  else if (hn < 240) rgb = [0, x, c]
  else if (hn < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]

  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 }
}

export function rgbToHsv({ r, g, b }: RGB): HSV {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min

  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
  }
  return { h: normalizeHue(h), s: max === 0 ? 0 : (d / max) * 100, v: max * 100 }
}

export function hsvToRgb({ h, s, v }: HSV): RGB {
  const hn = normalizeHue(h)
  const sn = clamp(s, 0, 100) / 100
  const vn = clamp(v, 0, 100) / 100
  const c = vn * sn
  const x = c * (1 - Math.abs(((hn / 60) % 2) - 1))
  const m = vn - c

  let rgb: [number, number, number]
  if (hn < 60) rgb = [c, x, 0]
  else if (hn < 120) rgb = [x, c, 0]
  else if (hn < 180) rgb = [0, c, x]
  else if (hn < 240) rgb = [0, x, c]
  else if (hn < 300) rgb = [x, 0, c]
  else rgb = [c, 0, x]

  return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 }
}

// ── Manipulation ─────────────────────────────────────────────────────────────

/** Linear blend in sRGB space; t = 0 → a, t = 1 → b. */
export function mix(a: RGB, b: RGB, t: number): RGB {
  const k = clamp(t, 0, 1)
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k
  }
}

/** Move HSL lightness by `delta` points, keeping hue and saturation. */
export function shiftLightness(c: RGB, delta: number): RGB {
  const hsl = rgbToHsl(c)
  return hslToRgb({ ...hsl, l: clamp(hsl.l + delta, 0, 100) })
}

export function withLightness(c: RGB, l: number): RGB {
  const hsl = rgbToHsl(c)
  return hslToRgb({ ...hsl, l: clamp(l, 0, 100) })
}

export function rotateHue(c: RGB, deg: number): RGB {
  const hsl = rgbToHsl(c)
  return hslToRgb({ ...hsl, h: normalizeHue(hsl.h + deg) })
}

/** Clamp saturation to at most `max` points (used to keep tints from glowing). */
export function capSaturation(c: RGB, max: number): RGB {
  const hsl = rgbToHsl(c)
  return hsl.s <= max ? c : hslToRgb({ ...hsl, s: max })
}

// ── Contrast ─────────────────────────────────────────────────────────────────

/** WCAG relative luminance, 0 (black) … 1 (white). */
export function relativeLuminance({ r, g, b }: RGB): number {
  const ch = (v: number) => {
    const s = clamp(v, 0, 255) / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}

/** WCAG contrast ratio, 1 … 21. */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const BLACK: RGB = { r: 0, g: 0, b: 0 }
const WHITE: RGB = { r: 255, g: 255, b: 255 }

/** Whichever of black/white reads better on `c` — for text sitting on a fill. */
export function readableOn(c: RGB): RGB {
  return contrastRatio(c, WHITE) >= contrastRatio(c, BLACK) ? WHITE : BLACK
}

/** Is this colour light enough that the UI around it must flip to a light look? */
export function isLight(c: RGB): boolean {
  return relativeLuminance(c) > 0.35
}
