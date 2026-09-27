import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AUTO_REVOKE_DEFAULT_MINUTES,
  AUTO_REVOKE_RETRY_MS,
  WC_DISCONNECT_TIMEOUT_MS,
  applySettings,
  armCountdown,
  clampDurationMinutes,
  createAutoRevoke,
  deadlineOf,
  isOverdue,
  normalizeAutoRevokeState,
  parseAutoRevokePatch,
  type AutoRevokeState,
} from './auto-revoke'

const MIN = 60_000
const T0 = 1_700_000_000_000

/** An in-memory host: storage, origin grants, a WalletConnect client, a clock. */
function harness(initial?: unknown) {
  let stored: unknown = initial === undefined ? undefined : JSON.parse(JSON.stringify(initial))
  const clock = { t: T0 }
  const origins = new Set<string>()
  const topics = new Set<string>()
  const wc = { ready: true }
  let disconnectImpl = async (topic: string) => { topics.delete(topic) }
  const deps = {
    now: () => clock.t,
    load: () => stored,
    save: vi.fn((s: AutoRevokeState) => { stored = JSON.parse(JSON.stringify(s)) }),
    revokeAllOrigins: vi.fn(() => { origins.clear() }),
    hasOriginGrants: () => origins.size > 0,
    wc: {
      ready: () => wc.ready,
      topics: () => [...topics],
      disconnect: vi.fn((topic: string) => disconnectImpl(topic)),
    },
    schedule: vi.fn(),
    notify: vi.fn(),
    log: () => {},
  }
  return {
    deps,
    clock,
    origins,
    topics,
    wc,
    stored: () => normalizeAutoRevokeState(stored),
    setDisconnect: (fn: (topic: string) => Promise<void>) => { disconnectImpl = fn },
    ctl: createAutoRevoke(deps),
    /** A fresh controller over the same storage — an app restart / SW wake. */
    restart: () => createAutoRevoke(deps),
  }
}

afterEach(() => { vi.useRealTimers() })

// ── Pure policy ──────────────────────────────────────────────────────────────

describe('policy', () => {
  it('reads a cold or corrupt store as Off with the default duration', () => {
    for (const raw of [undefined, null, 'x', 42, [], { enabled: 'yes', durationMinutes: 'ten' }]) {
      const s = normalizeAutoRevokeState(raw)
      expect(s.enabled).toBe(false)
      expect(s.durationMinutes).toBe(AUTO_REVOKE_DEFAULT_MINUTES)
      expect(s.startedAt).toBeNull()
      expect(s.pendingWc).toBeNull()
    }
  })

  it('drops a countdown recorded while Off', () => {
    expect(normalizeAutoRevokeState({ enabled: false, durationMinutes: 5, startedAt: T0 }).startedAt).toBeNull()
  })

  it('clamps duration to an integer 1–60', () => {
    expect(clampDurationMinutes(0)).toBe(1)
    expect(clampDurationMinutes(-5)).toBe(1)
    expect(clampDurationMinutes(61)).toBe(60)
    expect(clampDurationMinutes(7.6)).toBe(8)
    expect(clampDurationMinutes(NaN)).toBe(AUTO_REVOKE_DEFAULT_MINUTES)
    expect(clampDurationMinutes('5')).toBe(AUTO_REVOKE_DEFAULT_MINUTES)
  })

  it('validates patches strictly rather than coercing', () => {
    expect(parseAutoRevokePatch({ enabled: true })).toEqual({ enabled: true })
    expect(parseAutoRevokePatch({ durationMinutes: 90 })).toEqual({ durationMinutes: 60 })
    expect(() => parseAutoRevokePatch({ enabled: 'true' })).toThrow()
    expect(() => parseAutoRevokePatch({ enabled: 1 })).toThrow()
    expect(() => parseAutoRevokePatch({ durationMinutes: '5' })).toThrow()
    expect(() => parseAutoRevokePatch({ durationMinutes: Infinity })).toThrow()
    expect(() => parseAutoRevokePatch(null)).toThrow()
  })

  it('computes the deadline from the start, and only while On', () => {
    const s: AutoRevokeState = { enabled: true, durationMinutes: 10, startedAt: T0, pendingWc: null }
    expect(deadlineOf(s)).toBe(T0 + 10 * MIN)
    expect(isOverdue(s, T0 + 10 * MIN - 1)).toBe(false)
    expect(isOverdue(s, T0 + 10 * MIN)).toBe(true)
    expect(deadlineOf({ ...s, enabled: false })).toBeNull()
  })

  it('arms only when On and idle — later connections never extend it', () => {
    const off: AutoRevokeState = { enabled: false, durationMinutes: 10, startedAt: null, pendingWc: null }
    expect(armCountdown(off, T0)).toBe(off)
    const armed = armCountdown({ ...off, enabled: true }, T0)
    expect(armed.startedAt).toBe(T0)
    expect(armCountdown(armed, T0 + 5 * MIN)).toBe(armed)
  })

  it('enabling starts fresh only when something is connected; Off cancels', () => {
    const off: AutoRevokeState = { enabled: false, durationMinutes: 10, startedAt: null, pendingWc: null }
    expect(applySettings(off, { enabled: true }, T0, true).startedAt).toBe(T0)
    expect(applySettings(off, { enabled: true }, T0, false).startedAt).toBeNull()
    const running = { ...off, enabled: true, startedAt: T0 }
    // Re-sending enabled:true must not restart a running countdown.
    expect(applySettings(running, { enabled: true }, T0 + MIN, true).startedAt).toBe(T0)
    expect(applySettings(running, { enabled: false }, T0 + MIN, true)).toMatchObject({ enabled: false, startedAt: null })
    // A duration edit keeps the original start.
    expect(applySettings(running, { durationMinutes: 3 }, T0 + MIN, true)).toMatchObject({ startedAt: T0, durationMinutes: 3 })
  })
})

// ── Controller ───────────────────────────────────────────────────────────────

describe('controller', () => {
  it('defaults Off: connections start no countdown and nothing is ever revoked', async () => {
    const h = harness()
    expect(await h.ctl.getSettings()).toEqual({ enabled: false, durationMinutes: 15, deadlineAt: null, wcTeardownPending: false })
    await h.ctl.recordConnection(() => { h.origins.add('https://a.example') })
    h.clock.t += 24 * 60 * MIN
    await h.ctl.reconcile()
    expect(h.origins.size).toBe(1)
    expect(h.deps.revokeAllOrigins).not.toHaveBeenCalled()
  })

  it('one global countdown from the first connection; later connections share its deadline', async () => {
    const h = harness({ enabled: true, durationMinutes: 10 })
    await h.ctl.recordConnection(() => { h.origins.add('https://a.example') })
    expect((await h.ctl.getSettings()).deadlineAt).toBe(T0 + 10 * MIN)
    h.clock.t += 6 * MIN
    await h.ctl.recordConnection(() => { h.topics.add('wc-topic-1') })
    expect((await h.ctl.getSettings()).deadlineAt).toBe(T0 + 10 * MIN)
    expect(h.deps.schedule).toHaveBeenLastCalledWith(T0 + 10 * MIN)
  })

  it('expiry revokes every origin and every WalletConnect session, then waits for the next connection', async () => {
    const h = harness({ enabled: true, durationMinutes: 5 })
    await h.ctl.recordConnection(() => { h.origins.add('https://evm.example') })
    await h.ctl.recordConnection(() => { h.origins.add('https://cardano.example') })
    h.topics.add('wc-a'); h.topics.add('wc-b')

    h.clock.t = T0 + 5 * MIN
    const after = await h.ctl.reconcile()
    expect(h.origins.size).toBe(0)
    expect(h.topics.size).toBe(0)
    expect(h.deps.wc.disconnect).toHaveBeenCalledTimes(2)
    expect(after).toEqual({ enabled: true, durationMinutes: 5, deadlineAt: null, wcTeardownPending: false })
    expect(h.deps.notify).toHaveBeenLastCalledWith(after)
    expect(h.deps.schedule).toHaveBeenLastCalledWith(null)

    // Still On: the next connection starts a NEW countdown from its own time.
    h.clock.t += 2 * MIN
    await h.ctl.recordConnection(() => { h.origins.add('https://c.example') })
    expect((await h.ctl.getSettings()).deadlineAt).toBe(h.clock.t + 5 * MIN)
  })

  it('turning Off before expiry cancels the deadline and leaves connections intact', async () => {
    const h = harness({ enabled: true, durationMinutes: 5 })
    await h.ctl.recordConnection(() => { h.origins.add('https://a.example') })
    h.topics.add('wc-a')
    const off = await h.ctl.setSettings({ enabled: false })
    expect(off.deadlineAt).toBeNull()
    h.clock.t += 60 * MIN
    await h.ctl.reconcile()
    expect(h.origins.size).toBe(1)
    expect(h.topics.size).toBe(1)
    expect(h.deps.schedule).toHaveBeenLastCalledWith(null)
  })

  it('enabling with existing connections starts a fresh countdown; without any, none', async () => {
    const h = harness()
    h.origins.add('https://a.example')
    expect((await h.ctl.setSettings({ enabled: true, durationMinutes: 3 })).deadlineAt).toBe(T0 + 3 * MIN)

    const idle = harness()
    expect((await idle.ctl.setSettings({ enabled: true })).deadlineAt).toBeNull()
  })

  it('a duration edit recalculates from the original start and expires at once if overdue', async () => {
    const h = harness({ enabled: true, durationMinutes: 30 })
    await h.ctl.recordConnection(() => { h.origins.add('https://a.example') })
    h.clock.t = T0 + 10 * MIN
    expect((await h.ctl.setSettings({ durationMinutes: 20 })).deadlineAt).toBe(T0 + 20 * MIN)
    expect(h.origins.size).toBe(1)

    const s = await h.ctl.setSettings({ durationMinutes: 5 })
    expect(h.origins.size).toBe(0)
    expect(s).toMatchObject({ enabled: true, durationMinutes: 5, deadlineAt: null })
  })

  it('persists: a restarted host (or woken service worker) enforces a deadline that passed meanwhile', async () => {
    const h = harness({ enabled: true, durationMinutes: 5 })
    await h.ctl.recordConnection(() => { h.origins.add('https://a.example') })
    h.topics.add('wc-a')
    h.clock.t = T0 + 45 * MIN   // suspended well past the deadline
    const fresh = h.restart()
    expect(fresh.overdue()).toBe(false)   // nothing read yet
    await fresh.reconcile()
    expect(h.origins.size).toBe(0)
    expect(h.topics.size).toBe(0)
    expect(h.stored().startedAt).toBeNull()
  })

  it('overdue() lets a synchronous gate fail closed before the revoke has run', async () => {
    const h = harness({ enabled: true, durationMinutes: 1 })
    await h.ctl.recordConnection(() => { h.origins.add('https://a.example') })
    expect(h.ctl.overdue()).toBe(false)
    h.clock.t = T0 + MIN
    expect(h.ctl.overdue()).toBe(true)
    await h.ctl.reconcile()
    expect(h.ctl.overdue()).toBe(false)
  })

  it('duplicate expiry callbacks (timer + alarm + resume at once) revoke once', async () => {
    const h = harness({ enabled: true, durationMinutes: 1 })
    await h.ctl.recordConnection(() => { h.origins.add('https://a.example') })
    h.topics.add('wc-a')
    h.clock.t = T0 + 2 * MIN
    await Promise.all([h.ctl.reconcile(), h.ctl.reconcile(), h.ctl.getSettings()])
    await h.ctl.reconcile()
    expect(h.deps.revokeAllOrigins).toHaveBeenCalledTimes(1)
    expect(h.deps.wc.disconnect).toHaveBeenCalledTimes(1)
  })

  it('a grant racing an expiry is neither erased nor left on the old deadline', async () => {
    const h = harness({ enabled: true, durationMinutes: 1 })
    await h.ctl.recordConnection(() => { h.origins.add('https://old.example') })
    h.topics.add('wc-slow')
    let release!: () => void
    h.setDisconnect(topic => new Promise<void>(resolve => { release = () => { h.topics.delete(topic); resolve() } }))

    h.clock.t = T0 + MIN
    const expiry = h.ctl.reconcile()          // stalls on the WC disconnect
    const grant = h.ctl.recordConnection(() => { h.origins.add('https://new.example') })
    await vi.waitFor(() => expect(h.deps.wc.disconnect).toHaveBeenCalled())
    expect(h.origins.has('https://new.example')).toBe(false)   // queued behind expiry
    release()
    await expiry
    await grant

    expect([...h.origins]).toEqual(['https://new.example'])
    expect((await h.ctl.getSettings()).deadlineAt).toBe(T0 + 2 * MIN)
  })

  it('a grant made after the deadline is enforced first, then starts its own countdown', async () => {
    const h = harness({ enabled: true, durationMinutes: 1 })
    await h.ctl.recordConnection(() => { h.origins.add('https://old.example') })
    h.clock.t = T0 + 3 * MIN   // no wake-up fired (frozen WebView)
    await h.ctl.recordConnection(() => { h.origins.add('https://new.example') })
    expect([...h.origins]).toEqual(['https://new.example'])
    expect((await h.ctl.getSettings()).deadlineAt).toBe(T0 + 4 * MIN)
  })

  it('WalletConnect relay errors leave the topic owed, blocked, and retried', async () => {
    const h = harness({ enabled: true, durationMinutes: 1 })
    await h.ctl.recordConnection(() => { h.topics.add('wc-a') })
    h.setDisconnect(async () => { throw new Error('relay unreachable') })
    h.clock.t = T0 + MIN
    const s = await h.ctl.reconcile()
    expect(s.wcTeardownPending).toBe(true)
    expect(s.deadlineAt).toBeNull()
    expect(h.ctl.isWcTopicBlocked('wc-a')).toBe(true)
    expect(h.ctl.isWcTopicBlocked('wc-other')).toBe(false)
    expect(h.deps.schedule).toHaveBeenLastCalledWith(h.clock.t + AUTO_REVOKE_RETRY_MS)

    // A new session approved meanwhile is NOT owed and not torn down.
    await h.ctl.recordConnection(() => { h.topics.add('wc-new') })

    // dApp requests before the back-off elapses don't re-hit the dead relay.
    const calls = h.deps.wc.disconnect.mock.calls.length
    h.clock.t += AUTO_REVOKE_RETRY_MS / 2
    await h.ctl.reconcile()
    await h.ctl.reconcile()
    expect(h.deps.wc.disconnect.mock.calls.length).toBe(calls)
    expect(h.ctl.isWcTopicBlocked('wc-a')).toBe(true)

    h.setDisconnect(async topic => { h.topics.delete(topic) })
    h.clock.t += AUTO_REVOKE_RETRY_MS
    const done = await h.ctl.reconcile()
    expect(done.wcTeardownPending).toBe(false)
    expect([...h.topics]).toEqual(['wc-new'])
    expect(h.ctl.isWcTopicBlocked('wc-a')).toBe(false)
  })

  it('a WalletConnect disconnect that hangs times out instead of stalling every request', async () => {
    vi.useFakeTimers({ now: T0 })
    const h = harness({ enabled: true, durationMinutes: 1 })
    await h.ctl.recordConnection(() => { h.topics.add('wc-hang') })
    h.setDisconnect(() => new Promise<void>(() => { /* never settles */ }))
    h.clock.t = T0 + MIN
    const pending = h.ctl.reconcile()
    await vi.advanceTimersByTimeAsync(WC_DISCONNECT_TIMEOUT_MS)
    expect((await pending).wcTeardownPending).toBe(true)
    expect(h.ctl.isWcTopicBlocked('wc-hang')).toBe(true)
  })

  it('WalletConnect not yet started at expiry: every session it restores is owed', async () => {
    const h = harness({ enabled: true, durationMinutes: 1 })
    await h.ctl.recordConnection(() => { h.origins.add('https://a.example') })
    h.wc.ready = false
    h.clock.t = T0 + MIN
    const s = await h.ctl.reconcile()
    expect(h.origins.size).toBe(0)
    expect(s.wcTeardownPending).toBe(true)
    expect(h.ctl.isWcTopicBlocked('anything')).toBe(true)

    // Client comes up with its persisted sessions → the ready hook reconciles.
    h.topics.add('restored-1'); h.topics.add('restored-2')
    h.wc.ready = true
    const drained = await h.ctl.reconcile()
    expect(drained.wcTeardownPending).toBe(false)
    expect(h.topics.size).toBe(0)
  })

  it('fails closed when origins cannot be revoked: the deadline stays overdue and grants are refused', async () => {
    const h = harness({ enabled: true, durationMinutes: 1 })
    await h.ctl.recordConnection(() => { h.origins.add('https://a.example') })
    h.deps.revokeAllOrigins.mockImplementationOnce(() => { throw new Error('disk full') })
    h.clock.t = T0 + MIN
    await expect(h.ctl.reconcile()).rejects.toThrow('disk full')
    expect(h.ctl.overdue()).toBe(true)
    expect(h.deps.schedule).toHaveBeenLastCalledWith(h.clock.t + AUTO_REVOKE_RETRY_MS)

    const grant = vi.fn()
    h.deps.revokeAllOrigins.mockImplementationOnce(() => { throw new Error('disk full') })
    await expect(h.ctl.recordConnection(grant)).rejects.toThrow('disk full')
    expect(grant).not.toHaveBeenCalled()

    await h.ctl.reconcile()   // storage recovered
    expect(h.origins.size).toBe(0)
    expect(h.ctl.overdue()).toBe(false)
  })

  it('manual revocation while a timer runs stops it only once nothing is connected', async () => {
    const h = harness({ enabled: true, durationMinutes: 10 })
    await h.ctl.recordConnection(() => { h.origins.add('https://a.example') })
    h.topics.add('wc-a')

    h.origins.clear()                       // Connected Sites → Disconnect All
    await h.ctl.releaseIfIdle()
    expect((await h.ctl.getSettings()).deadlineAt).toBe(T0 + 10 * MIN)   // WC still live

    h.topics.clear()                        // WalletConnect page → Disconnect
    await h.ctl.releaseIfIdle()
    expect((await h.ctl.getSettings()).deadlineAt).toBeNull()

    h.clock.t += 5 * MIN
    await h.ctl.recordConnection(() => { h.origins.add('https://b.example') })
    expect((await h.ctl.getSettings()).deadlineAt).toBe(h.clock.t + 10 * MIN)
  })

  it('rejects an invalid settings change without touching storage', async () => {
    const h = harness({ enabled: true, durationMinutes: 10 })
    expect(() => h.ctl.setSettings({ enabled: 'false' })).toThrow()
    expect(h.deps.save).not.toHaveBeenCalled()
    expect(h.stored()).toMatchObject({ enabled: true, durationMinutes: 10 })
  })

  it('a failed grant does not arm the countdown', async () => {
    const h = harness({ enabled: true, durationMinutes: 10 })
    await expect(h.ctl.recordConnection(() => { throw new Error('user closed') })).rejects.toThrow('user closed')
    expect((await h.ctl.getSettings()).deadlineAt).toBeNull()
  })
})
