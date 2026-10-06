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
