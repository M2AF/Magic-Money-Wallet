# Cardano USDCx burn interface — research, 2026-10-05

Question: is there a **supported** IOG/Midgard contract an independent wallet can use to burn Cardano USDCx and release Ethereum USDC? Short answer: **not established.** No published builder/attestation contract exists in anything reviewed. What *is* established is the exact on-chain shape of every sampled mainnet burn, which is enough for a read-only proof of a burn that already happened (`src/main/xreserve-cardano-burn-proof.ts`) and nothing more. No signing, building, submission, `/withdraw` call, commit or deployment was done. Read-only GETs only.

## Answers to the five questions

**1. May independent wallets call the burn builder and operator handoff?** Not established.
- IOG's own description is operator-driven end to end: the user connects a wallet at the Portal and submits a burn request; "the system monitors finality, collects operator signatures, and submits withdrawal to Circle", about 2 hours, with 400 Cardano block confirmations before signing. IOG says it holds no keys and "cannot cancel, modify, or recover transactions". ([Essential Cardano Q&A](https://www.essentialcardano.io/article/usdcx-on-cardano-your-questions-answered))
- Circle's withdrawal tutorial assigns attester signatures and `POST /v1/withdraw` to the **remote-chain partner** ([tutorial](https://developers.circle.com/xreserve/tutorials/initiate-a-withdrawal-as-a-remote-blockchain)). Here that partner is the IOG/Midgard operator. A wallet never signs the operator hash.
- The [IOG launch post](https://www.iog.io/news/usdcx-on-cardano-is-live-a-new-chapter-for-stablecoin-utility) and the [first-week post](https://www.iog.io/news/usdcx-on-cardano-here-s-what-happened-in-the-first-seven-days) name DEX integrations (Minswap, Liqwid, SundaeSwap) and the Portal; neither links an API, repo, validator list or integrator terms. The [FAQ](https://usdcx.iog.io/faq) renders headings only.
- The [Portal terms PDF](https://usdcx.iog.io/docs/USDCx_portal_terms_of_use.pdf) (v25 Feb 2026) could **not be read** with the tools available (embedded-font text). Whether it permits third-party automated access is therefore unreviewed, not "no".
- Midgard (Anastasia Labs' L2) public material ([spec](https://anastasia-labs.github.io/midgard/midgard.pdf), repo issues) concerns the rollup, not the USDCx validators. Search snippets from the USDCx launch coverage describe Pentad and Midgard Labs as helping build, operate and secure the USDCx infrastructure (not independently confirmed on a primary page here). No USDCx contract source was found.

**2. Versioned schemas, authentication, fees, minimums, idempotency.**
- Circle: [OpenAPI](https://developers.circle.com/openapi/xreserve.yaml) declares **no** security scheme (nothing documented, not a guarantee of open access; `prepare-withdrawal` returned HTTP 403 from this machine on 2026-10-04, `GET /v1/info` returned 200). `POST /v1/withdraw`: `409` when the `burnTxId` already has an active withdrawal; no idempotency key. `GET /v1/withdrawal/{id}` is the only lookup — **no lookup or listing by burn hash**.
- IOG `/tx/burn-usdcx` (Portal backend `production-docker.usdcx.aws.iohkdev.io`): observed frontend behavior only ([gate 3 research](XRESERVE-GATE3-RESEARCH.md)); no schema, auth, version, rate limit or idempotency rule is published. Not called here.
- Fees observed on chain (see below): Circle `maxFee` = **2.000000 USDC in 60/60**; Cardano fee 327,917–579,908 lovelace; smallest burned `value` 6 USDC. The Portal's mutable `minAmount 5 / feeEstimation 5` is not a contract. Burn quantity is always `value + maxFee`.

**3. `remoteDepositor`, USDCx identities, validators, datum, redeemer, collateral, outputs.** Measured (not published), from 60 mainnet burns:

| Item | Observation (60/60 unless stated) |
| --- | --- |
| `remoteDepositor` (32 B) | `0x00000001` ‖ 28-byte **payment key hash** of the burning account; equals the credential of every input and of the single output. Script-credential depositors: **never observed** |
| Registered remote token | Circle [`GET /v1/info`](https://xreserve-api.circle.com/v1/info), Cardano domain 10004: `remoteTokenIdentifier` `0x9ea9794d…671dd6`. It is **not** a plain hash of the USDCx unit/policy/name (sha256/sha3/blake2b-256/blake2s/double-sha tried) — pin it, don't derive it |
| USDCx unit | policy `1f3aec8bfe7ea4fe14c5f121e2a92e301afe414147860d557cac7e34`, name `5553444378` |
| Mint redeemer | policy `1f3aec8b…`, `Constr 0 []` |
| Authority | zero-lovelace **withdrawal** from script stake credential `d74de93a7e4940462c4509f59c712889422506f8b63dcfd0c266dc7b` (`f1…` reward account). The redeemer for it is `Constr 1 [bytes(BurnIntent)]`, 524 bytes. The same hash is the first field of the `USDCXProtocolParameters` datum the transactions reference |
| BurnIntent | magic `070afbc2`; spec magic `ca85def7`, version 1, source & destination domain **0** (Ethereum), source contract `0x77777777dcc4d5a8b6e418fd04d8997ef11000ee`, destination contract `0x2222222d7164433c4c09b0b0d809a9b52c04c205`, source/destination token Ethereum USDC, source depositor = signer `0x866e992217e0bfb8371f9ad32a53dcc47d1aa04e`, destination caller zero, hook: magic `6b20f62a`, version 1, remote domain 10004, remote token as above, remote depositor as above, forwarding contract zero, calldata length 0 |
| Amounts | `burned = value + maxFee` exactly; `maxFee` 2,000,000; `maxBlockHeight` is an Ethereum block ~8 days ahead in the sample |
| Reference inputs | 3 per transaction (protocol-parameters NFT `49b5b45b…` / `USDCXProtocolParameters`, plus script holders) |
| Body shape | 1–91 inputs, **1 output**, no validity interval, no metadata, no certificates |
| Collateral | 1 input from a single key `e5d5e3df…` in 60/60 (**not the user's**); collateral return pays the user. Matches the Portal's `reservedCollateral` field. So a second vkey witnesses every burn |

Not established: why the validator accepts these (script not audited), whether non-Ethereum or forwarded destinations produce other shapes, whether other depositor encodings are valid, and how a wallet would obtain the third-party collateral without the IOG backend.

**4. Burn → attestations → `/withdraw` → withdrawal ID → Ethereum transaction.**
- Documented: Circle's `/withdraw` takes the encoded intent, `burnSignatures` (≥2, operator multi-sig), `burnTxId` and `useCircleForwarding`; status via `GET /v1/withdrawal/{id}`: `created → verified → confirmed → finalized` (or `expired`/`failed`) with an optional forwarded transaction hash.
- Observed: the BurnIntent Circle needs is carried verbatim in the burn transaction's redeemer, so the wallet's `validatePreparedWithdrawal().encoded` can be matched byte for byte against the confirmed burn (this is what the new proof does).
- **Not established:** how a third party obtains the `withdrawalId` (no lookup by burn hash; the operator submits `/withdraw`, the Portal presumably shows it), and the final Ethereum transaction for a sampled burn. I scanned USDC `Transfer` logs on a public Ethereum RPC for the sampled burn `ba9ca8f9…` (intent recipient `0xb1f653c3…`, value 1,495.12 USDC) for the 6 hours after it and found **no matching transfer**; the forwarded hash may use a different path or amount. Not resolved.

**5. Recovery from an uncertain submission or failed operator step, without burning twice.**
- Nothing published. IOG says it cannot cancel or recover transactions; the Portal links to a history page (`usdcx.iog.io/history`) and a Discord support channel. Circle's tutorial says on `failed`: "resolve the issue and resubmit" (operator side).
- A Cardano burn is irreversible and Circle's `409` only protects *after* a burn exists. Therefore any wallet coordinator must: persist the known Cardano tx hash and terms **before** submitting (as the Minswap executor now does); on any uncertainty poll that hash and never rebuild or resend; never start a second burn while a first is uncertain; treat `expired`/`failed`/no `withdrawalId` after the observed ~2 h + 400-block window as "stop and escalate to IOG", not "retry".

## Public confirmed burn (fixture)

Cardano mainnet [`887333810ea503013f1e17c503ed6e691940e177e82f88baa76d19409de76e86`](https://cardanoscan.io/transaction/887333810ea503013f1e17c503ed6e691940e177e82f88baa76d19409de76e86), block 14027166: input held 2,863.526977 USDCx, the single output returns 61.526977, so **2,802 USDCx burned** = 2,800 USDC value + 2 maxFee, to Ethereum recipient `0x720f28c62b844e7dd8705ab0a7651f3f575384f4`; depositor key hash `0de0a107f07feebfcc64637534d669093fe4c7cfcff0488e3a8f9236`; fee 327,917 lovelace. Source: Koios `tx_info` / `tx_cbor`. The Ethereum release for this burn was not yet visible when checked (~3 h after the burn).

Other public burns from the same query (first of 1,155 negative-quantity mint events in `asset_history`, 2026-10-05): `3ad89a5ffa8eba65ebf5156fb67c79ba14de5a22ec4dd8c3a324d718e0ac98e4` (127 USDCx), `6ae7c3093b6f3c109610f373581286405b692b118183a0b9b0ece8c9d31a9759` (1,002), `ba9ca8f98f0966ad2c69ba064f6e8dc6801b543a478b09c09d130d5392ee9b39` (1,497.12). Sample of 60 spans 2026-09-25 → 2026-10-05.

No **sanitized unsigned** transaction was found: the Portal's builder response was not requested (not authorized, not a supported contract). Everything above is read from confirmed transactions.

## What was built

`src/main/xreserve-cardano-burn-proof.ts` (+ 20 tests, `.test.ts`): `verifyXReserveCardanoBurn({ terms, cardanoTx })` — pure, mainnet only, no network. It verifies that a **confirmed** transaction burns exactly `value + maxFee` USDCx (and nothing else), carries the prepared BurnIntent byte for byte in the single zero-withdrawal redeemer of the pinned validator, is valid, and is witnessed by the intent's depositor key. Typed outcomes: `verified`, `unrelated`, `failed-attempt`, `burn-conflict` (`carrier-ambiguous` / `wrong-withdrawal-script` / `extra-mint` / `burn-amount-mismatch` / `depositor-not-witnessed`), `evidence-unreadable`, `invalid-terms`, `unsupported-network`. Hostile-CBOR tests: bad id, truncation at every 19 bytes, trailing bytes, absurd lengths, 2,000-deep nesting, non-array roots, bodies without mint/withdrawal, malformed witness sets, a bit flip at every body byte (never verifies) and a byte flip everywhere (never throws). Four deliberate mutations of the checks each fail a test.

Limits (also in the file header): not a builder or signing rule; no chain-inclusion or depth proof (IOG waits 400 blocks); not an operator attestation; not a Circle withdrawal; not Ethereum delivery. Circle "finalized" and this proof remain **separate**, and neither completes a route alone. Five helpers in `xreserve-cardano-mint-proof.ts` were made `export`ed (no behavior change). The fixture's prepared terms are reconstructed from the transaction's redeemer because Circle prepare returned 403 here.

## Evidence boundary — what blocks signing

1. IOG/Midgard integrator terms and a versioned burn-builder contract (or permission to use `/tx/burn-usdcx`), including how third-party collateral is supplied.
2. The burn validator's source/spec, to know which transactions it *requires* rather than which it has *accepted*.
3. How a third party observes the operator's `/withdraw` and obtains the `withdrawalId`, and the Ethereum release linkage.
4. A documented recovery path for failed/expired operator steps.

Until then the supported fallback stays the [official Portal](https://usdcx.iog.io/bridge); the wallet may link to it and track a known burn read-only.
