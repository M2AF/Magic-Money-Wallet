# Handoff board — Magic Money Wallet
<!-- handoff v1. LIVE STATE ONLY: rewrite in place, keep under ~60 lines.
     History goes in HANDOFF_LOG.md. Machine fields above the first ## are managed by handoff.py. -->

owner: none
task: -
lease_until: -
repo: .
verify: cmd /c "npm run typecheck && npm test"
verified: 24d088b · Monad locally verified: CI=1 verify:ci exit0; fiveTS/188files2762unit/fresh desktop+extension+injection/101browser pass+4retry-pass(existing Sappy/history/downloads/natural-materials)+1existing skip. All4agent Electron journeys first attempt;142focused pass;400/768/1200 reviewed. Audit0critical5high4moderate unchanged dependencies.203asset hashes verified;9generated PNGs archived/restored; diff-check passes. HEAD24d088b plus shared dirt; GitHub CI pending uncommitted/unpushed. No live funds/deployment. · 2026-10-25T21:16-03:00
head: 24d088b (main) dirty 23
updated: 2026-10-25T21:16-03:00 · codex

resources: -

## Now
- Monad agent extension complete locally: chain143 MON approval/autonomous/recovery and restricted Emogotchi calls with explicit token-ID opt-in, full-cost MON budgets, code/ownership checks, fixed calldata/value and existing receipts.142focused tests; final full gate passes; all4agent journeys first attempt. docs/AGENT-MONAD.md. No jobs/live funds. NFT recovery manual via displayed seed path; other pet contracts and revive/setName remain blocked.
- x402 complete locally under owner-updated scope: existing isolated account, automatic Base-USDC within explicit USDC caps/exact URL/inherited payTo rules; valid exceptions in same native inbox. Max5min, wallet nonce, sealed authority budget, default-off MAGICMONEY_X402=1 startup flag.75focused tests and final full gate pass; all3agent Electron journeys first attempt. docs/X402.md. No live funds. USDC recovery manual via displayed seed path; Native recovery labels match policy currency.
- Desktop Agent Access/execution complete locally: approval -> native ETH sign/submit -> durable hash/status, plus isolated account1000+ policies (recipients/full-cost caps/expiry/kill/recovery). Original Ethereum/Sepolia milestone; Monad extension above supersedes ETH-only scope. That milestone gate passes;61focused agent tests; both real Electron journeys first attempt with intercepted RPC/public seed. No live funding/sign/broadcast. docs/AGENT-EXECUTION.md.
- C1/L1/C2/C3 implemented and locally verified. Canonical-mainnet CIP-113 reader exposes exact holdings, authenticated core wiring and recent token balance changes; module rules/available amount remain unknown, generic execution unavailable. docs/CIP113-C3-HANDOFF.md is the Claude L2 contract.
- Universal clickable token panels, validated receive QR and reviewed address-only send scans are complete. Preserve all uncommitted feature/chat work; no commit/push/deploy/sign/broadcast.
- Prior chat/NFT work remains locally verified: PFP actions, header refresh, layout and stale runtime/main-watch fix. User confirmed header/menu; same dev-watch runtime/data preserved. Native/production sync remains separate. docs/CHAT-PROFILE-MENU.md and docs/NFT-PROFILE-PICTURES.md.
- User source commits fd4af18 then24d088b are preserved. Shared Supabase migration20261013012323 applied previously; legacy pictures need explicit NFT reselection. No new backend/dependency/native changes in C3.

## Verification status
- Monad final CI=1 verify:ci exits0 (2026-10-25): fiveTS/188files2762unit/fresh desktop+extension+injection/101browser pass+4retry-pass(existing Sappy/history/downloads/natural-materials)+1existing skip.142focused pass; Agent Access/ETH/Monad/x402 first attempt;400/768/1200 reviewed. Audit0critical5high4moderate; no dependency changes.203asset hashes verified;9generated PNGs archived/restored; diff-check passes. .local-artifacts/agent-monad/verify-ci.log.
- x402 final CI=1 verify:ci exits0 (2026-10-23): fiveTS/187files2711unit/fresh desktop+extension+injection/101browser pass+3retry-pass(existing Sappy Seals/history-repeat/eyedropper)+1existing currency skip. x402 first attempt: automatic, native exception, real EIP712 recovery, retry/replay/URL/Stop.75focused pass;400/768/1200 reviewed. Audit0critical5high4moderate; dependencies unchanged.203asset hashes verified;8generated PNGs archived/restored; diff-check passes. .local-artifacts/x402/verify-ci.log.
- Agent execution final CI=1 verify:ci exits0: fiveTS,184files2650unit (61agent),fresh desktop/extension/injection,101browser pass+2retry-pass(Sappy Seals/history-repeat)+1existing skip. Both agent journeys first attempt; execution400/768/1200 reviewed. Audit0critical,5high4moderate; dependencies unchanged.202PNG+app-hub hashes verified,9generated PNGs archived/restored; diff-check passes. .local-artifacts/agent-execution/verify-ci.log.
- C3 final CI=1 verify:ci exits0: fiveTS/179files2584unit/fresh desktop+extension/99browser+1history-repeat flaky pass+1existing skip; seven token-details first attempt. Audit0critical,4moderate4high unchanged. Android/iOS web bundles pass. Public read-only observer passes; screenshot reviewed,7tracked PNGs archived/restored. .local-artifacts/cip113-c3/verify-ci.log.
- HEAD24d088b plus uncommitted shared work; matching feature-SHA GitHub CI/native camera/hardware Back/real-funds/deployment proof absent. Historical C2/dev-watch/chat gate logs remain linked below. Prior full C3 failure was Sovereign duplicate-label selector; scoped test-only correction passed isolated and final full gate.

## Next
- Owner reviews local changes; after authorized commit/push verify matching GitHub CI. Guide docs/AGENT-MONAD.md. Any real MON/NFT funding, transfer, contract-call or recovery QA requires separate authorization.

## Traps
- Emogotchi143 requires caller ownership even for paid care; ERC721 operator approval is insufficient. No automatic NFT transfer; recovery currently needs a trusted wallet with the displayed m/44'/60'/1000+/0/0 path. Recover MON is native only. RLP parsing may omit a zero value: normalize to0n when verifying nonpayable pet; native zero-value inputs remain denied.
- Only the lease owner edits shared code; preserve dirty work. No commit/push/deploy/install/sign/broadcast without user authorization.
- clip-path alone does not contain the animated NFT pseudo-element for scroll sizing: retain overflow:hidden on the avatar. Reproduced9px right-edge feed overflow before fix.
- Native Android/iOS runtime and production profile sync are separate from local browser/TypeScript/build results.
- Existing NFT source cannot be inferred from image URL; uploaded photos remain circular, and legacy pictures need explicit NFT reselection.
- Run CI=1 npm run verify:ci with fresh Electron build BEFORE e2e; one browser worker, all live Workers stubbed. GitHub CI must match current committed SHA; base green does not verify dirt. Generated tracked PNGs must be archived and originals restored.
- All Cardano outbound/CCIP burn execution gates remain disabled/unwired. No success/settlement inferred from quotes, builds, simulations or unrelated Relay QA.
- Burn/recovery: persist hashes before submit, never resend uncertain burns; Ethereum credit64blocks/Cardano final400blocks. Immutable authorization/terms; existing address-to-address swap flows preserved.
- Preserve nonce/allowance read-after-write guards, fail-closed signer/validator paths, collateral ownership and exact token units. Never loosen guards to make provider builds pass.
- Shared swap-core hashes are LF-sensitive; normalize only proven line-ending drift. Regenerate bundle deliberately for actual shared changes.
- Full Cardano/provider/IOG and older UI guardrails are retained in HANDOFF_ARCHIVE.md (snapshot2026-10-12); read them before changing those systems.

## Skills
- Desktop Agent Access/execution -> architecture-review / evm-wallet-architecture / evm-signing-security / wallet-security-auditor / blockchain-ux-review / Fullstack Iteration / Playwright Testing / Visual Iteration | restricted tools, durable exact ETH signing, isolated policies, real Electron/offline signature QA | Codex: C:/Users/balla/.codex/skills/ | Claude: resolve local catalog.
- Shared project -> agent-handoff | used: sequential lease/checkpoints/release and dirty-work preservation | Codex: C:/Users/balla/.codex/skills/agent-handoff/SKILL.md | Claude: C:/Users/balla/.claude/skills/agent-handoff/SKILL.md.
- Token/CIP-113 contracts -> architecture-review / blockchain-ux-review / cardano-wallet-core | used: canonical deployment/schema pins, ownership/capability boundaries and honest programmable states | Codex: C:/Users/balla/.codex/skills/{architecture-review,blockchain-ux-review,cardano-wallet-core}/SKILL.md | Claude: resolve local catalog.
- Implementation -> Fullstack Iteration / wallet-security-auditor | used: source-bound read-only assets, exact balances, fail-closed QR and ownership guards | Codex: C:/Users/balla/.codex/skills/{fullstack-iteration,wallet-security-auditor}/SKILL.md | Claude: resolve local catalog.
- Validation -> Playwright Testing / Debugging | used: real-bridge browser regressions, scoped duplicate-label test correction and screenshot review | Codex: C:/Users/balla/.codex/skills/{playwright-testing,debug}/SKILL.md | Claude: resolve local catalog.

## Pointers
- docs/AGENT-MONAD.md; src/main/agent-emogotchi.ts / agent-monad.test.ts; src/main/__fixtures__/emogotchi-runtime.json; e2e/agent-monad{.spec.ts,-wrapper.cjs}; .local-artifacts/agent-monad/ (final gate, source/code proof, screenshots and asset restoration).
- docs/X402.md; src/main/x402-{validation,core,desktop}.{ts,test.ts}; src/shared/x402.ts; src/renderer/components/X402Controls.tsx; e2e/x402{.spec.ts,-wrapper.cjs}; .local-artifacts/x402/ (final gate, focused tests, screenshots, restored asset hashes).
- docs/AGENT-EXECUTION.md; src/main/agent-execution-{core,desktop}.{ts,test.ts}; src/shared/agent-execution.ts; src/renderer/components/AgentExecutionPanel.tsx; e2e/agent-execution{.spec.ts,-wrapper.cjs}; .local-artifacts/agent-execution/ (final gate, screenshots, asset hashes; stopped logs diagnostic).
- docs/AGENT-ACCESS.md (setup, tool schemas, boundaries, exact local results); src/main/agent-access*.ts; resources/agent-access.mjs; e2e/agent-access.spec.ts; .local-artifacts/agent-access/{verify-ci.log,png-restoration.json,screenshots}.
- docs/CIP113-C3-HANDOFF.md; src/shared/cip113-wire.ts; src/main/cardano-programmable.ts; src/main/__fixtures__/cip113/README.md; .local-artifacts/cip113-c3/.
- docs/TOKEN-DETAILS-C2-HANDOFF.md; .local-artifacts/token-details-c2-verify-ci.log; .local-artifacts/token-details-c2/ (reviewed screenshot, preserved/generated PNGs).
- docs/TOKEN-DETAILS-C1-HANDOFF.md (ready for Claude L1: exact imports, context, fixtures, activity scope and stale-result guards).
- docs/TOKEN-DETAILS-IMPLEMENTATION-PLAN.md (universal details, receive/QR, CIP-113 phases and Claude/Codex job packets).
- docs/NFT-PROFILE-PICTURES.md; .local-artifacts/chat-sizing/; .local-artifacts/nft-avatar/.
- docs/CHAT-PROFILE-MENU.md; src/renderer/components/ChatProfileMenu.{tsx,css}; e2e/messenger-profile-menu.spec.ts; .local-artifacts/chat-menu/; chat-menu-final-verify-ci.log.
- src/main/chainlens-chat.{ts,test.ts}; src/renderer/pages/MessengerPage.tsx; src/renderer/components/ProfileAvatar.css; e2e/__tour.spec.ts; .local-artifacts/chat-sizing-final-verify-ci.log.
- AGENTS.md; docs/RELEASE-QA.md; CARDANO-MULTICHAIN-NEXT.md.
- HANDOFF_ARCHIVE.md retains the previous full live board; HANDOFF_LOG.md retains milestone history.
