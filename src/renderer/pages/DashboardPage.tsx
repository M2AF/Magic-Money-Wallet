import { useState, useEffect, useCallback } from 'react'
import type { AppPage, WalletAddresses, AllBalances, AllHistory, ChainHistory } from '../types/wallet'
import { ChainCard } from '../components/ChainCard'
import { SendModal } from '../components/SendModal'

function PortfolioChart({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const W = 300, H = 56
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 4) - 2}`)
    .join(' ')
  const isUp = data[data.length - 1] >= data[0]
  const color = isUp ? '#22c55e' : '#ef4444'
  const changePct = data[0] > 0 ? ((data[data.length - 1] - data[0]) / data[0]) * 100 : 0
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>7d portfolio</div>
        <div style={{ fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-mono)', color }}>
          {isUp ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block', height: H }}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
          strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      </svg>
    </div>
  )
}

interface Props {
  addresses: WalletAddresses
  onNavigate: (page: AppPage) => void
  onWalletDeleted: () => void
}

const ALL_CHAINS = [
  'cardano', 'solana', 'bitcoin', 'polkadot',
  'ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'avalanche',
  'blast', 'gnosis', 'monad', 'abstract', 'apechain', 'ronin',
  'soneium', 'worldchain', 'zora', 'hyperevm'
]

function sortedChains(balances: AllBalances | null): string[] {
  if (!balances) return ALL_CHAINS
  return [...ALL_CHAINS].sort((a, b) => {
    const usdA = parseFloat(balances.chains[a]?.usdValue?.replace(/[$,]/g, '') ?? '0') || 0
    const usdB = parseFloat(balances.chains[b]?.usdValue?.replace(/[$,]/g, '') ?? '0') || 0
    if (usdB !== usdA) return usdB - usdA
    const natA = parseFloat(balances.chains[a]?.native ?? '0') || 0
    const natB = parseFloat(balances.chains[b]?.native ?? '0') || 0
    return natB - natA
  })
}

function getAddress(chainId: string, addresses: WalletAddresses): string | null {
  if (chainId === 'solana')   return addresses.solana   || null
  if (chainId === 'cardano')  return addresses.cardano  || null
  if (chainId === 'bitcoin')  return addresses.bitcoin  || null
  if (chainId === 'polkadot') return addresses.polkadot || null
  return addresses.evm
}

export function DashboardPage({ addresses, onNavigate, onWalletDeleted }: Props) {
  const [localAddresses, setLocalAddresses] = useState(addresses)
  const [balances, setBalances]             = useState<AllBalances | null>(null)
  const [loading, setLoading]               = useState(true)
  const [refreshing, setRefreshing]         = useState(false)
  const [history, setHistory]               = useState<AllHistory | null>(null)
  const [accountSwitching, setAccountSwitching] = useState(false)
  const [showSettings, setShowSettings]     = useState(false)
  const [showSeed, setShowSeed]             = useState(false)
  const [seedWords, setSeedWords]           = useState<string[]>([])
  const [deleting, setDeleting]             = useState(false)
  const [sendChain, setSendChain]           = useState<string | null>(null)

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

  const fetchHistory = useCallback(async () => {
    try {
      const result = await window.wallet.getHistory()
      setHistory(result)
    } catch (err) {
      console.error('History fetch failed', err)
    }
  }, [])

  useEffect(() => {
    fetchBalances()
    fetchHistory()
  }, [fetchBalances, fetchHistory])

  const switchAccount = async (newIndex: number) => {
    if (newIndex < 0 || newIndex > 9 || accountSwitching) return
    setAccountSwitching(true)
    setBalances(null)
    setHistory(null)
    try {
      const newAddresses = await window.wallet.setAccount(newIndex)
      setLocalAddresses(newAddresses)
      fetchBalances()
      fetchHistory()
    } catch (err) {
      console.error('Account switch failed', err)
    } finally {
      setAccountSwitching(false)
    }
  }

  const totalUsd = (() => {
    if (!balances) return null
    const total = Object.values(balances.chains)
      .map(b => b?.usdValue ? parseFloat(b.usdValue.replace(/[$,]/g, '')) : 0)
      .reduce((a, b) => a + b, 0)
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

  // All chains with a supported history API
  const HISTORY_CHAINS = new Set([
    'ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'avalanche', 'blast',
    'gnosis', 'monad', 'abstract', 'apechain', 'ronin', 'soneium', 'worldchain', 'zora', 'hyperevm',
    'solana', 'cardano', 'bitcoin', 'polkadot'
  ])

  const historyFor = (chainId: string): ChainHistory | null | undefined => {
    if (!HISTORY_CHAINS.has(chainId)) return undefined  // hide section entirely
    if (!history) return null                            // loading spinner
    return history[chainId] ?? null
  }

  // Find active send chain balance & symbol for the modal
  const activeSendBalance = sendChain ? balances?.chains[sendChain]?.native ?? null : null
  const activeSendSymbol  = sendChain ? balances?.chains[sendChain]?.symbol ?? sendChain.toUpperCase() : ''

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
          {balances?.portfolioSparkline && balances.portfolioSparkline.length > 1 && (
            <PortfolioChart data={balances.portfolioSparkline} />
          )}
          {lastUpdated && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              Updated {lastUpdated}
            </div>
          )}

          {/* Account switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
            <button
              type="button"
              onClick={() => switchAccount(localAddresses.accountIndex - 1)}
              disabled={localAddresses.accountIndex === 0 || accountSwitching}
              style={{ background: 'none', border: 'none', padding: '2px 6px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, opacity: localAddresses.accountIndex === 0 ? 0.3 : 1 }}
            >‹</button>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', minWidth: 64, textAlign: 'center' }}>
              {accountSwitching ? 'Switching…' : `Account ${localAddresses.accountIndex}`}
            </span>
            <button
              type="button"
              onClick={() => switchAccount(localAddresses.accountIndex + 1)}
              disabled={localAddresses.accountIndex >= 9 || accountSwitching}
              style={{ background: 'none', border: 'none', padding: '2px 6px', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, opacity: localAddresses.accountIndex >= 9 ? 0.3 : 1 }}
            >›</button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          {/* Refresh */}
          <button
            type="button"
            onClick={() => { fetchBalances(true); fetchHistory() }}
            disabled={refreshing || loading}
            title="Refresh balances"
            style={{ width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: 'var(--accent-dim)', border: '1px solid var(--border)', color: 'var(--accent)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: refreshing ? 0.5 : 1, transition: 'opacity var(--transition)' }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ animation: refreshing ? 'spin 0.8s linear infinite' : 'none' }}>
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          {/* Settings */}
          <button
            onClick={() => setShowSettings(s => !s)}
            title="Settings"
            style={{ width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: showSettings ? 'var(--accent-dim)' : 'transparent', border: `1px solid ${showSettings ? 'var(--border-active)' : 'var(--border)'}`, color: showSettings ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
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

      {/* Chain cards — sorted by balance descending */}
      {sortedChains(balances).map(chainId => (
        <ChainCard
          key={chainId}
          chainId={chainId}
          balance={balances?.chains[chainId] ?? null}
          address={getAddress(chainId, localAddresses)}
          loading={loading}
          onSend={() => setSendChain(chainId)}
          history={historyFor(chainId)}
        />
      ))}

      {/* Send modal */}
      {sendChain && (
        <SendModal
          chainId={sendChain}
          balance={activeSendBalance}
          symbol={activeSendSymbol}
          onClose={() => setSendChain(null)}
        />
      )}
    </div>
  )
}
