# Handoff board — Magic Money Wallet
<!-- handoff v1. LIVE STATE ONLY: rewrite in place, keep under ~60 lines.
     History goes in HANDOFF_LOG.md. Machine fields above the first ## are managed by handoff.py. -->

owner: none
task: -
lease_until: -
repo: .
verify: cmd /c "npm run typecheck && npm test"
verified: 63f378d · PASS five-target typecheck; 146 files/2139 unit tests; desktop/extension/Android-web/iOS-web builds; two extension gallery/favorites tests; diff check and favorite screenshot review. · 2026-10-05T01:17-03:00
head: 63f378d (main) dirty 22
updated: 2026-10-05T01:17-03:00 · codex

## Now
- NFT favorites implemented: always-visible image top-left star; local owner/mode persistence; favorites-first and descending USD sorting within both groups.
- Favorites verification PASS: five-target typecheck, 146 files/2139 tests, four web builds, two extension tests including reload/unlock persistence and reviewed star screenshot. Evidence .nft-favorites-*.log and docs/NFT-GALLERY-PERFORMANCE.md.
- NFT gallery implemented and locally verified: provider previews, viewport loading, placeholder/fade, bounded fallback/deadline and ready-source updates.
- PASS five-target typecheck, 144 files/2115 tests, four web builds and real-extension 240-item gallery test; 3 initial media requests and no uncaught page errors.
- NFT evidence/scope: docs/NFT-GALLERY-PERFORMANCE.md, .nft-gallery-*.log and test-results/nft-gallery-*.png. No Codex jobs running; changes uncommitted.
- Outbound Circle preparation/status unit implemented and locally verified; full bidirectional bridge remains unfinished.
- Direct Ethereum preparation checks encoded terms, fee ceiling, burn amount and transfer hash; always executable:false and core-only.
- Read-only withdrawal status wired through desktop, extension and native wallet APIs; provider finalized never proves recipient delivery.
- Core-only Ethereum withdrawal credit proof now checks the Circle-linked forwarded transaction's exact net USDC credit at depth. It has no production caller and no Cardano burn proof.
- Prior xReserve credit unit: 12 fixture tests; mainnet route remains gated, with existing uncommitted work preserved.
- No funds, commit, deployment or native QA; only local gallery fixtures and builds.

- USDCx inbound (Claude, commit 63f378d): Sepolia USDC -> Cardano Preprod USDCx PASSED live 2026-09-30 through the wallet (20 USDC deposit, 15 USDCx credited, mint 0d76ff8b...b1ab, ~2h12m); evidence docs/XRESERVE-TESTNET-QA.md. Testnet only; not mainnet, not RELEASE-QA.
- Cardano swap leg (committed 63f378d): Minswap order executor persists tx hash + terms BEFORE submit (atomic-json-map-file, swap-sessions); recovery polls known hash, never resends. No composed multichain route/parent journey exists yet. ADA exchange composition researched in docs/CARDANO-ADA-EXCHANGE-ROUTE.md.

- Burn interface (Claude, 2026-10-05): supported IOG/Midgard contract NOT established (no builder schema/auth/terms, no validator source, no recovery path; Portal terms PDF unreadable). Read-only burn proof added: src/main/xreserve-cardano-burn-proof.ts + 20 tests (public mainnet burn 887333810e... fixture, hostile CBOR, 4 mutation checks). Uncommitted; mint-proof got 5 `export`s only.

## Next
- NFT work complete; apply website equivalents when requested. Prior ADA exchange task: follow docs/CARDANO-ADA-EXCHANGE-ROUTE.md for an authorized guided parent journey; preserve standalone flows.

## Traps
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
- docs/XRESERVE-TESTNET-QA.md; XRESERVE-PORTAL-INTEGRATION-HANDOFF.md; CARDANO-MULTICHAIN-NEXT.md; CARDANO-ADA-EXCHANGE-ROUTE.md; RELEASE-QA.md.
- AGENTS.md; README.md; HANDOFF_LOG.md; four Cardano skills and agent-handoff installed for both clients.

