/**
 * Preview harness for the Abstract Global Wallet panel.
 *
 * Renders the REAL AgwPanel against props, one state per screen, so the
 * watch-only → import-signer → connected path can be reviewed visually.
 * Not shipped: this lives under scripts/ and is never an input to an app build.
 *
 * Why props and not the app: every interesting state needs a real AGW on
 * Abstract mainnet plus the exported portal signer key for it. The panel itself
 * is pure — it renders from `addresses` and calls window.wallet — so stubbing
 * that one bridge object covers every state honestly, including the failure the
 * backend returns when an imported key owns nothing.
 */
// The app's REAL stylesheet and theme tokens. ⚠ Not optional: a harness with its
// own colours hides contrast bugs (the Mono theme sets --accent to #ffffff),
// which is exactly what a themed panel like this one is at risk of.
import '../../src/renderer/index.css'
import { createRoot } from 'react-dom/client'
import { AgwPanel } from '../../src/renderer/components/AgwPanel'
import type { WalletAddresses, ChainBalance } from '../../src/renderer/types/wallet'

const params = new URLSearchParams(location.search)
document.documentElement.setAttribute('data-theme', params.get('theme') || 'midnight')

const AGW    = '0x8Bb7Bd4E5D0c2A5F9a3c1E7B6d4F2a8C0e9B1d3A'
const SIGNER = '0x5C1d9E7a3B2f4A6c8D0e2F4a6B8c0D2e4F6a8B0c'

// The bridge the panel talks to. `importAgwSigner` mirrors the real backend
// contract: it either returns the re-resolved address set, or throws the message
// the chain check produced (a key that owns nothing is rejected, not stored).
const stub = {
  setAgw: async () => null,
  removeAgwSigner: async () => null,
  importAgwSigner: async (_i: number, secret: string) => {
    await new Promise(r => setTimeout(r, 400))
    throw new Error('That key doesn’t own an Abstract smart wallet. In the Abstract portal use Settings → Export Signer Private Key.' + (secret ? '' : ''))
  },
  openBrowser: () => {},
  browserNavigate: async () => {},
}
;(window as unknown as { wallet: typeof stub }).wallet = stub
// The one state the panel can't reach through props: a bridge that predates the
// importer. ?legacy=1 drops the method so the watch-only fallback can be checked.
if (params.get('legacy') === '1') {
  delete (window as unknown as { wallet: Partial<typeof stub> }).wallet.importAgwSigner
}

const base: WalletAddresses = {
  evm: '0x1234567890abcdef1234567890abcdef12345678',
  solana: '', cardano: '', cardanoStake: '',
  bitcoin: '', bitcoinNested: '', bitcoinTaproot: '', polkadot: '',
  accountIndex: 0,
}

const balance: ChainBalance = {
  chainId: 'abstract-agw', name: 'Abstract Smart Wallet', symbol: 'ETH',
  native: '0.0431', usdValue: '$142.18',
} as ChainBalance

const STATES: Array<{ label: string; note: string; addresses: WalletAddresses; balance: ChainBalance | null }> = [
  {
    label: 'Watch-only (no signer imported)',
    note: 'What every portal-created AGW looked like before key export existed. Import is now the primary action.',
    addresses: { ...base, agw: AGW, agwOwned: false },
    balance,
  },
  {
    label: 'Connected via the imported signer',
    note: 'The portal signer owns the AGW, so Send is live and the signer row offers a one-click Remove.',
    addresses: { ...base, agw: AGW, agwOwned: true, agwSigner: SIGNER, agwSignerActive: true },
    balance,
  },
  {
    label: 'Not linked at all',
    note: 'No override, no on-chain link. Importing the signer alone finds the AGW — no address to paste.',
    addresses: { ...base },
    balance: null,
  },
  {
    label: 'Owned by this wallet’s own EOA',
    note: 'The pre-existing path: no imported key, so no signer row. Unchanged by this feature.',
    addresses: { ...base, agw: AGW, agwOwned: true },
    balance,
  },
]

createRoot(document.getElementById('root')!).render(
  <div style={{ minHeight: '100vh', padding: 24, display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 460 }}>
    {STATES.map(s => (
      <div key={s.label}>
        <div style={{ color: 'var(--text-secondary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{s.label}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11, lineHeight: 1.45, marginBottom: 10 }}>{s.note}</div>
        <AgwPanel addresses={s.addresses} balance={s.balance} onSend={() => {}} onAgwChanged={() => {}} />
      </div>
    ))}
  </div>
)
