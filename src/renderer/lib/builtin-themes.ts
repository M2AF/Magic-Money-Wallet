/**
 * builtin-themes.ts — the themes that ship with the wallet, and the rules for
 * editing them.
 *
 * Two kinds of built-in live in the same list:
 *
 *   css: true   The original six. index.css carries a hand-tuned block for the
 *               id (gradients, glows, a mono display font), so they render from
 *               the stylesheet, not from `colors`.
 *   (no css)    Themes defined ONLY by their three colours, expanded through
 *               deriveThemeTokens() exactly like a user-made theme. No
 *               stylesheet knows they exist.
 *
 * `colors` is present on both, because both can be EDITED: the editor starts
 * from these three colours, and once a theme is edited it is rendered from the
 * derived token set whatever kind it is (theme.ts stamps data-derived, and the
 * hand-tuned CSS blocks opt out of it with :not([data-derived])). Reverting
 * simply drops the override, which brings the original — stylesheet block and
 * all — straight back.
 *
 * Pure: no DOM, no storage. Applying and persisting live in theme.ts.
 */

import type { ThemeEntries } from '../../shared/theme-sync-wire'
import { swatchOf, type CustomThemeColors } from './theme-tokens'

export type BuiltinThemeId =
  // Hand-tuned in index.css
  | 'moonlight' | 'crimson' | 'grape' | 'matrix' | 'white-gold' | 'midnight'
  // Derived from three colours
  | 'cardano' | 'milady' | 'monad' | 'abstract' | 'bitcoin' | 'sappy-seals'

export interface ThemeDef {
  id: BuiltinThemeId
  name: string
  /** Swatch colors for the picker: [background, accent] */
  swatch: [string, string]
  /**
   * The theme's three colours: what the editor opens with, and — for the themes
   * with no CSS block — the theme's only definition.
   */
  colors: CustomThemeColors
  /** true when index.css carries a hand-tuned block for this id. */
  css?: true
}

/**
 * The shipped themes, in picker order.
 *
 * ⚠ For a `css: true` theme, `colors` must stay the [--bg-deep, --accent,
 * --text-primary] of its block in index.css. They are the colours someone sees
 * when they open the editor on it, so a drift here makes "edit, then revert"
 * look like the theme changed on its own.
 */
export const THEMES: ThemeDef[] = [
  { id: 'moonlight',  name: 'Moonlight',    css: true, swatch: ['#0a0f1e', '#00aaff'], colors: { bg: '#060b18', accent: '#00aaff', text: '#e8f4ff' } },
  { id: 'crimson',    name: 'Crimson',      css: true, swatch: ['#1e0a10', '#ff3355'], colors: { bg: '#18060a', accent: '#ff3355', text: '#ffe8ec' } },
  { id: 'grape',      name: 'Grape',        css: true, swatch: ['#120a1e', '#a24dff'], colors: { bg: '#0d0618', accent: '#a24dff', text: '#f2e8ff' } },
  { id: 'matrix',     name: 'Matrix',       css: true, swatch: ['#000000', '#00ff41'], colors: { bg: '#000000', accent: '#00ff41', text: '#ccffd6' } },
  { id: 'white-gold', name: 'White & Gold', css: true, swatch: ['#fdfbf6', '#c9a227'], colors: { bg: '#f6f2ea', accent: '#c9a227', text: '#3a3325' } },
  { id: 'midnight',   name: 'Midnight',     css: true, swatch: ['#000000', '#ffffff'], colors: { bg: '#000000', accent: '#ffffff', text: '#f5f5f5' } },

  // Chain and collection themes. Derived, so what the picker shows is exactly
  // what deriveThemeTokens() makes of the three colours — nothing hand-tuned.
  { id: 'cardano',     name: 'Cardano',     swatch: ['#03091a', '#0033ad'], colors: { bg: '#03091a', accent: '#0033ad', text: '#ffffff' } },
  { id: 'milady',      name: 'milady',      swatch: ['#ffeaf8', '#ff4b97'], colors: { bg: '#ffeaf8', accent: '#ff4b97', text: '#ff4b97' } },
  { id: 'monad',       name: 'Monad',       swatch: ['#140529', '#6e54ff'], colors: { bg: '#140529', accent: '#6e54ff', text: '#85e6ff' } },
  { id: 'abstract',    name: 'Abstract',    swatch: ['#ffffff', '#52f293'], colors: { bg: '#ffffff', accent: '#52f293', text: '#000000' } },
  { id: 'bitcoin',     name: 'Bitcoin',     swatch: ['#000000', '#f2a900'], colors: { bg: '#000000', accent: '#f2a900', text: '#ababab' } },
  { id: 'sappy-seals', name: 'Sappy Seals', swatch: ['#ffffff', '#000000'], colors: { bg: '#ffffff', accent: '#000000', text: '#000000' } },
]

const BY_ID = new Map<string, ThemeDef>(THEMES.map(t => [t.id, t]))

export const isBuiltinThemeId = (v: unknown): v is BuiltinThemeId =>
  typeof v === 'string' && BY_ID.has(v)

export function themeDef(id: BuiltinThemeId): ThemeDef {
  // Every BuiltinThemeId is in the table by construction; the fallback only
  // exists so a corrupted stored id cannot throw on the way to the default.
  return BY_ID.get(id) ?? THEMES[0]
}

// ── Overrides ────────────────────────────────────────────────────────────────
//
// An edited built-in is stored as nothing more than the three colours the user
// chose. Absence is the default — there is no "reset" record to keep in sync,
// so reverting is a delete and can never half-apply.

export type BuiltinOverrides = Partial<Record<BuiltinThemeId, CustomThemeColors>>

const HEX = /^#[0-9a-f]{6}$/i

export function isThemeColors(v: unknown): v is CustomThemeColors {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return [c.bg, c.accent, c.text].every(x => typeof x === 'string' && HEX.test(x))
}

/**
 * Drop anything that is not a known theme id mapped to three well-formed hex
 * colours. A bad entry is skipped rather than defaulted: defaulting would
 * silently pin a theme to Moonlight's colours instead of leaving it shipped.
 */
export function sanitizeBuiltinOverrides(value: unknown): BuiltinOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: BuiltinOverrides = {}
  for (const [id, colors] of Object.entries(value as Record<string, unknown>)) {
    if (!isBuiltinThemeId(id) || !isThemeColors(colors)) continue
    out[id] = {
      bg: colors.bg.toLowerCase(),
      accent: colors.accent.toLowerCase(),
      text: colors.text.toLowerCase(),
    }
  }
  return out
}

/** Hex comparison that ignores the case the colour was written in. */
export function sameColors(a: CustomThemeColors, b: CustomThemeColors): boolean {
  return (['bg', 'accent', 'text'] as const).every(k => a[k].toLowerCase() === b[k].toLowerCase())
}

/**
 * The built-in whose SHIPPED colours are exactly these, if any.
 *
 * Used once per install to fold away user-made copies of a theme that has since
 * become a built-in — the six chain/collection themes below were custom themes
 * before they were shipped, so whoever made them would otherwise see every one
 * of them twice and have no free slots left. Exact match only: a near-miss is
 * somebody deliberately tweaking a theme, and must be left alone.
 */
export function matchingBuiltin(colors: CustomThemeColors): BuiltinThemeId | null {
  return THEMES.find(t => sameColors(t.colors, colors))?.id ?? null
}

/** [background, accent] for the picker dot, honouring an override. */
export function builtinSwatch(def: ThemeDef, override?: CustomThemeColors | null): [string, string] {
  return override ? swatchOf(override) : def.swatch
}

export interface AbsorbPlan {
  /** Custom theme ids to tombstone: each is a copy of a theme we now ship. */
  tombstone: string[]
  /** The built-in to wear instead, when the active theme was one of those copies. */
  moveTo: BuiltinThemeId | null
}

/**
 * What to do about custom themes that have since become built-ins.
 *
 * Pure, and separated from the storage it drives, because the consequence is a
 * DELETE of somebody's saved theme: the rules for which ones go — live entries
 * only, exact colour match only, and the selection following the theme it was
 * wearing — are worth asserting directly rather than through the app.
 *
 * Returns an empty plan when there is nothing to do, so the caller can write
 * nothing at all in the overwhelmingly common case.
 */
export function planAbsorbShipped(entries: ThemeEntries, activeId: string | null): AbsorbPlan {
  const plan: AbsorbPlan = { tombstone: [], moveTo: null }
  for (const [id, entry] of Object.entries(entries)) {
    // A tombstone carries no colours; matching one would "re-delete" it and
    // push a pointless newer record to every other device.
    if (entry.d === 1) continue
    const builtin = matchingBuiltin(entry.c)
    if (!builtin) continue
    plan.tombstone.push(id)
    if (id === activeId) plan.moveTo = builtin
  }
  return plan
}
