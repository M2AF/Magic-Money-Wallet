# Handoff journal — Magic Money Wallet
<!-- Append-only. Never edit or delete entries; correct with a new `correction` entry.
     Header: ### <iso-time> · <agent> · <kind> · <head> <clean|dirty N>. Use handoff.py log. -->

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

### 2026-10-06T21:57-03:00 · codex · claim · 02bea62 (main) dirty 1
- task: Port ChainLens NFT media coverage and add collection mosaic toggle beside Search
- lease until 2026-10-07T00:57-03:00

### 2026-10-06T22:04-03:00 · codex · checkpoint · 02bea62 (main) dirty 15
- Baseline HEAD02bea62 clean: five-target typecheck and164files/2425tests pass. Ported gateway/CBOR/file source helpers and six-slot displayed-image loader; adding collection toggle with full4-item chunks and vertical pairs. New metadata tests cover exact URI gateway fallback; initial full run only failed five old ipfs.io expectations. Logs .nft-mosaic-*.log ignored.

### 2026-10-06T22:05-03:00 · codex · checkpoint · 02bea62 (main) dirty 20
- Mosaic toggle implemented left of Search; groups by chain+contract, all items in4-item chunks with vertical half-width pairs; favorites/spam/search use existing cache. Extension bundle passes and focused media/RPC/Cardano tests pass. Starting full typecheck/tests and extension browser journeys in .nft-mosaic-*.log.

### 2026-10-06T22:15-03:00 · codex · verify · 02bea62 (main) dirty 21
- verified: Five TypeScript targets pass; 165 test files and 2433 unit tests pass; three unpacked-extension browser journeys pass; desktop, extension, Android Vite and iOS Vite bundles pass; git diff --check passes. Native Android/iOS and deployed ownership scans were not run.
- Wallet NFT media coverage and collection mosaics complete locally. Captured real Lil Sappys records: 10 of 10 images decoded across three mosaic tiles; final pair stacked vertically. Preview: test-results/nft-mosaic-lil-sappys-live.png. This was media validation with captured records, not a new ownership scan.
- next: User review, commit and push. Preserve existing native swap QA requirements.

### 2026-10-06T22:15-03:00 · codex · handoff · 02bea62 (main) dirty 22
- Completed ChainLens-style NFT media resolution and Mosaic toggle left of Search. All collection items retained; pairs stack vertically; existing detail, favorites, spam and search remain available without refetching ownership on view changes. Documentation and screenshot evidence saved. No commit, push or deployment.
- next: Review test-results/nft-mosaic-lil-sappys-live.png and docs/NFT-GALLERY-PERFORMANCE.md, then commit/push when ready.
