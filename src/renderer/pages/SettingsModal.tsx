import { useState } from 'react'

interface Props {
  onClose: () => void
  onDeleteWallet: () => void
}

export function SettingsModal({ onClose, onDeleteWallet }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [copied, setCopied] = useState(false)

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
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9997,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center'
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', borderRadius: '16px 16px 0 0',
          border: '1px solid var(--border)', width: '100%', maxWidth: 480,
          padding: '0 0 24px', boxShadow: '0 -8px 32px rgba(0,0,0,0.5)'
        }}
      >
        {/* Handle */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
          <div style={{ width: 36, height: 4, borderRadius: 999, background: 'var(--border)' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px 16px' }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>Settings</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        {/* Rows */}
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
            sublabel="Only do this in a private location"
            onClick={async () => {
              const words = await window.wallet.revealSeed().catch(() => null)
              if (words) {
                await navigator.clipboard.writeText(words.join(' ')).catch(() => {})
                alert('Seed phrase copied to clipboard — store it safely!')
              }
            }}
          />
        </SettingsSection>

        <SettingsSection label="About">
          <SettingsRow icon="⚡" label="MagicMoney Wallet" sublabel="Phase 10 — WalletConnect" onClick={() => {}} />
          <SettingsRow icon="🔗" label="Powered by ChainLens" sublabel="chainlensnft.info" onClick={() => {}} />
        </SettingsSection>

        <SettingsSection label="Danger Zone">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            style={{
              width: '100%', padding: '13px 18px', background: 'none', border: 'none',
              display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
              borderBottom: '1px solid var(--border)', textAlign: 'left'
            }}
          >
            <span style={{ fontSize: 18, flexShrink: 0 }}>🗑</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#ef4444' }}>
                {confirmDelete ? 'Tap again to confirm — this cannot be undone' : 'Delete Wallet'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Removes keys from this device permanently
              </div>
            </div>
          </button>
        </SettingsSection>
      </div>
    </div>
  )
}

function SettingsSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ padding: '4px 18px 6px', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        {children}
      </div>
    </div>
  )
}

function SettingsRow({ icon, label, sublabel, onClick }: { icon: string; label: string; sublabel: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        width: '100%', padding: '12px 18px', background: 'none', border: 'none',
        display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
        borderBottom: '1px solid var(--border)', textAlign: 'left'
      }}
    >
      <span style={{ fontSize: 18, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sublabel}</div>
      </div>
      <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>
  )
}
