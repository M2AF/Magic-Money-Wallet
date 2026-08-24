import { useEffect, useRef, useState } from 'react'
import type { ImportChain, CustomToken } from '../types/wallet'
import { ipcErrorMessage } from '../ipc-error'

interface Props {
  /** Networks available to import into — built-in + user-added (mainnet only). */
  chains: ImportChain[]
  onClose: () => void
  /** Fired whenever the imported-token list changes. */
  onChanged: (tokens: CustomToken[]) => void
}

interface Resolved {
  name: string
  symbol: string
  decimals: number
  balance: string
}

/**
 * MetaMask-style "Import tokens", on any EVM network the wallet knows.
 *
 * Auto-detection covers most holdings — Alchemy on the built-in chains,
 * Blockscout on user-added ones — but it is provider-driven and misses things: a
 * fresh deploy, a thin-liquidity ERC-20, an explorer with no usable API. This is
 * the universal fallback: paste a contract address, confirm what the chain
 * itself reports, save.
 */
export function ImportTokenModal({ chains, onClose, onChanged }: Props) {
  const [chainId, setChainId] = useState(chains[0]?.id ?? '')
  const [contract, setContract] = useState('')
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [resolving, setResolving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imported, setImported] = useState<CustomToken[]>([])

  const overlayRef = useRef<HTMLDivElement>(null)
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current && !busy) onClose()
  }

  useEffect(() => {
    window.wallet.getCustomTokens?.().then(setImported).catch(() => {})
  }, [])

  // Look the contract up as soon as a full address is present, so the user sees
  // the symbol/balance the chain actually reports before committing.
  useEffect(() => {
    const addr = contract.trim()
    setResolved(null)
    setError(null)
    if (!chainId || !/^0x[0-9a-fA-F]{40}$/.test(addr)) return
    let cancelled = false
    setResolving(true)
    window.wallet.resolveCustomToken?.(chainId, addr)
      .then(r => { if (!cancelled) setResolved(r) })
      .catch(err => { if (!cancelled) setError(ipcErrorMessage(err)) })
      .finally(() => { if (!cancelled) setResolving(false) })
    return () => { cancelled = true }
  }, [contract, chainId])

  const handleImport = async () => {
    if (!resolved || busy) return
    setBusy(true)
    setError(null)
    try {
      const updated = await window.wallet.importCustomToken!(chainId, contract.trim())
      setImported(updated)
      onChanged(updated)
      setContract('')
      setResolved(null)
    } catch (err) {
      setError(ipcErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (t: CustomToken) => {
    try {
      const updated = await window.wallet.removeCustomToken!(t.chain, t.contractAddress)
      setImported(updated)
      onChanged(updated)
    } catch { /* nothing actionable to show */ }
  }

  const nameOf = (id: string) => chains.find(c => c.id === id)?.name ?? id

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
              Import a Token
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              For tokens the network doesn’t list automatically
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close import token dialog"
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
            aria-label="Network to import the token on"
            value={chainId}
            onChange={e => setChainId(e.target.value)}
            disabled={busy}
            style={{ width: '100%', cursor: 'pointer' }}
          >
            {chains.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div>
          <div className="label">Token Contract Address</div>
          <input
            className="input"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            placeholder="0x…"
            value={contract}
            onChange={e => setContract(e.target.value)}
            disabled={busy}
            spellCheck={false}
          />
        </div>

        {resolving && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', border: '1px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            Reading the contract…
          </div>
        )}

        {/* What the chain reports — the confirmation step before saving */}
        {resolved && !resolving && (
          <div style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{resolved.name}</span>
              <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--accent)' }}>{resolved.symbol}</span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span>Your balance</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{resolved.balance} {resolved.symbol}</span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {resolved.decimals} decimals · on {nameOf(chainId)}
            </div>
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
          disabled={!resolved || busy}
          style={{
            width: '100%', padding: '10px 12px',
            background: 'var(--accent-dim)', border: '1px solid var(--border-active)',
            borderRadius: 'var(--radius-sm)', color: 'var(--accent)',
            fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 13,
            cursor: resolved && !busy ? 'pointer' : 'default', opacity: resolved && !busy ? 1 : 0.5,
            transition: 'all var(--transition)'
          }}
        >
          {busy ? 'Importing…' : 'Import Token'}
        </button>

        {imported.length > 0 && (
          <div>
            <div className="label" style={{ marginBottom: 6 }}>Imported Tokens</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {imported.map(t => (
                <div key={`${t.chain}:${t.contractAddress}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {t.symbol} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {t.name}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{nameOf(t.chain)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(t)}
                    aria-label={`Remove ${t.symbol}`}
                    title="Remove token"
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
