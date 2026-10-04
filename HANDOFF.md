# Handoff board — Magic Money Wallet
<!-- handoff v1. LIVE STATE ONLY: rewrite in place, keep under ~60 lines.
     History goes in HANDOFF_LOG.md. Machine fields above the first ## are managed by handoff.py. -->

owner: codex
task: Implement resumable USDCx route progress in wallet
lease_until: 2026-10-04T23:18-03:00
repo: .
verify: cmd /c "npm run typecheck && npm test"
verified: 7d2f7bb · PASS five-target typecheck; 136 files/2035 tests; Cardano real-extension E2E 2 tests and xReserve E2E 1 test; four application web bundles; screenshot review and git diff --check. No native/live settlement QA. · 2026-10-04T20:16-03:00
head: 7d2f7bb (main) dirty 34
updated: 2026-10-04T20:18-03:00 · codex

## Now
- Wallet UI unit complete: explicit ADA/SOL/ETH pairs stay selected in both directions and hand exact assets/amount to existing exchange estimates.
- Exact curated identity mapping refuses USDCx/lookalikes; provider error or stale estimate cannot enable exchange creation.
- Existing Claude Sepolia USDC to Preprod USDCx mint path preserved; its approval/deposit/recovery screen regression passes.
- PASS npm run typecheck (five targets), npm test (136 files/2035 tests), real-extension Cardano E2E (2 tests), xReserve E2E (1 test).
- PASS desktop, extension, Capacitor web and iOS web bundles; mobile/wide-extension screenshots inspected.
- No Codex jobs remain running. Pre-existing dirty source preserved; no native QA, live funds, deployment or commit.

## Next
- Claim staged xReserve route/session UI implementation using existing verified inbound tracker; read actual modules and testnet QA before changing signing or bridge gates.

## Traps
- Only the lease owner edits shared wallet code; helpers review read-only or use an agreed isolated scope.
- Check lease, processes, Git drift and latest journal immediately before shared edits.
- Mainnet xReserve inbound/outbound remain gated; 2026-10-04 published OpenAPI still has no deposit quote endpoint.
- IOG Portal advertises Solana/EVM routes, but its product capability does not establish a third-party burn builder contract.
- Default Wanchain tokenPairs response did not establish Cardano/Solana pairs; do not infer support or universal absence.
- Prepared Cardano records are conservatively uncertain, even if interruption precedes submit; poll known hashes, never automatically resend.
- Old testnet QA and newer recovery code differ; audit actual code. Testnet success is not mainnet or outbound acceptance.
- Preserve address-to-address swaps and shared core/alias seams. No native QA or live settlement inferred from web builds.
- Do not commit, deploy, sign real funds or broadcast without explicit authorization; never store secrets in handoffs.

## Pointers
- src/renderer/lib/swap-exchange-preset.ts; src/renderer/components/DexSwapWidget.tsx; SimpleSwapWidget.tsx; pages/SwapPage.tsx.
- e2e/cardano-swap.spec.ts; e2e/xreserve-testnet.spec.ts; .screenshots/cardano-*.png.
- .cardano-handoff-typecheck.log; -tests.log; -e2e-final.log; -xreserve-e2e.log; -visual.log; -build.log; -desktop.log; -capacitor.log; -ios.log.
- docs/CARDANO-MULTICHAIN-NEXT.md; docs/DEXHUNTER-EVALUATION.md; src/main/swap-executor.ts; swap-sessions.ts.
- docs/XRESERVE-TESTNET-QA.md; docs/XRESERVE-PORTAL-INTEGRATION-HANDOFF.md; docs/XRESERVE-GATE2-RESEARCH.md; docs/XRESERVE-GATE3-RESEARCH.md.
- AGENTS.md; README.md; HANDOFF_LOG.md; docs/RELEASE-QA.md. All four Cardano skills and agent-handoff installed for Codex and Claude.

