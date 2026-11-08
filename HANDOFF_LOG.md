# Handoff journal — Magic Money Wallet
<!-- Append-only. Never edit or delete entries; correct with a new `correction` entry.
     Header: ### <iso-time> · <agent> · <kind> · <head> <clean|dirty N>. Use handoff.py log. -->

### 2026-10-26T21:48-03:00 · codex · handoff · 22c10e1 (main) dirty 5
- SOL cross-chain pre-offer simulation and bounded bridge fallback complete locally; full gate passes. Retry preserved. Generated assets restored. No jobs, signing, broadcasting, commits, deployment or install.
- next: Use rebuilt local wallet to receive source-route fix; owner controls packaging/commit/push. Verify matching feature-SHA GitHub CI after authorized push; real-funds delivery remains separate QA.

### 2026-10-26T21:52-03:00 · codex · claim · 22c10e1 (main) dirty 5
- task: Native SOL and ADA agent approval/autonomous isolated accounts, recovery and chain-specific receipts; preserve Base x402
- lease until 2026-10-27T00:52-03:00

### 2026-10-26T22:00-03:00 · codex · checkpoint · 22c10e1 (main) dirty 5
- Scope expanded by owner: x402 must accompany every agent execution network, including Solana and Cardano. Official x402 exact SVM/Cardano specs pinned at57e703e5dbb5e5cfdbeaaaa3ff6cde5dca0f0b93 under .local-artifacts/agent-non-evm. Research only so far; preserve unrelated SOL cross-chain dirty work. Next implement explicit network-bound x402 limits and chain-specific constrained payment builders; no real funds.
- next: Implement network-bound x402 EVM expansion plus SOL/ADA execution/payment adapters with separate ledgers and canonical receipts; full verify:ci before claiming implementation validated.

### 2026-10-26T22:10-03:00 · codex · checkpoint · 22c10e1 (main) dirty 17
- Implementation in progress, NOT validated: new agent-native shared/core/desktop and strict Solana/Cardano payment adapters, new AgentNativePanel, broker/IPC/preload routing. EVM x402 supports Ethereum/Sepolia/Monad with explicit network budgets preserving legacy Base permissions. Native SOL/ADA account derivations/recovery, pure-ADA input selection/TTL, sponsor-paid SPL USDC partial signatures, exact requirements. Source compilation passed node after API fixes; web requires shared include being fixed. Need security tests, provider receipt schema confirmation, Electron fixtures, all-target TS/full verify:ci. No live funding/signing/broadcast. Current baseline generated assets backed up.
- next: Finish native journal validation/security tests and offline Electron journeys; validate provider schemas, review UI; full verify:ci and asset restoration before completion.

### 2026-10-26T22:27-03:00 · codex · checkpoint · 22c10e1 (main) dirty 24
- Native milestone: actual disposable-key SOL/ADA adapter signatures, restricted transaction construction and canonical receipt tests pass. Offline Electron native journey passed17.9s: both chain native approval/autonomy/status, separate x402 rules, automatic/owner-exception issuance, independent facilitator signature checks/replay, Stop all. Reviewed400/768/1200 captures for both; accessibility label fixed. Native expired-policy recovery corrected and tests added. Ethereum/Sepolia/Monad/Base explicit EVM network limits and signer tests pass. No live funds. Beginning required CI=1 npm run verify:ci, log .local-artifacts/agent-non-evm/verify-ci.log;1231 generated assets backed up for restoration.
- next: Run full verify:ci, fix any regressions, inspect current exception screenshots, restore asset hashes, update docs/board with exact SHA and local versus remote results.

### 2026-10-26T22:29-03:00 · codex · correction · 22c10e1 (main) dirty 24
- Preflight found Vite dynamic-import parsing failure after adapter .mjs was rewritten with CRLF; native Node import/CLI worked. Restored LF in resources/agent-access.mjs; isolated transport5tests now pass. No test weakened. Full verify:ci starts after this correction; prior focused log retained as diagnostic.
- next: Run final full gate with fresh Electron and native exceptions/recovery tests; preserve/restore generated asset backups.

### 2026-10-26T22:31-03:00 · codex · checkpoint · 22c10e1 (main) dirty 24
- Security review added internal assertSigningAuthority after provider/key awaits inside both native signers, in addition to outer post-sign discard. Stopped only this verification process tree during preflight to ensure a clean final gate covers the new guard; diagnostic preserved verify-ci-preflight-stopped.log. Added tests proving stopped authority prevents mnemonic loading. Native Electron17.9s prior build positive; final rerun includes new guards and before-approval screenshots. MJS LF transport regression fixed with5test pass.
- next: Final CI=1 verify:ci -> restore1231 asset hashes -> current UI review/docs/exact-SHA handoff.

### 2026-10-26T22:34-03:00 · codex · checkpoint · 22c10e1 (main) dirty 24
- Final security preflight complete:216focused tests in9files pass. Native Stop now denies in memory even if disk persistence fails (same model as existing EVM); global Stop attempts native stop even if EVM stop throws. Native expired-policy owner recovery tested. Signer inner authority guards tested before mnemonic loading. Earlier full gate intentionally stopped during preflight/units for these safety fixes; logs diagnostic only. Starting final CI=1 verify:ci now against current sources.
- next: Await final verify-ci.log/exitcode; review fresh native exception screenshots; restore all1231 assets; update exact-SHA docs and release lease.

### 2026-10-26T22:38-03:00 · codex · checkpoint · 22c10e1 (main) dirty 24
- Final native SOL repeated-send review: distinct requests in one recent-blockhash window now include a wallet-generated Memo identity, preventing silent identical hashes; retries retain original message. Solana input/message locks use message digest. Regression test verifies distinct hashes and identical retry.217focused tests/9files pass. No source edits planned during final gate. Previous stopped logs diagnostic only.
- next: Run final complete verify:ci; then asset hash restoration, fresh exception screenshot review and final docs/handoff.

### 2026-10-26T22:41-03:00 · codex · claim · 22c10e1 (main) dirty 24
- task: SOL/ADA agent execution and network-bound x402 on every agent execution network
- lease until 2026-10-27T01:41-03:00

### 2026-10-26T22:53-03:00 · codex · correction · 22c10e1 (main) dirty 49
- Full gate191files2859unit and5TS passed; all prior agent journeys passed, new native journey hit broker20/minute rate limit on added fixture calls. Test clock override did not affect captured broker clock. Removed fake-clock override and redundant broker calls (no production limit changes); isolated native journey now passes21.4s including both actual signatures/facilitators, current source, inner guards and strict20-call budget. Added OS-storage rejection/restart/default-off native tests and Linux no-secure-storage denial branch. Earlier gate stopped after repeated fixture failure; verify-ci-native-failure.log diagnostic.
- next: Run final full verify:ci against final current tree; restore1231 generated assets and inspect new exception screenshots; record exact local/remote status.

### 2026-10-27T01:59-03:00 · codex · claim · 22c10e1 (main) dirty 53
- task: Finalize verified SOL/ADA execution and all-agent-network x402 handoff
- lease until 2026-10-27T04:59-03:00

### 2026-10-27T02:01-03:00 · codex · verify · 22c10e1 (main) dirty 24
- verified: SOL/ADA agents and all-agent-network x402 locally verified at22c10e1 plus shared dirty tree: CI=1 verify:ci exit0; fiveTS,192files2862unit,220focused, fresh desktop/extension/injection,106browser first-pass+1existing skip, no retries. Audit0critical5high4moderate;1231asset hashes verified and29generated PNGs restored; diff-check passes. GitHub feature CI pending uncommitted/unpushed; base CI success40254402500. No real funds/deploy/install.
- Evidence .local-artifacts/agent-non-evm/verify-ci.log, verify-ci.exitcode, generated-restoration.json, native screenshots and github-base-ci.json. All5agent journeys first attempt; native14.7s, fullbrowser18.6m. Current docs record chain-specific expiry and recovery limits. No implementation changes after final complete gate; only verification docs/board updated.
- next: Owner controls commit/push/install; check matching-SHA main CI after authorized push, with any live-funds QA separately authorized.

### 2026-10-27T02:02-03:00 · codex · handoff · 22c10e1 (main) dirty 24
- SOL/ADA native approval/autonomy/recovery/receipts and x402 on all current agent execution networks locally complete and verified. CI=1 verify:ci exit0:5TS,192files2862unit,106browser first-pass+1existing skip,220focused pass. All5agent journeys first attempt. Audit0critical5high4moderate unchanged deps.1231asset hashes verified,29generated PNGs archived/restored; diff-check pass. docs/AGENT-NATIVE.md and docs/X402.md record exact scope/limits/evidence. No jobs, real funds, commit/push/install/deploy. GitHub feature CI pending uncommitted/unpushed; base22c10e1 CI success40254402500.
- next: Owner controls commit/push/install. After authorized push, verify matching-feature-SHA CI on main; any live-funds QA remains separately authorized.

### 2026-10-28T20:21-03:00 · claude · claim · 22c10e1 (main) dirty 24
- task: Record IOG USDCx SDK API findings
- lease until 2026-10-28T21:21-03:00

### 2026-10-28T20:21-03:00 · claude · checkpoint · 22c10e1 (main) dirty 25
- IOG published USDCx SDK API: health/store-datum/register-withdrawal; key works (health 200); no builder on SDK host (404). Documented in USDCX-BURN-BUILD-PROBE.md.

### 2026-10-28T20:21-03:00 · claude · handoff · 22c10e1 (main) dirty 25
- SDK findings recorded; no code changes
- next: User decides: implement Worker-held key + register-withdrawal client (unwired from burn), and ask IOG about building

### 2026-10-28T20:38-03:00 · claude · claim · 22c10e1 (main) dirty 25
- task: Cardano -> Solana/EVM swaps via NEAR Intents 1Click in DEX Swap (ADA origin)
- lease until 2026-10-29T00:38-03:00

### 2026-10-28T21:15-03:00 · claude · verify · 22c10e1 (main) dirty 35
- verified: typecheck 0; vitest 195 files/2891 pass; desktop/extension/capacitor/iOS-bundle builds 0; e2e cardano-swap 10/10 (workers=1); 11/11 mutations killed; live read-only quote + executable-quote checks pass
- Cardano -> Solana/EVM via NEAR Intents 1Click built: client (signature/binding/deposit checks), quote+status in swap-proxy, executor (exact ADA payment, record before submit, no resend), UI disclosure; shared types + ChainLens swap-core bundle regenerated

### 2026-10-28T21:15-03:00 · claude · handoff · 22c10e1 (main) dirty 35
- NEAR Intents Cardano exit route built; uncommitted; awaiting user real-funds QA
- next: User: small ADA -> SOL swap in app; then partner key

### 2026-10-28T21:25-03:00 · claude · claim · 22c10e1 (main) dirty 35
- task: NEAR Intents partner key via Worker route (+ fee wiring pending NEAR account)
- lease until 2026-10-29T00:25-03:00

### 2026-10-28T21:30-03:00 · claude · checkpoint · 22c10e1 (main) dirty 36
- 1Click partner key (distribution_channel, partner chainlens, expires 2027-10-29) uploaded as Worker secret ONE_CLICK_API_KEY on magicmoney-swap-proxy; key verified (+0.19% output). New route cloudflare-worker/near-intents.js (POST /near-intents/quote, GET /near-intents/status; Cardano-ADA only; appFees only to NEAR_FEE_ACCOUNT at NEAR_FEE_BPS). Client uses route with keyless fallback. NOT deployed yet.
- next: User approves 'npx wrangler deploy'; provide NEAR fee account for Magic Money fee

### 2026-10-28T22:11-03:00 · claude · checkpoint · 22c10e1 (main) dirty 43
- verified: typecheck 5 targets; vitest 196 files 2905 tests (before +1 test); builds electron/extension/capacitor/swap-core; e2e cardano-swap 11/11 --workers=1; chained-swap 15/15 with 3 mutants killed
- Multi-step Cardano token -> other-chain swaps wired on all targets (chained-swap.ts/handler/ChainedSwapPanel)
- Fixed: execute error + unreadable swap record no longer resends (needs-review); test + mutant added
- Live read-only: ADA->BONK plans NEAR+Jupiter; SNEK refused (Minswap V1 liquidity, needs V1 validator)
- next: Reverse direction Solana/EVM -> Cardano via NEAR; user: wrangler deploy approval + NEAR fee account

### 2026-10-28T22:48-03:00 · claude · checkpoint · 22c10e1 (main) dirty 49
- verified: typecheck 5 targets; vitest 197 files 2919 tests; builds; e2e cardano-swap 12/12 (--workers=1); 6 validator mutants killed
- SundaeSwap V3 orders added as 3rd Cardano route: sundae-v3-order.ts + cardano-sundae-validate.ts; V2 validator unchanged
- Script fa6a58bb pinned from sundae-contracts plutus.json; agg stake f217f435 pinned; fixtures __fixtures__/sundae (live unsigned builds, public addr)
- Live read-only: ADA->SNEK pipeline selects SundaeSwap V3 and passes pre-sign check
- next: User real-funds QA: small ADA->SNEK (SundaeSwap); then reverse direction Solana/EVM -> Cardano

### 2026-10-29T03:02-03:00 · claude · checkpoint · 22c10e1 (main) dirty 51
- verified: typecheck; vitest 198 files 2934 tests; builds; e2e cardano-swap 14/14 + picker 4/4 + token-swap-button; mutants killed (reserve rules, ERC-20 amount, retry)
- Cardano <-> 9 NEAR chains both ways (single + multi-step), swap history, card fixes
- Into Cardano: quoteNearIntentsToCardano, executeNearIntentsDeposit (wallet-built transfer), measureCardanoCredit, planIntoCardano with planning estimate
- Abstract and Gnosis excluded (1Click refuses EOA / no liquidity)
- next: User real-funds QA of a small into-Cardano swap; Worker deploy approval; NEAR fee account

### 2026-10-30T20:26-03:00 · codex · claim · 1118b17 (main) dirty 1
- task: Prepare next GitHub release; diagnose current CI and iOS blockers
- lease until 2026-10-30T23:26-03:00

### 2026-10-30T20:34-03:00 · codex · checkpoint · 1118b17 (main) dirty 10
- Prepared v0.11.3/versionCode29; user excludes iOS from release. Removed iOS release builder and asset requirement; CI and Release now use verify:ci with fresh desktop and one worker.
- Starting CI=1 npm run verify:ci; log .local-artifacts/release-prep/verify-ci.log. Current main1118b17 CI failure40830192318 (Sappy Cancel click timeout); no tag/push/publication.
- next: Finish local verification, inspect failures, then stage release for review and GitHub validation.

### 2026-10-30T21:00-03:00 · codex · checkpoint · 1118b17 (main) dirty 10
- Local typecheck all5 and unit suite198files/2934tests pass for release0.11.3. verify:ci continues builds/e2e/audit; .local-artifacts/release-prep/verify-ci.log.
- Starting Android bundle plus actual Gradle assembleDebug for version metadata validation; no installation or release signing. Log .local-artifacts/release-prep/android-build.log.

### 2026-10-30T21:17-03:00 · codex · verify · 1118b17 (main) dirty 10
- verified: CI=1 verify:ci exit0; all5TS/198files2934unit/fresh builds/108e2e+2flaky retry passes+2skips; audit0critical5high4moderate. Log .local-artifacts/release-prep/verify-ci.log; Android native local blocked missing JDK24.
- User grants full control; next commit/push release setup then exact-head main CI before tag. No iOS release. Generated screenshots archived/restored.

### 2026-10-30T21:35-03:00 · codex · checkpoint · 6e982a1 (main) dirty 1
- User switches to Claude. Stopped publisher session79984; current remote main6e982a15fb9c99e11fc320a4a72937614a206e0b, matching CI41149492331 running, no v0.11.3 tag/release. Pickup .local-artifacts/release-prep/CLAUDE-PICKUP.md.
- next: Claude claim lease; gh run watch41149492331 --repo M2AF/Magic-Money-Wallet --exit-status; require exact main SHA success, then tag verified6e982a1 asv0.11.3 and push only that tag; monitor Release and all11non-iOS asset gates. Do not bump again.

### 2026-10-30T21:35-03:00 · codex · handoff · 6e982a1 (main) dirty 3
- Handed release0.11.3 to Claude; publisher stopped; main6e982a1 pushed, exact-head CI running; no tag/release. Full pickup and evidence in .local-artifacts/release-prep/CLAUDE-PICKUP.md.
- next: Claude claim; watch CI41149492331 for6e982a15fb9c99e11fc320a4a72937614a206e0b; on success tag existing versionv0.11.3, push tag, watch Release and verify11non-iOS asset patterns. Do not run version bump again.

### 2026-11-07T00:00-03:00 · claude · verify · 6e982a1 (main) dirty
- Picked up 0.11.3. Main CI was red on 6e982a1 (19 failures) because CI/Release ran `verify:ci`, which builds the desktop app BEFORE e2e on Linux, so the Electron specs (Windows electron.exe, Hello stubs) stopped self-skipping. Restored CI/Release to: typecheck, unit, extension e2e `--workers=1` BEFORE any build, critical audit (CI then builds). AGENTS.md corrected: `verify:ci` is a LOCAL Windows gate, never the workflow step.
- Real bug fixed: Sappy Seals `.portfolio-controls-region` (margin-top:-32px) intercepted clicks on the header toolbar (Settings). Region now pointer-events:none with its non-seal children re-enabled. The old "Sappy Settings/Cancel timeout" was this bug, not load.
- Local verify:ci exit 0 (2934 unit, 111 e2e, audit). nft-gallery mosaic full-page screenshot crashed once (5.5s, page closed); 16/16 reruns pass — rare Chromium screenshot crash, CI retries cover it.
