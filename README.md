# MagicMoney Wallet

A self-custody multi-chain wallet by ChainLens, available as a **desktop app** (Electron) and **browser extension** (Chrome MV3).

**Chains:** EVM (Ethereum · Arbitrum · Optimism · Base · Polygon · Avalanche · Blast · Gnosis · ApeChain · Ronin · Soneium · WorldChain · Zora · HyperEVM · Monad · Abstract) · Solana · Cardano · Bitcoin · Polkadot

---

## Install

### Desktop App
Download the latest installer from [GitHub Releases](../../releases):
- **Windows** — `MagicMoney-Wallet-Setup-x.x.x.exe`
- **macOS** — `MagicMoney-Wallet-x.x.x.dmg`
- **Linux** — `MagicMoney-Wallet-x.x.x.AppImage`

The app checks for updates automatically and prompts you to restart when one is ready.

### Browser Extension
1. Download `magicmoney-extension-vx.x.x.zip` from [GitHub Releases](../../releases)
2. Unzip it
3. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the unzipped folder
4. Pin the extension from the toolbar

> Chrome Web Store submission is planned for the first public release.

---

## Development Setup

```bash
npm install
npm run dev          # Electron dev server with hot reload
```

**Prerequisites:** Node.js 20+, npm 10+

To build the browser extension in dev:
```bash
npm run build:extension
# Then load dist-extension/ as an unpacked extension in chrome://extensions
```

---

## API Keys

On first launch the app uses built-in free-tier keys. For production use, open **Settings** inside the wallet to enter your own keys. Keys are stored encrypted on-device — never transmitted.

| Key | Provider | Used for |
|---|---|---|
| `alchemyKey` | [alchemy.com](https://alchemy.com) | EVM balances, tokens, NFTs, tx history |
| `heliusKey` | [helius.dev](https://helius.dev) | Solana balances, SPL tokens, tx history |
| `blockfrostKey` | [blockfrost.io](https://blockfrost.io) | Cardano balances, native assets, NFTs |
| `moralisKey` | [moralis.io](https://moralis.io) | Monad NFTs |
| `walletConnectProjectId` | [cloud.walletconnect.com](https://cloud.walletconnect.com) | WalletConnect v2 pairing |

> CoinGecko (prices, sparklines) and DexScreener (token prices) use free public APIs — no key needed.
> Bitcoin and Polkadot use Tatum's public gateway — no key needed.

---

## Build & Release

```bash
# Development
npm run dev                    # Electron + hot reload
npm run build:extension        # Chrome extension → dist-extension/

# Production builds
npm run build                  # Electron build → out/
npm run package                # Electron installer → dist/
npm run package:publish        # Build + publish to GitHub Releases (requires GH_TOKEN)

# Release (bump version + tag + push → GitHub Actions builds everything)
npm run release:patch          # 0.1.0 → 0.1.1
npm run release:minor          # 0.1.0 → 0.2.0
npm run release:major          # 0.1.0 → 1.0.0
```

### Automated CI/CD

Pushing a version tag triggers `.github/workflows/release.yml`, which:
1. Builds the Electron app on Windows, macOS, and Linux in parallel
2. Publishes installers to GitHub Releases via `electron-builder --publish always`
3. Builds the Chrome extension and uploads the `.zip` to the same release

The release scripts handle the entire flow — bump, commit, tag, push, done.

---

## Browser Extension Architecture

The extension shares all business logic with the desktop app. Platform-specific adapters are swapped at build time via Vite aliases:

| Desktop | Extension |
|---|---|
| `safeStorage` (OS keychain) | `chrome.storage.local` (AES-256 encrypted mnemonic) |
| `ipc-handlers.ts` (Electron IPC) | `background.ts` (MV3 service worker) |
| `secure-store.ts` | `chrome-store.ts` |
| Electron `BrowserView` browser | User's existing browser tabs |

**Key extension behaviours:**
- **Password lock** — mnemonic encrypted with a user-set password at setup; re-enters locked state when the browser is restarted
- **dApp connectivity** — injects `window.ethereum` (EIP-1193), `window.solana`, and `window.cardano.magicmoney` (CIP-30) into every page via content script; also supports WalletConnect v2 via the popup UI
- **Sidebar mode** — click the panel icon in the Portfolio header to dock the wallet as a Chrome side panel (Phantom-style); click again to return to popup
- **Multi-account** — BIP-44 account index switcher (accounts 0–9) in the Portfolio header
- **Cardano** — fully supported via pure-JS `@noble/*` + `@scure/*` libraries; no native binary required

---

## Security Architecture

```
Renderer / Popup (React)              Main Process / Service Worker
──────────────────────────            ──────────────────────────────────
UI, balance display               ←── Alchemy / Helius / Blockfrost APIs
window.wallet.getBalances()       ──► IPC / sendMessage → balance-fetcher.ts
window.wallet.generate()          ──► wallet-core.ts → returns word[] only
window.wallet.confirmBackup()     ──► wallet-core.ts → derive → encrypted storage

dApp page (content script)            Background service worker
──────────────────────────            ──────────────────────────────────
window.ethereum (injected)        ──► content.ts → sendMessage → background.ts
window.solana   (injected)        ──► content.ts → sendMessage → background.ts
window.cardano.magicmoney (CIP-30)──► content.ts → sendMessage → background.ts
WalletConnect URI (popup UI)      ──► wc-ext.ts → @walletconnect/sign-client
```

**Key guarantees:**
- Mnemonic encrypted at rest — OS keychain (`safeStorage`) on desktop, AES-256 via a user password in the extension
- Private keys exist only transiently in the main process / service worker during signing
- The renderer / popup never receives mnemonics or private keys — only public addresses and balance strings
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` on desktop
- Extension content script runs in `MAIN` world for `window.ethereum` injection but has no access to wallet storage

---

## Cardano dApp Connectivity

MagicMoney implements **CIP-30** (the Cardano dApp connector standard) at `window.cardano.magicmoney`. This means any dApp or library that supports CIP-30 can connect to MagicMoney — including [weld](https://github.com/Cardano-Forge/weld), [Lucid](https://lucid.spacebudz.io/), and [Mesh.js](https://meshjs.dev/).

MagicMoney is listed in the **weld** wallet registry as key `magicmoney`.

**Supported CIP-30 methods:**
`getNetworkId` · `getBalance` · `getUtxos` · `getUsedAddresses` · `getUnusedAddresses` · `getChangeAddress` · `getRewardAddresses` · `signTx` · `signData` · `submitTx`

---

## Supported Networks

| Network | Type | Native | Provider | Status |
|---|---|---|---|---|
| Ethereum | EVM L1 | ETH | Alchemy | ✅ |
| Arbitrum | EVM L2 | ETH | Alchemy | ✅ |
| Optimism | EVM L2 | ETH | Alchemy | ✅ |
| Base | EVM L2 | ETH | Alchemy | ✅ |
| Polygon | EVM L2 | POL | Alchemy | ✅ |
| Avalanche | EVM L1 | AVAX | Alchemy | ✅ |
| Blast | EVM L2 | ETH | Alchemy | ✅ |
| Gnosis | EVM L1 | xDAI | Alchemy | ✅ |
| Abstract | EVM L2 | ETH | Alchemy | ✅ |
| ApeChain | EVM L2 | APE | Alchemy | ✅ |
| Ronin | EVM L2 | RON | Alchemy | ✅ |
| Soneium | EVM L2 | ETH | Alchemy | ✅ |
| WorldChain | EVM L2 | WLD | Alchemy | ✅ |
| Zora | EVM L2 | ETH | Alchemy | ✅ |
| Monad | EVM L1 | MON | monad.xyz RPC | ✅ |
| HyperEVM | EVM L1 | HYPE | hyperliquid.xyz RPC | ✅ |
| Solana | SVM | SOL | Helius | ✅ |
| Cardano | UTXO | ADA | Blockfrost | ✅ |
| Bitcoin | UTXO | BTC | Tatum | ✅ |
| Polkadot | Substrate | DOT | Tatum | ✅ |

---

## Project Structure

```
src/
├── main/                    ← Electron main process + shared business logic
│   ├── index.ts             ← App entry, BrowserWindow, auto-updater
│   ├── wallet-core.ts       ← BIP-39/32/44 derivation — private keys never leave here
│   ├── cardano-pure.ts      ← Pure-JS Cardano address derivation (CIP-3 Icarus + CIP-1852)
│   ├── cardano-cip30.ts     ← CIP-30 handler implementations (getUtxos, signTx, etc.)
│   ├── secure-store.ts      ← safeStorage wrapper (OS keychain)
│   ├── browser-manager.ts   ← Detached dApp browser popup (WebContentsView)
│   ├── balance-fetcher.ts   ← Alchemy, Helius, Blockfrost, Tatum
│   ├── chain-config.ts      ← RPC endpoints for all 20 networks
│   ├── market-fetcher.ts    ← CoinGecko + in-memory cache
│   ├── token-fetcher.ts     ← ERC-20 tokens, SPL tokens, Cardano assets, NFTs
│   ├── tx-history.ts        ← Transaction history (Alchemy / Helius / Blockfrost)
│   ├── tx-sender.ts         ← Send transactions (EVM / Solana / Cardano)
│   ├── supabase-sync.ts     ← ChainLens profile sync
│   ├── wc-client.ts         ← WalletConnect v2 (desktop)
│   └── ipc-handlers.ts      ← All wallet:* IPC handlers
├── preload/
│   ├── index.ts             ← contextBridge — only surface between renderer and main
│   └── web3-inject.ts       ← window.ethereum + window.solana for built-in browser
├── extension/               ← Extension-specific adapters (swap in via Vite aliases)
│   ├── background.ts        ← MV3 service worker (replaces ipc-handlers + main)
│   ├── chrome-store.ts      ← chrome.storage adapter (replaces secure-store)
│   ├── bridge.ts            ← window.wallet shim via chrome.runtime.sendMessage
│   ├── content.ts           ← Injects window.ethereum + window.solana into pages
│   ├── inject.ts            ← window.ethereum, window.solana, window.cardano (CIP-30), EIP-6963, Wallet Standard
│   ├── wc-ext.ts            ← WalletConnect v2 (extension)
│   ├── ExtApp.tsx           ← Extension popup wrapper (lock screen, password setup)
│   ├── popup.html/tsx       ← Extension popup entry
│   ├── sidepanel.html/tsx   ← Chrome side panel entry
│   └── manifest.json        ← MV3 manifest
└── renderer/                ← React UI (shared between desktop and extension)
    ├── App.tsx              ← Page router
    ├── pages/               ← DashboardPage, MarketPage, ProfilePage, etc.
    └── components/          ← Reusable UI components
```

---

## Updating the App Hub

The App Hub dApp list is sourced from the ChainLens project. To sync an updated list, just run:

```bash
node scripts/convert-apphub.js
```

The script automatically reads from `C:\Users\balla\Desktop\ChainLens\chainlens\app-hub-data.js` and regenerates `src/renderer/data/app-hub.ts`. Commit the updated file to apply the changes.

---

## Roadmap

- **Cardano tx chaining (`supportsTxChaining: true`)** — Currently `getUtxos()` queries Blockfrost, which only returns confirmed UTXOs. Tx chaining requires tracking submitted-but-unconfirmed UTXOs locally (merged with Blockfrost results) so dApps can chain multiple transactions without waiting for each to be confirmed on-chain. Eternl is currently the only wallet in the weld registry with this capability. Implementation requires: (1) caching new UTXOs from each `submitTx` call, (2) merging them into `getUtxos()` responses, (3) pruning once Blockfrost confirms them.
- **Chrome Web Store** — Public extension listing for first stable release.
