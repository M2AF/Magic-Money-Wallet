import { useState, useEffect, useCallback, useRef } from 'react'
import type { AppPage, WalletAddresses, AllBalances, AllHistory, ChainHistory, TokensResult, CollectiblesResult, WalletToken, WalletCollectible } from '../types/wallet'
import { ChainCard } from '../components/ChainCard'
import { SendModal } from '../components/SendModal'

type PortfolioTab = 'balances' | 'tokens' | 'collectibles'

// ─── Spam filter helpers ──────────────────────────────────────────────────────

function tokenKey(t: WalletToken) { return `${t.chain}:${t.contractAddress}` }
function nftKey(n: WalletCollectible) { return n.id }

function loadSet(key: string): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(key) ?? '[]')) } catch { return new Set() }
}
function saveSet(key: string, s: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...s]))
}

// ─── Spam manager modal ───────────────────────────────────────────────────────

interface SpamEntry { id: string; label: string; type: 'hidden' | 'spam' }

function SpamManagerModal({
  hiddenItems, spamItems, allTokens, allNfts,
  onRestore, onClose
}: {
  hiddenItems: Set<string>
  spamItems: Set<string>
  allTokens: WalletToken[]
  allNfts: WalletCollectible[]
  onRestore: (id: string) => void
  onClose: () => void
}) {
  const allIds = new Set([...hiddenItems, ...spamItems])
  const entries: SpamEntry[] = []

  for (const id of allIds) {
    const tok = allTokens.find(t => tokenKey(t) === id)
    const nft = allNfts.find(n => nftKey(n) === id)
    const label = tok ? `${tok.name} (${tok.chainLabel})` : nft ? `${nft.name} (${nft.chainLabel})` : id
    entries.push({ id, label, type: spamItems.has(id) ? 'spam' : 'hidden' })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, width: 320, maxHeight: 480, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Hidden & Spam ({entries.length})</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
          {entries.length === 0 ? (
            <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              Nothing hidden. Use the eye or ban icons on tokens/collectibles to hide them.
            </div>
          ) : entries.map(e => (
            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px' }}>
              <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 99, fontWeight: 700, letterSpacing: '0.04em',
                background: e.type === 'spam' ? 'rgba(239,68,68,0.15)' : 'rgba(100,116,139,0.15)',
                color: e.type === 'spam' ? '#ef4444' : 'var(--text-muted)'
              }}>{e.type === 'spam' ? 'SPAM' : 'HIDDEN'}</span>
              <span style={{ flex: 1, fontSize: 11, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.label}</span>
              <button type="button" onClick={() => onRestore(e.id)}
                style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, background: 'var(--accent-dim)', border: '1px solid var(--border-active)', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, flexShrink: 0 }}>
                Restore
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Hover action buttons ─────────────────────────────────────────────────────

function HideSpamButtons({ onHide, onSpam }: { onHide: () => void; onSpam: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
      <button type="button" onClick={e => { e.stopPropagation(); onHide() }}
        title="Hide"
        style={{ width: 22, height: 22, borderRadius: 5, background: 'rgba(100,116,139,0.15)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      </button>
      <button type="button" onClick={e => { e.stopPropagation(); onSpam() }}
        title="Mark as spam"
        style={{ width: 22, height: 22, borderRadius: 5, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
        <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"/>
          <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
        </svg>
      </button>
    </div>
  )
}

// ─── Tokens sub-tab ───────────────────────────────────────────────────────────

interface TokensViewProps {
  hiddenItems: Set<string>
  spamItems: Set<string>
  onHide: (id: string) => void
  onSpam: (id: string) => void
  onShowManager: () => void
  onTokensLoaded: (tokens: WalletToken[]) => void
}

function TokensView({ hiddenItems, spamItems, onHide, onSpam, onShowManager, onTokensLoaded }: TokensViewProps) {
  const [result, setResult]   = useState<TokensResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const notifiedRef = useRef(false)

  useEffect(() => {
    window.wallet.getTokens().then(r => {
      setResult(r)
      setLoading(false)
      if (!notifiedRef.current) { notifiedRef.current = true; onTokensLoaded(r.tokens) }
    })
  }, [onTokensLoaded])

  const hiddenCount = result ? result.tokens.filter(t => hiddenItems.has(tokenKey(t)) || spamItems.has(tokenKey(t))).length : 0
  const visible     = result ? result.tokens.filter(t => !hiddenItems.has(tokenKey(t)) && !spamItems.has(tokenKey(t))) : []

  if (loading) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--border)', animation: 'pulse 1.4s ease infinite', flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ width: 80, height: 10, background: 'var(--border)', borderRadius: 4, animation: 'pulse 1.4s ease infinite', marginBottom: 6 }} />
            <div style={{ width: 50, height: 8, background: 'var(--border)', borderRadius: 4, animation: 'pulse 1.4s ease infinite' }} />
          </div>
          <div style={{ width: 60, height: 10, background: 'var(--border)', borderRadius: 4, animation: 'pulse 1.4s ease infinite' }} />
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {hiddenCount > 0 && (
        <button type="button" onClick={onShowManager}
          style={{ alignSelf: 'flex-end', fontSize: 10, padding: '3px 10px', borderRadius: 99, background: 'rgba(100,116,139,0.15)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}>
          Hidden ({hiddenCount})
        </button>
      )}

      {visible.length === 0 && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {result?.tokens.length ? 'All tokens are hidden.' : 'No tokens found across all chains.'}
        </div>
      )}

      {visible.map(token => {
        const id = tokenKey(token)
        const isHovered = hovered === id
        return (
          <div key={id}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-card)', border: `1px solid ${isHovered ? 'var(--border-active)' : 'var(--border)'}`, borderRadius: 10, transition: 'border-color var(--transition)' }}
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
          >
            {token.logoUri ? (
              <img src={token.logoUri} alt={token.symbol} width={26} height={26} style={{ borderRadius: '50%', flexShrink: 0 }}
                onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
            ) : (
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: `${token.chainColor}33`, border: `1px solid ${token.chainColor}44`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: token.chainColor }}>{token.symbol.slice(0, 2)}</span>
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{token.symbol}</span>
                <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: `${token.chainColor}22`, color: token.chainColor, fontWeight: 600 }}>
                  {token.chainLabel}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{token.balance}</div>
              </div>
              <div style={{ opacity: isHovered ? 1 : 0, transition: 'opacity 0.15s', pointerEvents: isHovered ? 'auto' : 'none' }}>
                <HideSpamButtons onHide={() => onHide(id)} onSpam={() => onSpam(id)} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Collectibles sub-tab ─────────────────────────────────────────────────────

interface CollectiblesViewProps {
  hiddenItems: Set<string>
  spamItems: Set<string>
  onHide: (id: string) => void
  onSpam: (id: string) => void
  onShowManager: () => void
  onNftsLoaded: (nfts: WalletCollectible[]) => void
}

function CollectiblesView({ hiddenItems, spamItems, onHide, onSpam, onShowManager, onNftsLoaded }: CollectiblesViewProps) {
  const [result, setResult]   = useState<CollectiblesResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const notifiedRef = useRef(false)

  useEffect(() => {
    window.wallet.getCollectibles().then(r => {
      setResult(r)
      setLoading(false)
      if (!notifiedRef.current) { notifiedRef.current = true; onNftsLoaded(r.items) }
    })
  }, [onNftsLoaded])

  const hiddenCount = result ? result.items.filter(n => hiddenItems.has(nftKey(n)) || spamItems.has(nftKey(n))).length : 0
  const visible     = result ? result.items.filter(n => !hiddenItems.has(nftKey(n)) && !spamItems.has(nftKey(n))) : []

  if (loading) return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ width: '100%', paddingTop: '100%', background: 'var(--border)', animation: 'pulse 1.4s ease infinite' }} />
          <div style={{ padding: '8px 10px' }}>
            <div style={{ width: '70%', height: 9, background: 'var(--border)', borderRadius: 4, animation: 'pulse 1.4s ease infinite', marginBottom: 5 }} />
            <div style={{ width: '50%', height: 8, background: 'var(--border)', borderRadius: 4, animation: 'pulse 1.4s ease infinite' }} />
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {hiddenCount > 0 && (
        <button type="button" onClick={onShowManager}
          style={{ alignSelf: 'flex-end', fontSize: 10, padding: '3px 10px', borderRadius: 99, background: 'rgba(100,116,139,0.15)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontWeight: 600 }}>
          Hidden ({hiddenCount})
        </button>
      )}

      {visible.length === 0 && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          {result?.items.length ? 'All collectibles are hidden.' : 'No collectibles found.'}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {visible.map(nft => {
          const id = nftKey(nft)
          const isHovered = hovered === id
          return (
            <div key={id}
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', transition: 'border-color var(--transition)', position: 'relative' }}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
            >
              <div style={{ width: '100%', paddingTop: '100%', position: 'relative', background: 'rgba(0,0,0,0.3)' }}>
                {nft.image ? (
                  <img src={nft.image} alt={nft.name}
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 28 }}>🖼</div>
                )}
                {isHovered && (
                  <div style={{ position: 'absolute', top: 6, right: 6 }}>
                    <HideSpamButtons onHide={() => onHide(id)} onSpam={() => onSpam(id)} />
                  </div>
                )}
              </div>
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nft.name}</div>
                {nft.collectionName && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{nft.collectionName}</div>
                )}
                <div style={{ marginTop: 4 }}>
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: `${nft.chainColor}22`, color: nft.chainColor, fontWeight: 600 }}>{nft.chainLabel}</span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

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
  const [portfolioTab, setPortfolioTab]     = useState<PortfolioTab>('balances')
  const [seedWords, setSeedWords]           = useState<string[]>([])
  const [deleting, setDeleting]             = useState(false)
  const [sendChain, setSendChain]           = useState<string | null>(null)

  // Spam filter state — persisted per account
  const acctIdx = addresses.accountIndex ?? 0
  const hiddenKey = `mmw_hidden_${acctIdx}`
  const spamKey   = `mmw_spam_${acctIdx}`
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(() => loadSet(hiddenKey))
  const [spamItems,   setSpamItems]   = useState<Set<string>>(() => loadSet(spamKey))
  const [showManager, setShowManager] = useState(false)
  const [allTokens,   setAllTokens]   = useState<WalletToken[]>([])
  const [allNfts,     setAllNfts]     = useState<WalletCollectible[]>([])

  const hideItem = useCallback((id: string) => {
    setHiddenItems(prev => { const next = new Set(prev).add(id); saveSet(hiddenKey, next); return next })
  }, [hiddenKey])

  const markSpam = useCallback((id: string) => {
    setSpamItems(prev => { const next = new Set(prev).add(id); saveSet(spamKey, next); return next })
  }, [spamKey])

  const restoreItem = useCallback((id: string) => {
    setHiddenItems(prev => { const next = new Set(prev); next.delete(id); saveSet(hiddenKey, next); return next })
    setSpamItems(prev  => { const next = new Set(prev);  next.delete(id); saveSet(spamKey, next);   return next })
  }, [hiddenKey, spamKey])

  const onTokensLoaded  = useCallback((tokens: WalletToken[])      => setAllTokens(tokens),  [])
  const onNftsLoaded    = useCallback((nfts: WalletCollectible[])   => setAllNfts(nfts),      [])

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

      {/* Portfolio sub-tab bar */}
      <div style={{ display: 'flex', gap: 4, background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius-sm)', padding: 3, flexShrink: 0 }}>
        {(['balances', 'tokens', 'collectibles'] as PortfolioTab[]).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setPortfolioTab(tab)}
            style={{
              flex: 1, padding: '6px 0', borderRadius: 6,
              border: `1px solid ${portfolioTab === tab ? 'var(--border-active)' : 'transparent'}`,
              background: portfolioTab === tab ? 'var(--accent-dim)' : 'transparent',
              color: portfolioTab === tab ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)',
              letterSpacing: '0.04em', transition: 'all var(--transition)',
              textTransform: 'capitalize'
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {portfolioTab === 'balances' && sortedChains(balances).map(chainId => (
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
      {portfolioTab === 'tokens' && (
        <TokensView
          hiddenItems={hiddenItems}
          spamItems={spamItems}
          onHide={hideItem}
          onSpam={markSpam}
          onShowManager={() => setShowManager(true)}
          onTokensLoaded={onTokensLoaded}
        />
      )}
      {portfolioTab === 'collectibles' && (
        <CollectiblesView
          hiddenItems={hiddenItems}
          spamItems={spamItems}
          onHide={hideItem}
          onSpam={markSpam}
          onShowManager={() => setShowManager(true)}
          onNftsLoaded={onNftsLoaded}
        />
      )}

      {/* Send modal */}
      {sendChain && (
        <SendModal
          chainId={sendChain}
          balance={activeSendBalance}
          symbol={activeSendSymbol}
          onClose={() => setSendChain(null)}
        />
      )}

      {/* Spam manager modal */}
      {showManager && (
        <SpamManagerModal
          hiddenItems={hiddenItems}
          spamItems={spamItems}
          allTokens={allTokens}
          allNfts={allNfts}
          onRestore={restoreItem}
          onClose={() => setShowManager(false)}
        />
      )}
    </div>
  )
}
