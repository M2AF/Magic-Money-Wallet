# Handoff board — Magic Money Wallet
<!-- handoff v1. LIVE STATE ONLY: rewrite in place, keep under ~60 lines.
     History goes in HANDOFF_LOG.md. Machine fields above the first ## are managed by handoff.py. -->

owner: none
task: -
lease_until: -
repo: .
verify: cmd /c "npm run typecheck && npm test"
verified: b6aeb83 · Doc-only correction; git diff --check exit 0. · 2026-10-06T03:44-03:00
head: b6aeb83 (usdcx-withdrawal-tracking) dirty 3
updated: 2026-10-06T03:44-03:00 · codex

## Now
- NFT favorites shared ChainLens-ID sync complete locally: existing profile preference document, offline caches, legacy migration, unfavorite tombstones and expected-owner guards across all platform bridges; spam choices independent.
- Final checks: five typecheck targets; 159 files/2327 tests; four desktop/web bundles; 2 extension gallery tests; ChainLens140 tests and cross-product browser checks. No live writes/deployment; local DB credential rejected (Unregistered API key).
- User target: one stablecoin swap journey, multiple approved transactions: Cardano token -> USDCx -> native destination USDC -> target token. The recoverable USDCx burn-to-Ethereum tracking leg is implemented read-only; no burn journey is created by the app or executable yet.
- Codex review: Cardano cross-chain pairs now stay in DEX Swap (no exchange handoff); cbADA receipt recovery binds the recorded Base hash and Solana delivery events must come from the OffRamp invocation. Execution remains disabled.
- cbADA signing bindings are fixed locally and execution remains disabled/unwired. The v2 Base pool default outbound rate-limit getter was read live and is now checked in send simulation.
- cbADA approval screen built (uncommitted): cbada-ccip-approval.ts + journey:cbadaReview/cbadaAuthorize/cancel on all targets + CbAdaTermsPanel; stores immutable terms only on explicit approval; signs/sends nothing. Checks: typecheck 5 targets; 161 files/2367 tests; desktop/extension/capacitor builds; iOS vite bundle (cap sync ios fails: no ios/ platform on this machine); e2e cardano-swap.spec.ts 8/8 (.terms-*.log).
- Codex approval-screen review completed: serialized check/save blocks concurrent authorizations from two windows; full token/mint/router addresses shown; cost cap label excludes the disclosed uncapped Base L1 data fee. Typecheck 5 targets, 21 focused approval tests, and cbADA popup browser test pass. Execution still off/unwired.
- Ordinary Base -> Solana Relay DEX swap completed with real funds per user screenshot and Claude's read-only chain check: 2.449257 cbADA left Base via nonce 38; 1.548215 cbADA credited on Solana, finalized. This validates that specific Relay run, not the disabled CCIP route or Cardano bridge. HEAD 35b7dbd committed and clean before this handoff update; Codex reran typecheck and 162 files/2383 tests on that HEAD.
- Danogo real-funds ADA->USDCx QA passed per RELEASE-QA.md; reverse Danogo and V2 order real-funds QA remain open. Preserve existing uncommitted QA.
- IOG Portal build, submit, existing-hash record and history contracts located. Circle live synthetic preparation HTTP200 for Ethereum and Solana via Arc forwarding. Valid unsigned build and third-party contract not established; execution remains gated.
- Public historical burn/release independently linked and canonical Ethereum recipient credit verified. No wallet connected or new signing/broadcast during research. Sanitized evidence in docs/evidence/usdcx-portal-2026-10-05.json.
- Codex reviewed Claude's burn journey and added three gates: Cardano >=400 blocks before confirmed/failed outcome, BurnIntent value equals saved release amount, and an unverified burn is not labelled on-chain success. Focused burn tracking tests 20/20 and five-target typecheck pass. No signing or broadcast.
- Inbound Preprod QA passed 2026-09-30; no inference of mainnet or reverse readiness. Existing Minswap executor persists terms/hash before submit.

## Next
- If user chooses, compare Portal same-wallet/amount flow only up to signing prompt; obtain IOG third-party rules before enabling withdrawal.

## Traps
- Probe 502 x2: history GET 200 and empty POST 400 prove only partial backend reachability; they do not prove the full valid request was accepted or that the builder was healthy. Portal failure would narrow to a shared service or wallet/amount precondition, not prove an outage.
- USDCx journey: confirm ONLY on verified exact Ethereum credit at 64 blocks; burn final at 400 Cardano blocks; provider failed/expired after a verified burn = needs-review, never refund. burnTerms immutable; legacy records parse with burnTerms null.
- EVM swap executor read-after-write (2026-10-05 user Base cbADA->Solana Relay failure, funds safe): every tx of a swap now gets an explicit nonce >= own last+1 (a lagging Alchemy backend reported the used nonce -> 'replacement transaction underpriced'); after an approval the allowance must be VISIBLE before simulating (READ_AFTER_WRITE), and a revert right after our own approval is re-simulated twice. Session decimals now real (were hard-coded 18/9). Test: swap-executor-read-after-write.test.ts.
- Codex review tightened EVM swap: unreadable first nonce now stops before signing; after a zero-reset receipt, zero allowance must become visible before the new approval. Focused tests and five-target typecheck pass. Nonce floor is per executeEvmSwap call, not across simultaneous swaps or restarts; do not claim global nonce serialization.
- cbADA execution gate: only issued gates (WeakSet) open it; productionGate() mirrors the constant (false); testOnlyEnabledGate() throws outside Vitest. Never pass an execution flag via IPC/renderer. Terms come only from journey.authorization (immutable).
- JourneyRoutesPanel stale-result guard is implemented. cbADA delivery cursor remains memory-only; restart rereads, and absence is never a failure/refund verdict.
- cbADA approval: terms come only from a single-use 120s in-memory proposal (id only crosses IPC); one active cbADA journey per wallet; ceilings = fee+10%, gas units x1.5 x 2x maxFeePerGas, send cap 450k before an approval exists; L1 data fee shown, NOT capped. Public Base RPCs: mainnet.base.org rate-limits parallel bursts, base.llamarpc.com returned 525 -> review fails closed; app uses evmReadClient (primary node first).
- cbADA v2 rate limit uses getCurrentRateLimiterState(Solana selector, false), not the v1 outbound getter. Simulations fail closed on unreadable or insufficient live Base outbound capacity. Re-read immediately before any send.
- CCIP message id: persist tx hash BEFORE broadcast; read message id from the CONFIRMED receipt (OnRamp CCIPMessageSent), recover by hash; never require it up front. A Solana OffRamp "SkippedAlreadyExecutedMessage" success tx is NOT a delivery.
- cbADA: Base pool is LOCK/RELEASE and held 0 cbADA (2026-10-05) -> Solana->Base cannot deliver; always read balance. Solana->Base CCIP fee needs Solana router simulation (unknown today). Fee ceilings are never expected costs.
- src/shared/swap-networks.ts keeps getting CRLF in the working copy (autocrlf) -> swap-core-drift test fails on hash only; normalize to LF (content == HEAD). New shared files must be added to tsconfig.node.json/web.json named lists.
- Stablecoin bridge legs: never executable until a validated unsigned burn build; IOG endpoints are observed, unversioned; never wrap submit/record endpoints for the renderer.
- Danogo: own validator only (never relax validateMinswapOrderTx). ADA-side single pool only. Collateral must be provider's; wallet witness MERGED into provider witness set (redeemers byte-exact). Pinned: pool script d8b69fc5, refs 64d111b9#0/2cafd7c9#0, swap fee 100000. Config change = new ref -> fails closed.
- Danogo completion requires `valid_contract: true` from Blockfrost `txs/{hash}`; transaction UTxO views alone can include unrealized outputs from a phase-2 failure.
- Shared src/shared/* edits change the ChainLens swap-core bundle hash (swap-core-drift.test): keep descriptive text out of shared files or regenerate ChainLens bundle deliberately. Python text-mode writes CRLF on Windows: normalize to LF.
- DexHunter keyless /swap/estimate answers but applies partner_code SHADOWBOOK + partner_fee: never treat keyless numbers as our quote.
- DexHunter partner credential lives ONLY in ../chainlens/.env (DEXHUNTER_PARTNER_ID): local read-only research; never print, fixture or bundle into Magic Money. 21 tokens named USDCx: pin full unit only.
- DexHunter enforced floor != requested slippage (0.5% req -> 1% MSV2/CSWAP, ~5% SHADOWBOOK); validateMinswapOrderTx correctly refuses its builds (field 14 + partner-fee output): do not relax.
- Wanchain tokenPairs (2026-10-05 17:40Z): 470 pairs, 27 chains, NONE with a Cardano chain side. Do not offer Wanchain for Cardano without re-checking.
- Magic Swap Cardano work belongs in DexSwapWidget (Minswap + supported bridge); never route it to SimpleSwapWidget or deposit-address exchanges.
- Burn proof is observed-shape (60/60 mainnet burns), not a spec: never use it to build/sign. Preprod validator hash unmeasured (refused). remoteDepositor = 0x00000001+key hash is measured only; script depositors unseen. maxFee 2 USDC and ~8-day maxBlockHeight observed. A second vkey (service collateral key e5d5e3df...) witnesses every burn.
- A Cardano burn is irreversible and Circle 409 only protects after it exists: persist hash before submit, never rebuild/resend, never burn again while uncertain.
- Only the lease owner edits shared wallet code; helpers review read-only or use an agreed isolated scope.
- Check lease, processes, Git drift and latest journal immediately before shared edits.
- Mainnet xReserve inbound/outbound remain gated; 2026-10-04 published OpenAPI still has no deposit quote endpoint.
- Circle fees reference says Circle charges no deposit fee; remote Cardano mint fees and the accepted minimum/maxFee remain unresolved.
- IOG Portal advertises Solana/EVM routes, but its product capability does not establish a third-party burn builder contract.
- Circle's withdrawal tutorial explicitly assigns attester signatures and /withdraw submission to remote-chain partners. Do not ask a user wallet to sign the operator hash.
- Default Wanchain tokenPairs response did not establish Cardano/Solana pairs; do not infer support or universal absence.
- Prepared Cardano records are conservatively uncertain, even if interruption precedes submit; poll known hashes, never automatically resend.
- Old testnet QA and newer recovery code differ; audit actual code. Testnet success is not mainnet or outbound acceptance.
- Preserve address-to-address swaps and shared core/alias seams. No native QA or live settlement inferred from web builds.
- Do not commit, deploy, sign real funds or broadcast without explicit authorization; never store secrets in handoffs.
- Circle prepare now HTTP200 for Ethereum and Solana (synthetic only). Solana uses outer Arc domain26 plus nested CCTP domain5; never relax Ethereum-only validator into arbitrary forwarding acceptance.
- Historical public burn 88733381 linked by IOG history to release 37dce9fa; independent canonical Ethereum receipt credits exact 2800 USDC. This is research evidence, not wallet execution QA; production verifier still needs integration.


## Pointers
- ../chainlens/docs/PROFILE-NFT-FAVORITES.md; src/renderer/lib/use-nft-favorites.ts; src/main/asset-filter-sync.test.ts; ignored .favorites-*.log.
- docs/USDCX-STABLECOIN-ROUTING-PLAN.md; docs/USDCX-STABLECOIN-CLAUDE-PROMPT.md; docs/evidence/usdcx-portal-2026-10-05.json; ignored test-results/portal-interface/.
- docs/CBADA-CCIP-EXECUTION-REVIEW.md; docs/CBADA-CCIP-ROUTE.md; src/main/cbada-ccip-{execute,send}.ts; src/main/cbada-solana-delivery.ts.
- docs/RELEASE-QA.md; CARDANO-MULTICHAIN-NEXT.md; XRESERVE-{BURN-INTERFACE-RESEARCH,OUTBOUND-IMPLEMENTATION,PORTAL-INTEGRATION-HANDOFF,TESTNET-QA,GATE2-RESEARCH}.md.
- src/main/xreserve-{withdrawal-prepare,withdrawal-status,ethereum-withdrawal-credit,cardano-burn-proof}.ts and tests; xreserve-testnet-handlers.ts; shared/xreserve-testnet-wire.ts.
- src/main/{swap-proxy,minswap-client,swap-executor,swap-sessions,cardano-danogo-validate,danogo-clmm}.ts; src/shared/swap-session.ts; docs/CARDANO-SWAP-DISCOVERY.md.
- docs/NFT-GALLERY-PERFORMANCE.md; e2e/nft-gallery.spec.ts; src/main/collectibles-progress.ts; renderer/components/NftImage.tsx.
- AGENTS.md; README.md; HANDOFF_LOG.md; local agent-handoff, cardano-cross-chain-swaps and blockchain-architecture-review skills. Resolve skills locally before use.

## Skills
- Shared Claude/Codex changes -> agent-handoff | used: lease, checkpoints and verification handoff | source: local shared skill | Claude: C:/Users/balla/.claude/skills/agent-handoff/SKILL.md | Codex: C:/Users/balla/.codex/skills/agent-handoff/SKILL.md
- Wallet transaction pipeline review -> blockchain-architecture-review | used: approval, signer, broadcast and recovery boundaries | source: local Codex skill | Claude: unknown | Codex: C:/Users/balla/.codex/skills/Blockchain-architecture/SKILL.md
