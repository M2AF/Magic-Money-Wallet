# C3 read-only discovery: Claude L2 contract handoff

2026-10-14. Reader and token-bridge integration implemented and locally verified. Final verification status is below and in the shared journal. L2 UI work starts after Codex releases the lease.

## Current scope

Discover native assets in the Foundation's canonical **Cardano mainnet** programmable-token deployment. Read balances, current registry/protocol data and recent token-specific balance changes. No transaction building, signing, submission, mint, burn, freeze, seize or issuer onboarding.

Other deployments and Preview/Preprod are not supported by this reader. The existing mainnet/testnet/privacy source gates remain intact. USDCx outbound and cross-chain gates are unchanged; no USDCx CIP-113 conformance is inferred.

## Research and live evidence

- Foundation platform record pinned to `ab75bd5d16f4c7d5e5a5ced54ec3bf3d5ff775ce`; deployed core schema v0.0.1 pinned to `6b75ba3286b4692ca23059ff51285db357fb09c6`. Do not build decoders from an unpinned development branch.
- Canonical genesis/version: `bfefbd222e40d88f5d4454e92b24062533070f41a3e25c0a23383264650cdb72`.
- Registry/NFT policy: `484e733d122af44e6101988bcc47ed261a7af5c43c797e89d60e3075`; PLB script: `d91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838`.
- Protocol params NFT policy: `3a511ec25af655c1aef31d0d9c0c6154eae7321045b1fa46fac55ecd`; asset name is **ProtocolParams**, hex `50726f746f636f6c506172616d73`, not empty.
- Mainnet Koios reads succeeded for current registry and params. At capture the complete registry had an origin and three policy nodes; current params remained at genesis output #0 with the published dispatcher/issuance/transfer/third-party/upgrade credentials.
- Compiled observer independently read the documented public DIS987 holder: raw balance 1, matching published wiring, and a recent increase of 1 in transaction `95020f08...a9f3637b`. This is public read compatibility, not user wallet/private-key/signing/settlement proof. Result `.local-artifacts/cip113-c3/live-observer-result.json`.
- `src/main/__fixtures__/cip113/README.md` records capture endpoints/provenance and how synthetic tests differ from live evidence.

## Files and exported contracts

- `src/shared/cip113-wire.ts`: renderer-safe, JSON-serializable types. No secrets, BigInt values, Maps or signing objects cross the bridge.
- `src/main/cardano-programmable.ts`: canonical constants, owner-address derivation, strict registry/protocol decoding, holdings/history projection and bounded Koios read adapter.
- `src/main/token-fetcher.ts`: `fetchCardanoProgrammableTokens` maps holdings through existing metadata enrichment; `fetchAllTokens` includes them and reports discovery failures in `chainErrors.cardano` with a Programmable tokens prefix.
- `WalletToken` in main and renderer now has `source?: 'agw' | 'cip113'` and `programmable?: Cip113ProgrammableDetails`.
- `canSendToken`, `swapTokenFromHolding` and the dashboard send-entry guard reject programmable holdings. Existing ordinary-asset and AGW handlers are unchanged. Unpriced/unknown-decimal programmable tokens retain null valuation, not a fabricated zero.
- Legacy stake-account NFT discovery shares the same account-scoped observer read (five-second memory cache, failures not cached). Confirmed programmable units are excluded from the ordinary NFT path to prevent duplicate holdings/valuation and generic NFT Send. A direct-address holding of the same unit retains only its direct quantity. Unknown or registered-policy stake-only NFT fallbacks remain visible with `WalletCollectible.readOnlyReason`; availability/reason helpers and the dashboard NFT entry guard withhold Send. NFT layout is unchanged.
- Selection keys also bind programmable holdings to the active Cardano owner address, in addition to the original account/mode/source/deployment identity.
- `TokenDetailsPanel` has only a minimal source label for cip113. Rich badges, core-data disclosures, token-specific history presentation and restriction states belong to Claude L2.

No new IPC methods or platform routers are needed: all four targets already consume the existing token-result payload. Extension/browser and desktop e2e transports now stub public Koios reads as well as live Workers; default fixtures are canonical registry/params plus empty account holdings. Non-read Koios endpoints are blocked in tests.

## L2 data contract

For a programmable row use `token.programmable`:

| Field | Meaning and display rule |
|---|---|
| deploymentId/network/checkedAt | Exact canonical deployment, mainnet, last observer check in Unix milliseconds. Show coverage explicitly. |
| holdingAddresses | Both candidate payment-key and stake-key convention addresses for this account; not permission to offer Receive. Do not choose a convention from this list without a verified token adapter. |
| registry | Current authenticated output ref, policy ID, minting/transfer/thirdParty/unfracking credentials and optional global-state policy. Script IDs identify hooks, not their behavior or human operators. |
| protocol | Current output ref, dispatcher/issuance/delegates, upgrade credential, pending nomination, matchesPublishedWiring. Display authority as a credential/hash; do not claim verified human issuer identity. |
| restrictions | Currently unknown with a concrete reason. Feed it into tokenDetailsCapabilities. No token-module decoder is approved; do not infer frozen/unrestricted or permissions from CIP-113 conformance. |
| availableRawBalance | Always null until token-specific transfer checks exist. Holding remains visible; available amount is unknown, not zero. |
| history | Independent ready/error/unknown state. When ready: scope token, coverage recent, balance-change events. Failure does not erase holdings. |

History event quantities are exact signed integer strings; timestamps are **Unix seconds** (multiply by 1000 when adapting to TxRecord). Labels should say Balance increase/decrease/unchanged. `trigger` is always unknown: do not label an outgoing event as a user Send or incoming as a user Receive/issuer seizure. Reference inputs and collateral are excluded from balance calculations. Recent history is limited to the latest 20 address transactions, not complete account history. Each transaction's script outcome is checked through `/tx_cbor.valid_contract` bound to its exact hash: false is excluded, unavailable/ambiguous outcome makes history an error. This is observed inclusion/script success, not finality or cross-chain settlement.

Pass `restrictions: token.programmable?.restrictions` to the existing capability helper. Keep generic Send/Swap unavailable. Receive remains unavailable until a verified deployment/token-specific address convention and eligibility adapter exist. Existing QR receive for ordinary tokens is unaffected.

Recommended L2 presentation:
- Programmable badge on the row and details header, with the deployment/network context.
- Held amount separately from Available to send: unknown. Missing price: Price unavailable.
- A restriction section explaining that token-specific rules/trigger authorities are not yet verified, plus expandable core script/registry references.
- Upgrade credential and pending nomination separately from token third-party capabilities.
- Recent **token balance changes** when history is ready; a separate clearly labeled network-activity section if retained. Error/loading/unknown states must be visible independently.
- Existing unsupported-action explanations remain; no issuer/KYC form, automatic signing, generic safety score or Safe/Unrestricted badge.

## Vetted explorer source for Claude's L1 follow-up

**Cardanoscan, Cardano mainnet:** `https://cardanoscan.io/token/<policyId+assetNameHex>`; append `?tab=programmable` for a verified programmable row. The documented DIS987 page was opened and confirmed its exact asset ID and Programmable classification.

Construct the URL locally from a validated unit: 56 lowercase hex policy characters plus 0–64 even hex asset-name characters. The hostname/template is fixed; token metadata never supplies the URL. Require mainnet context; do not route testnet tokens to the mainnet explorer. Preview/Preprod token templates and other chains have not been vetted by this research; withhold those links until separately verified. Use the app's existing browser-opening path, not a new external-browser flow.

Source page: https://cardanoscan.io/token/b025efe5b44b43ed154419c66b0efc9cf148fd98f464e261018c89e8444953393837?tab=programmable

## Verification and boundaries

- Final focused logic: 7 files/72 tests passed, including NFT ownership and transaction-outcome guards.
- Final full unit run: 179 files/2584 tests passed; the fresh full gate also passes this unit stage.
- Real extension: all 7 token-details cases passed first attempt in the final full run, including actual existing token bridge + canonical observer fixtures, missing-price display and generic execution disabled.
- Final compiled live read-only observer succeeded, including the hash-bound transaction-outcome check; one public holding, matching published wiring and ready scoped balance-change history. Token module semantics remain unknown.
- Final fresh `CI=1 npm run verify:ci` **exits 0**: five TypeScript targets, 179 files/2584 unit tests, fresh desktop and extension builds, 99 browser passes, one history repeat-visit flaky pass and one existing skip. Audit: zero critical, existing four moderate/four high unchanged. Log `.local-artifacts/cip113-c3/verify-ci.log`, exit-code sidecar `verify-ci.exitcode.txt`. Earlier stopped pre-fix logs are diagnostic only.
- The completed pre-selector run exited 1: 98 browser passes, one history retry, one skip and one Sovereign strict-selector failure. Both Sovereign/Mallard can show Ownership unavailable. A test-only correction scopes that assertion to the Sovereign button; both its isolated regression and final full-gate case pass first attempt. Archived failure log `verify-ci-sovereign-selector-failure.log` is not a pass.
- Final programmable-panel screenshot reviewed: `.local-artifacts/cip113-c3/programmable-panel.png`. Seven regenerated tracked PNGs archived under `generated/` and original bytes restored; manifest `restored-pngs.json`.
- Android/Capacitor and iOS Vite web builds both exit 0; logs `capacitor-web.log` and `ios-web.log`. No native camera, hardware Back, real-funds, feature-SHA GitHub CI or deployment proof. HEAD remains `24d088b` (main), with uncommitted shared work.

## Pickup

Claude: after release, claim L2 and implement the programmable states above using the existing universal panel. You may include the Cardano-mainnet explorer link and Android hardware Back follow-up within a clearly logged scope, with native validation boundaries explicit. Same-checkout edits remain sequential. Preserve uncommitted C1/L1/C2/C3 work and prior chat notes.

Codex C4 is a separate executable adapter and testnet/release QA gate. Current provenance proves observed balances and wiring only. No commits, pushes, deployments, signing or broadcasts were authorized/performed by this C3 work.
