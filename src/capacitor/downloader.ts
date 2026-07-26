/**
 * downloader.ts — typed JS wrapper for the native Downloader plugin
 * (android/app/src/main/java/info/chainlens/magicmoney/DownloaderPlugin.java)
 *
 * Android's WebView ignores <a download>, so NFT media has to be saved natively.
 * Mirrors Electron's `wallet:download-file` IPC so the renderer has one path.
 */

import { registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { DownloadProgress, DownloadResult } from '../renderer/types/wallet'

export interface DownloaderPlugin {
  downloadFile(o: { url: string; filename: string }): Promise<DownloadResult>
  /** Drives the wallet's top-edge neon bar while bytes arrive. */
  addListener(event: 'progress', cb: (p: DownloadProgress) => void): Promise<PluginListenerHandle>
}

export const Downloader = registerPlugin<DownloaderPlugin>('Downloader')
