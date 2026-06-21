import { useState } from 'react'
import type { WalletAddresses, ChainBalance } from '../types/wallet'

interface Props {
  addresses: WalletAddresses
  balance: ChainBalance | null     // abstract-agw native balance entry, if any
  onSend: () => void               // open the Send modal (source = AGW)
  onAgwChanged: (updated: WalletAddresses) => void
}

const AGW_GREEN = '#1FCE92'

/**
 * Abstract Global Wallet panel — the single home for the user's smart account:
 * shows its native ETH (which already counts toward the portfolio total), its
 * address (copy = receive), connection status, a Send action (when this wallet
 * can sign for it), and a manual-override editor for AGWs created with a
 * different signer (watch-only).
 */
export function AgwPanel({ addresses, balance, onSend, onAgwChanged }: Props) {
  const [copied, setCopied]   = useState(false)
  const [editing, setEditing] = useState(false)
  const [input, setInput]     = useState(addresses.agw ?? '')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const agw    = addresses.agw ?? null
  const owned  = addresses.agwOwned === true
  const acctIdx = addresses.accountIndex ?? 0

  const truncate = (a: string) => a.length > 16 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a

  const copyAddress = async () => {
    if (!agw) return
    await navigator.clipboard.writeText(agw)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const openPortal = () => {
    window.wallet.openBrowser()
    // Give the browser window a moment to create its web view, then navigate.
    setTimeout(() => { window.wallet.browserNavigate('https://portal.abs.xyz').catch(() => {}) }, 500)
  }

  const apply = async (address: string | null) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await window.wallet.setAgw(acctIdx, address)
      if (updated) onAgwChanged(updated)
      setEditing(false)
    } catch (err) {
      setError(String(err).replace('Error: ', ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="chain-card"
      style={{ ['--chain-color' as string]: AGW_GREEN, ['--chain-color-rgb' as string]: '31, 206, 146', borderColor: 'rgba(31,206,146,0.35)' }}
    >
      {/* Header */}
      <div className="chain-header">
        <div className="chain-info">
          <div className="chain-dot" />
          <div>
            <div className="chain-name" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              Abstract Smart Wallet
              {agw && (
                <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 99, fontWeight: 700, background: owned ? 'rgba(31,206,146,0.16)' : 'rgba(148,163,184,0.16)', color: owned ? AGW_GREEN : 'var(--text-muted)' }}>
                  {owned ? 'Connected' : 'Watch-only'}
                </span>
              )}
            </div>
            <div className="chain-networks">{agw ? 'Abstract Global Wallet (AGW)' : 'Not linked — add your AGW address'}</div>
          </div>
        </div>

        {/* Native balance */}
        {balance && !balance.error && (
          <div className="chain-balance">
            <div className="chain-amount">
              {balance.native} <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{balance.symbol}</span>
            </div>
            <div className="chain-usd">{balance.usdValue ?? '$0.00'}</div>
          </div>
        )}
      </div>

      {/* Address row (copy = receive) */}
      {agw && (
        <div className="address-chip" onClick={copyAddress} title={agw} style={{ cursor: 'pointer' }}>
          <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ flexShrink: 0, opacity: 0.5 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <span style={{ flex: 1 }}>{truncate(agw)}</span>
          {copied
            ? <svg width="11" height="11" fill="none" stroke="#22c55e" strokeWidth="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
            : <svg width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24" style={{ opacity: 0.4 }}><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          }
        </div>
      )}

      {/* Watch-only explainer — most AGWs are controlled by an Abstract/Privy
          signer, so this app can't sign for them directly; writes go via the portal. */}
      {agw && !owned && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 8 }}>
          Read-only here — this AGW is controlled by Abstract/Privy, not your wallet key. Open the portal to send or manage it.
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {owned ? (
          <button
            type="button"
            onClick={onSend}
            style={{ flex: 1, padding: '8px 12px', background: 'var(--accent-dim)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send ETH
          </button>
        ) : agw ? (
          <button
            type="button"
            onClick={openPortal}
            style={{ flex: 1, padding: '8px 12px', background: 'rgba(31,206,146,0.12)', border: '1px solid rgba(31,206,146,0.35)', borderRadius: 'var(--radius-sm)', color: AGW_GREEN, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            Open Abstract Portal ↗
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => { setEditing(e => !e); setInput(addresses.agw ?? ''); setError(null) }}
          style={{ flex: agw ? '0 0 auto' : 1, padding: '8px 12px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}
        >
          {editing ? 'Cancel' : agw ? 'Edit address' : 'Add address'}
        </button>
      </div>

      {/* Override editor */}
      {editing && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Auto-derived from your wallet. Paste a different AGW address if yours was created with email/social login (it will be watch-only — display works, but you can’t send from it).
          </div>
          <input
            className="input"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            placeholder="0x… Abstract Global Wallet address"
            value={input}
            spellCheck={false}
            onChange={e => setInput(e.target.value)}
          />
          {error && <div style={{ fontSize: 12, color: 'var(--error)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary" disabled={busy || !input.trim()} onClick={() => apply(input.trim())} style={{ flex: 1, fontSize: 12 }}>
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => apply(null)} style={{ flex: 1, fontSize: 12 }}>
              Use auto-derived
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
