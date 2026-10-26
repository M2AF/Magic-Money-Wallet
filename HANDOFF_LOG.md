# Handoff journal — Magic Money Wallet
<!-- Append-only. Never edit or delete entries; correct with a new `correction` entry.
     Header: ### <iso-time> · <agent> · <kind> · <head> <clean|dirty N>. Use handoff.py log. -->

### 2026-10-14T16:55-03:00 · codex · checkpoint · 24d088b (main) dirty 21
- Final C3 gate exits1 solely on Sovereign strict selector matching both Sovereign and Mallard Ownership unavailable labels. 98 browser pass,1history flaky,1skip; all seven token-details first-attempt pass and2584unit pass. Log archived verify-ci-sovereign-selector-failure.log; narrow test-only scoping correction next, then fresh full rerun.
- next: Scope Sovereign ownership assertion, focused regression then fresh verify:ci; no application behavior changes.

### 2026-10-14T16:55-03:00 · codex · checkpoint · 24d088b (main) dirty 22
- Sovereign regression now passes first attempt after scoping unavailable label to Sovereign button; assertion remains substantive, application unchanged. Starting final fresh verify:ci after test-only correction, log .local-artifacts/cip113-c3/verify-ci.log with exitcode sidecar.
- next: Complete fresh full gate, mobile web builds, screenshot review/restore and release C3 contract to Claude L2.

### 2026-10-14T17:12-03:00 · codex · verify · 24d088b (main) dirty 23
- verified: C3 final CI=1 npm run verify:ci exits0: fiveTS,179files2584unit,fresh desktop+extension,99browser pass+1history-repeat flaky+1existing skip; seven token-details first attempt;0critical audit (4moderate4high unchanged). Public compiled read-only observer succeeds with exact hash-bound transaction outcome. HEAD24d088b plus dirty implementation; no feature-SHA GitHub CI/native/funds proof.
- Starting Android/iOS web bundles, logs .local-artifacts/cip113-c3/{capacitor,ios}-web.log; then screenshot review and tracked PNG archive/restore.

### 2026-10-14T17:14-03:00 · codex · verify · 24d088b (main) dirty 16
- verified: C3 local complete: final fresh verify:ci exits0; fiveTS/179files2584unit/fresh desktop+extension/99browser+1history flaky+1existing skip; seven token-details first attempt;0critical audit. Android/iOS web bundles exit0; final public observer passes; screenshot reviewed,7tracked PNGs archived/restored. HEAD24d088b plus dirty feature; no matching feature-SHA GitHub CI/native/funds/deploy proof.
- Claude L2 contract ready in docs/CIP113-C3-HANDOFF.md. Modules/available amount unknown; generic programmable Send/Swap/Receive unavailable. Cardanoscan token template vetted only for Cardano mainnet; NFT fallback ownership guard avoids duplicate unsafe generic paths.

### 2026-10-14T17:14-03:00 · codex · handoff · 24d088b (main) dirty 16
- C3 implemented and full local gate passed; wire packet, primary deployment pins, public observer evidence, fixtures, source guards, history outcome checks and vetted Cardano-mainnet explorer in docs/CIP113-C3-HANDOFF.md. No commit/push/deploy/sign/broadcast. Dirty C1/L1/C2/C3/chat work preserved.
- next: Claude claim L2 and implement programmable panel states from docs/CIP113-C3-HANDOFF.md; optional logged Cardano-mainnet explorer/Android Back follow-ups, then release to Codex C4. Keep modules unknown and generic programmable execution unavailable.

### 2026-10-14T17:16-03:00 · claude · claim · 24d088b (main) dirty 16
- task: L2: programmable-token states in universal panel + Cardanoscan link + Android hardware Back
- lease until 2026-10-14T23:16-03:00
- Consuming docs/CIP113-C3-HANDOFF.md; no commit/push/deploy

### 2026-10-14T17:39-03:00 · claude · handoff · 24d088b (main) dirty 17
- L2 done locally: ProgrammableTokenSection.tsx (badge, held vs available=unknown, rules unknown != unrestricted, collapsible registry/protocol refs, token balance changes recent-only), token-explorer.ts (Cardanoscan mainnet only, fixed template, unit validated, ?tab=programmable) via wallet link path, back-handler.ts + CapApp backButton hook. Tests: 5 unit new, e2e token-details 8/8. verify:ci exit0: 180 files/2589 unit, 100 browser pass,1 flaky (art-themes),1 skip, audit 0 critical; log .local-artifacts/token-details-l2-verify-ci.log. 7 generated PNGs archived to .local-artifacts/token-details-l2-generated and restored. Not verified: Android hardware Back on device, native camera, real funds, feature-SHA GitHub CI. No commit/push.
- next: Codex C4 (executable adapter/testnet QA) when scoped; user: commit/push decision + GitHub CI for feature SHA; native Android Back + camera validation pending.

### 2026-10-22T20:37-03:00 · codex · claim · 24d088b (main) dirty 17
- task: Desktop Agent Access: paired CLI/MCP, read/quote tools, reviewed proposal inbox
- lease until 2026-10-22T23:37-03:00

### 2026-10-22T20:50-03:00 · codex · checkpoint · 24d088b (main) dirty 22
- Agent Access desktop core, loopback transport, dependency-free exported CLI/MCP and inbox wired. 17 focused security/transport tests pass; no signer exposed. Starting fresh Electron build and disposable-profile e2e, evidence .local-artifacts/agent-access/. Existing dirty CIP113/chat preserved; no commit/push/deploy/sign/broadcast.
- next: Complete Electron pairing/proposal/revoke/restart journeys, review screenshots, self-review and full verify:ci.

### 2026-10-22T20:55-03:00 · codex · checkpoint · 24d088b (main) dirty 22
- Agent Access focused 17/17 tests and real Electron end-to-end pass (12.5s), including exported CLI/MCP, transfer and swap draft review, wrong-window IPC denial, revoke and restart. Reviewed 400/768/1200 inbox screenshots; minor contrast refinement applied. Starting frozen-source CI=1 npm run verify:ci; log .local-artifacts/agent-access/verify-ci.log. Tracked PNG originals preserved with hashes for post-suite restoration.
- next: Finish full gate, preserve generated PNG evidence and restore originals, final self-review and release.

### 2026-10-22T20:57-03:00 · codex · checkpoint · 24d088b (main) dirty 22
- Self-review found body-upload timeout also covered slower provider reads. Stopped only this task's initial verify:ci tree, fixed timeout scope and added 5.2s real-socket regression. Focused 18/18 pass. Archived incomplete gate log as verify-ci-pre-timeout-review.log; not a verification result. Restarting final frozen-source CI=1 verify:ci.
- next: Complete final full gate and screenshot/source preservation checks; no additional feature changes planned.

### 2026-10-22T21:00-03:00 · codex · checkpoint · 24d088b (main) dirty 22
- Final Agent Access gate: all five TypeScript targets and182files2607unit tests pass; fresh Electron/extension/injection builds pass. Full103-test browser suite now running with one worker and existing Worker stubs. No real funds, native build, deployment or matching feature-SHA CI claim.
- next: Complete103-browser suite and critical audit; restore tracked PNGs to preserved hashes and release.

### 2026-10-22T21:04-03:00 · codex · checkpoint · 24d088b (main) dirty 24
- Broad tour surfaced Agent button/wordmark overlap at narrow width. Replaced text with compact robot icon, reserved wordmark space, added geometric no-overlap assertions at380/420/768/1200. Stopped this task's gate for a fresh reviewed build; previous partial log archived as verify-ci-pre-titlebar-review.log (fiveTS/2607unit/builds/tour/agent journey passed; art-theme retry in flight). No tests weakened.
- next: Run focused fresh Electron layout journey, review screenshots, then final full gate on frozen sources.

### 2026-10-22T21:05-03:00 · codex · checkpoint · 24d088b (main) dirty 24
- Final header revision passes fresh Electron journey14.9s, with geometric no-overlap checks380/420/768/1200. Titlebar and refreshed inbox/swap screenshots reviewed. Starting final CI=1 verify:ci with source frozen; log .local-artifacts/agent-access/verify-ci.log. PNG originals remain preserved from first gate.
- next: Finish full verification without source changes unless a failure requires repair; restore generated PNGs and release.

### 2026-10-22T21:25-03:00 · codex · verify · 24d088b (main) dirty 22
- verified: Agent Access local: CI=1 verify:ci exit0; fiveTS/182files2607unit/fresh Electron+extension+injection/100browser pass+2retry-pass+1existing skip. Agent journey first attempt;18focused security tests. Header/inbox screenshots reviewed. Audit0critical5high4moderate; no dependency changes.202PNG hashes verified;7generated archived/restored. HEAD24d088b plus uncommitted shared work; GitHub CI pending, no funds/native/release proof.
- Setup and limits documented in docs/AGENT-ACCESS.md. No signer in agent API; read-only default, per-account/mode grants, revoke/expiry/restart denial, stable proposal requestIds and fresh normal wallet review. Scope is desktop only; no x402/delegated spending/new dependencies. Existing shared work preserved.
- next: Review local feature; user owns commit/push, then check matching main CI. Audit advisories require separate dependency review.

### 2026-10-22T21:25-03:00 · codex · handoff · 24d088b (main) dirty 22
- Desktop Agent Access ready for review and locally verified. Full results, constraints and evidence are in docs/AGENT-ACCESS.md and .local-artifacts/agent-access/. Existing shared dirty work preserved, generated PNG originals restored. No commit/push/deploy/install/sign/broadcast.
- next: User review/commit/push decision; after authorized push verify main CI for exact SHA. Rebuilt desktop robot icon opens Agent Access. Dependency advisories and C4/native QA remain separate.

### 2026-10-22T21:33-03:00 · codex · claim · 24d088b (main) dirty 22
- task: Agent approved native EVM sends with receipts and isolated autonomous account policies
- lease until 2026-10-23T00:33-03:00

### 2026-10-22T21:51-03:00 · codex · checkpoint · 24d088b (main) dirty 22
- Execution engine + native IPC + approval/policy/recovery UI implemented. 38 core/access tests and 36 core/desktop signing tests passed (overlapping core tests). Public fixture seed only, RPC mocked; no live broadcast. Fresh build running log .local-artifacts/agent-execution/build.log.
- next: Run fresh Electron execution journey and visual QA, strengthen coverage, then CI=1 npm run verify:ci; GitHub CI pending uncommitted changes.

### 2026-10-22T21:58-03:00 · codex · checkpoint · 24d088b (main) dirty 22
- 58 focused access/transport/execution/signature tests pass. Full real Electron lifecycle passed with offline RPC, screenshots reviewed 400/768/1200. No live funds. Source freeze for CI=1 npm run verify:ci; log .local-artifacts/agent-execution/verify-ci.log. Generated tracked PNG/app-hub originals saved.
- next: Wait for full verification; archive/restore generated tracked assets, record counts/audit/exact HEAD and GitHub pending status, release lease.

### 2026-10-22T22:00-03:00 · codex · checkpoint · 24d088b (main) dirty 22
- Final review expanded Stop-all to every wallet context and cancels an authorization still verifying its password. Added core + Electron regression coverage. Restarting final full gate after corrections; earlier stopped logs are diagnostic only.
- next: Final CI=1 verify:ci, restore generated assets, record exact results and release lease.

### 2026-10-22T22:05-03:00 · codex · checkpoint · 24d088b (main) dirty 23
- Final corrected-source gate: all five TypeScript targets pass, 184 unit files /2648 tests pass (59 agent-focused), fresh Electron/extension/injection builds pass. Full 104-test browser suite running one worker; audit queued. .local-artifacts/agent-execution/verify-ci.log. Earlier stopped logs are diagnostic.
- next: Wait for 104-test Playwright gate and production critical audit; restore generated assets, update docs/results, release lease. GitHub CI pending dirty uncommitted tree.

### 2026-10-22T22:11-03:00 · codex · checkpoint · 24d088b (main) dirty 30
- Nonce/receipt review added explicit rejection of any recorded sender/chain nonce reused by a new request, plus duplicate-hash ownership guard. Regression tests cover stale RPC nonce and faulty repeated hash. Stopped gate preserved as verify-ci-stopped-nonce-review.log; rerun full corrected-source gate next.
- next: Run final CI=1 npm run verify:ci, restore generated tracked assets and record exact results. Earlier stopped runs are not final verification.

### 2026-10-22T22:31-03:00 · codex · verify · 24d088b (main) dirty 23
- verified: Agent execution locally verified: CI=1 verify:ci exit0; fiveTS/184files2650unit(61agent)/fresh desktop+extension+injection/101browser pass+2retry-pass+1existing skip; both agent journeys first attempt. Audit0critical5high4moderate unchanged dependencies.202PNG+app-hub hashes verified;9generated PNGs archived/restored; diff-check passes. HEAD24d088b plus shared dirt; GitHub CI pending uncommitted/unpushed. No live funds/deployment.
- Both requested flows implemented for desktop native ETH Ethereum/Sepolia only. Durable pre-sign budgets/pre-broadcast hashes, isolated account1000+, exact limits/recipients/expiry/kill and owner recovery. Stale nonce/hash reuse and kill during password authorization covered. docs/AGENT-EXECUTION.md; .local-artifacts/agent-execution/verify-ci.log exit0.
- next: User-controlled review, pairing, isolated funding and any live QA; user owns commit/push, then verify exact-SHA GitHub CI.

### 2026-10-22T22:31-03:00 · codex · handoff · 24d088b (main) dirty 23
- Completed both requested desktop agent execution flows and final local gate. Source/docs/handoff updated; generated tracked assets restored and hashes verified. HEAD24d088b plus uncommitted shared tree; GitHub CI pending, no commit/push/deploy/live funds.
- next: User may enable Agent Access, pair an assistant and manually fund an isolated account; any live QA/commit/push remains user-controlled. On authorized push verify matching GitHub CI SHA.

### 2026-10-22T22:33-03:00 · codex · claim · 24d088b (main) dirty 23
- task: Design and feature-flagged human-approved x402 desktop support; phase2 design only
- lease until 2026-10-23T01:33-03:00

### 2026-10-22T22:42-03:00 · codex · checkpoint · 24d088b (main) dirty 23
- Reviewed official x402 v2 + EIP-3009 + Circle addresses; pinned upstream56054d8. Wrote docs/X402.md threat model, flow, shapes, UI and phase2 design. Added unsigned strict validator + focused tests. Asked required clarification: Send/Swap-only constraint conflicts with returning facilitator-redeemable EIP-3009 signatures; URL/grant cannot be enforced by token contract and issued signatures cannot be locally revoked. No executable x402 signing work before answer.
- next: Await settlement-path clarification while testing unsigned validation. If approved implement bounded native signer/feature flag/UI/retrieval and stubbed testnet facilitator journey; then full CI=1 verify:ci. Preserve prior ETH execution/dirty work.

### 2026-10-22T22:43-03:00 · codex · checkpoint · 24d088b (main) dirty 23
- 26 unsigned x402 validation tests pass. No runtime signer/feature UI/tool exposure implemented while required settlement-path clarification is pending. Starting CI=1 npm run verify:ci for independently completed design/validation changes; .local-artifacts/x402/verify-ci.log. Tracked PNG/app-hub originals preserved.
- next: Await required answer; if allowed build bounded x402 phase1. If no answer, report design/validator only and exact remaining approval blocker after full gate; do not claim x402 supported.

### 2026-10-22T23:05-03:00 · codex · checkpoint · 24d088b (main) dirty 23
- User explicitly approved bounded x402 exception, then changed scope: reuse isolated accounts, automatic USDC/Base signing inside owner caps and exact URL/payTo rules, fallback wallet approval for valid exceptions, max5min expiry. This supersedes original phase2-design-only limit. Implemented X402Core sealed authority budget/nonce lifecycle, fixed native EIP-3009 signer, feature-flagged core tools/IPC, account USDC controls and same-panel exception inbox. 55 focused tests pass. No live funds; full final gate after real Electron stub facilitator journey.
- next: Complete x402 native/Electron testnet fixture and policy edge coverage, update docs to latest scope, source freeze then full CI=1 verify:ci; preserve/restore assets and release lease.

### 2026-10-23T01:51-03:00 · codex · claim · 24d088b (main) dirty 23
- task: Bounded automatic x402 on existing isolated accounts; USDC rules, native exceptions and final verification
- lease until 2026-10-23T04:51-03:00

### 2026-10-23T01:51-03:00 · codex · checkpoint · 24d088b (main) dirty 23
- x402 source freeze: 75 focused tests pass including broker permissions, durable reservation failure, review/rejection races, nonce collision and sealed payload binding corruption. Fresh desktop x402 journey passes automatic and native one-payment exception, actual EIP712 recovery, replay rejection, exact URL retrieval and Stop; existing ETH and Agent Access journeys pass. Screenshots400/768/1200 reviewed. docs updated to owner-authorized automatic scope. Starting final CI=1 npm run verify:ci; .local-artifacts/x402/verify-ci.log; generated asset originals preserved. No live funds/dependencies changed.
- next: Wait final full gate; inspect logs and audit; archive/restore generated tracked assets with preserve_generated.py restore; document exact results and GitHub CI pending, then release.

### 2026-10-23T02:14-03:00 · codex · verify · 24d088b (main) dirty 23
- verified: x402 locally verified: CI=1 npm run verify:ci exit0; fiveTS/187files2711unit/fresh desktop+extension+injection/101browser pass+3retry-pass(existing themes/history/eyedropper)+1existing skip; x402 and existing agent journeys first attempt.75focused tests. Audit0critical5high4moderate unchanged dependencies;203asset hashes verified,8generated PNGs archived/restored; diff-check passes. HEAD24d088b plus shared dirt; GitHub CI pending uncommitted/unpushed. No live funds/deployment.
- Evidence .local-artifacts/x402/verify-ci.log and verify-ci.exitcode=0; docs/X402.md contains current auto-policy scope, setup, authority limits, recovery limitation and exact results. Stop/revoke cannot recall already released signatures; URL binding is local only. No source edits after full-gate build; documentation/handoff updates only.

### 2026-10-23T02:14-03:00 · codex · handoff · 24d088b (main) dirty 23
- Implemented bounded automatic x402 on existing isolated accounts and native exceptions behind default-off flag; locally verified full gate. Preserved shared dirty work; no commit/push/deploy/live funds. USDC recovery remains manual via displayed seed path.
- next: Owner may review local changes; after authorized commit/push verify matching GitHub CI. Setup in docs/X402.md. Live settlement/recovery QA remains separate.

### 2026-10-25T20:39-03:00 · codex · claim · 24d088b (main) dirty 23
- task: Monad143 Emogotchi isolated-account allowlisted contract calls; bounded MON policies and existing receipts
- lease until 2026-10-25T23:39-03:00

### 2026-10-25T20:50-03:00 · codex · checkpoint · 24d088b (main) dirty 23
- Monad agent execution implemented: chain143 native approval/autonomous/recovery with explicit chain-specific policies and receipt/explorer tracking; fixed Emogotchi ABI, token-ID opt-in, codehash/ownership/simulation guards, exact1MON care/zeroMON pet1..20, shared amount+fullgas budget, no raw calldata. Verified Sourcify exact_match/nonproxy and live read-only chain143 code hash6b1b2801. User clarified general Monad support and pet terminology.140 focused tests pass (existing native/x402 regression included). Fresh desktop build +3 focused Electron journeys running session81376; .local-artifacts/agent-monad/e2e-focused.log.203 generated assets backed up. No live signing/funds/commit/push.
- next: Finish focused Electron journeys and typecheck, inspect screenshots; update docs and source freeze, full CI=1 verify:ci; archive/restore generated assets and release.

### 2026-10-25T20:54-03:00 · codex · checkpoint · 24d088b (main) dirty 23
- Focused Monad Electron journey now passes end to end (9.2s), existing ETH/x402 journeys passed on fresh desktop build. Fixed RLP zero-value decode for nonpayable pet, with explicit signer regression.142focused tests pass, five-target typecheck previouslypass. Docs AGENT-MONAD.md cover general native143, policy/network UI, fixed calls, gas/code/ownership pins, manual NFT recovery and blocked high-value actions. Beginning final review/source freeze before required full gate; all RPC submissions intercepted.
- next: Review final source invariants/screenshots, run final CI=1 npm run verify:ci; preserve generated assets and update exact local/remote handoff results.

### 2026-10-25T20:54-03:00 · codex · checkpoint · 24d088b (main) dirty 23
- Source frozen for Monad/Emogotchi extension.142 focused tests and positive Monad Electron journey pass; existing ETH/x402 focused journeys pass. Five-target typecheck passed before final small zero-value/UI correction; final full gate recompiles all. Screenshots400/768/1200 reviewed; improved phone policy screenshot scroll target. Starting CI=1 npm run verify:ci; log .local-artifacts/agent-monad/verify-ci.log, originals203assets preserved. No dependencies, native platform changes, live wallet funding/signing or deployment.
- next: Wait final verify:ci; inspect x402/ETH/Monad default/positive journeys and audit. Archive/restore tracked generated assets, record exact results in docs/AGENT-MONAD.md/board, release lease.

### 2026-10-25T21:16-03:00 · codex · verify · 24d088b (main) dirty 23
- verified: Monad locally verified: CI=1 verify:ci exit0; fiveTS/188files2762unit/fresh desktop+extension+injection/101browser pass+4retry-pass(existing Sappy/history/downloads/natural-materials)+1existing skip. All4agent Electron journeys first attempt;142focused pass;400/768/1200 reviewed. Audit0critical5high4moderate unchanged dependencies.203asset hashes verified;9generated PNGs archived/restored; diff-check passes. HEAD24d088b plus shared dirt; GitHub CI pending uncommitted/unpushed. No live funds/deployment.
- Docs AGENT-MONAD.md contain setup, exact fixed-call schema, Source/Sourcify/live-read-only codehash proof, policy/nonce/custody boundaries, manual NFT recovery and complete results. No source changes after source-frozen full gate; only documentation/handoff and original generated-asset restoration.

### 2026-10-25T21:16-03:00 · codex · handoff · 24d088b (main) dirty 23
- General Monad143 agent native transfers, isolated MON policies, native recovery and receipts complete locally; separate Emogotchi token-ID/function opt-in with exact1MON care and zeroMON pet. Full local gate passed; shared dirt preserved. No commit/push/deploy/live wallet operations. NFT recovery remains manual; other contracts/high-value actions blocked.
- next: Owner reviews local changes; after authorized commit/push verify matching GitHub CI. Guide docs/AGENT-MONAD.md. Any real MON/NFT funding, transfer, contract-call or recovery QA requires separate authorization.
