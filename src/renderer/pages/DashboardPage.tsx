import { useState, useEffect, useCallback, useRef } from 'react'
import type { AppPage, WalletAddresses, AllBalances, AllHistory, ChainHistory, TokensResult, CollectiblesResult, WalletToken, WalletCollectible, NftFloorPrice } from '../types/wallet'
import { ChainCard } from '../components/ChainCard'
import { SendModal } from '../components/SendModal'

type PortfolioTab = 'networks' | 'tokens' | 'collectibles'

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
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

// ─── Token row ────────────────────────────────────────────────────────────────

function TokenLogo({ token }: { token: WalletToken }) {
  const [imgFailed, setImgFailed] = useState(false)
  if (token.logoUri && !imgFailed) {
    return (
      <img
        src={token.logoUri} alt={token.symbol} width={34} height={34}
        style={{ borderRadius: '50%', flexShrink: 0, objectFit: 'cover' }}
        onError={() => setImgFailed(true)}
      />
    )
  }
  return (
    <div style={{ width: 34, height: 34, borderRadius: '50%', background: `${token.chainColor}33`, border: `1px solid ${token.chainColor}55`, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: token.chainColor }}>{token.symbol.slice(0, 2).toUpperCase()}</span>
    </div>
  )
}

interface TokenRowProps {
  token: WalletToken
  isHovered: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
  onHide: () => void
  onSpam: () => void
}

function TokenRow({ token, isHovered, onMouseEnter, onMouseLeave, onHide, onSpam }: TokenRowProps) {
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: 0 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Card */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'var(--bg-card)', border: `1px solid ${isHovered ? 'var(--border-active)' : 'var(--border)'}`, borderRadius: 10, transition: 'border-color var(--transition)', minWidth: 0 }}>
        <TokenLogo token={token} />

        {/* Name + chain */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{token.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{token.symbol}</span>
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: `${token.chainColor}22`, color: token.chainColor, fontWeight: 600 }}>{token.chainLabel}</span>
          </div>
        </div>

        {/* Quantity / native equiv / USD — full right edge */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            {token.balance} <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-secondary)' }}>{token.symbol}</span>
          </div>
          {token.nativeEquivalent && (
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 1 }}>{token.nativeEquivalent}</div>
          )}
          {token.usdValue && (
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: 1 }}>{token.usdValue}</div>
          )}
        </div>
      </div>

      {/* Action buttons — only mounted on hover so they take zero layout space otherwise */}
      {isHovered && (
        <div style={{ marginLeft: 3 }}>
          <HideSpamButtons onHide={onHide} onSpam={onSpam} />
        </div>
      )}
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
          <TokenRow
            key={id}
            token={token}
            isHovered={isHovered}
            onMouseEnter={() => setHovered(id)}
            onMouseLeave={() => setHovered(null)}
            onHide={() => onHide(id)}
            onSpam={() => onSpam(id)}
          />
        )
      })}
    </div>
  )
}

// ─── IPFS image with gateway fallbacks ───────────────────────────────────────

// Ordered by reliability — dweb.link is deprioritised (HTTP/2 stream resets under load)
const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://4everland.io/ipfs/',
  'https://dweb.link/ipfs/',
]

const IPFS_PREFIXES = [
  'https://ipfs.io/ipfs/',
  'https://dweb.link/ipfs/',
  'https://cloudflare-ipfs.com/ipfs/',
  'https://cf-ipfs.com/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
  'https://nftstorage.link/ipfs/',
  'https://4everland.io/ipfs/',
  'https://gateway.ipfs.io/ipfs/',
]

function ipfsHash(url: string): string | null {
  if (url.startsWith('ipfs://')) return url.slice('ipfs://'.length)
  for (const p of IPFS_PREFIXES) {
    if (url.startsWith(p)) return url.slice(p.length)
  }
  const m = url.match(/\/ipfs\/([a-zA-Z0-9].*)/)
  return m ? m[1] : null
}

function NftImage({ src, alt }: { src: string; alt: string }) {
  const [gatewayIdx, setGatewayIdx] = useState(0)
  const [failed, setFailed] = useState(false)

  const hash = ipfsHash(src)
  const resolved = hash ? `${IPFS_GATEWAYS[gatewayIdx]}${hash}` : src

  function handleError() {
    if (hash && gatewayIdx < IPFS_GATEWAYS.length - 1) {
      setGatewayIdx(g => g + 1)
    } else {
      setFailed(true)
    }
  }

  if (failed) return <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 28 }}>🖼</div>

  return (
    <img
      key={resolved}
      src={resolved}
      alt={alt}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      onError={handleError}
    />
  )
}

// ─── NFT Detail Modal ─────────────────────────────────────────────────────────

function NftDetailModal({ nft, onClose }: { nft: WalletCollectible; onClose: () => void }) {
  const [floor, setFloor]     = useState<NftFloorPrice | null>(null)
  const [copying, setCopying] = useState<string | null>(null)

  useEffect(() => {
    // Load floor price async — only for EVM chains where OpenSea has coverage
    const evmChains = ['ethereum','arbitrum','optimism','base','polygon','avalanche','blast','zora','abstract']
    if (evmChains.includes(nft.chain) && nft.contractAddress) {
      window.wallet.getNftFloor(nft.chain, nft.contractAddress).then(setFloor).catch(() => {})
    }
    // Prevent body scroll
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [nft])

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopying(key)
      setTimeout(() => setCopying(null), 1200)
    })
  }

  function downloadImage() {
    if (!nft.image) return
    const a = document.createElement('a')
    a.href = nft.image
    a.download = `${nft.name.replace(/[^a-z0-9]/gi, '_')}.jpg`
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.click()
  }

  const short = (s: string, n = 10) => s.length <= n * 2 + 3 ? s : `${s.slice(0, n)}…${s.slice(-n)}`

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.82)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-dark)', border: '1px solid var(--border)',
          borderRadius: 16, width: '100%', maxWidth: 480,
          maxHeight: '90vh', overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(0,0,0,0.7)'
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 0' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{nft.name}</div>
            {nft.collectionName && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>{nft.collectionName}</div>
            )}
          </div>
          <button
            type="button" onClick={onClose}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
          >✕</button>
        </div>

        {/* Scrollable body */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '12px 16px 16px' }}>

          {/* Image */}
          <div style={{ width: '100%', paddingTop: '100%', position: 'relative', background: 'rgba(0,0,0,0.4)', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
            {nft.image
              ? <NftImage src={nft.image} alt={nft.name} />
              : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 40 }}>🖼</div>
            }
          </div>

          {/* Chain + floor row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 99, background: `${nft.chainColor}22`, color: nft.chainColor, fontWeight: 700 }}>{nft.chainLabel}</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{nft.contractType}</span>
            {floor?.floor != null && (
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                Floor: {floor.floor} {floor.currency}
              </span>
            )}
            {floor === null && ['ethereum','arbitrum','optimism','base','polygon','avalanche','blast','zora','abstract'].includes(nft.chain) && (
              <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>Loading floor…</span>
            )}
          </div>

          {/* Description */}
          {nft.description && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>{nft.description}</p>
          )}

          {/* Meta fields */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {[
              { label: 'Token ID', value: nft.tokenId, key: 'tokenId' },
              { label: 'Contract', value: nft.contractAddress, key: 'contract' },
            ].map(({ label, value, key }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)', borderRadius: 8, padding: '6px 10px' }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, minWidth: 60 }}>{label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {short(value, 12)}
                </span>
                <button
                  type="button"
                  onClick={() => copy(value, key)}
                  style={{ background: 'none', border: 'none', color: copying === key ? 'var(--success)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 2, flexShrink: 0 }}
                  title="Copy"
                >
                  {copying === key ? '✓' : '⎘'}
                </button>
              </div>
            ))}
          </div>

          {/* Traits */}
          {nft.traits && nft.traits.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 7 }}>Traits</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 6 }}>
                {nft.traits.map((t, i) => (
                  <div key={i} style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 8px' }}>
                    <div style={{ fontSize: 9, color: 'var(--accent-text)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{t.trait_type}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8 }}>
            {nft.image && (
              <button
                type="button" onClick={downloadImage}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8,
                  background: 'var(--accent-dim)', border: '1px solid var(--border-active)',
                  color: 'var(--accent-text)', fontSize: 12, fontWeight: 700,
                  fontFamily: 'var(--font-body)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6
                }}
              >
                <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download Image
              </button>
            )}
            {nft.animationUrl && (
              <button
                type="button"
                onClick={() => { window.wallet.openBrowser(); setTimeout(() => window.wallet.browserNavigate(nft.animationUrl!), 400) }}
                style={{
                  flex: 1, padding: '8px 0', borderRadius: 8,
                  background: 'var(--bg-surface)', border: '1px solid var(--border)',
                  color: 'var(--text-secondary)', fontSize: 12, fontWeight: 700,
                  fontFamily: 'var(--font-body)', cursor: 'pointer'
                }}
              >
                View Animation
              </button>
            )}
          </div>
        </div>
      </div>
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
  onSelectNft: (nft: WalletCollectible) => void
}

function CollectiblesView({ hiddenItems, spamItems, onHide, onSpam, onShowManager, onNftsLoaded, onSelectNft }: CollectiblesViewProps) {
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
        <div style={{ padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            {result?.items.length ? 'All collectibles are hidden.' : 'No collectibles found.'}
          </div>
          {result && Object.keys(result.chainResults ?? {}).length > 0 && (
            <div style={{ width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>Chain Diagnostics</div>
              {Object.entries(result.chainResults).map(([chain, info]) => (
                <div key={chain} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
                  <span style={{ color: 'var(--text-secondary)', minWidth: 80 }}>{chain}</span>
                  {info.error ? (
                    <span style={{ color: '#ef4444', fontFamily: 'var(--font-mono)', fontSize: 10, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.error}</span>
                  ) : (
                    <span style={{ color: info.count > 0 ? '#22c55e' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{info.count} NFTs</span>
                  )}
                </div>
              ))}
              {result.error && (
                <div style={{ marginTop: 4, fontSize: 10, color: '#ef4444', fontFamily: 'var(--font-mono)' }}>{result.error}</div>
              )}
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {visible.map(nft => {
          const id = nftKey(nft)
          const isHovered = hovered === id
          return (
            <div key={id}
              style={{ background: 'var(--bg-card)', border: `1px solid ${isHovered ? 'var(--border-active)' : 'var(--border)'}`, borderRadius: 10, overflow: 'hidden', transition: 'border-color var(--transition)', position: 'relative', cursor: 'pointer' }}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelectNft(nft)}
            >
              <div style={{ width: '100%', paddingTop: '100%', position: 'relative', background: 'rgba(0,0,0,0.3)' }}>
                {nft.image
                  ? <NftImage src={nft.image} alt={nft.name} />
                  : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 28 }}>🖼</div>
                }
                {isHovered && (
                  <div style={{ position: 'absolute', top: 6, right: 6 }} onClick={e => e.stopPropagation()}>
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
  onWcOpen?: () => void
  wcActiveSessions?: number
  wcPending?: boolean
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

export function DashboardPage({ addresses, onNavigate, onWalletDeleted, onWcOpen, wcActiveSessions = 0, wcPending = false }: Props) {
  const [localAddresses, setLocalAddresses] = useState(addresses)
  const [balances, setBalances]             = useState<AllBalances | null>(null)
  const [loading, setLoading]               = useState(true)
  const [refreshing, setRefreshing]         = useState(false)
  const [history, setHistory]               = useState<AllHistory | null>(null)
  const [accountSwitching, setAccountSwitching] = useState(false)
  const [showSettings, setShowSettings]     = useState(false)
  const [showSeed, setShowSeed]             = useState(false)
  const [portfolioTab, setPortfolioTab]     = useState<PortfolioTab>('networks')
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
  const [selectedNft, setSelectedNft] = useState<WalletCollectible | null>(null)

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
          {/* Sidebar toggle — extension only */}
          {!!(window as any).__EXT_SIDEBAR_FN__ && (
            <button
              type="button"
              onClick={() => (window as any).__EXT_SIDEBAR_FN__?.()}
              title={(window as any).__SIDE_PANEL__ ? 'Back to popup' : 'Open in sidebar'}
              style={{ width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              {(window as any).__SIDE_PANEL__ ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="2" width="14" height="12" rx="2"/><line x1="5" y1="2" x2="5" y2="14"/>
                  <polyline points="9,6 12,8 9,10"/>
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="1" y="2" width="14" height="12" rx="2"/><line x1="6" y1="2" x2="6" y2="14"/>
                  <polyline points="10,6 7,8 10,10"/>
                </svg>
              )}
            </button>
          )}
          {/* WalletConnect */}
          {onWcOpen && (
            <button
              type="button"
              onClick={onWcOpen}
              title="WalletConnect"
              style={{ width: 34, height: 34, borderRadius: 'var(--radius-sm)', background: wcActiveSessions > 0 ? 'var(--accent-dim)' : 'transparent', border: `1px solid ${wcActiveSessions > 0 ? 'var(--border-active)' : 'var(--border)'}`, color: wcActiveSessions > 0 ? 'var(--accent)' : 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
            >
              {wcPending && (
                <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: '50%', background: '#f97316', boxShadow: '0 0 5px #f97316' }} />
              )}
              <svg width="22" height="15" viewBox="0 0 480 360" fill="none" stroke="currentColor" strokeWidth="32" strokeLinecap="round">
                <path d="M98.3,120.1 C182.3,37.4 325.7,37.4 409.7,120.1 L419.8,130 C430.1,140.2 430.1,156.5 419.8,166.7 L387.9,198.2 C382.7,203.3 374.1,203.3 369,198.2 L355.1,184.5 C299.1,129.4 180.9,129.4 124.9,184.5 L110,198.2 C104.9,203.3 96.3,203.3 91.1,198.2 L60.2,166.7 C49.9,156.5 49.9,140.2 60.2,130 Z"/>
                <path d="M183.5,204.7 C222.6,166 278.5,166 317.6,204.7 L323.9,210.9 C334.2,221.1 334.2,237.4 323.9,247.6 L292.6,278.5 C287.5,283.6 278.9,283.6 273.7,278.5 L263.4,268.4 C247.3,252.5 232.7,252.5 216.6,268.4 L206.3,278.5 C201.1,283.6 192.5,283.6 187.4,278.5 L156.1,247.6 C145.8,237.4 145.8,221.1 156.1,210.9 Z"/>
              </svg>
            </button>
          )}
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
        {(['networks', 'tokens', 'collectibles'] as PortfolioTab[]).map(tab => (
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
      {portfolioTab === 'networks' && sortedChains(balances).map(chainId => (
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
          onSelectNft={setSelectedNft}
        />
      )}

      {selectedNft && (
        <NftDetailModal nft={selectedNft} onClose={() => setSelectedNft(null)} />
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
