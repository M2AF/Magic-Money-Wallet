# Stablecoin routing execution plan

Research refreshed 2026-10-05. This replaces the interface-search-first next step in [the previous plan](CARDANO-MULTICHAIN-NEXT.md). No wallet was connected, transaction signed or funds broadcast during this research.

## Product flow

One wallet swap journey: **source token → source-chain stablecoin → destination-chain stablecoin → destination token**. For SNEK on Cardano to a Solana token, the intermediates are the exact Cardano USDCx unit and native Solana USDC. Show one progress view and request approval for each required spend. These are multiple transactions, with partial completion possible.

Reuse existing Cardano, EVM and Solana executors. Discover and quote the source and destination DEX legs while developing the bridge adapter; an unavailable bridge must not stop discovering those legs. Skip a leg when its input already is the exact intermediate asset. Unsupported liquidity or a bridge destination produces an explicit unavailable route, not a guessed conversion.

## Interface found

The [IOG Portal](https://usdcx.iog.io/bridge) now serves its frontend assets successfully. The following calls were extracted from its first-party deployed code. They are an observed integration surface, not a published, versioned third-party support contract.

IOG backend: `https://production-docker.usdcx.aws.iohkdev.io`.

| Operation | Observed interface | Evidence today |
| --- | --- | --- |
| Prepare withdrawal | Circle `POST https://xreserve-api.circle.com/v1/prepare-withdrawal` | HTTP 200 for synthetic Ethereum and Solana targets; no funds |
| Build Cardano burn | IOG `POST /tx/burn-usdcx` | Frontend expects `cborHex`; empty request reached schema validation (400); valid build not tested |
| Submit witnessed burn | IOG `POST /tx/submit-burn-tx` | Frontend request/response inspected; never invoked |
| Record already submitted burn | IOG `POST /tx/record-burn-tx` | Existing-hash helper inspected; never invoked; idempotency not established |
| Track withdrawal | IOG `GET /withdrawal-history/{cardanoAddress}` | HTTP 200; exact public burn linked to finalized Ethereum release |
| Track inbound | IOG `GET /history/{cardanoAddress}` and `/history/crate2/{cardanoAddress}` | Observed frontend calls; not end-to-end acceptance |

Observed build body:

```json
{
  "userWalletInfo": {
    "primaryAddress": { "paymentKeyHash": "<hex without 0x>", "stakingKeyHash": "<hex or null>" },
    "secondaryAddress": [],
    "reservedCollateral": []
  },
  "circleBurnIntent": "<Circle batches[0].encoded>"
}
```

The Portal signs the returned CBOR through CIP-30, merges wallet witnesses into the existing witness set, then submits:

```json
{
  "signedBurnTx": { "type": "Witnessed Tx ConwayEra", "description": "", "cborHex": "<signed CBOR>" },
  "localAddress": "<full Cardano address>"
}
```

Submission expects `transactionHash`. Existing-hash registration takes `{transactionHash, localAddress}`. History exposes `cardanoBurnTxHash`, `ethereumTxHash`, `amount`, `confirmations`, `status`, `lastError`, and `createdAt`; the tested response has no Circle withdrawal ID. Track by the exact burn hash, not the latest row or matching amount. Observed statuses include `awaiting_finality`, `collecting_signatures`, `submitting_to_circle`, `circle_processing`, `finalized`, `expired`, and failure states. Treat unknown statuses as pending/unrecognized, never success.

The browser UI presently offers Ethereum as its withdrawal destination. The preparation API can do more, but that does not prove the IOG builder/operator accepts every prepared destination. No public OpenAPI was found at the probed IOG `/openapi.json`, `/swagger.json`, or `/docs` paths. This is a bounded finding.

## Ethereum and Solana preparation

Use Circle's [official OpenAPI](https://developers.circle.com/openapi/xreserve.yaml). The Portal's request supplies `batches` with `token: "USDC"`, a decimal amount, `remoteDomain: 10004`, `remoteDepositor`, destination domain/recipient, and `useCircleForwarding: true`. The measured key-hash depositor form is `0x00000001` followed by the 28-byte Cardano payment key hash; script depositors remain unverified.

Ethereum preparation returned a direct domain-0 USDC intent. Solana initially returned HTTP 400 requiring `forwardingOptions.maxFee`. Adding the documented forwarding options yielded HTTP 200. Decoding the result showed:

- Outer withdrawal destination **Arc, domain 26**, token `0x3600000000000000000000000000000000000000`.
- Forwarding contract `0x28b5a0e9c621a5badaa536219b3a228c8168cf5d`, matching the [official Arc mainnet contract list](https://docs.arc.io/arc/references/contract-addresses).
- Nested `depositForBurnWithHook` targets **Solana, domain 5**, with the exact requested 32-byte recipient and amount.

The synthetic request used `forwardingOptions: {maxFee: "10.00", usesFastFinality: true}` solely to exercise schema preparation. This cap is **not** a recommended fee or a product default. Returned sample fees are time-specific. Decode and validate outer and nested terms separately, including every recipient, token, domain, contract, fee cap, finality threshold and hook. Do not broaden the existing Ethereum-only validator to accept arbitrary calldata. Validate the Solana recipient convention against Circle's contract and an authorized settlement before enabling it.

The existing `xreserve-withdrawal-prepare.ts` is Ethereum-only. Successful synthetic preparation does not prove a valid Cardano unsigned build, service collateral availability, Solana forwarding settlement, or wallet readiness.

## Independent public settlement check

The history endpoint linked public Cardano burn [`88733381…e86`](https://cardanoscan.io/transaction/887333810ea503013f1e17c503ed6e691940e177e82f88baa76d19409de76e86) to Ethereum release [`0x37dce9fa…5630`](https://etherscan.io/tx/0x37dce9fab6f48033691f841be3c783bd9154998054490d535795cac2876b5630).

An independent Ethereum RPC receipt check found status `0x1`, block 26125759 matching the canonical block hash, and exact pinned-USDC transfer credit of **2,800 USDC** to `0x720f28c62b844e7dd8705ab0a7651f3f575384f4`. The previously studied Cardano burn consumed 2,802 USDCx under terms of 2,800 release plus a 2 USDC fee cap. This verifies one public historical linkage; it is not Magic Money's transaction, an execution test, or a general fee rule. Provider `finalized` alone remains insufficient for journey completion.

Portable sanitized evidence: [probe evidence](evidence/usdcx-portal-2026-10-05.json). Raw assets and research helpers are ignored under `test-results/portal-interface/`; provider credentials must not be copied from frontend config.

## Implementation order

1. **Plan the complete journey and discover its DEX legs.** Add exact asset/network identities and a capability matrix. Compose existing quote paths; measure total cost including provider fees, gas, Cardano deposits and destination gas funding. Cardano arbitrary-token routes may require V2 multihop or a separate token→ADA leg; Danogo is ADA-side only. Fee-aware ranking is still needed. Display indicative final output and independently enforce each leg's minimum.
2. **Add the read-only IOG adapter and tracking linkage.** Parse bounded history responses, match exact burn hashes, correlate release hashes, independently verify destination credit and finality. Retain `executable: false`. Implement Ethereum first; add forwarded destination preparation as a separately validated type, initially not executable. The interface is found; do not spend another implementation unit merely searching for it.
3. **Establish and validate an unsigned burn build.** Confirm third-party access/support, request schema, collateral/witness responsibility, operator acceptance of forwarded intents, expiration, fee semantics and recovery rules. Obtain an approved sanitized unsigned example or explicit authorization for a valid build-only probe. Build a distinct pre-sign validator covering inputs/ownership, exact burn, intent commitment, outputs/change, fees, collateral, reference scripts, datum/redeemer and validity bounds. The current observed-burn proof is not that validator.
4. **Persist a parent journey around existing executors.** Store exact terms, hashes, leg state and measured credit; no keys, witnesses, CBOR or calldata. Preserve active pending journeys beyond generic session expiry. Save the known hash before submission. On restart poll that hash; never automatically rebuild, resend or burn again. A completed leg advances to a fresh quote/approval based on measured spendable proceeds. A failed destination swap leaves the credited stablecoin available and shows where it is held.
5. **Enable and verify one direction at a time.** Start Cardano USDCx→Ethereum USDC, then add source and destination DEX legs. Next verify Cardano→Solana via the fully decoded forwarding route. For reverse routes reuse inbound xReserve components and investigate the Portal's CCTP relay registration contract separately; testnet inbound success does not establish mainnet SOL/EVM relay readiness. Other EVM chains need their own exact domain/token/forwarding and settlement checks, not an all-EVM switch.

Work on steps 1, 2 and journey state can proceed without spending funds. Production signing waits for step 3's validated contract, not because route discovery is blocked by the burn.

## Acceptance

- Exact asset identities throughout; unsupported routes fail clearly; standalone address-to-address swaps remain intact.
- Ethereum preparation and Arc→Solana nested decoding have live-response fixtures plus mutation tests for wrong domains, recipient, token, contract, hook and excessive fees.
- Provider status cannot override a failed/noncanonical receipt or absent exact recipient credit. Solana verification pins the native USDC mint and checks the actual recipient/token-account ownership and credited raw amount.
- Unknown submission, restart, timeout, duplicate history rows, changed quote, insufficient gas and partial completion are covered. No automatic replacement transfer.
- No bridge signing through renderer-provided CBOR; existing security/alias seams preserved across desktop, extension, Capacitor and iOS.
- Run appropriate focused tests, five-target typecheck and required regression/build checks after implementation. Funded QA requires separate explicit authorization and independent chain verification.

Implementation handoff: [Claude prompt](USDCX-STABLECOIN-CLAUDE-PROMPT.md).
