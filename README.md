# MagicMoney Wallet

A self-custody multi-chain desktop wallet built with Electron + React.

**Chains:** EVM (Ethereum · Arbitrum · Optimism · Base · Polygon · Avalanche · Blast · Gnosis · ApeChain · Ronin · Soneium · WorldChain · Zora · HyperEVM · Monad · Abstract) · Solana · Cardano

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
    │   └── BrowserBar.tsx        ← Built-in browser navigation controls
    └── pages/
        ├── LoadingPage.tsx           ← Startup spinner
        ├── WelcomePage.tsx           ← Create / Import landing
        ├── CreatePage.tsx            ← Generate + display new seed phrase
        ├── ConfirmPage.tsx           ← Confirm backup before saving
        ├── ImportPage.tsx            ← 12/24-word import grid with paste support
        ├── DashboardPage.tsx         ← Live balances, settings, seed reveal
        ├── HistoryPage.tsx           ← Per-chain transaction history
        ├── PortfolioPage.tsx         ← NFT gallery + token holdings (Scanner)
        ├── MarketPage.tsx            ← Live prices, P&L, portfolio chart (Market Watch)
        ├── AppHubPage.tsx            ← Curated dApp directory (App Hub)
        └── BrowserPage.tsx           ← Built-in dApp browser (BrowserView host)
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
                                     Signs only after renderer confirms prompt
```

**Key guarantees:**
- Mnemonic encrypted at rest via OS keychain (`safeStorage` = Windows Credential Manager / macOS Keychain / libsecret)
- Private keys exist only transiently in the main process during derivation
- The renderer never receives mnemonics or private keys — only public addresses and balance strings
- The dApp browser runs in a sandboxed `BrowserView` / `WebContentsView` — it cannot access the wallet renderer's DOM or memory
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` — renderer is fully sandboxed

---

## API Keys

Your keys are stored in `config.json` inside Electron's `userData` directory (not in source code). The defaults in `secure-store.ts` are loaded only on first run — you can update them via the config IPC channel or by editing the generated config file.

| Key              | Provider                                   | Used for                              |
|------------------|--------------------------------------------|---------------------------------------|
| `alchemyKey`     | [alchemy.com](https://alchemy.com)         | EVM balances, tokens, tx history      |
| `heliusKey`      | [helius.dev](https://helius.dev)           | Solana balances, tokens, tx history   |
| `blockfrostKey`  | [blockfrost.io](https://blockfrost.io)     | Cardano balances, tokens, tx history  |
| `coingeckoKey`   | [coingecko.com](https://coingecko.com)     | Market prices + portfolio valuation   |

---

## Supported Networks

MagicMoney targets full parity with the ChainLens scanner. All 18 networks from the ChainLens App Hub are supported or planned:

| Network    | Type    | Native | RPC Provider          | Status    |
|------------|---------|--------|-----------------------|-----------|
| Ethereum   | EVM L1  | ETH    | Alchemy               | ✅ Live   |
| Arbitrum   | EVM L2  | ETH    | Alchemy               | ✅ Live   |
| Optimism   | EVM L2  | ETH    | Alchemy               | ✅ Live   |
| Base       | EVM L2  | ETH    | Alchemy               | ✅ Live   |
| Polygon    | EVM L2  | POL    | Alchemy               | ✅ Live   |
| Avalanche  | EVM L1  | AVAX   | Alchemy               | ✅ Live   |
| Blast      | EVM L2  | ETH    | Alchemy               | ✅ Live   |
| Gnosis     | EVM L1  | xDAI   | Public RPC            | ✅ Live   |
| Monad      | EVM L1  | MON    | Public RPC            | ✅ Live   |
| Abstract   | EVM L2  | ETH    | Public RPC            | ✅ Live   |
| ApeChain   | EVM L2  | APE    | Public RPC            | 🔄 Phase 4 |
| Ronin      | EVM L2  | RON    | Public RPC            | 🔄 Phase 4 |
| Soneium    | EVM L2  | ETH    | Public RPC            | 🔄 Phase 4 |
| WorldChain | EVM L2  | WLD    | Public RPC            | 🔄 Phase 4 |
| Zora       | EVM L2  | ETH    | Public RPC            | 🔄 Phase 4 |
| HyperEVM   | EVM L1  | HYPE   | Public RPC            | 🔄 Phase 4 |
| Solana     | SVM     | SOL    | Helius                | ✅ Live   |
| Cardano    | UTXO    | ADA    | Blockfrost            | ✅ Live   |

---

## Build & Package

```bash
# Production build (outputs to out/)
npm run build

# Package as installable app (outputs to dist/)
npm run package
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

### 🔄 Phase 3 — History & Accounts *(in progress)*
- Per-chain transaction history (incoming + outgoing + contract interactions)
- Multi-account support: derive additional accounts by incrementing the BIP-44 account index
- Account labels and per-account settings

### 🔄 Phase 4 — Full Chain Parity with ChainLens
- Add remaining 6 EVM chains: ApeChain, Ronin, Soneium, WorldChain, Zora, HyperEVM
- Dynamic RPC config: user-configurable custom RPC endpoints per chain
- Chain-aware gas estimation with EIP-1559 support per network
- Graceful degradation when a chain RPC is unavailable

### 📋 Phase 5 — Market Watch Integration
- Live token price feeds via CoinGecko (matching ChainLens Market Watch)
- Portfolio total USD valuation displayed on the dashboard
- Per-asset 24h price change indicator (green/red semantic color per ChainLens standard)
- Sparkline mini-charts (7d) per token holding
- Portfolio performance chart (line graph: 7d / 30d / all-time)
- Cost basis tracking for P&L calculations (stored locally, never transmitted)

### 📋 Phase 6 — Built-in dApp Browser
- Electron `BrowserView` / `WebContentsView` panel with a "Browse" button in the nav bar
- Default homepage: `https://chainlensnft.info`
- Navigation controls: back · forward · reload · home · address bar
- Injected `window.ethereum` EIP-1193 provider (via `web3-inject.ts` preload) — dApps can request wallet connection
- Injected `window.solana` standard wallet adapter interface
- Signing prompts route through a native Electron dialog — the browser tab cannot auto-approve
- Site isolation: `BrowserView` runs in a separate renderer process from the main wallet UI
- Phishing detection: warn on domains flagged by MetaMask's eth-phishing-detect list

### 📋 Phase 7 — App Hub Integration
- Embedded App Hub panel sourced from the shared `apphub-data.js` used by ChainLens
- 200+ curated dApps across 18 chains: Bridges, DeFi, DEX, Gaming, NFT Marketplaces, Launchpads
- Filter by chain (auto-highlights chains matching connected wallets) and category
- "Open" button launches the dApp in the Phase 6 built-in browser with wallet pre-connected
- App Hub data auto-refreshes when ChainLens pushes an updated `apphub-data.js`

### 📋 Phase 8 — NFT Portfolio & Asset Scanner
- Full NFT gallery powered by Alchemy NFT API (EVM), Helius Digital Assets API (Solana), and Blockfrost (Cardano) — mirrors ChainLens Scanner module
- Grid and list view toggle
- Spam / hide asset management with local blocklist (persisted in `userData`)
- Floor price display per collection (sourced from OpenSea / Magic Eden APIs)
- Token + NFT unified portfolio view with USD totals per chain
- Collection grouping and sort: by chain, value, or acquisition date

### 📋 Phase 9 — ChainLens Embedded Mode
- Separate build target (`npm run build:embed`) that outputs a self-contained iframe widget (no Electron shell)
- PostMessage bridge API: ChainLens web app can call `wallet.connect()`, `wallet.sign()`, `wallet.getBalances()` across the iframe boundary
- ChainLens profile panel renders the embedded wallet as a slide-in drawer when a wallet is linked
- Shared auth token flow: ChainLens session JWT passes to the embedded wallet for identity continuity
- WalletConnect v2 fallback for browser-based dApp connections (used in embed mode where `window.ethereum` injection is not available)

### 📋 Phase 10 — Advanced Features
- **Token Swaps:** Aggregator-based swaps — Jupiter (Solana), Uniswap Universal Router (EVM), Minswap (Cardano)
- **Hardware Wallet:** Ledger support via WebHID (EVM + Solana); treat Ledger as a read-only account that routes signing back to the device
- **Address Book:** Named address entries per chain with ENS / SNS / ADA Handle resolution
- **Watch-Only Mode:** Monitor any address without importing a seed — useful for cold storage tracking
- **Push Notifications:** Electron tray notifications for incoming transactions above a configurable threshold
- **Multi-Sig Awareness:** Detect Safe (Gnosis) multi-sig addresses and surface pending transaction queues