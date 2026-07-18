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

type EvmChainOption = { chainId: number; id: string; name: string; color: string }

const MAINNET_EVM_CHAINS: EvmChainOption[] = [
  { chainId: 1, id: 'ethereum', name: 'Ethereum', color: '#627EEA' },
  { chainId: 42161, id: 'arbitrum', name: 'Arbitrum One', color: '#28A0F0' },
  { chainId: 10, id: 'optimism', name: 'Optimism', color: '#FF0420' },
  { chainId: 8453, id: 'base', name: 'Base', color: '#0052FF' },
  { chainId: 137, id: 'polygon', name: 'Polygon', color: '#8247E5' },
  { chainId: 43114, id: 'avalanche', name: 'Avalanche', color: '#E84142' },
  { chainId: 81457, id: 'blast', name: 'Blast', color: '#FCFC03' },
  { chainId: 100, id: 'gnosis', name: 'Gnosis', color: '#04795B' },
  { chainId: 143, id: 'monad', name: 'Monad', color: '#836EF9' },
  { chainId: 2741, id: 'abstract', name: 'Abstract', color: '#6B7280' },
  { chainId: 33139, id: 'apechain', name: 'ApeChain', color: '#0066FF' },
  { chainId: 2020, id: 'ronin', name: 'Ronin', color: '#1273EA' },
  { chainId: 1868, id: 'soneium', name: 'Soneium', color: '#5B5EA6' },
  { chainId: 480, id: 'worldchain', name: 'WorldChain', color: '#1A1B1F' },
  { chainId: 7777777, id: 'zora', name: 'Zora', color: '#2B5DF0' },
  { chainId: 998, id: 'hyperevm', name: 'HyperEVM', color: '#00BF7D' },
]

const TESTNET_EVM_CHAINS: EvmChainOption[] = [
  { chainId: 11155111, id: 'ethereum', name: 'Ethereum Sepolia', color: '#627EEA' },
  { chainId: 421614, id: 'arbitrum', name: 'Arbitrum Sepolia', color: '#28A0F0' },
  { chainId: 11155420, id: 'optimism', name: 'OP Sepolia', color: '#FF0420' },
  { chainId: 84532, id: 'base', name: 'Base Sepolia', color: '#0052FF' },
  { chainId: 80002, id: 'polygon', name: 'Polygon Amoy', color: '#8247E5' },
  { chainId: 43113, id: 'avalanche', name: 'Avalanche Fuji', color: '#E84142' },
  { chainId: 168587773, id: 'blast', name: 'Blast Sepolia', color: '#FCFC03' },
  { chainId: 10200, id: 'gnosis', name: 'Gnosis Chiado', color: '#04795B' },
  { chainId: 10143, id: 'monad', name: 'Monad Testnet', color: '#836EF9' },
  { chainId: 11124, id: 'abstract', name: 'Abstract Testnet', color: '#6B7280' },
  { chainId: 33111, id: 'apechain', name: 'ApeChain Curtis', color: '#0066FF' },
  { chainId: 2021, id: 'ronin', name: 'Ronin Saigon', color: '#1273EA' },
  { chainId: 1946, id: 'soneium', name: 'Soneium Minato', color: '#5B5EA6' },
  { chainId: 4801, id: 'worldchain', name: 'World Chain Sepolia', color: '#1A1B1F' },
  { chainId: 999999999, id: 'zora', name: 'Zora Sepolia', color: '#2B5DF0' },
  { chainId: 998, id: 'hyperevm', name: 'HyperEVM Testnet', color: '#00BF7D' },
]

function fallbackChains(chainId: number): EvmChainOption[] {
  return TESTNET_EVM_CHAINS.some(c => c.chainId === chainId && chainId !== 998)
    ? TESTNET_EVM_CHAINS
    : MAINNET_EVM_CHAINS
}

function normalizeChains(chains: EvmChainOption[]): EvmChainOption[] {
  return chains
    .map(c => ({ ...c, chainId: Number(c.chainId) }))
    .filter(c => Number.isFinite(c.chainId) && c.name && c.color)
}

export function NetworkSwitcher({ compact = false }: { compact?: boolean } = {}) {
  const [chains, setChains] = useState<EvmChainOption[]>([])
  const [chainId, setChainId] = useState('0x1')

  useEffect(() => {
    window.wallet.web3GetChains().then(c => setChains(normalizeChains(c))).catch(() => setChains([]))
    window.wallet.web3GetChain().then(setChainId).catch(() => {})
    const onChange = (hex: string) => {
      setChainId(hex)
      // Testnet Mode flips swap the whole chain list (and push a chainChanged),
      // so refresh the options too — not just the selected pill.
      window.wallet.web3GetChains().then(c => setChains(normalizeChains(c))).catch(() => setChains([]))
    }
    window.wallet.onWeb3ChainChanged(onChange)
    return () => window.wallet.offWeb3ChainChanged(onChange)
  }, [])

  const numId = parseInt(chainId, 16)
  // The bridge's active list (web3GetChains) is authoritative for the current
  // mode — always use it when present. Only fall back to the id-based heuristic
  // when the bridge gave us nothing (a failed call). Previously this keyed off
  // "does the list contain the current id", so a STALE current id (e.g. a
  // leftover testnet chain after leaving Testnet/Privacy mode) flipped the whole
  // dropdown to the testnet list while in mainnet.
  const displayedChains = chains.length > 0 ? chains : fallbackChains(numId)
  const current = displayedChains.find(c => c.chainId === numId)
  const color = current?.color ?? '#22c55e'
  const label = current?.name ?? (Number.isFinite(numId) ? `Chain ${numId}` : 'Network')

  return (
    <div
      title={`Network: ${label}`}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 5,
        height: 34, padding: compact ? '0 7px' : '0 8px', background: 'transparent',
        border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
        flexShrink: 0, maxWidth: compact ? undefined : 180
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {/* Compact mode (in-browser toolbar): dot + chevron only, so the tab row
          below keeps its full width for scrollable, closable tabs. */}
      {!compact && (
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </span>
      )}
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
        {displayedChains.map(c => (
          <option key={c.id} value={c.chainId}>{c.name}</option>
        ))}
      </select>
    </div>
  )
}
