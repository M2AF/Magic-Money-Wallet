// ── Theme manager ───────────────────────────────────────────────────────────
// Themes are pure CSS-token overrides (see the Themes section of index.css);
// switching is just stamping data-theme on <html>. The choice persists in
// localStorage and syncs live to every other window of the app (wallet +
// popup browser chrome share the same origin) via the `storage` event.

export type ThemeId = 'moonlight' | 'crimson' | 'grape' | 'matrix' | 'white-gold' | 'midnight'

export interface ThemeDef {
  id: ThemeId
  name: string
  /** Swatch colors for the picker: [background, accent] */
  swatch: [string, string]
}

export const THEMES: ThemeDef[] = [
  { id: 'moonlight',  name: 'Moonlight',    swatch: ['#0a0f1e', '#00aaff'] },
  { id: 'crimson',    name: 'Crimson',      swatch: ['#1e0a10', '#ff3355'] },
  { id: 'grape',      name: 'Grape',        swatch: ['#120a1e', '#a24dff'] },
  { id: 'matrix',     name: 'Matrix',       swatch: ['#000000', '#00ff41'] },
  { id: 'white-gold', name: 'White & Gold', swatch: ['#fdfbf6', '#c9a227'] },
  { id: 'midnight',   name: 'Midnight',     swatch: ['#000000', '#ffffff'] }
]

const STORAGE_KEY = 'mm.theme'
const DEFAULT_THEME: ThemeId = 'moonlight'

const isThemeId = (v: unknown): v is ThemeId => THEMES.some(t => t.id === v)

export function getTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return isThemeId(saved) ? saved : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function applyTheme(id: ThemeId): void {
  // Moonlight is the un-attributed default so existing CSS stays canonical
  if (id === DEFAULT_THEME) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = id
}

export function setTheme(id: ThemeId): void {
  applyTheme(id)
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* private mode etc. */ }
}

/** Apply the saved theme and follow changes made from other windows. */
export function initTheme(): void {
  applyTheme(getTheme())
  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY && isThemeId(e.newValue)) applyTheme(e.newValue)
  })
}
