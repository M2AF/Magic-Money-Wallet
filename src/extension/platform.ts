/**
 * platform.ts — Chrome implementations of the platform seam
 *
 * wallet-handlers.ts and wc-ext.ts route every environment side effect
 * (UI pushes, dApp event broadcasts, approval surfacing, WC storage)
 * through this module. The Capacitor build aliases './platform' to
 * src/capacitor/platform-capacitor.ts, which implements the same surface
 * over an in-process event bus + Capacitor Preferences.
 */

// ── Approval popup (works from service worker — no user gesture required) ────
// chrome.action.openPopup() requires a user gesture and silently fails in MV3
// service workers. chrome.windows.create() has no such restriction, and it's
// the only way to surface a locked-wallet unlock prompt AND the pending
// request without the user manually finding the toolbar icon first — a badge
// alone leaves the dApp waiting until they notice it themselves, which isn't
// good enough when the wallet is locked (they need to unlock before they can
// even see what they're approving). This does mean the window carries Chrome's
// native title bar (drag/minimize/maximize/close) — there's no frameless
// option for extension-created windows — but the alternative (no popup at all)
// is worse for a wallet that has to be unlocked before it can show anything.

let _approvalWindowId: number | null = null
// chrome.windows.create() is async — two approval requests firing close together
// (common: CIP-30 dApps often call enable() more than once while probing for
// wallets, or connect immediately followed by a signData verification step)
// would otherwise both see _approvalWindowId still null and both spawn a
// window. This guards the gap between "create started" and "id assigned".
let _creatingWindow = false

function openApprovalPopup(): void {
  if (_approvalWindowId !== null) {
    // Popup already open — just focus it (the popup itself re-fetches all
    // pending queues on mount, and after each approve/reject, so a second
    // request queued while it's open still surfaces without reopening).
    chrome.windows.update(_approvalWindowId, { focused: true }).catch(() => {
      _approvalWindowId = null
      openApprovalPopup()  // window was closed, open a new one
    })
    return
  }
  if (_creatingWindow) return
  _creatingWindow = true
  chrome.windows.create({
    // ?windowed=1 tells popup.tsx to self-correct its size on load (see
    // there for why: OS title bar / border overhead varies by system, so a
    // static width/height here is either too small — clipping popup.css's
    // fixed 400×600 content — or too big, leaving a visible margin).
    url: chrome.runtime.getURL('popup.html?windowed=1'),
    type: 'popup',
    width: 420,
    height: 660,
    focused: true
  }, (win) => {
    _creatingWindow = false
    if (!win?.id) return
    _approvalWindowId = win.id
    chrome.windows.onRemoved.addListener(function onClosed(id) {
      if (id === _approvalWindowId) {
        _approvalWindowId = null
        chrome.windows.onRemoved.removeListener(onClosed)
      }
    })
  })
}

// ── UI pushes ─────────────────────────────────────────────────────────────────

/** Push an event to the wallet UI (popup / side panel), swallowing errors. */
export function pushToUi(type: string, data: unknown): void {
  chrome.runtime.sendMessage({ type, data }).catch(() => {})
}

/**
 * Surface a pending approval to the user: push it to any open wallet UI, and
 * if none is listening, open the windowed approval popup so they can unlock
 * and see it immediately, even if the wallet was closed or locked.
 */
export function requestApproval(type: string, data: unknown): void {
  chrome.runtime.sendMessage({ type, data }).catch(() => openApprovalPopup())
}

// ── dApp event pushes (EIP-1193 events to injected providers) ────────────────

/** Push an EIP-1193 event to ALL dApp tabs. */
export function pushToDapps(event: string, data: unknown): void {
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, { type: 'eth:event', event, data }).catch(() => {})
      }
    }
  })
}

/**
 * Push an EIP-1193 event to ONLY the tabs whose page matches `origin`. Used when
 * a single site is revoked so other connected dApps in other tabs aren't disturbed.
 */
export function pushToDappOrigin(origin: string, event: string, data: unknown): void {
  chrome.tabs.query({}, tabs => {
    for (const tab of tabs) {
      if (tab.id == null || !tab.url) continue
      let tabOrigin = ''
      try { tabOrigin = new URL(tab.url).origin } catch { continue }
      if (tabOrigin === origin) {
        chrome.tabs.sendMessage(tab.id, { type: 'eth:event', event, data }).catch(() => {})
      }
    }
  })
}

/** Push an EIP-1193 event to one specific dApp tab (no-op if tabId is missing). */
export function pushToDappTab(tabId: number | undefined, event: string, data: unknown): void {
  if (tabId == null) return
  chrome.tabs.sendMessage(tabId, { type: 'eth:event', event, data }).catch(() => {})
}

// ── Side panel ────────────────────────────────────────────────────────────────

export async function openSidePanel(): Promise<boolean> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const windowId = tabs[0]?.windowId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (windowId !== undefined) await (chrome.sidePanel as any).open({ windowId })
  return true
}

export async function closeSidePanel(): Promise<boolean> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabId = tabs[0]?.id
  if (tabId !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (chrome.sidePanel as any).setOptions({ tabId, enabled: false })
    // Re-enable after close so the user can reopen it later
    setTimeout(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (chrome.sidePanel as any).setOptions({ tabId, enabled: true }).catch(() => {})
    }, 600)
  }
  return true
}

// ── Auto-revoke wake-ups ──────────────────────────────────────────────────────
// An MV3 service worker is torn down after ~30 s idle, taking any setTimeout
// with it, so the deadline rides chrome.alarms, which survives suspension and
// wakes the worker. Chrome may deliver an alarm up to ~30 s late (and not at
// all while the browser is closed); the router also reconciles on startup and
// before every dApp / WalletConnect request, so a late alarm never extends
// what a site can do. The listener is registered synchronously at import, as
// MV3 requires for events that wake the worker.

const AUTO_REVOKE_ALARM = 'mm-auto-revoke'
let _autoRevokeWake: (() => void) | null = null

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === AUTO_REVOKE_ALARM) _autoRevokeWake?.()
})

export function onAutoRevokeWake(cb: () => void): void {
  _autoRevokeWake = cb
}

export function scheduleAutoRevokeWake(at: number | null): void {
  if (at === null) { chrome.alarms.clear(AUTO_REVOKE_ALARM).catch(() => {}); return }
  // A past `when` fires as soon as possible; keep it strictly in the future.
  chrome.alarms.create(AUTO_REVOKE_ALARM, { when: Math.max(at, Date.now() + 1_000) }).catch(() => {})
}

// ── WalletConnect key-value storage (SignClient IKeyValueStorage) ─────────────

class ChromeKv {
  async getKeys(): Promise<string[]> {
    const all = await chrome.storage.local.get(null)
    return Object.keys(all).filter(k => k.startsWith('wc@'))
  }
  async getEntries<T = unknown>(): Promise<[string, T][]> {
    const all = await chrome.storage.local.get(null)
    return Object.entries(all).filter(([k]) => k.startsWith('wc@')) as [string, T][]
  }
  async getItem<T = unknown>(key: string): Promise<T | undefined> {
    const r = await chrome.storage.local.get(key)
    return r[key] as T | undefined
  }
  async setItem<T = unknown>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  }
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key)
  }
}

export const wcKv = new ChromeKv()
