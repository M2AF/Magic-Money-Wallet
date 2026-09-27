/**
 * auto-revoke.ts — timed revocation of dApp site access (shared, platform-free)
 *
 * Settings → Security → "Auto-revoke site access". Off by default. When On, ONE
 * global countdown starts at the first connection (an approved-origin grant or
 * a WalletConnect session approval). Connections made while it runs share its
 * deadline — they never extend it. At the deadline EVERY approved origin is
 * revoked and EVERY WalletConnect session is disconnected; the feature stays On
 * and the next connection starts a new countdown. This is not an idle timer.
 *
 * "Revoke" here means exactly: drop the per-chain origin grants (the same path
 * as Settings → Connected Sites → Disconnect All, including its disconnect
 * events) and terminate WalletConnect sessions. It does NOT clear cookies or
 * browsing data, lock the wallet, or touch on-chain token approvals.
 *
 * Like dapp-permissions.ts this module owns the policy once for all four
 * targets; each host supplies its own storage, WalletConnect client and wake-up
 * scheduler through AutoRevokeDeps. The deadline is an absolute timestamp, so
 * a suspended service worker or frozen WebView cannot "pause" it — the host
 * reconciles on wake and before serving dApp requests, and an overdue deadline
 * is enforced before anything is authorised.
 *
 * Replacing or deleting the wallet does not cancel a running countdown: grants
 * are already cleared by those flows, and WalletConnect sessions (which they do
 * not touch) still get torn down at the deadline. The settings themselves are
 * an install-local preference and survive a wallet replacement.
 */

export const AUTO_REVOKE_MIN_MINUTES = 1
export const AUTO_REVOKE_MAX_MINUTES = 60
export const AUTO_REVOKE_DEFAULT_MINUTES = 15
/** Back-off before retrying a WalletConnect teardown (or a failed revoke). */
export const AUTO_REVOKE_RETRY_MS = 30_000
/** One relay round-trip must not stall every dApp request behind the lock. */
export const WC_DISCONNECT_TIMEOUT_MS = 10_000

const MINUTE_MS = 60_000

export interface AutoRevokeState {
  enabled: boolean
  durationMinutes: number
  /** Countdown start (epoch ms); null when no countdown is running. */
  startedAt: number | null
  /**
   * WalletConnect teardown still owed by an expiry that has already revoked
   * every origin. `all` means the WC client was not running at expiry, so every
   * session it restores is owed (none can be approved before it drains).
   * Requests on owed topics are refused until they are gone.
   */
  pendingWc: { all: boolean; topics: string[] } | null
}

/** What the UI sees. The backend owns the deadline; the UI only displays it. */
export interface AutoRevokeSettings {
  enabled: boolean
  durationMinutes: number
  deadlineAt: number | null
  wcTeardownPending: boolean
}

export interface AutoRevokePatch {
  enabled?: boolean
  durationMinutes?: number
}

export const DEFAULT_AUTO_REVOKE_STATE: AutoRevokeState = {
  enabled: false,
  durationMinutes: AUTO_REVOKE_DEFAULT_MINUTES,
  startedAt: null,
  pendingWc: null,
}

// ── Pure policy ──────────────────────────────────────────────────────────────

/** Integer minutes in [1, 60]; anything non-numeric falls back to the default. */
export function clampDurationMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return AUTO_REVOKE_DEFAULT_MINUTES
  return Math.min(AUTO_REVOKE_MAX_MINUTES, Math.max(AUTO_REVOKE_MIN_MINUTES, Math.round(value)))
}

/** Parse whatever is in storage. A cold or corrupt store reads as Off. */
export function normalizeAutoRevokeState(raw: unknown): AutoRevokeState {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_AUTO_REVOKE_STATE }
  const r = raw as Record<string, unknown>
  const enabled = r.enabled === true
  const startedAt = typeof r.startedAt === 'number' && Number.isFinite(r.startedAt) && r.startedAt > 0
    ? r.startedAt : null

  let pendingWc: AutoRevokeState['pendingWc'] = null
  const p = r.pendingWc as Record<string, unknown> | null | undefined
  if (p && typeof p === 'object') {
    const all = p.all === true
    const topics = Array.isArray(p.topics)
      ? [...new Set(p.topics.filter((t): t is string => typeof t === 'string' && t.length > 0))]
      : []
    if (all || topics.length > 0) pendingWc = { all, topics }
  }

  return {
    enabled,
    durationMinutes: clampDurationMinutes(r.durationMinutes),
    // A countdown cannot exist while the feature is Off.
    startedAt: enabled ? startedAt : null,
    pendingWc,
  }
}

/**
 * Validate a settings change coming from the UI. `enabled` must be a real
 * boolean and `durationMinutes` a real number (clamped to 1–60); anything else
 * is rejected rather than coerced, so a malformed call can't silently flip it.
 */
export function parseAutoRevokePatch(raw: unknown): AutoRevokePatch {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid auto-revoke settings')
  const r = raw as Record<string, unknown>
  const patch: AutoRevokePatch = {}
  if (r.enabled !== undefined) {
    if (typeof r.enabled !== 'boolean') throw new Error('Auto-revoke "enabled" must be true or false')
    patch.enabled = r.enabled
  }
  if (r.durationMinutes !== undefined) {
    if (typeof r.durationMinutes !== 'number' || !Number.isFinite(r.durationMinutes)) {
      throw new Error('Auto-revoke duration must be a number of minutes')
    }
    patch.durationMinutes = clampDurationMinutes(r.durationMinutes)
  }
  return patch
}

export function deadlineOf(state: AutoRevokeState): number | null {
  if (!state.enabled || state.startedAt === null) return null
  return state.startedAt + state.durationMinutes * MINUTE_MS
}

export function isOverdue(state: AutoRevokeState, now: number): boolean {
  const deadline = deadlineOf(state)
  return deadline !== null && now >= deadline
}

/**
 * Apply a settings change. Turning Off cancels the countdown without touching
 * any connection. Turning On while something is connected starts a FRESH
 * countdown from now. A duration change keeps the original start, so the
 * deadline moves with it (the caller expires immediately if that is now past).
 * Owed WalletConnect teardown survives either way — that expiry already happened.
 */
export function applySettings(
  state: AutoRevokeState, patch: AutoRevokePatch, now: number, hasConnections: boolean
): AutoRevokeState {
  const next: AutoRevokeState = { ...state }
  if (patch.durationMinutes !== undefined) next.durationMinutes = clampDurationMinutes(patch.durationMinutes)
  if (patch.enabled === false) {
    next.enabled = false
    next.startedAt = null
  } else if (patch.enabled === true && !state.enabled) {
    next.enabled = true
    next.startedAt = hasConnections ? now : null
  }
  return next
}

/** A connection was just made: start the countdown only if none is running. */
export function armCountdown(state: AutoRevokeState, now: number): AutoRevokeState {
  if (!state.enabled || state.startedAt !== null) return state
  return { ...state, startedAt: now }
}

export function toSettings(state: AutoRevokeState): AutoRevokeSettings {
  return {
    enabled: state.enabled,
    durationMinutes: state.durationMinutes,
    deadlineAt: deadlineOf(state),
    wcTeardownPending: state.pendingWc !== null,
  }
}

// ── Controller ───────────────────────────────────────────────────────────────

export interface AutoRevokeDeps {
  now?: () => number
  load(): unknown | Promise<unknown>
  save(state: AutoRevokeState): void | Promise<void>
  /** Revoke every approved origin and notify pages — the manual Disconnect All path. */
  revokeAllOrigins(): void | Promise<void>
  hasOriginGrants(): boolean | Promise<boolean>
  wc: {
    /** Is the WalletConnect client initialised (sessions restored)? */
    ready(): boolean
    topics(): string[]
    disconnect(topic: string): Promise<void>
  }
  /** Ask the host to call reconcile() at (or soon after) `at`; null cancels. */
  schedule(at: number | null): void
  /** Push fresh settings to the UI after an expiry or a change. */
  notify?(settings: AutoRevokeSettings): void
  log?(message: string, error: unknown): void
}

export interface AutoRevokeController {
  /** Enforce an overdue deadline / finish owed WC teardown. Throws if origins could not be revoked. */
  reconcile(): Promise<AutoRevokeSettings>
  getSettings(): Promise<AutoRevokeSettings>
  setSettings(raw: unknown): Promise<AutoRevokeSettings>
  /**
   * Run a grant (origin approval or WC session approval) serialised against
   * expiry: an overdue deadline is enforced FIRST, then the grant, then the
   * countdown is armed. A grant can therefore never be erased by an expiry it
   * raced, nor outlive the policy by slipping in after the revoke.
   */
  recordConnection<T>(grant: () => T | Promise<T>): Promise<T>
  /** After a manual disconnect: if nothing is connected any more, stop the countdown. */
  releaseIfIdle(): Promise<void>
  /** Sync check against the last-read state: is a deadline overdue right now? */
  overdue(): boolean
  /** Sync: is this WalletConnect topic owed a teardown (requests must be refused)? */
  isWcTopicBlocked(topic: string): boolean
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out')), ms)
    promise.then(
      v => { clearTimeout(timer); resolve(v) },
      e => { clearTimeout(timer); reject(e) },
    )
  })
}

export function createAutoRevoke(deps: AutoRevokeDeps): AutoRevokeController {
  const now = deps.now ?? (() => Date.now())
  const log = deps.log ?? ((m: string, e: unknown) => console.warn(`[auto-revoke] ${m}`, e))
  let tail: Promise<unknown> = Promise.resolve()
  let cache: AutoRevokeState | null = null
  let retryAt: number | null = null
  // Owed WC teardown found the client down; drain as soon as it is up.
  let awaitingWc = false

  /** Serialise every read-modify-write: expiry, settings changes and grants. */
  function locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn)
    tail = run.catch(() => {})
    return run
  }

  async function read(): Promise<AutoRevokeState> {
    cache = normalizeAutoRevokeState(await deps.load())
    return cache
  }

  async function write(state: AutoRevokeState): Promise<void> {
    await deps.save(state)
    cache = state
  }

  function reschedule(state: AutoRevokeState): void {
    const deadline = deadlineOf(state)
    const times: number[] = []
    // A deadline already past with a retry pending is waiting on that retry;
    // scheduling the past deadline would spin a hot loop against a failure.
    if (deadline !== null && (retryAt === null || deadline > now())) times.push(deadline)
    if (retryAt !== null) times.push(retryAt)
    deps.schedule(times.length ? Math.min(...times) : null)
  }

  async function hasConnections(): Promise<boolean> {
    if (await deps.hasOriginGrants()) return true
    // Unknown (client still restoring) counts as connected: an unneeded
    // countdown is harmless, a missing one is not.
    return !deps.wc.ready() || deps.wc.topics().length > 0
  }

  async function drainWc(state: AutoRevokeState): Promise<AutoRevokeState> {
    if (!state.pendingWc) return state
    if (!deps.wc.ready()) { awaitingWc = true; retryAt = now() + AUTO_REVOKE_RETRY_MS; return state }
    awaitingWc = false
    const live = new Set(deps.wc.topics())
    const owed = state.pendingWc.all ? [...live] : state.pendingWc.topics.filter(t => live.has(t))
    const remaining: string[] = []
    for (const topic of owed) {
      try {
        await withTimeout(deps.wc.disconnect(topic), WC_DISCONNECT_TIMEOUT_MS)
      } catch (e) {
        // Already gone (deleted by the peer, expired) counts as done.
        if (deps.wc.topics().includes(topic)) {
          remaining.push(topic)
          log(`WalletConnect disconnect failed for ${topic.slice(0, 8)}…, will retry`, e)
        }
      }
    }
    const next: AutoRevokeState = { ...state, pendingWc: remaining.length ? { all: false, topics: remaining } : null }
    await write(next)
    retryAt = remaining.length ? now() + AUTO_REVOKE_RETRY_MS : null
    return next
  }

  async function expire(state: AutoRevokeState): Promise<AutoRevokeState> {
    try {
      await deps.revokeAllOrigins()
    } catch (e) {
      // Deadline stays set and overdue, so every grant check keeps failing
      // closed until a retry succeeds.
      retryAt = now() + AUTO_REVOKE_RETRY_MS
      reschedule(state)
      throw e
    }
    const prev = state.pendingWc
    const owedNow = deps.wc.ready()
      ? { all: false, topics: deps.wc.topics() }
      : { all: true, topics: [] as string[] }
    const all = (prev?.all ?? false) || owedNow.all
    const topics = [...new Set([...(prev?.topics ?? []), ...owedNow.topics])]
    let next: AutoRevokeState = {
      ...state,
      startedAt: null,
      pendingWc: all || topics.length ? { all, topics } : null,
    }
    // Persist "origins revoked, countdown over, these WC sessions owed" before
    // the network work, so a crash mid-teardown resumes rather than re-revoking
    // grants made after this expiry.
    await write(next)
    retryAt = null
    next = await drainWc(next)
    deps.notify?.(toSettings(next))
    return next
  }

  async function reconcileLocked(): Promise<AutoRevokeState> {
    let state = await read()
    if (isOverdue(state, now())) state = await expire(state)
    else if (state.pendingWc) {
      // Retry on the back-off (or the moment WC comes up), not on every dApp
      // request — a dead relay would otherwise stall each one for the timeout.
      const due = retryAt === null || now() >= retryAt || (awaitingWc && deps.wc.ready())
      if (due) state = await drainWc(state)
    } else retryAt = null
    reschedule(state)
    return state
  }

  return {
    reconcile: () => locked(async () => toSettings(await reconcileLocked())),

    getSettings: () => locked(async () => {
      try {
        return toSettings(await reconcileLocked())
      } catch (e) {
        log('reconcile failed while reading settings', e)
        return toSettings(cache ?? (await read()))
      }
    }),

    setSettings: (raw: unknown) => {
      // Validate before queueing so a bad call fails fast and changes nothing.
      const patch = parseAutoRevokePatch(raw)
      return locked(async () => {
        let state = await reconcileLocked()
        const enabling = patch.enabled === true && !state.enabled
        state = applySettings(state, patch, now(), enabling ? await hasConnections() : false)
        await write(state)
        if (isOverdue(state, now())) state = await expire(state)
        reschedule(state)
        deps.notify?.(toSettings(state))
        return toSettings(state)
      })
    },

    recordConnection: <T>(grant: () => T | Promise<T>) => locked(async () => {
      await reconcileLocked()
      const result = await grant()
      const state = await read()
      const armed = armCountdown(state, now())
      if (armed !== state) {
        await write(armed)
        deps.notify?.(toSettings(armed))
      }
      reschedule(armed)
      return result
    }),

    releaseIfIdle: () => locked(async () => {
      const state = await read()
      if (state.startedAt === null || !deps.wc.ready()) return
      if (await deps.hasOriginGrants() || deps.wc.topics().length > 0) return
      const next = { ...state, startedAt: null }
      await write(next)
      reschedule(next)
      deps.notify?.(toSettings(next))
    }),

    overdue: () => cache !== null && isOverdue(cache, now()),

    isWcTopicBlocked: (topic: string) =>
      !!cache?.pendingWc && (cache.pendingWc.all || cache.pendingWc.topics.includes(topic)),
  }
}
