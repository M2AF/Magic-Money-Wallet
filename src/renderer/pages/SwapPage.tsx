/**
 * SwapPage.tsx — dual-mode swap.
 *
 *   DEX Swap     — Phantom-style on-chain aggregator (0x/1inch/Jupiter via the
 *                  proxy), signed locally. <DexSwapWidget>.
 *   Cross-Chain  — SimpleSwap off-chain instant exchange (deposit-address
 *                  model, no local signing). <SimpleSwapWidget>.
 *
 * The toggle lives flush under the widget. Switching modes remounts the active
 * widget (via React key) so all field state resets, per spec.
 */

import { useState, useEffect } from 'react'
import type { WalletAddresses, SwapMode } from '../types/wallet'
import { HeaderToolbar } from '../components/HeaderToolbar'
import { SwapModeToggle } from '../components/SwapModeToggle'
import { DexSwapWidget } from '../components/DexSwapWidget'
import { SimpleSwapWidget } from '../components/SimpleSwapWidget'
import type { HeaderToolbarProps } from '../components/HeaderToolbar'

// The shared toolbar actions are carried as one bag (see HeaderToolbarProps)
// and spread below, so a new one reaches this page without an edit here.
interface Props extends HeaderToolbarProps {
  addresses: WalletAddresses
  hidden?: boolean
}

export function SwapPage({ addresses, hidden = false, ...toolbar }: Props) {
  const [mode, setMode] = useState<SwapMode>('dex')
  // Bump to force a fresh widget mount (full state reset) each time the mode flips.
  const [epoch, setEpoch] = useState(0)
  // Swap providers (0x/1inch/Jupiter/SimpleSwap/LI.FI) only operate on mainnets —
  // the whole tab is disabled while Testnet Mode is on so a "test" swap can't
  // create a real mainnet exchange.
  const [testnet, setTestnet] = useState(false)
  useEffect(() => { window.wallet.getTestnetMode().then(setTestnet).catch(() => {}) }, [])
  // Privacy Mode hides Swap too — no aggregator supports the privacy chains, and
  // routing XMR/ZEC through a swap provider would defeat the point of the mode.
  const [privacyMode, setPrivacyMode] = useState(false)
  useEffect(() => { window.wallet.getPrivacyMode?.().then(setPrivacyMode).catch(() => {}) }, [])

  const switchMode = (m: SwapMode) => { if (m !== mode) { setMode(m); setEpoch(e => e + 1) } }

  return (
    <div className="page fade-in" style={{ gap: 0, padding: 0, overflow: 'hidden', display: hidden ? 'none' : 'flex' }}>
      <div style={{ padding: '16px 16px 12px', flexShrink: 0, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <h1 className="page-title" style={{ fontSize: 18 }}>Swap</h1>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
            {mode === 'dex' ? 'On-chain swaps, best-price aggregated' : 'Cross-chain exchange via SimpleSwap'}
          </div>
        </div>
        <HeaderToolbar {...toolbar} />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '14px 16px 18px', display: 'flex', justifyContent: 'center' }}>
        {/* Centered, max-width column so the layout is identical across popup (400px),
            docked sidebar (fluid), and the resizable Electron window. */}
        <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {testnet || privacyMode ? (
            <div style={{
              marginTop: 24, padding: '22px 18px', textAlign: 'center',
              background: testnet ? 'rgba(245, 158, 11, 0.06)' : 'rgba(124, 58, 237, 0.06)',
              border: `1px solid ${testnet ? 'rgba(245, 158, 11, 0.3)' : 'rgba(124, 58, 237, 0.35)'}`,
              borderRadius: 'var(--radius-md)',
            }}>
              <div style={{ fontSize: 22, marginBottom: 8 }}>{testnet ? '🧪' : '🕶️'}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                {testnet ? 'Not available in Testnet Mode' : 'Not available in Privacy Mode'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {testnet
                  ? 'Swap providers only operate on mainnets. Turn Testnet Mode off in Settings to swap with real funds.'
                  : 'Swap providers don’t support the privacy networks. Turn Privacy Mode off in Settings to swap.'}
              </div>
            </div>
          ) : (
            <>
              {mode === 'dex'
                ? <DexSwapWidget key={`dex-${epoch}`} addresses={addresses} active={!hidden} onUseCrossChain={() => switchMode('crosschain')} />
                : <SimpleSwapWidget key={`ss-${epoch}`} addresses={addresses} active={!hidden} />}

              <SwapModeToggle mode={mode} onChange={switchMode} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}
