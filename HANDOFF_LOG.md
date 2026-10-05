# Handoff journal — Magic Money Wallet
<!-- Append-only. Never edit or delete entries; correct with a new `correction` entry.
     Header: ### <iso-time> · <agent> · <kind> · <head> <clean|dirty N>. Use handoff.py log. -->

### 2026-10-04T22:46-03:00 · codex · checkpoint · 63f378d (main) dirty 14
- Circle preparation/status core now has 50 focused passing tests; status channel wired through desktop, extension and native shared wallet bridges. Source mapping/burn construction remain gated, so preparation is not renderer-exposed.
- Starting npm run typecheck, npm test, four web builds and extension xReserve regression. Logs .xreserve-withdrawal-*.log. No native sources changed or funds moved.
- next: Fix validation failures, inspect actual extension runtime and document the exact burn integration gap.

### 2026-10-04T22:49-03:00 · codex · correction · 63f378d (main) dirty 14
- Claim scope refined: outbound preparation is implemented in shared core, not renderer-exposed; only read-only withdrawal status is router-wired. Do not assume inbound recipient tags encode Cardano outbound depositor identity.

### 2026-10-04T22:51-03:00 · codex · verify · 63f378d (main) dirty 15
- verified: PASS five-target typecheck; npm test 139 files/2094 tests; four web bundles; three extension regressions; diff check and screenshot review. No live bridge/native QA.
- Commands: npm run typecheck; npm test; npm run build:extension; npm run build; npx vite build --config vite.capacitor.config.ts; npx vite build --config vite.ios.config.ts; npx playwright test e2e/xreserve-testnet.spec.ts e2e/cardano-swap.spec.ts --workers=1; git diff --check. Evidence .xreserve-withdrawal-*.log and test-results/cardano-swap-filled.png.
- Preparation/status/router have 52 new fixture tests. Real extension outbound status rejects invalid reference before HTTP. Live preparation returned HTTP403; no supported operator burn interface established, no signing/broadcast. No lint script.

### 2026-10-04T22:51-03:00 · codex · handoff · 63f378d (main) dirty 15
- Outbound Circle core and read-only wallet status API verified, changes uncommitted; full bridge remains unfinished. No jobs running. Mainnet inbound and outbound execution remain gated.
- next: Resolve IOG/Midgard Cardano burn interface and depositor encoding per docs/XRESERVE-OUTBOUND-IMPLEMENTATION.md; preserve preparation/status proof boundaries.

### 2026-10-04T23:33-03:00 · codex · claim · 63f378d (main) dirty 15
- task: Research IOG burn contract and advance Cardano cross-chain swap safely
- lease until 2026-10-05T02:33-03:00

### 2026-10-04T23:34-03:00 · codex · checkpoint · 63f378d (main) dirty 15
- Official Circle withdrawal tutorial is for remote-chain partners and requires their attester signatures; IOG public Portal/FAQ still does not provide a versioned independent-wallet burn builder or Cardano validator contract.
- Next safe implementation unit: read-only Ethereum USDC credit proof bound to Circle withdrawal status and approved recipient, without enabling Cardano burn or claiming route completion.
- next: Implement pure Ethereum destination credit verifier and focused fixture tests; leave mainnet execution gated.

### 2026-10-04T23:37-03:00 · codex · checkpoint · 63f378d (main) dirty 15
- Added read-only Ethereum withdrawal credit proof and synthetic fixture tests in two new files; no signing or router wiring.
- next: Run focused Vitest and typecheck, repair failures, then full verification.

### 2026-10-04T23:38-03:00 · codex · verify · 63f378d (main) dirty 15
- verified: PASS focused withdrawal-credit Vitest 1 file/11 tests; five-target npm run typecheck exit 0. Full npm test pending.
- New proof remains core-only and read-only; no router, UI, signer or submit path.
- next: Run npm test and git diff --check; inspect results and update board.

### 2026-10-04T23:41-03:00 · codex · checkpoint · 63f378d (main) dirty 15
- Final verification starting: npm run typecheck to .xreserve-credit-typecheck.log and npm test to .xreserve-credit-tests.log.
- next: Inspect both exits, update outbound doc results, then release lease.

### 2026-10-04T23:42-03:00 · codex · verify · 63f378d (main) dirty 15
- verified: PASS five-target npm run typecheck; npm test 140 files/2106 tests; focused withdrawal-credit 12 tests; git diff --check. Synthetic destination fixtures only; no live withdrawal.
- Core-only Ethereum withdrawal credit proof added in two new files. Exact recipient net USDC credit requires Circle finalized status, matching transaction/receipt/block, successful receipt, and configured depth.
- next: Resolve IOG/Midgard Cardano burn contract, then add trusted Cardano burn proof and coordinator that combines it with Circle status and Ethereum credit.

### 2026-10-04T23:43-03:00 · codex · checkpoint · 63f378d (main) dirty 16
- Bounded 2026-10-04 official search: Circle withdrawal tutorial reserves attester signing and /withdraw submission for remote-chain partners; IOG Portal FAQ and indexed IOG/GitHub material still provide no versioned third-party Cardano burn transaction contract.
- Circle fees reference says Circle charges no xReserve deposit fee, while source gas and remote-chain mint fees may apply; added to gate2 research without treating Preprod allocation as a mainnet quote.
- next: Obtain supported IOG/Midgard burn schema and unsigned example; independently validate Cardano burn before any signing path.

### 2026-10-04T23:44-03:00 · codex · handoff · 63f378d (main) dirty 16
- Read-only Ethereum withdrawal credit proof and 12 tests added; docs and board updated; five-target typecheck, full 140-file/2106-test suite and diff check pass. Mainnet execution remains gated; no live withdrawal or native QA.
- next: Obtain supported IOG/Midgard burn builder/schema and unsigned example, validate Cardano burn and operator handoff, then compose route status with Circle and Ethereum credit proof.

### 2026-10-04T23:46-03:00 · codex · claim · 63f378d (main) dirty 16
- task: NFT gallery thumbnails, viewport media loading and progressive collectibles; preserve existing xReserve work
- lease until 2026-10-05T02:46-03:00

### 2026-10-04T23:50-03:00 · codex · checkpoint · 63f378d (main) dirty 19
- Added separate provider preview URLs, viewport-gated NFT media with placeholders/fade/fallbacks, and per-source partial collectibles snapshots through existing cross-platform update event. Existing xReserve changes preserved.
- next: Verify progressive update races, refresh stability, thumbnail/download separation and large-grid network requests; run typecheck/tests/builds and Playwright.

### 2026-10-04T23:56-03:00 · codex · checkpoint · 63f378d (main) dirty 19
- Added ready-chain/progress, deduplication, account-switch/refresh race and image-candidate tests. Fixed NFT push listener teardown on Electron and suppressed superseded callbacks. Full suite and extension build running; logs .nft-gallery-tests.log and .nft-gallery-extension.log.
- next: Run real extension 240-item gallery regression and inspect screenshots; complete shared-target typecheck and web builds.

### 2026-10-04T23:56-03:00 · codex · checkpoint · 63f378d (main) dirty 19
- Extension build passed. Initial full unit run: 143 files/2114 tests passed, one new fixture timed out because Privacy Mode requires testnetMode=false; corrected the fixture. Real-extension gallery run started, evidence .nft-gallery-e2e.log.
- next: Rerun corrected unit suite and latest typecheck, inspect extension gallery results and finish desktop/native web bundles.

### 2026-10-04T23:58-03:00 · codex · checkpoint · 63f378d (main) dirty 19
- Full unit suite PASS 144 files/2115 tests; desktop and extension builds passed. Real-extension 240-item test passed: 3 initial media requests, 11 through detail/scroll/reveal. Screenshot review found no gallery layout shift; corrected compact screenshot viewport to supported extension width. Added stalled-gateway deadline and final-failure/reveal UI coverage.
- next: Rebuild latest renderer, rerun gallery test, complete native web bundles and typecheck, review final screenshots and log release.

### 2026-10-05T00:03-03:00 · codex · verify · 63f378d (main) dirty 21
- verified: PASS five-target typecheck; 144 files/2115 unit tests; four web builds; real-extension 240-NFT gallery regression; diff check and screenshot review. Local fixtures, no native/live benchmark.
- Commands: npm run typecheck; npm test; npm run build; npm run build:extension; npx vite build --config vite.capacitor.config.ts; npx vite build --config vite.ios.config.ts; npx playwright test e2e/nft-gallery.spec.ts --workers=1; git diff --check.
- 240-item fixture: 3 initial media requests, 17 through detail/download/scroll/search/refresh/failure/reveal/stalled-preview journey; no uncaught page errors. Provider previews and full-image downloads separated. All changes and limits listed in docs/NFT-GALLERY-PERFORMANCE.md; evidence .nft-gallery-*.log and test-results/nft-gallery-*.png.
- No lint script, native-device run, real-wallet speed benchmark, new shared media service, commit or deployment. ChainLens website and existing xReserve changes preserved.

### 2026-10-05T00:03-03:00 · codex · handoff · 63f378d (main) dirty 21
- Magic Money NFT gallery improvements implemented and locally verified; all changes uncommitted. No jobs running. Details and validation in docs/NFT-GALLERY-PERFORMANCE.md.
- next: NFT follow-up: ChainLens equivalent when requested; shared image-cache service remains separate infrastructure work. Prior xReserve: obtain supported IOG/Midgard burn schema and unsigned example before composing withdrawal proof.

### 2026-10-05T00:17-03:00 · claude · claim · 63f378d (main) dirty 21
- task: Handoff notes only: USDCx history + Cardano multichain progress (no code edits)
- lease until 2026-10-05T01:17-03:00

### 2026-10-05T00:17-03:00 · claude · checkpoint · 63f378d (main) dirty 21
- Handoff refresh requested by user: Codex's board already current; added USDCx inbound testnet PASS and Cardano swap-leg recovery summary to HANDOFF.md Now (no code touched)
- Read-only context: commit 63f378d holds xReserve deposit/mint proof/locator/audit modules + Minswap pre-submit persistence; uncommitted: outbound prepare/status/credit-proof, NFT gallery (Codex)
- next: Obtain IOG/Midgard burn schema + unsigned example; DexHunter authenticated quote vs Minswap; then parent journey around supported legs

### 2026-10-05T00:17-03:00 · claude · handoff · 63f378d (main) dirty 21
- Notes-only handoff; no code edited, no jobs running
- next: See Next on board: IOG burn schema, DexHunter quotes, then parent journey

### 2026-10-05T00:21-03:00 · claude · claim · 63f378d (main) dirty 21
- task: Cardano USDCx burn interface: establish IOG/Midgard contract (research; read-only burn proof only if rules established)
- lease until 2026-10-05T04:21-03:00

### 2026-10-05T00:32-03:00 · claude · checkpoint · 63f378d (main) dirty 22
- Burn-interface research doc + read-only burn proof written; running typecheck/test (logs .xreserve-burn-typecheck.log, .xreserve-burn-tests.log)
- next: Check logs, update board, update 4 Cardano skills, release

### 2026-10-05T00:34-03:00 · claude · verify · 63f378d (main) dirty 22
- verified: PASS npm run typecheck (all targets, 0 errors); npm test 145 files/2135 tests; burn-proof file 20/20 and 4 mutations caught. Research reads were read-only GETs (Circle /v1/info, Koios, publicnode RPC). No signing/broadcast/commit/deploy.

### 2026-10-05T00:34-03:00 · claude · handoff · 63f378d (main) dirty 22
- Burn-interface research done: supported contract not established; read-only Cardano burn proof implemented (uncommitted); docs/XRESERVE-BURN-INTERFACE-RESEARCH.md; 3 Cardano skills got Field notes
- next: Get IOG integrator terms/contract + validator spec + withdrawalId/Ethereum linkage + recovery path before any build/sign; then parent journey around verified legs

### 2026-10-05T00:42-03:00 · codex · claim · 63f378d (main) dirty 22
- task: Research Cardano ADA exchange composition; documentation only
- lease until 2026-10-05T01:42-03:00

### 2026-10-05T00:44-03:00 · codex · checkpoint · 63f378d (main) dirty 22
- Wrote docs/CARDANO-ADA-EXCHANGE-ROUTE.md: guided native asset to ADA to existing exchange, reverse route, persistence and settlement gates
- Read-only code audit: exchange card state is component-local; created exchange must persist before funding; no code or live transaction changed
- next: Claude can implement guided outbound parent journey after reviewing route spec; keep xReserve burn disabled

### 2026-10-05T00:44-03:00 · codex · handoff · 63f378d (main) dirty 22
- ADA exchange route research and implementation handoff documented; no code, signing, submission, commit or deploy
- next: Implement guided Cardano native asset to ADA to existing exchange parent journey per docs/CARDANO-ADA-EXCHANGE-ROUTE.md; preserve standalone flows

### 2026-10-05T01:10-03:00 · codex · claim · 63f378d (main) dirty 22
- task: NFT favorites star at image top-left; persist per owner/mode; favorites-first USD sorting
- lease until 2026-10-05T04:10-03:00

### 2026-10-05T01:11-03:00 · codex · checkpoint · 63f378d (main) dirty 22
- Added always-visible top-left NFT favorite star, local per-owner/mainnet-testnet persistence, and favorites-first ordering with descending existing USD valuation within each group. Star stops card navigation; spam/search/value display preserved.
- next: Validate favorite toggle/order/persistence with real-extension test and screenshot; run typecheck, unit suite and affected builds.

### 2026-10-05T01:13-03:00 · codex · checkpoint · 63f378d (main) dirty 22
- Favorites sorting is memoized to avoid repeating it on card hover. Added ordering/account-mode-storage tests and real-extension star tests for top-left placement, favorites-first USD ordering, saved state, search, unstar and click isolation. Typecheck/suite and desktop/extension builds in progress; .nft-favorites-*.log.
- next: Inspect verification and favorite screenshot; document local persistence scope and release lease.

### 2026-10-05T01:15-03:00 · codex · checkpoint · 63f378d (main) dirty 22
- PASS 146 files/2139 tests and five-target typecheck; Android/iOS web builds passed. First two extension gallery/favorites tests passed and star screenshot inspected; added lock/unlock remount persistence check and loaded-image screenshot wait, final extension run in progress.
- next: Review persistence result/screenshot, finish latest desktop build, update board/docs verification and release.

### 2026-10-05T01:17-03:00 · codex · checkpoint · 63f378d (main) dirty 22
- Persistence test exposed a fixture assumption: extension has no lock push event, so a direct lock requires page reload to show unlock. Stopped that test run and corrected fixture to reload and reinstall synthetic holdings before unlocking; product code unchanged.
- next: Run corrected extension persistence regression; inspect final screenshot and release after passing checks.

### 2026-10-05T01:17-03:00 · codex · verify · 63f378d (main) dirty 22
- verified: PASS five-target typecheck; 146 files/2139 unit tests; desktop/extension/Android-web/iOS-web builds; two extension gallery/favorites tests; diff check and favorite screenshot review.
- Commands: npm run typecheck; npm test; npm run build; npm run build:extension; npx vite build --config vite.capacitor.config.ts; npx vite build --config vite.ios.config.ts; npx playwright test e2e/nft-gallery.spec.ts --workers=1; git diff --check. Logs .nft-favorites-*.log, screenshot test-results/nft-gallery-favorites.png.
- Favorite star top-left, stable favorites-first USD sorting and local owner/mode persistence verified, including reload/unlock. No native-device QA, profile sync, dependency change, commit or deployment. Existing xReserve/ADA work preserved.

### 2026-10-05T01:17-03:00 · codex · handoff · 63f378d (main) dirty 22
- NFT favorites complete and locally verified; changes uncommitted; no task jobs running. See docs/NFT-GALLERY-PERFORMANCE.md favorites section.
- next: NFT work complete; apply website equivalents when requested. Prior ADA exchange task: follow docs/CARDANO-ADA-EXCHANGE-ROUTE.md for an authorized guided parent journey; preserve standalone flows.

### 2026-10-05T14:31-03:00 · claude · claim · 5d52579 (main) dirty 1
- task: Cardano native asset -> ADA -> exchange: guided parent journey first slice (persisted exchange + journey, manual funding)
- lease until 2026-10-05T18:31-03:00

### 2026-10-05T14:31-03:00 · claude · checkpoint · 5d52579 (main) dirty 2
- Re-verifying HEAD 5d52579 (board verified 63f378d): npm run typecheck && npm test, logs .ada-route-verify-{typecheck,tests}.log
- next: Read xchange-client, SimpleSwapWidget, ExchangeStatusCard, cardano-swap, swap-sessions; design journey store

### 2026-10-05T14:33-03:00 · claude · verify · 5d52579 (main) dirty 2
- verified: PASS at 5d52579: npm run typecheck exit 0; npm test 146 files / 2139 tests (.ada-route-verify-*.log)

### 2026-10-05T14:35-03:00 · claude · checkpoint · 5d52579 (main) dirty 2
- Design: parent journey references the existing Minswap swap session by intentId (fill = session completed with delivered lovelace); leg2 = fresh ADA exchange quote after fill, separate approval, manual funding
- Provider payout/refund hash fields confirmed from published docs: SimpleSwap v3 txFrom/txTo/userRefundAddress; ChangeNOW by-id payinHash/payoutHash/refundHash
- Codex audit folded in: validate created exchange vs approved request before persisting; deposit instructions immutable; finished/refunded need on-chain evidence (ERC-20 credit via measureDelivery; refund via Koios mainnet tx outputs)
- next: Write src/shared/ada-exchange-route.ts, src/main/ada-exchange-journey.ts (+test), stores, handlers, panel

### 2026-10-05T14:39-03:00 · claude · correction · 5d52579 (main) dirty 2
- STOPPED Cardano->ADA->SimpleSwap/ChangeNOW journey slice: user + Codex corrected scope (feature belongs in DEX/Magic Swap, DexSwapWidget, Minswap + supported bridge only; no deposit-address exchange)
- Slice was never wired (no handler/bridge/UI). Removed its edits file-by-file: restored 8 files clean at HEAD 5d52579 (stores x3, simpleswap/changenow clients, swap-intent peek, 2 tsconfigs); deleted ada-exchange-journey.ts, shared/ada-exchange-route.ts. Tree now = HEAD + handoff files only
- Reusable research kept in journal: SimpleSwap v3 txFrom/txTo, ChangeNOW payinHash/payoutHash/refundHash (published docs)
- next: Re-verify (typecheck+tests), then read-only reassessment of DexSwapWidget cardanoCrossChain route: Minswap + supported bridge; keep Cardano outbound disabled

### 2026-10-05T14:40-03:00 · claude · checkpoint · 5d52579 (main) dirty 2
- Reassessment (read-only): DexSwapWidget + swap-proxy refuse Cardano cross-chain quotes; only documented supported bridge = xReserve inbound (EVM USDC -> Cardano USDCx), mainnet blocked on deposit quote; outbound disabled
- Wanchain live tokenPairs 2026-10-05 17:40Z: 470 pairs / 27 chains, zero with Cardano chain side

### 2026-10-05T14:40-03:00 · claude · handoff · 5d52579 (main) dirty 2
- Stopped wrong-scope ADA exchange slice (fully removed; tree = HEAD 5d52579 + handoff files). Reassessed DEX Swap Cardano route; awaiting user decision.
- next: User to choose: (a) testnet-first composed inbound Magic Swap route (Sepolia USDC -> xReserve -> Preprod USDCx -> Minswap) in DexSwapWidget, (b) mainnet inbound with an explicit user-set fee cap (product decision), or (c) hold. Outbound stays disabled.

### 2026-10-05T15:04-03:00 · claude · claim · 5d52579 (main) dirty 2
- task: Investigate DexHunter as mainnet Cardano same-chain provider beside Minswap (research only until API key)
- lease until 2026-10-05T18:04-03:00

### 2026-10-05T15:05-03:00 · claude · checkpoint · 5d52579 (main) dirty 2
- Direction change (user+Codex): prioritize MAINNET Magic Swap/DEX Swap; DexHunter as extra Cardano same-chain provider beside Minswap; no Preprod stand-in, no SimpleSwap/ChangeNOW; xReserve inbound = separate leg with fee/min gate; outbound disabled
- DexHunter docs (dexhunter.gitbook.io/dexhunter-partners, llms.txt): base https://api-us.dexhunterv3.app, header X-Partner-Id (partnerCode from app.dexhunter.io/partners account; partner sets fee >=0.01%). POST /swap/estimate, /swap/build (cbor, splits[]), /swap/sign {txCbor, signatures}; cancel only documented for limit/DCA. No OpenAPI, no published fee/terms/rate limits
- Keyless probe 2026-10-05 18:05Z: /swap/estimate answers WITHOUT key but stamps partner_code SHADOWBOOK, partner_fee 5 on 100 ADA->USDCx; single split SHADOWBOOK, out 26.3727 pre-slippage / 25.054 total_output, batcher 0.6, deposits 4. Not our terms: do not use keyless numbers as a quote
- Minswap same time, 100 ADA->USDCx: MinswapV2-only = 2-hop, out 26.248 (min 25.731), dex fee 2, agg fee 0.85, impact 0.62%; unrestricted aggregator = DanogoCLMMV1 single hop 26.472. No /swap/build called (needs buyer address + key)
- next: User: create DexHunter partner account (app.dexhunter.io/partners), choose partner fee %, provide partnerCode; then authenticated estimate+build comparison for exact pairs, decode returned cbor per DEX script before any signable path

### 2026-10-05T15:05-03:00 · claude · handoff · 5d52579 (main) dirty 2
- DexHunter investigated read-only; blocked on partner key (user action). No code changes; tree = HEAD 5d52579 + handoff files
- next: User provides DexHunter partnerCode (app.dexhunter.io/partners) and partner-fee choice; then authenticated quote/build comparison vs Minswap for exact mainnet USDCx<->native pairs

### 2026-10-05T15:07-03:00 · claude · claim · 5d52579 (main) dirty 2
- task: DexHunter authenticated read-only research: sanitized estimate/build captures for exact mainnet USDCx pairs
- lease until 2026-10-05T18:07-03:00

### 2026-10-05T15:14-03:00 · claude · checkpoint · 5d52579 (main) dirty 3
- DexHunter step A: authenticated read-only capture via ChainLens credential (never printed/stored); 28 sanitized files src/main/__fixtures__/dexhunter/, key-absence checked
- USDCx search: 21 named, 1 exact full-ID match, only verified one, decimals 6
- Builds: required signers payment+stake keys; extra output = partner_fee to addr1q8l7hny7...qtnzlfk (unidentified); MSV2-only builds are genuine Minswap V2 orders (datum floor = total_output); default routes CSWAP/SHADOWBOOK unknown scripts; existing validator refuses all
- Quotes: DexHunter never beat Minswap aggregator; Danogo CLMM best on ADA<->USDCx. Results appended to docs/DEXHUNTER-EVALUATION.md

### 2026-10-05T15:14-03:00 · claude · handoff · 5d52579 (main) dirty 3
- DexHunter step A complete; no wallet code changed
- next: User: identify addr1q8l7... (DexHunter vs ChainLens payout) and partner fee intent; choose DexHunter MSV2 profile vs Danogo CLMM profile for Minswap path

### 2026-10-05T15:17-03:00 · claude · claim · 5d52579 (main) dirty 3
- task: Danogo CLMM: capture Minswap-built Danogo txs, own validator profile, then enable in DEX Swap beside Minswap V2
- lease until 2026-10-05T18:17-03:00

### 2026-10-05T15:35-03:00 · claude · checkpoint · 5d52579 (main) dirty 12
- Danogo CLMM: new danogo-clmm.ts (pins, datum/redeemer decoders, published swap rule), separate cardano-danogo-validate.ts; minswap-client protocol option; cardano-swap dispatch + direct status; swap-proxy offers V2 + Danogo candidates; executor merges witness sets; UI wording (SwapQuoteCard, CardanoOrderStatusCard)
- Fixtures: __fixtures__/minswap/{ada-usdcx-danogo-20,usdcx-ada-danogo-2}.json (unsigned, read-only, pool+wallet inputs resolved). New tests 32+4 pass; 3 mutation checks fail as expected
- Running full suite -> .danogo-tests.log; typecheck -> .danogo-typecheck.log (passed before tests were added)

### 2026-10-05T15:41-03:00 · claude · checkpoint · 5d52579 (main) dirty 13
- Danogo e2e added (real extension, bridge stubs); running full validation: typecheck, npm test, build, build:extension, capacitor+ios vite builds, cardano e2e -> .danogo-*.log

### 2026-10-05T15:45-03:00 · claude · verify · 5d52579 (main) dirty 14
- verified: PASS uncommitted on 5d52579: typecheck 0; npm test 148 files/2177 tests; npm run build, build:extension, vite capacitor+ios builds; playwright e2e/cardano-swap.spec.ts 3/3 (.danogo-*.log)
- Danogo CLMM route in DEX Swap complete locally; screenshots test-results/cardano-danogo-{quote,sent,complete}.png reviewed

### 2026-10-05T15:45-03:00 · claude · handoff · 5d52579 (main) dirty 14
- Danogo CLMM same-chain route implemented beside Minswap V2 with its own validator; nothing signed/submitted/committed
- next: User reviews + commits; authorize one small mainnet Danogo swap for real-funds QA

### 2026-10-05T15:49-03:00 · codex · claim · 5d52579 (main) dirty 14
- task: Review Danogo path; gate direct settlement on Cardano script validity
- lease until 2026-10-05T17:49-03:00

### 2026-10-05T15:52-03:00 · codex · checkpoint · 5d52579 (main) dirty 14
- Review found Danogo status could mark an included phase-2 failed transaction completed from unrealized indexed outputs.
- Added Blockfrost hash/height/valid_contract gate, failed-state preservation, regression tests and clarified gross ADA payout text.
- next: Run typecheck, full unit suite and Cardano browser checks; review diff before any commit.

### 2026-10-05T15:54-03:00 · codex · verify · 5d52579 (main) dirty 14
- verified: PASS after Danogo settlement validity fix: npm run typecheck exit 0; npm test 148 files/2179 tests; npx playwright test e2e/cardano-swap.spec.ts --workers=1 3/3; git diff --check clean. DexHunter 28 JSON captures checked for credential fields.
- next: Stage and commit reviewed research and Danogo implementation separately; no real-funds QA.

### 2026-10-05T15:56-03:00 · codex · checkpoint · e68f40e (main) dirty 2
- Committed DexHunter read-only evaluation f074204 and Danogo integration with settlement validity guard e68f40e.
- Restored src/shared/swap-networks.ts after verifying its content matched HEAD; only handoff board/journal remain dirty.
- next: Release lease. Await explicit authorization for a small mainnet Danogo QA swap; fee-aware ranking and xReserve mainnet gates remain separate work.

### 2026-10-05T15:56-03:00 · codex · verify · e68f40e (main) dirty 2
- verified: PASS on committed tree e68f40e: typecheck exit 0, npm test 148/2179, Cardano Playwright 3/3. Danogo phase-2 validity regression included; no live signing or submission.
- next: Release lease; real-funds Danogo QA requires explicit user authorization.

### 2026-10-05T15:56-03:00 · codex · handoff · e68f40e (main) dirty 2
- Reviewed and committed Danogo integration plus DexHunter research. Fixed phase-2 settlement validity and gross ADA payout wording; 148/2179 tests, typecheck and Cardano Playwright 3/3 pass. No live swap.
- next: User may authorize a small mainnet Danogo QA swap; do not initiate without explicit authorization. Fee-aware ranking and xReserve mainnet gates remain.
