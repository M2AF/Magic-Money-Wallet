/**
 * dapp-browser.ts — typed JS wrapper for the native DappBrowser plugin
 * (android/app/src/main/java/info/chainlens/magicmoney/DappBrowserPlugin.java)
 */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { TorBrowserState, MagicGuardState } from '../renderer/types/wallet'

export interface Bounds { x: number; y: number; width: number; height: number }  // CSS px

export interface DappBrowserState {
  url: string
  canBack: boolean
  canForward: boolean
  loading: boolean
  activeTabId: number
  tabs: Array<{ id: number; title: string; url: string; loading: boolean }>
}

export interface PageRequestEvent {
  requestId: string
  origin: string        // chromium-authenticated page origin
  tabId: number
  payloadJson: string   // raw {id, type, args} JSON from dapp-inject.ts
}

export interface DappBrowserPlugin {
  open(o: { url: string; bounds: Bounds }): Promise<{ tabId: number }>
  close(): Promise<void>
  newTab(o: { url: string }): Promise<{ tabId: number }>
  selectTab(o: { tabId: number }): Promise<void>
  closeTab(o: { tabId: number }): Promise<void>
  navigate(o: { url: string }): Promise<void>
  goBack(): Promise<void>
  goForward(): Promise<void>
  reload(): Promise<void>
  canGoBack(): Promise<{ canBack: boolean }>
  setBounds(o: Bounds): Promise<void>
  hide(): Promise<void>
  show(): Promise<void>
  getState(): Promise<DappBrowserState>
  getTorState(): Promise<TorBrowserState>
  setTorMode(o: { enabled: boolean }): Promise<TorBrowserState>
  // Magic Guard — the active tab's hostname is derived on the Java side, never
  // passed from here (same invariant as the desktop IPC contract).
  getMagicGuardState(): Promise<MagicGuardState>
  setMagicGuardEnabled(o: { enabled: boolean }): Promise<MagicGuardState>
  setMagicGuardForSite(o: { enabled: boolean }): Promise<MagicGuardState>
  // Saved-password fill. Runs `script` in the ACTIVE tab only — there is no
  // tabId parameter by design, so a fill can never be aimed at a background tab.
  fillCredentials(o: { script: string }): Promise<{ ok: boolean; result: string }>
  hasLoginForm(): Promise<{ hasForm: boolean; url: string }>
  // Android system share sheet (the phone-native analog of copy link / email).
  sharePage(o: { url: string; title?: string }): Promise<void>
  // "Install as app" → a pinned home-screen shortcut that re-enters this browser.
  installShortcut(o: { url: string; name?: string }): Promise<void>
  respond(o: { requestId: string; json: string }): Promise<void>
  emitEvent(o: { origin?: string; json: string }): Promise<void>
  addListener(event: 'pageRequest', cb: (e: PageRequestEvent) => void): Promise<PluginListenerHandle>
  // A visible password field appeared in the ACTIVE tab (payload-free by design).
  addListener(event: 'autofillFormFound', cb: (e: { tabId: number; origin: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'urlChanged', cb: (e: { url: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'loadingChanged', cb: (e: { loading: boolean }) => void): Promise<PluginListenerHandle>
  addListener(event: 'navState', cb: (e: { canBack: boolean; canForward: boolean }) => void): Promise<PluginListenerHandle>
  addListener(event: 'titleChanged', cb: (e: { title: string }) => void): Promise<PluginListenerHandle>
  addListener(event: 'tabsChanged', cb: (e: { activeTabId: number; tabs: DappBrowserState['tabs'] }) => void): Promise<PluginListenerHandle>
  addListener(event: 'closed', cb: () => void): Promise<PluginListenerHandle>
  addListener(event: 'torStateChanged', cb: (state: TorBrowserState) => void): Promise<PluginListenerHandle>
  addListener(event: 'magicGuardStateChanged', cb: (state: MagicGuardState) => void): Promise<PluginListenerHandle>
}

export const DappBrowser = registerPlugin<DappBrowserPlugin>('DappBrowser')
