# USDCx burn build: open questions and the build-only probe

Date: 2026-10-05. Context: [routing plan](USDCX-STABLECOIN-ROUTING-PLAN.md), step 3.

This document lists what must be established before any burn is signable. It is not an authorization to call the builder.

Already in the wallet:
- read-only IOG history tracking (`src/main/iog-withdrawal-history.ts`);
- Ethereum and Arc-forwarded Solana preparation (`xreserve-withdrawal-prepare.ts`, `xreserve-forwarded-prepare.ts`);
- route planning and a read-only DEX Swap preview (`stablecoin-route-plan.ts`, `StablecoinRoutePreview.tsx`);
- journey state (`src/shared/stablecoin-journey.ts`).

Every bridge path stays `executable: false`.

## Questions the unsigned build must answer

| # | Question | Why it blocks signing | How a build answers it |
|---|---|---|---|
| 1 | `userWalletInfo` schema: is `stakingKeyHash` required for base addresses? Must `secondaryAddress` list every wallet address whose UTxOs may be spent? | The builder chooses inputs. The validator must know which owned UTxOs it may touch. | Compare the build's inputs with the supplied addresses. |
| 2 | `reservedCollateral`: whose collateral is used? | The wallet's coins must never be put at risk as collateral. The service collateral key `e5d5e3df…` witnesses every public burn. | The build's collateral inputs and the existing witness set. |
| 3 | Witness split: which vkeys does the builder pre-attach, and which does the wallet add? | The wallet must add only its payment key, and merge its signature without changing redeemer bytes (as the Danogo signing path does). | The returned witness set. |
| 4 | Burn commitment: how is `circleBurnIntent` bound into the transaction (datum, redeemer, metadata)? | The validator must prove the signed transaction burns exactly `value + maxFee` for this intent and no other. | Decode against `xreserve-cardano-burn-proof.ts` (observed 60/60 shape). |
| 5 | Destinations: does the operator accept Arc-forwarded (domain 26 → Solana) intents, or only direct Ethereum? | The Portal UI offers Ethereum only. | A build for a forwarded intent: success or explicit refusal. |
| 6 | Limits and expiry: transaction TTL versus Circle's `maxBlockHeight`, and the minimum and maximum amounts. | Expired intents must not be signed. The journey must know when a burn can no longer land. | The build's validity interval and error responses. |
| 7 | Fees: the ADA network fee, any operator fee outputs, and how `maxFee` (USDC) is charged. | The wallet's net change must equal the burn plus the stated fees. | Classify every build output. |
| 8 | Submission: is `/tx/submit-burn-tx` idempotent? Does `/tx/record-burn-tx` accept a hash already submitted elsewhere, and what does it return for a duplicate? | Prevents a second burn after an uncertain broadcast. Submission alone, before Circle sees a burn, gives no 409 protection. | Documented answer from IOG, not experimentation with funds. |

## Build-only probe (needs explicit authorization)

One `POST https://production-docker.usdcx.aws.iohkdev.io/tx/burn-usdcx` call:
- **Wallet:** the user's own funded mainnet key-hash wallet (never a third-party address).
- **Intent:** a Circle-prepared intent for a small Ethereum release to the user's own EVM address.
- **Fee cap:** the user's chosen cap, not a default.

The response CBOR is saved sanitized (no witnesses added) and decoded offline against questions 1–7. Nothing is signed or submitted. Question 8 needs IOG's written answer.

Alternatively, send a provider-support request to IOG covering questions 1–8. This document is the content of that request.

## Not decided here

These are product decisions, not engineering questions:
- the bridge fee ceiling (Circle publishes no withdrawal fee schedule);
- whether to depend on an observed, unversioned IOG interface.

## Probe result (2026-10-06, authorized by the user)

- **Run:** two attempts at 06:38 UTC, each one Circle prepare and one builder call. Nothing was signed, submitted or recorded, and no USDCx was burned.
- **Precondition:** the user's own key-hash base address held 4.022074 USDCx and 16.41 ADA after an ADA → USDCx Danogo swap the user made for this probe.
- **Circle `prepare-withdrawal`: succeeded.**
  - Terms: 1.000000 USDC release to the user's own EVM address, `maxFee` 2.000000 USDC (Circle's value; it met the 2 USDC ceiling), burn 3.000000 USDCx, a 524-byte BurnIntent.
  - It passed the wallet's `validatePreparedWithdrawal`.
- **IOG `POST /tx/burn-usdcx`: HTTP 502 Bad Gateway (nginx) both times.** The request followed the Portal bundle's shape: `primaryAddress` = payment and staking key hashes, empty `secondaryAddress` and `reservedCollateral`, and `circleBurnIntent` = Circle's `encoded`.
- **Partial backend health:** at the same time `GET /withdrawal-history/{address}` returned 200, and a POST with an empty body returned a 400 schema error. Those responses show that these routes and the empty-body validator were reachable; they do not establish that the builder or its dependencies were healthy.
- **Interpretation:** the request got past the empty-body check, but a 502 does not prove its full schema or semantics were accepted. The cause is not visible from outside. Candidates include a builder/node fault, an amount or UTxO/collateral precondition surfaced poorly, an input the Portal supplies differently, or a policy that refuses non-Portal callers.
- **Questions 1–7 remain unanswered:** no transaction was returned.
- **Next step, which does not touch the builder again:**
  1. The user starts the same withdrawal in the IOG Portal and stops at the wallet signing prompt, without signing. If it fails before signing too, that narrows the issue to a shared service or wallet/amount precondition; it does not by itself prove an IOG outage. If it reaches signing, compare the Portal's builder inputs with this probe before another independent call.
  2. Send IOG the questions in this document, including this 502 and its timestamp.

## Portal comparison (2026-10-06, read-only)

**Sources:** the Portal's public JavaScript (`usdcx.iog.io/_next/static/chunks/8084ddff25a91cc7.js` and `97e7cad71074aa8f.js`), and the user operating the Portal with the same wallet without signing.

- **Builder request: same field structure as the probe.** The Portal sends `{ userWalletInfo: { primaryAddress: { paymentKeyHash, stakingKeyHash | null }, secondaryAddress: [], reservedCollateral: [] }, circleBurnIntent: <Circle batches[0].encoded> }`. Key hashes are lowercase without `0x`; the two lists are always empty. The encoded intent and amount differ between the 1 USDC probe and 5 USDC Portal build.
- **Retries:** it retries a 5xx or a network error up to three times, 0.5 s then 1 s apart.
- **Circle preparation: same field structure as the wallet's** (`batches: [{ token: USDC, valueExcludingFees, remoteDomain: 10004, remoteDepositor, finalDestinationDomain: 0, finalDestinationRecipient, useCircleForwarding: true }]`); `valueExcludingFees` differs with the requested amount.
- **Portal configuration:** `withdrawal: { minAmount: 5, feeEstimation: 5 }`.
  - **Minimum:** an amount below 5 USDCx is refused ("Minimum 5 USDCx").
  - **Fee estimate:** "Bridge Fee ~5 USDC" is this static estimate, not a quote. Circle prepared `maxFee` 2 USDC for the probe.
  - **Headroom:** the amount must not exceed balance − 5 ("Must keep at least 5 USDCx in wallet"), so a 5 USDCx withdrawal needs at least 10 USDCx. The real burn is value + Circle's `maxFee` (7 USDCx at today's 2 USDC).
- **The probe was below the Portal minimum:** it requested 1 USDC. In the separate Portal run, two 502s preceded a successful build. The three Portal builder requests were byte-identical, so wallet selection did not alter what that builder received; the cause of the 502s remains unconfirmed.
- **Wallet requirement** (whatever IOG answers): a release of at least 5 USDC, and a balance of at least value + `maxFee`.

## Portal build decoded (2026-10-06 18:06 UTC)

**How it was obtained:** the user first tried the Portal using Magic Money's VESPR/Backpack-compatible signing option; those builder calls failed. The user then switched to Magic Money's own sign-in, reached its signing prompt, and rejected the unsigned transaction. The HAR was decoded offline.
- **Not submitted:** no `/tx/submit-burn-tx` or `/tx/record-burn-tx` call. The built transaction `018c5011…ec0f` is not on chain (Blockfrost 404), and the USDCx balance is unchanged at 12.168868.

**Builder outcome:** the Portal's builder returned 502 at 18:05:41 and 18:06:05, then 200 at 18:06:20. All three captured Portal requests were byte-identical, including headers and Circle intent. The wallet-mode switch coincided with success but did not change the builder request. A slow builder or gateway timeout is possible, not established. Our separate 1 USDC probe was below the Portal's 5 USDCx minimum, so its 502 has a separate unresolved amount precondition.

**The unsigned transaction** (3,627 bytes, `is_valid` true), against questions 1–7:

| # | Finding |
|---|---|
| 1 Inputs | 3 inputs, **all the user's** (USDCx 1.359421 + 10.809447 and ADA). Empty `secondaryAddress` is enough when every UTxO sits at the primary address. 3 reference inputs (`76e8e5a5…#0`, `86c9f9a5…#0`, `d722c14b…#0`). |
| 2 Collateral | One input from IOG's service address; `totalCollateral` is 0.653358 ADA. The user's coins are not used as collateral. One collateral detail was raised privately with IOG. |
| 3 Witnesses | Pre-attached: exactly one vkey, the service key `e5d5e3df…`. `requiredSigners` is exactly the user's payment key hash. The wallet adds only its payment-key witness, merged without changing redeemers (the Danogo pattern). |
| 4 Commitment | Mint redeemer (tag 1) and reward redeemer (tag 3). Zero withdrawal from `stake_script d74de93a…`, the pinned burn validator. The intent shape matches the 60/60 public burns; `verifyXReserveCardanoBurn` passes every check except the user's witness, as expected for an unsigned transaction. |
| 5 Destinations | Not tested (Ethereum only). |
| 6 Validity | **No TTL and no validity start.** A signed burn never expires on Cardano; only Circle's `maxBlockHeight` (26192611) bounds the release. |
| 7 Fees | ADA network fee 0.435572. Mint is exactly −7.000000 USDCx = 5 value + 2 `maxFee`. **No operator fee output:** one output, the user's change (19.843383 ADA, 5.168868 USDCx, every other asset unchanged). |

**Checks the wallet needs before it may ever sign** (all on the decoded body, before signing):
1. Circle terms validated (`validatePreparedWithdrawal`); value, fee cap and recipient equal the user's approved terms.
2. Every spent input is the user's own.
3. The reference inputs are the pinned validator and parameter UTxOs, or are verified by their script hashes.
4. Exactly one output, to the user's own address. Net change is exactly −burn USDCx and −fee ADA, with every other asset preserved.
5. Mint is exactly the USDCx unit at −(value + `maxFee`); nothing else is minted.
6. Exactly one withdrawal: zero, from the pinned burn validator, with the reward redeemer carrying the exact intent bytes (the `verifyXReserveCardanoBurn` rules).
7. `requiredSigners` is exactly the user's key hash. Pre-attached witnesses are exactly the pinned service key. The wallet adds only its own witness; the redeemers and script data hash stay unchanged.
8. Collateral is not the user's, and `totalCollateral` is bounded.
9. ADA fee is at or below a ceiling the user approved.
10. Network is mainnet and `is_valid` is true.
11. Validity: absent today; the policy is a question for IOG.
12. The burn hash is persisted before submission, never re-burned, and tracked by `usdcx-burn-tracking.ts`.

**Magic Money approval prompt, from the user's screenshot** (separate follow-up):
- It warns "Uses collateral … a script failure can cost you that ADA", but the collateral is IOG's.
- It shows "-7,000,000 USDCx" in raw units instead of 7 USDCx.
- It labels a zero script withdrawal "Withdraws staking rewards".

**Signing option:** the two Portal failures used Magic Money's VESPR/Backpack-compatible option; the successful build used its own sign-in. The captured builder requests were identical, so the signing option did not change their contents.

## The 502s and wallet mode (resolved, 2026-10-06)

- **The three captured builder requests were byte-identical**, including headers: the same wallet info and the same intent from one Circle preparation. The wallet mode (VESPR-compatible vs Magic Money) therefore could not change what the builder received.
- **Timings:** the two 502s took 23.5 s and 14.0 s and returned empty bodies; the 200 took 9.3 s. This is consistent with a gateway timeout on slow builds, but IOG has not confirmed it.
- **The user re-checked and agrees** the wallet switch only coincided with a fast build.
- **Implication for the wallet:** a 502 from the builder is a retryable "no build", never evidence about a burn.

## Pre-signing validator (read-only, not wired)

`src/main/usdcx-burn-validate.ts` (`validateUsdcxBurnBuild`) checks an IOG-built unsigned burn against the journey's stored `burnTerms`, this wallet's addresses and payment key, and chain-resolved spent and collateral inputs. Missing or malformed required evidence returns a refusal. Reference-input identities remain an explicit IOG rule to confirm. It returns `signingEnabled: false` regardless of the result.

| Proven from the transaction | Pending IOG confirmation (`iog-rule`) |
|---|---|
| Terms are internally consistent: release value, recipient, value + fee cap = burn, depositor = this wallet | Preattached signatures verify for this transaction and come only from the configured service key; IOG must confirm which key is authorized |
| Transaction is marked valid and uses mainnet addresses, with no certificates, governance, metadata or unknown fields | Collateral arrangement (service collateral and return) |
| Every spent input is resolved and is this wallet's | Which reference inputs are canonical |
| Mint is exactly −burn of the pinned USDCx | Validity policy (builds carry no TTL) |
| One zero withdrawal from the pinned burn validator, carrying exactly the approved intent | |
| Every output is this wallet's; inputs − fee − burn = outputs for every asset | |
| Fee within the approved ceiling; the only required signer is this wallet | |
| Collateral is never this wallet's, with a bounded total | |

**Tests:**
- **Public:** the public burn `887333810e…` and byte-swapped negatives.
- **Private:** the user's own unsigned Portal build. It is stored outside this public repo (`../private/`) and runs only where that file exists.
- **Mutation checks:** 10 of 11 guards fail their tests when removed. The pinned-script check is also enforced by the burn proof, as defence in depth.
- **Codex review:** malformed runtime terms now return a refusal, preattached Ed25519 signatures are verified against the transaction body hash, and the reference-input result does not imply IOG's unpublished identities have been checked. Focused tests 18/18; five-target typecheck and full 164-file/2425-test suite pass.
