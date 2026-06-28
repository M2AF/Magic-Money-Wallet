import { useState, useEffect, useCallback } from 'react'
import type { ClUser, ChainlensSyncResult, WalletCollectible } from '../types/wallet'

const CHAIN_LABELS: Record<string, string> = {
  evm: 'Ethereum/EVM', solana: 'Solana', cardano: 'Cardano',
  bitcoin: 'Bitcoin', polkadot: 'Polkadot', tron: 'Tron', dogecoin: 'Dogecoin'
}

const PROVIDER_LABELS: Record<string, string> = {
  google: 'Google', discord: 'Discord', twitter: 'Twitter', github: 'GitHub'
}

const PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#06b6d4', '#10b981']
function avatarColour(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return PALETTE[Math.abs(h) % PALETTE.length]
}

function shortAddr(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button type="button" onClick={copy} style={{
      background: 'none', border: 'none', cursor: 'pointer',
      color: copied ? 'var(--accent)' : 'var(--text-muted)',
      padding: '2px 4px', fontSize: 11, borderRadius: 4, flexShrink: 0
    }}>
      {copied ? '✓' : 'copy'}
    </button>
  )
}

// ── Avatar change modal ────────────────────────────────────────────────────────

function AvatarModal({
  onClose, onSave
}: {
  onClose: () => void
  onSave: (url: string) => void
}) {
  const [tab, setTab] = useState<'nft' | 'upload'>('nft')
  const [nfts, setNfts] = useState<WalletCollectible[]>([])
  const [loadingNfts, setLoadingNfts] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (tab === 'nft' && nfts.length === 0) {
      setLoadingNfts(true)
      window.wallet.getCollectibles()
        .then(r => setNfts(r.items.filter(n => !!n.image)))
        .catch(() => {})
        .finally(() => setLoadingNfts(false))
    }
  }, [tab, nfts.length])

  const handleUpload = async () => {
    setUploading(true)
    try {
      const dataUrl = await window.wallet.chainlensPickAvatar()
      if (dataUrl) setSelected(dataUrl)
    } finally {
      setUploading(false)
    }
  }

  const handleSave = async () => {
    if (!selected) return
    setSaving(true)
    try {
      await window.wallet.chainlensUpdateProfile({ avatar_url: selected })
      onSave(selected)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center'
    }} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={{
        background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)',
        width: 320, maxHeight: 480, display: 'flex', flexDirection: 'column',
        overflow: 'hidden', boxShadow: '0 16px 48px rgba(0,0,0,0.6)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Change Profile Photo</div>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {(['nft', 'upload'] as const).map(t => (
            <button key={t} type="button" onClick={() => setTab(t)} style={{
              flex: 1, padding: '10px 0', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-body)',
              color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent'
            }}>
              {t === 'nft' ? '🖼 Use NFT' : '📁 Upload Photo'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {tab === 'nft' ? (
            loadingNfts ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24, fontSize: 13 }}>Loading NFTs…</div>
            ) : nfts.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 24, fontSize: 13 }}>No NFTs with images found</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {nfts.map(nft => (
                  <div
                    key={nft.id}
                    onClick={() => setSelected(nft.image!)}
                    style={{
                      aspectRatio: '1', borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                      border: selected === nft.image ? '2px solid var(--accent)' : '2px solid transparent',
                      position: 'relative', background: 'var(--bg-dark)'
                    }}
                  >
                    <img src={nft.image!} alt={nft.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    {selected === nft.image && (
                      <div style={{
                        position: 'absolute', inset: 0, background: 'rgba(99,102,241,0.3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 20, color: 'white'
                      }}>✓</div>
                    )}
                  </div>
                ))}
              </div>
            )
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '24px 0' }}>
              {selected ? (
                <img src={selected} alt="Preview" style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', border: '3px solid var(--accent)' }} />
              ) : (
                <div style={{ width: 96, height: 96, borderRadius: '50%', background: 'var(--bg-dark)', border: '2px dashed var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 32 }}>
                  👤
                </div>
              )}
              <button type="button" onClick={handleUpload} disabled={uploading} style={{
                padding: '10px 24px', borderRadius: 10, border: '1px solid var(--border)',
                background: 'var(--bg-dark)', color: 'var(--text)', fontSize: 13, fontWeight: 600,
                cursor: uploading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)'
              }}>
                {uploading ? 'Opening…' : 'Choose File'}
              </button>
              <div style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>
                JPG, PNG, GIF, WebP supported
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, fontFamily: 'var(--font-body)' }}>
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={!selected || saving} style={{
            padding: '8px 16px', borderRadius: 8, border: 'none',
            background: selected ? 'var(--accent)' : 'var(--bg-dark)',
            color: selected ? 'white' : 'var(--text-muted)',
            cursor: selected && !saving ? 'pointer' : 'not-allowed',
            fontSize: 13, fontWeight: 700, fontFamily: 'var(--font-body)'
          }}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ProfilePage ──────────────────────────────────────────────────────────

export function ProfilePage() {
  const [profile, setProfile] = useState<ClUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [showAvatarModal, setShowAvatarModal] = useState(false)

  const loadProfile = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = await window.wallet.chainlensGetProfile()
      setProfile(p)
    } catch {
      setError('Could not load profile')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadProfile() }, [loadProfile])

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      const result: ChainlensSyncResult = await window.wallet.chainlensSync()
      if (result.success) setProfile(result.profile)
      else setError(result.error ?? 'Sync failed')
    } catch (e) {
      setError(String(e))
    } finally {
      setSyncing(false)
    }
  }

  const startEditName = () => { setNameInput(profile?.display_name ?? ''); setEditingName(true) }
  const saveName = async () => {
    if (!nameInput.trim()) return
    setSavingName(true)
    try {
      const r = await window.wallet.chainlensUpdateProfile({ display_name: nameInput.trim() })
      if (r.success) { setProfile(p => p ? { ...p, display_name: nameInput.trim() } : p); setEditingName(false) }
    } finally { setSavingName(false) }
  }

  const handleAvatarSaved = (url: string) => {
    setProfile(p => p ? { ...p, avatar_url: url } : p)
    setShowAvatarModal(false)
  }

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
      Loading profile…
    </div>
  )

  if (!profile) return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', gap: 16 }}>
      <div style={{
        width: 72, height: 72, borderRadius: '50%',
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 0 24px rgba(99,102,241,0.4)'
      }}>
        <svg width="38" height="38" fill="none" stroke="white" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
        </svg>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 6 }}>ChainLens Profile</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>
          Connect your wallet to the ChainLens network.<br/>
          Your addresses will be synced across all ChainLens apps.
        </div>
      </div>
      {error && (
        <div style={{ color: '#ef4444', fontSize: 12, textAlign: 'center', padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, width: '100%', boxSizing: 'border-box' }}>
          {error}
        </div>
      )}
      <button type="button" onClick={handleSync} disabled={syncing} style={{
        marginTop: 8, padding: '12px 32px', borderRadius: 12, border: 'none',
        background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        color: 'white', fontWeight: 700, fontSize: 15, cursor: syncing ? 'not-allowed' : 'pointer',
        opacity: syncing ? 0.7 : 1, boxShadow: '0 4px 16px rgba(99,102,241,0.4)'
      }}>
        {syncing ? 'Connecting…' : 'Connect to ChainLens'}
      </button>
      <div style={{ color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>
        No account needed — your wallet address is your identity.
      </div>
    </div>
  )

  const displayName = profile.display_name ?? shortAddr(profile.provider_id)
  const avatarBg = avatarColour(profile.id)
  const initials = displayName.slice(0, 2).toUpperCase()
  const chainWallets = profile.cl_wallets?.filter(w => !w.watch_only) ?? []
  const watchWallets = profile.cl_wallets?.filter(w => w.watch_only) ?? []
  const socialAccounts = (profile.cl_linked_accounts ?? []).filter(a => !a.provider.endsWith('_wallet'))

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px' }}>
      {showAvatarModal && (
        <AvatarModal onClose={() => setShowAvatarModal(false)} onSave={handleAvatarSaved} />
      )}

      {/* ── Avatar + name ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20 }}>
        {/* Avatar — clickable to change */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" onClick={() => setShowAvatarModal(true)} style={{
            border: 'none', background: 'none', padding: 0, cursor: 'pointer',
            display: 'block', borderRadius: '50%'
          }} title="Change profile photo">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="" style={{ width: 56, height: 56, borderRadius: '50%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: `linear-gradient(135deg, ${avatarBg} 0%, ${avatarBg}99 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: 20, color: 'white',
                boxShadow: `0 0 16px ${avatarBg}66`
              }}>{initials}</div>
            )}
          </button>
          {/* Camera overlay hint */}
          <div style={{
            position: 'absolute', bottom: -2, right: -2,
            width: 20, height: 20, borderRadius: '50%',
            background: 'var(--accent)', border: '2px solid var(--bg-dark)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none'
          }}>
            <svg width="10" height="10" fill="none" stroke="white" strokeWidth="1.8" viewBox="0 0 24 24">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {editingName ? (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false) }}
                autoFocus
                style={{ flex: 1, background: 'var(--bg-card)', border: '1px solid var(--accent)', color: 'var(--text)', borderRadius: 6, padding: '4px 8px', fontSize: 14, fontWeight: 700 }}
              />
              <button type="button" onClick={saveName} disabled={savingName} style={{ background: 'var(--accent)', border: 'none', borderRadius: 6, color: 'white', padding: '4px 10px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                {savingName ? '…' : 'Save'}
              </button>
              <button type="button" onClick={() => setEditingName(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayName}</div>
              <button type="button" onClick={startEditName} title="Edit name" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, fontSize: 13 }}>✎</button>
            </div>
          )}
          <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontFamily: 'monospace' }}>{profile.id.slice(0, 8)}…</span>
            <CopyBtn text={profile.id} />
          </div>
        </div>

        <button type="button" onClick={handleSync} disabled={syncing} title="Refresh profile"
          style={{ background: 'none', border: 'none', cursor: syncing ? 'default' : 'pointer', color: syncing ? 'var(--text-muted)' : 'var(--accent)', fontSize: 18, padding: 4 }}>
          {syncing ? '⏳' : '↻'}
        </button>
      </div>

      {/* ── Linked wallets ── */}
      <Section title="Linked Wallets" count={chainWallets.length}>
        {chainWallets.length === 0
          ? <EmptyRow label="No wallets linked yet" />
          : chainWallets.map(w => <WalletRow key={w.id} chain={w.chain} address={w.address} />)
        }
        {watchWallets.length > 0 && (
          <>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 12px 2px', fontWeight: 600, letterSpacing: '0.05em' }}>WATCH-ONLY</div>
            {watchWallets.map(w => <WalletRow key={w.id} chain={w.chain} address={w.address} watchOnly />)}
          </>
        )}
      </Section>

      {/* ── Social accounts ── */}
      <Section title="Social Accounts" count={socialAccounts.length}>
        {socialAccounts.length === 0
          ? <EmptyRow label="No social accounts linked" />
          : socialAccounts.map(a => <SocialRow key={a.id} provider={a.provider} displayName={a.display_name} />)
        }
      </Section>

      {error && (
        <div style={{ color: '#ef4444', fontSize: 12, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', borderRadius: 8, marginTop: 8 }}>
          {error}
        </div>
      )}
      <div style={{ height: 16 }} />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 11, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{title}</div>
        {count > 0 && <div style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 999 }}>{count}</div>}
      </div>
      <div style={{ background: 'var(--bg-card)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {children}
      </div>
    </div>
  )
}

function WalletRow({ chain, address, watchOnly }: { chain: string; address: string; watchOnly?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)' }} className="profile-row">
      <ChainIcon chain={chain} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          {CHAIN_LABELS[chain] ?? chain}
          {watchOnly && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> · watch</span>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{shortAddr(address)}</div>
      </div>
      <CopyBtn text={address} />
    </div>
  )
}

function SocialRow({ provider, displayName }: { provider: string; displayName: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid var(--border)' }} className="profile-row">
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--bg-dark)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <SocialIcon provider={provider} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>{PROVIDER_LABELS[provider] ?? provider}</div>
        {displayName && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{displayName}</div>}
      </div>
    </div>
  )
}

function EmptyRow({ label }: { label: string }) {
  return <div style={{ padding: '14px 12px', color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>{label}</div>
}

// ── Chain icons with real logos ───────────────────────────────────────────────

function ChainIcon({ chain }: { chain: string }) {
  const BG: Record<string, string> = {
    evm: '#627EEA', solana: '#9945FF', cardano: '#2A7DEA',
    bitcoin: '#F7931A', polkadot: '#E6007A', tron: '#EB0029', dogecoin: '#C2A633'
  }
  const bg = BG[chain] ?? '#6b7280'

  return (
    <div style={{
      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
      background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `0 0 8px ${bg}66`
    }}>
      {chain === 'evm'      && <EthIcon />}
      {chain === 'solana'   && <SolIcon />}
      {chain === 'cardano'  && <AdaIcon />}
      {chain === 'bitcoin'  && <BtcIcon />}
      {chain === 'polkadot' && <DotIcon />}
      {chain === 'tron'     && <TrxIcon />}
      {chain === 'dogecoin' && <DogeIcon />}
      {!['evm','solana','cardano','bitcoin','polkadot','tron','dogecoin'].includes(chain) && (
        <span style={{ fontSize: 12, fontWeight: 800, color: 'white' }}>{chain[0].toUpperCase()}</span>
      )}
    </div>
  )
}

const EthIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <polygon points="12,2 20.5,12 12,15.5 3.5,12" fill="white" opacity="0.9"/>
    <polygon points="12,15.5 20.5,12 12,22" fill="white" opacity="0.6"/>
    <polygon points="12,15.5 3.5,12 12,22" fill="white" opacity="0.8"/>
  </svg>
)

const SolIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <rect x="3" y="5" width="18" height="3" rx="1.5" fill="white" opacity="0.9"/>
    <rect x="3" y="10.5" width="14" height="3" rx="1.5" fill="white" opacity="0.9"/>
    <rect x="3" y="16" width="18" height="3" rx="1.5" fill="white" opacity="0.9"/>
  </svg>
)

const AdaIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="3" fill="white"/>
    <circle cx="12" cy="4" r="1.5" fill="white" opacity="0.7"/>
    <circle cx="12" cy="20" r="1.5" fill="white" opacity="0.7"/>
    <circle cx="4" cy="8" r="1.5" fill="white" opacity="0.7"/>
    <circle cx="20" cy="8" r="1.5" fill="white" opacity="0.7"/>
    <circle cx="4" cy="16" r="1.5" fill="white" opacity="0.7"/>
    <circle cx="20" cy="16" r="1.5" fill="white" opacity="0.7"/>
  </svg>
)

const BtcIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <text x="4" y="18" fontSize="18" fontWeight="900" fill="white" fontFamily="Arial">₿</text>
  </svg>
)

const DotIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="12" r="3.5" fill="white"/>
    <circle cx="12" cy="3" r="2" fill="white" opacity="0.7"/>
    <circle cx="12" cy="21" r="2" fill="white" opacity="0.7"/>
    <circle cx="3" cy="12" r="2" fill="white" opacity="0.7"/>
    <circle cx="21" cy="12" r="2" fill="white" opacity="0.7"/>
  </svg>
)

const TrxIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M4 5 L20 8.5 L11 21 Z M4 5 L11 21 M4 5 L15.5 11 M20 8.5 L11 21"
      stroke="white" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" fill="none" opacity="0.95"/>
  </svg>
)

const DogeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <text x="5" y="18" fontSize="17" fontWeight="900" fill="white" fontFamily="Arial">Ð</text>
  </svg>
)

// ── Social icons ──────────────────────────────────────────────────────────────

function SocialIcon({ provider }: { provider: string }) {
  if (provider === 'google') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style={{ color: '#ea4335' }}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
  if (provider === 'discord') return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="#5865f2">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
    </svg>
  )
  return <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 700 }}>{provider[0].toUpperCase()}</span>
}
