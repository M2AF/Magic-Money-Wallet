/**
 * default-browser.ts — typed JS wrapper for the native DefaultBrowser plugin
 * (android/app/src/main/java/info/chainlens/magicmoney/DefaultBrowserPlugin.java)
 *
 * Mirrors the Electron `default-browser:*` IPC contract so SettingsModal can use
 * one feature-detected code path on both platforms.
 */

import { registerPlugin } from '@capacitor/core'
import type { DefaultBrowserState } from '../renderer/types/wallet'

export interface DefaultBrowserPlugin {
  getStatus(): Promise<DefaultBrowserState>
  /** Shows the system role dialog (API 29+) or the default-apps settings screen. */
  requestDefault(): Promise<DefaultBrowserState>
}

export const DefaultBrowser = registerPlugin<DefaultBrowserPlugin>('DefaultBrowser')
