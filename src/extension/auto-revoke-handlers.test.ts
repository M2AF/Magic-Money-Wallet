import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as policy from '../main/auto-revoke'
import * as ui from '../renderer/lib/auto-revoke-ui'

/**
 * Auto-revoke through the REAL shared router (wallet-handlers.ts — the extension
 * service worker, Android and iOS all run it). Storage, the platform seam and the
 * WalletConnect client are in-memory fakes; the grant logic is the real
 * dapp-permissions module, so this exercises the actual approval and gate paths.
 */

const h = vi.hoisted(() => ({
  kv: new Map<string, unknown>(),
  sessions: new Map<string, { topic: string }>(),
  pendingRequests: [] as Array<{ id: number; topic: string }>,
  disconnect: null as unknown as ReturnType<typeof import('vitest')['vi']['fn']>,
  approveRequest: null as unknown as ReturnType<typeof import('vitest')['vi']['fn']>,
  // Key access — signing only ever starts by loading the mnemonic.
  loadMnemonic: null as unknown as ReturnType<typeof import('vitest')['vi']['fn']>,
  pushToDappOrigin: null as unknown as ReturnType<typeof import('vitest')['vi']['fn']>,
  pushToUi: null as unknown as ReturnType<typeof import('vitest')['vi']['fn']>,
  requestApproval: null as unknown as ReturnType<typeof import('vitest')['vi']['fn']>,
}))

vi.mock('./chrome-store', async () => {
  const perms = await vi.importActual<typeof import('../main/dapp-permissions')>('../main/dapp-permissions')
  const records = () => perms.normalizeApprovedOrigins(h.kv.get('origins'))
  return {
    getCurrentChain: async () => null,
    setCurrentChain: async () => {},
    loadSwapSessions: async () => null,
    saveSwapSessions: async () => {},
    loadAddresses: async () => ({ evm: '0x0000000000000000000000000000000000000001', accountIndex: 0 }),
    loadMnemonic: (h.loadMnemonic = vi.fn(async () => 'test test test test test test test test test test test junk')),
    loadConfig: async () => ({}),
    getApprovedOriginRecords: async () => records(),
    getApprovedOrigins: async () => perms.originList(records()),
    hasOriginChain: async (o: string, c: import('../main/dapp-permissions').DappChain) => perms.hasChainGrant(records(), o, c),
    addApprovedOrigin: async (o: string, c: import('../main/dapp-permissions').DappChain) => { h.kv.set('origins', perms.grantChain(records(), o, c)) },
    removeApprovedOrigin: async (o: string, c?: import('../main/dapp-permissions').DappChain) => { h.kv.set('origins', perms.revokeChain(records(), o, c)) },
    clearApprovedOrigins: async () => { h.kv.set('origins', []) },
    loadAutoRevokeState: async () => h.kv.get('auto_revoke'),
    saveAutoRevokeState: async (s: unknown) => { h.kv.set('auto_revoke', JSON.parse(JSON.stringify(s))) },
  }
})

vi.mock('./platform', () => {
  h.pushToDappOrigin = vi.fn()
  h.pushToUi = vi.fn()
  h.requestApproval = vi.fn()
  return {
    pushToUi: h.pushToUi,
    requestApproval: h.requestApproval,
    pushToDapps: vi.fn(),
    pushToDappOrigin: h.pushToDappOrigin,
    pushToDappTab: vi.fn(),
    openSidePanel: vi.fn(),
    closeSidePanel: vi.fn(),
    scheduleAutoRevokeWake: vi.fn(),
    onAutoRevokeWake: vi.fn(),
    wcKv: {},
  }
})

vi.mock('./wc-ext', () => {
  h.disconnect = vi.fn(async (topic: string) => { h.sessions.delete(topic) })
  h.approveRequest = vi.fn(async () => {})
  return {
    wcIsReady: () => true,
    onWcReady: vi.fn(),
    wcGetSessions: () => [...h.sessions.values()],
    wcGetPendingProposals: () => [],
    wcGetPendingRequests: () => h.pendingRequests,
    wcPair: vi.fn(),
    wcApproveSession: vi.fn(async () => { h.sessions.set('wc-new', { topic: 'wc-new' }); return { topic: 'wc-new' } }),
    wcRejectSession: vi.fn(),
    wcDisconnect: h.disconnect,
    wcApproveRequest: h.approveRequest,
    wcRejectRequest: vi.fn(),
  }
})

// Offscreen-document proxy (touches chrome.* at call time only, but keep it inert).
vi.mock('./midnight-send-manager', () => ({
  getMidnightDustStatus: vi.fn(), registerMidnightDustIfNeeded: vi.fn(), sendMidnightNight: vi.fn(),
}))

type HandlersModule = typeof import('./wallet-handlers')
let handle: HandlersModule['handle']

const UI = { origin: 'chrome-extension://test', kind: 'extension' as const }
const page = (origin: string) => ({ origin, tabId: 7, kind: 'page' as const })
const T0 = Date.UTC(2026, 8, 26, 12, 0, 0)

/** Drive a real connection: the page asks, the wallet UI approves. */
async function connect(origin: string, type: string, args: unknown[] = []): Promise<void> {
  const request = handle({ type, args }, page(origin))
  let pending: Array<{ id: string; origin: string }> = []
  await vi.waitFor(async () => {
    pending = await handle({ type: 'web3:get-pending-connections', args: [] }, UI)
    expect(pending.some(p => p.origin === origin)).toBe(true)
  })
  await handle({ type: 'web3:approve-connection', args: [{ id: pending.find(p => p.origin === origin)!.id }] }, UI)
  await request
}

// The router statically imports the whole chain core, so the first import is slow.
beforeAll(async () => {
  vi.useFakeTimers({ now: T0, toFake: ['Date'] })
  ;({ handle } = await import('./wallet-handlers'))
}, 120_000)

afterAll(() => { vi.useRealTimers() })

beforeEach(() => {
  vi.setSystemTime(T0)
  h.kv.clear()
  h.sessions.clear()
  h.pendingRequests.length = 0
  h.disconnect.mockClear()
  h.pushToDappOrigin.mockClear()
  h.approveRequest.mockClear()
  h.loadMnemonic.mockClear()
})

describe('renderer/backend contract', () => {
  it('the Settings control spans exactly the range the backend accepts', () => {
    expect(ui.AUTO_REVOKE_MIN_MINUTES).toBe(policy.AUTO_REVOKE_MIN_MINUTES)
    expect(ui.AUTO_REVOKE_MAX_MINUTES).toBe(policy.AUTO_REVOKE_MAX_MINUTES)
  })
})

describe('auto-revoke through the shared wallet router', () => {
  it('is Off by default and connections are unaffected', async () => {
    expect(await handle({ type: 'wallet:get-auto-revoke', args: [] }, UI))
      .toEqual({ enabled: false, durationMinutes: 15, deadlineAt: null, wcTeardownPending: false })
    await connect('https://evm.example', 'web3:request', [{ method: 'eth_requestAccounts' }])
    vi.setSystemTime(T0 + 24 * 3_600_000)
    expect(await handle({ type: 'web3:request', args: [{ method: 'eth_accounts' }] }, page('https://evm.example')))
      .toEqual(['0x0000000000000000000000000000000000000001'])
  })

  it('expiry revokes grants on two chains plus every WC session, and no request is authorised afterwards', async () => {
    await handle({ type: 'wallet:set-auto-revoke', args: [{ enabled: true, durationMinutes: 2 }] }, UI)
    await connect('https://evm.example', 'web3:request', [{ method: 'eth_requestAccounts' }])
    const first = (await handle({ type: 'wallet:get-auto-revoke', args: [] }, UI)).deadlineAt as number
    // (vi.waitFor nudges the fake clock a few ms while polling for the prompt.)
    expect(first - 2 * 60_000).toBeGreaterThanOrEqual(T0)
    expect(first - 2 * 60_000).toBeLessThan(T0 + 1_000)
    vi.setSystemTime(T0 + 30_000)
    await connect('https://cardano.example', 'cardano:enable')
    h.sessions.set('wc-a', { topic: 'wc-a' })

    const armed = await handle({ type: 'wallet:get-auto-revoke', args: [] }, UI)
    expect(armed.deadlineAt).toBe(first)   // shared deadline, not extended

    // Deadline passes with no wake-up (suspended worker). The very next dApp
    // request enforces it before being served.
    vi.setSystemTime(first + 1)
    expect(await handle({ type: 'web3:request', args: [{ method: 'eth_accounts' }] }, page('https://evm.example'))).toEqual([])
    await expect(handle({ type: 'cardano:get-utxos', args: [] }, page('https://cardano.example'))).rejects.toMatchObject({ code: 4100 })

    expect(await handle({ type: 'wallet:get-connected-sites', args: [] }, UI)).toEqual([])
    expect(h.disconnect).toHaveBeenCalledWith('wc-a')
    expect(h.sessions.size).toBe(0)
    expect(h.pushToDappOrigin).toHaveBeenCalledWith('https://evm.example', 'accountsChanged', [])
    expect(h.pushToDappOrigin).toHaveBeenCalledWith('https://cardano.example', 'accountsChanged', [])
    expect(await handle({ type: 'wallet:get-auto-revoke', args: [] }, UI))
      .toEqual({ enabled: true, durationMinutes: 2, deadlineAt: null, wcTeardownPending: false })

    // The next connection starts a fresh countdown.
    vi.setSystemTime(T0 + 10 * 60_000)
    await connect('https://evm.example', 'web3:request', [{ method: 'eth_requestAccounts' }])
    const next = (await handle({ type: 'wallet:get-auto-revoke', args: [] }, UI)).deadlineAt as number
    expect(next - 2 * 60_000).toBeGreaterThanOrEqual(T0 + 10 * 60_000)
    expect(next - 2 * 60_000).toBeLessThan(T0 + 10 * 60_000 + 1_000)
  })

  it('a WC session approval starts the countdown', async () => {
    await handle({ type: 'wallet:set-auto-revoke', args: [{ enabled: true, durationMinutes: 5 }] }, UI)
    await handle({ type: 'wc:approve-session', args: [1] }, UI)
    expect((await handle({ type: 'wallet:get-auto-revoke', args: [] }, UI)).deadlineAt).toBe(T0 + 5 * 60_000)
  })

  it('refuses to sign for a WC session whose teardown is still owed', async () => {
    await handle({ type: 'wallet:set-auto-revoke', args: [{ enabled: true, durationMinutes: 1 }] }, UI)
    await handle({ type: 'wc:approve-session', args: [1] }, UI)
    h.disconnect.mockImplementationOnce(async () => { throw new Error('relay down') })
    h.pendingRequests.push({ id: 42, topic: 'wc-new' })
    vi.setSystemTime(T0 + 61_000)
    await expect(handle({ type: 'wc:approve-request', args: [42] }, UI)).rejects.toThrow(/auto-revoke/)
    expect(h.approveRequest).not.toHaveBeenCalled()
  })

  it('Off before expiry leaves every connection intact', async () => {
    await handle({ type: 'wallet:set-auto-revoke', args: [{ enabled: true, durationMinutes: 1 }] }, UI)
    await connect('https://evm.example', 'web3:request', [{ method: 'eth_requestAccounts' }])
    h.sessions.set('wc-a', { topic: 'wc-a' })
    await handle({ type: 'wallet:set-auto-revoke', args: [{ enabled: false }] }, UI)
    vi.setSystemTime(T0 + 10 * 60_000)
    expect(await handle({ type: 'web3:request', args: [{ method: 'eth_accounts' }] }, page('https://evm.example'))).toHaveLength(1)
    expect(h.sessions.has('wc-a')).toBe(true)
  })

  it('validates settings in the backend and is not reachable from web pages', async () => {
    await expect(handle({ type: 'wallet:set-auto-revoke', args: [{ enabled: 'yes' }] }, UI)).rejects.toThrow()
    expect(await handle({ type: 'wallet:set-auto-revoke', args: [{ enabled: true, durationMinutes: 999 }] }, UI))
      .toMatchObject({ enabled: true, durationMinutes: 60 })
    await expect(handle({ type: 'wallet:set-auto-revoke', args: [{ enabled: false }] }, page('https://evil.example')))
      .rejects.toMatchObject({ code: 4100 })
  })
})

describe('prompts left open across the deadline fail closed', () => {
  const ORIGIN = 'https://evm.example'
  const personalSign = () => handle(
    { type: 'web3:request', args: [{ method: 'personal_sign', params: ['0x68656c6c6f', '0x0000000000000000000000000000000000000001'] }] },
    page(ORIGIN),
  )

  async function pendingId(type: 'web3:get-pending-sign' | 'web3:get-pending-tx'): Promise<string> {
    let id = ''
    await vi.waitFor(async () => {
      const list: Array<{ id: string; origin: string }> = await handle({ type, args: [] }, UI)
      expect(list.some(p => p.origin === ORIGIN)).toBe(true)
      id = list.find(p => p.origin === ORIGIN)!.id
    })
    return id
  }

  beforeEach(async () => {
    await handle({ type: 'wallet:set-auto-revoke', args: [{ enabled: true, durationMinutes: 1 }] }, UI)
    await connect(ORIGIN, 'web3:request', [{ method: 'eth_requestAccounts' }])
  })

  it('a signature prompt approved after the deadline is refused before the key is touched', async () => {
    const request = personalSign()
    request.catch(() => {})   // asserted below
    const id = await pendingId('web3:get-pending-sign')

    // The deadline passes while the prompt is open; no wake-up has fired.
    vi.setSystemTime(T0 + 5 * 60_000)
    await handle({ type: 'web3:approve-sign', args: [id] }, UI)

    await expect(request).rejects.toMatchObject({ code: 4100, message: expect.stringMatching(/disconnected/) })
    expect(h.loadMnemonic).not.toHaveBeenCalled()
    expect(await handle({ type: 'wallet:get-connected-sites', args: [] }, UI)).toEqual([])
  })

  it('a transaction prompt approved after the deadline is refused before signing or broadcasting', async () => {
    const request = handle(
      { type: 'web3:request', args: [{ method: 'eth_sendTransaction', params: [{ to: '0x0000000000000000000000000000000000000002', value: '0x1' }] }] },
      page(ORIGIN),
    )
    request.catch(() => {})
    const id = await pendingId('web3:get-pending-tx')

    vi.setSystemTime(T0 + 5 * 60_000)
    await expect(handle({ type: 'web3:approve-tx', args: [{ id }] }, UI)).rejects.toMatchObject({ code: 4100 })
    await expect(request).rejects.toMatchObject({ code: 4100 })
    expect(h.loadMnemonic).not.toHaveBeenCalled()
  })

  it('a prompt approved before the deadline still signs (the re-check does not over-block)', async () => {
    const request = personalSign()
    const id = await pendingId('web3:get-pending-sign')
    await handle({ type: 'web3:approve-sign', args: [id] }, UI)
    await expect(request).resolves.toMatch(/^0x[0-9a-f]{130}$/)
    expect(h.loadMnemonic).toHaveBeenCalled()
  })
})
