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

### 2026-10-06T03:37-03:00 · claude · handoff · b6aeb83 (usdcx-withdrawal-tracking) dirty 1
- Committed b6aeb83 on branch usdcx-withdrawal-tracking (not main). Burn build probe authorized by user; blocked on balance: 1.330447 USDCx < 3 (1 USDC release + Circle 2 USDC fee cap). User to swap ~10 ADA->USDCx in app; probe script ready in Claude scratchpad (build-only, one prepare + one builder call, no sign/submit).
- next: After user confirms >=3 USDCx: run build-only probe, decode offline vs questions 1-7

### 2026-10-06T03:38-03:00 · claude · claim · b6aeb83 (usdcx-withdrawal-tracking) dirty 2
- task: Run authorized build-only USDCx burn probe
- lease until 2026-10-06T05:38-03:00

### 2026-10-06T03:39-03:00 · claude · checkpoint · b6aeb83 (usdcx-withdrawal-tracking) dirty 3
- Authorized build-only probe ran twice: Circle prepare OK (1 USDC + 2 fee cap = 3 USDCx); IOG /tx/burn-usdcx returned 502 both times while history GET 200 and empty POST 400. No tx returned; nothing signed/submitted. Recorded in docs/USDCX-BURN-BUILD-PROBE.md.

### 2026-10-06T03:39-03:00 · claude · handoff · b6aeb83 (usdcx-withdrawal-tracking) dirty 3
- Burn probe: builder 502 x2; no further builder calls
- next: User checks IOG Portal up to signing prompt (no signing); send IOG the probe questions incl. the 502

### 2026-10-06T03:44-03:00 · codex · claim · b6aeb83 (usdcx-withdrawal-tracking) dirty 3
- task: Review IOG builder 502 interpretation and probe handoff
- lease until 2026-10-06T06:44-03:00

### 2026-10-06T03:44-03:00 · codex · correction · b6aeb83 (usdcx-withdrawal-tracking) dirty 3
- verified: Doc-only correction; git diff --check exit 0.
- 502 interpretation narrowed: empty POST 400 and history GET 200 show partial route reachability, not full valid schema acceptance or builder health. Portal result will narrow cause, not prove outage.

### 2026-10-06T03:44-03:00 · codex · handoff · b6aeb83 (usdcx-withdrawal-tracking) dirty 3
- Reviewed the authorized IOG build-only probe, corrected overstatements in probe doc and handoff; no new builder calls, code changes, signing or submission.
- next: If user chooses, compare Portal same-wallet/amount flow only up to signing prompt; obtain IOG third-party rules before enabling withdrawal.

### 2026-10-06T13:49-03:00 · claude · claim · da36aca (main) dirty 1
- task: Reconcile handoff with da36aca; prepare read-only IOG Portal vs probe comparison (user operates Portal, no signing)
- lease until 2026-10-06T16:49-03:00

### 2026-10-06T13:51-03:00 · claude · verify · da36aca (main) dirty 2
- verified: da36aca: npm run typecheck exit 0; vitest 163 files/2403 pass
- Reconciled board drift: HEAD da36aca (main, clean; PR #1 merged usdcx-withdrawal-tracking, branch deleted)

### 2026-10-06T13:52-03:00 · claude · handoff · da36aca (main) dirty 2
- Board reconciled to da36aca (verified 2403 tests). Portal comparison tool ready (offline, tested); IOG support request drafted.
- next: User captures Portal HAR up to the signing prompt (reject); Claude compares

### 2026-10-06T14:51-03:00 · claude · claim · da36aca (main) dirty 2
- task: Record Portal comparison findings (public bundle, read-only)
- lease until 2026-10-06T16:51-03:00

### 2026-10-06T14:51-03:00 · claude · handoff · da36aca (main) dirty 3
- Portal comparison from its public bundle: builder + Circle prepare requests identical to wallet probe; only difference amount 1 < Portal minAmount 5; Portal feeEstimation 5 (static) requires balance >= amount+5. Docs updated (probe doc, IOG draft).
- next: User chooses: top up to >=10 USDCx and Portal-build up to signing (reject), or send IOG request now

### 2026-10-06T15:08-03:00 · claude · claim · da36aca (main) dirty 3
- task: Decode Portal HAR (unsigned burn build), offline; verify nothing submitted
- lease until 2026-10-06T17:08-03:00

### 2026-10-06T15:10-03:00 · claude · checkpoint · da36aca (main) dirty 3
- Portal HAR decoded offline: builder 502,502,200 for Portal too; request identical; unsigned tx: 3 user inputs, IOG service collateral, 1 change output, mint -7 USDCx (5+2), zero withdrawal from d74de93a, requiredSigners=user, pre-attached service vkey e5d5e3df, no TTL. Not submitted (404 on chain, balance unchanged 12.168868).

### 2026-10-06T15:10-03:00 · claude · handoff · da36aca (main) dirty 3
- Portal comparison complete; IOG request ready outside repo; docs updated (uncommitted)
- next: User sends IOG request; await third-party rules

### 2026-10-06T15:15-03:00 · codex · claim · da36aca (main) dirty 3
- task: Correct Cardano signing prompt collateral, USDCx decimals, and zero-withdrawal wording
- lease until 2026-10-06T18:15-03:00

### 2026-10-06T15:20-03:00 · codex · verify · da36aca (main) dirty 5
- verified: npm run typecheck exit 0 (five targets); npm test 163 files/2407 tests exit 0; focused cardano-tx-inspect.test.ts 27/27 after final display edit
- Cardano signing summary now identifies collateral ownership from resolved inputs, formats pinned USDCx at six decimals, and labels zero-value script withdrawals as script actions; no burn execution path changed.
- next: Claude review prompt display; await IOG third-party builder rules before burn execution

### 2026-10-06T15:23-03:00 · codex · handoff · da36aca (main) dirty 5
- Cardano signing-prompt descriptions corrected in shared transaction inspector; five-target typecheck and full 163-file/2407-test suite pass on final diff; no signing, broadcast, commit or deployment.
- next: Claude review signing prompt fix; if an unsigned Portal prompt is available, inspect without signing; await IOG third-party rules before building withdrawal execution

### 2026-10-06T15:23-03:00 · codex · claim · da36aca (main) dirty 5
- task: Correct Portal builder failure interpretation after wallet-connection clarification
- lease until 2026-10-06T18:23-03:00

### 2026-10-06T15:24-03:00 · codex · correction · da36aca (main) dirty 5
- Correction to earlier Portal interpretation: user reports both Portal builder 502s occurred with Magic Money VESPR/Backpack-compatible signing selected; 200 build occurred only after switching to Magic Money own sign-in. Thus random builder intermittence is not established, nor is wallet mode proven causal without isolating other variables.
- Updated public probe doc and handoff board; updated private unsent IOG support request to ask about wallet-mode effect. No new builder call, signing, or submission.
- next: Claude review; compare already captured requests offline if needed; await IOG third-party rules

### 2026-10-06T15:24-03:00 · codex · handoff · da36aca (main) dirty 5
- Corrected Portal 502 interpretation for wallet-mode switch in probe doc, handoff board and private IOG request; docs only, no tests run, no calls/signing/submission.
- next: Claude review prior HAR requests offline if useful; await IOG answer on third-party wallet rules

### 2026-10-06T15:28-03:00 · codex · claim · da36aca (main) dirty 5
- task: Label VESPR compatibility wallet distinctly in Cardano dApp connection UI
- lease until 2026-10-06T18:28-03:00

### 2026-10-06T15:29-03:00 · codex · checkpoint · da36aca (main) dirty 10
- verified: provider-core.test.ts 2/2 pass
- Distinct VESPR alias provider name and host-specific labels implemented in extension/mobile provider core and Electron injected browser; native cardano.magicmoney remains MagicMoney Wallet; genuine VESPR key remains untouched.
- next: Run five-target typecheck, full tests, extension/inject builds and targeted browser tests

### 2026-10-06T15:31-03:00 · claude · note · da36aca (main) dirty 10
- Offline HAR comparison (no calls): all 3 Portal /tx/burn-usdcx requests byte-identical (same userWalletInfo pkh 68f031f6/skh 378a96d0, empty lists, same intent from ONE prepare). Wallet mode (VESPR vs Magic Money) cannot have changed builder input. 502s took 23.5s and 14.0s with empty body; 200 took 9.3s -> consistent with gateway timeout on slow builds (unconfirmed).
- Reviewed Codex cardano-tx-inspect fix: collateral ownership resolution, USDCx 6-dp display, zero-ADA script withdrawal wording look correct; 27/27 tests pass. Note: zero withdrawal from a KEY credential now has no warning (stake-key witness warning still covers own key).
- Waiting for Codex lease release before building the read-only burn pre-sign validator (user chose wait).

### 2026-10-06T15:32-03:00 · codex · handoff · da36aca (main) dirty 10
- VESPR-compatible CIP-30 alias now labelled MagicMoney Wallet (VESPR) across extension/mobile and Electron dApp browser; native name unchanged. Five-target typecheck, 163 files/2407 tests, extension/inject builds and 13 targeted browser tests pass. No commit, signing or submission.
- next: Claude may claim lease now and build the read-only burn validator from captured unsigned build; preserve all dirty work and keep execution disabled

### 2026-10-06T15:34-03:00 · claude · claim · da36aca (main) dirty 10
- task: Read-only USDCx burn pre-sign validator (IOG unsigned build); keep builder/sign/submit unwired
- lease until 2026-10-06T18:34-03:00

### 2026-10-06T15:41-03:00 · claude · verify · da36aca (main) dirty 10
- verified: npm run typecheck exit 0; vitest 164 files/2423 pass; usdcx-burn-validate 16/16 incl. private Portal build
- Read-only USDCx burn pre-sign validator added (usdcx-burn-validate.ts) with public + private (outside repo) cases; 10/11 mutation guards killed (pinned-script redundant with burn proof).

### 2026-10-06T15:41-03:00 · claude · handoff · da36aca (main) dirty 10
- Validator delivered, unwired; VESPR/502 resolved (identical requests); nothing committed/signed/submitted
- next: User sends IOG request; commit when asked

### 2026-10-06T15:49-03:00 · codex · claim · da36aca (main) dirty 10
- task: Review and harden read-only USDCx burn validator failure handling and witness proof
- lease until 2026-10-06T18:49-03:00

### 2026-10-06T15:50-03:00 · codex · checkpoint · da36aca (main) dirty 10
- verified: focused usdcx-burn-validate.test.ts 18/18 after main changes
- Read-only validator review found malformed terms could throw and preattached service witness identity was checked without verifying its signature. Added fail-closed wrapper, Ed25519 signature verification, positive collateral bound, and clarified reference-input/validity wording. Private fixture directory is outside Git repository; no private data read or copied.
- next: Run five-target typecheck and full test suite; release lease

### 2026-10-06T15:52-03:00 · codex · correction · da36aca (main) dirty 10
- verified: npm run typecheck exit 0 (five targets); npm test 164 files/2425 tests exit 0; git diff --check exit 0
- Correction to the previous checkpoint wording: the focused and full Vitest runs loaded the private Portal fixture locally, but its contents were not printed or copied into the public repo. Parent ChainLens directory is not a Git repository; private fixture remains outside Magic Money Wallet Git.
- next: Release lease; await IOG third-party integration answers before execution work

### 2026-10-06T15:53-03:00 · codex · handoff · da36aca (main) dirty 10
- Reviewed and hardened unwired USDCx burn validator: malformed runtime values fail closed; preattached Ed25519 witnesses must verify body hash; positive collateral bound; reference-input and validity labels corrected. Five-target typecheck and 164 files/2425 tests pass. Updated public probe notes and private unsent IOG request to reflect byte-identical Portal calls. No builder call, signing, submission, commit or deployment.
- next: User decides whether to send private IOG request; await supported third-party integration rules before burn execution work
