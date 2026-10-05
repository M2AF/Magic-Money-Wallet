# Outbound USDCx bridge implementation — 2026-10-04

The native bidirectional bridge is **unfinished**. This unit implements the documented Circle side of outbound preparation and status. It does not enable a Cardano burn or mainnet deposit.

## Implemented in wallet code

- `src/main/xreserve-withdrawal-prepare.ts`: `prepareXReserveWithdrawal` calls the pinned mainnet/testnet `POST /v1/prepare-withdrawal`. Exact six-decimal destination amount, explicit burn-fee ceiling and a trusted remote depositor are required. It accepts only one direct Ethereum USDC transfer. It reconstructs the full binary BurnIntent, TransferSpec and WithdrawHookData from the response and checks the encoded bytes match, including lengths. A single-element BurnIntentSet is also accepted. Altered amounts, destinations, account, token, fee ceiling, domains, caller restrictions, forwarding calldata or extra intents fail closed.
- The result contains `burnAmountRaw = value + maxFee`, a transfer specification hash and the Circle source-domain block limit. That limit is **not a Cardano transaction TTL**. The amount excludes the separate ADA transaction fee. `executable` is always false. Circle's operator signing hash is not turned into a wallet signing request.
- `src/main/xreserve-withdrawal-status.ts`: `fetchCircleWithdrawalStatus` calls the documented singular `GET /v1/withdrawal/{withdrawalId}`. It checks the withdrawal ID, Cardano burn hash, exact one-element transfer specification hash list and forwarding flag. Provider statuses are reported separately from on-chain delivery. Even `finalized` returns `deliveryVerified: false`.
- `src/main/xreserve-ethereum-withdrawal-credit.ts`: a core-only, read-only proof checks the Circle-linked forwarded transaction against one trusted Ethereum RPC snapshot. It requires a successful receipt, matching transaction/receipt/block identities, the configured confirmation depth and an exact **net** USDC Transfer credit to the prepared recipient from the pinned USDC contract. Wrong tokens, recipients, amounts, removed/malformed logs and reorg-inconsistent snapshots cannot verify. It never changes Circle status or claims that the Cardano burn was proved.
- `window.wallet.xreserveWithdrawalStatus({ withdrawalId, burnTxHash, transferSpecHash })` reaches that status reader through Electron, extension and native wallet bridges. The privileged wallet configuration selects the environment. The caller cannot choose a URL/network, access a key, submit `/withdraw` or burn again through this channel. It is not exposed as page RPC. No automatic poll/replay loop was added.

Preparation is intentionally **not renderer-exposed**: the Cardano operator must first establish its remote depositor encoding and registered identities. Source contract/token/signer fields are byte-bound to the returned payload but are not yet approved semantic identities for signing. Status references are caller-supplied read-only lookup references, not proof that this wallet owns the withdrawal. Neither API result is a signing approval or persisted session. The destination credit proof has no production caller yet; a future coordinator must obtain a separate confirmed Cardano burn proof before calling a route settled. It proves credit in the forwarded transaction, not the recipient's current balance after later transactions.

## Verification boundary

The implementation follows [Circle's xReserve OpenAPI](https://developers.circle.com/openapi/xreserve.yaml), [BurnIntents.sol](https://github.com/circlefin/evm-gateway-contracts/blob/master/src/lib/BurnIntents.sol), [TransferSpec.sol](https://github.com/circlefin/evm-gateway-contracts/blob/master/src/lib/TransferSpec.sol), and [WithdrawHookData.sol](https://github.com/circlefin/evm-xreserve-contracts/blob/master/src/lib/WithdrawHookData.sol). Tests assemble an independent fixture by the published byte offsets, then alter identities, amounts, fees, lengths and bytes. Destination-credit tests use synthetic Ethereum receipt/log fixtures, including both pinned network profiles. These are not a successful live operator withdrawal.

A nonfunding testnet preparation request on 2026-10-04 returned HTTP 403 from this environment. Live Circle quote access has not been verified. The user-supplied [official Portal](https://usdcx.iog.io/bridge) opened successfully in the in-app browser; reversing the direction displayed Cardano → Ethereum with separate ADA network and USDC bridge fees. Its UI's approximate fee is not copied into wallet execution. Public Portal script retrieval was denied with HTTP 403; the page-asset export API did not support JavaScript assets. These failures do not establish whether authenticated integrators can access the service.

## Next implementation gate

Obtain the supported IOG/Midgard burn integration contract, using the Portal as the first-party starting point:

1. Establish the exact Cardano `remoteDepositor` encoding and registered remote token/validator identities. Do not assume the inbound recipient credential tag also describes outbound depositor encoding.
2. Establish a versioned unsigned burn builder, datum/redeemer/validator rules, amounts/minimums, ADA/collateral requirements and third-party access. The previously observed Portal `/tx/burn-usdcx` call remains an observation, not a supported signing contract.
3. Validate the full Cardano burn against prepared Circle terms; persist a known hash before broadcast; integrate operator finality/attestation and obtain the Circle withdrawal ID without replaying uncertain submissions.
4. Bind Cardano burn inclusion and an independently checked Ethereum USDC receipt to the same route. Circle status alone must never complete it.
5. Add Solana/other EVM forwarding only after verifying the exact returned forwarding contract, calldata, domain and destination token/mint. The initial direct-Ethereum adapter rejects these routes explicitly.

Existing testnet inbound mint evidence and mainnet inbound fee/minimum gates are recorded in `XRESERVE-TESTNET-QA.md` and `XRESERVE-PORTAL-INTEGRATION-HANDOFF.md`.

## Files in this unit

- Core and tests: `src/main/xreserve-withdrawal-prepare.ts`, `src/main/xreserve-withdrawal-prepare.test.ts`, `src/main/xreserve-withdrawal-status.ts`, `src/main/xreserve-withdrawal-status.test.ts`, `src/main/xreserve-ethereum-withdrawal-credit.ts`, `src/main/xreserve-ethereum-withdrawal-credit.test.ts`.
- Shared routing and types: `src/main/xreserve-testnet-handlers.ts`, `src/shared/xreserve-testnet-wire.ts`, `src/renderer/types/wallet.ts`.
- Wallet bridges: `src/main/ipc-handlers.ts` (comment only), `src/preload/index.ts`, `src/extension/wallet-handlers.ts`, `src/extension/bridge.ts`, `src/capacitor/wallet-local.ts`.
- Runtime regression: `e2e/xreserve-testnet.spec.ts`.
- Documentation/coordination: this file, `HANDOFF.md`, `HANDOFF_LOG.md`.

Pre-existing uncommitted Cardano swap-input and inbound progress work is preserved separately.

## Local validation

- `npm run typecheck`: all five targets pass.
- `npm test`: 140 files / 2,106 tests pass, including 52 preparation/status/router cases and 12 new destination-credit cases.
- `npm run build:extension`, `npm run build`, `npx vite build --config vite.capacitor.config.ts`, `npx vite build --config vite.ios.config.ts`: pass. Native Android/iOS compilation and live settlement were not performed; no native sources changed.
- `npx playwright test e2e/xreserve-testnet.spec.ts e2e/cardano-swap.spec.ts --workers=1`: three extension regression tests pass. The new real outbound status bridge rejects an invalid reference before HTTP. Successful status responses and network selection use provider fixtures in unit tests. Existing Cardano swap screenshot reviewed; this unit adds no UI.
- `git diff --check`: pass. No lint script is configured. Evidence: `.xreserve-withdrawal-*.log`, `.xreserve-credit-typecheck.log`, `.xreserve-credit-tests.log`; screenshot `test-results/cardano-swap-filled.png`.
