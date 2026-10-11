import { THEMES } from './builtin-themes'

/** Materials are an install preference, independent of palette/profile records. */
export const TEXTURES = [
  { id: 'glass', name: 'Glass', detail: 'Translucent frosted surfaces' },
  { id: 'flat', name: 'Flat', detail: 'Clean solid surfaces' },
  { id: 'grain', name: 'Fine Grain', detail: 'Quiet flat grain' },
  { id: 'fade', name: 'Soft Fade', detail: 'Gentle tonal shading' },
] as const
export type TextureId = typeof TEXTURES[number]['id']
export const TEXTURE_KEY = 'mm.texture.v1'
export const TWO_TONE_KEY = 'mm.surfaces.two-tone.v1'
export const TEXTURE_EVENT = 'mm-texture-change'
let selected: TextureId | null = null
let twoTone: boolean | null = null

/** Layering is independent of texture; true keeps slightly raised card colours. */
export function getTwoTone(): boolean {
  if (twoTone !== null) return twoTone
  try { twoTone = localStorage.getItem(TWO_TONE_KEY) !== '0' } catch { twoTone = true }
  return twoTone
}

export function setTwoTone(value: boolean): void {
  twoTone = value
  try { localStorage.setItem(TWO_TONE_KEY, value ? '1' : '0') } catch { /* Session fallback. */ }
  applyTexture()
}

export function textureId(value: unknown): TextureId {
  return TEXTURES.some(t => t.id === value) ? value as TextureId : 'glass'
}

export function getTexture(): TextureId {
  if (selected !== null) return selected
  try { selected = textureId(localStorage.getItem(TEXTURE_KEY)) } catch { selected = 'glass' }
  return selected
}

export function textureSuspended(): boolean {
  const root = document.documentElement
  return !root.hasAttribute('data-derived') && THEMES.some(t => t.art && t.id === root.dataset.theme)
}

/** Stamp only material identity; palette variables and layout never change. */
export function applyTexture(): void {
  const root = document.documentElement
  const id = getTexture()
  root.dataset.texture = id
  const available = !textureSuspended()
  root.dataset.surfaceTone = getTwoTone() ? 'layered' : 'matching'
  root.toggleAttribute('data-surface-active', available)
  root.toggleAttribute('data-material-active', id !== 'glass' && available)
  window.dispatchEvent(new Event(TEXTURE_EVENT))
}

export function setTexture(id: TextureId): void {
  selected = textureId(id)
  try { localStorage.setItem(TEXTURE_KEY, selected) } catch { /* Keep session preference. */ }
  applyTexture()
}

export function initTexture(): void {
  window.addEventListener('storage', e => {
    if (e.key === TEXTURE_KEY || e.key === TWO_TONE_KEY || e.key === null) {
      selected = null; twoTone = null; applyTexture()
    }
  })
}
