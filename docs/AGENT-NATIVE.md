# SOL/ADA agent execution

Desktop Agent Access supports `chain:"solana"` and `chain:"cardano"` for owner-approved native sends and separately funded autonomous spending accounts. Solana uses Devnet in Testnet Mode; Cardano uses Preprod. Read-only pairing cannot execute. Existing Ethereum/Monad tools and restricted contract rules remain in place.

## Use

Pair with request permission. `wallet_request_transaction({requestId,chain,recipient,amount})` creates an unsigned inbox request. Review shows the exact native amount, sender, recipient, fee, validity and request identity; **Approve SOL/ADA send** signs and submits once. `wallet_transaction_status({transactionId})` reconciles the stored identity with its canonical receipt; it never resubmits.

Create a SOL/ADA account in Agent Access with password authorization, explicit recipients, per-send/daily/total native limits, maximum network fee and expiry (1–480 minutes, bounded by the grant). Limits include the native amount plus fee. The assistant calls `wallet_send_autonomous({policyId,requestId,chain,recipient,amount})`; creation/funding/policy changes are not agent tools. The owner funds only the intended balance with a normal wallet transfer. There are no automatic top-ups. `wallet_spending_accounts` and `wallet_transactions` include EVM and native-chain records.

SOL native sends include a fixed Memo containing a wallet-generated transaction identity, so two intentional equal-amount sends within one blockhash window cannot silently share a hash. Retries keep the original identity. Native IDs use `native-` prefixes and CAIP network strings instead of invented EVM chain IDs. Amounts are exact integer strings (lamports9 decimals, lovelace6); no floating point, ticker identity or arbitrary transaction bytes. Same request and ID return the stored record. Changed requests fail. A signed/uncertain request is never automatically replaced; its budget stays reserved even if a provider reports failure.

## x402 is part of both integrations

Enable `MAGICMONEY_X402=1` at desktop startup. The same native accounts have explicit x402 rules: exact resource URLs and per-payment/daily/lifetime caps in **USDC on Solana** or **ADA on Cardano**. Parent recipients/expiry/Stop remain binding. Solana token budgets are separate from SOL budgets. Cardano x402 charges ADA value plus fees against the parent's native limits as well as the x402 budget.

Use existing `wallet_propose_x402_payment`, `wallet_x402_payments` and `wallet_x402_payment` tools with the native policy ID. In-policy payment signs automatically; a valid exception enters this same SOL/ADA inbox for one-payment approval. Never infer settlement from `authorized`, `released`, a facilitator response or HTTP200. See [X402.md](X402.md) for protocol shapes and the full threat model.

Solana builds only sponsor-paid classic SPL-USDC v0 TransferChecked + Memo, with bounded ComputeBudget and pre-existing valid ATAs. Sponsor pays fees and supplies its missing signature. Wallet simulates unsigned messages, not a redeemable credential. Payload is `{transaction:base64PartialTransaction}`. Pinned mints: mainnet `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`, Devnet `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`. Local retrieval expires within60seconds; actual on-chain validity is the recent blockhash window, not a programmable wall-clock deadline. No durable nonce or guessed transaction ID from the second signature.

Cardano uses only direct ADA (`asset:"lovelace"`) to Shelley key-payment base/enterprise addresses. Payload is `{transaction:base64SignedCbor, nonce:"inputHash#index"}`. Wallet selects the consumed input, signs a complete bounded-TTL transaction and releases it without broadcasting; facilitator submits. No Masumi/custom scripts, native-token payments, staking, certificates, withdrawals, mint or arbitrary CBOR. Accept timeouts15–300seconds; TTL is at most90seconds from preparation and within the request/grant/policy. Wallet verifies fresh tip, exact genesis magic, live fee/minimum-ADA parameters, exact merchant output/change and value conservation. Unknown or token-bearing inputs are excluded.

## Persistence, Stop and recovery

`agent-access/native-execution.enc.json` is atomically sealed by real OS secure storage. Corruption/unavailable storage fails closed; preserve journals. Audit has client/time/operation/outcome only, with no arguments, keys or credentials. Reserve full budgets and input identities before signing; native transaction hash is persisted before submission. Stop remains available while RPC/signing is pending. Stop all, account Stop, revoke, Disable, expiry, lock, account/mode change and restart block further authority. Issued transactions/signatures cannot be recalled.

Account indices start1000 on distinct chain derivations, backed by this wallet seed:

- Solana: `m/44'/501'/accountIndex'/0'`.
- Cardano: payment `m/1852'/1815'/accountIndex'/0/0`; stake credential `.../2/0`.

**Recover SOL/ADA** stops the account, requires the owner's password, prepares an exact native recovery transaction and requires review/approval. It works after pairing revocation. Leave enough for fees and recipient/change minimum funding. Cardano only spends pure-ADA inputs, preserving token/NFT inputs. Solana USDC needs manual recovery using a trusted wallet supporting the displayed seed path; native recovery does not sweep tokens.

Input locks are conservative: released/uncertain Cardano x402 inputs stay reserved against later agent/recovery transactions, even after local time expiry. The wallet never resets budgets or unlocks spendable authority based on an unverified facilitator claim. Manual seed-path recovery or future canonical reconciliation may be needed for a locked input. This trades availability for avoiding double-issued payments.

Native SOL receipts compare exact original serialized message, identity, fee and canonical block membership. Cardano compares exact body hash/CBOR, transaction/block identity and canonical provider block, requiring400 confirmations for finality. A source RPC remains a trust dependency; this is not a light client. Solana x402 settlement tracking requires the sponsor's final transaction ID and is not inferred from its unsigned first-signature slot.

## Local verification — 2026-10-27

`CI=1 npm run verify:ci` completed with exit **0**, on HEAD `22c10e192ab06d7b78b21dd88dff5009c2320178` plus the shared uncommitted working tree:

- All five TypeScript targets and **192 unit files / 2,862 tests** passed. The focused agent/security set passed **220 tests in 10 files**.
- Fresh Electron, extension and injection builds passed. Full one-worker Playwright: **106 passed, 1 existing currency skip**, **no retries needed** (18.6 minutes). Pairing/CLI/MCP, ETH, Monad/Emogotchi, SOL/ADA and Base x402 journeys all passed first attempt. The new native journey passed in **14.7 seconds**.
- Disposable public-seed signatures and intercepted Devnet/Preprod RPCs exercised native owner approval, autonomous sends, durable identity/receipt checks, wrong-password/window denial, Stop during authorization, x402 automatic rules and one-payment exceptions, independent facilitator signature verification, replay rejection, exact-URL binding and Stop all. These results prove local behavior, not live settlement or resource delivery. No real funds or live-wallet signing/broadcast occurred.
- Reviewed SOL/ADA exception screens at **400/768/1200** widths: exact asset/recipient/URL/replay identity, fee, expiry and override disclosures remain readable without horizontal overflow.
- Production dependency audit passed the critical threshold: **0 critical, 5 high, 4 moderate**; manifests/lockfile unchanged. **1,231** tracked generated-asset hashes verified against the pre-run baseline; **29** generated PNG replacements archived and originals restored. `git diff --check` passed.
- GitHub base CI is **success** for that exact HEAD: [run40254402500](https://github.com/M2AF/Magic-Money-Wallet/actions/runs/40254402500). It does not verify these dirty changes. Feature GitHub CI: **pending (uncommitted/unpushed changes)**. Release, installation, native-device validation, funding and deployment remain separate and were not performed.

Evidence: `.local-artifacts/agent-non-evm/{verify-ci.log,verify-ci.exitcode,focused.log,e2e.log,generated-restoration.json,github-base-ci.json}` plus the native exception screenshots. Earlier stopped/failing logs are diagnostic only. The fixture's original rate-limit failure was corrected by removing redundant calls and the ineffective fake-clock override; the production20/minute limit was not changed. Real OS secure storage is required; Linux/other hosts without it verify denial instead of claiming positive signing.
