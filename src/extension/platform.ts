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
// service workers. chrome.windows.create() has no such restriction.

let _approvalWindowId: number | null = null

function openApprovalPopup(): void {
  if (_approvalWindowId !== null) {
    // Popup already open — just focus it
    chrome.windows.update(_approvalWindowId, { focused: true }).catch(() => {
      _approvalWindowId = null
      openApprovalPopup()  // window was closed, open a new one
    })
    return
  }
  chrome.windows.create({
    url: chrome.runtime.getURL('popup.html'),
    type: 'popup',
    width: 380,
    height: 620,
    focused: true
  }, (win) => {
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
 * if none is listening, open the windowed approval popup.
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
