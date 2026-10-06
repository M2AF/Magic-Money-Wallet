# Handoff journal — Magic Money Wallet
<!-- Append-only. Never edit or delete entries; correct with a new `correction` entry.
     Header: ### <iso-time> · <agent> · <kind> · <head> <clean|dirty N>. Use handoff.py log. -->

### 2026-10-05T21:57-03:00 · claude · verify · 5ef16d0 (main) dirty 32
- verified: PASS uncommitted on 5ef16d0: typecheck 0; npm test 160 files/2351 tests; build, build:extension, capacitor+ios vite builds; playwright cardano-swap.spec 7/7 (.bind-*.log)
- Review fixes 1-5 complete; execution disabled; nothing signed/sent

### 2026-10-05T21:57-03:00 · claude · handoff · 5ef16d0 (main) dirty 32
- cbADA execution binding fixes delivered; flag off
- next: App approval flow (show terms, authorizeCcipBridge), live rate-limit read, then user-approved 1 cbADA test terms

### 2026-10-05T22:14-03:00 · codex · claim · 5ef16d0 (main) dirty 32
- task: Add live Base cbADA outbound rate-limit read to disabled CCIP simulation
- lease until 2026-10-06T00:14-03:00

### 2026-10-05T22:17-03:00 · codex · verify · 5ef16d0 (main) dirty 32
- verified: npm run typecheck exit 0; npx vitest run src/main/cbada-ccip-send.test.ts src/main/cbada-ccip-execute.test.ts: 2 files 46 tests pass; git diff --check exit 0
- Chainlink v2 docs specify getCurrentRateLimiterState(uint64,bool); read-only call to pinned Base cbADA pool for Solana default bucket returned enabled, 10m cbADA tokens/capacity, refill 115.740740 cbADA/s.
- Disabled CCIP simulation now fails closed on unreadable or insufficient live outbound bucket; tests cover read arguments and guard, docs corrected.
- next: Build app approval screen showing immutable quote/terms and calling authorizeCcipBridge on explicit approval; keep CCIP execution off and unwired.

### 2026-10-05T22:17-03:00 · codex · handoff · 5ef16d0 (main) dirty 32
- Live Base cbADA outbound limiter read added to disabled simulation; focused tests and typecheck pass; no signing or broadcast.
- next: Build app approval screen with live quote and immutable terms, then review exact 1 cbADA QA plan; execution remains disabled.

### 2026-10-05T22:32-03:00 · claude · claim · 5ef16d0 (main) dirty 32
- task: cbADA in-app approval screen (terms + authorizeCcipBridge), execution disabled
- lease until 2026-10-06T01:32-03:00

### 2026-10-05T22:52-03:00 · claude · checkpoint · 5ef16d0 (main) dirty 33
- verified: typecheck 5 targets 0; approval tests 15/15; 7/7 mutations killed; e2e approval test 1/1
- cbADA approval screen implemented: cbada-ccip-approval.ts (review/authorize/cancel), journey:cbadaReview|cbadaAuthorize|cancel wired on all targets, CbAdaTermsPanel + JourneysInProgress cancel
- Running full validation: npm test, builds, e2e cardano-swap.spec.ts; logs .terms-*.log

### 2026-10-05T22:56-03:00 · claude · verify · 5ef16d0 (main) dirty 33
- verified: typecheck 0; vitest 161 files/2367 pass; build desktop/extension/capacitor 0; iOS vite bundle ok, cap sync ios fails (no ios platform); e2e cardano-swap 8/8; 7/7 approval mutations killed
- Approval screen validation

### 2026-10-05T22:56-03:00 · claude · handoff · 5ef16d0 (main) dirty 33
- cbADA approval screen delivered (review/authorize/cancel, all targets); nothing signed or sent; flag off; uncommitted
- next: Codex review of approval screen; then user approval of current quote + exact 1 cbADA test terms

### 2026-10-05T23:01-03:00 · claude · claim · 5ef16d0 (main) dirty 33
- task: cbADA approval: extra tests (interruption, changed terms, wallet switch)
- lease until 2026-10-06T01:01-03:00

### 2026-10-05T23:03-03:00 · claude · verify · 5ef16d0 (main) dirty 33
- verified: typecheck 0; vitest 161 files/2372 pass; authorization-guard mutation killed
- Added approval tests: changed terms, failed save, restart, lost answer, wallet switch via channel

### 2026-10-05T23:03-03:00 · claude · handoff · 5ef16d0 (main) dirty 33
- cbADA approval screen + requested tests done; nothing signed or sent; flag off; uncommitted
- next: Codex review; then steps 2-4 under Next on the board

### 2026-10-05T23:06-03:00 · codex · claim · 5ef16d0 (main) dirty 33
- task: Review cbADA approval and close concurrent authorization race
- lease until 2026-10-06T01:06-03:00

### 2026-10-05T23:08-03:00 · codex · verify · 5ef16d0 (main) dirty 33
- verified: npm run typecheck exit 0; npx vitest run src/main/cbada-ccip-approval.test.ts: 21/21; npx playwright test e2e/cardano-swap.spec.ts --grep cbADA Base: 1/1; git diff --check exit 0
- Approval screen review found concurrent-proposal race in one-active-journey check; serialized check/save and added two-window regression. UI now displays full Base token, Solana mint and router, and labels CCIP+gas cap separately from uncapped L1 data fee.
- next: Confirm primary Base RPC and funded balances; user reviews and approves current 1 cbADA terms in app; executor remains disabled pending separate authorization.

### 2026-10-05T23:08-03:00 · codex · handoff · 5ef16d0 (main) dirty 33
- Approval review complete; concurrent authorization race closed, full contract identities shown, cap disclosure clarified; execution disabled and unwired.
- next: Confirm primary Base RPC; obtain live 1 cbADA review and user approval of exact terms; seek separate approval before wiring or enabling send.

### 2026-10-05T23:45-03:00 · claude · claim · 5ef16d0 (main) dirty 33
- task: Fix EVM swap executor: nonce reuse + stale simulation after approval + session decimals (user real-funds Relay failure)
- lease until 2026-10-06T02:45-03:00

### 2026-10-05T23:50-03:00 · claude · verify · 5ef16d0 (main) dirty 34
- verified: typecheck 0; vitest 162 files/2381 pass; desktop+extension builds 0; 6/6 mutations killed
- Fixed EVM swap executor nonce reuse + stale simulation after approval + session decimals; user's 2 failed Relay attempts sent only approvals (nonce 35 approve 2.0, 36 approve 0); cbADA 4.898515 intact

### 2026-10-05T23:50-03:00 · claude · handoff · 5ef16d0 (main) dirty 34
- EVM swap read-after-write fix done (uncommitted); approval-screen state unchanged
- next: User retries Base swap after app restart; Codex review of swap-executor read-after-write change

### 2026-10-05T23:56-03:00 · codex · claim · 5ef16d0 (main) dirty 34
- task: Review and tighten Relay swap nonce/read-after-write fix
- lease until 2026-10-06T01:56-03:00

### 2026-10-06T00:00-03:00 · codex · verify · 5ef16d0 (main) dirty 34
- verified: npm run typecheck exit 0; npx vitest run swap-executor-read-after-write.test.ts swap-executor-preflight.test.ts: 2 files 19 tests pass; git diff --check exit 0
- Reviewed Claude Relay/Base read-after-write fix. Fixed two residual paths: first nonce unreadable no longer delegates nonce choice to RPC; after confirmed zero-reset, new approval waits for zero allowance visibility. No swap retried.
- Residual scope: ownNext only serializes nonce within one executeEvmSwap call; parallel attempts and prior attempts have no shared durable nonce floor.
- next: User may retry with fresh quote after restart and current nonce/allowance checks; separately design account-level nonce coordination before claiming general concurrent-swap safety.

### 2026-10-06T00:00-03:00 · codex · handoff · 5ef16d0 (main) dirty 34
- Relay swap read-after-write review complete; first nonce and zero-reset visibility tightened; no signing or broadcast; focused tests and typecheck pass.
- next: User may retry ordinary Base swap with fresh quote after restart; future hardening: per-account nonce coordination across concurrent attempts and durable floor across attempts.

### 2026-10-06T01:10-03:00 · codex · claim · 35b7dbd (main) dirty 1
- task: Reconcile committed Relay QA and next Cardano bridge task
- lease until 2026-10-06T02:10-03:00

### 2026-10-06T01:11-03:00 · codex · verify · 35b7dbd (main) dirty 2
- verified: On HEAD 35b7dbd: npm run typecheck exit 0; npm test 162 files/2383 tests pass
- Reconciled handoff drift: HEAD 35b7dbd committed clean before board update. User screenshot and Claude read-only check show ordinary Base->Solana Relay completed; CCIP remains disabled. Next Cardano work is read-only parent journey/burn-release linkage pending validated burn build.
- next: Record Relay QA hashes/fees if available, then implement parent journey and read-only Cardano burn-to-release tracking; do not enable Cardano burn signing without validated third-party build contract.

### 2026-10-06T01:11-03:00 · codex · handoff · 35b7dbd (main) dirty 2
- Reconciled committed HEAD and real Relay QA, updated next Cardano tasks; no code or transaction changes.
- next: Implement parent journey and read-only USDCx burn-to-release linkage; separately establish validated IOG unsigned burn contract before signing.

### 2026-10-06T01:39-03:00 · claude · claim · 35b7dbd (main) dirty 2
- task: USDCx journey: read-only burn -> IOG history -> destination credit linkage, recoverable in DEX Swap; burn signing disabled
- lease until 2026-10-06T04:39-03:00

### 2026-10-06T01:57-03:00 · claude · verify · 35b7dbd (main) dirty 10
- verified: typecheck 0; vitest 163 files/2399 pass; desktop/extension/capacitor/iOS-bundle builds 0; e2e cardano-swap 9/9; 8/8 mutations killed
- Read-only recoverable USDCx withdrawal journey: burnTerms, usdcx-burn-tracking, recheck outcome recording, holding + evidence UI; live public linkage verified

### 2026-10-06T01:57-03:00 · claude · handoff · 35b7dbd (main) dirty 10
- USDCx read-only withdrawal journey delivered (uncommitted); burn signing disabled
- next: Codex review; burn build contract remains the blocker

### 2026-10-06T02:26-03:00 · codex · claim · 35b7dbd (main) dirty 10
- task: Review and fix Cardano USDCx burn-to-Ethereum journey tracking
- lease until 2026-10-06T05:26-03:00

### 2026-10-06T02:27-03:00 · codex · checkpoint · 35b7dbd (main) dirty 10
- Review found Cardano depth and BurnIntent value were not gates for burn journey completion; fixed both and corrected on-chain evidence label for unverified burns.
- next: Run focused burn tracking tests and typecheck; review any failures.

### 2026-10-06T02:29-03:00 · codex · verify · 35b7dbd (main) dirty 10
- verified: Five-target typecheck exit 0; focused journey-recheck and usdcx-burn-tracking 40/40; git diff --check exit 0.
- Burn tracking review gates added; no signing, broadcast, commit or deployment.

### 2026-10-06T02:29-03:00 · codex · handoff · 35b7dbd (main) dirty 11
- Reviewed and tightened read-only USDCx burn journey: Cardano finality gates, BurnIntent release-value binding, and accurate on-chain status. Focused tests and typecheck pass; execution stays disabled.
- next: Validate IOG third-party unsigned burn build and operator rules before any approval or signing; add Solana credit proof separately if needed.

### 2026-10-06T03:30-03:00 · claude · claim · 35b7dbd (main) dirty 11
- task: Commit USDCx tracking; then authorized build-only burn probe
- lease until 2026-10-06T06:30-03:00
