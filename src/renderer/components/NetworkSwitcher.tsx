/**
 * NetworkSwitcher.tsx — active EVM network selector for the extension popup.
 *
 * Shows the current EVM chain and lets the user switch it, which fires
 * chainChanged to connected dApps exactly like a dApp-initiated
 * wallet_switchEthereumChain. Drives the same window.wallet.web3* contract the
 * Electron browser chrome uses (web3GetChain / web3GetChains / web3SetChain /
 * onWeb3ChainChanged), so the chain state lives in the extension service worker.
 *
 * A native <select> overlay is used for the dropdown: it's simple, reliable, and
 * renders correctly inside the popup.
 */
import { useState, useEffect } from 'react'

export function NetworkSwitcher() {
  const [chains, setChains] = useState<Array<{ chainId: number; id: string; name: string; color: string }>>([])
  const [chainId, setChainId] = useState('0x1')

  useEffect(() => {
    window.wallet.web3GetChains().then(setChains).catch(() => {})
    window.wallet.web3GetChain().then(setChainId).catch(() => {})
    const onChange = (hex: string) => setChainId(hex)
    window.wallet.onWeb3ChainChanged(onChange)
    return () => window.wallet.offWeb3ChainChanged(onChange)
  }, [])

  const numId = parseInt(chainId, 16)
  const current = chains.find(c => c.chainId === numId)
  const color = current?.color ?? '#22c55e'
  const label = current?.name ?? (Number.isFinite(numId) ? `Chain ${numId}` : 'Network')

  return (
    <div
      title="Switch network"
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 5,
        height: 34, padding: '0 8px', background: 'transparent',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
        flexShrink: 0, maxWidth: 180
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {label}
      </span>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <polyline points="6 9 12 15 18 9" />
      </svg>
      <select
        aria-label="Switch network"
        value={Number.isFinite(numId) ? numId : ''}
        onChange={e => {
          const id = Number(e.target.value)
          if (Number.isFinite(id)) window.wallet.web3SetChain(id).then(setChainId).catch(() => {})
        }}
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          opacity: 0, cursor: 'pointer', border: 'none', colorScheme: 'dark'
        }}
      >
        {!current && <option value="" disabled>{label}</option>}
        {chains.map(c => (
          <option key={c.id} value={c.chainId}>{c.name}</option>
        ))}
      </select>
    </div>
  )
}
