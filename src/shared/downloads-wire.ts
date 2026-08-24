/**
 * downloads-wire.ts — the downloads-tray contract, shared by every target
 *
 * One shape, four producers: Electron's main process (downloads-manager.ts),
 * Android's DownloaderPlugin, iOS's DownloaderPlugin, and one consumer — the
 * shared DownloadsPanel. Kept here, beside asset-filter-key.ts and
 * theme-sync-wire.ts, for the same reason those are: the alternative is a
 * hand-copied interface in main AND in renderer/types/wallet.ts, and a silent
 * drift between them is exactly the class of bug that costs a release.
 *
 * Deliberately free of both node and DOM types so it can be listed in every
 * tsconfig (see the comments in tsconfig.node.json / tsconfig.web.json).
 * Types only — no runtime code, nothing to bundle.
 */

/**
 * Lifecycle of one download, named to match Electron's DownloadItem states so
 * the desktop side needs no translation layer. `paused` is folded in here (it is
 * a separate boolean on DownloadItem) because to the UI it is just another
 * resting state with different buttons.
 */
export type DownloadState = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

/**
 * One row in the downloads manager.
 *
 * `path` is an absolute filesystem path on desktop and a *display* location on
 * mobile ("Downloads/photo.png"), so never parse it — it is for showing, and for
 * handing straight back to the platform's own open/reveal calls.
 */
export interface DownloadRecord {
  id: string
  /** Source URL — used by Retry and "Copy download link". */
  url: string
  fileName: string
  /** Null while a "Save as…" dialog is still open, or if nothing was written. */
  path: string | null
  mimeType: string
  state: DownloadState
  receivedBytes: number
  /** 0 when the server sent no Content-Length — the row shows a sweep, not a %. */
  totalBytes: number
  startedAt: number
  finishedAt: number | null
  /**
   * Whether the file is still there. Re-checked on every list, so a file the
   * user deleted in Explorer/Files greys out its Open and Show buttons instead
   * of failing on click.
   */
  exists: boolean
  /** Pause/resume is Electron-only; DownloadManager exposes no such control. */
  canResume: boolean
  /**
   * Whether the file can be deleted from the tray. Absent means yes. False on
   * iOS for media saved into the Photos library: the app asks for ADD-ONLY
   * Photos access on purpose (a wallet has no business reading your library),
   * and that authorization does not include the right to delete.
   */
  canDelete?: boolean
  /** Host the file came from, shown under the name. */
  host: string
  error?: string
}

/** A whole tray read. Every mutation returns one so the panel re-renders from one value. */
export interface DownloadsSnapshot {
  items: DownloadRecord[]
  /**
   * Platform capabilities — the panel hides buttons it cannot honour. Desktop
   * has both; Android has neither (DownloadManager exposes no pause/resume, and
   * "show in folder" is the system Downloads app, offered separately).
   */
  canShowInFolder: boolean
  canPause: boolean
  error?: string
}

/**
 * Result of one row action. The snapshot rides along on failure too — a Delete
 * that failed because the file was already gone still changed what the list
 * should show.
 */
export interface DownloadActionResult {
  ok: boolean
  error?: string
  snapshot: DownloadsSnapshot
}
