# Handoff board — Magic Money Wallet
<!-- handoff v1. LIVE STATE ONLY: rewrite in place, keep under ~60 lines.
     History goes in HANDOFF_LOG.md. Machine fields above the first ## are managed by handoff.py. -->

owner: codex
task: Diagnose stale development chat backend and header
lease_until: 2026-10-13T03:55-03:00
repo: .
verify: cmd /c "npm run typecheck && npm test"
verified: b11a019 · HEADb11a019 plus preserved NFT/chat and new PFP-menu edits:final CI=1 npm run verify:ci exits0;fiveTS/174files2525unit/fresh Electron extension inject/93browser+1existing skip/no retries/critical audit0critical (existing4moderate4high unchanged). Menu friend/profile/block/report routes and real preload IPC journey pass including pending submission focus/error handling. Final screenshots reviewed;ten generated trackedPNGs archived/restored. GitHub CI pending dirt;baseb11a019 success https://github.com/M2AF/Magic-Money-Wallet/actions/runs/38290711616. No agent commit/push/deploy/install/native/live moderation QA. · 2026-10-13T00:45-03:00
head: b11a019 (main) dirty 19
updated: 2026-10-13T00:55-03:00 · codex

resources: -

## Now
- Stale runtime diagnosed/fixed: renderer HMR was paired with Electron main started Oct12 22:56; closing only hid app to tray. Replaced old dev subtree, restarted same wallet data in --watch (CLI36648/main28400), and user confirmed both header picture and PFP menu work. npmdev now watches main/preload by default; test probes actual chat handlers before mocks. Focused probe passes; final full gate running .local-artifacts/dev-watch-verify-ci.log. No install/deploy/backend changes.
- Messenger PFP menu complete locally: World Chat/DM/friend/request avatars offer View Profile, canonical friendship actions, Block/Unblock and explicit Report form. Existing ChainLens routes through desktop/extension/mobile bridges; no backend/schema change. Final CI=1 verify:ci exits0:fiveTS/174files2525unit/fresh builds/93browser pass+1existing skip/no retries/critical audit0critical. Focused real IPC journey includes held-report focus, failures/success, links and all friendship states. Screenshots reviewed; ten regenerated tracked PNGs archived/restored. docs/CHAT-PROFILE-MENU.md; .local-artifacts/chat-menu/. Prior NFT/chat edits preserved.
- Chat sizing/overflow and stale Messenger header complete locally on base b11a019:40px avatars; contained NFT rotation; media/text fit. Header refreshes profile once per cached-session entry, reuses token and checks account identity. Final CI=1 verify:ci exits0:fiveTS/174files2520unit/fresh builds/91browser passes+1history retry+1existing skip/critical audit pass. Ten generated tracked PNGs archived/restored; final screenshots reviewed. Wallet changes remain uncommitted.
- NFT PFP work remains in scope of prior shared feature: cached searchable/scrollable spam-filtered picker, NFT-detail action, shared avatar_nft_key, animated NFT hexagons and circular uploads. Shared Supabase migration20261013012323 applied; existing pictures need NFT reselection once. App/Worker deployment and native runtime sync QA remain separate.

## Verification status
- Current local gate exits0: .local-artifacts/chat-menu-final-verify-ci.log (2525unit/93browser+1skip/no retries). Existing audit4moderate/4high,zero critical; dependencies unchanged. GitHub CI pending uncommitted wallet changes; baseb11a019 success https://github.com/M2AF/Magic-Money-Wallet/actions/runs/38290711616. No agent commit/push/deploy/install/native QA. Previous sizing run's unrelated history retry is retained in its log; current history suite passes first attempt.

## Next
- User review/commit wallet changes when desired, then inspect matching main GitHub CI after push and release rebuilt wallet/preload/main when authorized. Profile/moderation backend unchanged for this menu; native/production integration QA separate. docs/CHAT-PROFILE-MENU.md has final evidence.

## Traps
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
- Chat UI -> Fullstack Iteration / Visual Iteration / Playwright Testing | used: source tracing, before/after overflow regression, responsive browser checks and screenshots | Codex: C:/Users/balla/.codex/skills/{fullstack-iteration,visual-Iteration,playwright-testing}/SKILL.md | Claude: resolve local catalog.
- Shared project -> agent-handoff | used: lease, checkpoints, evidence and archived live-board history | Codex: C:/Users/balla/.codex/skills/agent-handoff/SKILL.md | Claude: C:/Users/balla/.claude/skills/agent-handoff/SKILL.md.

## Pointers
- docs/NFT-PROFILE-PICTURES.md; .local-artifacts/chat-sizing/; .local-artifacts/nft-avatar/.
- docs/CHAT-PROFILE-MENU.md; src/renderer/components/ChatProfileMenu.{tsx,css}; e2e/messenger-profile-menu.spec.ts; .local-artifacts/chat-menu/; chat-menu-final-verify-ci.log.
- src/main/chainlens-chat.{ts,test.ts}; src/renderer/pages/MessengerPage.tsx; src/renderer/components/ProfileAvatar.css; e2e/__tour.spec.ts; .local-artifacts/chat-sizing-final-verify-ci.log.
- AGENTS.md; docs/RELEASE-QA.md; CARDANO-MULTICHAIN-NEXT.md.
- HANDOFF_ARCHIVE.md retains the previous full live board; HANDOFF_LOG.md retains milestone history.
