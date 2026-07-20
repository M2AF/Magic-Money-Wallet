# Magic Money Wallet

A self-custody, multi-chain crypto wallet by **ChainLens** — one codebase shipping as a **desktop app** (Electron, Windows/macOS/Linux), **Chrome browser extension** (Manifest V3), and **Android app** (Capacitor).

It manages **22 default mainnet networks** from a single seed phrase, adds focused **Privacy Mode** and **Testnet Mode** network sets, connects to dApps (EVM, Solana, and Cardano), swaps tokens same-chain and cross-chain, and never lets your keys leave your device.

> **Ecosystems:** EVM · Solana · Cardano · Bitcoin · Polkadot · Tron · Dogecoin · Monero · Zcash · Midnight

---

## Highlights

- **One seed, 22 default chains** — BIP-39/32/44 derivation for EVM, Solana, Cardano, Bitcoin, Polkadot, Tron, and Dogecoin, all in one portfolio with a unified USD total.
- **Privacy Mode** — a focused portfolio for Monero (XMR), Zcash transparent (ZEC), and Midnight (NIGHT), derived lazily from the same mnemonic and kept mutually exclusive with Testnet Mode.
- **Testnet Mode** — flips the wallet to Sepolia / devnet / preprod / Bitcoin testnet / Shasta networks for no-real-funds testing, with testnet-safe address substitution where encodings differ.
- **Truly self-custody** — the mnemonic is encrypted at rest and private keys exist only transiently in the privileged process during signing. The UI layer never sees them.
- **No API keys to configure** — keyed providers are proxied through a hosted Cloudflare Worker, so the app works out of the box with **zero secrets shipped in the bundle**.
- **dApp ready** — injects `window.ethereum` (EIP-1193 / EIP-6963), `window.solana` (Wallet Standard), and `window.cardano.magicmoney` (CIP-30), plus the VESPR-authorized `window.cardano.vespr` compatibility key and WalletConnect v2.
- **Built-in swaps** — same-chain DEX aggregation and cross-chain bridging/exchange in one Swap page.
- **Multi-account** — BIP-44 account-index switcher (accounts 0–9) from the Portfolio header.
- **Abstract Global Wallet** — surfaces your AGW smart account inside the same portfolio total.
- **Platform-native unlocks** — Windows Hello, Touch ID, and Android biometrics can unlock an enrolled wallet while the password remains the backup.
- **Tor Mode for the built-in browser** — desktop downloads, verifies, and starts a private Tor runtime on first use; Android bundles Tor Android directly. Both verify the exit with the Tor Project and fail closed when Tor is unavailable; Android also verifies v3 onion access before reporting ready.
- **One-click updates** — a **Software Update** button in Settings pulls new versions straight from GitHub Releases (Windows/Linux apply silently; macOS opens the download; Android opens the newest APK page). The extension also has a **side-panel mode** (Phantom-style dock).

---

## Supported Networks

### Default portfolio

| Network | Ecosystem | Native | Primary provider |
|---|---|---|---|
| Ethereum | EVM L1 | ETH | Alchemy |
| Arbitrum One | EVM L2 | ETH | Alchemy |
| Optimism | EVM L2 | ETH | Alchemy |
| Base | EVM L2 | ETH | Alchemy |
| Polygon | EVM L2 | POL | Alchemy |
| Avalanche | EVM L1 | AVAX | Alchemy |
| Blast | EVM L2 | ETH | Alchemy |
| Gnosis | EVM L1 | xDAI | Alchemy |
| Abstract | EVM L2 | ETH | Alchemy |
| ApeChain | EVM L2 | APE | Alchemy |
| Ronin | EVM L2 | RON | Alchemy |
| Soneium | EVM L2 | ETH | Alchemy |
| WorldChain | EVM L2 | WLD | Alchemy |
| Zora | EVM L2 | ETH | Alchemy |
| Monad | EVM L1 | MON | monad.xyz RPC (+ rotation) |
| HyperEVM | EVM L1 | HYPE | hyperliquid.xyz RPC |
| Solana | SVM | SOL | Helius |
| Cardano | eUTXO | ADA | Blockfrost (+ Koios fallback) |
| Bitcoin | UTXO | BTC | Tatum (+ Esplora fallback) |
| Polkadot | Substrate | DOT | Tatum |
| Tron | TRON | TRX | TRON HTTP API (+ TronGrid fallback) |
| Dogecoin | UTXO | DOGE | BlockCypher |

Every chain has a multi-RPC fallback chain: the primary endpoint is always tried first, and keyless public mirrors only engage on transport errors, so the normal path is unchanged.

### Privacy Mode

Privacy Mode is a filtered mainnet portfolio, not a testnet substitute. It shows only privacy-focused chains, derives their addresses the first time the mode is enabled, and turns off Testnet Mode automatically.

| Network | Native | Notes |
|---|---|---|
| Monero | XMR | Full Monero address + private view key derived from the seed; balance scanning uses keyless remote nodes with a restore-height wallet birthday. |
| Zcash | ZEC | Transparent `t1...` address, balance, fee estimate, and sends. Shielded receivers are intentionally withheld until shielded scanning is supported. |
| Midnight | NIGHT | Lace-compatible unshielded and shielded address derivation. Receive/balance support is present; sends wait on DUST/proof-server support. |

Swaps are disabled while Privacy Mode is on because the swap providers do not support these routes, and routing privacy assets through a hosted swap provider would undercut the point of the mode.

### Testnet Mode

Testnet Mode swaps the active network set for no-real-funds testing. Prices, NFT floors, swaps, and AGW are disabled or hidden where testnet data would be misleading.

| Mainnet slot | Testnet used |
|---|---|
| Ethereum | Sepolia |
| Arbitrum | Sepolia |
| Optimism | OP Sepolia |
| Base | Sepolia |
| Polygon | Amoy |
| Avalanche | Fuji |
| Blast | Sepolia |
| Gnosis | Chiado |
| Monad | Monad Testnet |
| Abstract | Abstract Testnet |
| ApeChain | Curtis |
| Ronin | Saigon |
| Soneium | Minato |
| WorldChain | Sepolia |
| Zora | Sepolia |
| HyperEVM | HyperEVM Testnet |
| Solana | Devnet |
| Cardano | Preprod |
| Bitcoin | Testnet3 + Testnet4 |
| Tron | Shasta |

Polkadot and Dogecoin stay hidden in Testnet Mode until reliable testnet data providers are wired in.

---

## Install

### Desktop App
Download the latest installer from [GitHub Releases](../../releases):

- **Windows** — `MagicMoney-Wallet-Setup-x.x.x.exe`
- **macOS** — `MagicMoney-Wallet-x.x.x.dmg`
- **Linux** — `MagicMoney-Wallet-x.x.x.AppImage`

**Staying up to date.** The app checks for updates on launch, and **Settings → Software Update** is a one-click button that adapts through the whole flow — *Check for Updates → Downloading NN% → Restart to Update*:

- **Windows / Linux (AppImage)** — the update downloads and the app relaunches into the new version. No reinstall, no hunting for a download.
- **macOS** — the button detects the new version and opens the [Releases](../../releases) page for a quick drag-install. (Silent macOS auto-apply requires an Apple Developer ID cert + notarization; see *Build & Release*.)

Shipping a new version to everyone is just a release (below) — users get it from the button.

### Browser Extension
1. Download `magicmoney-extension-vx.x.x.zip` from [GitHub Releases](../../releases)
2. Unzip it
3. Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the unzipped folder
4. Pin the extension from the toolbar

> Chrome Web Store submission is planned for the first public release.

### Android App
Download `magicmoney-android-vX.Y.Z.apk` from [GitHub Releases](../../releases), allow "install unknown apps" for your browser/file manager, and open the APK.

Android releases are update-over-install compatible as long as they are signed with the same release key. The in-app **Software Update** row checks GitHub Releases and opens the newest APK download page. Google Play distribution is planned; APK sideloading is the current public path.

---

## Quick Start (Development)

**Prerequisites:** Node.js 20+, npm 10+

```bash
npm install

# Desktop (Electron) with hot reload
npm run dev

# Chrome extension build → dist-extension/
npm run build:extension
# then load dist-extension/ as an unpacked extension in chrome://extensions

# Android web bundle + native sync
npm run build:capacitor
# deploy to a connected Android device or emulator
npm run android
```

Useful checks:

```bash
npm run typecheck     # tsc on node + web + extension + capacitor tsconfigs
npm test              # vitest (wallet-core, crypto-vault, tx-describe, secure-store)
```

---

## Architecture

MagicMoney is **one codebase with three runtime surfaces**. All wallet logic — key derivation, balance/token/NFT fetching, transaction building, swap routing, dApp request handling — is shared. Only the platform primitives differ, and they're swapped at build time via Vite aliases:

| Concern | Desktop (Electron) | Extension (Chrome MV3) | Android (Capacitor) |
|---|---|---|---|
| Privileged runtime | Main process (`ipc-handlers.ts`) | Service worker (`background.ts`) | In-process wallet router (`wallet-local.ts`) |
| Encrypted key storage | `safeStorage` (OS keychain) | `chrome.storage.local` + AES-256 (`crypto-vault.ts`) | Capacitor Preferences + AES-256 vault (`capacitor-store.ts`) |
| Storage adapter | `secure-store.ts` | `chrome-store.ts` | `capacitor-store.ts` |
| Renderer ↔ core bridge | `contextBridge` / IPC | `chrome.runtime.sendMessage` (`bridge.ts`) | Local bridge (`platform-capacitor.ts`, `wallet-local.ts`) |
| dApp browser | Built-in pop-out `WebContentsView` | The user's own browser tabs | Native `DappBrowser` plugin with separate WebViews |
| Native security | Windows Hello / Touch ID | Password unlock | Android biometric unlock, app foreground re-lock, hardware back handling |

### API proxy — no keys in the client

All **keyed** providers (Alchemy, Helius, Blockfrost, Tatum, Moralis, OpenSea, the swap aggregators, and Supabase) route through a **Cloudflare Worker** (`cloudflare-worker/`). The client is proxy-first: `src/main/api-proxy.ts` rewrites provider URLs/headers to the Worker, which injects the real secrets server-side. As a result **no provider API keys ship in the app bundle**.

The Worker (`read.js`, `swap-proxy.js`, `lib.js`, `db.js`, `auth.js`) also adds a shared cross-user KV cache (token metadata, NFT floors), per-IP rate limiting, and EVM-signature-gated write routes for profile sync.

**Deliberately kept client-side and direct:** keyless, per-IP endpoints — CoinGecko (prices/sparklines), DexScreener, DefiLlama, mempool.space, Magic Eden. Proxying these would collapse every user onto one Worker IP and trigger provider rate limits.

> The app ships pointing at a hosted Worker, so it works with no setup. Advanced users can self-host the Worker (see `cloudflare-worker/README.md`) or supply their own keys in **Settings** — config keys default to empty and are stored on-device only.

### Security model

```
Renderer / Popup / WebView (React)    Privileged runtime
──────────────────────────            ──────────────────────────────────
UI, balances, addresses           ←── Cloudflare Worker → Alchemy / Helius / …
window.wallet.getBalances()       ──► IPC / message / local router → balance-fetcher.ts
window.wallet.generate()          ──► wallet-core.ts → returns word[] only
window.wallet.confirmBackup()     ──► wallet-core.ts → derive → encrypted storage

dApp page (injected provider)         Privileged runtime (signing)
──────────────────────────            ──────────────────────────────────
window.ethereum (EIP-1193/6963)   ──► per-origin approval → tx-sender.ts
window.solana   (Wallet Standard) ──► sign with ed25519 (@noble) → broadcast
window.cardano.magicmoney / vespr──► cardano-cip30.ts → witness → submit
WalletConnect v2 URI              ──► @walletconnect/sign-client
```

**Guarantees:**
- Mnemonic encrypted at rest — OS keychain (`safeStorage`) on desktop, AES-256 behind a user password in the extension and Android app.
- Private keys are derived transiently for signing and never persisted in the clear; the renderer/popup only ever receives public addresses and balance strings.
- Desktop hardening: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- The extension's `MAIN`-world inject script provides the dApp APIs but has **no access** to wallet storage — every privileged action crosses the message bridge.
- Android dApp pages run in separate native WebViews from the trusted wallet UI, with provider requests validated and routed back through the same approval flow.

---

## dApp Connectivity

MagicMoney is a fully-fledged signer for EVM, Solana, and Cardano dApps.

- **EVM** — injects `window.ethereum` with EIP-1193 + EIP-6963 (multi-wallet discovery), per-origin approvals, chain switching (`wallet_switchEthereumChain` / `wallet_addEthereumChain`), and `eth_signTypedData_v4`. dApps see "MagicMoney Wallet" alongside other wallets.
- **Solana** — Wallet Standard + legacy `window.solana`: `connect`, `signMessage` (e.g. OpenSea SIWS), `signTransaction`, and `signAndSendTransaction`.
- **Cardano (CIP-30)** — exposed canonically at `window.cardano.magicmoney` and, with VESPR's permission, at the `window.cardano.vespr` compatibility key for dApps that whitelist it. Both keys reference the same MagicMoney-branded provider and use the same approval-gated signer. MagicMoney is registered in the **weld** registry as `magicmoney`. Implemented methods: `getNetworkId`, `getBalance`, `getUtxos`, `getCollateral`, `getUsedAddresses`, `getUnusedAddresses`, `getChangeAddress`, `getRewardAddresses`, `signTx`, `signData`, `submitTx`.
- **Hardcoded dApp compatibility branding** — Strike and DexHunter hardcode the VESPR label and icon instead of reading CIP-30 provider metadata. When MagicMoney owns the authorized `vespr` compatibility key, the injected provider narrowly replaces those VESPR wallet-row/dialog elements on `app.strikefinance.org` and `app.dexhunter.io` with the MagicMoney name and provider icon. It does not run on other sites or when a genuine VESPR provider owns the key.
- **WalletConnect v2** — pair via URI for dApps that prefer it.

On **desktop**, dApps run in a built-in pop-out browser with a native network switcher in the toolbar. In the **extension**, the providers are injected into every page via a `document_start` content script. On **Android**, dApps run in native plugin-owned WebViews with `document_start` provider injection, tab controls, WalletConnect `wc:` deep links, and approval overlays rendered by the wallet WebView.

The onion button in the desktop and Android browser toolbars enables **Tor Mode**. On 64-bit Windows, desktop first use downloads the Tor Project Expert Bundle from the official archive, verifies its pinned SHA-256, installs it under Electron's user-data directory, and starts it privately; an already-running service on `127.0.0.1:9050` or `127.0.0.1:9150` is reused. Android starts the bundled Guardian Project Tor Android runtime on a loopback SOCKS endpoint, so users do not need Orbot or another app. A green Android state means both `check.torproject.org` verified the exit and a v3 onion connection succeeded. Bare `.onion` addresses default to `http://` because Tor already authenticates and encrypts onion traffic. A red **Tor blocked** panel keeps the proxy configured so browser requests cannot silently fall back to the direct connection, while offering Retry and Turn Off controls. Electron persists the preference and restores the proxy before its first dApp request. Android's WebView proxy API is app-wide, so enabling it applies to every WebView owned by the Android app. The Chrome extension does not expose this switch because its “browser” is the user's ordinary Chrome tabs and a wallet extension cannot safely make them a private per-wallet Tor session.

This is Tor routing, not a claim of Tor Browser anonymity: the embedded Chromium/WebView engines do not reproduce Tor Browser's fingerprint normalization or security patches.

---

## Swaps

The Swap page is dual-mode, covering both on-chain and cross-chain trades:

- **DEX (sign locally)** — same-chain swaps aggregate the best price across **0x / 1inch** (EVM) and **Jupiter** (Solana). Cross-chain routes use **LI.FI / Rango / SwapKit (THORChain)** with a Phantom-style auto-router (independent From/To network selectors). Transactions are signed locally with your own keys.
- **Cross-chain exchange (deposit address)** — **SimpleSwap** with a **ChangeNOW** fallback, used for assets that can't be signed locally as a source (e.g. BTC, ADA, DOT).

Quotes, slippage, gas preflight, and a periodic price-refresh guard are handled in the swap widgets. Cardano on-chain DEX execution is stubbed.

---

## Abstract Global Wallet (AGW)

MagicMoney can display your **Abstract Global Wallet** (a zkSync smart account on Abstract, chainId 2741) inside the same portfolio total. Because an AGW is typically owned by a Privy embedded signer rather than your EOA, auto-discovery isn't possible — you add the AGW address manually in the **AgwPanel** (Networks tab). Its native ETH, tokens, and NFTs are badged as AGW-sourced and counted in your total. Direct sending is enabled only when your EOA is a verified on-chain owner; otherwise the panel links out to the Abstract Portal.

---

## Build & Release

```bash
# Development
npm run dev                    # Electron + hot reload (regenerates App Hub, builds injects)
npm run build:extension        # Chrome extension → dist-extension/
npm run build:capacitor        # Android web bundle → dist-capacitor/ + cap sync
npm run android                # Build and deploy to a connected device/AVD

# Production builds
npm run build                  # Electron build → out/
npm run package                # Electron installer → dist/
npm run package:publish        # Build + publish to GitHub Releases (requires GH_TOKEN)
npm run android:apk            # Android release APK (requires android/keystore.properties)
npm run android:aab            # Android release AAB for Play Console

# Release (bump version + tag + push → GitHub Actions builds everything)
npm run release:patch          # 0.1.1 → 0.1.2
npm run release:minor          # 0.1.1 → 0.2.0
npm run release:major          # 0.1.1 → 1.0.0
```

> **Build note:** the dApp-injection preloads (`web3-inject`, `popup-chrome`, `popup-connect`, `approval-preload`) are bundled by a separate `build:inject` esbuild step into `out/inject/`. The `dev`, `build`, and `package` scripts all run it; don't remove it or the in-app dApp browser loses its provider.

### Automated CI/CD

Pushing a version tag triggers `.github/workflows/release.yml`, which:
1. Builds the Electron app on Windows, macOS, and Linux in parallel.
2. Publishes installers to GitHub Releases via `electron-builder --publish always`.
3. Builds the Android APK/AAB and uploads them to the same release.
4. Builds the Chrome extension and uploads the `.zip` to the same release.

The release scripts handle the whole flow — bump, commit, tag, push. `electron-builder --publish always` also uploads the `latest.yml` / `latest-mac.yml` / `latest-linux.yml` update feeds that the in-app **Software Update** button reads, so publishing a release is all it takes for existing installs to update themselves.

> **Signing note.** Builds are currently unsigned (`CSC_IDENTITY_AUTO_DISCOVERY: false`). Windows NSIS and Linux AppImage auto-*apply* updates fine unsigned; a first-time Windows install may show a SmartScreen warning. **macOS is different** — Squirrel.Mac refuses to apply an unsigned update, so macOS uses the assisted-download fallback until an Apple Developer ID cert + notarization secrets (`CSC_LINK` / `CSC_KEY_PASSWORD` + notarize creds) are added, at which point macOS can be flipped to silent auto-update with a build-config change.

> **Android signing note.** Update-over-install only works when every APK is signed with the same keystore. CI produces release-signed APK/AAB artifacts when `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` are set; otherwise it attaches a debug-signed APK for testing.

---

## Project Structure

```
src/
├── main/                    ← Privileged logic (Electron main + shared core)
│   ├── index.ts             ← App entry, BrowserWindow, startup update check
│   ├── update-manager.ts    ← electron-updater state machine (in-app Update button)
│   ├── wallet-core.ts       ← BIP-39/32/44 derivation — keys never leave here
│   ├── chain-config.ts      ← Default, Privacy Mode, and Testnet Mode network sets
│   ├── api-proxy.ts         ← Proxy-first URL/header rewriting to the Worker
│   ├── balance-fetcher.ts   ← Native balances across every chain
│   ├── token-fetcher.ts     ← ERC-20 / SPL / Cardano assets + NFTs
│   ├── market-fetcher.ts    ← CoinGecko prices (cached)
│   ├── native-prices.ts     ← Shared native-USD cache (avoids CoinGecko 429s)
│   ├── tx-sender.ts         ← Send transactions (EVM / Solana / Cardano / Tron / Doge)
│   ├── tx-history.ts        ← Transaction history
│   ├── tx-describe.ts       ← Human-readable tx descriptions
│   ├── cardano-pure.ts      ← Pure-JS Cardano derivation (CIP-1852 / Icarus)
│   ├── cardano-cip30.ts     ← CIP-30 dApp connector implementation
│   ├── cardano-koios.ts     ← Keyless Koios fallback for core Cardano ops
│   ├── tron.ts              ← TRON HTTP API client (TronGrid fallback)
│   ├── dogecoin.ts          ← Dogecoin (BlockCypher + @scure/btc-signer)
│   ├── agw.ts               ← Abstract Global Wallet resolution/linking
│   ├── swap-proxy.ts        ← DEX/bridge quote routing (LI.FI client-side)
│   ├── swap-executor.ts     ← Local signing for DEX swaps
│   ├── simpleswap-client.ts / changenow-client.ts / xchange-client.ts ← Cross-chain exchange
│   ├── browser-manager.ts   ← Pop-out dApp browser (WebContentsView)
│   ├── dapp-chain.ts        ← Per-session active dApp chain state
│   ├── secure-store.ts      ← safeStorage wrapper + config/approved-origins
│   ├── crypto-vault.ts      ← AES-256 vault (extension key encryption)
│   ├── supabase-sync.ts     ← ChainLens profile sync (signature-gated)
│   ├── wc-client.ts         ← WalletConnect v2 (desktop)
│   └── ipc-handlers.ts      ← All wallet:* / web3:* / swap:* handlers
├── preload/
│   ├── index.ts             ← contextBridge — the only renderer↔main surface
│   ├── web3-inject.ts       ← Injected EIP-1193/6963 + Solana + CIP-30 (built to out/inject)
│   ├── popup-chrome.ts      ← Branded titlebar for frameless dApp popups
│   ├── popup-connect.ts     ← web3-inject + titlebar for auth popups (AGW/Privy login)
│   └── approval-preload.ts  ← Approval window preload
├── extension/               ← MV3 adapters (swapped in via Vite aliases)
│   ├── background.ts        ← Service worker (replaces ipc-handlers + main)
│   ├── chrome-store.ts      ← chrome.storage adapter (replaces secure-store)
│   ├── bridge.ts            ← window.wallet shim over chrome.runtime.sendMessage
│   ├── content.ts           ← ISOLATED-world relay
│   ├── inject.ts            ← MAIN-world EIP-1193/6963 + Solana + CIP-30 + Wallet Standard
│   ├── wc-ext.ts            ← WalletConnect v2 (extension)
│   ├── ExtApp.tsx           ← Popup wrapper (lock screen, password setup)
│   ├── popup.* / sidepanel.*← Popup and side-panel entries
│   └── manifest.json        ← MV3 manifest
├── capacitor/               ← Android/Capacitor adapters
│   ├── CapApp.tsx           ← Android app shell, lifecycle, biometric lock screen
│   ├── wallet-local.ts      ← Local wallet bridge/router for the WebView runtime
│   ├── capacitor-store.ts   ← Preferences-backed encrypted storage
│   ├── dapp-browser.ts      ← Typed bridge to the native DappBrowser plugin
│   ├── dapp-inject.ts       ← Android dApp provider injection bundle
│   ├── monero-browser.ts    ← Browser-compatible Monero backend
│   ├── qr-scan.ts           ← ML Kit QR scanner wrapper
│   └── update-check.ts      ← GitHub Releases APK update helper
└── renderer/                ← React UI (shared across desktop, extension, and Android)
    ├── App.tsx / main.tsx   ← Router + entry
    ├── BrowserApp.tsx       ← Desktop dApp-browser chrome
    ├── pages/               ← Dashboard, Market, Swap, AppHub, Profile, Settings, onboarding…
    ├── components/          ← SendModal, swap widgets, AgwPanel, ChainCard, TxList…
    └── data/app-hub.ts      ← Auto-generated dApp directory (do not edit by hand)

android/
└── app/src/main/java/info/chainlens/magicmoney/
    ├── MainActivity.java       ← Capacitor activity + plugin registration
    ├── DappBrowserPlugin.java  ← Isolated native WebView dApp browser
    └── AppInfoPlugin.java      ← Installer/source metadata for update checks
```

---

## Updating the App Hub

The App Hub dApp directory is **auto-generated** from `ChainLens_Files/app-hub-data.js` — never edit `src/renderer/data/app-hub.ts` by hand. The conversion runs automatically via npm `predev` / `prebuild` hooks, so `npm run dev`, `build`, and `package` always regenerate it. To regenerate manually:

```bash
npm run apphub
```

Edit the source file (`ChainLens_Files/app-hub-data.js`) to add or remove apps; a JS syntax error there will fail the build.

---

## Android (Capacitor)

The Android app is a third build target beside Electron and the MV3 extension: the same
React UI and pure-JS chain core run in a Capacitor WebView, with `src/capacitor/` providing
the platform layer (Preferences-backed vault storage, in-process wallet router, biometric
unlock, ML Kit QR scanning, `wc:` deep links) and a native `DappBrowser` plugin hosting
dApp pages in **separate** WebViews with `document_start` provider injection — untrusted
content never shares a realm with the wallet.

Android builds require JDK 24, Android SDK Platform 37, and Build Tools 37.0.0.

```bash
npm run build:capacitor   # web bundle + dapp-inject + cap sync
npm run android           # build, then deploy to a connected device/AVD
npm run android:apk       # signed release APK (needs android/keystore.properties)
```

**Sideload install:** download `magicmoney-android-vX.Y.Z.apk` from GitHub Releases, allow
"install unknown apps" for your browser/file manager, and open the APK. 
Updates install over the existing app (data intact). 

The in-app **Software Update** row checks GitHub Releases and opens the newer APK's
download page. Play Store distribution is future work.

---

## Roadmap

- **Chrome Web Store** — public extension listing for the first stable release.
- **Cardano tx chaining** (`supportsTxChaining`) — track submitted-but-unconfirmed UTXOs locally so dApps can chain transactions without waiting for confirmation.
- **Cardano DEX execution** — wire the stubbed on-chain swap path (MuesliSwap).
- **Fiat on/off-ramp** — Transak integration (planned).
- **Google Play** — the Android APK ships via GitHub Releases today; a Play listing is planned.

---

## License

See [LICENSE](LICENSE).
