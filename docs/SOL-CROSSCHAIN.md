# SOL cross-chain source-route validation

The reported SOL -> ETH swap failed in LI.FI's Mayan source transaction, before
broadcast. The deployed Mayan Swift v2 program defines error 6025 (0x1789) as
`AmountInTooSmall`. Its `init_order` instruction has an `amount_in_min` input.
This means the amount reaching the bridge did not meet the bridge requirement;
it does not establish that the wallet's SOL balance or the user's trade size is
too small. An intermediate source swap can satisfy its own floor and still fail
the subsequent bridge's input check.

The definition was read from the program's on-chain Anchor IDL on 2026-10-26:

- Program: `mayan34VedncxdK2XobtvWFDXQASUTBXhUVzt2kKgny`.
- IDL account: `2qzWRSi3vRWtFwd7WRjvTUno5BPswFrH4H22fAZkmz5o` (Anchor IDL seed
  derived from that program). Retrieved through read-only Solana RPC and decoded
  from its compressed payload.
- Public evidence: `.local-artifacts/sol-crosschain/mayan-swift-v2-idl.json`.

## Change

Implementation files: `src/main/swap-proxy.ts`,
`src/main/solana-swap-cost.ts`, `src/main/solana-simulation-failure.ts`, and
`src/main/swap-solana-crosschain.test.ts`. Handoff board/journal record the work;
the pre-existing `DexSwapWidget.tsx` Retry edit is unchanged.

`src/main/swap-proxy.ts` now checks a Solana-source cross-chain quote's exact
unsigned transaction before offering it. It uses the existing cost reader's
simulation, distinguishing a program rejection from unavailable RPC. A failed
LI.FI bridge is excluded with `denyBridges` when requesting another quote, with
at most two replacement requests. The existing policy still ranks candidates.

Every replacement retains the requested amount, tokens, recipient, slippage and
fee policy. Fee integrity and minimum-received checks run again. Backend-supplied
simulation claims are discarded. Only a locally passing, unexpired payload is
offered; a balance shortfall, RPC outage or timeout is reported without calling
it a bridge rejection. Each cost/simulation attempt has a ten-second deadline.

This happens before user approval. The executor's original intent binding,
signing guards and final simulation remain unchanged. No route is substituted
after approval, and the existing Retry fix is preserved. No Worker deployment
or new dependency is required; all four wallet targets consume the shared main
modules, but installed copies need a rebuilt application to receive the change.

## Evidence and verification

Manual mainnet probes use only the public, checked-in beneficiary addresses and
unsigned simulation (`sigVerify:false`, `replaceRecentBlockhash:true`). No seed,
private key, vault access, signing, broadcast or exchange order creation is used.

- A fresh 1 SOL -> Base ETH Mayan quote initially simulated successfully. The
  bridge is therefore not banned globally.
- A Base FastMCTP payload failed with error 6001; its full Anchor log explicitly
  states `AmountInTooSmall` / input below minimum (slippage tolerance).
- Replaying that real, unsigned failed payload through `getSwapQuote` made the
  wallet exclude FastMCTP. The next live Mayan Swift quote reproduced the
  original 6025 error. The wallet then excluded both bridges and returned a
  NEAR Intents payload with successful local unsigned simulation. Amount,
  recipient, 0.5% slippage and verified 1% app fee were preserved.
- A separate fresh SOL -> Ethereum ETH request through `getSwapQuote` selected
  NEAR Intents and passed local unsigned simulation.
- These are source-transaction checks, not proof of destination ETH settlement.
  Provider price, bridge liquidity and route availability can change.

Probe outputs and full source logs: `.local-artifacts/sol-crosschain/`;
`app-path-base-replay.json`, `app-path-ethereum.json`, `sim-*.json`.
`probe-entry.ts` is the manual read-only harness; it is not part of automated tests.
LI.FI's documented route-exclusion parameter is described at
<https://docs.li.fi/li.fi-api/li.fi-api/requesting-a-quote>.

Automated verification uses mocked providers/RPC and never spends live provider
quota. `swap-solana-crosschain.test.ts` covers both ETH destinations, failing and
passing bridges, bounded exclusions, ignored exclusions, fee-free fallback,
outages, forged backend simulation claims, expiry, timeout, balance shortfall,
program-specific decoding and actual unsigned cost-reader simulation options.

Baseline at HEAD `22c10e192ab06d7b78b21dd88dff5009c2320178` plus the user's
Retry fix: five-target typecheck and 188 files / 2762 unit tests passed. The
matching base-commit GitHub CI is green:
<https://github.com/M2AF/Magic-Money-Wallet/actions/runs/40254402500>.
That run does not verify these uncommitted changes.

Final `CI=1 npm run verify:ci` passed (exit 0): all five TypeScript targets,
189 test files / 2776 unit tests, fresh Electron + extension + injection builds,
103 browser/Electron cases passing initially plus two passing on retry (existing
Sappy Seals and downloads tests), one skipped, and the critical production
dependency audit passing. Dependencies are unchanged; audit reports zero
critical, five high and four moderate findings.

Log: `.local-artifacts/sol-crosschain/verify-ci.log`; exit code:
`verify-ci.exitcode`. Original generated assets are restored and hash-verified;
details are in `generated-restoration.json`. Existing fresh-review screenshot
was reviewed; this change adds no UI layout.

GitHub CI for the new changes is pending (uncommitted/unpushed). The green
base-commit run above does not verify this working tree. Release/native installs
and real-funds settlement remain unverified. No commit, push, deployment or
installation performed.
