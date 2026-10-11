import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('keeps a material across palettes, suspends original art, and restores it on recolour', async () => {
  const values = new Map<string, string>()
  const events = new Map<string, (event: { key: string | null }) => void>()
  const attrs = new Set<string>()
  const root = { dataset: {} as Record<string, string>,
    hasAttribute: (key: string) => attrs.has(key),
    toggleAttribute: (key: string, enabled: boolean) => enabled ? attrs.add(key) : attrs.delete(key) }
  vi.stubGlobal('document', { documentElement: root })
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v) })
  vi.stubGlobal('window', { dispatchEvent: vi.fn(), addEventListener: (key: string, cb: (event: { key: string | null }) => void) => events.set(key, cb) })
  const textures = await import('./textures')
  expect(textures.getTexture()).toBe('glass')
  textures.initTexture()
  expect(textures.getTwoTone()).toBe(true)
  textures.setTwoTone(false)
  expect(root.dataset.surfaceTone).toBe('matching')
  textures.setTexture('grain')
  for (const id of ['moonlight', 'white-gold', 'custom-my-palette']) {
    root.dataset.theme = id; textures.applyTexture()
    expect(attrs.has('data-material-active')).toBe(true)
    expect(root.dataset.texture).toBe('grain')
  }
  for (const id of ['mallard-order', 'sealuminati', 'r3tards']) {
    root.dataset.theme = id; textures.applyTexture()
    expect(attrs.has('data-material-active')).toBe(false)
    expect(attrs.has('data-surface-active')).toBe(false)
  }
  attrs.add('data-derived'); textures.applyTexture()
  expect(attrs.has('data-material-active')).toBe(true)
  values.set(textures.TEXTURE_KEY, 'fade'); events.get('storage')!({ key: textures.TEXTURE_KEY })
  expect(root.dataset.texture).toBe('fade')
  values.set(textures.TEXTURE_KEY, 'corrupted'); events.get('storage')!({ key: textures.TEXTURE_KEY })
  expect(root.dataset.texture).toBe('glass')
  expect(attrs.has('data-material-active')).toBe(false)
  expect(root.dataset.surfaceTone).toBe('matching')
  values.set(textures.TWO_TONE_KEY, '1'); events.get('storage')!({ key: textures.TWO_TONE_KEY })
  expect(root.dataset.surfaceTone).toBe('layered')
})

it('keeps a session choice when storage is unavailable', async () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } })
  vi.stubGlobal('document', { documentElement: { dataset: {}, hasAttribute: () => false, toggleAttribute: vi.fn() } })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  const textures = await import('./textures')
  textures.setTexture('fade')
  textures.setTwoTone(false)
  expect(textures.getTexture()).toBe('fade')
  expect(textures.getTwoTone()).toBe(false)
})
