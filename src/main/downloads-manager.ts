/**
 * downloads-manager.ts — MagicMoney Wallet
 *
 * The browser's downloads tray: one list of every file the app has saved, with
 * the controls Chrome/Edge/Brave give you (open, show in folder, delete from
 * disk, remove from the list, pause/resume/cancel, retry).
 *
 * Two sources feed the same list, deliberately:
 *   • Browser downloads — a link or navigation in a dApp tab, tracked live from
 *     the session's `will-download` DownloadItem (browser-manager.ts).
 *   • Wallet-initiated saves — NFT media (downloads.ts), "Save page as…" and
 *     "Screenshot" (browser-manager.ts). These bypass Chromium's download stack
 *     entirely, so they are recorded on completion instead of tracked.
 * A user who saves an NFT and then a PDF expects to find both in one place; they
 * land in the same OS Downloads folder, so they belong in the same tray.
 *
 * Persistence follows browser-store.ts exactly — plain JSON under
 * `userData/browser/`, module-level cache, tolerant loader (corrupt file ⇒
 * empty list, never a crash), deterministic writer. Nothing here is a secret:
 * it is a record of files already sitting unencrypted in the Downloads folder.
 *
 * IN-FLIGHT STATE IS NOT PERSISTED AS SUCH. Electron cannot resume a download
 * across an app restart without the original ETag/offset dance
 * (session.createInterruptedDownload), which no browser bothers with for an app
 * that was killed. Anything still `progressing`/`paused` at load time is marked
 * `interrupted` so the row offers Retry rather than a progress bar that will
 * never move.
 */

import { app, shell } from 'electron'
import type { DownloadItem, WebContents } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, unlinkSync } from 'fs'
import { basename, join } from 'path'
import type { DownloadActionResult } from '../shared/downloads-wire'

// Re-exported so callers (browser-manager, ipc-handlers) have one import site
// for the whole tray contract rather than two.
export type { DownloadActionResult, DownloadRecord, DownloadsSnapshot } from '../shared/downloads-wire'
import type { DownloadRecord, DownloadState, DownloadsSnapshot } from '../shared/downloads-wire'

// Same ceiling reasoning as browser-store's MAX_BOOKMARKS: this file is read
// synchronously on the main thread, so it must not be allowed to grow forever.
const MAX_RECORDS = 300

// Chromium fires `updated` on every network chunk. Publishing each one would
// push hundreds of IPC messages per second per download; the tray only needs to
// look live.
const PUBLISH_INTERVAL_MS = 150

/** On-disk shape: the record minus the fields recomputed on every read. */
type StoredRecord = Omit<DownloadRecord, 'exists' | 'canResume'>

function downloadsPath(): string {
  return join(app.getPath('userData'), 'browser', 'downloads.json')
}

let cache: StoredRecord[] | null = null

/** Live DownloadItems, keyed by our record id — only in-flight ones are here. */
const live = new Map<string, DownloadItem>()

type Listener = (snapshot: DownloadsSnapshot) => void
const listeners = new Set<Listener>()

let publishTimer: ReturnType<typeof setTimeout> | null = null

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function hostOf(url: string): string {
  try {
    const u = new URL(url)
    return u.protocol === 'data:' ? 'data:' : u.hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

const STATES: ReadonlySet<string> = new Set<DownloadState>([
  'progressing', 'paused', 'completed', 'cancelled', 'interrupted',
])

function pickRecord(v: unknown): StoredRecord | null {
  if (!v || typeof v !== 'object') return null
  const r = v as Record<string, unknown>
  if (typeof r.fileName !== 'string' || !r.fileName) return null
  const rawState = typeof r.state === 'string' ? r.state : 'interrupted'
  // A process restart ends any in-flight download; see the file header.
  const state = (STATES.has(rawState) ? rawState : 'interrupted') as DownloadState
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId(),
    url: typeof r.url === 'string' ? r.url.slice(0, 2048) : '',
    fileName: r.fileName.slice(0, 260),
    path: typeof r.path === 'string' && r.path ? r.path : null,
    mimeType: typeof r.mimeType === 'string' ? r.mimeType.slice(0, 200) : '',
    state: state === 'progressing' || state === 'paused' ? 'interrupted' : state,
    receivedBytes: Number.isFinite(r.receivedBytes) ? Number(r.receivedBytes) : 0,
    totalBytes: Number.isFinite(r.totalBytes) ? Number(r.totalBytes) : 0,
    startedAt: Number.isFinite(r.startedAt) ? Number(r.startedAt) : Date.now(),
    finishedAt: Number.isFinite(r.finishedAt) ? Number(r.finishedAt) : null,
    host: typeof r.host === 'string' ? r.host : hostOf(typeof r.url === 'string' ? r.url : ''),
    ...(typeof r.error === 'string' ? { error: r.error.slice(0, 300) } : {}),
  }
}

function load(): StoredRecord[] {
  if (cache) return cache
  try {
    const path = downloadsPath()
    if (!existsSync(path)) { cache = []; return cache }
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    if (!Array.isArray(parsed)) { cache = []; return cache }
    const out: StoredRecord[] = []
    for (const raw of parsed) {
      const item = pickRecord(raw)
      if (item) out.push(item)
      if (out.length >= MAX_RECORDS) break
    }
    cache = out
  } catch {
    // Corrupt store: start empty rather than wedging the browser on every open.
    cache = []
  }
  return cache
}

function persist(): void {
  if (!cache) return
  try {
    mkdirSync(join(app.getPath('userData'), 'browser'), { recursive: true })
    writeFileSync(downloadsPath(), JSON.stringify(cache, null, 2))
  } catch {
    // A tray that cannot write its history is still a usable tray this session.
  }
}

/**
 * Newest-first insert. In-flight rows are never trimmed away by the cap — losing
 * the record of a running download would orphan its DownloadItem in `live`.
 */
function insert(record: StoredRecord): void {
  const list = load()
  list.unshift(record)
  if (list.length > MAX_RECORDS) {
    const running = list.filter(r => r.state === 'progressing' || r.state === 'paused')
    const finished = list.filter(r => r.state !== 'progressing' && r.state !== 'paused')
    cache = [...running, ...finished].slice(0, MAX_RECORDS)
    cache.sort((a, b) => b.startedAt - a.startedAt)
  }
  persist()
}

function find(id: string): StoredRecord | undefined {
  return load().find(r => r.id === id)
}

function update(id: string, patch: Partial<StoredRecord>): void {
  const record = find(id)
  if (!record) return
  Object.assign(record, patch)
  persist()
}

// ─── Publishing ──────────────────────────────────────────────────────────────

/** Subscribe the browser chrome (and anything else) to tray changes. */
export function onDownloadsChanged(cb: Listener): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/**
 * Coalesced broadcast. Every mutation calls this; at most one snapshot goes out
 * per PUBLISH_INTERVAL_MS, and the trailing edge always fires so the final
 * "completed" state is never the one that got dropped.
 */
function publish(): void {
  if (publishTimer) return
  publishTimer = setTimeout(() => {
    publishTimer = null
    const snapshot = listDownloads()
    for (const cb of listeners) {
      try { cb(snapshot) } catch { /* one bad subscriber must not stop the rest */ }
    }
  }, PUBLISH_INTERVAL_MS)
}

// ─── Reading ─────────────────────────────────────────────────────────────────

/**
 * `exists` is recomputed on every read rather than stored: a file deleted in
 * Explorer leaves the record untouched, and a row whose Open button fails is
 * worse than one that greys the button out.
 */
function fileExists(path: string | null): boolean {
  if (!path) return false
  try { return statSync(path).isFile() } catch { return false }
}

export function listDownloads(): DownloadsSnapshot {
  const items = load().map<DownloadRecord>(r => {
    const item = live.get(r.id)
    return {
      ...r,
      // A live item is the source of truth for its own byte counts — the stored
      // copy is only refreshed on the throttled tick.
      receivedBytes: item ? item.getReceivedBytes() : r.receivedBytes,
      totalBytes: item ? item.getTotalBytes() : r.totalBytes,
      exists: fileExists(r.path),
      canResume: item ? item.canResume() : false,
    }
  })
  return { items, canShowInFolder: true, canPause: true }
}

// ─── Tracking a live Chromium download ───────────────────────────────────────

/**
 * Adopt a DownloadItem from a session's `will-download`. The save path must
 * already be decided by the caller (or left unset for Electron's Save dialog) —
 * this only observes.
 *
 * `onFinished` exists so browser-manager can keep pushing its existing toast and
 * top-bar messages without this module reaching into the browser chrome.
 */
export function trackDownload(
  item: DownloadItem,
  onFinished?: (record: DownloadRecord) => void
): string {
  const id = newId()
  const url = item.getURL()
  const declaredPath = item.getSavePath()

  insert({
    id,
    url,
    fileName: item.getFilename() || basename(declaredPath) || 'download',
    path: declaredPath || null,
    mimeType: item.getMimeType() || '',
    state: 'progressing',
    receivedBytes: 0,
    totalBytes: item.getTotalBytes(),
    startedAt: Date.now(),
    finishedAt: null,
    host: hostOf(url),
  })
  live.set(id, item)
  publish()

  item.on('updated', (_e, state) => {
    // A "Save as…" item has no path until the dialog is answered, and the
    // filename can change with it, so both are re-read rather than trusted.
    const savePath = item.getSavePath()
    update(id, {
      state: state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing',
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      ...(savePath ? { path: savePath, fileName: basename(savePath) } : {}),
    })
    publish()
  })

  item.once('done', (_e, state) => {
    live.delete(id)
    const savePath = item.getSavePath()
    update(id, {
      state: state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted',
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes() || item.getReceivedBytes(),
      finishedAt: Date.now(),
      ...(savePath ? { path: savePath, fileName: basename(savePath) } : {}),
      ...(state === 'completed' ? {} : { error: state === 'cancelled' ? 'Cancelled' : 'The download failed' }),
    })
    publish()
    if (onFinished) {
      const record = listDownloads().items.find(r => r.id === id)
      if (record) onFinished(record)
    }
  })

  return id
}

/**
 * Record a file this app wrote itself (NFT media, a saved page, a screenshot).
 * Already complete by the time it is called, so there is nothing to track.
 */
export function recordSavedFile(o: {
  url: string
  path: string
  mimeType?: string
  bytes?: number
}): string {
  const id = newId()
  const size = o.bytes ?? sizeOf(o.path)
  insert({
    id,
    // Fully on-chain NFT art arrives as a multi-megabyte data: URL. Keeping it
    // would write the whole image into this JSON on every save, and nothing
    // needs it — Retry is http(s)-only.
    url: o.url.startsWith('data:') ? 'data:' : o.url.slice(0, 2048),
    fileName: basename(o.path),
    path: o.path,
    mimeType: o.mimeType ?? '',
    state: 'completed',
    receivedBytes: size,
    totalBytes: size,
    startedAt: Date.now(),
    finishedAt: Date.now(),
    host: hostOf(o.url),
  })
  publish()
  return id
}

function sizeOf(path: string): number {
  try { return statSync(path).size } catch { return 0 }
}

// ─── Row actions ─────────────────────────────────────────────────────────────

function fail(error: string): DownloadActionResult {
  return { ok: false, error, snapshot: listDownloads() }
}
function done(): DownloadActionResult {
  return { ok: true, snapshot: listDownloads() }
}

/** Open with the OS default handler for its type. */
export async function openDownload(id: string): Promise<DownloadActionResult> {
  const record = find(id)
  if (!record?.path) return fail('That file is no longer available.')
  if (!fileExists(record.path)) return fail('That file has been moved or deleted.')
  // A non-empty return value IS the error — shell.openPath resolves with a
  // message rather than rejecting when the OS refuses (no handler, policy).
  const error = await shell.openPath(record.path)
  return error ? fail(error) : done()
}

/** Reveal in Explorer/Finder/the file manager. */
export function showDownload(id: string): DownloadActionResult {
  const record = find(id)
  if (!record?.path) return fail('That file is no longer available.')
  if (!fileExists(record.path)) return fail('That file has been moved or deleted.')
  shell.showItemInFolder(record.path)
  return done()
}

export function openDownloadsFolder(): DownloadActionResult {
  shell.openPath(app.getPath('downloads')).catch(() => {})
  return done()
}

/**
 * Delete the file AND its row — what Chrome's "Delete" does. Kept separate from
 * removeDownload so "take it off the list" can never be the click that destroys
 * a file the user still wanted.
 */
export function deleteDownloadFile(id: string): DownloadActionResult {
  const record = find(id)
  if (!record) return fail('That download is no longer listed.')
  if (live.has(id)) return fail('That download is still running — cancel it first.')
  if (record.path && fileExists(record.path)) {
    try {
      unlinkSync(record.path)
    } catch (e) {
      return fail(e instanceof Error ? e.message : 'The file could not be deleted.')
    }
  }
  cache = load().filter(r => r.id !== id)
  persist()
  publish()
  return done()
}

/** Forget the row, leave the file where it is. */
export function removeDownload(id: string): DownloadActionResult {
  if (live.has(id)) return fail('That download is still running — cancel it first.')
  cache = load().filter(r => r.id !== id)
  persist()
  publish()
  return done()
}

/** Clear the finished rows only; running downloads keep their place. */
export function clearDownloads(): DownloadActionResult {
  cache = load().filter(r => r.state === 'progressing' || r.state === 'paused')
  persist()
  publish()
  return done()
}

export function pauseDownload(id: string): DownloadActionResult {
  const item = live.get(id)
  if (!item) return fail('That download has already finished.')
  item.pause()
  update(id, { state: 'paused' })
  publish()
  return done()
}

export function resumeDownload(id: string): DownloadActionResult {
  const item = live.get(id)
  if (!item) return fail('That download has already finished.')
  if (!item.canResume()) return fail('This download cannot be resumed — retry it instead.')
  item.resume()
  update(id, { state: 'progressing' })
  publish()
  return done()
}

export function cancelDownload(id: string): DownloadActionResult {
  const item = live.get(id)
  if (!item) return fail('That download has already finished.')
  item.cancel()
  // `done` fires from cancel() and writes the real end state; this is only so
  // the row stops claiming to be running before that lands.
  update(id, { state: 'cancelled' })
  publish()
  return done()
}

/**
 * Re-request the original URL through `wc`, which must be a dApp tab so the
 * request carries the browser session's cookies and proxy (Tor Mode included) —
 * exactly the context the first attempt had. The old row is dropped in favour of
 * the new attempt's, matching Chrome's behaviour.
 */
export function retryDownload(id: string, wc: WebContents | null): DownloadActionResult {
  const record = find(id)
  if (!record) return fail('That download is no longer listed.')
  if (!/^https?:\/\//i.test(record.url)) return fail('This download cannot be retried.')
  if (!wc || wc.isDestroyed()) return fail('Open a browser tab before retrying a download.')
  cache = load().filter(r => r.id !== id)
  persist()
  wc.downloadURL(record.url)
  publish()
  return done()
}
