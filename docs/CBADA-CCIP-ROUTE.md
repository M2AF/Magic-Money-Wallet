# cbADA over Chainlink CCIP: discovery evidence

Date: 2026-10-05. This was read-only research. No transaction was signed or sent.

## Identities (pinned in `src/main/cbada-ccip.ts`)

| Network | cbADA | Decimals | CCIP pool | Router | Chain selector |
|---|---|---|---|---|---|
| Base | `0xcbADA732173e39521CDBE8bf59a6Dc85A9fc7b8c` | 6 | `0x8d8C266E08ac7a24A79b9d6A2ce32cE1d908c61F`, LockRelease 2.0.0 | `0x881e3A65B4d4a04dD529061dd0071cf975F58bCD` | `15971525489660198786` |
| Solana | mint `cbADAmv9issuPfhFwyQG3xac4DGPd1LDSt1oz7vwJsg` | 6 | `8CpyxupqVZupuFW3TtFwbokv8e5rQMv6irwuj5PPYrab`, BurnMint 1.6.2 | `Ccip842gzYHhvdDkSyi2YVCoAWPbYJoApMFzSxQroE9C` | `124615329519749607` |

Sources:
- the Chainlink CCIP mainnet directory: the cbADA token page and the Base and Solana chain pages;
- on-chain reads on Base.

The Base token reports name "Coinbase Wrapped ADA", symbol cbADA and 6 decimals. On Base:
- **The router:** reports that it supports the Solana selector.
- **The pool:** reports `LockReleaseTokenPool 2.0.0` for this exact token, with Solana supported.
- **The pool's remote token for Solana:** base58-encodes to exactly the Solana mint above.

**Lanes.** The directory lists Base↔Solana and Base↔Robinhood Chain. Each lane has an outbound capacity of 10,000,000 cbADA, refilling at about 115.74 cbADA per second. There is no Solana↔Robinhood lane, and Robinhood Chain is not a wallet network. The earlier rate-limiter read used a v1 getter and reverted. A read-only call with Chainlink's documented v2 `getCurrentRateLimiterState(uint64,bool)` getter succeeded on the Base pool for Solana with `fastFinality=false`; the wallet's send simulation now checks the live outbound bucket and fails closed if it cannot be read or lacks capacity.

## Live values (Base block 52,221,129, 2026-10-05)

- **CCIP fee:** `Router.getFee` quotes **0.00138465 ETH** (1,384,650,232,086,707 wei) for 10 cbADA Base → Solana, paid in native ETH. The quote was a token-only transfer to a Solana wallet using `SVMExtraArgsV1`.
- **Base pool balance:** **0 cbADA**. Because the Base pool is lock/release, a Solana → Base transfer releases cbADA the pool holds. With 0 locked, that direction cannot deliver today. The planner reads this balance and refuses when it is short.
- **DEX liquidity:** read-only quotes for 100 USDC:

| Pair | Out | Venue | Notes |
|---|---|---|---|
| Solana USDC → cbADA | 373.16 cbADA | Jupiter, Denali | impact 0.012% |
| Base USDC → cbADA | 372.24 cbADA | LI.FI, Nordstern Finance | gas about $0.009 |

  The reverse directions also quote.

## What the wallet does now

`src/main/journey-providers.ts` is a registry of route families: USDCx/xReserve, cbADA/CCIP, and a conditional Coinbase conversion. Each provider builds a candidate:
- The legs come from the wallet's existing swap quote path.
- Every cost is itemised. An unknown cost stays unknown, never zero.
- Refundable deposits are listed apart from costs.
- A fee ceiling is never treated as a cost.

`rankJourneys` lets only **executable and validated** candidates with **all costs priced** compete, through the shared routing policy. Everything else is a separate preview.

Today no candidate is executable. Remaining gaps, in order:

1. **CCIP send:** approve the router, `ccipSend` with an exact-message validator, persist the hash and the message id before or at broadcast, and prove destination credit independently.
2. **Solana → Base:** estimating its CCIP fee needs a Solana router simulation (not implemented), and the Base pool's release liquidity is currently 0.
3. **Journey persistence:** the state rules exist, but saving and restoring through platform storage must be wired before any execution.
4. **Coinbase conversion (native ADA ↔ cbADA):** needs a connected account and verified API support, fees, limits and eligibility. It stays a listed condition, never executable.
5. **The final output:** indicative after the bridge. The last swap is re-quoted from the measured credit.

## Build, simulate and recover (2026-10-05, second unit)

`src/main/cbada-ccip-send.ts` covers Base → Solana. It is build, validate and simulate only: `CBADA_CCIP_EXECUTION_ENABLED = false`, and no signing code exists.

- **Approval:** only when the allowance is short, and for **exactly** the amount, to the pinned router. An unlimited or misdirected approval is refused.
- **`ccipSend` validation.** Every field is re-derived from the calldata and pinned:
  - the router, the Base → Solana selector and exactly one cbADA amount;
  - no receiver program or payload, and the fee paid in ETH;
  - `SVMExtraArgsV1` naming the approved recipient;
  - `msg.value` equal to the quoted fee and within the caller's ceiling;
  - no extra bytes.
- **Simulation:**
  - **Lane:** checks support on the router and the pool, and that the router's OnRamp is still the pinned one.
  - **Balances and allowance:** reads cbADA, ETH and the current allowance.
  - **Transactions:** `eth_call`s the approval, and the send once the allowance exists.
  - **Message ID:** the ID the send simulation returns is indicative only.
- **Message ID:** the transaction hash is persisted to the journey **before** any broadcast (`recordSignedBridgeSend`). The CCIP message ID is read afterwards from the **confirmed** transaction's OnRamp `CCIPMessageSent` event (`messageIdFromReceipt`).
  - **Event checks:** the event is held to the lane, sender, pool, Solana mint, amount and recipient.
  - **Recovery:** the ID is recovered by the recorded hash after an interruption (`recoverBridgeReference`).
  - **Storage:** it is stored once and never replaced. An ID is never required before sending.
  - **Confirmation:** the event's topic and decoding were confirmed on live Base logs (OnRamp `0xee85aEfb…A7Ae`, block 52,216,007).
- **Solana delivery** (`verifySolanaCbAdaDelivery`) holds a Solana transaction to the message:
  - It must be the OffRamp's (`offqSMQW…cjm`) execution, with `ExecutionStateChanged` for exactly this message ID from Base in state `Success`.
  - The recipient's cbADA must increase by exactly the amount.
  - Layouts come from the published OffRamp IDL v1.6.4.
  - **A real mainnet `SkippedAlreadyExecutedMessage`** (a successful transaction that delivered nothing) is correctly rejected.
  - No Base → Solana cbADA delivery existed on chain to use as a positive fixture, so positive cases use events encoded to the IDL.

**Observation:** recent Solana → Base sends burned 70,000 and 100,000 cbADA, yet the Base pool holds 0. The release balance and the lane capacity must be re-read when quoting and immediately before any send.

## Journey storage and display

- **Journey storage** (`src/main/journey-store.ts`) is wired on desktop (atomic `journeys.json`), the extension (`chrome.storage.local`) and native (Preferences):
  - one write queue per process;
  - an unreadable record is reported and kept;
  - progress is enforced across saves: hashes and references are never replaced, confirmed steps never change, and finished journeys are never reopened;
  - active journeys are restored on every start, with the hashes listed for chain checks, never for re-sending.
- **Read-only channels:** `swap:journeyPlan` and `journey:list`.
- **DEX Swap** shows `JourneyRoutesPanel` for Cardano → Ethereum/Solana/Base and Base ↔ Solana:
  - a recommendation, only for executable, validated and fully priced routes, shown apart from previews;
  - previews with costs, with unknown costs named and deposits separate;
  - the reason each route is unavailable.

  It replaces the earlier USDCx-only preview, and USDCx is still previewed.

## Restored journeys and Solana delivery discovery (2026-10-05, third unit)

- **Route panel:** a lookup answers only the request it was made for. A response that returns after the pair or amount changed, or after the view closed, is dropped.
- **Journey list (`journey:list`):** returns only the **current wallet's** unfinished journeys, identified by the same public-address fingerprint swap sessions use. Other wallets' journeys are counted, never shown.
- **Recheck (`journey:recheck`):** re-reads each **sent** step by the hash saved before broadcast.
  - **Base and Ethereum:** the transaction receipt.
  - **Solana:** the signature status.
  - **Cardano:** Blockfrost's `valid_contract`.
  - **cbADA bridge step:** the message ID is recovered from the confirmed receipt (the hash must match) and stored once, then Solana delivery is searched.
  - **Safety:** it changes no step state and never re-sends. Another wallet's journey is refused.
- **"Journeys in progress" in DEX Swap:** re-reads storage whenever it comes into view. Its only action is "Check on chain", and it states that sent steps are never sent again.
- **Solana delivery discovery** (`src/main/cbada-solana-delivery.ts`) is discovery only:
  - **Search:** walks the recipient's cbADA token-account history, newest first, back to the Base send time.
  - **Decision:** every candidate is decided by `verifySolanaCbAdaDelivery`, the OffRamp's own event plus the exact credit.
  - **Not done:** an exhausted budget or failed read is reported as `incomplete`, and no account or no match as `not-found-yet`. Neither is ever reported as failed or refunded.
  - **Limit:** a failed execution may not touch the recipient's account, so it might not be found this way.

## Search completeness and guarded signing (2026-10-05, fourth unit)

**Delivery search completeness** (`cbada-solana-delivery.ts`), after Codex's review:

- **Accounts searched:** every current token account, with no cap, plus the recipient's **derived associated token account**. The CCIP pool delivers to the ATA, and an address's history survives closing, so a later-closed account is still searched.
- **Resuming:** a per-account cursor records the newest signature checked and where the older walk stopped. Each call first checks newer transactions (oldest first, so it can stop anywhere), then continues the older walk.
  - **No repeat work:** repeated budget exhaustion makes progress, and each transaction is read once.
  - **Within one run:** recheck keeps the cursor in memory, so repeated checks continue.
  - **After a restart:** the search starts again. It is still bounded and never reports "not delivered".
- **What it reports:** a failed read or exhausted budget is `incomplete`, with the cursor. An unreadable account list stays `incomplete` even if the derived account shows nothing.

**Guarded signing** (`src/main/cbada-ccip-execute.ts`): `sendCbAdaApproval` and `sendCbAdaBridge`.

- **Disabled:** `CBADA_CCIP_EXECUTION_ENABLED = false`, the flag is checked before any read, and no router or UI imports the module.
- **Gates, in order:**
  1. The journey step is approved for exactly these terms and has no transaction yet.
  2. Fresh reads: the router fee (it must not exceed the approved ceiling; the ceiling is not the expected fee), lane, OnRamp, allowance, and cbADA/ETH balances.
  3. Strict validation, then an `eth_call` simulation.
  4. Local signing, then the **signed bytes are decoded** and must equal the validated transaction on Base.
  5. The hash is **saved to the journey before broadcast**. If the save fails, nothing is broadcast.
  6. **One broadcast.** A failed or mismatched broadcast is recorded as `uncertain` and never retried.
- **Approval transaction:** its hash is stored once in the journey step (`approvalTxHash`). Its outcome is read from the allowance, and it is never sent again.
- **The Base pool's zero balance** limits Solana → Base releases only. A Base → Solana send locks cbADA into that pool, so it is not a gate.

## Approval of transfer terms (2026-10-05, fifth unit)

**What it does:** shows a plain Base cbADA → Solana cbADA transfer's live terms and, on the user's explicit approval, stores them as the journey's immutable authorization. It signs and sends nothing, and execution stays disabled.

**Where:** `src/main/cbada-ccip-approval.ts`, channels `journey:cbadaReview`, `journey:cbadaAuthorize` and `journey:cancel` (all targets; not reachable from dapp pages), `src/renderer/components/CbAdaTermsPanel.tsx`.

- **Review** reads, for this account's own Base and Solana addresses:
  - the router fee, the allowance, Base gas prices, and gas estimates;
  - the Base L1 data fee, shown as an estimate only;
  - the lane, OnRamp, pool token, live outbound rate limit, and cbADA/ETH balances, through `simulateCbAdaSend`.
- **Problems:** anything unreadable or short is listed, and any problem blocks approval.
- **Proposed ceilings** are maxima, never expected costs:
  - **CCIP fee:** the live quote + 10%.
  - **Gas per transaction:** estimated units × 1.5 × (2 × the current max fee per gas).
  - **Send before an approval exists:** it cannot be estimated (the router's `transferFrom` would revert), so its units are capped at 450,000. That is about twice the 222,219 gas used by a live Base → Solana `ccipSend` of another token (`__fixtures__/ccip/base-ccip-send-receipt.json`).
  - **Approval:** always priced, so a later approval stays inside an approved ceiling.
- **ETH check:** ETH must cover the fee ceiling plus every gas ceiling still to be spent.
- **Approve** takes only a proposal ID:
  - **Proposals** live in process memory for 120 seconds and are used once. The wallet, account and Solana address must be unchanged.
  - **What it creates:** a journey whose source and destination swaps are skipped, with the bridge step approved for the amount and `authorizeCcipBridge` storing sender, account, fee ceiling and both gas ceilings.
  - **Limit:** one active cbADA journey per wallet.
  - **The request cannot change a term:** the sender, amount and fee ceiling in it are ignored (tested).
- **Cancel** stops a journey only when no step has a transaction or an approval transaction.
- **Compatibility:** a test runs the guarded executor (test gate only) against an authorized journey. Every fresh check passes up to signing.
- **Live read-only review (Base mainnet, unfunded address):**
  - **Reads:** CCIP fee 0.001382 ETH for 1 cbADA; approval estimate 56,338 gas; max fee per gas 0.007 gwei; L1 data fee about 1.3–2.6 gwei (0.0000000013–0.0000000026 ETH) per transaction.
  - **Run one at a time:** the rate bucket held 10,000,000 cbADA, the OnRamp equalled the pinned one, and an approve `eth_call` succeeded.
  - **Within a full review:** mainnet.base.org rate-limited the parallel burst and base.llamarpc.com returned HTTP 525, so those checks failed closed as problems. In the app, the review uses the wallet's own transport (primary node first). A run on public nodes alone may need "Review again".
