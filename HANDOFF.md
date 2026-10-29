# Handoff board — Magic Money Wallet
<!-- handoff v1. LIVE STATE ONLY: rewrite in place, keep under ~60 lines.
     History goes in HANDOFF_LOG.md. Machine fields above the first ## are managed by handoff.py. -->

owner: claude
task: NEAR Intents partner key via Worker route (+ fee wiring pending NEAR account)
lease_until: 2026-10-29T06:02-03:00
repo: .
verify: cmd /c "npm run typecheck && npm test"
verified: 22c10e1 · typecheck; vitest 198 files 2934 tests; builds; e2e cardano-swap 14/14 + picker 4/4 + token-swap-button; mutants killed (reserve rules, ERC-20 amount, retry) · 2026-10-29T03:02-03:00
head: 22c10e1 (main) dirty 51
updated: 2026-10-29T03:02-03:00 · claude

resources: -

## Now
- SOL/ADA agent execution + x402 on every current agent execution network locally verified: native approval/autonomy/recovery/receipts; USDC on Ethereum/Sepolia/Monad/Base/Solana, direct ADA on Cardano/Preprod. Explicit network/asset budgets preserve old Base-only grants. Default-off MAGICMONEY_X402=1. docs/AGENT-NATIVE.md and docs/X402.md. No running jobs or real funds.
- Final CI=1 verify:ci exits0 at HEAD22c10e1 plus shared dirty tree: all5TS/192files2862unit/fresh desktop+extension+injection/106browser first-pass+1existing skip.220focused pass; all5agent journeys first attempt.1231asset hashes verified;29generated PNGs archived/restored. Evidence .local-artifacts/agent-non-evm/.
- Preserve pre-existing SOL cross-chain fallback and user Retry changes (docs/SOL-CROSSCHAIN.md; .local-artifacts/sol-crosschain/), prior Monad/Emogotchi and Base x402 execution, C1/L1/C2/C3 token/CIP-113 readers, universal QR/details and NFT/chat profile work. No commit/push/deploy/install authorized.

## Verification status
- Current full gate: .local-artifacts/agent-non-evm/verify-ci.log and exitcode0; 106passed/1skip/0flaky in18.6m. Native journey14.7s; real disposable-key signatures with stubbed RPC/facilitators, not live settlement.400/768/1200 approval screens reviewed. Audit0critical5high4moderate; dependencies unchanged. git diff --check passes.
- GitHub base CI success at22c10e192ab06d7b78b21dd88dff5009c2320178: https://github.com/M2AF/Magic-Money-Wallet/actions/runs/40254402500 . Feature CI pending (uncommitted/unpushed changes); Release/native devices/installation/deployment unverified and not performed. Windows Node24.14.1 local results do not establish Linux or native-platform results.

## Next
- User real-funds QA of a small into-Cardano swap; Worker deploy approval; NEAR fee account

## Traps
- NEAR Intents: only pay a deposit address from a LIVE non-dry quote verified against pinned 1Click key ed25519:reYaWhvw...; appFees are NOT signed (bind by approved minAmountOut). Request deadline 30 min (refund) vs quote.deadline (address inactive, 'funds may be lost'); Cardano payment TTL 600 slots. SUCCESS needs measured destination credit (except native EVM).
- IOG USDCx SDK API (sdk.api.usdcx.iog.io; openapi at portal.usdcx.iog.io/openapi.json): /health, /store-datum, /register-withdrawal (post-submit, idempotent 'creates or returns'). NO build endpoint. API key is server-side only (Worker secret), never in wallet bundles; user's key is NOT stored in any file.
- Preserve shared dirty work; only lease owner edits. No commit/push/deploy/install/live signing or broadcast without explicit authorization. Public-seed offline test signatures are not real-funds execution.
- Released x402 credentials cannot be recalled; URL/grant rules are wallet-local. EVM uses signed timestamp expiry, Cardano bounded TTL, Solana recent-blockhash expiry (not an on-chain wall-clock promise). Authorization is not settlement. Native recovery sends native coin only; USDC/NFT recovery still needs trusted seed-path wallets.
- Cardano agent inputs are pure ADA only; unknown/token-bearing/datum/script inputs fail closed. Released/uncertain input locks remain conservative; local expiry never resets authority budgets. Keep journals and displayed recovery paths.
- Native Stop denies in memory even if persistence fails; restart stops policies. Native SOL sends have wallet-generated Memo IDs to distinguish intentional sends in one blockhash window; retries retain identity. No automatic replacement of uncertain transactions.
- Native Electron fixture uses the real20/minute broker cap: avoid redundant calls. Replacing global Date.now does not advance captured core clocks. Keep resources/agent-access.mjs LF; CRLF broke Vitest dynamic import despite native Node parsing it.
- Emogotchi143 requires caller ownership, explicit IDs, exact1MON care /0MON pet and code pin; operator approval alone is insufficient. Other contracts/revive/setName blocked; NFT recovery manual. Normalize absent zero RLP values to0n only for nonpayable calls.
- Fresh Electron before one-worker e2e; stub all live Workers. Archive generated replacements and restore baseline hashes. Base CI green does not verify dirty source. Native Android/iOS runtime, camera and production sync need separate validation.
- Existing Cardano outbound/CCIP burn gates remain disabled; no settlement inferred from quotes/simulation. Preserve exact token units, nonce/allowance read-after-write and signer/ownership/collateral guards. Shared swap-core hashes are LF-sensitive.
- Retain overflow:hidden with NFT avatar clip-path; source cannot be inferred from image URLs and legacy PFPs need explicit reselection. Full older Cardano/IOG/UI guardrails remain in HANDOFF_ARCHIVE.md.

## Skills
- Shared work -> agent-handoff | used: lease/checkpoints/release and dirty-state preservation | Codex: C:/Users/balla/.codex/skills/agent-handoff/SKILL.md | Claude: C:/Users/balla/.claude/skills/agent-handoff/SKILL.md.
- SOL/ADA/x402 -> solana-wallet-core / solana-signing-security / cardano-wallet-core / cardano-signing-security / eutxo-transaction-builder | used: fixed construction, inner signing guards, exact assets, pure-ADA TTL and offline signatures | Codex: C:/Users/balla/.codex/skills/ | Claude: resolve catalog.
- Agent architecture -> architecture-review / evm-wallet-architecture / evm-signing-security / wallet-security-auditor / blockchain-ux-review | used: bounded authority, isolated accounts and exact native approvals | Codex: C:/Users/balla/.codex/skills/ | Claude: resolve catalog.
- Implementation/verification -> Fullstack Iteration / Playwright Testing / Visual Iteration / Debugging | used: all-target checks, real Electron journeys, screenshots and source-route diagnosis | Codex: C:/Users/balla/.codex/skills/ | Claude: resolve catalog.

## Pointers
- docs/AGENT-NATIVE.md; docs/X402.md; src/main/agent-native-*.ts; src/main/x402-native-validation.ts; src/shared/agent-native.ts; e2e/agent-native{.spec.ts,-wrapper.cjs}; .local-artifacts/agent-non-evm/ (spec pins, final tests, screenshots, asset hashes, stopped diagnostics).
- docs/AGENT-ACCESS.md; docs/AGENT-EXECUTION.md; docs/AGENT-MONAD.md; resources/agent-access.mjs; src/main/agent-access*.ts / agent-execution*.ts / x402*.ts; prior evidence .local-artifacts/{agent-access,agent-execution,agent-monad,x402}/.
- docs/SOL-CROSSCHAIN.md; src/main/swap-solana-crosschain.test.ts; .local-artifacts/sol-crosschain/ (source error proof, unsigned probes, prior full gate).
- docs/CIP113-C3-HANDOFF.md; docs/TOKEN-DETAILS-{C1,C2}-HANDOFF.md; docs/TOKEN-DETAILS-IMPLEMENTATION-PLAN.md; src/main/__fixtures__/cip113/README.md; .local-artifacts/{cip113-c3,token-details-c2}/ (Claude L2 contract and prior verification).
- docs/NFT-PROFILE-PICTURES.md; docs/CHAT-PROFILE-MENU.md; src/renderer/components/ProfileAvatar.css; .local-artifacts/{chat-sizing,nft-avatar,chat-menu}/. Prior feature verification/history remains in HANDOFF_LOG.md / HANDOFF_ARCHIVE.md and feature docs.
- AGENTS.md; docs/RELEASE-QA.md; CARDANO-MULTICHAIN-NEXT.md.
