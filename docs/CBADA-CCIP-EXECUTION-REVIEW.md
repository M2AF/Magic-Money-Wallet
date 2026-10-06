# cbADA Base to Solana execution review

Reviewed 2026-10-05. This is a read-only review of the disabled signing path and a proposed first mainnet QA run. No transaction was signed or broadcast during this review. Claude's reported local validation is 160 files / 2,343 tests plus all target builds and 7 Cardano browser tests; this review did not repeat those runs.

## Current boundary

`cbada-ccip-execute.ts` has no production importer and `CBADA_CCIP_EXECUTION_ENABLED` is false. Its sequence is sound in outline: read current terms and chain state, validate, simulate, sign, save a hash, broadcast once, then recover by the saved hash. The first run must remain disabled until the bindings below are fixed and the app's approval flow is reviewable.

## Fix before wiring or funded QA

1. **Persist the full approved intent.** The journey records the bridge amount and recipient, but not the Base sender, CCIP fee ceiling, or total Base gas ceiling. `ApprovedCbAdaSend` supplies sender and `maxFeeWei` anew at call time. A caller could raise the fee ceiling after the user's approval without changing the stored journey. Save those terms in a closed, immutable schema at approval time, bind them to the current wallet/account, and require a fresh user approval for any change.
2. **Bind the signed bytes to their hash and sender.** `checkSigned` checks chain ID, destination, calldata, value and nonce, but `signPersistBroadcast` trusts `deps.sign().txHash`, and neither function recovers the transaction's sender. Compute `keccak256(serialized)` and compare it with the returned hash; recover the signing address and compare it with the stored approved sender before saving or broadcasting. Reject unsigned or malformed signatures. Bound the signed gas limit and gas price by what the user approved as well.
3. **Make the production flag non-bypassable.** The functions currently check an injected `deps.executionEnabled`; tests set it to true. No production caller exists yet. When adding one, an IPC argument or renderer state must never supply this flag. Keep a production-owned disabled gate until the reviewed integration deliberately changes it.
4. **Fail closed on unreadable pool identity and gas.** `simulateCbAdaSend` accepts `poolToken === null` when `poolSupports === true`; an unreadable `getToken()` should stop the send. Its ETH check covers the CCIP fee but not Base transaction gas. Recheck the pool identity and an explicit maximum network-gas cost before both approval and send.
5. **Account for approval recovery.** An approval hash is saved and cannot be sent again, but `journey:list` does not include `approvalTxHash` in its summary, and `recheckJourney` skips an approved leg with no bridge `txHash`. After an interruption between approval and bridge, the current UI cannot display or check that saved approval transaction. Add a visible read-only receipt/allowance check for pending, failed or uncertain approval and a deliberate recovery decision. A fee increase after approval must not silently change the authorized bridge terms. Do not offer a resend while a hash is unresolved.

The delivery search now includes the derived Solana associated token account and every currently held cbADA token account. Its cursor is in memory only; a restart rereads history. This is an efficiency and recovery limit, not evidence that a missing mint or transfer failed. A failed CCIP execution may never touch the recipient account, so absence from recipient history is never a failure verdict.

Chainlink's [CCIP Explorer documentation](https://docs.chain.link/ccip/v1/tools-resources/ccip-explorer) describes message-ID tracking; the wallet's OffRamp event and exact-credit proof must remain the settlement decision. Chainlink's [rate-limit documentation](https://docs.chain.link/ccip/evm/concepts/cross-chain-token/rate-limits/overview) says pool capacity can change on chain. The live pre-sign simulation must be rerun immediately before each send. The transaction hash can be recomputed from signed bytes with viem's [keccak256](https://viem.sh/docs/utilities/keccak256); viem also exposes `recoverTransactionAddress` in the installed package.

## Proposed first funded QA, after the fixes

Scope: one **Base cbADA to the user's own Solana cbADA account** transfer. No source or destination DEX swap in this first run. Use **1 cbADA** if the live lane, fee quote and simulation accept it; otherwise stop and revise the plan before signing. Do not use an arbitrary historical CCIP fee as the user's ceiling.

1. Show the user the exact Base sender, Solana recipient, cbADA mint on each chain, 1 cbADA amount, current CCIP fee, maximum CCIP fee, estimated and maximum Base gas for approval and send, and total maximum spend. The user approves those immutable terms. If the live fee exceeds the chosen ceiling, stop for a new review.
2. Confirm the source wallet holds at least 1 cbADA and enough Base ETH for **both** approval gas and send gas plus the CCIP fee. Confirm the Solana recipient belongs to this wallet. Read lane support, OnRamp and pool identities and the current rate limit; simulate the exact approval if needed.
3. If allowance is short, sign an approval for exactly 1 cbADA. Recompute the sender and hash from the signed bytes, save the hash, then broadcast once. Wait for a successful Base receipt and sufficient allowance. If the receipt or broadcast is uncertain, check the saved hash and stop; do not send another approval automatically.
4. Refresh fee, lane, balances, allowance, gas and simulation immediately before the bridge transaction. Validate the exact router, token, amount, lane and Solana recipient. Sign, recompute sender and hash, save the hash, then broadcast once. A mismatch, failed save or changed quote stops the run.
5. Confirm the Base receipt and exactly one matching `CCIPMessageSent` event, then save its message ID. Track the message ID in Chainlink Explorer for context and find the Solana candidate through the wallet. Count success only when the pinned OffRamp event for that ID and the recipient's exact 1 cbADA credit verify. Record both transaction hashes, the message ID, timestamps, paid fee, gas and final balances; record no keys or signed bytes.
6. If delivery is delayed or any provider is unavailable, continue **read-only** checks by the saved IDs. An execution failure or credit mismatch needs review. Do not make a second transfer to probe a delay.

This plan is **not authorization** for a funded run. The execution flag and app wiring stay off until the fixes, a current quote, and the user-approved test terms are reviewed together.

## Status of the fixes (Claude, 2026-10-05)

Local only. Nothing was signed or broadcast, and the execution flag is still off. `cbada-ccip-execute.ts` still has no production importer.

1. **Approved intent persisted.**
   - The journey carries an immutable `authorization`: sender, account index, CCIP fee ceiling, approval-gas ceiling and send-gas ceiling. It is set by `authorizeCcipBridge`, only for an approved, unsent cbADA step, and parsed under the closed schema.
   - `journey-store` refuses any later change.
   - The executors take no terms from callers. They read the authorization, and the current signer (address and account index) must equal it.
   - Changed terms need a new approval.
2. **Signed bytes bound.**
   - `keccak256(serialized)` must equal the reported hash.
   - The recovered signer must equal the authorized sender, so an unsigned transaction is refused.
   - Chain, destination, calldata, value and nonce are checked.
   - **Gas:** gas × max fee per gas must fit that transaction's authorized gas ceiling. Fresh `estimateGas` (+20%) and `estimateFeesPerGas` must also fit before signing.
3. **Gate.**
   - Execution needs an issued gate object, tracked in a module-private `WeakSet`.
   - `productionGate()` reflects `CBADA_CCIP_EXECUTION_ENABLED` (false).
   - `testOnlyEnabledGate()` throws outside Vitest.
   - A plain or JSON `{ enabled: true }` is never accepted (tested).
4. **Fail closed.**
   - `simulateCbAdaSend` reports an unreadable or mismatched pool token as a problem.
   - It requires ETH for the CCIP fee **plus** an explicit gas reserve: both ceilings before an approval, the send ceiling before the send.
   - Unreadable gas estimates stop the send.
5. **Approval recovery.**
   - `journey:list` shows `approvalTxHash`, and a restored approval counts as awaiting evidence.
   - `journey:recheck` reads the approval's receipt and whether the current allowance covers the authorized amount, read-only. A confirmed approval says the transfer itself has not been sent. A failed approval says it is not sent again and a new transfer needs a new approval.
   - The UI shows both. No resend exists.
   - A fee rise after approval stops the send against the stored ceiling.

**Validation:** typecheck on all targets; 160 files / 2,351 tests; desktop, extension, Capacitor and iOS builds; `e2e/cardano-swap.spec.ts` 7/7 (logs `.bind-*.log`). Mutation checks: an unissued gate, the signer, the hash, the pool token, the signer binding and the approval recheck each make their tests fail when disabled.

**Still open before a funded run:**
- An app approval flow that shows the full terms and creates the authorization. It is not built: execution is not wired to any router or UI.
- Your approval of a current quote and the exact test terms.

**Rate-limit correction (Codex, 2026-10-05):** the earlier reverted call used the v1 getter. Chainlink documents `getCurrentRateLimiterState(uint64,bool)` for v2 pools. A read-only call to the pinned Base pool with the Solana selector and `fastFinality=false` succeeded: outbound enabled, 10,000,000 cbADA available and capacity, refill 115.740740 cbADA/s at that block. `simulateCbAdaSend` now reads that live default outbound bucket and refuses an unreadable or insufficient bucket before signing. The state must be read again for each transfer; this observation is not a future capacity guarantee. The enabled execution gate remains unavailable in production.

**Approval-screen review (Codex, 2026-10-05):** the screen and privileged proposal flow bind the current wallet, amount, recipient, fee and gas ceilings. Review found one race: separate, valid proposals for the same wallet could each pass the active-journey check before either saved. Authorization now serializes that check with the save; a concurrent two-window regression permits one active journey only. The screen now shows full Base token, Solana mint and CCIP router addresses. Its cost row says "CCIP + gas cap" because the separately disclosed Base L1 data fee is estimated and uncapped. Typecheck passed on all targets; 21 approval tests and the cbADA popup browser test passed. Sending remains disabled and unwired. This review does not establish a current fee for the user's account, sufficient balances, or a successful transfer.

**Approval screen (Claude, 2026-10-05):** built; see `docs/CBADA-CCIP-ROUTE.md`, "Approval of transfer terms". It shows the live quote, sender, recipient, amount, CCIP fee ceiling, separate approval and transfer gas ceilings, the total maximum, and the L1 data fee as an estimate. It stores the terms through `authorizeCcipBridge` only on explicit approval of a single-use, 120-second proposal, identified by its ID alone. It signs and sends nothing; the execution flag is still off, and the executor still has no production importer. Still open before a funded run: the user's approval of a current quote and the exact 1 cbADA test terms, and the decision to wire and enable execution.
