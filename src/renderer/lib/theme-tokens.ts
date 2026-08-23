/**
 * theme-tokens.ts — turns three user-picked colours into the full CSS token set.
 *
 * A custom theme gives the user control over exactly what the built-in themes
 * vary: the two-tone scheme (page background + accent) and the text colour.
 * Everything else in index.css is derived from those, using the same
 * relationships the shipped themes already encode — e.g. Moonlight's
 * --bg-dark/--bg-surface sit ~+2.7 and ~+8.7 lightness points above --bg-deep,
 * and its --text-muted is --text-primary blended most of the way to the
 * background with a touch of accent mixed back in.
 *
 * Pure: no DOM access, so the derivation is unit-tested (theme-tokens.test.ts).
 * Applying the result to <html> lives in theme.ts.
 */

import {
  capSaturation,
  contrastRatio,
  isLight,
  mix,
  parseHex,
  readableOn,
  rgbToHsl,
  rotateHue,
  shiftLightness,
  toHex,
  toRgbTriplet,
  withLightness,
  type RGB
} from './color'

/** The three colours a custom theme is built from. Hex strings, `#rrggbb`. */
export interface CustomThemeColors {
  /** Page background — maps onto --bg-deep. */
  bg: string
  /** Brand/highlight colour — maps onto --accent. */
  accent: string
  /** Primary text colour — maps onto --text-primary. */
  text: string
}

export type ThemeTone = 'light' | 'dark'

export interface DerivedTheme {
  tone: ThemeTone
  /** CSS custom properties, keyed WITH the leading `--`. */
  vars: Record<string, string>
}

export const DEFAULT_CUSTOM_COLORS: CustomThemeColors = {
  bg: '#0a0f1e',
  accent: '#00aaff',
  text: '#e8f4ff'
}

/** Tolerant parse — falls back to the Moonlight-ish default on garbage input. */
function rgbOf(hex: string, fallback: string): RGB {
  return parseHex(hex) ?? parseHex(fallback) ?? { r: 0, g: 0, b: 0 }
}

const rgba = (c: RGB, a: number) => `rgba(${toRgbTriplet(c)}, ${a})`

/**
 * Contrast of the body text against the page background, as a WCAG ratio.
 * Surfaced in the editor so a user can see when a pairing is unreadable —
 * it warns, it never blocks: the point of a custom theme is full control.
 */
export function textContrast(colors: CustomThemeColors): number {
  const bg = rgbOf(colors.bg, DEFAULT_CUSTOM_COLORS.bg)
  const text = rgbOf(colors.text, DEFAULT_CUSTOM_COLORS.text)
  return contrastRatio(bg, text)
}

/** Contrast of the accent against the page background (buttons, links, focus). */
export function accentContrast(colors: CustomThemeColors): number {
  const bg = rgbOf(colors.bg, DEFAULT_CUSTOM_COLORS.bg)
  const accent = rgbOf(colors.accent, DEFAULT_CUSTOM_COLORS.accent)
  return contrastRatio(bg, accent)
}

export function toneOf(bgHex: string): ThemeTone {
  return isLight(rgbOf(bgHex, DEFAULT_CUSTOM_COLORS.bg)) ? 'light' : 'dark'
}

export function deriveThemeTokens(colors: CustomThemeColors): DerivedTheme {
  const bgDeep = rgbOf(colors.bg, DEFAULT_CUSTOM_COLORS.bg)
  const accent = rgbOf(colors.accent, DEFAULT_CUSTOM_COLORS.accent)
  const text = rgbOf(colors.text, DEFAULT_CUSTOM_COLORS.text)

  const tone: ThemeTone = isLight(bgDeep) ? 'light' : 'dark'
  const deepL = rgbToHsl(bgDeep).l

  // Layering. Dark themes stack UP from the page colour (deep -> dark -> surface);
  // light themes put the PAGE in the middle and lift cards to near-white, which
  // is how White & Gold reads as paper rather than as an inverted dark theme.
  const bgDark = tone === 'dark' ? shiftLightness(bgDeep, 2.7) : shiftLightness(bgDeep, -5.3)
  const bgSurface = tone === 'dark'
    ? shiftLightness(bgDeep, 8.7)
    : withLightness(bgDeep, deepL >= 97 ? 100 : deepL + 4)

  // Glassmorphism only makes sense over a dark stack; the light tone goes flat
  // and opaque (the same call White & Gold makes with --blur: none).
  const bgCard = tone === 'dark' ? rgba(bgSurface, 0.75) : toHex(bgSurface)
  const bgCardHover = tone === 'dark' ? rgba(bgSurface, 0.95) : toHex(shiftLightness(bgSurface, -2))

  // Accent family. --accent-2 is the gradient partner (a small hue rotation, a
  // little brighter); --accent-text is the *readable* form of the accent used
  // for labels, so it is pushed to a lightness that survives the background.
  const accentHover = shiftLightness(accent, tone === 'dark' ? 8 : 6)
  const accent2 = shiftLightness(rotateHue(accent, 18), 6)
  const accentText = tone === 'dark'
    ? capSaturation(withLightness(accent, 80), 95)
    : withLightness(accent, 30)
  const onAccent = readableOn(accent)

  // Neutral chrome. Blending the text colour into the background (with a hint of
  // accent mixed back) reproduces the shipped themes' secondary/muted greys to
  // within a few points instead of flattening them to pure grey.
  // mix()'s t is the weight of the SECOND colour, so 0.38 keeps most of the
  // text colour and the larger weight pulls the muted tier towards the page.
  // Light themes stop short of that: fading dark ink into a pale page loses
  // legibility far faster than fading light ink into a dark one, and 0.62 is
  // what lands on White & Gold's hand-picked --text-muted.
  const textSecondary = mix(mix(text, bgDeep, 0.38), accent, 0.18)
  const textMuted = mix(mix(text, bgDeep, tone === 'dark' ? 0.72 : 0.62), accent, 0.14)

  const vars: Record<string, string> = {
    '--bg-deep': toHex(bgDeep),
    '--bg-dark': toHex(bgDark),
    '--bg-surface': toHex(bgSurface),
    '--bg-card': bgCard,
    '--bg-card-hover': bgCardHover,
    '--bg-deep-rgb': toRgbTriplet(bgDeep),
    '--bg-surface-rgb': toRgbTriplet(bgSurface),

    '--accent': toHex(accent),
    '--accent-rgb': toRgbTriplet(accent),
    '--accent-hover': toHex(accentHover),
    '--accent-2': toHex(accent2),
    '--accent-text': toHex(accentText),
    '--accent-text-rgb': toRgbTriplet(accentText),
    // Both the small glyphs on an accent fill and the primary button's label
    // pick whichever of black/white actually reads on the chosen accent.
    '--on-accent': toHex(onAccent),
    '--btn-primary-text': toHex(onAccent),
    '--accent-dim': rgba(accent, tone === 'dark' ? 0.18 : 0.14),
    '--accent-glow': rgba(accent, tone === 'dark' ? 0.35 : 0.22),

    '--text-primary': toHex(text),
    '--text-secondary': toHex(textSecondary),
    '--text-muted': toHex(textMuted),

    // A hairline of accent is enough on a dark stack; on paper it needs more.
    '--border': rgba(accent, tone === 'dark' ? 0.12 : 0.3),
    '--border-active': rgba(accent, tone === 'dark' ? 0.45 : 0.65),

    '--input-bg': tone === 'dark' ? 'rgba(0, 0, 0, 0.3)' : rgba(text, 0.04),
    '--hover-flat': tone === 'dark' ? 'rgba(255, 255, 255, 0.06)' : rgba(text, 0.05),
    '--hover-faint': tone === 'dark' ? 'rgba(255, 255, 255, 0.04)' : rgba(text, 0.03),
    '--overlay-bg': tone === 'dark'
      ? rgba(shiftLightness(bgDeep, -3), 0.6)
      : rgba(shiftLightness(bgDeep, -55), 0.35),

    '--blur': tone === 'dark' ? 'blur(20px)' : 'none',

    // App Hub cards draw their label over artwork, so they carry their own
    // contrast handling rather than inheriting --text-primary.
    '--card-text': tone === 'light' ? toHex(text) : '#f8fbff',
    '--card-text-dim': tone === 'light' ? rgba(text, 0.75) : 'rgba(248, 251, 255, 0.82)',
    '--card-text-shadow': tone === 'light'
      ? 'none'
      : '0 1px 2px rgba(0, 0, 0, 0.95), 0 0 8px rgba(0, 0, 0, 0.72)'
  }

  return { tone, vars }
}

/** Swatch pair for the picker row: [background, accent]. */
export function swatchOf(colors: CustomThemeColors): [string, string] {
  return [
    toHex(rgbOf(colors.bg, DEFAULT_CUSTOM_COLORS.bg)),
    toHex(rgbOf(colors.accent, DEFAULT_CUSTOM_COLORS.accent))
  ]
}
