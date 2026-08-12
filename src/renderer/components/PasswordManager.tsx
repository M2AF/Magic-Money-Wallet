/**
 * PasswordManager.tsx — saved website logins for the dApp browser
 *
 * A ContentPanel in the browser chrome — anchored card on desktop (`floating`,
 * so it reads as a dropdown from the ☰ it was opened from), full-bleed sheet on
 * the touch targets, which have nowhere smaller to put it. Three states:
 *   locked  — asks for the wallet password (the vault is encrypted under it)
 *   list    — search, reveal, copy, edit, delete, fill-on-this-page, import
 *   editor  — add / edit one entry
 *
 * Security posture mirrored from the main process (password-vault.ts):
 *   • plaintext passwords are fetched one at a time, only on an explicit click,
 *     and are never held in this component's state longer than the row is open
 *   • "Fill on this page" is host-checked in MAIN against the active tab, so a
 *     page that navigates mid-click cannot receive another site's credential
 *   • locking the wallet locks this too — the panel re-renders to the password
 *     prompt because passwordsStatus() flips back to unlocked: false
 *   • biometric unlock (Windows Hello / Touch ID / Face ID / Android) is an
 *     ADDITIONAL path, never a replacement — the password below always still
 *     works, and the control is hidden wherever no ceremony could run
 */
import { useCallback, useEffect, useState } from 'react'
import { ContentPanel, EmptyState, Field, Notice, SiteIcon, fieldStyle } from './browser-ui'
import { ImportRow, RowButton } from './BookmarksPanel'
import { bioMethodLabel } from '../types/wallet'
import type { ImportSource, PasswordBioStatus, PasswordSummary, PasswordVaultStatus } from '../types/wallet'

interface Draft {
  id?: string
  url: string
  username: string
  password: string
  note: string
}

const emptyDraft = (url = ''): Draft => ({ url, username: '', password: '', note: '' })

const DESKTOP_IMPORT_EMPTY =
  'No Chrome, Edge, Brave, Vivaldi or Chromium profile was found on this computer.'

export function PasswordManager({ currentHost, currentUrl, onClose, onToast, onChanged, importEmptyText, floating }: {
  currentHost: string
  currentUrl: string
  onClose: () => void
  onToast: (message: string) => void
  /** Lets BrowserApp refresh its page state (the menu shows locked/unlocked). */
  onChanged: () => void
  /**
   * Shown when no importable browser profile exists. Android overrides it: an
   * app sandbox can never read another browser's profile, so listing desktop
   * browsers there would just be misleading.
   */
  importEmptyText?: string
  /** Desktop: render as the anchored dropdown card instead of a full sheet. */
  floating?: boolean
}) {
  const [status, setStatus] = useState<PasswordVaultStatus | null>(null)
  const [entries, setEntries] = useState<PasswordSummary[]>([])
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [sources, setSources] = useState<ImportSource[]>([])
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'error' | 'success'; text: string } | null>(null)
  // null = this build has no biometric bridge at all (the extension), or the
  // probe failed. Either way no control is shown.
  const [bio, setBio] = useState<PasswordBioStatus | null>(null)
  const [bioBusy, setBioBusy] = useState(false)

  const loadList = useCallback(async () => {
    const list = await window.wallet.passwordsList?.()
    if (list) setEntries(list)
  }, [])

  /**
   * Re-probe after every ceremony: an enrollment can vanish underneath us when
   * the platform loses its key (TPM reset, changed fingerprint), in which case
   * main self-heals and the control must stop offering an unlock that can't work.
   */
  const refreshBio = useCallback(async () => {
    try {
      setBio(await window.wallet.passwordsBioStatus?.() ?? null)
    } catch {
      setBio(null)
    }
  }, [])

  useEffect(() => {
    window.wallet.passwordsStatus?.().then(async s => {
      setStatus(s)
      if (s.unlocked) await loadList()
    }).catch(() => {})
    window.wallet.passwordsImportSources?.()
      .then(list => setSources(list.filter(s => s.hasPasswords)))
      .catch(() => setSources([]))
    void refreshBio()
  }, [loadList, refreshBio])

  const lock = async () => {
    const s = await window.wallet.passwordsLock?.()
    if (s) setStatus(s)
    setEntries([])
    setRevealed({})
    setDraft(null)
    onChanged()
  }

  // ── Locked ────────────────────────────────────────────────────────────────
  if (!status?.unlocked) {
    return (
      <ContentPanel
        title="Password manager"
        subtitle="Saved website logins"
        onClose={onClose}
        floating={floating}
        // No outside-dismiss here: the form is collecting a typed password.
      >
        <UnlockForm
          status={status}
          bio={bio}
          onBioChanged={refreshBio}
          onUnlocked={async s => {
            setStatus(s)
            await loadList()
            onChanged()
          }}
        />
      </ContentPanel>
    )
  }

  // ── Biometric enrollment (only reachable with the vault already open, which
  // is what makes the cached password available to wrap) ────────────────────
  const setBiometric = async (on: boolean) => {
    if (bioBusy) return
    setBioBusy(true)
    setNotice(null)
    const label = bioMethodLabel(bio?.method)
    try {
      if (on) await window.wallet.passwordsBioEnroll?.()
      else await window.wallet.passwordsBioRemove?.()
      setNotice({
        tone: 'success',
        text: on
          ? `${label} will now open your saved passwords. Your wallet password still works too.`
          : `${label} is off for your saved passwords.`,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // Cancelling a prompt is a normal outcome, not an error worth shouting about.
      if (!/cancel/i.test(msg)) setNotice({ tone: 'error', text: msg.replace(/^Error:\s*/, '') })
    } finally {
      await refreshBio()
      setBioBusy(false)
    }
  }

  // ── Editor ────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!draft) return
    try {
      const list = await window.wallet.passwordsSave?.({
        id: draft.id,
        url: draft.url,
        username: draft.username,
        password: draft.password,
        note: draft.note || undefined,
      })
      if (list) setEntries(list)
      setDraft(null)
      setNotice({ tone: 'success', text: 'Saved.' })
      onChanged()
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Could not save that login' })
    }
  }

  const remove = async (id: string) => {
    try {
      const list = await window.wallet.passwordsDelete?.(id)
      if (list) setEntries(list)
      setRevealed(r => { const next = { ...r }; delete next[id]; return next })
      onChanged()
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Could not delete that login' })
    }
  }

  const toggleReveal = async (id: string) => {
    if (revealed[id] !== undefined) {
      setRevealed(r => { const next = { ...r }; delete next[id]; return next })
      return
    }
    try {
      const secret = await window.wallet.passwordsReveal?.(id)
      if (typeof secret === 'string') setRevealed(r => ({ ...r, [id]: secret }))
    } catch (e) {
      setNotice({ tone: 'error', text: e instanceof Error ? e.message : 'Could not read that password' })
    }
  }

  const copy = async (id: string) => {
    try {
      await window.wallet.passwordsCopy?.(id)
      onToast('Password copied')
    } catch {
      onToast('Could not copy that password')
    }
  }

  const fill = async (id: string) => {
    const r = await window.wallet.browserFillPassword?.(id)
    if (r?.ok) { onToast('Filled on this page'); onClose() }
    else onToast(r?.error ?? 'Could not fill this page')
  }

  /** Shared tail for both import paths (browser profile and CSV file). */
  const runImport = async (doImport: () => Promise<import('../types/wallet').PasswordImportSummary | undefined>, unreadableHint: string) => {
    if (importing) return
    setImporting(true)
    setNotice(null)
    try {
      const result = await doImport()
      if (!result || result.canceled) return
      if (result.error) { setNotice({ tone: 'error', text: result.error }); return }
      await loadList()
      const parts = [`Imported ${result.added} login${result.added === 1 ? '' : 's'}`]
      if (result.skipped) parts.push(`${result.skipped} already saved`)
      if (result.unreadable) parts.push(`${result.unreadable} ${unreadableHint}`)
      setNotice({ tone: result.added > 0 ? 'success' : 'info', text: `${parts.join(' · ')}.` })
      onChanged()
    } finally {
      setImporting(false)
    }
  }

  const importFrom = (sourceId: string) => runImport(
    () => window.wallet.passwordsImport?.(sourceId) ?? Promise.resolve(undefined),
    // Chrome 127+ writes app-bound ("v20") blobs that only Chrome can open —
    // say so rather than silently importing fewer than the user expects.
    'could not be decrypted (app-bound encryption — export them from that browser as CSV instead)'
  )

  const importCsv = () => runImport(
    () => window.wallet.passwordsImportCsv?.() ?? Promise.resolve(undefined),
    'rows had no URL or password and were skipped'
  )

  const q = query.trim().toLowerCase()
  const shown = q ? entries.filter(e => e.host.includes(q) || e.username.toLowerCase().includes(q)) : entries
  const forThisSite = currentHost
    ? entries.filter(e => e.host === currentHost || currentHost.endsWith(`.${e.host}`) || e.host.endsWith(`.${currentHost}`))
    : []

  return (
    <ContentPanel
      title="Password manager"
      subtitle={`${entries.length} saved login${entries.length === 1 ? '' : 's'} · encrypted with your wallet password`}
      onClose={onClose}
      floating={floating}
      // Clicking the page behind closes the list, exactly like the ☰ menu — but
      // never while the editor is up, or a stray click discards a typed entry.
      onDismiss={draft ? undefined : onClose}
      actions={
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <RowButton label="Add" onClick={() => setDraft(emptyDraft(currentUrl))} />
          {/*
            In the header, not down with the import strip: a vault with hundreds
            of logins puts anything below the list far off-screen, and this is a
            one-time control the user has to be able to FIND.
          */}
          {bio?.supported && (
            <RowButton
              label={bioBusy
                ? 'Working…'
                : bio.enrolled
                  ? `${bioMethodLabel(bio.method)} — On`
                  : `Turn on ${bioMethodLabel(bio.method)}`}
              onClick={() => { if (!bioBusy) void setBiometric(!bio.enrolled) }}
            />
          )}
          <RowButton label="Lock" onClick={() => void lock()} />
        </div>
      }
    >
      {draft ? (
        <Editor
          draft={draft}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={save}
        />
      ) : (
        <>
          {forThisSite.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{
                fontSize: 10, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
                color: 'var(--text-muted)', marginBottom: 6,
              }}>
                For {currentHost}
              </div>
              {forThisSite.map(e => (
                <div key={`site-${e.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px', borderRadius: 8, background: 'var(--accent-dim)' }}>
                  <SiteIcon url={e.url} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                      {e.username || '(no username)'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{e.host}</div>
                  </div>
                  <RowButton label="Fill on this page" onClick={() => void fill(e.id)} />
                </div>
              ))}
            </div>
          )}

          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by site or username"
            spellCheck={false}
            style={{ ...fieldStyle, marginBottom: 12 }}
          />

          {shown.length === 0 ? (
            <EmptyState
              icon="🔐"
              title={entries.length === 0 ? 'No saved passwords' : 'No matches'}
              body={entries.length === 0
                ? 'Add a login with the Add button, or import the ones you already have from Chrome, Edge, Brave or a CSV export below. They are encrypted with your wallet password and stored only on this computer.'
                : 'Nothing here matches that search.'}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {shown.map(e => (
                <div
                  key={e.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', borderRadius: 8 }}
                  onMouseEnter={ev => { ev.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)' }}
                  onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent' }}
                >
                  <SiteIcon url={e.url} />
                  {/* title= matters in the narrow card: long hosts ellipsize. */}
                  <div style={{ flex: 1, minWidth: 0 }} title={`${e.host}${e.username ? ` · ${e.username}` : ''}`}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.host}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.username || '(no username)'}
                      {revealed[e.id] !== undefined && ` · ${revealed[e.id]}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <RowButton label={revealed[e.id] !== undefined ? 'Hide' : 'Show'} onClick={() => void toggleReveal(e.id)} />
                    <RowButton label="Copy" onClick={() => void copy(e.id)} />
                    <RowButton
                      label="Edit"
                      onClick={async () => {
                        try {
                          const secret = await window.wallet.passwordsReveal?.(e.id)
                          setDraft({ id: e.id, url: e.url, username: e.username, password: secret ?? '', note: e.note ?? '' })
                        } catch {
                          setNotice({ tone: 'error', text: 'Could not open that login for editing' })
                        }
                      }}
                    />
                    <RowButton label="Delete" danger onClick={() => void remove(e.id)} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <ImportRow
            sources={sources}
            busy={importing}
            label="Import passwords from"
            emptyText={importEmptyText ?? DESKTOP_IMPORT_EMPTY}
            onPick={importFrom}
            extra={{ label: 'CSV file…', onClick: () => void importCsv() }}
          />
          {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        </>
      )}
    </ContentPanel>
  )
}

// ─── Unlock ──────────────────────────────────────────────────────────────────

function UnlockForm({ status, bio, onBioChanged, onUnlocked }: {
  status: PasswordVaultStatus | null
  bio: PasswordBioStatus | null
  /** Re-probe after a ceremony — a lost platform key self-heals the enrollment away. */
  onBioChanged: () => Promise<void>
  onUnlocked: (s: PasswordVaultStatus) => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [bioBusy, setBioBusy] = useState(false)

  if (status && !status.available) {
    return (
      <EmptyState
        icon="⚠️"
        title="Secure storage is unavailable"
        body="This computer's credential store (Windows Credential Manager / macOS Keychain / libsecret) isn't available, so MagicMoney can't encrypt saved passwords safely. The password manager is disabled rather than storing anything unprotected."
      />
    )
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const s = await window.wallet.passwordsUnlock?.(password)
      setPassword('')
      if (s) onUnlocked(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not unlock the password manager')
    } finally {
      setBusy(false)
    }
  }

  // Offered only when this vault is enrolled AND the OS still has a biometric
  // set up; the password form below is always rendered regardless.
  const bioLabel = bioMethodLabel(bio?.method)
  const canBio = bio?.supported === true && bio.enrolled

  const unlockWithBio = async () => {
    if (bioBusy || busy) return
    setBioBusy(true)
    setError(null)
    try {
      const s = await window.wallet.passwordsBioUnlock?.()
      if (s) onUnlocked(s)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Cancel is a normal, quiet outcome — don't shout about it.
      if (!/cancel/i.test(msg)) setError(msg.replace(/^Error:\s*/, ''))
      // The enrollment may have just self-healed away (lost TPM/keychain key),
      // in which case the button must disappear and leave only the password.
      await onBioChanged()
    } finally {
      setBioBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 380, margin: '18px auto 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div aria-hidden="true" style={{ fontSize: 32, textAlign: 'center' }}>🔐</div>
      <div style={{ fontSize: 13, fontWeight: 700, textAlign: 'center' }}>
        {status?.exists ? 'Unlock your saved passwords' : 'Set up the password manager'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
        {status?.exists
          ? canBio
            ? `Saved website logins are encrypted with your wallet password. Open them with ${bioLabel}, or enter it below.`
            : 'Saved website logins are encrypted with your wallet password. Enter it to open them.'
          : 'Website logins will be encrypted with your wallet password and stored only on this computer — never synced, never sent anywhere.'}
      </div>

      {canBio && (
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={bioBusy || busy}
            onClick={() => void unlockWithBio()}
          >
            {bioBusy ? `Waiting for ${bioLabel}…` : `Unlock with ${bioLabel}`}
          </button>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', letterSpacing: 0.4 }}>
            or
          </div>
        </>
      )}

      <Field label="Wallet password">
        <input
          autoFocus={!canBio}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          style={fieldStyle}
        />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}

      <button type="submit" className={canBio ? 'btn' : 'btn btn-primary'} disabled={busy || bioBusy || !password}>
        {busy ? 'Unlocking…' : status?.exists ? 'Unlock' : 'Create'}
      </button>

      {/*
        Enrolling needs the password this form is about to collect, so it cannot
        happen here. Say where it lives instead — otherwise the feature is
        invisible to anyone who only ever sees this screen.
      */}
      {bio?.supported === true && !bio.enrolled && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.6 }}>
          Once open, use <strong style={{ color: 'var(--text-secondary)' }}>Turn on {bioLabel}</strong> at
          the top of the panel to skip typing this next time.
        </div>
      )}
    </form>
  )
}

// ─── Editor ──────────────────────────────────────────────────────────────────

function Editor({ draft, onChange, onCancel, onSave }: {
  draft: Draft
  onChange: (d: Draft) => void
  onCancel: () => void
  onSave: () => void
}) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ maxWidth: 460, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700 }}>{draft.id ? 'Edit login' : 'Add login'}</div>

      <Field label="Site">
        <input
          autoFocus
          type="text"
          value={draft.url}
          onChange={e => onChange({ ...draft, url: e.target.value })}
          placeholder="https://example.com"
          spellCheck={false}
          style={fieldStyle}
        />
      </Field>

      <Field label="Username or email">
        <input
          type="text"
          value={draft.username}
          onChange={e => onChange({ ...draft, username: e.target.value })}
          spellCheck={false}
          style={fieldStyle}
        />
      </Field>

      <Field label="Password">
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type={show ? 'text' : 'password'}
            value={draft.password}
            onChange={e => onChange({ ...draft, password: e.target.value })}
            style={{ ...fieldStyle, flex: 1 }}
          />
          <RowButton label={show ? 'Hide' : 'Show'} onClick={() => setShow(v => !v)} />
        </div>
      </Field>

      <Field label="Note (optional)">
        <input
          type="text"
          value={draft.note}
          onChange={e => onChange({ ...draft, note: e.target.value })}
          style={fieldStyle}
        />
      </Field>

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={!draft.url || !draft.password}>
          Save
        </button>
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
