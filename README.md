# MagicMoney Wallet

A self-custody multi-chain desktop wallet built with Electron + React.

**Chains:** EVM (Ethereum · Arbitrum · Optimism · Base · Polygon · Avalanche · Blast · Gnosis · ApeChain · Ronin · Soneium · WorldChain · Zora · HyperEVM · Monad · Abstract) · Solana · Cardano · Bitcoin · Polkadot

---

## Setup

```bash
npm install
npm run dev
```

> The first `npm install` will download the Electron binary (~100 MB). Subsequent installs are fast.

### Prerequisites

- **Node.js 20+**
- **npm 10+**
- macOS (recommended), Windows, or Linux with `libsecret` installed

### Cardano support (optional)

Cardano address derivation requires a native binary:

```bash
npm install @emurgo/cardano-serialization-lib-nodejs
```

If this is omitted, the wallet works for EVM and Solana — Cardano cards show a "library not installed" notice.

---

## Project Structure

```
src/
├── main/                         ← Node.js / Electron main process (NEVER imports renderer)
│   ├── index.ts                  ← App entry, BrowserWindow, IPC window controls
│   ├── wallet-core.ts            ← BIP-39/32/44 derivation — private keys never leave here
│   ├── secure-store.ts           ← safeStorage wrapper (OS keychain encryption)
│   ├── balance-fetcher.ts        ← Alchemy, Helius, Blockfrost API calls
│   ├── chain-config.ts           ← RPC endpoints and chain metadata for all 18 networks
│   ├── market-fetcher.ts         ← CoinGecko price polling + in-memory cache
│   ├── tx-history.ts             ← Transaction history fetcher (Alchemy/Helius/Blockfrost)
│   ├── browser-manager.ts        ← Electron BrowserView lifecycle + Web3 provider injection
│   ├── walletconnect-manager.ts  ← WalletConnect Web3Wallet instance + session lifecycle
│   ├── privy-bridge.ts           ← Privy token exchange, JWT verification, profile sync
│   ├── supabase-sync.ts          ← Supabase client, cl_wallets upsert, profile reads
│   └── ipc-handlers.ts           ← Registers all wallet:* IPC handlers
├── preload/
│   ├── index.ts                  ← contextBridge — the ONLY surface between renderer and main
│   └── web3-inject.ts            ← window.ethereum + window.solana injection for dApp browser
└── renderer/                     ← React UI — never sees private keys or mnemonics
    ├── App.tsx                   ← Page router
    ├── main.tsx                  ← ReactDOM entry
    ├── index.html                ← Vite HTML template
    ├── index.css                 ← Global design tokens + component styles
    ├── types/
    │   └── wallet.ts             ← Shared interfaces + window.wallet type declaration
    ├── components/
    │   ├── AddressChip.tsx       ← Truncated address with copy-to-clipboard
    │   ├── ChainCard.tsx         ← Per-chain balance card
    │   ├── AssetGrid.tsx         ← NFT/token portfolio grid (list + card view)
    │   ├── SparklineChart.tsx    ← 7d price mini-chart per asset
    │   ├── AppHubCard.tsx        ← dApp directory tile (shared with ChainLens)
    │   ├── TxRow.tsx             ← Single transaction history row
    │   ├── BrowserBar.tsx        ← Built-in browser navigation controls
    │   ├── WCSessionsPanel.tsx   ← Active WalletConnect sessions list + disconnect UI
    │   └── ProfileBadge.tsx      ← ChainLens profile avatar + linked wallet count
    └── pages/
        ├── LoadingPage.tsx           ← Startup spinner
        ├── WelcomePage.tsx           ← Create / Import / Sign-in with ChainLens landing
        ├── CreatePage.tsx            ← Generate + display new seed phrase
        ├── ConfirmPage.tsx           ← Confirm backup before saving
        ├── ImportPage.tsx            ← 12/24-word import grid with paste support
        ├── DashboardPage.tsx         ← Live balances, settings, seed reveal
        ├── HistoryPage.tsx           ← Per-chain transaction history
        ├── PortfolioPage.tsx         ← NFT gallery + token holdings (Scanner)
        ├── MarketPage.tsx            ← Live prices, P&L, portfolio chart (Market Watch)
        ├── AppHubPage.tsx            ← Curated dApp directory (App Hub)
        ├── BrowserPage.tsx           ← Built-in dApp browser (BrowserView host)
        └── ProfilePage.tsx           ← ChainLens profile, linked wallets, Supabase sync
```

---

## Security Architecture

```
Renderer (React)                     Main Process (Node.js)
──────────────────────               ──────────────────────────────────
UI / balance display            ←──  Alchemy / Helius / Blockfrost APIs
window.wallet.getBalances()     ──►  IPC handler → balance-fetcher.ts
window.wallet.getHistory()      ──►  IPC handler → tx-history.ts
window.wallet.getPrices()       ──►  IPC handler → market-fetcher.ts (cached)
window.wallet.generate()        ──►  wallet-core.ts → returns word[] only
window.wallet.confirmBackup()   ──►  wallet-core.ts derive → safeStorage.encrypt

dApp Browser (BrowserView)           Main Process
──────────────────────               ──────────────────────────────────
window.ethereum (injected)      ──►  web3-inject.ts → IPC → wallet-core.ts
window.solana   (injected)      ──►  web3-inject.ts → IPC → wallet-core.ts
WalletConnect URI               ──►  walletconnect-manager.ts → IPC → wallet-core.ts
                                     Signs only after renderer confirms prompt

Identity Layer                       External Services
──────────────────────               ──────────────────────────────────
Privy token (safeStorage)       ──►  privy-bridge.ts → Privy API (verify + refresh)
Supabase RLS-scoped client      ──►  supabase-sync.ts → cl_users / cl_wallets / cl_linked_accounts
Derived addresses               ──►  upserted to cl_wallets on wallet create / import
ChainLens JWT                   ──►  passed to embedded wallet iframe via PostMessage (Phase 9)
```

**Key guarantees:**
- Mnemonic encrypted at rest via OS keychain (`safeStorage` = Windows Credential Manager / macOS Keychain / libsecret)
- Private keys exist only transiently in the main process during derivation
- The renderer never receives mnemonics or private keys — only public addresses and balance strings
- The dApp browser runs in a sandboxed `BrowserView` / `WebContentsView` — it cannot access the wallet renderer's DOM or memory
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` — renderer is fully sandboxed
- Privy JWT and Supabase session token stored in `safeStorage`, never in `localStorage`

---

## ChainLens Integration & Identity

MagicMoney and ChainLens share the same Privy app, the same Supabase project, and the same `cl_*` schema. This means a user's ChainLens profile and their MagicMoney wallet are the same identity — wallets added in one surface appear in the other automatically.

### Shared Auth: Privy

Both apps use the same **Privy App ID**. MagicMoney uses `@privy-io/js-sdk-core` (the framework-agnostic core, no React dependency) inside the Electron main process so that the Privy token is handled outside the renderer sandbox.

**Supported login methods (mirroring ChainLens):**
- EVM wallet sign (MetaMask, injected — useful if user already has an extension)
- Solana wallet sign
- Google OAuth (redirected through an Electron `shell.openExternal` + custom URI scheme callback)
- Discord OAuth (same redirect pattern)
- Embedded Privy wallet (email/SMS OTP flow rendered in a sandboxed `BrowserView`)

**Token lifecycle:**
1. User authenticates → Privy issues an access token + refresh token
2. Both tokens stored in `safeStorage` under `privy_access_token` and `privy_refresh_token`
3. `privy-bridge.ts` runs a background refresh timer (Privy access tokens expire in 6 hours)
4. On app start, if a stored token exists and is valid, the user is considered signed in and the sync flow runs immediately — no re-auth needed

**Privy user ID is the canonical identity key.** All Supabase rows are keyed by `privy_user_id`, matching the pattern already used in ChainLens.

### Shared Database: Supabase

MagicMoney connects to the **same Supabase project** as ChainLens using the same `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Row-level security (RLS) policies are enforced via the Privy-issued JWT, which Supabase accepts as the auth header — no separate Supabase auth session is required.

**Tables used (existing ChainLens schema, no migrations needed):**

| Table | MagicMoney usage |
|---|---|
| `cl_users` | Read display name + avatar for the Profile page; write display name if changed in wallet |
| `cl_wallets` | Upsert all derived addresses (EVM, Solana, Cardano, BTC, DOT) on wallet create/import; read to populate the "linked wallets" list in Profile |
| `cl_linked_accounts` | Read social OAuth links (Google, Discord) for profile display; write not needed — managed by ChainLens Privy flows |

**`cl_wallets` upsert payload on wallet create or import:**

```ts
{
  user_id:    privyUserId,          // FK → cl_users.id
  chain:      'evm' | 'solana' | 'cardano' | 'bitcoin' | 'polkadot',
  address:    derivedAddress,       // checksum EVM, base58 SOL, bech32 ADA, bc1 BTC, SS58 DOT
  account_index: 0,                 // BIP-44 account index (0–9)
  label:      `MagicMoney Account ${n}`,
  is_primary: accountIndex === 0,
  source:     'magicmoney'          // differentiates wallet-derived vs watch-only vs paste
}
```

### Profile Sync Flow

```
1. User opens MagicMoney → privy-bridge.ts checks safeStorage for valid token
2. If found: skip login, proceed to step 4
3. If not found: show ProfilePage login UI → Privy auth → store tokens in safeStorage
4. supabase-sync.ts reads cl_users to populate profile badge (avatar, display name)
5. wallet-core.ts derives all 5 chain addresses for each account (0–9)
6. supabase-sync.ts upserts cl_wallets rows for all derived addresses
7. ChainLens profile now shows MagicMoney accounts under "Linked Wallets" automatically
8. On balance scan, supabase-sync.ts optionally writes last_seen_balance to cl_wallets
   for lightweight cross-surface portfolio awareness (opt-in, off by default)
```

**Reverse sync (ChainLens → MagicMoney):** On app focus or a manual "Refresh Profile" tap, `supabase-sync.ts` reads all `cl_wallets` rows for the user. Wallets with `source = 'chainlens_paste'` or `source = 'chainlens_connect'` appear in a read-only "Watched from ChainLens" section in the MagicMoney Portfolio tab — balances are fetched live but no signing keys are available for those addresses.

### Anonymous / Seedphrase-Only Mode

Users who do not log in with Privy can still use MagicMoney fully for self-custody. In this mode:
- No Supabase sync occurs
- The Profile tab shows a "Connect to ChainLens" prompt
- WalletConnect still works (sessions are stored locally in `safeStorage`)
- Connecting Privy later merges the existing derived addresses into `cl_wallets` retroactively

---

## WalletConnect v2

WalletConnect is the second dApp connection layer alongside the injected `window.ethereum` / `window.solana` providers. Together they cover 100% of dApp connection patterns in the built-in browser and in ChainLens embedded mode.

| Method | Best for |
|---|---|
| `window.ethereum` injection | dApps that detect browser extensions via EIP-6963 or `window.ethereum` |
| `window.solana` injection | Solana dApps using wallet-adapter pattern |
| **WalletConnect v2** | dApps that show a QR code / URI, mobile-first dApps, WC-native dApps |

### Library

```bash
npm install @walletconnect/web3wallet @walletconnect/core
```

`walletconnect-manager.ts` runs in the **Electron main process** alongside `wallet-core.ts`. It creates a single `Web3Wallet` instance at app startup and keeps it alive for the session lifetime. The renderer never imports `@walletconnect/*` directly.

### Pairing Flow

```
1. User is on a dApp in BrowserPage — dApp shows a "Connect Wallet" modal with WC QR / URI
2. User clicks the WC icon in BrowserBar → "Paste WalletConnect URI" sheet appears in renderer
3. Renderer sends IPC: wallet:wc:pair({ uri })
4. walletconnect-manager.ts calls web3wallet.pair({ uri })
5. dApp sends a session_proposal → walletconnect-manager.ts fires IPC → renderer shows approval dialog
6. User approves → session established; dApp receives connected accounts + supported chains
7. Subsequent signing requests (personal_sign, eth_sendTransaction, etc.) route through the same
   native Electron dialog as window.ethereum requests
8. Active sessions stored in safeStorage via WalletConnect's built-in KeyValueStorage adapter
```

### Supported Namespaces

| Namespace | Chains |
|---|---|
| `eip155` | All 16 EVM chains (Ethereum + all L2s in chain-config.ts) |
| `solana` | Solana mainnet-beta |
| `cardano` | Planned (Phase 7+, pending WC Cardano namespace ratification) |

### Session Management

- **`WCSessionsPanel.tsx`** — accessible from the Browser tab toolbar; lists all active sessions (dApp name, icon, connected chains, connected address)
- Sessions persist across app restarts via `safeStorage`-backed `KeyValueStorage`
- Disconnect is available per-session from the panel or from the dApp side
- Session expiry (default 7 days per WC spec) shown as a countdown badge; auto-refreshed if the dApp sends a `session_update`

### WalletConnect in ChainLens Embedded Mode (Phase 9)

When MagicMoney runs as an iframe inside ChainLens, `window.ethereum` injection into sibling iframes is not possible. WalletConnect becomes the **primary dApp connection method** in that context:

- ChainLens calls `wallet.wcPair(uri)` via the PostMessage bridge
- The embedded wallet's `walletconnect-manager.ts` handles the session
- Signing prompts surface as a slide-in drawer within the ChainLens page (no separate Electron dialog)
- The same WC sessions are visible in both the embedded drawer and the standalone wallet if both are open

---

## API Keys

Your keys are stored in `config.json` inside Electron's `userData` directory (not in source code). The defaults in `secure-store.ts` are loaded only on first run — you can update them via the config IPC channel or by editing the generated config file.

| Key | Provider | Used for |
|---|---|---|
| `alchemyKey` | [alchemy.com](https://alchemy.com) | EVM balances, token counts, tx history |
| `heliusKey` | [helius.dev](https://helius.dev) | Solana balances, token counts, tx history |
| `blockfrostKey` | [blockfrost.io](https://blockfrost.io) | Cardano balances, token counts, tx history |
| `tatumKey` | [tatum.io](https://tatum.io) | Polkadot Substrate RPC gateway |
| `privyAppId` | [privy.io](https://privy.io) | Auth — shared with ChainLens (same App ID) |
| `supabaseUrl` | [supabase.com](https://supabase.com) | Profile sync — shared with ChainLens project |
| `supabaseAnonKey` | [supabase.com](https://supabase.com) | Supabase RLS-scoped access |
| `walletConnectProjectId` | [cloud.walletconnect.com](https://cloud.walletconnect.com) | WalletConnect v2 pairing |

> CoinGecko (prices, 24h change, sparklines) uses the free public API — no key required.

---

## Supported Networks

MagicMoney targets full parity with the ChainLens scanner. All 18 networks from the ChainLens App Hub are supported or planned:

| Network | Type | Native | RPC Provider | Status |
|---|---|---|---|---|
| Ethereum | EVM L1 | ETH | Alchemy | ✅ Live |
| Arbitrum | EVM L2 | ETH | Alchemy | ✅ Live |
| Optimism | EVM L2 | ETH | Alchemy | ✅ Live |
| Base | EVM L2 | ETH | Alchemy | ✅ Live |
| Polygon | EVM L2 | POL | Alchemy | ✅ Live |
| Avalanche | EVM L1 | AVAX | Alchemy | ✅ Live |
| Blast | EVM L2 | ETH | Alchemy | ✅ Live |
| Gnosis | EVM L1 | xDAI | Alchemy | ✅ Live |
| Monad | EVM L1 | MON | monad.xyz RPC | ✅ Live |
| Abstract | EVM L2 | ETH | Alchemy | ✅ Live |
| ApeChain | EVM L2 | APE | Alchemy | ✅ Live |
| Ronin | EVM L2 | RON | Alchemy | ✅ Live |
| Soneium | EVM L2 | ETH | Alchemy | ✅ Live |
| WorldChain | EVM L2 | WLD | Alchemy | ✅ Live |
| Zora | EVM L2 | ETH | Alchemy | ✅ Live |
| HyperEVM | EVM L1 | HYPE | hyperliquid.xyz RPC | ✅ Live |
| Solana | SVM | SOL | Helius | ✅ Live |
| Cardano | UTXO | ADA | Blockfrost | ✅ Live |
| Bitcoin | UTXO | BTC | mempool.space | ✅ Live |
| Polkadot | Substrate | DOT | Tatum Substrate RPC | ✅ Live |

---

## Build & Package

```bash
# Production build (outputs to out/)
npm run build

# Package as installable app (outputs to dist/)
npm run package

# ChainLens embed build (iframe widget, no Electron shell)
npm run build:embed
```

Outputs: `.dmg` (macOS), `.exe` installer (Windows), `.AppImage` (Linux).

---

## Roadmap

### ✅ Phase 1 — Foundation
- Seed generation (BIP-39), import, and display
- Multi-chain address derivation: EVM (BIP-44 m/44'/60'), Solana (m/44'/501'), Cardano (m/1852'/1815')
- OS-encrypted seed storage via `safeStorage`
- Live balance reads: EVM (Alchemy), Solana (Helius), Cardano (Blockfrost)

### ✅ Phase 2 — Send Transactions
- EVM send via `viem` `signTransaction` → Alchemy broadcast
- Solana send via `@solana/web3.js`
- Cardano send via Blockfrost UTXO selection + submit

### ✅ Phase 3 — History & Accounts
- Per-chain transaction history (incoming + outgoing, with explorer links)
- Multi-account support: `‹ Account N ›` switcher derives accounts by incrementing the BIP-44 account index (accounts 0–9)

### ✅ Phase 4 — Full Chain Parity
- Added all 16 EVM chains via Alchemy: Arbitrum, Optimism, Base, Polygon, Avalanche, Blast, Gnosis, Monad, Abstract, ApeChain, Ronin, Soneium, WorldChain, Zora, HyperEVM
- Added Bitcoin (BIP-84 P2WPKH) — balance via mempool.space, history via mempool.space
- Added Polkadot (SLIP-0010 ED25519, SS58) — balance via Tatum Substrate RPC + SCALE decode, history via Subscan
- 20 chains total: each fails independently, no global error propagation
- Auto-migration for existing wallets to populate new BTC/DOT address fields

### ✅ Phase 5 — Market Watch Integration
- ✅ Live market data via CoinGecko `/coins/markets` — price, 24h change %, 7d sparkline per chain
- ✅ Per-chain 24h price change badge (green ▲ / red ▼) in each chain card
- ✅ 7d sparkline mini-chart per chain card (SVG, chain brand color)
- ✅ 7d portfolio performance chart on dashboard (aggregated, deduplicates shared tokens across L2s)
- ✅ Portfolio total USD valuation displayed on the dashboard
- ✅ Market Watch tab — top 100 coins table (rank, name, price, 24h%, market cap, 7d sparkline) via CoinGecko
- ✅ Coin search — search any coin not in the top 100, results rendered in same table
- ✅ Chart modal — click any coin to open full price chart with 1D / 7D / 1M / 1Y / ALL timeframes + USD converter widget
- ✅ Tokens sub-tab — token holdings across all 14 Alchemy EVM chains + Solana SPL (Helius DAS) + Cardano native assets (Blockfrost)
- ✅ Collectibles sub-tab — NFT gallery (2-column grid) across Ethereum, Arbitrum, Base, Polygon and Optimism via Alchemy NFT API
- ✅ Spam filter — hide or mark-as-spam any token or collectible; persisted per account in localStorage; restoreable via Hidden manager
- ✅ Bottom navigation bar — Portfolio · Market · Browser (Phase 6 placeholder)
- ✅ Portfolio sub-tabs — Balances · Tokens · Collectibles within the portfolio view
- 📋 Cost basis tracking for P&L calculations (stored locally, never transmitted)

### ✅ Phase 6 — Built-in dApp Browser
- ✅ Electron `WebContentsView` panel (Electron 30+ modern API) — site-isolated from wallet UI
- ✅ Default homepage: `https://chainlensnft.info`
- ✅ Navigation controls: back · forward · reload · home · address bar in React chrome
- ✅ Injected `window.ethereum` EIP-1193 provider (via `web3-inject.ts` compiled with esbuild) — dApps can request wallet connection
- ✅ `eth_requestAccounts`, `personal_sign`, `eth_sendTransaction` — native Electron dialog for every approve
- ✅ Read-only JSON-RPC proxied to Alchemy ETH mainnet for `eth_blockNumber`, `eth_getBalance`, etc.
- ✅ Injected `window.solana` standard wallet adapter interface (connect + signMessage)
- ✅ Signing prompts route through a native Electron dialog — the browser tab cannot auto-approve
- ✅ Site isolation: `WebContentsView` runs in its own sandboxed renderer process
- ✅ Phishing detection: blocklist check on every navigation, dialog warn before allowing bypass
- ✅ Browser tab enabled in bottom nav — `showBrowser()` / `hideBrowser()` IPC on tab switch
- 📋 **WalletConnect v2 in the browser** — WC icon in BrowserBar → paste URI → pair and sign without leaving the wallet (see [WalletConnect v2](#walletconnect-v2) section)
- 📋 Active WC sessions panel accessible from the browser toolbar

### 📋 Phase 7 — App Hub Integration
- Embedded App Hub panel sourced from the shared `apphub-data.js` used by ChainLens
- 200+ curated dApps across 18 chains: Bridges, DeFi, DEX, Gaming, NFT Marketplaces, Launchpads
- Filter by chain (auto-highlights chains matching connected wallets) and category
- "Open" button launches the dApp in the Phase 6 built-in browser with wallet pre-connected via injected provider **or** WalletConnect, whichever the dApp supports
- App Hub data auto-refreshes when ChainLens pushes an updated `apphub-data.js`

### 📋 Phase 8 — NFT Portfolio & Asset Scanner
- Full NFT gallery powered by Alchemy NFT API (EVM), Helius Digital Assets API (Solana), and Blockfrost (Cardano) — mirrors ChainLens Scanner module
- Grid and list view toggle
- Spam / hide asset management with local blocklist (persisted in `userData`); optionally synced to Supabase `cl_wallets` metadata column for cross-device persistence
- Floor price display per collection (sourced from OpenSea / Magic Eden APIs)
- Token + NFT unified portfolio view with USD totals per chain
- Collection grouping and sort: by chain, value, or acquisition date

### 📋 Phase 9 — ChainLens Profile Sync & Privy Auth

This phase activates the shared identity layer described in the [ChainLens Integration & Identity](#chainlens-integration--identity) section above.

**Auth surface:**
- `ProfilePage.tsx` replaces the current placeholder with a full sign-in UI
- Privy login options: EVM wallet sign, Solana wallet sign, Google OAuth, Discord OAuth, Privy embedded wallet (email/SMS OTP)
- On first launch, `WelcomePage.tsx` gets a third option alongside Create / Import: **"Sign in with ChainLens"** — skips seed creation for users who want watch-only + identity mode

**Sync deliverables:**
- `privy-bridge.ts` — Privy JS SDK Core wrapper; token storage in `safeStorage`; background refresh; IPC handlers: `privy:login`, `privy:logout`, `privy:getUser`, `privy:getToken`
- `supabase-sync.ts` — Supabase JS client; uses Privy JWT as auth header; IPC handlers: `supabase:getProfile`, `supabase:upsertWallets`, `supabase:getLinkedWallets`
- Wallet create / import triggers automatic `cl_wallets` upsert for all derived addresses across all 5 chain types
- Profile tab shows ChainLens avatar, display name, linked social accounts, and full linked wallet list pulled from `cl_wallets`
- "Watched from ChainLens" section in Portfolio tab shows balances for wallets added via ChainLens but not locally derived

**ChainLens Embedded Mode:**
- `npm run build:embed` produces a self-contained iframe widget (no Electron shell)
- PostMessage bridge API: ChainLens calls `wallet.connect()`, `wallet.sign()`, `wallet.getBalances()`, `wallet.wcPair(uri)` across the iframe boundary
- ChainLens profile panel renders the embedded wallet as a slide-in drawer when a wallet is linked
- Shared auth: ChainLens Privy session token passed to the iframe → `privy-bridge.ts` validates it so the user does not re-auth
- WalletConnect v2 is the primary dApp connection method in embed mode (injected `window.ethereum` not available cross-origin)

### 📋 Phase 10 — Advanced Features
- **Token Swaps:** Aggregator-based swaps — Jupiter (Solana), Uniswap Universal Router (EVM), Minswap (Cardano)
- **Hardware Wallet:** Ledger support via WebHID (EVM + Solana); treat Ledger as a read-only account that routes signing back to the device
- **Address Book:** Named address entries per chain with ENS / SNS / ADA Handle resolution; synced to a new `cl_address_book` Supabase table for cross-surface availability
- **Watch-Only Mode:** Monitor any address without importing a seed — useful for cold storage tracking; watch-only addresses are written to `cl_wallets` with `source = 'magicmoney_watch'`
- **Push Notifications:** Electron tray notifications for incoming transactions above a configurable threshold
- **Multi-Sig Awareness:** Detect Safe (Gnosis) multi-sig addresses and surface pending transaction queues

### 📋 Phase 11 — Browser Extension

The long-term goal is to ship MagicMoney as a **browser extension** (Manifest V3) in addition to the desktop app, giving it reach parity with MetaMask and Phantom while retaining the same ChainLens identity layer.

**Architecture:**

```
Extension                            Background Service Worker
──────────────────────               ──────────────────────────────────
Popup UI (React, same components)    wallet-core.ts (ported, no Electron APIs)
window.ethereum injection            web3-inject.ts (content script)
window.solana injection              content script
WalletConnect v2                     background service worker (persistent via chrome.storage)
Privy auth                           popup → privy-bridge.ts (adapted for extension)
Supabase sync                        background → supabase-sync.ts (same logic)
```

**Key differences from desktop:**
- `safeStorage` replaced by `chrome.storage.session` (in-memory, cleared on browser close) for the decrypted seed and `chrome.storage.local` with `SecretService`-level encryption for persisted encrypted seed
- No Electron `BrowserView` — the injected `window.ethereum` and WalletConnect are the two dApp connection paths (there is no "built-in browser" in the extension; the user's existing tab is the browser)
- The extension popup is the full MagicMoney UI (Portfolio, Market, App Hub, Profile tabs) minus the Browser tab
- WalletConnect sessions are stored in `chrome.storage.local` and survive browser restarts

**Shared code strategy:**
- All business logic (wallet-core, balance-fetcher, market-fetcher, tx-history, walletconnect-manager, privy-bridge, supabase-sync) is written as pure TypeScript with no Electron imports
- Electron-specific adapters (`secure-store.ts`, `ipc-handlers.ts`, `browser-manager.ts`) are swapped for extension-specific adapters at build time via Vite aliases
- A single `npm run build:extension` target outputs the `dist/` directory ready for `chrome://extensions` sideload or Chrome Web Store submission
- Firefox (MV3 compatible) and Edge are secondary targets — same codebase, separate manifests

**Privy + Supabase in extension mode:**
- Privy login works identically — Google/Discord OAuth uses `chrome.identity.launchWebAuthFlow` instead of `shell.openExternal`
- Supabase sync is identical — the background service worker holds the Supabase client and the Privy JWT refresh loop
- The extension and the desktop wallet share the same `cl_wallets` rows — users see their balances everywhere without re-importing their seed

**Timeline:** Browser extension is planned after Phase 10 is stable. The embed build (Phase 9) serves as a stepping-stone — the same component isolation and PostMessage patterns used in the iframe become the foundation for the extension popup architecture.
