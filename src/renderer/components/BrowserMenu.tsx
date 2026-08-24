/**
 * BrowserMenu.tsx — the dApp browser's hamburger menu + address-bar actions
 *
 *   AddressBarStar  — the ★ at the end of the address bar; one click bookmarks
 *                     the current page, another removes it.
 *   ShareControl    — the ⤴ next to it: copy link, email, QR code, save page,
 *                     screenshot, install as app. Same set Brave puts under
 *                     "Save and share".
 *   BrowserMenu     — the ☰ at the right of the toolbar: password manager,
 *                     bookmarks, Tor Mode (moved here from the toolbar), the
 *                     same save-and-share actions, and new tab.
 *
 * All three are CONTROLLED by BrowserApp (open/onOpen/onClose) because each one
 * is a floating dropdown over the dApp WebContentsView — see browser-ui.tsx.
 * Every action is a single main-process call that reads the ACTIVE TAB itself;
 * nothing here passes a URL back to main, so the chrome can't misidentify a page.
 */
import { useState } from 'react'
import { Dropdown, SectionLabel, Divider, MenuRow, ToolbarButton } from './browser-ui'
import { QrCode } from './QrCode'
import type { BrowserPageState, TorBrowserState } from '../types/wallet'

// ─── Icons (16px stroke set, matching the existing toolbar SVGs) ─────────────

const Ico = {
  star: (filled: boolean) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  share: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  ),
  menu: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
    </svg>
  ),
  key: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3" /></svg>,
  book: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
  copy: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
  mail: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="22,6 12,13 2,6" /></svg>,
  qr: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><line x1="14" y1="14" x2="14" y2="21" /><line x1="18" y1="14" x2="21" y2="14" /><line x1="21" y1="18" x2="21" y2="21" /></svg>,
  save: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><polyline points="17 21 17 13 7 13 7 21" /><polyline points="7 3 7 8 15 8" /></svg>,
  camera: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>,
  install: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>,
  download: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
  clock: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15.5 14" /></svg>,
  plus: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
}

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url }
}

const isWebPage = (url: string): boolean => /^https?:\/\//i.test(url)

// ─── Address-bar star ────────────────────────────────────────────────────────

/**
 * Bookmark toggle. Not an overlay — it completes instantly and returns the fresh
 * page state, so it never needs to detach the dApp view.
 */
export function AddressBarStar({ page, onPageState, onToast }: {
  page: BrowserPageState
  onPageState: (s: BrowserPageState) => void
  onToast: (message: string) => void
}) {
  const enabled = isWebPage(page.url)
  const filled = page.bookmarked

  const toggle = async () => {
    if (!enabled || !window.wallet.browserToggleBookmark) return
    const next = await window.wallet.browserToggleBookmark()
    onPageState(next)
    onToast(next.bookmarked ? 'Bookmark added' : 'Bookmark removed')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={!enabled}
      aria-pressed={filled}
      title={!enabled ? 'Nothing to bookmark' : filled ? 'Remove bookmark' : 'Bookmark this page'}
      aria-label={filled ? 'Remove bookmark' : 'Bookmark this page'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: 24, height: 24, padding: 0, flexShrink: 0,
        background: 'none', border: 'none', borderRadius: 6,
        color: !enabled ? 'var(--text-muted)' : filled ? '#f5b301' : 'var(--text-secondary)',
        cursor: enabled ? 'pointer' : 'default',
        transition: 'background 0.15s, color 0.15s',
      }}
      onMouseEnter={e => { if (enabled) e.currentTarget.style.background = 'var(--surface-raised)' }}
      onMouseLeave={e => { e.currentTarget.style.background = 'none' }}
    >
      {Ico.star(filled)}
    </button>
  )
}

// ─── Share (address bar) ─────────────────────────────────────────────────────

export function ShareControl({ page, open, onOpen, onClose, onPageState, onToast }: {
  page: BrowserPageState
  open: boolean
  onOpen: () => void
  onClose: () => void
  onPageState: (s: BrowserPageState) => void
  onToast: (message: string) => void
}) {
  const enabled = isWebPage(page.url)

  return (
    <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => (open ? onClose() : onOpen())}
        disabled={!enabled}
        title={enabled ? 'Share this page' : 'Nothing to share'}
        aria-label="Share this page"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 24, height: 24, padding: 0, flexShrink: 0,
          background: open ? 'var(--surface-raised)' : 'none', border: 'none', borderRadius: 6,
          color: !enabled ? 'var(--text-muted)' : open ? 'var(--accent)' : 'var(--text-secondary)',
          cursor: enabled ? 'pointer' : 'default',
          transition: 'background 0.15s, color 0.15s',
          position: 'relative', zIndex: open ? 50 : undefined,
        }}
        onMouseEnter={e => { if (enabled) e.currentTarget.style.background = 'var(--surface-raised)' }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.background = 'none' }}
      >
        {Ico.share}
      </button>

      {open && (
        <Dropdown width={272} onClose={onClose}>
          <ShareActions page={page} onPageState={onPageState} onToast={onToast} onDone={onClose} />
        </Dropdown>
      )}
    </div>
  )
}

/**
 * The "Save and share" action list, shared by the address-bar share button and
 * the hamburger menu so the two can never offer different things.
 */
function ShareActions({ page, onPageState, onToast, onDone, webAppsSupported = true }: {
  page: BrowserPageState
  onPageState: (s: BrowserPageState) => void
  onToast: (message: string) => void
  onDone: () => void
  webAppsSupported?: boolean
}) {
  const [showQr, setShowQr] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return
    setBusy(key)
    try { await fn() } finally { setBusy(null) }
  }

  const copyLink = () => run('copy', async () => {
    const r = await window.wallet.browserCopyLink?.()
    onToast(r?.ok ? 'Link copied' : r?.error ?? 'Could not copy the link')
    onDone()
  })

  const shareEmail = () => run('mail', async () => {
    const r = await window.wallet.browserShareByEmail?.()
    if (!r?.ok) onToast(r?.error ?? 'Could not open your mail app')
    onDone()
  })

  const savePage = () => run('save', async () => {
    // The OS save dialog is modal on the browser window; close the menu first so
    // it doesn't linger behind the dialog.
    onDone()
    const r = await window.wallet.browserSavePage?.()
    if (r?.ok) onToast('Page saved')
    else if (r?.error) onToast(r.error)
  })

  const screenshot = () => run('shot', async () => {
    const r = await window.wallet.browserCapturePage?.()
    onToast(r?.ok ? 'Screenshot saved to Downloads' : r?.error ?? 'Could not capture the page')
    onDone()
  })

  const install = () => run('install', async () => {
    const r = await window.wallet.browserInstallWebApp?.()
    if (r?.ok) {
      onToast('Installed — find it in your Start menu')
      const next = await window.wallet.browserGetPageState?.()
      if (next) onPageState(next)
    } else {
      onToast(r?.error ?? 'Could not install this page')
    }
    onDone()
  })

  return (
    <>
      <SectionLabel>Save and share</SectionLabel>
      <MenuRow icon={Ico.copy} label={busy === 'copy' ? 'Copying…' : 'Copy link'} hint={hostOf(page.url)} onClick={copyLink} />
      <MenuRow icon={Ico.mail} label="Share by email" onClick={shareEmail} />
      <MenuRow
        icon={Ico.qr}
        label="Create QR code"
        trailing={showQr ? '▴' : '▾'}
        onClick={() => setShowQr(v => !v)}
        active={showQr}
      />
      {showQr && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 0 10px' }}>
          <QrCode value={page.url} size={168} />
        </div>
      )}

      <Divider />
      <MenuRow icon={Ico.save} label={busy === 'save' ? 'Saving…' : 'Save page as…'} onClick={savePage} />
      <MenuRow icon={Ico.camera} label={busy === 'shot' ? 'Capturing…' : 'Screenshot'} onClick={screenshot} />

      <Divider />
      <MenuRow
        icon={Ico.install}
        label={page.installed ? 'Reinstall as app' : `Install ${hostOf(page.url)}…`}
        hint={webAppsSupported
          ? page.installed ? 'Already in your Start menu' : 'Opens in MagicMoney Browser'
          : 'Not available on this platform'}
        onClick={install}
        disabled={!webAppsSupported || busy === 'install'}
      />
    </>
  )
}

// ─── Hamburger ───────────────────────────────────────────────────────────────

export function BrowserMenu({
  page, tor, open, onOpen, onClose, onPageState, onToast,
  onOpenBookmarks, onOpenPasswords, onOpenDownloads, onOpenHistory,
  activeDownloads, historyPaused, onSetTor, webAppsSupported,
}: {
  page: BrowserPageState
  tor: TorBrowserState
  open: boolean
  onOpen: () => void
  onClose: () => void
  onPageState: (s: BrowserPageState) => void
  onToast: (message: string) => void
  onOpenBookmarks: () => void
  onOpenPasswords: () => void
  onOpenDownloads: () => void
  onOpenHistory: () => void
  /** In-flight count, so the row reads like Chrome's while something is saving. */
  activeDownloads: number
  /** True while Tor Mode is suppressing history — said on the row, not hidden. */
  historyPaused: boolean
  onSetTor: (enabled: boolean) => void
  webAppsSupported: boolean
}) {
  const torBusy = tor.status === 'connecting'
  const torColor = tor.status === 'connected' ? '#22c55e' : tor.status === 'error' ? '#ef4444' : 'var(--text-muted)'
  const torHint = torBusy ? 'Connecting…' : tor.status === 'error' ? 'Blocked — traffic is not flowing' : tor.enabled ? 'On' : 'Off'

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <ToolbarButton open={open} title="Menu" ariaLabel="Browser menu" onClick={() => (open ? onClose() : onOpen())}>
        {Ico.menu}
        {tor.enabled && (
          <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: '50%', background: torColor }} />
        )}
      </ToolbarButton>

      {open && (
        <Dropdown width={276} onClose={onClose}>
          <MenuRow
            icon={Ico.plus}
            label="New tab"
            onClick={() => { window.wallet.browserNewTab(); onClose() }}
          />

          <Divider />
          <MenuRow
            icon={Ico.key}
            label="Password manager"
            hint={page.passwordsUnlocked ? 'Unlocked' : 'Locked'}
            onClick={() => { onClose(); onOpenPasswords() }}
          />
          <MenuRow
            icon={Ico.book}
            label="Bookmarks"
            onClick={() => { onClose(); onOpenBookmarks() }}
          />
          <MenuRow
            icon={Ico.clock}
            label="History"
            hint={historyPaused ? 'Paused — Tor Mode is on' : undefined}
            trailing="Ctrl+H"
            onClick={() => { onClose(); onOpenHistory() }}
          />
          <MenuRow
            icon={Ico.download}
            label="Downloads"
            hint={activeDownloads > 0
              ? `${activeDownloads} in progress`
              : undefined}
            trailing="Ctrl+J"
            onClick={() => { onClose(); onOpenDownloads() }}
          />

          <Divider />
          <SectionLabel>Privacy</SectionLabel>
          <MenuRow
            icon={<span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>🧅</span>}
            label={tor.enabled ? 'Tor Mode' : 'Turn on Tor Mode'}
            hint={torHint}
            active={tor.enabled}
            disabled={torBusy}
            trailing={<span style={{ width: 7, height: 7, borderRadius: '50%', background: torColor, display: 'inline-block' }} />}
            onClick={() => { onSetTor(!tor.enabled); onClose() }}
          />

          <Divider />
          <ShareActions
            page={page}
            onPageState={onPageState}
            onToast={onToast}
            onDone={onClose}
            webAppsSupported={webAppsSupported}
          />
        </Dropdown>
      )}
    </div>
  )
}
