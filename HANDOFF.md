# Handoff board — Magic Money Wallet
<!-- handoff v1. LIVE STATE ONLY: rewrite in place, keep under ~60 lines.
     History goes in HANDOFF_LOG.md. Machine fields above the first ## are managed by handoff.py. -->

owner: none
task: -
lease_until: -
repo: .
verify: cmd /c "npm run typecheck && npm test"
verified: e68f40e · PASS on committed tree e68f40e: typecheck exit 0, npm test 148/2179, Cardano Playwright 3/3. Danogo phase-2 validity regression included; no live signing or submission. · 2026-10-05T15:56-03:00
head: e68f40e (main) dirty 2
updated: 2026-10-05T15:56-03:00 · codex

## Now
- Danogo CLMM same-chain swaps in DEX Swap committed as e68f40e; DexHunter read-only evaluation committed as f074204. No live swap, signing or submission.
- Codex review fixed Danogo settlement: Blockfrost hash, block height and `valid_contract` must agree before completion; phase-2 failure is `failed`. ADA completion copy distinguishes gross pool payout from net wallet gain.
- Verification after review: five-target typecheck PASS; 148 test files/2179 tests PASS; Cardano Playwright 3/3 PASS. Claude's earlier desktop, extension, Capacitor and iOS web builds PASS before the review fix; no native-device QA.
- NFT gallery/favorites and outbound xReserve read-only modules are locally verified; see docs/NFT-GALLERY-PERFORMANCE.md and docs/XRESERVE-OUTBOUND-IMPLEMENTATION.md. Outbound has no executable Cardano burn path.
- No funds, deployment or native QA; only local fixtures and builds.

- USDCx inbound testnet passed live 2026-09-30 (20 USDC -> 15 USDCx, ~2h12m); docs/XRESERVE-TESTNET-QA.md. Mainnet still gated. Minswap order executor persists terms/hash before submit; no composed multichain journey yet.

- Burn interface: no supported IOG/Midgard builder/auth/validator/recovery contract established. Read-only proof and 20 tests exist; no signing path.

## Next
- User may authorize a small mainnet Danogo QA swap; do not initiate without explicit authorization. Fee-aware ranking and xReserve mainnet gates remain.

## Traps
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
- Circle prepare probe returned HTTP403; synthetic fixture tests do not prove live API access. Do not derive outbound depositor from inbound tags.
- Ethereum credit proof uses synthetic receipt fixtures only. It proves neither Cardano burn nor current recipient balance and must not mark a route complete alone.

## Pointers
- docs/XRESERVE-BURN-INTERFACE-RESEARCH.md; xreserve-cardano-burn-proof.ts/.test.ts; .xreserve-burn-{typecheck,tests}.log; Cardano skills' Field notes updated in ~/.claude and ~/.codex.
- docs/NFT-GALLERY-PERFORMANCE.md; e2e/nft-gallery.spec.ts; src/main/collectibles-progress.ts; renderer/components/NftImage.tsx.
- docs/XRESERVE-OUTBOUND-IMPLEMENTATION.md; src/main/xreserve-withdrawal-prepare.ts/.test.ts; xreserve-withdrawal-status.ts/.test.ts.
- src/main/xreserve-ethereum-withdrawal-credit.ts/.test.ts; .xreserve-credit-typecheck.log; .xreserve-credit-tests.log.
- docs/XRESERVE-GATE2-RESEARCH.md contains the 2026-10-04 Circle fee clarification.
- src/main/xreserve-testnet-handlers.ts; shared/xreserve-testnet-wire.ts; wallet bridges and e2e/xreserve-testnet.spec.ts.
- .xreserve-withdrawal-{focused,typecheck,tests,extension,desktop,capacitor,ios,e2e}.log.
- Previous units: cardano-swap-inputs.ts; swap-executor.ts; swap-sessions.ts; XReserveTestnetPanel.tsx; XReserveRouteProgress.tsx.
- Danogo route: src/main/cardano-danogo-validate.ts; danogo-clmm.ts; cardano-direct-status.test.ts; docs/CARDANO-SWAP-DISCOVERY.md. Commits e68f40e and f074204.
- docs/XRESERVE-TESTNET-QA.md; XRESERVE-PORTAL-INTEGRATION-HANDOFF.md; CARDANO-MULTICHAIN-NEXT.md; CARDANO-ADA-EXCHANGE-ROUTE.md; RELEASE-QA.md.
- AGENTS.md; README.md; HANDOFF_LOG.md; four Cardano skills and agent-handoff installed for both clients.

