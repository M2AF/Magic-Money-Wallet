# Koios Preprod handoff for xReserve test tracking

Research date: 2026-09-30. Research only; no wallet code was changed. This is for the Sepolia -> Cardano Preprod test path. Mainnet behavior should stay unchanged.

## Why this is needed

The Blockfrost Starter workspace in the user screenshot has one project, already scoped to Cardano mainnet, and shows zero project slots left. Blockfrost assigns a distinct project ID per network; the `mainnet...` ID cannot serve Preprod. Do not delete or repurpose the existing project. Koios has a keyless public Preprod endpoint at `https://preprod.koios.rest/api/v1` ([Cardano provider guide](https://developers.cardano.org/docs/get-started/infrastructure/api-providers/blockfrost/get-started/), [Koios tiers](https://koios.rest/tiers.html)). Its public tier currently lists 5,000 requests/day and 100 requests/10 seconds; treat 429 and 504 as retryable provider failures.

## Existing wallet seams

- `src/main/xreserve-cardano-mint-locator.ts`: `CardanoMintReader` requires `addressTransactions`, `confirmedTransaction`, `transactionOutputs`, and `tip`.
- `src/main/xreserve-cardano-mint-audit.ts`: `UsdcxAssetReader` requires the matching asset-history method plus the same transaction, output, and tip reads.
- Both scanners expect ascending rows `{txHash, blockHeight, txIndex}` and store a `{blockHeight, txIndex}` cursor. The cursor may stay immediately before a verified mint and must survive restart.
- `src/main/xreserve-cardano-provider.ts` implements those interfaces with Blockfrost. Its output comparison deliberately excludes collateral-return outputs.
- `src/main/xreserve-inbound-status.ts` creates the two Blockfrost readers in `xreserveInboundReads`.
- `src/main/xreserve-testnet-deposit.ts` gets the pre-submission tip from `blockfrostMintReads` and blocks prepare/check without `blockfrostPreprodKey`.
- `src/main/cardano-koios.ts` already has keyless Koios POST helpers for balances/UTXOs/submit, but has no xReserve history/CBOR adapter. `src/main/chain-config.ts` already defines `TESTNET_KOIOS_URL`.
- The extension manifest has broad HTTPS host permission. `src/capacitor/fetch-guard.ts` leaves Koios on the native fetch path because it is not in the browser CORS allowlist. Check Electron `net.fetch` use rather than assuming Node `fetch` is reliable there.

## Koios API mapping

Source: [Koios Preprod OpenAPI v1.4.2](https://raw.githubusercontent.com/cardano-community/koios-artifacts/main/specs/results/koiosapi-preprod.yaml). Its [API usage section](https://raw.githubusercontent.com/cardano-community/koios-artifacts/main/specs/results/koiosapi-preprod.yaml) documents PostgREST `order`, `limit`, `offset`, and `Content-Range`; do not assume Blockfrost's `from=block:index` behavior.

| Wallet need | Koios request | Important response fields |
| --- | --- | --- |
| Tip | `GET /tip` | First row's `block_height` (also `block_no` in the live response) |
| Address history | `POST /address_txs` body `{ "_addresses": [address], "_after_block_height": height }` | `tx_hash`, `block_height`; **no transaction index** |
| Asset history | `GET /asset_txs?_asset_policy=<56 hex>&_asset_name=<remaining hex>&_after_block_height=<height>&_history=true` | `tx_hash`, `block_height`; **no transaction index**. Split the pinned full USDCx unit into policy and asset name. `_history=true` is needed for full history. |
| Transaction order and outputs | `POST /tx_info` body `{ "_tx_hashes": [hash], "_inputs": false, "_metadata": false, "_assets": true, "_withdrawals": false, "_certs": false, "_scripts": false, "_bytecode": false }` | `tx_hash`, `block_height`, `tx_block_index`, `outputs[]`. Each output has `tx_index`, `payment_addr.bech32`, `value` (lovelace string), `asset_list[]` with `policy_id`, `asset_name`, `quantity`. `collateral_output` is separate from `outputs`. |
| Full CBOR | `POST /tx_cbor` body `{ "_tx_hashes": [hash] }` | `tx_hash`, `block_height`, `cbor` |

Koios history defaults to newest first; request ascending block height. **The hard part:** neither history endpoint returns `tx_block_index`. Fetch `tx_info` for the returned hashes (prefer batches), verify the echoed hashes/heights, and sort by `(block_height, tx_block_index)` before passing rows to a scanner. A page can split a block. Do not advance the scanner's persisted cursor or return a false end-of-history until every relevant row in that block has been fetched, enriched, and sorted. Use explicit `limit`/`offset` and a bounded failure state if a block cannot be completed. Check `_after_block_height` and pagination behavior with live calls; the name alone does not establish inclusivity. If an API response is incomplete or inconsistent, throw a typed retryable provider error so the scanners return `unknown`.

For output cross-checking, concatenate `policy_id + (asset_name ?? '')` to form the native-asset unit, keep base-unit quantities as decimal strings, and compare only regular outputs to the CBOR. Do not include `collateral_output`. Do not skip `transactionOutputs` or relax the proof simply because Koios exposes CBOR.

## Live read-only observations

On 2026-09-30, with no credential and no signing/submission:

- `GET https://preprod.koios.rest/api/v1/tip` returned HTTP 200, an array whose first row included `block_height: 5238249`, `block_no: 5238249`, and `abs_slot: 135108417` at the time of the read. These values will change.
- `POST /address_txs?limit=2` for the public example address in Koios's own OpenAPI returned HTTP 200 with rows containing `tx_hash`, `epoch_no`, `block_height`, `block_time`, newest first; no `tx_block_index`.
- For public transaction `1e2c7a6b977cf72d08e66b6b30adccb49c02407872caf9a381309ba7ab7edce5`, `POST /tx_info` returned `tx_block_index: 0`, `block_height: 5238126`, and regular outputs with `tx_index`, `payment_addr.bech32`, `value`, `asset_list`. `POST /tx_cbor` returned the same transaction hash, block height, and a 460-character hex CBOR string.
- `POST /address_txs?order=block_height.asc&limit=3` with `_after_block_height: 5238126` still returned a row at height 5238126. Treat the threshold as inclusive in this observed case, but test the adapter's complete pagination contract before relying on it.
- No live Preprod USDCx mint fixture was identified in this research. Do not claim that the audit path has been checked against a live mint.

## Minimum acceptance checks for Claude's adapter

1. Keyless Koios selection makes prepare, tip capture, and later status reads work without a Preprod Blockfrost project ID. Keep existing Blockfrost selection and mainnet behavior intact.
2. Same-block histories spanning multiple Koios pages retain every transaction exactly once after a JSON cursor restart. Test the address locator and global asset audit separately, including a mint after earlier same-block transactions.
3. Batch `tx_info` enrichment cannot silently omit a row or misorder two transactions in one block. Wrong hash, wrong block height, duplicate/missing index, truncated page, 429/504, and timeout stay retryable `unknown`.
4. The returned output list agrees with the transaction CBOR; collateral output does not become a normal output.
5. Use injected fetch functions where platform-specific fetch is required; never send provider URLs, keys, or raw thrown messages to the UI.

