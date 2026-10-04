# Bidirectional Cardano / Solana / EVM swaps

Updated 2026-10-04. User authorizes implementation toward this goal; live signing, broadcast and deployment have not been requested.

The target is a wallet-owned sequence of swaps and bridge transfers, using Cardano USDCx and native USDC on supported destination chains as intermediate assets. Each intermediate asset must be identified by its policy/asset name, mint or contract and network, never its symbol alone. A completed source transaction is not proof that the destination tokens arrived.

## Current implementation unit

The Cardano Minswap order executor now saves its known transaction hash and approved terms **before** calling submission, and waits for the storage acknowledgement. An unavailable store, failed read or failed write stops submission with a preflight error. The bound intent is released only while nothing has been sent; once submission starts it remains single-use.

The session registry shares its first read across concurrent requests, serializes immutable snapshots and permits a later write after a failure. Desktop swap-session writes reuse the existing temp-file/fsync/rename helper with nested JSON values; extension and native Preferences stores propagate read/write failures. Malformed roots are rejected instead of treated as empty. There is no on-disk migration, dependency upgrade, new signing algorithm or new provider execution path.

Recovery evidence contains hashes, identities, raw amounts and approved terms, with no seed, key, witness, CBOR or calldata. The pre-submit record is conservatively uncertain: a process interruption after the save cannot prove whether the subsequent network call happened. Recovery polls the known hash; it never automatically resends or moves into the next bridge leg. A quote that expires during persistence is still refused before submission, although its prepared record can remain uncertain until reviewed.

This closes a recovery gap in the Cardano swap leg. It does **not** implement a composed multichain route, validate a new bridge, or establish real-funds readiness. EVM/Solana executor behavior and existing address-to-address swap flows retain their current paths.

## Route sequence to implement

| Direction | Proposed legs | Required evidence before continuing |
| --- | --- | --- |
| Cardano to EVM | Source token → USDCx; USDCx burn/release → native destination USDC; optional USDC → target token | Filled order and measured USDCx credit; supported Cardano burn/attester integration; destination USDC credit and finality |
| Cardano to Solana | Source token → USDCx; supported USDCx withdrawal → Solana USDC (or a separately supported intermediate route); optional Jupiter swap | Exact supported domain/asset route and destination recipient; burn and release proof; measured Solana USDC credit |
| EVM to Cardano | Source token → native USDC; supported xReserve deposit/mint path → USDCx; optional Cardano order | Deposit terms/fee bounds; source receipt linked to attestation and Cardano mint; measured recipient USDCx credit |
| Solana to Cardano | Source token → Solana USDC; supported stablecoin route → xReserve → USDCx; optional Cardano order | Verified upstream USDC route, fees and domains; xReserve evidence; measured recipient credit |

These are separate transactions, with separately expiring quotes. They cannot be presented as atomic or guaranteed end-to-end fills. Requote and obtain fresh approval before each later spend; use the **measured spendable proceeds**, not the original estimate, as its input. Preserve a parent journey and per-leg evidence so a partially completed route clearly shows which asset is held on which chain. A failed or uncertain leg pauses the journey; it does not trigger an automatic replacement transfer.

Skip unnecessary conversions when the source/target already is the exact intermediate asset. Display network gas reserves, order deposits, bridge charges and each minimum separately. Never describe the difference between total mint and recipient credit as a fee without proof of the other outputs.

## Provider evidence and remaining gates

- The current [IOG Portal](https://usdcx.iog.io/) advertises USDC deposits from Ethereum/Solana and withdrawals through CCTP/Gateway to supported chains. That establishes product capability, **not** a third-party transaction-builder contract. The wallet needs the supported IOG integration schema, Cardano burn validation specification, attester handoff and failure/idempotency rules. See [gate 3 research](XRESERVE-GATE3-RESEARCH.md). Public documentation review on 2026-10-04 did not locate that contract; this is a bounded finding.
- Circle's [published OpenAPI](https://developers.circle.com/openapi/xreserve.yaml), reread on 2026-10-04, lists withdrawal preparation and status, but no deposit quote endpoint. Do not invent one or reuse a withdrawal fee response for an inbound deposit. Existing Sepolia → Preprod verification is recorded in [testnet QA](XRESERVE-TESTNET-QA.md); it is not mainnet or reverse-direction acceptance.
- Wanchain's documented [pair discovery](https://docs.wanchain.org/developers/wanbridge-api/1.-information-retrieval) was probed through `GET https://bridge-api.wanchain.org/api/tokenPairs` on 2026-10-04. Its default response returned 470 pairs whose chain labels did not include Cardano/Solana. This does not establish that other bridge interfaces lack support, but it cannot authorize a Cardano/Solana route. Need an explicit supported pair, asset identities and non-EVM transaction interface before integration.
- DexHunter remains an additive quote comparison candidate beside Minswap. [Evaluation](DEXHUNTER-EVALUATION.md) identifies partner access and sanitized quote/build samples as the next evidence gate; split routes need independent validators and order tracking. No unauthenticated price or guessed minimum can enable execution.
- EVM/Solana route discovery already exists in `swap-proxy.ts`; verify the exact native-USDC pair and normal provider path when composing a bridge leg. Provider discovery is not settlement acceptance.

## Next concrete work

1. Obtain supported IOG/Midgard integration documentation for the Cardano burn and deposit-fee path, plus sanitized unsigned examples. Match every output, mint/burn, datum, redeemer, fee and recipient against approved terms before adding a signing path.
2. In parallel with interface research, compare authenticated DexHunter quotes against Minswap for exact ADA/USDCx amounts, output floors and total order cost. Keep Minswap executable while that provider remains unverified.
3. Add the parent journey only around supported legs, with crash recovery, observed destination credit, fresh per-leg approval and a clear partial-completion screen. Reuse shared core/storage alias seams across all four targets.
4. Validate each direction independently. Existing release QA must be updated after an authorized real transaction changes a send path; passing local tests and web bundles does not sign off native builds or live settlement.

## Local validation

Regression tests exercise real test-key signing with mocked network boundaries: a delayed pre-submit save, failed/missing storage, load failure and retry, uncertain submit followed by failed later saves and restart, expiry during storage, concurrent snapshot ordering, bound-intent retry/replay gates, platform storage errors and interrupted desktop file replacement. Exact commands and results are recorded in the root handoff journal and local `.swap-recovery-*.log` files. No real wallet seed or funds are used.
