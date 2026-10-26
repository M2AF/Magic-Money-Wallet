# Public CIP-113 observer fixtures

Captured 2026-10-14 via read-only Koios mainnet calls. These are public chain records, not the user's wallet data. No signing or broadcasting occurred.

- `registry.json`: `/address_utxos` at canonical registry `addr1w9yyuueazg40gnnpqxvghnz8a5np57h4cs78jl5f6c8rqagga85v8`, extended. Origin plus three registered policies.
- `params.json`: `/asset_utxos`, policy `3a511ec25af655c1aef31d0d9c0c6154eae7321045b1fa46fac55ecd`, asset name hex `50726f746f636f6c506172616d73` (ProtocolParams). Empty asset name is incorrect.
- `holding.json`: publicly documented DIS987 holder from the issuer's mainnet example and Cardanoscan. Captured one raw unit at the shared holding script.
- `history-tx.json`: `/tx_info` for public transaction `95020f0855e3bf88e7460d310deae68807ce53a999ec9490e3fb3d67a9f3637b`, `_inputs: true`, `_assets: true`. Includes actual inputs/outputs; reference/collateral data is not spend activity.
- `tx-cbor.json`: `/tx_cbor` for that same public transaction, including `valid_contract: true`. This status is bound to tx hash before projecting applied token balance changes. `tx_info` from this live instance omitted that field; absence is not success.

Upstream deployment record: cardano-foundation/cip113-programmable-tokens-platform at `ab75bd5d16f4c7d5e5a5ced54ec3bf3d5ff775ce`, `src/programmable-tokens-offchain-java/src/main/resources/protocol-bootstraps-mainnet.json`.

Core CBOR schema: cardano-foundation/cip113-programmable-tokens release v0.0.1 at `6b75ba3286b4692ca23059ff51285db357fb09c6`.

Tests synthesize a public base address to exercise credential derivation and rebind holder rows to test-wallet addresses in browser fixtures. Those are mocked observer scenarios, not evidence of private-key ownership or real settlement. The separate live observer probe uses the documented public credential; it proves read compatibility only.

Sources:
- https://github.com/cardano-foundation/cip113-programmable-tokens-platform/blob/ab75bd5d16f4c7d5e5a5ced54ec3bf3d5ff775ce/src/programmable-tokens-offchain-java/src/main/resources/protocol-bootstraps-mainnet.json
- https://github.com/cardano-foundation/cip113-programmable-tokens/tree/6b75ba3286b4692ca23059ff51285db357fb09c6
- https://libertum.io/en/blog/libertum-live-cardano-cip113-mainnet/
- https://cardanoscan.io/token/b025efe5b44b43ed154419c66b0efc9cf148fd98f464e261018c89e8444953393837?tab=programmable
