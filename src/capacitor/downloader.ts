/**
 * downloader.ts — typed JS wrapper for the native Downloader plugin
 * (android/app/src/main/java/info/chainlens/magicmoney/DownloaderPlugin.java)
 *
 * Android's WebView ignores <a download>, so NFT media has to be saved natively.
 * Mirrors Electron's `wallet:download-file` IPC so the renderer has one path.
 */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { DownloadProgress, DownloadResult } from '../renderer/types/wallet'
import type { DownloadActionResult, DownloadsSnapshot } from '../shared/downloads-wire'

export interface DownloaderPlugin {
  downloadFile(o: { url: string; filename: string }): Promise<DownloadResult>
  /** Drives the wallet's top-edge neon bar while bytes arrive. */
  addListener(event: 'progress', cb: (p: DownloadProgress) => void): Promise<PluginListenerHandle>

  // ── Downloads tray ────────────────────────────────────────────────────────
  // The Android counterpart of the desktop's browser:downloads:* IPC. Same wire
  // contract (src/shared/downloads-wire.ts) because the same React panel renders
  // both. `retryDownload` is the one action that lives on DappBrowser instead —
  // it re-requests over the network and has to clear the same Tor gate.
  listDownloads(): Promise<DownloadsSnapshot>
  openDownload(o: { id: string }): Promise<DownloadActionResult>
  deleteDownload(o: { id: string }): Promise<DownloadActionResult>
  removeDownload(o: { id: string }): Promise<DownloadActionResult>
  clearDownloads(): Promise<DownloadActionResult>
  cancelDownload(o: { id: string }): Promise<DownloadActionResult>
  openDownloadsFolder(): Promise<DownloadActionResult>
  addListener(event: 'downloadsChanged', cb: (s: DownloadsSnapshot) => void): Promise<PluginListenerHandle>
}

export const Downloader = registerPlugin<DownloaderPlugin>('Downloader')
