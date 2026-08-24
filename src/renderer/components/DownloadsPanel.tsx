/**
 * DownloadsPanel.tsx — the dApp browser's downloads tray
 *
 * The same panel on every target that has a browser of its own (Electron,
 * Android, iOS). It talks only to `window.wallet.browser*Download*`, which each
 * platform bridge implements over its own machinery — Chromium DownloadItems in
 * the Electron main process, DownloadManager on Android, WKDownload on iOS.
 * Nothing here knows or cares which.
 *
 * Two rules it inherits from the other browser panels:
 *   • it renders inside BrowserApp's content div while the active dApp view is
 *     detached (see browser-ui.tsx), so it may be full-bleed or `floating`;
 *   • it never holds a path. Rows are addressed by id and main resolves the
 *     path, so the chrome can't ask for a file outside the tray to be opened
 *     or deleted.
 *
 * Live rows are pushed, not polled: main broadcasts a fresh snapshot on every
 * change (throttled), so an in-flight download animates without this component
 * running a timer.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ContentPanel, EmptyState, Notice, fieldStyle } from './browser-ui'
import { RowButton } from './BookmarksPanel'
import type { DownloadActionResult, DownloadRecord, DownloadsSnapshot } from '../types/wallet'

const EMPTY: DownloadsSnapshot = { items: [], canShowInFolder: false, canPause: false }

// ─── Formatting ──────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  const value = n / 1024 ** i
  return `${i === 0 ? Math.round(value) : value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`
}

function formatWhen(ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`
  const date = new Date(ts)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  if (sameDay) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * The status line under the file name — the one place a row explains itself, so
 * every state has to produce a sentence rather than falling through to blank.
 */
function statusLine(d: DownloadRecord): string {
  const size = d.totalBytes > 0 ? formatBytes(d.totalBytes) : null
  switch (d.state) {
    case 'progressing':
      return size
        ? `${formatBytes(d.receivedBytes)} of ${size}`
        : `${formatBytes(d.receivedBytes)} downloaded`
    case 'paused':
      return size ? `Paused — ${formatBytes(d.receivedBytes)} of ${size}` : 'Paused'
    case 'cancelled':
      return 'Cancelled'
    case 'interrupted':
      return d.error || 'Failed'
    case 'completed':
      if (!d.exists) return 'Deleted or moved'
      return `${formatBytes(d.totalBytes || d.receivedBytes)} · ${formatWhen(d.finishedAt ?? d.startedAt)}`
  }
}

/** Coarse type badge from the extension — enough to tell a PDF from a photo. */
function kindIcon(fileName: string): string {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  if (/^(png|jpe?g|gif|webp|svg|avif|bmp|tiff?|ico)$/.test(ext)) return '🖼️'
  if (/^(mp4|webm|mov|mkv|avi|m4v)$/.test(ext)) return '🎞️'
  if (/^(mp3|wav|ogg|flac|m4a|aac)$/.test(ext)) return '🎵'
  if (ext === 'pdf') return '📕'
  if (/^(zip|rar|7z|tar|gz|bz2|xz)$/.test(ext)) return '🗜️'
  if (/^(exe|msi|dmg|apk|deb|rpm|appimage)$/.test(ext)) return '⚙️'
  if (/^(html?|json|csv|txt|md|xml)$/.test(ext)) return '📄'
  return '📦'
}

const isRunning = (d: DownloadRecord): boolean => d.state === 'progressing' || d.state === 'paused'

// ─── Panel ───────────────────────────────────────────────────────────────────

export function DownloadsPanel({ onClose, onToast, floating, onDismiss, emptyBody }: {
  onClose: () => void
  onToast: (message: string) => void
  /** Anchored card (desktop) rather than the full-bleed sheet (touch targets). */
  floating?: boolean
  onDismiss?: () => void
  /** Android/iOS override the "where do files go" sentence in the empty state. */
  emptyBody?: string
}) {
  const [snapshot, setSnapshot] = useState<DownloadsSnapshot>(EMPTY)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState<{ tone: 'info' | 'error' | 'success'; text: string } | null>(null)
  // Two-step delete: unlike every other row action here, this one destroys a
  // file, so it asks first. Holds the id awaiting confirmation.
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Mobile bridges resolve their list asynchronously; until the first snapshot
  // lands, "no downloads yet" would be a lie.
  const [loaded, setLoaded] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await window.wallet.browserListDownloads?.()
      if (next) setSnapshot(next)
    } catch {
      setNotice({ tone: 'error', text: 'The downloads list could not be read.' })
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  // Live updates pushed from main. Kept in a ref-free effect because the
  // callback only ever calls setState — nothing it closes over can go stale.
  useEffect(() => {
    const onPush = (next: DownloadsSnapshot) => { setSnapshot(next); setLoaded(true) }
    window.wallet.onBrowserDownloads?.(onPush)
    return () => window.wallet.offBrowserDownloads?.(onPush)
  }, [])

  // A platform with no push channel (or one that drops events while the panel
  // was closed) still needs the running rows to move, so poll — but ONLY while
  // something is actually in flight, never on an idle list.
  const anyRunning = snapshot.items.some(isRunning)
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => { void refreshRef.current() }, 900)
    return () => clearInterval(t)
  }, [anyRunning])

  /** Every row action funnels through here so one place owns the fresh snapshot. */
  const run = useCallback(async (
    action: ((id: string) => Promise<DownloadActionResult> | undefined) | undefined,
    id: string,
    successText?: string
  ) => {
    if (!action || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await action(id)
      if (!result) return
      setSnapshot(result.snapshot)
      setLoaded(true)
      if (result.ok) { if (successText) onToast(successText) }
      else setNotice({ tone: 'error', text: result.error ?? 'That did not work.' })
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'That did not work.' })
    } finally {
      setBusy(false)
    }
  }, [busy, onToast])

  const clearAll = async () => {
    if (busy) return
    setBusy(true)
    try {
      const result = await window.wallet.browserClearDownloads?.()
      if (result) { setSnapshot(result.snapshot); onToast('Download history cleared') }
    } finally {
      setBusy(false)
    }
  }

  const openFolder = async () => {
    const result = await window.wallet.browserOpenDownloadsFolder?.()
    if (result && !result.ok) setNotice({ tone: 'error', text: result.error ?? 'Could not open the Downloads folder.' })
  }

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      onToast('Download link copied')
    } catch {
      setNotice({ tone: 'error', text: 'Could not copy that link.' })
    }
  }

  const q = query.trim().toLowerCase()
  const shown = useMemo(
    () => (q
      ? snapshot.items.filter(d => d.fileName.toLowerCase().includes(q) || d.host.toLowerCase().includes(q))
      : snapshot.items),
    [snapshot.items, q]
  )

  const runningCount = snapshot.items.filter(isRunning).length
  const finishedCount = snapshot.items.length - runningCount

  return (
    <ContentPanel
      title="Downloads"
      subtitle={runningCount > 0
        ? `${runningCount} in progress · ${finishedCount} finished`
        : `${snapshot.items.length} file${snapshot.items.length === 1 ? '' : 's'}`}
      onClose={onClose}
      floating={floating}
      // Never dismiss on an outside click while a delete is half-confirmed —
      // reopening would show the same row with the confirmation lost.
      onDismiss={confirmDelete ? undefined : onDismiss}
      width={480}
      actions={
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {window.wallet.browserOpenDownloadsFolder && (
            <RowButton label="Open folder" onClick={() => void openFolder()} />
          )}
          {finishedCount > 0 && <RowButton label="Clear list" onClick={() => void clearAll()} />}
        </div>
      }
    >
      {snapshot.items.length > 4 && (
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search downloads"
          spellCheck={false}
          style={{ ...fieldStyle, marginBottom: 12 }}
        />
      )}

      {shown.length === 0 ? (
        <EmptyState
          icon="⬇️"
          title={!loaded ? 'Loading…' : snapshot.items.length === 0 ? 'No downloads yet' : 'No matches'}
          body={!loaded
            ? 'Reading your download history.'
            : snapshot.items.length === 0
              ? emptyBody ?? 'Files you download in this browser appear here — along with saved pages, screenshots and NFT artwork. They go to your Downloads folder.'
              : 'Nothing here matches that search.'}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {shown.map(d => (
            <DownloadRow
              key={d.id}
              item={d}
              snapshot={snapshot}
              busy={busy}
              confirming={confirmDelete === d.id}
              onConfirmDelete={() => setConfirmDelete(d.id)}
              onCancelConfirm={() => setConfirmDelete(null)}
              onAction={run}
              onCopyLink={copyLink}
              onDeleted={() => setConfirmDelete(null)}
            />
          ))}
        </div>
      )}

      {snapshot.error && <Notice tone="error">{snapshot.error}</Notice>}
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
    </ContentPanel>
  )
}

// ─── One row ─────────────────────────────────────────────────────────────────

function DownloadRow({
  item, snapshot, busy, confirming, onConfirmDelete, onCancelConfirm, onAction, onCopyLink, onDeleted,
}: {
  item: DownloadRecord
  snapshot: DownloadsSnapshot
  busy: boolean
  confirming: boolean
  onConfirmDelete: () => void
  onCancelConfirm: () => void
  onAction: (
    action: ((id: string) => Promise<DownloadActionResult> | undefined) | undefined,
    id: string,
    successText?: string
  ) => void | Promise<void>
  onCopyLink: (url: string) => void
  onDeleted: () => void
}) {
  const w = window.wallet
  const running = isRunning(item)
  const failed = item.state === 'cancelled' || item.state === 'interrupted'
  const percent = item.totalBytes > 0
    ? Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100))
    : null

  const openable = item.state === 'completed' && item.exists
  const retryable = /^https?:\/\//i.test(item.url) && (failed || (item.state === 'completed' && !item.exists))

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px', borderRadius: 8, transition: 'background 0.12s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 22, height: 22, flexShrink: 0, fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          opacity: item.state === 'completed' && !item.exists ? 0.45 : 1,
        }}
      >
        {kindIcon(item.fileName)}
      </span>

      <div
        onClick={openable ? () => void onAction(w.browserOpenDownload, item.id) : undefined}
        style={{ flex: 1, minWidth: 0, cursor: openable ? 'pointer' : 'default' }}
        title={item.path ?? item.url}
      >
        <div style={{
          fontSize: 12, fontWeight: 600,
          color: failed ? 'var(--text-muted)' : 'var(--text-primary)',
          textDecoration: item.state === 'completed' && !item.exists ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.fileName}
        </div>
        <div style={{
          fontSize: 10, color: failed ? '#ef4444' : 'var(--text-muted)',
          fontFamily: 'var(--font-mono)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.host ? `${item.host} · ` : ''}{statusLine(item)}
        </div>

        {running && (
          <div
            role="progressbar"
            aria-valuenow={percent ?? undefined}
            aria-label={`Downloading ${item.fileName}`}
            style={{
              marginTop: 5, height: 3, borderRadius: 999, overflow: 'hidden',
              background: 'var(--surface-raised)',
            }}
          >
            <div
              // No Content-Length ⇒ no honest percentage; show a full-width dim
              // bar rather than a number the server never gave us.
              style={{
                height: '100%', borderRadius: 999,
                background: item.state === 'paused' ? 'var(--text-muted)' : 'var(--accent)',
                width: percent === null ? '100%' : `${percent}%`,
                opacity: percent === null ? 0.35 : 1,
                transition: 'width 0.25s linear',
              }}
            />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
        {confirming ? (
          <>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', alignSelf: 'center' }}>Delete file?</span>
            <RowButton
              label="Delete"
              ariaLabel={`Delete ${item.fileName} permanently`}
              danger
              onClick={() => { void onAction(w.browserDeleteDownload, item.id, 'File deleted'); onDeleted() }}
            />
            <RowButton label="Keep" ariaLabel={`Keep ${item.fileName}`} onClick={onCancelConfirm} />
          </>
        ) : running ? (
          <>
            {snapshot.canPause && (
              item.state === 'paused'
                ? <RowButton label="Resume" ariaLabel={`Resume ${item.fileName}`} onClick={() => void onAction(w.browserResumeDownload, item.id)} />
                : <RowButton label="Pause" ariaLabel={`Pause ${item.fileName}`} onClick={() => void onAction(w.browserPauseDownload, item.id)} />
            )}
            <RowButton label="Cancel" ariaLabel={`Cancel ${item.fileName}`} danger onClick={() => void onAction(w.browserCancelDownload, item.id)} />
          </>
        ) : (
          <>
            {openable && <RowButton label="Open" ariaLabel={`Open ${item.fileName}`} onClick={() => void onAction(w.browserOpenDownload, item.id)} />}
            {openable && snapshot.canShowInFolder && (
              <RowButton label="Show" ariaLabel={`Show ${item.fileName} in folder`} onClick={() => void onAction(w.browserShowDownload, item.id)} />
            )}
            {retryable && <RowButton label="Retry" ariaLabel={`Retry ${item.fileName}`} onClick={() => void onAction(w.browserRetryDownload, item.id)} />}
            {item.url && <RowButton label="Copy link" ariaLabel={`Copy the download link for ${item.fileName}`} onClick={() => onCopyLink(item.url)} />}
            {item.exists && item.canDelete !== false
              ? <RowButton label="Delete" ariaLabel={`Delete ${item.fileName}`} danger onClick={onConfirmDelete} disabled={busy} />
              : <RowButton label="Remove" ariaLabel={`Remove ${item.fileName} from the list`} danger onClick={() => void onAction(w.browserRemoveDownload, item.id)} />}
          </>
        )}
      </div>
    </div>
  )
}
