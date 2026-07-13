/**
 * platform-capacitor.ts — Capacitor implementations of the platform seam
 *
 * The Android build vite-aliases './platform' (imported by wallet-handlers.ts
 * and wc-ext.ts) to this module. Same export surface as src/extension/platform.ts:
 *  - UI pushes ride an in-process EventTarget bus (UI and handlers share one
 *    JS realm in the Capacitor WebView — no message passing needed)
 *  - dApp pushes route to the DappBrowser plugin sink once Phase 3 installs it;
 *    until then they no-op (no dApp surface exists)
 *  - WalletConnect storage rides @capacitor/preferences
 */

import { Preferences } from '@capacitor/preferences'

// ── In-process UI event bus ───────────────────────────────────────────────────

const bus = new EventTarget()
const _listenerMap = new Map<string, Map<(data: unknown) => void, EventListener>>()

export function emitUiEvent(type: string, data: unknown): void {
  bus.dispatchEvent(new CustomEvent(type, { detail: data }))
}

export function onUiEvent(type: string, cb: (data: unknown) => void): void {
  const wrapped: EventListener = (e) => cb((e as CustomEvent).detail)
  let forType = _listenerMap.get(type)
  if (!forType) { forType = new Map(); _listenerMap.set(type, forType) }
  forType.set(cb, wrapped)
  bus.addEventListener(type, wrapped)
}

export function offUiEvent(type: string, cb: (data: unknown) => void): void {
  const wrapped = _listenerMap.get(type)?.get(cb)
  if (wrapped) {
    bus.removeEventListener(type, wrapped)
    _listenerMap.get(type)?.delete(cb)
  }
}

// ── Platform seam surface (mirrors src/extension/platform.ts) ─────────────────

/** Push an event to the wallet UI. Same realm — just dispatch on the bus. */
export function pushToUi(type: string, data: unknown): void {
  emitUiEvent(type, data)
}

/**
 * Surface a pending approval. The wallet UI is always mounted in the same
 * WebView, so the bus event is enough — CapApp renders the overlay.
 */
export function requestApproval(type: string, data: unknown): void {
  emitUiEvent(type, data)
}

// ── dApp event pushes ─────────────────────────────────────────────────────────
// Phase 3 (in-app dApp browser) installs a sink that forwards these to the
// native DappBrowser plugin's WebViews. Until then there are no dApp pages.

export interface DappSink {
  pushToDapps(event: string, data: unknown): void
  pushToDappOrigin(origin: string, event: string, data: unknown): void
  pushToDappTab(tabId: number | undefined, event: string, data: unknown): void
}

let _dappSink: DappSink | null = null

export function setDappSink(sink: DappSink | null): void {
  _dappSink = sink
}

export function pushToDapps(event: string, data: unknown): void {
  _dappSink?.pushToDapps(event, data)
}

export function pushToDappOrigin(origin: string, event: string, data: unknown): void {
  _dappSink?.pushToDappOrigin(origin, event, data)
}

export function pushToDappTab(tabId: number | undefined, event: string, data: unknown): void {
  _dappSink?.pushToDappTab(tabId, event, data)
}

// ── Side panel (extension-only concept — no-ops on Android) ───────────────────

export async function openSidePanel(): Promise<boolean> { return true }
export async function closeSidePanel(): Promise<boolean> { return true }

// ── WalletConnect key-value storage (SignClient IKeyValueStorage) ─────────────
// Preferences values are strings, so entries are JSON round-tripped (the chrome
// implementation stores raw objects — the wc@ payloads are all JSON-safe).

class PrefsKv {
  async getKeys(): Promise<string[]> {
    const { keys } = await Preferences.keys()
    return keys.filter(k => k.startsWith('wc@'))
  }
  async getEntries<T = unknown>(): Promise<[string, T][]> {
    const keys = await this.getKeys()
    const entries: [string, T][] = []
    for (const key of keys) {
      const { value } = await Preferences.get({ key })
      if (value != null) entries.push([key, JSON.parse(value) as T])
    }
    return entries
  }
  async getItem<T = unknown>(key: string): Promise<T | undefined> {
    const { value } = await Preferences.get({ key })
    return value == null ? undefined : JSON.parse(value) as T
  }
  async setItem<T = unknown>(key: string, value: T): Promise<void> {
    await Preferences.set({ key, value: JSON.stringify(value) })
  }
  async removeItem(key: string): Promise<void> {
    await Preferences.remove({ key })
  }
}

export const wcKv = new PrefsKv()
