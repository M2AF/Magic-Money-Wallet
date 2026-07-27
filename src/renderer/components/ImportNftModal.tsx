import { useEffect, useRef, useState } from 'react'
import type { CustomChain, CustomNft, CustomNftPreview } from '../types/wallet'
import { ipcErrorMessage } from '../ipc-error'

interface Props {
  /** Custom networks available to import into (mainnet mode only). */
  chains: CustomChain[]
  onClose: () => void
  /** Fired whenever the imported-NFT list changes. */
  onChanged: (nfts: CustomNft[]) => void
}

/**
 * "Import NFT" for user-added networks — the ERC-721/1155 counterpart of
 * ImportTokenModal. NFTs on Blockscout explorers are detected automatically, so
 * this covers chains whose explorer has no usable API.
 *
 * Paste a contract and the wallet reads the artwork off-chain and shows it, so
 * the confirmation is visual rather than a hex address. Leaving Token ID blank
 * lists the tokens this wallet owns (Enumerable ERC-721 only); ERC-1155 has no
 * on-chain way to enumerate a holder's ids, so it needs an explicit id.
 */
export function ImportNftModal({ chains, onClose, onChanged }: Props) {
  const [chainId, setChainId] = useState(chains[0]?.id ?? '')
  const [contract, setContract] = useState('')
  const [tokenId, setTokenId] = useState('')
  const [preview, setPreview] = useState<CustomNftPreview | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState<CustomNft[]>([])

  const overlayRef = useRef<HTMLDivElement>(null)
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current && !busy) onClose()
  }

  useEffect(() => {
    window.wallet.getCustomNfts?.().then(setImported).catch(() => {})
  }, [])

  // Reading NFT metadata means several RPC calls plus an IPFS fetch, so this runs
  // on an explicit "Look up" press rather than while typing.
  const lookup = async () => {
    const addr = contract.trim()
    setPreview(null)
    setPicked(null)
    setError(null)
    if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) {
      setError('Enter a valid contract address (0x…)')
      return
    }
    setLoading(true)
    try {
      const r = await window.wallet.resolveCustomNft!(chainId, addr, tokenId.trim() || undefined)
      setPreview(r)
      setPicked(r.owned[0]?.tokenId ?? null)
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  const handleImport = async () => {
    if (!picked || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await window.wallet.importCustomNft!(chainId, contract.trim(), picked)
      setImported(updated)
      onChanged(updated)
      setContract('')
      setTokenId('')
      setPreview(null)
      setPicked(null)
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (n: CustomNft) => {
    try {
      const updated = await window.wallet.removeCustomNft!(n.chain, n.contractAddress, n.tokenId)
      setImported(updated)
      onChanged(updated)
    } catch { /* nothing actionable to show */ }
  }

  const nameOf = (id: string) => chains.find(c => c.id === id)?.name ?? id
  const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(6, 11, 24, 0.85)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
    >
      <div
        className="fade-in"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-active)', borderRadius: 'var(--radius-xl)', padding: '24px', width: '100%', maxWidth: '400px', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16 }}>
              Import an NFT
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              For NFTs your custom network doesn’t list automatically
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import NFT dialog"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)' }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div>
          <div className="label">Network</div>
          <select
            className="input"
            value={chainId}
            onChange={e => { setChainId(e.target.value); setPreview(null); setPicked(null) }}
            disabled={busy}
            style={{ width: '100%', cursor: 'pointer' }}
          >
            {chains.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <div className="label">NFT Contract Address</div>
          <input
            className="input"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            placeholder="0x…"
            value={contract}
            onChange={e => { setContract(e.target.value); setPreview(null); setPicked(null) }}
            disabled={busy}
            spellCheck={false}
          />
        </div>

        <div>
          <div className="label">
            Token ID <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>(optional for ERC-721)</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="input"
              style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              placeholder="Leave blank to list yours"
              value={tokenId}
              onChange={e => { setTokenId(e.target.value); setPreview(null); setPicked(null) }}
              disabled={busy}
              spellCheck={false}
            />
            <button
              type="button"
              onClick={lookup}
              disabled={loading || busy || !contract.trim()}
              style={{
                flexShrink: 0, padding: '0 14px', borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--border)', background: 'var(--bg-dark)',
                color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
                cursor: loading || busy || !contract.trim() ? 'default' : 'pointer',
                opacity: loading || busy || !contract.trim() ? 0.5 : 1
              }}
            >
              {loading ? '…' : 'Look up'}
            </button>
          </div>
        </div>

        {loading && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', border: '1px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            Reading the collection…
          </div>
        )}

        {/* Artwork preview — the point of the whole form: confirm by SEEING it */}
        {preview && !loading && (
          <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{preview.collectionName ?? 'Unnamed collection'}</span>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{preview.type}</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8 }}>
              {preview.owned.map(item => {
                const active = picked === item.tokenId
                return (
                  <button
                    key={item.tokenId}
                    type="button"
                    onClick={() => setPicked(item.tokenId)}
                    title={item.name}
                    aria-label={`Select token ${item.tokenId}`}
                    aria-pressed={active}
                    style={{
                      padding: 4, borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                      background: active ? 'var(--accent-dim)' : 'rgba(0,0,0,0.25)',
                      border: `1px solid ${active ? 'var(--border-active)' : 'var(--border)'}`,
                      display: 'flex', flexDirection: 'column', gap: 4,
                      transition: 'all var(--transition)'
                    }}
                  >
                    <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 5, overflow: 'hidden', background: 'rgba(255,255,255,0.04)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.name}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
                        />
                      ) : (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', padding: 4 }}>No image</span>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: active ? 'var(--accent)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      #{item.tokenId}
                    </div>
                  </button>
                )
              })}
            </div>
            {preview.owned.length > 1 && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                Pick which one to add — import again for others.
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ fontSize: 11, color: 'var(--error)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleImport}
          disabled={!picked || busy}
          style={{
            width: '100%', padding: '10px 12px',
            background: 'var(--accent-dim)', border: '1px solid var(--border-active)',
            borderRadius: 'var(--radius-sm)', color: 'var(--accent)',
            fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13,
            cursor: picked && !busy ? 'pointer' : 'default', opacity: picked && !busy ? 1 : 0.5,
            transition: 'all var(--transition)'
          }}
        >
          {busy ? 'Importing…' : picked ? `Import #${picked}` : 'Import NFT'}
        </button>

        {imported.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Imported NFTs</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {imported.map(n => (
                <div key={`${n.chain}:${n.contractAddress}:${n.tokenId}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      #{n.tokenId} <span style={{ fontWeight: 400, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>{shortAddr(n.contractAddress)}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{nameOf(n.chain)} · {n.type}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(n)}
                    aria-label={`Remove token ${n.tokenId}`}
                    title="Remove NFT"
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 4, display: 'flex' }}
                  >
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
