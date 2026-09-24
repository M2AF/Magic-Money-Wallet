import { afterEach, expect, it, vi } from 'vitest'
import { getBuiltinOverride, getCustomThemes, resetBuiltinTheme, saveBuiltinTheme, syncCustomThemes } from './theme'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('pulls a ChainLens built-in recolour, then pushes wallet edits and a revert', async () => {
  vi.useFakeTimers()
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  vi.stubGlobal('document', {
    documentElement: {
      dataset: {} as Record<string, string>,
      style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    },
  })
  const remoteColors = { bg: '#123456', accent: '#33ccaa', text: '#ffffff' }
  const push = vi.fn(async (entries: unknown) => ({ entries, error: null }))
  vi.stubGlobal('window', {
    wallet: {
      customThemesGet: vi.fn(async () => ({
        'custom-builtin-crimson': { n: 'Crimson', c: remoteColors, t: 100 },
      })),
      customThemesPush: push,
    },
  })

  await syncCustomThemes()
  expect(getBuiltinOverride('crimson')).toEqual(remoteColors)
  expect(getCustomThemes()).toEqual([])

  const edited = { bg: '#223344', accent: '#44bbaa', text: '#eeeeee' }
  saveBuiltinTheme('crimson', edited)
  await vi.advanceTimersByTimeAsync(800)
  expect(push).toHaveBeenCalled()
  const editEntries = push.mock.calls.at(-1)?.[0] as Record<string, { c: typeof edited; d?: 1 }>
  expect(editEntries['custom-builtin-crimson'].c).toEqual(edited)
  expect(editEntries['custom-builtin-crimson'].d).toBeUndefined()

  resetBuiltinTheme('crimson')
  await vi.advanceTimersByTimeAsync(800)
  const revertEntries = push.mock.calls.at(-1)?.[0] as Record<string, { d?: 1 }>
  expect(revertEntries['custom-builtin-crimson'].d).toBe(1)
  expect(getBuiltinOverride('crimson')).toBeNull()
})

it('uploads a built-in recolour saved by an older wallet', async () => {
  vi.useFakeTimers()
  const colors = { bg: '#123456', accent: '#33ccaa', text: '#ffffff' }
  const values = new Map<string, string>([
    ['mm.themes.builtin.v1', JSON.stringify({ crimson: colors })],
  ])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  })
  const push = vi.fn(async (entries: unknown) => ({ entries, error: null }))
  vi.stubGlobal('window', {
    wallet: { customThemesGet: vi.fn(async () => ({})), customThemesPush: push },
  })

  await syncCustomThemes()
  await vi.advanceTimersByTimeAsync(800)
  const entries = push.mock.calls[0]?.[0] as Record<string, { c: typeof colors; t: number }>
  expect(entries['custom-builtin-crimson']).toEqual({ n: 'Crimson', c: colors, t: 0 })
})
