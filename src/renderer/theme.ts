// ── Theme manager ───────────────────────────────────────────────────────────
// Themes are pure CSS-token overrides (see the Themes section of index.css);
// switching is just stamping data-theme on <html>. The choice persists in
// localStorage and syncs live to every other window of the app (wallet +
// popup browser chrome share the same origin) via the `storage` event.
//
// Custom themes work the same way, except the tokens come from the user's three
// colours instead of a CSS block: deriveThemeTokens() expands them into the full
// set and they are written as inline custom properties on <html>. Inline wins
// over every :root rule, so no stylesheet has to know a custom theme exists.
//
// A BUILT-IN can be recoloured too, and it uses that same machinery: editing one
// stores three colours under its id and the theme is then derived rather than
// read from the stylesheet. <html> carries data-derived while that is true, and
// the six hand-tuned blocks in index.css are written :not([data-derived]), so an
// edited White & Gold cannot end up wearing the original's ivory gradients.
// Reverting deletes the override, and the shipped theme — block and all — is
// back exactly as it was. Deliberately LOCAL, unlike custom themes: the sync
// wire is frozen around `custom-` ids (shared/theme-sync-wire.ts), and a recolour
// of a shipped theme is a per-install preference rather than the user's own work.
//
// Custom themes are also carried on the user's ChainLens profile, so they follow
// the person rather than the install (main/theme-sync.ts). Two storage layers,
// in this order of authority:
//
//   localStorage   ALWAYS what the picker renders from, written synchronously.
//                  Sync is a convenience; a wallet with no network must still
//                  make and wear themes.
//   ChainLens      the same themes on the profile, merged in when Settings opens
//                  and pushed after every save or delete.
//
// ⚠ A FAILED SYNC MUST NEVER EMPTY THE PICKER. `null` from the bridge means "no
// answer" — offline, no profile, unconfigured, an older build — and is
// deliberately not the same value as "no themes".

import {
  deriveThemeTokens,
  DEFAULT_CUSTOM_COLORS,
  swatchOf,
  type CustomThemeColors,
  type ThemeTone
} from './lib/theme-tokens'
import {
  liveThemeEntries,
  mergeThemeEntries,
  pruneThemeEntries,
  sanitizeThemeEntries,
  type ThemeEntries
} from '../shared/theme-sync-wire'
import {
  builtinSwatch,
  isBuiltinThemeId,
  planAbsorbShipped,
  sanitizeBuiltinOverrides,
  sameColors,
  themeDef,
  THEMES,
  type BuiltinOverrides,
  type BuiltinThemeId,
  type ThemeDef
} from './lib/builtin-themes'

/** A user-made theme's id — also the value stamped into data-theme. */
export type CustomThemeId = `custom-${string}`
export type ThemeId = BuiltinThemeId | CustomThemeId

export interface CustomTheme {
  id: CustomThemeId
  name: string
  colors: CustomThemeColors
}

const STORAGE_KEY = 'mm.theme'
/** Sync-shaped store: id -> { n, c, t, d? }. See shared/theme-sync-wire.ts. */
const ENTRIES_KEY = 'mm.themes.v2'
/**
 * The pre-sync store — a plain array with no timestamps, so it cannot express a
 * deletion or lose a merge. Read once by migrateLegacy() and then left in place,
 * so downgrading to the previous build still finds the user's themes.
 */
const LEGACY_KEY = 'mm.themes.custom'
const MIGRATED_KEY = 'mm.themes.migrated.v2'
/** Recoloured built-ins: id -> the three colours. Local to this install. */
const BUILTIN_KEY = 'mm.themes.builtin.v1'
/** Ran the one-time fold of user copies of a now-shipped theme (see absorbShipped). */
const ABSORBED_KEY = 'mm.themes.absorbed.v1'
const CUSTOM_PREFIX = 'custom-'
const DEFAULT_THEME: BuiltinThemeId = 'moonlight'
/** Hiding five colour tweaks behind one request; a save is deliberate, so short. */
const PUSH_DEBOUNCE_MS = 800

/** How many themes a user may keep alongside the built-ins. */
export const MAX_CUSTOM_THEMES = 6

export const isCustomThemeId = (v: unknown): v is CustomThemeId =>
  typeof v === 'string' && v.startsWith(CUSTOM_PREFIX)

// ── Custom theme storage ───────────────────────────────────────────────────────
//
// The store is the SYNC shape (id -> entry), not a plain list, because a list
// cannot express the two things sync needs: when each theme last changed, and
// that a theme was deleted rather than simply never seen.

const isColors = (v: unknown): v is CustomThemeColors => {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return typeof c.bg === 'string' && typeof c.accent === 'string' && typeof c.text === 'string'
}

function readEntries(): ThemeEntries {
  try {
    const raw = localStorage.getItem(ENTRIES_KEY)
    return migrateLegacy(raw ? sanitizeThemeEntries(JSON.parse(raw)) : {})
  } catch {
    return {}
  }
}

function writeEntries(entries: ThemeEntries): void {
  try { localStorage.setItem(ENTRIES_KEY, JSON.stringify(pruneThemeEntries(entries))) }
  catch { /* private mode / quota — the theme just won't persist */ }
}

/**
 * Fold the pre-sync array into the entries map, once.
 *
 * Timestamped at 0 so that ANY later decision, on any device, outranks it: a
 * migrated theme must never beat an edit or a delete the user has since made
 * elsewhere. The legacy key is left in place rather than deleted, so downgrading
 * to the previous build still finds the themes.
 */
function migrateLegacy(entries: ThemeEntries): ThemeEntries {
  try {
    if (localStorage.getItem(MIGRATED_KEY) === '1') return entries
    const raw = localStorage.getItem(LEGACY_KEY)
    const out: ThemeEntries = { ...entries }
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(parsed)) {
      for (const t of parsed) {
        const theme = t as Partial<CustomTheme>
        if (!isCustomThemeId(theme?.id) || !isColors(theme?.colors)) continue
        if (!out[theme.id]) {
          out[theme.id] = {
            n: String(theme.name ?? 'Custom').slice(0, 24) || 'Custom',
            c: { ...(theme.colors as CustomThemeColors) },
            t: 0
          }
        }
      }
    }
    const clean = sanitizeThemeEntries(out)
    localStorage.setItem(MIGRATED_KEY, '1')
    localStorage.setItem(ENTRIES_KEY, JSON.stringify(clean))
    return clean
  } catch {
    return entries
  }
}

/**
 * Every saved custom theme, oldest first — the order the picker draws them in,
 * which must stay stable as the user edits. (liveThemeEntries sorts newest-first
 * to apply the cap, so re-using that order would make tiles jump around.)
 */
export function getCustomThemes(): CustomTheme[] {
  return liveThemeEntries(readEntries())
    .reverse()
    .map(([id, e]) => ({ id: id as CustomThemeId, name: e.n, colors: { ...e.c } }))
}

/** `custom-` + a short random suffix; crypto.randomUUID isn't needed here. */
function newCustomId(): CustomThemeId {
  const rand = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4)
  return `${CUSTOM_PREFIX}${rand}`
}

export function findCustomTheme(id: CustomThemeId): CustomTheme | null {
  return getCustomThemes().find(t => t.id === id) ?? null
}

// ── Change notification ────────────────────────────────────────────────────────
// The picker has to redraw when a PULL brings a theme in from another device,
// not only when this window saves one.

type ThemesListener = () => void
const listeners = new Set<ThemesListener>()

export function onCustomThemesChange(cb: ThemesListener): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

function notify(): void {
  for (const cb of [...listeners]) {
    try { cb() } catch { /* a listener must not break a save */ }
  }
}

// ── Recoloured built-ins ─────────────────────────────────────────────────────
//
// Storing ONLY the colours, and only for the themes that were actually changed,
// is what makes "revert" trivial: there is no default to restore, just an
// override to delete. It also means a theme reshipped with new colours in a
// later version reaches everyone who never touched it.

function readOverrides(): BuiltinOverrides {
  try {
    const raw = localStorage.getItem(BUILTIN_KEY)
    return raw ? sanitizeBuiltinOverrides(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

function writeOverrides(overrides: BuiltinOverrides): void {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(BUILTIN_KEY)
    else localStorage.setItem(BUILTIN_KEY, JSON.stringify(overrides))
  } catch { /* private mode / quota — the recolour just won't persist */ }
}

/** The user's colours for this built-in, or null when it is still as shipped. */
export function getBuiltinOverride(id: BuiltinThemeId): CustomThemeColors | null {
  const found = readOverrides()[id]
  return found ? { ...found } : null
}

/** What the editor opens with: the user's colours if any, else the shipped ones. */
export function getBuiltinColors(id: BuiltinThemeId): CustomThemeColors {
  return getBuiltinOverride(id) ?? { ...themeDef(id).colors }
}

export function isBuiltinEdited(id: BuiltinThemeId): boolean {
  return getBuiltinOverride(id) !== null
}

/**
 * Recolour a built-in.
 *
 * Colours equal to the shipped ones are stored as NO override rather than as a
 * copy: otherwise "edit it back to how it was" would leave the theme flagged as
 * edited forever, still derived, and still missing its hand-tuned CSS.
 */
export function saveBuiltinTheme(id: BuiltinThemeId, colors: CustomThemeColors): void {
  const overrides = readOverrides()
  if (sameColors(colors, themeDef(id).colors)) delete overrides[id]
  else overrides[id] = { ...colors }
  writeOverrides(overrides)
  notify()
  if (getTheme() === id) applyTheme(id)
}

/** Put a built-in back to the colours it shipped with. */
export function resetBuiltinTheme(id: BuiltinThemeId): void {
  const overrides = readOverrides()
  if (!(id in overrides)) return
  delete overrides[id]
  writeOverrides(overrides)
  notify()
  if (getTheme() === id) applyTheme(id)
}

/**
 * Which built-ins this install has recoloured. The picker holds this in state
 * so a save or a revert redraws the tiles, rather than inferring it from the
 * custom-theme list happening to change at the same time.
 */
export function getEditedBuiltins(): BuiltinThemeId[] {
  return Object.keys(readOverrides()) as BuiltinThemeId[]
}

/** [background, accent] for a built-in's picker dot, honouring an override. */
export function themeSwatch(def: ThemeDef): [string, string] {
  return builtinSwatch(def, getBuiltinOverride(def.id))
}

/**
 * One-time: fold away custom themes that are colour-for-colour a theme the app
 * now ships, and move the selection onto the built-in if one of them was being
 * worn.
 *
 * The six chain/collection themes were user-made before they were promoted to
 * built-ins, so without this the people who made them open Appearance to find
 * each one twice and every custom slot spent on a duplicate.
 *
 * ⚠ Tombstones, like every other delete here — dropping the key would let the
 * next push from a device that still holds the theme resurrect it. The
 * tombstones are NOT pushed from here: the next syncCustomThemes() sees them as
 * newer than the server's copies and sends them, so this costs no request at
 * startup.
 */
function absorbShipped(): void {
  try {
    if (localStorage.getItem(ABSORBED_KEY) === '1') return
    localStorage.setItem(ABSORBED_KEY, '1')
    const entries = readEntries()
    const plan = planAbsorbShipped(entries, localStorage.getItem(STORAGE_KEY))
    if (plan.tombstone.length === 0) return

    const t = Date.now()
    for (const id of plan.tombstone) {
      entries[id] = { n: '', c: { bg: '', accent: '', text: '' }, t, d: 1 }
    }
    writeEntries(entries)
    // Same theme, different tile: whoever was wearing the copy keeps the look.
    if (plan.moveTo) localStorage.setItem(STORAGE_KEY, plan.moveTo)
    notify()
  } catch { /* a failed tidy-up must never stop the app from painting */ }
}

// ── Profile sync ─────────────────────────────────────────────────────────────

/**
 * What the last sync attempt did. Surfaced in the picker because a theme that
 * silently fails to travel is indistinguishable from one that never tried —
 * which is exactly how this went unnoticed through two rounds of debugging.
 */
export type ThemeSyncState = 'idle' | 'syncing' | 'synced' | 'unavailable' | 'error'

export interface ThemeSyncStatus {
  state: ThemeSyncState
  /** The server's own wording when state is 'error'. */
  error: string | null
  /** How many themes the profile is holding, when known. */
  remote: number | null
}

let syncStatus: ThemeSyncStatus = { state: 'idle', error: null, remote: null }

export function getThemeSyncStatus(): ThemeSyncStatus {
  return syncStatus
}

function setSyncStatus(next: ThemeSyncStatus): void {
  syncStatus = next
  notify()
}

let pushTimer: ReturnType<typeof setTimeout> | null = null

/** Merge a server reply in. Returns whether anything actually changed here. */
function absorb(remote: ThemeEntries): boolean {
  const before = localStorage.getItem(ENTRIES_KEY)
  writeEntries(mergeThemeEntries(readEntries(), sanitizeThemeEntries(remote)))
  if (localStorage.getItem(ENTRIES_KEY) === before) return false
  notify()
  // An edit to the theme currently being worn arrives as new colours.
  applyTheme(getTheme())
  return true
}

function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    void (async () => {
      // Bound before calling: `fn?.().catch()` throws on builds without the
      // bridge, because the optional call yields undefined.
      const push = window.wallet?.customThemesPush
      if (!push) { setSyncStatus({ state: 'unavailable', error: null, remote: null }); return }
      setSyncStatus({ ...syncStatus, state: 'syncing' })
      const result = await push.call(window.wallet, readEntries())
        .catch((e: unknown) => ({ entries: null, error: e instanceof Error ? e.message : String(e) }))
      if (result?.entries) {
        absorb(result.entries)
        const live = Object.values(result.entries).filter(e => e.d !== 1).length
        setSyncStatus({ state: 'synced', error: null, remote: live })
      } else {
        setSyncStatus({
          state: 'error',
          error: (result?.error ?? 'Could not reach your profile').replace(/^Error:\s*/, ''),
          remote: null,
        })
      }
    })()
  }, PUSH_DEBOUNCE_MS)
}

/**
 * Pull the profile's themes, merge them in, then push back anything the server
 * has never seen. Called when the picker opens — the only place custom themes
 * are visible — so the app pays nothing for this at startup.
 *
 * Merged, never assigned: a theme made offline on this device is newer than
 * whatever the server holds and must survive the pull that follows reconnecting.
 */
export async function syncCustomThemes(opts: { force?: boolean } = {}): Promise<ThemeSyncStatus> {
  const get = window.wallet?.customThemesGet
  if (!get) {
    // No bridge at all: an older build, or a dev session whose main process
    // predates the sync code. Worth saying out loud rather than doing nothing.
    setSyncStatus({ state: 'unavailable', error: null, remote: null })
    return syncStatus
  }

  setSyncStatus({ ...syncStatus, state: 'syncing' })
  const remote = await get.call(window.wallet).catch(() => null)
  // null is "could not sync", NOT "no themes" — leave the picker alone.
  if (!remote) {
    setSyncStatus({ state: 'error', error: 'Could not reach your ChainLens profile', remote: null })
    return syncStatus
  }

  const local = readEntries()
  absorb(remote)

  const clean = sanitizeThemeEntries(remote)
  setSyncStatus({
    state: 'synced',
    error: null,
    remote: Object.values(clean).filter(e => e.d !== 1).length,
  })

  // Anything on the local side the server does not already hold at least as new
  // exists only here: themes made offline, or migrated off the pre-sync store.
  // Nothing else would push them until the user's NEXT edit.
  if (opts.force || Object.entries(local).some(([id, e]) => !clean[id] || clean[id].t < e.t)) {
    schedulePush()
  }
  return syncStatus
}

/** Push now, whatever the local/remote comparison says — the Retry affordance. */
export function retryThemeSync(): Promise<ThemeSyncStatus> {
  return syncCustomThemes({ force: true })
}

/**
 * Create or update a custom theme. Returns the saved record, or null when the
 * list is already full (the caller shows the limit; it never silently drops).
 */
export function saveCustomTheme(theme: { id?: CustomThemeId; name: string; colors: CustomThemeColors }): CustomTheme | null {
  const entries = readEntries()
  const name = theme.name.trim().slice(0, 24) || 'Custom'

  // Editing an existing theme keeps its id (and therefore its identity on every
  // other device); anything else needs a free slot.
  const existing = theme.id && entries[theme.id] && entries[theme.id].d !== 1 ? theme.id : null
  const id = existing ?? (liveThemeEntries(entries).length >= MAX_CUSTOM_THEMES ? null : newCustomId())
  if (!id) return null

  entries[id] = { n: name, c: { ...theme.colors }, t: Date.now() }
  writeEntries(entries)
  notify()
  schedulePush()
  // Re-apply so an edit to the ACTIVE theme lands immediately.
  if (getTheme() === id) applyTheme(id)
  return { id, name, colors: theme.colors }
}

/**
 * Delete a custom theme; falls back to the default when it was the active one.
 *
 * ⚠ Writes a TOMBSTONE rather than dropping the key. Drop it and the next push
 * from another device — which still holds the theme — puts it straight back.
 */
export function deleteCustomTheme(id: CustomThemeId): void {
  const entries = readEntries()
  entries[id] = { n: '', c: { bg: '', accent: '', text: '' }, t: Date.now(), d: 1 }
  writeEntries(entries)
  notify()
  schedulePush()
  if (getTheme() === id) setTheme(DEFAULT_THEME)
}

/** [background, accent] pair for the picker dot. */
export function customSwatch(theme: CustomTheme): [string, string] {
  return swatchOf(theme.colors)
}

// ── Applying ────────────────────────────────────────────────────────────────

/** Custom properties currently written inline, so they can be cleared cleanly. */
let appliedVars: string[] = []

function clearCustomVars(): void {
  const el = document.documentElement
  for (const name of appliedVars) el.style.removeProperty(name)
  appliedVars = []
  delete el.dataset.tone
  delete el.dataset.derived
}

function writeCustomVars(colors: CustomThemeColors): ThemeTone {
  const el = document.documentElement
  const { tone, vars } = deriveThemeTokens(colors)
  const names = Object.keys(vars)
  // Remove tokens from a previous custom theme that this one doesn't set.
  for (const name of appliedVars) if (!(name in vars)) el.style.removeProperty(name)
  for (const [name, value] of Object.entries(vars)) el.style.setProperty(name, value)
  appliedVars = names
  // Light custom themes need the same treatment White & Gold gets for the
  // white-on-transparent wordmark art (see index.css).
  el.dataset.tone = tone
  // "These tokens came from three colours, not from a stylesheet." The six
  // hand-tuned blocks in index.css are :not([data-derived]) so that a
  // recoloured built-in cannot inherit the original's baked-in gradients.
  el.dataset.derived = '1'
  return tone
}

export function getTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (isBuiltinThemeId(saved)) return saved
    if (isCustomThemeId(saved) && findCustomTheme(saved)) return saved
    return DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function applyTheme(id: ThemeId): void {
  const el = document.documentElement

  if (isCustomThemeId(id)) {
    const theme = findCustomTheme(id)
    if (theme) {
      el.dataset.theme = id
      writeCustomVars(theme.colors)
      return
    }
    // Deleted in another window — fall through to the default.
    id = DEFAULT_THEME
  }

  const def = themeDef(id)
  // A built-in is derived when it has no CSS block of its own, or when the user
  // has recoloured it. Inline custom properties beat every :root rule, and
  // data-derived takes the hand-tuned block out of the match.
  const colors = def.css ? getBuiltinOverride(id) : getBuiltinColors(id)
  if (colors) {
    el.dataset.theme = id
    writeCustomVars(colors)
    return
  }

  clearCustomVars()
  // Moonlight is the un-attributed default so existing CSS stays canonical
  if (id === DEFAULT_THEME) delete el.dataset.theme
  else el.dataset.theme = id
}

export function setTheme(id: ThemeId): void {
  applyTheme(id)
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* private mode etc. */ }
}

/**
 * Paint the app in `colors` WITHOUT saving anything — how the editor shows a
 * theme being built. Always pair with endPreview() (or a setTheme) so a
 * cancelled edit cannot leave the app wearing colours it never saved.
 */
export function previewCustomTheme(colors: CustomThemeColors): void {
  document.documentElement.dataset.theme = 'custom-preview'
  writeCustomVars(colors)
}

/** Drop a preview and repaint whatever is actually saved. */
export function endPreview(): void {
  applyTheme(getTheme())
}

/** Apply the saved theme and follow changes made from other windows. */
export function initTheme(): void {
  // Before the first paint: it can move the selection off a custom theme that
  // has since been promoted to a built-in, and painting twice would flash.
  absorbShipped()
  applyTheme(getTheme())
  window.addEventListener('storage', e => {
    // Any of three keys can change the picture: the active id, an edit to the
    // colours of the custom theme that is already active, or a recolour of the
    // built-in being worn. The entries key also moves when another window's sync
    // pulls a theme in, so the picker in this window is told about it too.
    if (e.key === STORAGE_KEY || e.key === ENTRIES_KEY || e.key === BUILTIN_KEY) {
      applyTheme(getTheme())
      if (e.key !== STORAGE_KEY) notify()
    }
  })
}

export { DEFAULT_CUSTOM_COLORS, THEMES }
export type { CustomThemeColors, ThemeTone }
export type { BuiltinThemeId, ThemeDef }
