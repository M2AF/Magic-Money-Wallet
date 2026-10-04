# xReserve gate 3 research — 2026-09-29

Read-only research for Cardano USDCx → Ethereum USDC. No request was sent to a withdrawal preparation, transaction building, signing, or submission endpoint.

## What the operator's current Portal does

The [IOG USDCx Portal bridge](https://usdcx.iog.io/bridge) currently loads [this first-party JavaScript bundle](https://usdcx.iog.io/_next/static/chunks/8084ddff25a91cc7.js). Inspection on 2026-09-29 shows this client sequence for a Cardano-to-Ethereum burn. This is observed frontend behavior, **not** a documented, stable third-party API contract.

1. It constructs a Circle request with one `batches` entry containing `token: "USDC"`, `valueExcludingFees` (a decimal string), `remoteDomain: 10004`, `remoteDepositor` (the Cardano payment credential formatted as 32 bytes), `finalDestinationDomain: 0`, `finalDestinationRecipient` (the Ethereum address left-padded to 32 bytes), and `useCircleForwarding: true`. It sends this to `POST ${xreserveApiUrl}/v1/prepare-withdrawal`. It reads `batches[0].encoded` as the burn intent and also reads `batches[0].messageHashToSign`. The latter is not visibly signed in this Cardano flow. [Source: Portal bundle](https://usdcx.iog.io/_next/static/chunks/8084ddff25a91cc7.js).
2. It sends `POST ${cardanoBackendUrl}/tx/burn-usdcx` with `{ userWalletInfo: { primaryAddress: { paymentKeyHash, stakingKeyHash }, secondaryAddress: [], reservedCollateral: [] }, circleBurnIntent }`. The current [Portal configuration bundle](https://usdcx.iog.io/_next/static/chunks/97e7cad71074aa8f.js) sets `cardanoBackendUrl` to `https://production-docker.usdcx.aws.iohkdev.io`. The client expects a `cborHex` response and calls it the unsigned Cardano transaction. [Source: Portal flow bundle](https://usdcx.iog.io/_next/static/chunks/8084ddff25a91cc7.js).
3. The Portal passes that CBOR to the connected Cardano wallet's `signTx(cbor, true)`, merges the returned witness set into the transaction, and submits the signed transaction via its backend helper. The exact submission helper's endpoint and response schema have not been established here. [Source: Portal flow bundle](https://usdcx.iog.io/_next/static/chunks/8084ddff25a91cc7.js).

The [Portal configuration bundle](https://usdcx.iog.io/_next/static/chunks/97e7cad71074aa8f.js) currently includes `withdrawal: { minAmount: 5, feeEstimation: 5 }`. These are mutable frontend values, not a fee quote or contract guarantee. The [Portal terms](https://usdcx.iog.io/docs/USDCx_portal_terms_of_use.pdf) say fees can change and describe IOG/Midgard attestation for burns.

## Integration decision

This proves the Portal has a concrete operator-assisted burn flow. It does **not** establish that its Cardano backend permits third-party wallet use or how to validate its unsigned CBOR.

### Correction after systematic documentation review — 2026-09-29

Circle **does publish** an [xReserve OpenAPI specification](https://developers.circle.com/openapi/xreserve.yaml), linked from its [complete documentation index](https://developers.circle.com/llms.txt). My earlier statement that Circle did not publish the withdrawal request and status schemas was wrong. The specification lists:

- `POST /v1/prepare-withdrawal`, which calculates transfer amounts and fees, generates safety-buffered `maxBlockHeight` and `maxFee`, and returns `batches[]` with `burnIntents`, `encoded`, and `messageHashToSign`.
- `POST /v1/withdraw`, which takes signed burn intents, signatures, the remote-chain `burnTxId`, and `useCircleForwarding`. The documented `409` response identifies an already active withdrawal for the same burn transaction.
- `GET /v1/withdrawal/{withdrawalId}`, which reports `created`, `verified`, `confirmed`, `finalized`, `expired`, or `failed`, along with the burn transaction ID and, where available, a forwarded transaction hash and failure reason.

The same [OpenAPI specification](https://developers.circle.com/openapi/xreserve.yaml) documents `PrepareBurnIntentInput` fields including `valueExcludingFees` or `valueIncludingFees`, `remoteDomain`, `remoteDepositor`, final destination domain and recipient, and `useCircleForwarding`. Its `ForwardingOptions.maxFee` is separate from `burnIntent.maxFee`. This is a published Circle-side interface and fee preparation mechanism for **withdrawals**, not an Ethereum-to-Cardano deposit quote.

Circle's [withdrawal tutorial](https://developers.circle.com/xreserve/tutorials/initiate-a-withdrawal-as-a-remote-blockchain) explicitly says it is for **remote blockchain partners**; developers and users are directed to the remote blockchain. It explains that the remote blockchain attesters sign `messageHashToSign`, that the burn amount must equal the sum of `value + maxFee` across prepared intents, and that the partner submits the signed intents and burn transaction ID to Circle. Thus an independent wallet cannot complete Circle's `/withdraw` step merely by signing its user's Cardano transaction; it needs the Cardano operator's attestation/signature path. Circle's generic [USDC-backed stablecoin specification](https://developers.circle.com/xreserve/concepts/usdc-backed-stablecoin-specification) recommends a burn interface and `minBurnSize`, but does not publish Cardano's specific validator, datum, or redeemer. The tutorial's prose uses a plural `/withdrawals/{id}` in one place and its examples differ from the OpenAPI shape; use the [OpenAPI path and schema](https://developers.circle.com/openapi/xreserve.yaml) as the published API reference and verify any implementation against current responses.

I found no IOG/Midgard-published Cardano `burn-usdcx` API schema, contract/datum/redeemer specification, or third-party integration terms in the [Portal](https://usdcx.iog.io/bridge) or [Portal terms](https://usdcx.iog.io/docs/USDCx_portal_terms_of_use.pdf) reviewed through 2026-09-29. Read-only GETs to the Portal backend's `/openapi.json`, `/swagger.json`, and `/docs` returned 404. This is a bounded finding; a private or differently located interface may exist.

Do not wire the observed `/tx/burn-usdcx` call into a signing path from the Portal bundle alone. The remaining supported-integration questions are: (1) whether the IOG backend accepts independent wallets and under what terms; (2) its versioned request/response schema, authentication, rate limits, and idempotency; (3) the Cardano validator/datum/redeemer specification needed for pre-signing validation; (4) how the IOG Cardano burn is handed off to Circle's documented `/withdraw` request, including who supplies the threshold signatures; (5) the Cardano-side fee/minimum and failure/recovery behavior; and (6) whether `useCircleForwarding` is required for Ethereum delivery.

Until those are answered, a user can use the [official Portal](https://usdcx.iog.io/bridge) for the reverse bridge, while the wallet can link to it and keep gate 3 marked external/unsupported. This is a product fallback, not an in-wallet cross-chain swap.
