import { useState, useEffect, useCallback } from 'react'
import type { AppPage, WalletAddresses, AllBalances } from '../types/wallet'
import { ChainCard } from '../components/ChainCard'

interface Props {
  addresses: WalletAddresses
  onNavigate: (page: AppPage) => void
  onWalletDeleted: () => void
}

export function DashboardPage({ addresses, onNavigate, onWalletDeleted }: Props) {
  const [balances, setBalances]     = useState<AllBalances | null>(null)
  const [loading, setLoading]       = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showSeed, setShowSeed]     = useState(false)
  const [seedWords, setSeedWords]   = useState<string[]>([])
  const [deleting, setDeleting]     = useState(false)

  const fetchBalances = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    else setRefreshing(true)
    try {
      const result = await window.wallet.getBalances()
      setBalances(result)
    } catch (err) {
      console.error('Balance fetch failed', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { fetchBalances() }, [fetchBalances])

  const totalUsd = (() => {
    if (!balances) return null
    const vals = [balances.evm, balances.solana, balances.cardano]
      .map(b => b?.usdValue ? parseFloat(b.usdValue.replace(/[$,]/g, '')) : 0)
    const total = vals.reduce((a, b) => a + b, 0)
    return total > 0 ? `$${total.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null
  })()

  const handleRevealSeed = async () => {
    if (showSeed) { setShowSeed(false); setSeedWords([]); return }
    const words = await window.wallet.revealSeed()
    setSeedWords(words)
    setShowSeed(true)
  }

  const handleDelete = async () => {
    if (!deleting) { setDeleting(true); return }
    await window.wallet.deleteWallet()
    onWalletDeleted()
  }

  const lastUpdated = balances
    ? new Date(balances.fetchedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="page fade-in" style={{ gap: 16, position: 'relative' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 18 }}>Portfolio</h1>
          {totalUsd && (
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)', marginTop: 4 }}>
              {totalUsd}
            </div>
          )}
          {lastUpdated && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Updated {lastUpdated}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Refresh */}
          <button
            onClick={() => fetchBalances(true)}
            disabled={refreshing || loading}
            title="Refresh balances"
            style={{
              width: 34, height: 34, borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-dim)', border: '1px solid var(--border)',
              color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: refreshing ? 0.5 : 1, transition: 'opacity var(--transition)'
            }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
              style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          {/* Settings */}
          <button
            onClick={() => setShowSettings(s => !s)}
            title="Settings"
            style={{
              width: 34, height: 34, borderRadius: 'var(--radius-sm)',
              background: showSettings ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${showSettings ? 'var(--border-active)' : 'var(--border)'}`,
              color: showSettings ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
            }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="card fade-in" style={{ gap: 16, display: 'flex', flexDirection: 'column' }}>
          <p className="label">Security</p>

          {/* Reveal seed */}
          <div>
            <button
              className="btn btn-ghost"
              onClick={handleRevealSeed}
              style={{ fontSize: 13, padding: '10px 16px' }}
            >
              {showSeed ? 'Hide Seed Phrase' : '🔑 Reveal Seed Phrase'}
            </button>
            {showSeed && seedWords.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div className="warning-box" style={{ marginBottom: 10 }}>
                  <span className="warning-icon">⚠️</span>
                  <span>Keep this private. Anyone with these words owns your wallet.</span>
                </div>
                <div className="seed-grid">
                  {seedWords.map((w, i) => (
                    <div key={i} className="seed-word">
                      <span className="seed-word-num">{i + 1}</span>
                      <span className="seed-word-text">{w}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="divider" />

          {/* Delete wallet */}
          <div>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              style={{ fontSize: 13, padding: '10px 16px' }}
            >
              {deleting ? '⚠️ Click again to permanently delete wallet' : '🗑 Delete Wallet'}
            </button>
            {deleting && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                This will wipe your encrypted seed from this device. Make sure you have your phrase backed up.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Chain cards */}
      <ChainCard
        chain="evm"
        balance={balances?.evm ?? null}
        address={addresses.evm}
        loading={loading}
      />
      <ChainCard
        chain="solana"
        balance={balances?.solana ?? null}
        address={addresses.solana}
        loading={loading}
      />
      <ChainCard
        chain="cardano"
        balance={balances?.cardano ?? null}
        address={addresses.cardano}
        loading={loading}
      />

      {/* Footer note */}
      <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', paddingBottom: 8 }}>
        EVM address works on Ethereum, Monad, and Abstract.
      </p>
    </div>
  )
}
