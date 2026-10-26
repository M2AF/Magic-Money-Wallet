# Universal token details and programmable-token integration

Date: 2026-10-14. Status: C1/L1/C2/C3 implemented and locally verified; L2/C4 pending. C3 contracts and evidence are in CIP113-C3-HANDOFF.md, including a vetted Cardano-mainnet explorer source. L1 native-Back/other explorer follow-ups remain open.
User authorized planning and a Claude/Codex job split. This document does not authorize commits, pushes, deployments, signing or broadcasts.

## Product behavior

- In Portfolio > Tokens, clicking/tapping a token's card opens its details panel. The adjacent Send/Swap/Spam buttons retain their existing independent actions and do not open details.
- Every listed token has details, including unsupported/read-only holdings. Opening details never requests a signature or transaction.
- Use the same panel across desktop, extension, Android and iOS: a side panel on wide layouts and a full-width sheet on narrow layouts. Reuse theme variables and the existing portal approach; scroll within the panel.
- Provide keyboard activation, an accessible dialog title, focus containment/restoration, Escape/back dismissal, and explicit close. No nested buttons in the clickable card. No hover-only actions.
- Header: existing logo, name, ticker, network and holding source. Main content: holding, display-currency value when known, token identifier (contract/mint or Cardano policy plus asset name), copy and vetted explorer link. Missing price is "Price unavailable", not zero.
- Actions: Send, Receive, Swap, View activity where supported, with a visible explanation for unavailable capabilities. Keep source-correct existing send/swap handlers rather than implementing a second transaction flow.
- Receive displays the selected token, network, account/source, full receive address, Copy and QR. The QR initially contains the address only; say "Address only — select this token and network in the sending wallet." A plain EVM address cannot prove the network or token.
- Send uses the existing send modal and offers Scan QR where the bridge supports it, with paste always available. QR input only fills reviewed fields; it never signs or submits. Account, asset, network and source remain explicit.
- Changing account/network/mode or removing the holding closes or invalidates the panel and any receive view before old data can be acted on. A refresh updates the selected holding by stable identity, not array position.

## Scope and sequence

1. Universal details and receive for existing listed tokens; reuse current transaction capabilities.
2. Safe QR-assisted send parsing and cross-platform regression coverage.
3. CIP-113 read-only holdings, history and verified restriction information in the universal panel.
4. CIP-113 native transfers, then compatible swaps, only after deployment-specific integration gates pass.

Do not add charts, new price providers, generic security scores, NFT detail redesigns, new camera dependencies, new cross-chain providers or issuer administration screens to this feature. The Tokens tab is the entry point; native-coin cards can reuse the panel later without widening this first pass.

## Current code and reuse points

- `src/renderer/pages/DashboardPage.tsx`: TokenRow/TokensView, holding actions and `openTokenSend`; preserves AGW source and exact raw units.
- `src/renderer/types/wallet.ts`: WalletToken, WalletAddresses and bridge types. WalletToken currently exposes `source?: 'agw'`, exact rawBalance and optional decimalsKnown.
- `src/renderer/lib/asset-send.ts`: current send capability and asset mapping; UI capability is not transaction authorization.
- `src/renderer/components/SendModal.tsx`: existing confirmation flow and scanner hook. Current scanner strips any scheme/query; replace that permissive treatment with explicit parsing.
- `src/renderer/components/AddressChip.tsx` and `QrCode.tsx`: existing copy/address QR generation; reuse QR dependency and render primitives.
- `src/capacitor/qr-scan.ts`: current scanner bridge. Verify actual availability separately for each target; function presence alone is not proof of a working camera.
- `src/main/token-fetcher.ts`, `cardano-cip30.ts`, `cardano-koios.ts`: current Cardano holdings/UTXO discovery queries ordinary addresses. No CIP-113-specific implementation found in `src` during planning.
- `src/main/usdcx-burn-validate.ts` and `xreserve-withdrawal-prepare.ts`: outbound paths remain unwired/non-executable. CIP-113 integration does not change these gates.

## Shared contract: Codex delivers before Claude wiring

Define a small renderer-safe typed model and pure helpers in new `src/shared/token-details.ts` (final naming can change before handoff). No private keys or signing objects reach it.

- Identity includes network/mode, chain id, exact token identifier, account and holding source. Include deployment identity for future CIP-113 holdings. Preserve chain-specific identifier case/encoding and exact integer amounts.
- Receive resolution returns a verified address and context, or unavailable with a reason. Ordinary tokens normally share their network account's address. Never use token contract/mint/policy as recipient. AGW holdings use the owned smart-account context, not the EOA. Unsupported special assets (e.g. inscriptions/runes) need an explicit rule before receive is offered.
- Send/swap/receive capability is action-specific: available, unsupported, checking, restricted, unknown or failed, with a user-facing reason. An unknown future restriction module must not disable normal current tokens indiscriminately.
- Price, history coverage and restrictions have independent loading/unknown/error states. Do not imply full token history from a chain-wide transaction list: show explicitly labeled network activity until token-specific transfers are available.
- Restriction facts have evidence source, checked time, module/deployment identity and trigger authority. "Can be frozen" differs from "Currently frozen". Unknown authority is not a verified issuer identity. Upgrade powers are separate from token seizure powers.
- A frozen balance remains in holdings; do not represent holdings as spendable or change valuation to zero because transfers are blocked. Available amount may be unknown.
- QR parser returns a reviewable address plus supported metadata, or a clear rejection. Accept plain addresses through existing chain validation. Recognize only explicitly implemented payment URI formats; reject unsupported schemes, contract-call requests, incompatible network/asset requests and malformed/oversized input. Do not strip arbitrary schemes or silently ignore meaningful parameters. Ambiguous address-only payloads require the already selected network/asset to remain visible. No automatic submission or fetching scanned URLs.

## Jobs and ownership

### C1 — Codex: shared contract, address/capability rules and QR parser

Own: new shared helper/model files and focused tests. If existing bridge/types need changes, Codex owns those changes and delivers them before Claude starts wiring. Keep helper dependencies renderer-safe and make receiving source-aware.

Acceptance: exact token identity/units preserved; EOA vs AGW resolved correctly; no contract used as receive address; mainnet/testnet/account context bound; unsupported special receive paths explained; wrong-network/asset URI and malformed QR rejected; cancel/unsupported camera leaves inputs unchanged. Deliver exported signatures, fixtures and limitations in this plan/journal.

### L1 — Claude: universal panel and Tokens-tab integration

Own: new TokenDetailsPanel/TokenReceivePanel components and styles; DashboardPage row/open/close wiring; renderer type consumers. Consume C1 exports; do not redefine shared capabilities.

Acceptance: clicking token card or keyboard activation opens details; adjacent actions never open details; close restores focus; mobile/extension layout scrolls without overflow; long names/identifiers fit; source and network visible; copied address equals QR payload; changing account/mode prevents stale actions. Details work for all listed assets, including no-price and unsupported-send holdings. Reuse SendModal and existing swap prefills; actions never submit from details.

### C2 — Codex: QR/send integration and transaction review

Own: SendModal QR parsing hookup, helper tests, targeted integration tests and review of send/receive mappings. Start only after L1 hands off renderer work because SendModal may require coordinated overlay changes.

Acceptance: scanner result passes explicit parser; errors are visible and preserve safe input state; selected token/source/raw balance survive opening send; review then explicit confirmation remains required; camera unsupported/denied/cancelled has usable paste fallback. Do not add desktop/iOS camera promises without verified support.

### C3 — Codex: CIP-113 deployment research and read-only data adapters

Own: Cardano discovery/registry/history/module decoding and relevant backend tests; bridge additions across all four targets if required. Research packet precedes executable features.

Before implementation: verify canonical network deployment, bootstrap/registry identities, scripts and current protocol parameters; inspect actual token module behavior and who can trigger it. Do not copy Preview constants into mainnet or infer USDCx conformity from token name.

Acceptance: programmable ownership resolved from the correct credential convention; holdings uniquely keyed and not double-counted; unknown deployment/modules represented explicitly; history facts are attributed only when provable; current restrictions and upgrade authority bind to evidence. No signing/broadcasting in this phase. Discovery alone is not CIP-30 signing support.

### L2 — Claude: programmable states within universal panel

Own: rendering C3 facts, details disclosures, held/available labels, restriction badges and activity presentation. Start after C3 contract handoff. No "safe", "unrestricted", "verified issuer" or "KYC approved" claims without corresponding evidence. No generic KYC form; an issuer-specific verification link requires a trusted integration.

Acceptance: unknown/error/loading is distinct from unrestricted; freeze capability differs from active freeze; third-party actions are not labeled as user sends; unsupported sends/swaps show why. Ordinary-token panels remain clean.

### C4 — Codex: programmable execution gate and final review

Plan a separate adapter for native CIP-113 sends, owner credentials, registry/protocol reference inputs, module validation, exact outputs, fees, collateral and signer compatibility. Do not let generic Cardano send capability accept programmable holdings prematurely. DEX support requires an actual compatible quote/build; cross-chain USDCx gates remain separate.

Claude owns any resulting confirmation UI changes after the adapter contract is delivered. Execution is a later gate, not implied by universal panel completion.

## Collaboration protocol

- Both agents start with `agent-handoff` status, read AGENTS.md and this plan, and preserve existing dirty work. At planning time HEAD is `24d088b`; existing dirty notes concern chat/handoff and are unrelated.
- Same-checkout editing is sequential: C1 -> L1 -> C2 -> C3 -> L2 -> C4. Each agent claims the named task, logs files/exports/checks/blockers, and releases with the exact next job. No concurrent edits in this checkout.
- Independent research/review can run read-only. If parallel editing becomes useful, first agree disjoint scope and use isolated checkouts plus scoped leases; do not create branches merely to plan.
- Shared type changes, DashboardPage and SendModal each have one owner at a time. No lease force overrides. Integration needs exclusive ownership.
- Handoff entries must distinguish implemented, locally tested, provider-verified, native-tested and real-funds-verified. Do not overwrite earlier unrelated board state or label old CI as verification of this feature.

## Verification and completion gates

- C1/C2: focused unit checks for receive identity/source, network binding, exact values and hostile QR cases. L1/L2: real-handler UI tests for action isolation, keyboard/focus, receive payload and capability explanations.
- UI screenshots: desktop, narrow extension, mobile viewport; multiple themes; long token name/identifier, missing price, read-only asset, AGW, frozen/unknown programmable fixtures. Fixtures prove UI behavior only.
- Integration gate: `CI=1 npm run verify:ci` with fresh builds, one Playwright worker and all live Workers stubbed. Five-target typecheck plus extension/Capacitor/iOS web builds as appropriate. Record exact HEAD and dirty state. Preserve/archive generated tracked assets as required by the project.
- Browser fixtures do not prove camera/native behavior. If scanner/native code changes, verify Android with Gradle and native behavior; iOS functional validation follows the existing iOS workflow/Appium gate. Report unavailable native evidence honestly.
- After a user-authorized commit/push, inspect GitHub CI for the exact feature SHA; do not commit/push merely to obtain green CI. Release/deployment is separate.
- Funds-moving CIP-113 features require deployment-specific testnet end-to-end evidence and applicable real-funds release QA before shipping. No real funds, signing or broadcasts are authorized by this planning request.

## First pickup

Completed pickups: C1 -> Claude L1 -> Codex C2 -> Codex C3. Read CIP113-C3-HANDOFF.md for the exact renderer contract, canonical-mainnet coverage, live read-only evidence and full local gate. Next Claude claims L2 after lease release; native-Back and vetted Cardano-mainnet explorer follow-ups can accompany that logged scope. No generic programmable execution or outbound USDCx support is enabled.

## Specification

- https://github.com/cardano-foundation/CIPs/blob/master/CIP-0113/README.md
- https://github.com/cardano-foundation/cip113-programmable-tokens
- https://cardanofoundation.org/blog/programmable-tokens-cardano-mainnet

C3 pinned and live-checked the canonical mainnet deployment. Token-specific module semantics remain unknown; execution requires C4's separate adapter and validation gates.
