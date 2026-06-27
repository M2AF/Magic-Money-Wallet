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

import { useState } from 'react'
import type { WalletAddresses, SwapMode } from '../types/wallet'
import { HeaderToolbar } from '../components/HeaderToolbar'
import { SwapModeToggle } from '../components/SwapModeToggle'
import { DexSwapWidget } from '../components/DexSwapWidget'
import { SimpleSwapWidget } from '../components/SimpleSwapWidget'

interface Props {
  addresses: WalletAddresses
  hidden?: boolean
  onWcOpen?: () => void
  wcActiveSessions?: number
  wcPending?: boolean
  onProfile?: () => void
  onSettings?: () => void
}

export function SwapPage({ addresses, hidden = false, onWcOpen, wcActiveSessions, wcPending, onProfile, onSettings }: Props) {
  const [mode, setMode] = useState<SwapMode>('dex')
  // Bump to force a fresh widget mount (full state reset) each time the mode flips.
  const [epoch, setEpoch] = useState(0)

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
        <HeaderToolbar
          onWcOpen={onWcOpen}
          wcActiveSessions={wcActiveSessions}
          wcPending={wcPending}
          onProfile={onProfile}
          onSettings={onSettings}
        />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '14px 16px 18px', display: 'flex', justifyContent: 'center' }}>
        {/* Centered, max-width column so the layout is identical across popup (400px),
            docked sidebar (fluid), and the resizable Electron window. */}
        <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'dex'
            ? <DexSwapWidget key={`dex-${epoch}`} addresses={addresses} active={!hidden} onUseCrossChain={() => switchMode('crosschain')} />
            : <SimpleSwapWidget key={`ss-${epoch}`} addresses={addresses} active={!hidden} />}

          <SwapModeToggle mode={mode} onChange={switchMode} />
        </div>
      </div>
    </div>
  )
}
