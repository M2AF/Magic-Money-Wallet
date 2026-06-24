import { useState } from 'react'

interface Props {
  onClose: () => void
  onDeleteWallet: () => void
}

export function SettingsModal({ onClose, onDeleteWallet }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [revealOpen, setRevealOpen] = useState(false)

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setDeleting(true)
    try {
      await window.wallet.deleteWallet()
      onDeleteWallet()
    } finally {
      setDeleting(false)
    }
  }

  const copyAddresses = async () => {
    const addrs = await window.wallet.getAddresses().catch(() => null)
    if (!addrs) return
    const text = [
      `EVM:      ${addrs.evm}`,
      `Solana:   ${addrs.solana}`,
      `Cardano:  ${addrs.cardano}`,
      `Bitcoin:  ${addrs.bitcoin}`,
      `Polkadot: ${addrs.polkadot}`
    ].join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-sheet fade-in" onClick={e => e.stopPropagation()}>
        <div className="settings-grip" />

        <div className="settings-header">
          <div className="settings-title">Settings</div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <SettingsSection label="Wallet">
          <SettingsRow
            icon="📋"
            label={copied ? 'Copied!' : 'Copy All Addresses'}
            sublabel="EVM, Solana, Cardano, Bitcoin, Polkadot"
            onClick={copyAddresses}
          />
          <SettingsRow
            icon="🔑"
            label="Reveal Secret Phrase"
            sublabel="Requires your password — only in a private location"
            onClick={() => setRevealOpen(true)}
          />
        </SettingsSection>

        <SettingsSection label="About">
          <SettingsRow icon="⚡" label="MagicMoney Wallet" sublabel="Phase 10 — WalletConnect" noChevron />
          <SettingsRow icon="🔗" label="Powered by ChainLens" sublabel="chainlensnft.info" noChevron />
        </SettingsSection>

        <SettingsSection label="Danger Zone" danger>
          <SettingsRow
            danger
            icon="🗑"
            label={confirmDelete ? 'Tap again to confirm — cannot be undone' : 'Delete Wallet'}
            sublabel="Removes keys from this device permanently"
            onClick={handleDelete}
            disabled={deleting}
            noChevron
          />
        </SettingsSection>
      </div>

      {revealOpen && <RevealSeedModal onClose={() => setRevealOpen(false)} />}
    </div>
  )
}

// ── Password-gated seed reveal ─────────────────────────────────────────────────
// Re-verifies the password in the main process before the phrase is returned, and
// shows the words in-app instead of auto-copying them to a shared clipboard.

function RevealSeedModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [words, setWords] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const reveal = async () => {
    if (!password) return
    setBusy(true); setError(null)
    try {
      setWords(await window.wallet.revealSeed(password))
      setPassword('')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(/incorrect/i.test(msg) ? 'Incorrect password' : msg.replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-overlay" onClick={onClose} style={{ zIndex: 300 }}>
      <div className="settings-sheet fade-in" onClick={e => e.stopPropagation()} style={{ maxHeight: 'none' }}>
        <div className="settings-grip" />
        <div className="settings-header">
          <div className="settings-title">Reveal Secret Phrase</div>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        {!words ? (
          <div style={{ padding: '4px 4px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Anyone with this phrase controls your funds. Make sure no one can see your screen.
            </div>
            <input
              className="input" type="password" autoFocus placeholder="Enter your password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(null) }}
              onKeyDown={e => { if (e.key === 'Enter') reveal() }}
            />
            {error && <div style={{ color: 'var(--error)', fontSize: 12 }}>{error}</div>}
            <button type="button" className="btn btn-primary" onClick={reveal} disabled={busy || !password}>
              {busy ? 'Verifying…' : 'Reveal'}
            </button>
          </div>
        ) : (
          <div style={{ padding: '4px 4px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {words.map((w, i) => (
                <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'baseline', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', minWidth: 14 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{w}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={async () => { await navigator.clipboard.writeText(words.join(' ')).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1800) }}
            >
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        )}
      </div>
    </div>
  )
}

function SettingsSection({ label, danger, children }: { label: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-label">{label}</div>
      <div className={`settings-group${danger ? ' danger' : ''}`}>
        {children}
      </div>
    </div>
  )
}

function SettingsRow({ icon, label, sublabel, onClick, danger, disabled, noChevron }: {
  icon: string
  label: string
  sublabel: string
  onClick?: () => void
  danger?: boolean
  disabled?: boolean
  noChevron?: boolean
}) {
  return (
    <button
      type="button"
      className={`settings-row${danger ? ' danger' : ''}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="settings-icon">{icon}</span>
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        <div className="settings-row-sub">{sublabel}</div>
      </div>
      {!noChevron && (
        <svg className="settings-chevron" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      )}
    </button>
  )
}
