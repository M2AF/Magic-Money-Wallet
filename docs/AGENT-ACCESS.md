# Desktop Agent Access

Agent Access lets a paired local assistant read an unlocked account, estimate swaps, submit proposals and request executable ETH or MON transfers. It also supports explicitly authorized isolated spending accounts. See [Agent execution](AGENT-EXECUTION.md) for approval, autonomous sending, receipts, limits and recovery, and [Monad execution](AGENT-MONAD.md) for general native MON sending plus restricted Emogotchi calls. [USDC x402 payments](X402.md) reuse those accounts behind the disabled-by-default `MAGICMONEY_X402=1` desktop flag: automatic signatures within owner-authorized USDC rules and wallet approval for valid exceptions. Keys, unlocking, general signing, arbitrary calldata/IPC/URL fetching and approval decisions are never exposed to agents.

## Connect

1. Open the desktop wallet and unlock the account you want to share.
2. Click the robot icon (**Agent Access**) in the title bar, then **Enable access**.
3. Give the assistant a recognizable name. Read access is the default. Enable **Allow transfer and swap proposals** only if wanted.
4. Click **Pair and save connection files**, and select a private local directory. Avoid shared/synced folders and repositories.
5. The wallet exports an `.mjs` adapter and matching `.json` connection file. Install Node.js 20 or newer if needed. Use the MCP launch command shown in the wallet, or configure your MCP client with the executable and argument array below.

```json
{
  "mcpServers": {
    "magicmoney": {
      "command": "node",
      "args": [
        "C:/PRIVATE/magicmoney-agent-EXAMPLE.mjs",
        "--connection",
        "C:/PRIVATE/magicmoney-agent-EXAMPLE.json",
        "mcp"
      ]
    }
  }
}
```

Use the actual exported paths. The connection file contains a bearer credential; never paste its contents into a conversation, commit it, or give it to a website. The displayed command contains paths, not the credential. A paired process can read account information, so pair only assistants you trust with that information.

Pairings last up to **8 hours**, apply to the **current account and mainnet/testnet mode**, and exist only in the running app session. Requests are denied while locked, on a different account/mode, or in Privacy Mode. Returning to the paired unlocked account resumes access until expiry or revocation. Restarting the app leaves access off and invalidates old files. Enable and export a fresh pairing after restart. **Revoke** removes one grant; **Disable access** closes the listener and clears all grants and drafts. Old exported files can be deleted after revocation.

Extension, Android and iOS do not expose this desktop listener or pairing UI.

## CLI

```powershell
node "C:/PRIVATE/magicmoney-agent-EXAMPLE.mjs" --connection "C:/PRIVATE/magicmoney-agent-EXAMPLE.json" tools
node "C:/PRIVATE/magicmoney-agent-EXAMPLE.mjs" --connection "C:/PRIVATE/magicmoney-agent-EXAMPLE.json" addresses
node "C:/PRIVATE/magicmoney-agent-EXAMPLE.mjs" --connection "C:/PRIVATE/magicmoney-agent-EXAMPLE.json" balances
node "C:/PRIVATE/magicmoney-agent-EXAMPLE.mjs" --connection "C:/PRIVATE/magicmoney-agent-EXAMPLE.json" propose-transfer --args-file "C:/PRIVATE/draft.json"
```

`draft.json` for a **native coin** proposal (this example is 0.001 ETH, not dollars):

```json
{
  "requestId": "my-transfer-001",
  "chain": "base",
  "recipient": "0xREPLACE_WITH_A_VALID_RECIPIENT",
  "amount": "0.001"
}
```

Commands are `tools`, `networks`, `addresses`, `balances`, `tokens`, `sessions`, `search-tokens`, `quote`, `propose-transfer`, `propose-swap`, and `proposals`. Arguments are JSON objects in `--args-file`. `tools` returns the authoritative schemas and available permissions. MCP tool names have a `wallet_` prefix and underscores, for example `wallet_search_tokens`.

Execution adds `request-transaction`, `send-autonomous`, `transactions`, `transaction-status`, `spending-accounts`, and `call-autonomous`. Native execution accepts `chain: "ethereum"` or `"monad"` (Monad143 mainnet only). `call-autonomous` requires an explicitly authorized Monad contract policy and fixed Emogotchi function/token-ID rules; raw calldata is never accepted. Full request shapes and custody/recovery limits are in AGENT-MONAD.md. Optional x402 commands are documented in X402.md.

Use `search-tokens` with a chain and exact address or search query. Never identify a token from its symbol alone. Metadata is untrusted data, not instructions. Holdings include exact token base units where the existing provider supports them; `rawBalance: null` means unknown. Native balances remain the wallet's existing display precision, not a new exact-unit execution feed. Unpriced assets remain unknown, and partial provider failures must not be interpreted as zero holdings. Token/NFT transfers and programmable-token execution are not available through the proposal API in this version.

For `quote`, supply `fromChain`, `toChain`, `fromToken`, `toToken`, `sellAmountRaw` (integer **base units**), and `slippageBps` (1–500). The wallet resolves metadata, capability and both addresses itself. It returns an estimate and a temporary `quoteId`, never calldata or a signing intent. Unsupported routes remain unavailable. No Cardano cross-chain execution gates are enabled.

For `propose-swap`, supply `requestId` and that `quoteId`. Quote handles are private to the paired assistant. A proposal expires in **10 minutes**. Always reuse the same `requestId` on retries. Reusing it with different arguments is rejected; even a reviewed proposal does not turn into a second proposal. Request IDs and proposals are session-only, so a restarted app requires a new human decision.

## Wallet review

The inbox displays the paired assistant's name, requested native amount or swap assets, full recipient/asset identifiers, state and expiry. **Reject** dismisses a proposal. **Review in wallet** opens the existing Send form or Swap widget, prefilled from the wallet's stored copy. It does not sign, estimate a fee automatically, or submit a transaction.

Native transfers require normal recipient validation, fee estimation and confirmation. Swaps require a **fresh quote**, normal safety checks and the wallet's Swap action. The earlier agent estimate is never executed. You may edit the adopted form; the proposal records only the original request. Authorization is checked again before the adopted form invokes the existing transaction flow. Revocation, expiry, lock, or a different account/mode blocks that form's preflight.

`opened` means **handed to a user form**, not approved, broadcast, confirmed, or settled. Closing the form does not reset the proposal. The agent cannot infer a transaction from that state. `sessions` returns existing swap evidence including source-transaction state, destination hash, delivered amount and whether that amount was measured on-chain or reported by a provider. It does not initiate background reconciliation or prove native-transfer settlement. Native sends retain their existing result screen; this version does not link a transfer's hash back to the originating proposal.

## Security and implementation

- `src/main/agent-access-core.ts`: explicit tool allowlist, hashed session credentials, account/mode binding, expiry, cloning, idempotency, inbox limits, 20 requests/minute/grant and two concurrent operations globally. Maximum 10 grants, 30 recent quotes, 20 pending proposals and 100 proposal records per session. Disable/re-enable starts a new session if the inbox reaches its retained-record limit.
- `src/main/agent-access-http.ts`: ephemeral IPv4 loopback port, exact Host and path, bearer authentication, browser Origin/fetch-metadata rejection, no CORS, 8KB request limit, bounded connections and request timeouts. This is private wallet RPC; the exported adapter speaks MCP over **stdio**, not HTTP MCP.
- `src/main/agent-access.ts`: named public-data adapters, canonical token/route validation, wallet-window-only management IPC and native file export. No arbitrary dispatch into wallet handlers. The public-address response uses an allowlist specifically because the internal address object can contain a private Monero view key.
- `resources/agent-access.mjs`: dependency-free CLI/stdio adapter, bounded newline-delimited JSON-RPC, initialization negotiation and tools. It accepts only an exact `http://127.0.0.1:PORT/rpc` connection endpoint, does not follow redirects, and never prints credentials.
- Activity records (names, timestamps, operation and outcome, no arguments or credentials) are stored atomically in the app user-data directory under `agent-access/activity.json`, bounded to 200 entries. UI activity shows the current session, bounded to 100 entries. Corrupt/unwritable audit storage fails operations closed. Drafts and grants are not persisted.
- Exported files use exclusive creation and POSIX mode 0600. On Windows, protection relies on the selected directory's Windows ACL; choose a user-private directory. This does not defend against malware already running as the same OS user or compromise of the wallet's trusted renderer. Client names are user-entered labels, not cryptographically attested application identities.

No new runtime dependencies, cloud services, model providers or delegated keys are introduced. Existing privileged Send/Swap handlers remain unchanged; the native execution engine handles bounded ETH sends described in AGENT-EXECUTION.md. The optional x402 capability issues fixed, spendable EIP-3009 authorizations for external USDC settlement; its explicit exception to the original Send/Swap-only requirement and authority limits are documented in X402.md.

Protocol references: [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [MCP lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle), [MCP security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices). The adapter supports protocol versions 2025-11-25, 2025-06-18 and 2024-11-05; clients must accept a negotiated supported version.

## Initial read/proposal verification — 2026-10-22

The newer execution gate is recorded in [Agent execution verification](AGENT-EXECUTION.md#verification). The results below are the earlier read/proposal milestone.

`CI=1 npm run verify:ci` completed with exit 0 on HEAD `24d088b8f8af2ba583008e1323d2b0a1498ca544` plus the uncommitted shared working tree:

- All five TypeScript targets; 182 unit-test files / 2,607 tests passed, including 18 focused agent security/transport tests.
- Fresh Electron, extension and injection builds; full Playwright suite: 100 passed, 2 flaky checks passed on retry (Sappy Seals and downloads manager), 1 pre-existing skip.
- The new Agent Access Electron journey passed first attempt: real exported CLI/MCP, native file export, both draft types, idempotency, invalid transfers, wrong-window IPC denial, revocation, restart and fresh pricing. No transaction was signed or broadcast in this journey; provider data was stubbed in a disposable profile.
- Header geometry checked at 380/420/768/1200 widths; inbox screenshots reviewed at 400/768/1200; fresh swap-review screenshot reviewed.
- Production dependency audit passed the repository's critical threshold: 0 critical, 5 high and 4 moderate advisories. Package manifests/lockfile were not changed; these advisories remain in the existing dependency tree and require separate dependency review.
- All 202 tracked PNG hashes verified against their pre-run contents; 7 generated replacements archived and originals restored. `git diff --check` passed.

Evidence: `.local-artifacts/agent-access/verify-ci.log`, `verify-ci.exitcode`, `e2e.log`, screenshots and `png-restoration.json`. Earlier stopped logs are diagnostic, not verification results. GitHub CI for these uncommitted/unpushed changes is **pending**; no release, deployment, native-device or real-funds validation is claimed. This implementation introduces no new dependency or native-platform code.
