import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import type { AppPage, WalletAddresses, AllBalances, AllHistory, ChainHistory, TokensResult, CollectiblesResult, WalletToken, WalletCollectible, NftFloorPrice } from '../types/wallet'
import { ChainCard } from '../components/ChainCard'
import { SendModal } from '../components/SendModal'
import { AgwPanel } from '../components/AgwPanel'
import { HeaderToolbar } from '../components/HeaderToolbar'

type PortfolioTab = 'networks' | 'tokens' | 'collectibles'

// Small "Smart Wallet" chip shown on AGW-held tokens/NFTs so the user can tell
// which assets physically live in the Abstract Global Wallet (smart account).
function AgwBadge() {
  return (
    <span
      title="Held in your Abstract Global Wallet (smart account)"
      style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: 'rgba(31, 206, 146, 0.14)', color: '#1FCE92', fontWeight: 700, display: 'inline-block', letterSpacing: '0.02em' }}
    >
      ◆ Smart Wallet
    </span>
  )
}

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

        {/* Name · Ticker · Chain — three stacked rows */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {token.name}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
            {token.symbol}
          </div>
          <div style={{ marginTop: 3, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: `${token.chainColor}22`, color: token.chainColor, fontWeight: 600, display: 'inline-block' }}>
              {token.chainLabel}
            </span>
            {token.source === 'agw' && <AgwBadge />}
          </div>
        </div>

        {/* Balance · Native equiv · USD — three stacked rows aligned to right */}
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
            {token.balance} <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-secondary)' }}>{token.symbol}</span>
          </div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2, minHeight: 14 }}>
            {token.nativeEquivalent ?? ''}
          </div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', marginTop: 2, minHeight: 14 }}>
            {token.usdValue ?? ''}
          </div>
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
  result: TokensResult | null
  loading: boolean
  hiddenItems: Set<string>
  spamItems: Set<string>
  onHide: (id: string) => void
  onSpam: (id: string) => void
  onShowManager: () => void
}

function TokensView({ result, loading, hiddenItems, spamItems, onHide, onSpam, onShowManager }: TokensViewProps) {
  const [hovered, setHovered] = useState<string | null>(null)

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

// Native unit per chain, for showing a collection floor (e.g. "14500 MON").
const NFT_NATIVE_SYMBOL: Record<string, string> = {
  ethereum: 'ETH', arbitrum: 'ETH', optimism: 'ETH', base: 'ETH', blast: 'ETH',
  abstract: 'ETH', soneium: 'ETH', worldchain: 'ETH', zora: 'ETH',
  polygon: 'POL', avalanche: 'AVAX', gnosis: 'xDAI', apechain: 'APE', ronin: 'RON',
  monad: 'MON', solana: 'SOL', cardano: 'ADA', tron: 'TRX', dogecoin: 'DOGE',
}
const formatFloor = (n: number) => Number(n.toFixed(4)).toLocaleString('en-US')

function NftDetailModal({ nft, onClose }: { nft: WalletCollectible; onClose: () => void }) {
  const [floor, setFloor]     = useState<NftFloorPrice | null>(null)
  const [copying, setCopying] = useState<string | null>(null)

  useEffect(() => {
    // The collectible already carries a precomputed floor (nft.floorPrice / nft.usdValue)
    // from the eager floor valuation, which covers every chain (incl. Monad/Solana). Only
    // hit the per-NFT IPC as a fallback when the object has no floor at all.
    if (nft.floorPrice == null && nft.contractAddress) {
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
            {/* Precomputed floor on the object — covers every chain incl. Monad/Solana. */}
            {nft.floorPrice != null && (
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                Floor: {formatFloor(nft.floorPrice)} {NFT_NATIVE_SYMBOL[nft.chain] ?? ''}{nft.usdValue ? ` · ${nft.usdValue}` : ''}
              </span>
            )}
            {/* Fallback: per-NFT IPC lookup, only when the object had no floor. */}
            {nft.floorPrice == null && floor?.floor != null && (
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                Floor: {floor.floor} {floor.currency}
              </span>
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
  result: CollectiblesResult | null
  loading: boolean
  hiddenItems: Set<string>
  spamItems: Set<string>
  onHide: (id: string) => void
  onSpam: (id: string) => void
  onShowManager: () => void
  onSelectNft: (nft: WalletCollectible) => void
}

function CollectiblesView({ result, loading, hiddenItems, spamItems, onHide, onSpam, onShowManager, onSelectNft }: CollectiblesViewProps) {
  const [hovered, setHovered] = useState<string | null>(null)

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
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nft.name}</div>
                  {nft.usdValue && (
                    <div style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', flexShrink: 0 }}>{nft.usdValue}</div>
                  )}
                </div>
                {nft.collectionName && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{nft.collectionName}</div>
                )}
                <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 99, background: `${nft.chainColor}22`, color: nft.chainColor, fontWeight: 600 }}>{nft.chainLabel}</span>
                  {nft.source === 'agw' && <AgwBadge />}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 7d PnL chip — sits beside the portfolio total (e.g. "▼ 6.20%").
function PortfolioPnl({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const isUp = data[data.length - 1] >= data[0]
  const changePct = data[0] > 0 ? ((data[data.length - 1] - data[0]) / data[0]) * 100 : 0
  return (
    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-mono)', color: isUp ? '#22c55e' : '#ef4444', whiteSpace: 'nowrap' }}>
      {isUp ? '▲' : '▼'} {Math.abs(changePct).toFixed(2)}%
    </span>
  )
}

// Compact 7d sparkline — sits top-right, under the toolbar buttons.
function PortfolioSparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null
  const W = 150, H = 36
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * (H - 4) - 2}`)
    .join(' ')
  const isUp = data[data.length - 1] >= data[0]
  const color = isUp ? '#22c55e' : '#ef4444'
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
    </svg>
  )
}

interface Props {
  addresses: WalletAddresses
  onNavigate: (page: AppPage) => void
  onWalletDeleted: () => void
  hidden?: boolean
  onWcOpen?: () => void
  onProfile?: () => void
  onSettings?: () => void
  wcActiveSessions?: number
  wcPending?: boolean
}

const ALL_CHAINS = [
  'cardano', 'solana', 'bitcoin', 'polkadot', 'tron', 'dogecoin',
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
  if (chainId === 'tron')     return addresses.tron     || null
  if (chainId === 'dogecoin') return addresses.dogecoin || null
  return addresses.evm
}

export function DashboardPage({ addresses, onNavigate, onWalletDeleted, hidden = false, onWcOpen, onProfile, onSettings, wcActiveSessions = 0, wcPending = false }: Props) {
  const [localAddresses, setLocalAddresses] = useState(addresses)
  const [balances, setBalances]             = useState<AllBalances | null>(null)
  const [loading, setLoading]               = useState(true)
  const [refreshing, setRefreshing]         = useState(false)
  const [history, setHistory]               = useState<AllHistory | null>(null)
  const [accountSwitching, setAccountSwitching] = useState(false)
  const [portfolioTab, setPortfolioTab]     = useState<PortfolioTab>('networks')
  const [sendChain, setSendChain]           = useState<string | null>(null)

  // Spam filter state — persisted per account
  const acctIdx = addresses.accountIndex ?? 0
  const hiddenKey = `mmw_hidden_${acctIdx}`
  const spamKey   = `mmw_spam_${acctIdx}`
  const [hiddenItems, setHiddenItems] = useState<Set<string>>(() => loadSet(hiddenKey))
  const [spamItems,   setSpamItems]   = useState<Set<string>>(() => loadSet(spamKey))
  // Ids the floor-valuation should skip (hidden/spam) — kept fresh for fetches.
  const excludeRef = useRef<string[]>([...loadSet(hiddenKey), ...loadSet(spamKey)])
  useEffect(() => { excludeRef.current = [...hiddenItems, ...spamItems] }, [hiddenItems, spamItems])
  const [showManager, setShowManager] = useState(false)
  const [tokensResult, setTokensResult] = useState<TokensResult | null>(null)
  const [tokensLoading, setTokensLoading] = useState(true)
  const [collectibles, setCollectibles] = useState<CollectiblesResult | null>(null)
  const [collectiblesLoading, setCollectiblesLoading] = useState(true)
  // True once balances + tokens + collectibles have ALL finished their first load.
  // Gates the portfolio total so it shows one complete figure (not a "growing"
  // partial) on startup — and, once true, stays true so the silent 3-min refresh
  // updates the number in place instead of flashing "Calculating…" again.
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [selectedNft, setSelectedNft] = useState<WalletCollectible | null>(null)
  const allNfts = collectibles?.items ?? []

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

  const fetchCollectibles = useCallback(async (quiet = false) => {
    if (!quiet) setCollectiblesLoading(true)
    try {
      const result = await window.wallet.getCollectibles(excludeRef.current)
      setCollectibles(result)
    } catch (err) {
      console.error('Collectibles fetch failed', err)
    } finally {
      setCollectiblesLoading(false)
    }
  }, [])

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

  const fetchTokens = useCallback(async (quiet = false) => {
    if (!quiet) setTokensLoading(true)
    try {
      const result = await window.wallet.getTokens()
      setTokensResult(result)
    } catch (err) {
      console.error('Token fetch failed', err)
    } finally {
      setTokensLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBalances()
    fetchHistory()
    fetchTokens()
    fetchCollectibles()
  }, [fetchBalances, fetchHistory, fetchTokens, fetchCollectibles])

  // Mark the first complete load (all three resolved — flags clear even on error)
  // so the total can switch from "Calculating…" to the final figure, and stay there.
  useEffect(() => {
    if (!loading && !tokensLoading && !collectiblesLoading) setHasLoadedOnce(true)
  }, [loading, tokensLoading, collectiblesLoading])

  // Gentle background refresh every 5 minutes (immediate first load already ran on
  // mount, so there's no startup wait). Quiet — all fetchers run without setting their
  // loading flags, so tokens/NFTs/networks stay on screen (no skeleton flash, scroll
  // preserved) and the total doesn't revert to "Calculating…" (hasLoadedOnce stays true);
  // new data swaps in place when it resolves.
  useEffect(() => {
    const id = setInterval(() => {
      fetchBalances(true)
      fetchHistory()
      fetchTokens(true)
      fetchCollectibles(true)
    }, 300_000)
    return () => clearInterval(id)
  }, [fetchBalances, fetchHistory, fetchTokens, fetchCollectibles])

  const switchAccount = async (newIndex: number) => {
    if (newIndex < 0 || newIndex > 9 || accountSwitching) return
    setAccountSwitching(true)
    setHasLoadedOnce(false)
    setBalances(null)
    setHistory(null)
    setTokensResult(null)
    setCollectibles(null)
    try {
      const newAddresses = await window.wallet.setAccount(newIndex)
      setLocalAddresses(newAddresses)
      fetchBalances()
      fetchHistory()
      fetchTokens()
      fetchCollectibles()
    } catch (err) {
      console.error('Account switch failed', err)
    } finally {
      setAccountSwitching(false)
    }
  }

  // Memoized so it recomputes only when the underlying data changes — not on every
  // render (hover, tab switch). Iterating balances + all tokens + all NFTs (hundreds)
  // on each render was the source of the "calculating" lag.
  const totalUsd = useMemo(() => {
    if (!balances) return null

    const chainTotal = Object.values(balances.chains)
      .map(b => b?.usdValue ? parseFloat(b.usdValue.replace(/[$,]/g, '')) : 0)
      .reduce((a, b) => a + b, 0)

    const tokenTotal = (tokensResult?.tokens ?? [])
      .filter(t => {
        const k = tokenKey(t)
        return !hiddenItems.has(k) && !spamItems.has(k)
      })
      .map(t => t.usdValue ? parseFloat(t.usdValue.replace(/[$,]/g, '')) : 0)
      .reduce((a, b) => a + b, 0)

    // NFTs valued at collection floor (hidden/spam excluded).
    const nftTotal = (collectibles?.items ?? [])
      .filter(n => { const k = nftKey(n); return !hiddenItems.has(k) && !spamItems.has(k) })
      .map(n => n.usdValue ? parseFloat(n.usdValue.replace(/[$,]/g, '')) : 0)
      .reduce((a, b) => a + b, 0)

    const total = chainTotal + tokenTotal + nftTotal
    return total > 0 ? `$${total.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : null
  }, [balances, tokensResult, collectibles, hiddenItems, spamItems])

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
    <div className="page fade-in" style={{ gap: 0, padding: 0, overflow: 'hidden', position: 'relative', display: hidden ? 'none' : 'flex' }}>
      {/* Fixed header + divider — keeps the titlebar logo clear of scrolling content */}
      <div style={{ padding: '24px 20px 12px', flexShrink: 0, borderBottom: '1px solid var(--border)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 18 }}>Portfolio</h1>
          {!hasLoadedOnce ? (
            <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-muted)', marginTop: 4 }}>
              Calculating…
            </div>
          ) : totalUsd ? (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}>
                {totalUsd}
              </div>
              {balances?.portfolioSparkline && balances.portfolioSparkline.length > 1 && (
                <PortfolioPnl data={balances.portfolioSparkline} />
              )}
            </div>
          ) : null}
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

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 10 }}>
          <HeaderToolbar
            onWcOpen={onWcOpen}
            wcActiveSessions={wcActiveSessions}
            wcPending={wcPending}
            onRefresh={() => { fetchBalances(true); fetchHistory() }}
            refreshing={refreshing}
            onProfile={onProfile}
            onSettings={onSettings}
          />
          {balances?.portfolioSparkline && balances.portfolioSparkline.length > 1 && (
            <PortfolioSparkline data={balances.portfolioSparkline} />
          )}
        </div>
      </div>
      </div>{/* end fixed header */}

      {/* Scrollable content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 16px', display: 'flex', flexDirection: 'column', gap: 16, position: 'relative' }}>


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
      {portfolioTab === 'networks' && (() => {
        // The AGW smart-wallet card is interleaved with the regular chain cards
        // and sorted by USD value (then native) exactly like any other chain —
        // its value comes from the synthetic 'abstract-agw' balance entry.
        const usdOf = (id: string) => parseFloat(balances?.chains[id]?.usdValue?.replace(/[$,]/g, '') ?? '0') || 0
        const natOf = (id: string) => parseFloat(balances?.chains[id]?.native ?? '0') || 0
        const rows = sortedChains(balances).map(chainId => ({
          usd: usdOf(chainId),
          nat: natOf(chainId),
          node: (
            <ChainCard
              key={chainId}
              chainId={chainId}
              balance={balances?.chains[chainId] ?? null}
              address={getAddress(chainId, localAddresses)}
              altAddresses={chainId === 'bitcoin' && localAddresses ? [
                { label: 'Native SegWit · Payment', address: localAddresses.bitcoin },
                { label: 'Nested SegWit', address: localAddresses.bitcoinNested },
                { label: 'Taproot · Ordinals', address: localAddresses.bitcoinTaproot },
              ] : undefined}
              loading={loading}
              onSend={() => setSendChain(chainId)}
              history={historyFor(chainId)}
            />
          )
        }))
        rows.push({
          usd: usdOf('abstract-agw'),
          nat: natOf('abstract-agw'),
          node: (
            <AgwPanel
              key="abstract-agw"
              addresses={localAddresses}
              balance={balances?.chains['abstract-agw'] ?? null}
              onSend={() => setSendChain('abstract-agw')}
              onAgwChanged={(updated) => { setLocalAddresses(updated); fetchBalances(true); fetchTokens(); fetchCollectibles() }}
            />
          )
        })
        rows.sort((a, b) => (b.usd - a.usd) || (b.nat - a.nat))
        return rows.map(r => r.node)
      })()}
      {portfolioTab === 'tokens' && (
        <TokensView
          result={tokensResult}
          loading={tokensLoading}
          hiddenItems={hiddenItems}
          spamItems={spamItems}
          onHide={hideItem}
          onSpam={markSpam}
          onShowManager={() => setShowManager(true)}
        />
      )}
      {portfolioTab === 'collectibles' && (
        <CollectiblesView
          result={collectibles}
          loading={collectiblesLoading}
          hiddenItems={hiddenItems}
          spamItems={spamItems}
          onHide={hideItem}
          onSpam={markSpam}
          onShowManager={() => setShowManager(true)}
          onSelectNft={setSelectedNft}
        />
      )}

      </div>{/* end scrollable content */}

      {selectedNft && (
        <NftDetailModal nft={selectedNft} onClose={() => setSelectedNft(null)} />
      )}

      {/* Send modal */}
      {sendChain && (
        <SendModal
          chainId={sendChain === 'abstract-agw' ? 'abstract' : sendChain}
          source={sendChain === 'abstract-agw' ? 'agw' : 'eoa'}
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
          allTokens={tokensResult?.tokens ?? []}
          allNfts={allNfts}
          onRestore={restoreItem}
          onClose={() => setShowManager(false)}
        />
      )}
    </div>
  )
}
