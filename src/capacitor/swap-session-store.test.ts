import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  prefs: new Map<string, string>(), local: {} as Record<string, unknown>,
  failRead: false, failWrite: false,
}))
vi.mock('../main/wallet-core', () => ({ normalizeMnemonic: (v: string) => v }))
vi.mock('../capacitor/platform-capacitor', () => ({ emitUiEvent: vi.fn() }))
vi.mock('@capacitor/preferences', () => ({ Preferences: {
  get: async ({ key }: { key: string }) => {
    if (h.failRead) throw new Error('read failed')
    return { value: h.prefs.get(key) ?? null }
  },
  set: async ({ key, value }: { key: string; value: string }) => {
    if (h.failWrite) throw new Error('write failed')
    h.prefs.set(key, value)
  },
} }))
import * as extension from '../extension/chrome-store'
import * as native from '../capacitor/capacitor-store'

beforeEach(() => {
  h.prefs.clear(); h.local = {}; h.failRead = false; h.failWrite = false
  vi.stubGlobal('chrome', { storage: { local: {
    get: async () => {
      if (h.failRead) throw new Error('read failed')
      return structuredClone(h.local)
    },
    set: async (values: Record<string, unknown>) => {
      if (h.failWrite) throw new Error('write failed')
      Object.assign(h.local, structuredClone(values))
    },
  } } })
})
afterEach(() => vi.unstubAllGlobals())

for (const [name, store] of [['extension', extension], ['Android/iOS Preferences', native]] as const) {
  describe(`${name} swap recovery adapter`, () => {
    it('reads an absent store as empty and round-trips nested evidence with exact raw amounts', async () => {
      expect(await store.loadSwapSessions()).toEqual({})
      const map = { order: { sourceTxHash: 'ab'.repeat(32), sellAmountRaw: '9007199254740993000' } }
      await store.saveSwapSessions(map)
      expect(await store.loadSwapSessions()).toEqual(map)
    })
    it('propagates read and write failures to the pre-submit gate', async () => {
      h.failRead = true
      await expect(store.loadSwapSessions()).rejects.toThrow('read failed')
      h.failRead = false; h.failWrite = true
      await expect(store.saveSwapSessions({})).rejects.toThrow('write failed')
    })
    it('refuses malformed stored roots instead of erasing evidence', async () => {
      for (const bad of [null, [], 'torn', 42]) {
        h.local['wallet.swap_sessions'] = bad
        h.prefs.set('wallet.swap_sessions', JSON.stringify(bad))
        await expect(store.loadSwapSessions()).rejects.toThrow()
      }
      if (name !== 'extension') {
        h.prefs.set('wallet.swap_sessions', '{"order":')
        await expect(store.loadSwapSessions()).rejects.toThrow()
      }
    })
  })
}
