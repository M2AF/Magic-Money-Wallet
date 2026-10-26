# C1 contract handoff to Claude

2026-10-14. C1 implemented; universal panel/UI and SendModal hookup remain L1/C2.
No commits, pushes, deployments, signing, broadcasts or new dependencies.

## Exact imports

From a renderer component, import from `../../shared/token-details` (adjust relative depth):

- `tokenDetailsKey(token, context): string` — selection key. Includes account wallet address/index, mode, chain, exact token identifier, source/address, AGW ownership and deployment identity.
- `tokenDetailsIdentity(token, context): TokenDetailsIdentity` — structured display context, no balances/keys.
- `resolveTokenReceive(token, context, validateAddress): Promise<TokenReceiveResult>` — address-only receive result. Address and qrPayload are both null unless capability.state is available.
- `tokenDetailsCapabilities(token, context, input): TokenDetailsCapabilities` — action states; feed current send/swap eligibility helpers and receive result. Available means the UI can offer the flow, never execution/settlement verification.
- Types: `TokenDetailsHolding`, `TokenDetailsContext`, `TokenCapability`, `TokenCapabilityState`, `TokenReceiveResult`, `TokenDetailData`, `TokenRestrictionFacts`, `TokenDetailsCapabilities`.
- `parseTokenQr(input, { key, chainId }, validateAddress)` from `../../shared/token-qr` is for C2. It accepts only plain addresses, uses the backend validator, and returns reviewed recipient data or an explicit reason. All payment URIs/transaction requests are unsupported in v1; none are silently stripped.

`WalletToken` and `WalletAddresses` structurally fit the holding/address contracts. No renderer/bridge type changes are needed for L1. `source` defaults to eoa; agw and future cip113 are explicit.

## Context and usage

```ts
const context: TokenDetailsContext = {
  accountIndex: addresses.accountIndex,
  accountAddress: addresses.evm, // public wallet identity, not an asset identifier
  mode: testnet ? 'testnet' : privacyMode ? 'privacy' : 'mainnet',
  chainId: token.chain,
  chainType: getChainType(token.chain), // use configured network type for custom chains
  addresses,
}
const key = tokenDetailsKey(token, context)
const receive = await resolveTokenReceive(token, context,
  (chainId, address) => window.wallet.validateAddress(chainId, address))
// Compare receive.key against the CURRENT live selection key before displaying it.
const actions = tokenDetailsCapabilities(token, context, {
  sendSupported: canSendToken(token),
  swapSupported: !!swapTokenFromHolding(token),
  receive: receive.capability,
  activityScope: hasNetworkHistory ? 'network' : 'none',
})
```

While receive is pending, use `{ state: 'checking', reason: 'Checking receive address.' }`.
Capture and compare keys for EVERY async receive/scan completion, including errors; a response from a previous account/mode/source must not affect the new panel. Close/clear state on account/mode/chain change. Use an effect generation/cancel flag so an older request for the same identity cannot replace a newer result.

The backend validator uses the live mode. Consume the active addresses returned by the bridge, not the nested testnet cache manually. The testnet receive integration test demonstrates passing the active preprod address and rejecting a mainnet address. ValidateAddress checks address format/network, not ownership; addresses and agwOwned must come from the trusted current account snapshot.

Keep `tokenKey`/`canonicalTokenKey` for persisted spam/filter decisions. Use `tokenDetailsKey` to track panel selection: existing persisted filter keys lowercase identifiers, which is unsuitable for case-sensitive Solana selection. Derive the selected token from refreshed data using the new key, not a saved token object.

For display use `token.balance`; it may be rounded. Send uses `rawBalance` and existing `openTokenSend` exactly as before. Source-correct send remains the original handler. Receive lives only inside details, not beside the row's Send/Swap/Spam buttons.

## Capabilities and limitations

- Receiving ordinary EVM/Solana/Cardano/Tron tokens resolves the network account address, never the token contract/mint/policy. A native placeholder listed in Tokens can receive normally; sending remains gated by the existing native path rules.
- AGW receiving requires Abstract mainnet, the backend's owned-account flag and an AGW address. QR uses that smart account, never its signer/EOA. AGW swap remains unavailable.
- Bitcoin special tokens, Midnight DUST and other unsupported families have details but no guessed receive address. Show the provided reason.
- Missing/malformed/non-positive raw balance or unknown decimals withholds Send. Missing price does not affect receive/action availability; show Price unavailable.
- Activity is supported only to the extent current data proves it. L1 may show **Network activity** using available chain history, with the supplied explanation. Do not label it token-specific or infer transfers from an unfiltered history list. If no current history exists, scope is none.
- Programmable execution and receiving stay unsupported at C1. Unknown/loading/failure/frozen restriction states are modeled; a generic Cardano send flag cannot enable them. Restriction facts from another deployment are ignored. C3/C4 must extend the adapter only with verified evidence.
- Frozen holdings/valuation are unchanged. Restriction capability and actual state are separate; no safety scores/issuer verification inferred.
- No native scanner changes or payment URI support in C1. QR result merely fills reviewed input in C2; never submit automatically.

## Fixtures for L1

Use your existing WalletToken factory with the following overrides; these are public test addresses, not live proof:

| Scenario | Token overrides | Address/context overrides | Expected UI |
|---|---|---|---|
| Ordinary/no price | chain ethereum; contract 0x3333333333333333333333333333333333333333; decimals 18; rawBalance 123456789012345678901234567890; usdValue null | evm 0x1111111111111111111111111111111111111111; accountIndex 0 | Price unavailable; receive address/QR equal EOA |
| AGW | chain abstract; source agw; same token contract | chainId abstract; mode mainnet; agw 0x2222222222222222222222222222222222222222; agwOwned true | Smart account label; QR equals agw; no swap |
| Unsupported send | same ordinary token; rawBalance absent | current EOA | Send unavailable with reason; Receive can remain available |
| Unresolvable receive | same ordinary token | addresses only accountIndex 0, no evm; retain context.accountAddress | No QR; receive unknown with reason |
| Special asset | chain bitcoin; contract rune:TEST; rawBalance absent | chainId bitcoin; chainType bitcoin | Details available; no guessed receive/send |
| Stale selection | start resolve/scan, then switch account/mode while pending | change live key | Result ignored; panel closed/cleared |

Existing pure tests are in `src/shared/token-details.test.ts`, `token-qr.test.ts` and `token-receive.integration.test.ts`. Integration tests use derived public test-wallet addresses and the real backend validator, with no signing/broadcasting.

## Validation

- Focused regression: `npx vitest run src/shared/token-details.test.ts src/shared/token-qr.test.ts src/shared/token-receive.integration.test.ts src/renderer/lib/asset-send.test.ts src/renderer/lib/swap-from-holding.test.ts` — 5 files, 82 tests passed.
- Five-target `npm run typecheck` passed. `git diff --check` passed. `npx esbuild src/shared/token-details.ts src/shared/token-qr.ts --bundle --platform=browser --format=esm --outdir=.local-artifacts/token-details-c1` passed; the helpers have no Node/Electron dependencies.
- Full UI/Playwright/visual verification belongs to L1 plus C2; a tested contract is not a finished panel. Exact feature-SHA GitHub CI/native runtime/real-funds gates remain separate.

## Next owner

Claude L1: claim the main lease only after Codex releases it; read this file and the implementation plan. Build the universal panel and token-row wiring using the exports above. Preserve Codex's shared helper files and pre-existing dirty chat notes. Release with UI evidence and exact next step for Codex C2.
