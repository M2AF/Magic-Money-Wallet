# Release QA — Real-Funds Send Matrix

Gate for the first stable (v1.0.0) tag: **every send path must have moved real
mainnet funds at least once**, with the transaction link recorded here as
evidence. Testnet passes do not count for this document — fee estimation,
change handling, and broadcast paths only prove themselves against real nodes
and real value.

Rules:

- **Dust amounts only.** Send the smallest practical amount (a few dollars at
  most); the goal is exercising the code path, not stress-testing.
- Send to a **second wallet you control** (fresh MagicMoney profile or a
  known-good external wallet) so nothing is lost if an address derivation is
  wrong — and receipt in the second wallet double-checks derivation.
- **⚠ First-ever real sends (XMR, ZEC):** these paths have never moved real
  funds. Before broadcasting, sanity-check the fee against a block explorer's
  current typical fee and confirm the change/destination breakdown shown in
  the app. Start with the absolute minimum amount.
- A row passes when: the tx confirms on-chain, the recipient balance shows it,
  the sender's balance and history update in-app, and the fee charged matches
  the app's estimate within reason.
- Any failure: file it, fix it, and re-run that row **plus** its Tier-2
  platform rows before tagging.

## Tier 1 — Full sweep (Electron / Windows)

One send per row. EVM chains share a single send path (`sendEvm` via viem), so
three representative chains are mandatory (Ethereum = L1 gas dynamics, Base =
OP-stack L2, Monad = newest RPC integration); the remaining EVM chains are
recommended wherever you actually hold funds.

| # | Chain | Asset | Mandatory | Date | Amount | Tx link | Pass | Notes |
|---|-------|-------|:---------:|------|--------|---------|:----:|-------|
| 1 | Ethereum | ETH | ✅ | | | | | |
| 2 | Base | ETH | ✅ | | | | | |
| 3 | Monad | MON | ✅ | | | | | |
| 4 | Ethereum | ERC-20 token | ✅ | | | | | any held token |
| 5 | Other EVM (Arbitrum/Optimism/Polygon/Avalanche/Blast/Gnosis/ApeChain/Ronin/Soneium/WorldChain/Zora/HyperEVM) | native | optional | | | | | one row per chain you hold funds on |
| 6 | Abstract (AGW) | ETH via Global Wallet | ✅ | | | | | agw-client path, separate from sendEvm |
| 7 | Solana | SOL | ✅ | | | | | |
| 8 | Solana | SPL token | ✅ | | | | | any held token |
| 9 | Cardano | ADA | ✅ | | | | | |
| 10 | Cardano | native token | ✅ | | | | | any held token |
| 11 | Bitcoin | BTC (Native SegWit) | ✅ | | | | | inscription-safe path: must spend Native-SegWit UTXOs only |
| 12 | Dogecoin | DOGE | ✅ | | | | | legacy P2PKH via @scure/btc-signer |
| 13 | Tron | TRX | ✅ | | | | | |
| 14 | Polkadot | DOT | ✅ | | | | | mind the 1 DOT existential deposit on the receiving side |
| 15 | Monero | XMR | ✅ ⚠ | | | | | **first-ever real send** — minimum amount, verify fee before broadcast |
| 16 | Zcash | ZEC (transparent) | ✅ ⚠ | | | | | **first-ever real send** — hand-rolled ZIP-243 signing; verify fee + change output before broadcast |
| 17 | Midnight | — | n/a | | | | | receive + NIGHT balance only; sends land with the Privacy Mode completion work |

### Tier 1 non-send flows (same session, Electron)

| Flow | Date | Evidence (link/screenshot) | Pass | Notes |
|------|------|----------------------------|:----:|-------|
| Swap via SimpleSwap (any pair, minimum amount) | | | | |
| WalletConnect: pair + personal_sign + one EVM send | | | | |
| dApp browser: connect + one on-chain tx (e.g. small Uniswap swap) | | | | |
| Receive check: fresh deposit lands on each chain family used above | | | | covered implicitly by sending between own wallets |

## Tier 2 — Cross-platform smoke (extension + Android)

The chain core is byte-for-byte the same bundle on every platform; what
differs is networking (extension host_permissions vs Android fetch-router vs
Electron net) and the approval/signing UI. One send per family per platform.

| Platform | EVM send (any chain) | BTC send | Non-EVM send (SOL or ADA) | Date | Pass | Notes |
|----------|----------------------|----------|---------------------------|------|:----:|-------|
| Chrome extension | | | | | | |
| Android (sideload APK) | | | | | | |
| Android (Play build, once live) | | | | | | same binary, Play-signed — spot-check one EVM send |

## Sign-off

| | Name | Date |
|---|------|------|
| Tier 1 complete | | |
| Tier 2 complete | | |
| All failures resolved + re-run | | |

Once all three sign-off rows are filled, the real-funds gate for `v1.0.0` is
met. Keep this file updated in-repo — it is the audit trail for what was
actually tested before the stable tag.
