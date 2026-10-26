# Desktop agent execution

The native-transfer engine supports **ETH on Ethereum (chain 1) and Sepolia (11155111), plus MON on Monad mainnet (143)**. Native transfers remain plain 21,000-gas transfers between externally owned accounts. [Monad execution](AGENT-MONAD.md) also adds a separate owner opt-in for fixed Emogotchi care calls and allowed pet token IDs. Other contracts/calldata, delegated EOAs, arbitrary tokens, swaps and rollups remain excluded from this agent engine. Rollup data fees need separate accounting before a full-cost ETH cap can be enforced. Optional [USDC x402](X402.md) reuses an isolated account address for externally settled Base payments, with separate explicit USDC rules. These desktop controls do not add execution to the extension or native mobile targets.

## Owner-approved sends

With a pairing that allows proposals, call `wallet_request_transaction` (CLI `request-transaction`) with:

```json
{ "requestId": "invoice-001", "chain": "ethereum", "recipient": "0xREPLACE_WITH_VALID_ADDRESS", "amount": "0.001" }
```

The result is a durable `pending-approval` record with an `id`. In Agent Access, **Review transaction** derives the sender, checks both addresses have no code, verifies the RPC chain, pending nonce and balance, estimates fees and simulates the transfer. It displays the full sender, recipient, exact ETH amount, maximum fee and maximum total. **Approve and send** signs and broadcasts those stored fields once. The review lasts 60 seconds; the request lasts at most 10 minutes and never beyond pairing expiry. Signing repeats simulation, balance, nonce and fee-ceiling checks. The signer decodes its signed bytes and recovers the sender before submission.

Poll `wallet_transaction_status` (CLI `transaction-status`) with `{ "transactionId": "RETURNED_ID" }`. `wallet_transactions` lists your records. `submitted` means a matching hash was returned, **not confirmation**. `confirmed` requires a matching transaction, receipt and canonical block; confirmations and `finalized` are separate. `unknown` means there is no verified outcome. Preserve the hash and **never create a new requestId to retry an uncertain send**. Duplicate requests return the same record; changed arguments under the same requestId are rejected. A consumed request is never signed or submitted again by this engine. An unresolved send from the same address blocks another send until reconciliation. A transport may hand identical signed bytes to another configured RPC endpoint; the transaction hash and nonce remain identical.

The existing `propose-transfer` / `propose-swap` commands remain form handoffs. Their `opened` state has no linked execution receipt. Use `request-transaction` for the new approval and receipt lifecycle. All commands use the existing exported adapter with `--connection FILE COMMAND --args-file FILE`. `tools` returns their authoritative schemas.

Recorded nonces are monotonic per sender and chain. A stale RPC nonce at or below a previous recorded transaction is rejected, even after that transaction confirms. An existing transaction hash cannot be attached to a different request. This prevents a stale node response from making one payment look like two.

## Autonomous isolated spending

Open **Authorize an autonomous spending account**. Select a paired assistant and **Spending network** (Ethereum/Sepolia ETH or Monad mainnet MON), allow 1–20 recipient addresses, set a per-send cap, rolling 24-hour cap, lifetime budget, maximum fee per send and expiry (1–480 minutes, bounded by the pairing). Enter the wallet password and click **Authorize isolated account**. Caps use exact amounts of that network's native currency and include transfer value **plus maximum gas fees**. Terms are immutable; agents cannot create policies or expand limits. Contract-only Monad policies may have no native recipients; their explicit pet token-ID rules are described in AGENT-MONAD.md.

Each policy reserves a separate BIP-44 account, starting at `m/44'/60'/1000'/0/0`, outside the normal account picker. It must have no current balance, nonce or code. Interrupted allocations are never reused. Its displayed address is backed up by the **same wallet seed**, not a new secret. Keep the displayed derivation path with your offline backup. Fund that address through a separate normal wallet transfer, with only the intended spending money. There are no automatic top-ups; the main account is unavailable for autonomous spending.

`wallet_spending_accounts` (CLI `spending-accounts`) returns the agent's policy IDs, addresses, recipients, limits and expiry. Call `wallet_send_autonomous` (CLI `send-autonomous`) with:

```json
{ "policyId": "RETURNED_POLICY_ID", "requestId": "bounded-send-001", "chain": "ethereum", "recipient": "0xALLOWED_RECIPIENT", "amount": "0.0005" }
```

The engine applies the same preparation/signature checks, checks permission again after asynchronous work, reserves full cost durably **before signing**, and records the precomputed hash **before broadcast**. Failed or uncertain attempts retain their reservation conservatively. Requests are serialized. Poll status with the returned ID; a few times a minute is sufficient (20 agent RPC calls/minute total). The wallet's status button provides the same reconciliation. There is no background agent or hosted monitor bundled with this feature.

**Stop account** and **Stop all autonomous sending** remain available while another operation awaits signing/RPC. Revocation, disabling Agent Access, expiry and app restart also stop policies. Locking or changing account/mode denies execution; returning can resume an otherwise active policy. A transaction already handed to the network cannot be recalled. Limits are enforced locally by the trusted wallet main process, not by on-chain session keys. OS/main-process/renderer compromise remains outside these limits. The app must be open and unlocked.

**Recover ETH** / **Recover MON** works after revocation or restart. It stops the policy, requires the wallet password, prepares a native transfer on the policy's original chain and requires **Approve and send** after review. Leave native currency for fees. This does not recover USDC or NFTs; these currently need manual recovery using the displayed seed derivation path in a trusted compatible wallet. An unresolved transaction blocks recovery from the same address/chain until reconciliation. For a damaged journal or permanently dropped transaction, preserve the journal and use the recorded seed derivation path for manual recovery; never delete evidence to reset limits or retry sends. Seed restoration elsewhere can reuse the same reserved paths, so check for previous activity and keep the account-path backup.

## Persistence and boundaries

The journal is OS-sealed and atomically flushed/replaced at `agent-access/execution.enc.json` inside app user-data. No seed, private key or signed raw transaction is persisted in it or returned through IPC/MCP. Missing OS secure storage, damaged journals and write failures block execution. Restart disables policies but preserves hashes and account paths. Bounds are 100 policies and 1,000 transaction records; there is no automatic deletion that could reset spending limits. Owner recovery stays accessible with Agent Access disabled.

The isolated accounts share seed custody with this wallet. They provide separate balances and spending authority, not a separate security domain against a stolen seed. Native IPC permits only the main wallet window/main frame. The agent transport cannot approve, create policies, recover funds, unlock or obtain ETH transaction bytes. The optional x402 tool returns only a fixed, request-bound USDC authorization. Read-only pairings cannot call execution tools even when bypassing tool discovery.

## Verification — earlier ETH milestone

The newer [Monad verification](AGENT-MONAD.md) and [x402 verification](X402.md) supersede these historical suite counts. The following records the original ETH milestone.

Final `CI=1 npm run verify:ci` passed with exit **0** on 2026-10-22, HEAD `24d088b8f8af2ba583008e1323d2b0a1498ca544` plus the uncommitted shared working tree:

- All five TypeScript targets; **184 unit files / 2,650 tests**, including **61 focused agent access, transport, policy and signing tests**.
- Fresh Electron, extension and injection builds. Full Playwright: **101 passed, 2 flaky passed on retry** (existing Sappy Seals and history repeat-visit checks), **1 existing skip**; browser runtime 15.4 minutes.
- Both agent Electron journeys passed first attempt. The execution journey covers real native derivation/signing, exact preview, returned hash/receipt, password denial, kill during password verification, isolated funding, allowed-recipient enforcement, duplicate protection, Stop and owner recovery after revocation. RPC submission is intercepted in a disposable public-seed fixture; this is **not live settlement**.
- Offline signing tests verify decoded sender, recipient, value, nonce, gas, gas price, chain and hash. Failure coverage includes lock/revocation/account change during signing, expiry, fee/nonce drift, stale nonce after confirmation, reused hash, disk failure, RPC timeout, contract/delegated addresses, damaged journals and restart behavior.
- Execution screenshots reviewed at 400/768/1200 widths. All **202 tracked PNGs plus generated app-hub source** hash-verified against pre-run contents; **9 generated PNG replacements** archived and originals restored. `git diff --check` passed.
- Production audit passed the critical threshold: **0 critical, 5 high, 4 moderate**. Dependency manifests/lockfile unchanged; remaining advisories need separate dependency review.

Evidence: `.local-artifacts/agent-execution/{verify-ci.log,verify-ci.exitcode,focused-tests.log,generated-restoration.json}` and screenshots. Earlier stopped gate logs are diagnostic only. On a desktop host without secure OS storage, the execution e2e verifies denial rather than bypassing storage or claiming positive send coverage.

**GitHub CI is pending for these uncommitted/unpushed changes.** No deployment, real-funds transfer, mobile execution or external security audit is claimed. New release QA rows remain pending in `docs/RELEASE-QA.md`; the owner controls any funding, live signing and broadcast.
