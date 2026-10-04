# DexHunter alongside Minswap — evaluation

Date: 2026-10-04. Scope: inspect the existing wallet and current provider documentation; recommend an additive integration. No provider execution code, dependencies, configuration secrets, deployment, signing, or submission changed.

## Recommendation

Keep the current Minswap path. Evaluate DexHunter as a second same-chain Cardano provider, initially quote-only and unavailable for execution. Promote only transaction shapes whose on-chain terms the wallet independently validates. Broad multi-DEX/split execution is a separate implementation step.

DexHunter's routing coverage is promising, but there is no measured evidence here that it gives this wallet a better executable result. Compare the same exact pair, amount, time, enforceable minimum, and costs after obtaining authorized API access. The existing Minswap client is itself an aggregator client, deliberately restricted by this wallet to one Minswap V2 route; this is not a comparison between aggregation and a simple single-pool client.

## Evidence and limits

- Current HEAD: `7d2f7bb`, branch `main`, with substantial pre-existing tracked and untracked changes. Those changes were preserved.
- `npm run typecheck`: passed for all five TypeScript configurations. Log: `.handoff-typecheck.log` (local/ignored).
- `npm test`: 134 files and 2,020 tests passed. Log: `.handoff-tests.log` (local/ignored).
- Current DexHunter official partner documentation was read, including swap, access setup, token search, order and cancellation pages.
- One unauthenticated `POST /swap/estimate` probe returned HTTP 403. It used the documented ADA-to-NIGHT example pair and amount 1 with 1% slippage. No build/sign/submit call was made. This establishes rejection from this environment; it does not distinguish an authentication rejection from an edge/network restriction.
- No authenticated DexHunter quote or unsigned CBOR was obtained. No rate, liquidity, fee, cancellation, network support, or execution claim is live-verified.
- Native builds and browser E2E were not run for this documentation evaluation. The passing baseline is not evidence of deployed behavior or real-funds readiness.

## Comparison

| Concern | Current Minswap path in this tree | DexHunter integration implication |
| --- | --- | --- |
| Access | Device-side keyless API; prior measured per-IP throttling is recorded in the client and discovery notes | Partner access required; keep the credential in the existing trusted server-side proxy design |
| Accepted routes | One path, every hop Minswap V2; split estimates are rejected | Supporting additional route shapes requires independent DEX/order profiles, not a relaxed address allowlist |
| Identity/amounts | `lovelace` or full Cardano unit; integer strings internally | Map only at the API boundary and prove precision; never identify a token by ticker |
| Minimum | Checked against slippage and read from the actual order datum | Require an independently decoded enforceable floor for every accepted order/leg |
| Costs | Network, batcher, deposit, and aggregator costs read/checked against CBOR | Separate provider, DEX, app fees and refundable deposits; verify destinations and net debit |
| Signing | Existing privileged CIP-30 signer, one payment-key witness, original transaction bytes preserved | Reuse signer and review path; inspect compatibility of witness assembly and returned artifact |
| Settlement | Chain evidence for the order output's spender and wallet net delivery | Track all accepted order references; a provider status alone cannot establish delivery |
| Recovery | External Minswap Orders page; native cancellation is not implemented | Cancellation transaction validation needs its own profile and a measured cancellation case |
| Cross-chain | General Cardano DEX routing is same-chain; xReserve gates remain separate | Adding DexHunter does not enable ADA-to-SOL/ETH or resolve xReserve blockers |

## Current public API contract

The [swap documentation](https://dexhunter.gitbook.io/dexhunter-partners/trading/swap) specifies `POST /swap/estimate` and `/swap/build`, numeric human-unit `amount_in`, percent `slippage`, empty-string ADA identity, full token IDs, optional `blacklisted_dexes`, and build CBOR with split descriptions. It lists `MINSWAPV2` and `MS2HOP` separately. Estimate fields include `total_output`, `total_output_without_slippage`, and `possible_routes`; the documented fields do not establish their equivalence to the wallet's datum-enforced minimum. Confirm these meanings using authenticated samples and contract data.

The [partner setup](https://dexhunter.gitbook.io/dexhunter-partners/partners/getting-started) calls `partnerCode` a secret, uses `X-Partner-Id`, and describes a minimum partner fee of 0.01%. Verify the actual account settings, fee base, beneficiary, and terms before deciding a fee policy. Do not silently change the wallet's product fee policy. The current host is `https://api-us.dexhunterv3.app`; do not combine its payloads with legacy `dhapi.io` Swagger contracts.

The [token-search page](https://dexhunter.gitbook.io/dexhunter-partners/data/token-search) supplies full token IDs but does not document decimals in its response table. Search alone is insufficient for decimal conversion: obtain validated metadata from a supported token-info source. The token-info page was not retrievable through the research browser during this evaluation.

The [order documentation](https://dexhunter.gitbook.io/dexhunter-partners/orders/orders) supplies paginated user orders with IDs, hashes, and statuses. Its sorting table and examples use different values (`DATE` versus `STARTTIME`); verify accepted values rather than choosing one by guesswork. Correlate provider IDs to exact on-chain order output references.

The [cancel page](https://dexhunter.gitbook.io/dexhunter-partners/orders/cancel) introduces cancellation for pending limit/DCA orders and returns unsigned CBOR. Do not assume it supports every market-order route or proves recovery for this wallet. Establish eligibility, datum/redeemer rules, returned funds, execution budgets and cancellation races separately.

## Integration boundaries found in the code

1. **Provider/quote contract:** `src/shared/swap-quote.ts` has no `dexhunter` provider. `CardanoOrderTerms.protocol` is exactly `MinswapV2`, with one path and one set of costs. A provider-specific discriminated order model is needed before representing multiple protocols or splits. Preserve the existing Minswap shape for old sessions.
2. **Discovery and selection:** `src/shared/swap-networks.ts` permits only `minswap` on Cardano and marks it `implemented-unverified`. `src/main/swap-proxy.ts:getCardanoSwapQuote` creates one candidate and sends it through existing safety/ranking gates. Add a separately validated DexHunter candidate; provider failure must not prevent a valid Minswap result.
3. **Execution eligibility:** `src/shared/swap-execution-checks.ts` only permits Minswap for Cardano. `src/shared/swap-policy-checks.ts` maintains the enforceable-minimum provider set. Do not add DexHunter to these allowlists until its actual transaction validator and floor checks exist. Quote-only observations must stay outside executable candidate selection.
4. **Pre-signing validation:** `src/main/cardano-swap.ts:expectationFromQuote` is provider-specific. `src/main/cardano-swap-validate.ts:validateMinswapOrderTx` rejects scripts/witnesses, unknown body fields, more than one order, and outputs outside owned change, the pinned Minswap script, and its fee address. Reuse parsing/value-conservation concepts while keeping this profile strict. A DexHunter Minswap-only route may still differ in fee outputs, body fields or witness contents; it cannot be assumed compatible without CBOR evidence.
5. **Signing:** `src/main/swap-executor.ts:executeCardanoSwap` fresh-checks UTXOs/tip, signs locally, checks one payment-key witness, assembles the original body, and submits. Prefer local assembly where the accepted transaction class permits it. If `/swap/sign` is necessary, decode the returned transaction and prove the body hash, auxiliary data, validity flag, required scripts and witness contents match the reviewed artifact.
6. **Persistence:** The current executor starts session writes with a fire-and-forget helper and discards errors. The broadcast flag is also in the current intent machinery. Before adding another execution path, ensure the approved artifact, transaction hash, and all order references are durably written before broadcast; test interruption and unreadable-store behavior. This is an observed existing risk, not a fix completed here.
7. **Settlement:** `getMinswapOrderStatus` finds one pinned Minswap order output. It cannot correctly represent several orders, partial fills/refunds, or different scripts without a new tracking model. Aggregate only verified output amounts, separate returned deposits from bought ADA, and retain pending/unknown states for unresolved legs.
8. **Routing costs:** `src/shared/swap-routing-policy.ts` ranks net output and normalizes source costs only when every candidate has supplied comparable values. Do not claim the cheapest route if ADA overhead is unpriced. Show costs separately, or normalize with a verified common price source. App-fee preference stays subordinate to the existing competitive-output/floor/risk rules.
9. **Targets:** Shared core and existing IPC/extension/native seams already provide signing and routing access. Use an API adapter and trusted proxy; no React widget or new Aiken/Lucid/Mesh dependency is needed merely to consume unsigned provider transactions. Native validation remains required if later changes affect native targets.
10. **Existing website compatibility:** `src/preload/web3-inject.ts` and `src/extension/provider-core.ts` already reference `app.dexhunter.io` for VESPR compatibility branding. That is dApp compatibility, not an embedded DexHunter swap adapter or proof of an executed swap.

## Narrow implementation sequence and acceptance criteria

**A. Authorized access and quote-only benchmark.** Obtain partner access through the user's established credential path, confirm contract units, decimals, limits, network support, fees and rate semantics, and capture sanitized estimates/build samples. Keep credentials out of code, logs and chat. Compare both providers for the same full-unit pairs, amounts and timestamps. Record no-route/throttle failures as provider errors. Do not deploy or create a partner account merely to complete this evaluation.

**B. One independently understood order profile.** Attempt only supported Minswap V2 shapes first if authenticated CBOR evidence permits that narrow scope. Blacklisting other DEXes is only a request; reject any returned unsupported script, split, field or fee. If that leaves too few useful routes, explicitly scope additional contract profiles rather than weakening the existing validator. Read each whole affected file before editing.

**C. Signing and durable recovery.** Bind the approved transaction and terms in the privileged intent path, revalidate against live UTXOs/tip, persist transaction/order identity before submission, and preserve or verify exact executable bytes during witness assembly. Tests must reject unknown beneficiaries, token redirection, wrong receiver/minimum, changed body/auxiliary data, unsupported witnesses, stale inputs and duplicate-intent retry after uncertain submission.

**D. Settlement and product integration.** Track exact outputs and all legs; verify fills/refunds on-chain. Add a candidate to the existing router only after A–C pass. Failures must preserve Minswap availability. Test fee/deposit accounting, precision boundaries, partial completion, restart, cancellation races and status disagreement. Run typecheck/unit tests plus affected target builds and browser E2E; native Android changes require actual Gradle and iOS native verification requires its CI workflow. Update real-funds QA only after a separately authorized measured transaction.

## Resume point for Claude or Codex

Read root `HANDOFF.md`, run the handoff script's `status`, and claim a concrete scope before edits. The next productive step is A: credentialed, sanitized quote/build evidence sufficient to decide which transaction shapes are feasible. Until then, this recommendation is an integration design with explicit unresolved API/runtime questions, not an implementation-ready promise of full DexHunter routing.
