# Cardano → other chains through NEAR Intents (1Click)

Built 2026-10-28. DEX Swap now quotes **ADA on Cardano → SOL or USDC on Solana, and ETH or USDC on Ethereum, Base and Arbitrum**. Delivery is by a NEAR Intents solver; no burn, bridge mint or IOG builder is involved.

## How it works

1. **Quote.** The wallet asks 1Click for a dry quote (`POST /v0/quote`, `dry: true`) and checks its signature.
   - The refund address is this wallet's Cardano address, and the recipient is this wallet's address on the destination chain.
2. **Approval.** The user approves the guaranteed minimum it shows (`minAmountOut`).
3. **Executable quote.** At signing, the wallet asks for the executable quote (`dry: false`), which carries a one-time Cardano deposit address. It is refused unless:
   - it verifies against 1Click's pinned quote-signing key (`ed25519:reYaWhvw…Vifc`, from `@defuse-protocol/one-click-sdk-typescript` 0.1.26);
   - every request field equals what was asked: ADA origin, destination asset, amount, refund address, recipient, slippage;
   - its minimum is not below the approved minimum;
   - it has no deposit memo;
   - its deposit address is a plain mainnet key address (base or enterprise; not this wallet's own);
   - the deposit address stays active for at least 20 more minutes.
4. **Payment.** The wallet builds and signs an ordinary payment of exactly the quoted ADA to that address, valid for about 10 minutes, then decodes what it signed. Exactly one output pays the deposit address the exact amount, with no tokens. Every other output returns to this wallet, and there is no mint, withdrawal or certificate.
5. **Record, then submit.** The coins are reserved, and the swap record (transaction hash plus deposit address) is saved **before** submission. The payment is submitted once and is never resent; an unanswered submission is recorded as uncertain.
6. **Delivery.** It is tracked by deposit address (`GET /v0/status`). 1Click's `SUCCESS` counts only once the destination transaction is **measured** on chain, on Solana or for an ERC-20, at or above the approved minimum. Native ETH payouts leave no Transfer event, so there the 1Click figure stands, as on every other cross-chain route. Refunds, failures and short deposits are reported as such.

## Custody and refunds (shown before signing)

Between payment and fill, the ADA is held at the deposit address by NEAR Intents' Proof-of-Authority bridge, not by the user. If no solver fills before the request deadline (30 minutes), 1Click refunds the ADA to the wallet's Cardano address, minus the quoted refund fee (0.2 ADA in live quotes).

## Fees

- **Magic Money:** no fee on this route yet. It needs a 1Click partner key (JWT) and a NEAR account for `appFees`.
- **1Click without a key:** an extra 0.25%. With a partner key it is 0.20%, or 0.01% on stablecoin pairs.
- **Payout fee:** already included in the quoted output.
- **Live, 2026-10-28:** 50 ADA → USDC on Ethereum cost about 3% in total; to Solana, about 0.5%.

## Limits

- **ADA only as the source.** Swap other Cardano tokens to ADA first.
- **Into Cardano is not enabled.**
- **Destinations:** the wallet's curated tokens only. Broad tokens stay blocked by the existing policy until NEAR Intents' minimum semantics are verified for them.
- **Dispute evidence:** the signed executable quote is not kept, only the deposit address and transaction hash.
- **Unresolved records:** a payment that never lands (its validity expired) leaves its record pending until reviewed. It is not yet marked "not sent" automatically.

## Evidence

- **Recorded fixtures:** real keyless 1Click responses in `src/main/__fixtures__/near-intents/`.
- **Tests:**
  - `near-intents-client.test.ts`: signatures, binding, deposit address, memo, deadline, token mapping, status.
  - `near-intents-swap.test.ts`: quote normalization, status, measured delivery.
  - `swap-executor-near-intents.test.ts`: real signing; record before submit; no resend; the real bind-and-execute path.
  - `e2e/cardano-swap.spec.ts`: "Cardano -> Solana (NEAR Intents)".
- **Mutation checks:** removing any of the 11 safeguards makes its test fail.
- **Live read-only run (2026-10-28):**
  - **SOL:** 10 ADA quoted to 0.01992 SOL (minimum 0.01972).
  - **USDC on Solana:** 10 ADA quoted to 2.0417 USDC.
  - **Pre-payment checks:** the executable quote passed every check. Its deposit address was never funded.
- **Not yet done:** a real-funds swap.

## Multi-step swaps (any Cardano token -> any token elsewhere)

`src/main/chained-swap.ts` (orchestrator), `chained-swap-handler.ts` (router), `ChainedSwapPanel.tsx` (screen).
Used when the pay side is not ADA, or the receive side is not the destination's native token / USDC.

- Hops: `cardano-dex` (token -> ADA, Minswap V2 / Danogo) -> `near-intents` (ADA -> native or USDC) -> `dest-dex`
  (Jupiter / EVM aggregators). Each hop is quoted on the previous hop's MINIMUM; each executes on the MEASURED output.
- One approval: the user approves the plan the wallet issued (`swap:chainStart` refuses any other plan id, 90 s TTL).
  The wallet then signs every hop itself. Between hops the funds sit in the user's own wallet.
- A fresh hop quote below its approved minimum pauses the swap; it continues only on "Continue at the new minimum".
  A locked wallet pauses, and the swap continues on unlock.
- The intent is saved before each execute. After a crash or error, the hop's swap record decides whether it was sent.
  A sent hop is followed, never resent. An unreadable record stops for review (`needs-review`), never resends.
- The last hop keeps a native fee reserve. At most one Magic Money fee, on the final DEX hop only.

Verified live, read-only (2026-10-28): 20 ADA -> BONK planned as NEAR (min 0.03956 SOL), then Jupiter selling 0.03656 SOL
(reserve kept), with a minimum of 1,165,229 BONK.

Limits:
- Hop 1 can use Minswap V2, Danogo or **SundaeSwap V3** (added 2026-10-28, see docs/CARDANO-SWAP-DISCOVERY.md). A token with
  no pool on any of these is still refused: the aggregator cannot exclude Minswap V1, and V1 has no validator.
- Quoting a Cardano-token hop needs the token in the wallet (Minswap build-tx checks the balance).

## Into Cardano, and the network list (2026-10-29)

Networks (`NEAR_INTENTS_CHAINS`, src/shared/swap-networks.ts), each quoted live in both directions:
Ethereum, Arbitrum, Optimism, Base, Polygon, Avalanche, Monad, Robinhood, Solana.
- **Not included:** Abstract (1Click refuses this wallet's EOA as refund and recipient) and Gnosis (no liquidity either way).

**Single swap** (native coin, or the pinned USDC, -> ADA): `quoteNearIntentsToCardano`.
- **Executor** (`executeNearIntentsDeposit`):
  1. the quote must name this wallet: refunds to its source address, payout to its Cardano address;
  2. the live quote is signature-verified and held to the approved terms;
  3. the deposit address is checked for the source chain (`checkDepositAddress`);
  4. the wallet builds the transfer itself: native value, or an ERC-20 `transfer` of exactly the amount (on Solana, SOL only);
  5. the chain's normal swap path signs and sends it.
- **Arrival:** measured on Cardano from the payout transaction (`measureCardanoCredit`).

**Multi-step** (`planIntoCardano`): `src-dex` (token -> USDC on EVM, -> SOL on Solana) -> `near-intents` -> `cardano-dex`.
- **Bridge assets:** the issuer's USDC is pinned per chain (`INTO_CARDANO_BRIDGE`) and matched against 1Click's list. USDC is used because its arrival is measurable from a Transfer event; a native EVM coin leaves none.
- **The last Cardano step is planned on an estimate** (`minswapPlanningEstimate`, no build: the ADA is not held yet). It keeps the order's fees and refundable deposit plus 0.3 ADA back. It is quoted, built and validated for real when it runs, and pauses if it then guarantees less.
- **Native-coin reserve:** a later step that sells a native coin keeps that chain's network fee back.

Live, read-only:
- **Native -> ADA:** ETH -> ADA on 5 chains, POL, AVAX, MON, SOL; Base USDC -> ADA.
- **ADA -> native:** POL, AVAX, ETH (Robinhood).
- **Multi-step plans:**
  - PEPE (Ethereum) -> ADA: 0x, then NEAR;
  - BONK (Solana) -> ADA: Jupiter, then NEAR;
  - MON -> SNEK: NEAR, then Minswap;
  - BRETT (Base) -> SNEK: 0x, NEAR, then Minswap.

Known gaps:
- On EVM the swap record is written right after broadcast (the pinned nonce is the recovery evidence), as for every EVM swap.
- The Worker change (both directions) needs a deploy.
