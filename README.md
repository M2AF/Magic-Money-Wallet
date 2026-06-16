# ManCave Wallet

A self-custody multi-chain desktop wallet built with Electron + React.

**Chains:** EVM (Ethereum, Monad, Abstract) · Solana · Cardano

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
├── main/                   ← Node.js / Electron main process (NEVER imports renderer)
│   ├── index.ts            ← App entry, BrowserWindow, IPC window controls
│   ├── wallet-core.ts      ← BIP-39/32/44 derivation — private keys never leave here
│   ├── secure-store.ts     ← safeStorage wrapper (OS keychain encryption)
│   ├── balance-fetcher.ts  ← Alchemy, Helius, Blockfrost API calls
│   └── ipc-handlers.ts     ← Registers all wallet:* IPC handlers
├── preload/
│   └── index.ts            ← contextBridge — the ONLY surface between renderer and main
└── renderer/               ← React UI — never sees private keys or mnemonics
    ├── App.tsx             ← Page router
    ├── main.tsx            ← ReactDOM entry
    ├── index.html          ← Vite HTML template
    ├── index.css           ← Global design tokens + component styles
    ├── types/
    │   └── wallet.ts       ← Shared interfaces + window.wallet type declaration
    ├── components/
    │   ├── AddressChip.tsx ← Truncated address with copy-to-clipboard
    │   └── ChainCard.tsx   ← Per-chain balance card
    └── pages/
        ├── LoadingPage.tsx     ← Startup spinner
        ├── WelcomePage.tsx     ← Create / Import landing
        ├── CreatePage.tsx      ← Generate + display new seed phrase
        ├── ConfirmPage.tsx     ← Confirm backup before saving
        ├── ImportPage.tsx      ← 12/24-word import grid with paste support
        └── DashboardPage.tsx   ← Live balances, settings, seed reveal
```

---

## Security Architecture

```
Renderer (React)                   Main Process (Node.js)
────────────────────               ──────────────────────────────────
UI / balance display          ←──  Alchemy / Helius / Blockfrost APIs
window.wallet.getBalances()   ──►  IPC handler → balance-fetcher.ts
window.wallet.generate()      ──►  wallet-core.ts → returns word[] only
window.wallet.confirmBackup() ──►  wallet-core.ts derive → safeStorage.encrypt
                                   Private keys disposed after use
```

**Key guarantees:**
- Mnemonic encrypted at rest via OS keychain (`safeStorage` = Windows Credential Manager / macOS Keychain / libsecret)
- Private keys exist only transiently in the main process during derivation
- The renderer never receives mnemonics or private keys — only public addresses and balance strings
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false` — renderer is fully sandboxed

---

## API Keys

Your keys are stored in `config.json` inside Electron's `userData` directory (not in source code). The defaults in `secure-store.ts` are loaded only on first run — you can update them via the config IPC channel or by editing the generated config file.

| Key | Provider | Used for |
|-----|----------|---------|
| `alchemyKey` | [alchemy.com](https://alchemy.com) | EVM balance + tokens |
| `heliusKey` | [helius.dev](https://helius.dev) | Solana balance + tokens |
| `blockfrostKey` | [blockfrost.io](https://blockfrost.io) | Cardano balance + tokens |

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

- [x] Phase 1 — Seed generation, import, multi-chain address derivation
- [x] Phase 1 — Live balance reads (EVM, Solana, Cardano)
- [x] Phase 1 — OS-encrypted seed storage
- [ ] Phase 2 — EVM send (viem signTransaction → Alchemy broadcast)
- [ ] Phase 2 — Solana send (@solana/web3.js)
- [ ] Phase 2 — Cardano send (Blockfrost UTXO selection + submit)
- [ ] Phase 3 — Transaction history
- [ ] Phase 3 — Multi-account (change derivation index)
