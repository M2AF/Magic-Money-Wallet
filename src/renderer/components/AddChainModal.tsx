import { useEffect, useRef, useState } from 'react'
import type { CustomChain } from '../types/wallet'
import { ipcErrorMessage } from '../ipc-error'

interface Props {
  onClose: () => void
  /** Fired whenever the custom-chain list changes (add or remove). */
  onChanged: (chains: CustomChain[]) => void
}

/**
 * MetaMask-style "add a custom network" dialog. The main process verifies the
 * RPC actually answers eth_chainId with the typed chain id before saving, so a
 * typo can't create a network whose sends would land on the wrong chain.
 */
export function AddChainModal({ onClose, onChanged }: Props) {
  const [existing, setExisting] = useState<CustomChain[]>([])
  const [name, setName] = useState('')
  const [rpcUrl, setRpcUrl] = useState('')
  const [chainId, setChainId] = useState('')
  const [symbol, setSymbol] = useState('')
  const [explorer, setExplorer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const overlayRef = useRef<HTMLDivElement>(null)
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current && !busy) onClose()
  }

  useEffect(() => {
    window.wallet.getCustomChains?.().then(setExisting).catch(() => {})
  }, [])

  const canSubmit = name.trim() && rpcUrl.trim() && chainId.trim() && symbol.trim() && !busy

  const handleAdd = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const updated = await window.wallet.addCustomChain!({
        name: name.trim(),
        chainId: Number(chainId.trim()),
        nativeSymbol: symbol.trim(),
        rpcUrl: rpcUrl.trim(),
        explorerUrl: explorer.trim() || undefined
      })
      setExisting(updated)
      onChanged(updated)
      onClose()
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (id: string) => {
    try {
      const updated = await window.wallet.removeCustomChain!(id)
      setExisting(updated)
      onChanged(updated)
    } catch { /* keep the modal open; nothing to show */ }
  }

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
              Add a Network
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              Manually add any EVM-compatible chain
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close add network dialog"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-sm)' }}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div>
          <div className="label">Network Name</div>
          <input className="input" placeholder="e.g. Monad Mainnet" value={name}
            onChange={e => setName(e.target.value)} disabled={busy} spellCheck={false} />
        </div>

        <div>
          <div className="label">RPC URL</div>
          <input className="input" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            placeholder="https://rpc.example.com" value={rpcUrl}
            onChange={e => setRpcUrl(e.target.value)} disabled={busy} spellCheck={false} />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div className="label">Chain ID</div>
            <input className="input" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              placeholder="143" value={chainId} type="number" min="1" step="1"
              onChange={e => setChainId(e.target.value)} disabled={busy} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="label">Currency Symbol</div>
            <input className="input" placeholder="MON" value={symbol}
              onChange={e => setSymbol(e.target.value)} disabled={busy} spellCheck={false} />
          </div>
        </div>

        <div>
          <div className="label">Block Explorer URL <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-muted)' }}>(optional)</span></div>
          <input className="input" style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            placeholder="https://explorer.example.com" value={explorer}
            onChange={e => setExplorer(e.target.value)} disabled={busy} spellCheck={false} />
        </div>

        {error && (
          <div style={{ fontSize: 11, color: 'var(--error)', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-sm)', padding: '8px 10px' }}>
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleAdd}
          disabled={!canSubmit}
          style={{
            width: '100%', padding: '10px 12px',
            background: 'var(--accent-dim)', border: '1px solid var(--border-active)',
            borderRadius: 'var(--radius-sm)', color: 'var(--accent)',
            fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13,
            cursor: canSubmit ? 'pointer' : 'default', opacity: canSubmit ? 1 : 0.5,
            transition: 'all var(--transition)'
          }}
        >
          {busy ? 'Verifying RPC…' : 'Add Network'}
        </button>

        {/* Existing custom networks — with remove, so an add is never one-way */}
        {existing.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Your Custom Networks</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {existing.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#FFFFFF', flexShrink: 0, opacity: 0.85 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>ID {c.chainId} · {c.nativeSymbol}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(c.id)}
                    aria-label={`Remove ${c.name}`}
                    title="Remove network"
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
