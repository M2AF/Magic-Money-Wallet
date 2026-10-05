# Cardano native asset ↔ other-chain asset via ADA

Research and implementation handoff, 2026-10-05. This is an alternative to the USDCx burn route, not an xReserve withdrawal. No code or live transaction was added for this route.

## Scope and current evidence

- Outbound: exact Cardano native asset → ADA through the existing Minswap order executor; after a measured fill, ADA → a supported destination asset through the existing SimpleSwap-first, ChangeNOW-fallback address-to-address exchange.
- Inbound: supported source asset → ADA on Cardano through the exchange; after the wallet independently measures spendable ADA credit, ADA → the exact requested native asset through Minswap.
- If the Cardano side is already ADA, skip Minswap. If the destination is ADA, stop after the exchange or Cardano order, as appropriate. Only expose a pair after both required legs are actually quotable at their respective stages. Minswap liquidity, exchange provider coverage, minima and provider availability limit the asset set; this is not a promise of every Cardano native asset.
- The existing `src/main/xchange-client.ts` tries SimpleSwap first, then ChangeNOW, and carries the selected provider from estimate through creation and status. `src/renderer/types/simpleswap-assets.ts` currently lists ADA but no native assets other than ADA. The exchange UI (`SimpleSwapWidget.tsx`) creates a deposit-address exchange and expects the user to fund it; it does not sign or send ADA. `ExchangeStatusCard.tsx` keeps the created exchange in component state and polls by ID while mounted. A composed route must persist the exchange ID, provider, terms and deposit address before funding; the current card alone cannot recover a closed or restarted journey.
- `src/main/cardano-swap.ts` distinguishes open, completed, refunded and unexplained Minswap orders. A filled order reports measured delivered units. An order transaction's confirmation is not a fill. A refunded or unexplained order must stop the journey.
- ChangeNOW's live public `active=true&flow=standard` list on 2026-10-05 exposed Cardano `ada`, `snek` and `night`; its read-only range API answered ADA→Ethereum/Solana USDC. Those responses establish possible discovery only, not a final quote or settlement. Sources: <https://api.changenow.io/v2/exchange/currencies?active=true&flow=standard>, <https://api.changenow.io/v2/exchange/range?fromCurrency=ada&fromNetwork=ada&toCurrency=usdc&toNetwork=eth&flow=standard>, <https://api.changenow.io/v2/exchange/range?fromCurrency=ada&fromNetwork=ada&toCurrency=usdc&toNetwork=sol&flow=standard>.

## Required journey state

Persist a parent journey bound to wallet/account, environment, direction, exact source and destination asset identities, final recipient, refund address and created time. Each leg has its own state and evidence: quote terms and expiry, approved raw amount, transaction or exchange ID, provider, submitted/funded status, on-chain hash, independently observed delivered asset and raw amount, and error or recovery state. Never store keys, witnesses or seed material.

Outbound sequence:

1. Quote and approve the native-asset→ADA Minswap order with its minimum, ADA costs and nonautomatic cancellation behavior. Use the existing pre-submit persistence and validation. Persist the parent leg before signing.
2. Wait for a **completed fill**, verify the delivered asset is ADA, and confirm spendable wallet UTxOs. Preserve an ADA reserve for the next transaction and normal wallet operation. Treat the actual available amount, not the first quote's estimate, as the next leg's input.
3. Obtain a **fresh** ADA→destination exchange estimate after the fill. Show its current minimum, expected destination amount, provider, refund address and deposit instructions. The user approves this second step separately. Persist the created exchange and provider before allowing funding. The existing exchange UI can guide a manual ADA send for a first slice; an automatic send needs its own reviewed Cardano transfer and crash-recovery path.
4. Track the provider's exchange state and independently check destination-chain credit to the approved recipient before saying the full route is complete. Provider `finished` alone is not proof that the wallet received the target token.

Inbound sequence:

1. Obtain a fresh source→Cardano ADA exchange estimate, create it only after approval, and persist the exchange ID and deposit instructions before the user funds it.
2. Wait for provider completion **and** an independently observed ADA credit to the exact wallet Cardano address at an adequate depth. A provider status alone cannot start the Cardano spend.
3. Quote ADA→requested native asset using the measured spendable ADA, after reserving network costs. Show a fresh Minswap minimum and obtain separate approval. Wait for the batcher fill and verify the exact destination asset and amount.

## Safety and recovery rules

- These legs are separate transactions. Never display a single guaranteed end-to-end rate or an atomic swap. Before the first step, show an indicative second-leg estimate only if clearly labeled as expiring and nonbinding; if the second route disappears, show the intermediate asset the user holds and recovery choices.
- No automatic next-leg signing, sending, exchange creation, replacement order or resend after a retryable/uncertain result. A known hash or exchange ID must be checked and resumed. A timeout is not evidence of failure.
- Bind Cardano native assets by full policy ID plus asset name; bind other-chain assets by network plus contract/mint. A ticker alone cannot identify an asset. Validate provider-reported deposit network, address and memo against the approved exchange before showing funding instructions.
- Keep source and destination account ownership explicit. The refund address must be on the **source asset's network** and confirmed by the user. Handle provider `failed`, `expired` and `refunded` separately; verify an actual refund before marking funds recovered.
- Show Minswap batcher fee/deposit, Cardano network fees, provider minimum/rate and any destination network costs as separate terms. The provider receives deposited funds during exchange processing; disclose that service risk. See <https://changenow.io/terms-of-use/changenow-terms> for one provider's published refund and KYC terms.

## Recommended first implementation slice for Claude

Implement a recoverable **guided** parent journey for native asset→ADA→supported destination asset, using the existing Minswap executor and exchange clients without changing their standalone flows. First establish the persisted journey/exchange record and restart behavior, then add a handoff after a measured Minswap fill that opens a fresh ADA exchange quote. Keep funding manual in this slice. Do not infer a fill from order confirmation or exchange completion from provider status alone. Add focused tests for a fill arriving after restart, amount below provider minimum, order refund/unexplained spend, created exchange surviving restart, provider failure/refund, wrong network/address, and a second-leg quote that expires before approval. Validate each platform's storage/IPC boundary and run the repository's typecheck and tests. Do not sign, broadcast or use real funds as part of implementation verification.

After that slice is stable, implement inbound separately; then consider a wallet-signed ADA deposit transfer only after independent pre-signing validation and pre-submit persistence. Keep the existing address-to-address UI and provider behavior intact throughout.
