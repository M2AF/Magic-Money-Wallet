import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Android auto-revoke settings through the REAL storage path: capacitor-store.ts
 * (the store the Android build aliases in for './chrome-store') driving the REAL
 * shared router in wallet-handlers.ts. Only the Capacitor Preferences plugin is
 * replaced, by an in-memory string store with the plugin's get/set/remove shape;
 * the platform seam and WalletConnect client are inert fakes.
 */

const h = vi.hoisted(() => ({
  prefs: new Map<string, string>(),
  failReads: false,
}))

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }: { key: string }) => {
      if (h.failReads && key === 'wallet.auto_revoke') throw new Error('Preferences read failed')
      return { value: h.prefs.has(key) ? h.prefs.get(key)! : null }
    },
    set: async ({ key, value }: { key: string; value: string }) => { h.prefs.set(key, value) },
    remove: async ({ key }: { key: string }) => { h.prefs.delete(key) },
    keys: async () => ({ keys: [...h.prefs.keys()] }),
  },
}))

// capacitor-store's own import (UI lock events) — pulls in @capacitor/app otherwise.
vi.mock('./platform-capacitor', () => ({ emitUiEvent: vi.fn() }))

// The shared router's store seam → the Android store, exactly as the vite alias does.
vi.mock('../extension/chrome-store', async () => vi.importActual('./capacitor-store'))

vi.mock('../extension/platform', () => ({
  pushToUi: vi.fn(), requestApproval: vi.fn(), pushToDapps: vi.fn(),
  pushToDappOrigin: vi.fn(), pushToDappTab: vi.fn(),
  openSidePanel: vi.fn(), closeSidePanel: vi.fn(),
  scheduleAutoRevokeWake: vi.fn(), onAutoRevokeWake: vi.fn(), wcKv: {},
}))

vi.mock('../extension/wc-ext', () => ({
  wcIsReady: () => true, onWcReady: vi.fn(),
  wcGetSessions: () => [], wcGetPendingProposals: () => [], wcGetPendingRequests: () => [],
  wcPair: vi.fn(), wcApproveSession: vi.fn(), wcRejectSession: vi.fn(),
  wcDisconnect: vi.fn(), wcApproveRequest: vi.fn(), wcRejectRequest: vi.fn(),
}))

vi.mock('../extension/midnight-send-manager', () => ({
  getMidnightDustStatus: vi.fn(), registerMidnightDustIfNeeded: vi.fn(), sendMidnightNight: vi.fn(),
}))

type Store = typeof import('./capacitor-store')
type Handlers = typeof import('../extension/wallet-handlers')
let store: Store
let handle: Handlers['handle']

const SITE = 'https://evm.example'
const ADDRESS = '0x0000000000000000000000000000000000000001'
const page = { origin: SITE, tabId: 1, kind: 'page' as const }
const ethAccounts = () => handle({ type: 'web3:request', args: [{ method: 'eth_accounts' }] }, page)
const personalSign = () => handle(
  { type: 'web3:request', args: [{ method: 'personal_sign', params: ['0x68656c6c6f', ADDRESS] }] }, page,
)

// The router statically imports the whole chain core, so the first import is slow.
beforeAll(async () => {
  store = await import('./capacitor-store')
  ;({ handle } = await import('../extension/wallet-handlers'))
}, 120_000)

beforeEach(() => {
  h.prefs.clear()
  h.failReads = false
  h.prefs.set('wallet.addresses', JSON.stringify({ evm: ADDRESS, accountIndex: 0 }))
  h.prefs.set('wallet.approved_origins', JSON.stringify([{ origin: SITE, chains: ['evm'], addedAt: 1 }]))
})

describe('Android auto-revoke settings read', () => {
  it('a missing value is Off', async () => {
    await expect(store.loadAutoRevokeState()).resolves.toBeNull()
  })

  it('a stored value is returned for the controller to normalize', async () => {
    h.prefs.set('wallet.auto_revoke', JSON.stringify({ enabled: true, durationMinutes: 5 }))
    await expect(store.loadAutoRevokeState()).resolves.toEqual({ enabled: true, durationMinutes: 5 })
  })

  it('a malformed value throws instead of reading as Off', async () => {
    h.prefs.set('wallet.auto_revoke', '{"enabled":true,"durationMinutes":1,"startedAt":17')
    await expect(store.loadAutoRevokeState()).rejects.toThrow()
  })

  it('a Preferences read error throws', async () => {
    h.failReads = true
    await expect(store.loadAutoRevokeState()).rejects.toThrow('Preferences read failed')
  })
})

describe('Android dApp requests through the shared router', () => {
  it('missing settings: the connected site can read its address', async () => {
    await expect(ethAccounts()).resolves.toEqual([ADDRESS])
  })

  it('malformed settings: address reads and signing are refused with 4100; the grant is untouched', async () => {
    h.prefs.set('wallet.auto_revoke', '{"enabled":true,"durationMinutes":1,"startedAt":17')
    await expect(ethAccounts()).rejects.toMatchObject({ code: 4100 })
    await expect(personalSign()).rejects.toMatchObject({ code: 4100 })
    expect(await store.hasOriginChain(SITE, 'evm')).toBe(true)
  })

  it('unreadable settings: requests are refused with 4100', async () => {
    h.failReads = true
    await expect(ethAccounts()).rejects.toMatchObject({ code: 4100 })
  })

  it('requests resume once the settings read again', async () => {
    h.failReads = true
    await expect(ethAccounts()).rejects.toMatchObject({ code: 4100 })
    h.failReads = false
    h.prefs.set('wallet.auto_revoke', JSON.stringify({ enabled: true, durationMinutes: 60, startedAt: Date.now(), pendingWc: null }))
    await expect(ethAccounts()).resolves.toEqual([ADDRESS])
  })
})
