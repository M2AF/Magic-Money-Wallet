# Cardano native-asset swaps — route evidence and design (gates 1–3)

Status (updated 2026-09-26, later the same day): **gate 1 is implemented**
and marked `implemented-unverified` in `swap-networks.ts`. Every piece was
measured live and passes its tests, but no swap has been executed with real
funds (see `RELEASE-QA.md`). Gates 2 and 3 are not implemented. See
"Implementation — gate 1" at the end for what was built and what the build
itself taught us; the sections before it are the original research record.

All probes were run on 2026-09-26 between 04:02 and 04:10 UTC, read-only. The
unsigned transactions were built for a **public third-party address** that
holds USDCx (`addr1q8008tnk…xpj8mk`) because the API needs real UTxOs; they
were decoded with this repo's own `decodeTxBody` and then discarded.

---

## Verdict

| Gate | Direction | Verdict |
|---|---|---|
| 1 | Cardano token ↔ ADA / USDCx, same chain | **Buildable.** The Minswap Aggregator quotes and builds unsigned CBOR without a key. Two different transaction shapes come back, and the validator has to handle both (or v1 has to exclude one). |
| 2 | Supported token → USDC (Ethereum) → xReserve → USDCx → Cardano token | **Buildable, pending one measured deposit.** The contract call, recipient encoding and a public attestation endpoint are documented, and Cardano-domain deposits are visible on the mainnet contract. The mint-side fee and minimum are unmeasured. |
| 3 | Cardano token → USDCx → USDC → supported token | **Blocked.** The burn needs IOG + Midgard Labs attestations behind a geoblocked portal. There is no public API or SDK. Do not build this by reverse-engineering the portal. |

---

## Evidence table

### Leg: Cardano DEX (Minswap Aggregator, `https://agg-api.minswap.org/aggregator`)

| # | Request | Response (measured) | Signable payload | Fees | Lifecycle | Refund / failure | Status |
|---|---|---|---|---|---|---|---|
| D1 | `POST /tokens {query:"USDCx", only_verified:false}` | 5 hits. Only `1f3aec8b…345553444378` is `is_verified:true`, `decimals:6`. **Imposters:** `82db3e78…5553444378` and `4e74a46e…5553444378` reuse the asset name `USDCx` under other policies; `1ecb116d…55534443 58` is `USDCX`; `qUSDCx` is a Liqwid qToken. | — | — | — | — | ✅ Identity must be the full unit, which the imposters prove |
| D2 | `POST /tokens {query:<full USDCx unit>}` | Exactly one hit, verified | — | — | — | — | ✅ exact-unit lookup works |
| D3 | `POST /tokens {query:"snek", only_verified:true}` | SNEK `279c909f…534e454b`, `decimals:0`, plus other verified "*SNEK" tokens (BBSNEK, QSNEK, …) | — | — | — | — | ✅; pagination via `search_after` not yet exercised |
| D4 | `POST /estimate` SNEK→USDCx, 100000 SNEK | out 60.969754 USDCx, min 60.366093 (1%), impact 1.14%, 1 hop MinswapV2 | — | batcher `total_dex_fee` 2 ADA, `deposits` 2 ADA (returned), **`aggregator_fee` null** | batcher order | — | ✅ quotable |
| D5 | `POST /estimate` USDCx→SNEK, 10 USDCx | out 16184 SNEK, 2 hops **via NIGHT** (`…4e49474854`) | — | batcher 2 ADA, deposit 2 ADA, aggregator 1 ADA (`0.1%`) | batcher order | — | ✅ quotable |
| D6 | `POST /estimate` ADA→USDCx, 50 ADA | out 12.856454, DanogoCLMMV1 | — | aggregator 0.85 ADA, `deposits` 0 | direct script | — | ✅ quotable |
| D7 | `POST /estimate` USDCx→ADA, 10 USDCx | out 38.980252 ADA, split across 2 DanogoCLMMV1 paths | — | aggregator 0.85 ADA | direct script | — | ✅ quotable |
| D8 | `POST /build-tx {sender, min_amount_out, estimate:<the estimate REQUEST body>}` for D7 | `{cbor}` 2,079 bytes. **Shape "direct script":** 3 inputs, 4 reference inputs, 1 collateral, witness set already holds **redeemers (key 5)**, 3 **zero-amount withdrawals from script stake credentials** (withdraw-zero pattern), `scriptDataHash` set, validity window **360 slots (6 min)** | ✅ unsigned CBOR | tx fee 0.599753 ADA; output 2 = **0.85 ADA to `addr1vxnrj2ne…yvr7kg`** (= `aggregator_fee`); outputs 0–1 are pool UTxOs at `addr1x8vtd879…` (pool script `d8b69fc5…`) with pool NFTs | **atomic**: no order to track | Stale pool state means the ledger rejects the tx and no funds move. Collateral is at risk only on a phase-2 failure. | ✅ signable, not signed |
| D9 | `POST /build-tx` for USDCx→SNEK, `include_protocols:["MinswapV2"]` | `{cbor}`. **Shape "batcher order":** 2 inputs, empty witness set, no withdrawals / mint / collateral, validity ≈ 3 h | ✅ unsigned CBOR | tx fee 0.248045 ADA. Output 0: order script `addr1z8p79rpk…` (payment script `c3e28c36…`, **stake = the sender's**) holding 10 USDCx + 4 ADA (2 deposit + 2 batcher) with an inline datum. Output 1: **1 ADA** to the same `addr1vxnrj2ne…` fee address. Outputs 2–3: change to the sender. | submitted → order UTxO on chain → batcher fills or user cancels | `/pending-orders` + `/cancel-tx` return an unsigned cancel. **Unmeasured:** no order exists to cancel. | ✅ signable, not signed |
| D10 | datum of D9 output 0 | Contains the sender's payment credential `def3ae76…` as owner and receiver (with stake `e9ede0c1…`), the pool LP policy + ids for both hops, amount **10000000**, minimum **15855** (= `min_amount_out`), batcher fee **2000000** | — | — | — | — | ✅ receiver and floor are checkable **before signing**. Field meaning comes from one sample and must be pinned against Minswap's published V2 order contract before relying on it. |
| D11 | `GET /pending-orders?owner_address=<addr>` | `{"orders":[]}` | — | — | — | — | ✅ endpoint works; populated shape unmeasured |

Things the docs don't make obvious:
- `build-tx`'s `estimate` field is the **request** body of `/estimate`, not its
  response. Passing the response returns `400 body/estimate must have required
  property 'amount'`.
- Fee units come back as lovelace strings. `aggregator_fee_percent` is 0.1, but
  the charged amount has a floor: 0.85 ADA on a 50 ADA swap and 1 ADA on a
  10 USDCx swap.
- **Small swaps are expensive.** At the measured price (1 USDCx = 3.7995 ADA,
  so ADA ≈ $0.257), D5 costs 2 ADA batcher + 1 ADA aggregator + 0.25 ADA tx fee
  ≈ 3.25 ADA ≈ $0.83 on a ≈$9.75 input, about 8.5%, before price impact. The
  quote card must show this; the ordinary slippage figure doesn't cover it.
- The aggregator fee is **Minswap's own output**, not a Magic Money fee.
  The documented `partner` parameter provides volume tracking only, and there
  is no integrator-fee field (see "Fees" below).
- No preprod aggregator endpoint was found. Preprod coverage for this leg would
  rely on recorded mainnet payloads plus small real-funds tests.

### Leg: xReserve inbound (USDC on Ethereum → USDCx on Cardano)

| # | Request | Response (measured) | Signable payload | Fees | Lifecycle | Refund / failure | Status |
|---|---|---|---|---|---|---|---|
| X1 | Circle docs, [supported domains](https://developers.circle.com/xreserve/references/supported-blockchains-and-domains) | **Source domains: Ethereum `0`, Arc `26` only.** Cardano is remote domain `10004`. Mainnet unit `1f3aec8b…345553444378`, preprod `31dde3db…5553444378` | — | not stated | — | — | ✅ matches D1 |
| X2 | [Deposit quickstart](https://developers.circle.com/xreserve/tutorials/deposit-usdc-into-xreserve) | `depositToRemote(value, remoteDomain, remoteRecipient, localToken, maxFee, hookData)` after `approve()`. Cardano `remoteRecipient` = 4-byte tag (`00000001` key hash / `00000002` script) + 28-byte payment credential. Base-address `hookData` = 95 bytes `txHash(32)+txIdx(1)+datumTag(1)+datum(32)+stakingTag(1)+stakingCred(28)`; the sample fills the first 66 bytes with zeros. Enterprise address → `0x`. Sample `MAX_FEE` for Cardano is `10.00`. | EVM calldata the wallet already knows how to sign | `maxFee` is a ceiling; the **charged** amount is unmeasured | — | — | ✅ documented (Sepolia → preprod only) |
| X3 | Mainnet contract address | `0x8888888199b2Df864bf678259607d6D5EBb4e3Ce` from Digital Asset's official `xreserve-deposits` repo (Circle's Cardano docs list only Sepolia `0x0088…4442`). On chain: a 141-byte proxy holding 8.66 USDC, so custody is elsewhere. | — | — | — | — | ⚠️ second-hand source, confirmed below |
| X4 | `eth_getLogs` on X3, blocks 26054132–26059131 (~17 h) | 42 `0x2eef4ec6…` deposit events, **14 for domain `0x2714` (10004, Cardano)**. Recipient topic is `00000001` + a 28-byte credential, matching X2's encoding. Example: tx `0x9695d030…4fa2`, 1,900.015609 USDC. Older ranges need an archive token. | — | — | — | — | ✅ Cardano deposits are live on this contract |
| X5 | `GET https://xreserve-api.circle.com/v1/attestations/<messageHash>` (sample hash from the repo README) | `{attestation:{payload, messageHash, attestation}}`; the payload carries the remote domain (`2713`, Stacks, in that sample). An unknown hash returns 404. | — | — | status source for Ethereum-side attestation | 404 means not yet attested; it is not a failure | ✅ public, keyless |
| X6 | [Essential Cardano FAQ](https://www.essentialcardano.io/article/usdcx-on-cardano-your-questions-answered) | Mint takes **~15–25 min**, burn **~2 h** | — | — | — | — | ✅ documented |
| X7 | IOG portal terms §4 | A "bridge fee on mint" (Cardano tx cost + min UTxO + service component, which may be zero) and a separate "relay fee" on indirect routes. Amounts are shown only in the portal UI. | — | not machine-readable | — | — | ❌ fee unmeasured, **blocks exact output quoting** |
| X8 | Stacks xReserve docs (a different remote chain, used only for scale) | Mainnet peg-in minimum 10 USDC | — | — | — | — | ⚠️ **the Cardano minimum is unknown**; do not reuse 10 |

### Leg: xReserve outbound (USDCx on Cardano → USDC)

| # | Source | Finding | Status |
|---|---|---|---|
| B1 | [How xReserve works](https://developers.circle.com/xreserve/concepts/how-xreserve-works) | The remote chain's **own attestation service** signs a burn intent off-chain and submits it to xReserve; xReserve then attests and releases. Circle publishes no API for this step. | ❌ |
| B2 | IOG portal terms §1b, §2c, §5b | Burns need **IOG + Midgard Labs attestations** and then Circle's. They take **2–4 h** (400-block finality plus processing). Circle "may delay or deny" release. Burns carry a separate burn fee. | ❌ no integration surface |
| B3 | IOG portal terms §1e | **The portal is geoblocked for legal compliance.** A wallet calling the burn contracts directly would sit outside that control. This is a legal question as well as a technical one. | ❌ needs IOG sign-off |
| B4 | GitHub / web search | No public repo, SDK or API for the Cardano burn or status path. The terms mention users can "interact directly with the USDCx protocol" but document no interface. | ❌ |

### Leg: existing USDC routes (LI.FI, measured 04:07 UTC)

| Pair | Tool | Out / min | Duration | Signable |
|---|---|---|---|---|
| 0.5 SOL → Ethereum USDC | relaydepository | 60.001219 / 59.701213 | 4 s | ✅ |
| 50 Base USDC → Ethereum USDC | polymerStandard | 49.875 / 49.875 | **1080 s** | ✅ |
| 50 Ethereum USDC → Solana BONK | relaydepository | 1,348,990.05 / 1,342,245.10 | 1 s | ✅ |

The leg into and out of Ethereum USDC already works on existing providers.
Arc is also an xReserve source domain and is already a wallet network, but
its xReserve contract address was **not** found and was not probed.

### Deposit-address exchanges

| Provider | Finding | Status |
|---|---|---|
| ChangeNOW `GET /v1/currencies?active=true` | 1284 assets. Cardano-related: `ada`, `snek`, `adabsc`. `snek` is listed **by ticker with no policy ID**. | ❌ cannot add: exact unit unconfirmed |
| SimpleSwap | Needs an API key; not probed | — |

---

## Current repo gaps (verified in code)

- `swap-token-identity.ts:133` `isValidSwapAddress` accepts EVM and Solana
  only, so every Cardano unit is "malformed".
- `token-fetcher.ts:782-786` treats `quantity === 1` as an NFT and truncates
  holdings to 30, then fetches metadata for only the first 20. A fungible token
  with a balance of exactly 1 base unit disappears, and token 21+ is never
  shown.
- `cardano-tx-inspect.ts:210` decodes CBOR tags **transparently**, discarding
  the tag number. Plutus datums identify constructors by tag (121–127,
  1280–1400, 102), so this decoder cannot validate an order datum as it stands.
- `cardano-cip30.ts` `cip30SignTx` returns a **vkey-only witness set**. The
  direct-script shape (D8) already carries redeemers in its witness set, so the
  signed transaction has to be assembled by merging the two sets without
  touching the body bytes. No merge helper exists yet.
- `swap-proxy.js:1394` `muesliQuote` is an explicit stub; `SwapProvider` still
  names `muesliswap`.

---

## Design — gate 1: same-chain Cardano swaps

**Scope for v1: MinswapV2 batcher orders only** (`include_protocols:
["MinswapV2"]`). The batcher shape has no foreign inputs, no collateral, no
redeemers and no script withdrawals, and one pinned order script, so every
output can be checked exactly. D4 and D5 show it routes SNEK ↔ USDCx both ways.
Direct-script protocols (Danogo, which won ADA ↔ USDCx on price) are a
follow-up. Each needs its pool script pinned and input resolution, and D8 shows
the extra surface: collateral, withdraw-zero, redeemers.

1. **Identity** (`swap-token-identity.ts`). `cardano` + address is either
   `lovelace` (ADA) or a full unit: 56 hex policy + 0–64 hex name (even length,
   ≤ 32 bytes), lower-cased, name bytes preserved. Curate USDCx mainnet and
   preprod units with `decimals: 6` (Minswap metadata; Blockfrost registry per
   the existing `token-fetcher` note). Symbol, name and logo remain metadata.
2. **Discovery** (`cloudflare-worker/tokens.js`). Minswap `/tokens` for name
   search, paginated through `search_after`, and exact-unit lookup. Return
   `verified` from `is_verified` (tri-state rule unchanged) and show the policy
   id plus "Minswap-verified" as provenance. Discoverable is not tradable; a
   token becomes eligible only when a quote returns an adequate minimum.
3. **Quote** (Worker `minswapQuote`, replacing `muesliQuote`; provider id
   `minswap`). Base-unit amounts. `buyAmountRaw = amount_out`, `minBuyAmountRaw
   = min_amount_out`, `minReceivedSource: 'provider'` only because the floor is
   in the datum and the validator checks it (step 5). Batcher fee, deposit
   (shown as returned), aggregator fee and tx fee go in `externalFees`.
4. **Build and bind** (privileged layer). `build-tx` is called for the
   **wallet-derived** address when the user confirms, not in the renderer. The
   bound intent adds `cardanoTx: {cborHex, bodyHashHex, ttlSlot, shape:
   'batcher-order', orderOutputIndex}` alongside the existing units, amounts,
   floor, account and network. Intent TTL (5 min) is shorter than the batcher
   validity (~3 h), so the intent expires first.
5. **Pre-signing validator** (new `src/main/cardano-swap-validate.ts`, built on
   `decodeTxBody`). The provider CBOR is untrusted. **Reject unless all hold:**
   - network id absent or matching, and every output address's network nibble
     matches the environment;
   - every input resolves to a UTxO owned by the wallet's payment credential
     (batcher shape has no foreign inputs);
   - no certificates, mint, withdrawals, collateral, collateral return,
     reference inputs, voting/proposal procedures or donation; required signers
     ⊆ {own payment key hash};
   - fee ≤ a fixed cap (e.g. 1 ADA; measured 0.25);
   - outputs are exactly: **one** order output whose payment script hash ∈ the
     pinned allowlist (`c3e28c36…` from D9, confirmed against Minswap's
     published V2 contract before shipping) and whose stake credential is ours;
     **at most one** output to the pinned fee address with ADA only and
     lovelace equal to the quoted `aggregator_fee`; **any number** to our own
     payment credential; nothing else;
   - the order datum, decoded with a **tag-preserving** Plutus-data reader
     (a new decode mode; the existing transparent decoder stays for the UI),
     has owner = our payment credential, receiver = our full address,
     amount = approved `sellAmountRaw`, minimum = approved `minBuyAmountRaw`,
     the final hop outputs the approved unit, and batcher fee = quoted;
   - the order output value = sell amount + batcher fee + deposit, with no other
     assets;
   - net wallet delta: sell unit falls by exactly the sell amount, ADA falls by
     at most tx fee + batcher fee + deposit + aggregator fee, and no other
     owned asset changes;
   - validity end lies in the future and within 4 h.
6. **Sign and submit.** `cip30SignTx` produces the vkey witness; it adds no
   stake witness because the batcher body never references our stake key.
   Merge it into the provider's witness set, keeping the body bytes
   byte-identical (check the body hash against the bound `bodyHashHex`), and
   submit through the existing `cip30SubmitTx` (Blockfrost → Koios). Keep
   Minswap's `/finalize-and-submit-tx` out of the path so submission doesn't
   depend on the provider.
7. **Lifecycle** (existing `SwapLifecycleState`, no new states):
   `source-submitted` → `source-confirmed` (order UTxO on chain; UI says
   "order waiting for batcher") → `completed` when the order UTxO is spent and
   our address received ≥ minimum of the bought unit, or `refunded` when a
   cancel returned the sell asset, or `unknown` on timeout (never `failed`).
   Settlement is read from Blockfrost tx UTxOs, not from the submit response.
   Cancel goes through Minswap `/cancel-tx` and **the same validator** with a
   cancel profile (spends only our order UTxO; everything returns to us). The
   cancel shape is unmeasured and must be recorded from a real order first.
8. **Capability.** `swap-networks.ts` cardano: new `SwapSigningKind`
   `'cardano'`, `sameChain: ['minswap']`, `status: 'verified'` only after the
   validator passes on recorded D9-style payloads **and** one real-funds swap is
   recorded in `RELEASE-QA.md`. Remove the two explicit rejections
   (`swap-executor.ts:184`, `swap-execution-checks.ts:51`) in the same change
   that adds the adapter, not before.
9. **Holdings fix** (separate, small). Classify NFT versus fungible from
   Blockfrost asset metadata instead of `quantity === 1`, and page the holdings
   list instead of truncating it at 30.

Tests: wrong policy with the same name (D1 imposters), a copied symbol, a
malformed or odd-length asset name, mainnet unit on preprod and vice versa, an
extra output, fee to a different address or amount, the order to an
unlisted script, datum receiver ≠ us, datum minimum < approved, a stake
credential that isn't ours, an injected mint / withdrawal / certificate,
insufficient ADA, expired validity, a body mutated after binding, a
cancelled order, and duplicate status events.

## Design — gate 2: inbound cross-chain

Route plan with typed steps, persisted as a resumable session after the first
broadcast. **Each step needs user approval when its funds arrive**, which is
the first-release policy, so an intermediate balance is never traded
automatically at a changed price.

1. `existing-swap` (optional): any supported token → Ethereum USDC through the
   existing LI.FI/Relay path, unchanged. Skipped if the user already holds it.
2. `xreserve-deposit` (new EVM adapter, existing EVM signer): an exact-amount
   `approve` followed by `depositToRemote` on `0x8888888199b2…E3Ce`. The
   validator requires: `to` = pinned xReserve, selector = `depositToRemote`,
   `localToken` = Ethereum USDC `0xa0b8…eb48`, `remoteDomain` = 10004,
   `remoteRecipient` = `00000001` + **our own** payment key hash, `hookData` =
   the documented base-address layout with **our own** stake credential (or
   `0x` for an enterprise address), and `maxFee` ≤ the quoted fee. Status comes
   from the receipt, then the derived message hash against
   `xreserve-api.circle.com/v1/attestations/…` (404 = pending), then USDCx
   arriving at our Cardano address, measured by balance. Expect 15–25 min.
   After 60 min the state becomes `unknown` with the Ethereum tx hash, never
   `failed`. The failure destination shown before signing is "USDC in
   xReserve pending mint; USDCx will arrive at your Cardano address".
3. `cardano-dex`: gate 1, quoted fresh when the USDCx lands.

Before enabling, **one measured low-value deposit** has to establish: the
actual mint-side fee (X7), the Cardano minimum (X8), the exact
`stakingTag` values (read from Circle's reference code, not inferred), and
that a direct contract deposit, rather than one made through the IOG portal,
mints. X4 shows deposits to 10004 from arbitrary senders but cannot say who
built them. Ask IOG to confirm that direct deposits are supported. Arc as a
cheaper source domain waits until its xReserve address is found from an
official source.

Fees: xReserve and IOG fees are `externalFees`. Magic Money has no fee
mechanism on this leg, so it is `no-fee` and never counted as revenue. There
is no separate fee transfer.

## Design — gate 3: outbound cross-chain (blocked)

The router carries no `xreserve-withdraw` step. A Cardano token → USDCx
swap is still offered as a gate-1 same-chain swap, and the UI says USDCx can
then be withdrawn through the official portal at `usdcx.iog.io`. Questions for
IOG / Midgard Labs before any work starts:

1. Is there a supported, documented interface (contract + datum/redeemer spec,
   or API) for a third-party wallet to build a USDCx burn with a destination
   domain and recipient?
2. How is burn status exposed (burn intent → attestation → Ethereum release),
   and what are the terminal failure states?
3. How is the burn fee quoted before signing, and what is the minimum?
4. How does geoblocking (terms §1e) apply to a wallet integration, and is a
   partner agreement required?
5. What happens to burned USDCx if Circle delays or denies release (terms
   §1b), and how does a user recover?

## Fees

Minswap's aggregator fee goes to Minswap, and its API has no integrator fee.
Every route in gates 1–2 is therefore **no-fee for Magic Money** under the
existing policy (`FeeSettlementState` `'no-fee'`), and all third-party costs
are shown as `externalFees`. Nothing here changes `FEE_BPS` or
`FEE_CARDANO`.

## Next actions, in order

1. Pin the Minswap V2 order script hash and datum schema against Minswap's
   published contract source (confirms D10's field meanings).
2. Tag-preserving Plutus-data decode and witness-set merge, both as pure
   functions with tests on the recorded D9 CBOR.
3. Gate-1 validator, Worker adapter, identity and discovery, behind the
   `blocked` capability until a real-funds swap is recorded.
4. Send the gate-2/3 questions to IOG, then make the measured low-value
   deposit.

---

## Implementation — gate 1 (2026-09-26)

### Measured while building, and what changed because of it

| Finding | Consequence in code |
|---|---|
| `agg-api.minswap.org` **rate-limits per IP** after a handful of calls a minute (404s count). | Minswap is called **from the device** (privileged layer), not through the Worker, whose single egress IP every user would share. Same reasoning as the direct LI.FI call. **No Worker change or deploy is needed for gate 1.** Discovery is cached for 5 minutes per query and needs at least 2 characters. |
| Minswap applies slippage **per hop**: a 2-hop minimum is `out/(1+s)²`, which is 1.97% under the output for a 1% setting. | `minswapQuoteDirect` re-asks with `slippage/hops` when the compounded floor would sit below the user's, and refuses the route if it still does. |
| A floor **stricter** than Minswap's own is sometimes refused (`InvalidOrderOptionsError`), even though one 2-hop build accepted it. | The adapter passes Minswap's own `min_amount_out` back unchanged. The validator then requires the **datum** minimum to be at or above the approved floor. |
| `include_protocols: ["MinswapV2"]` is **not honoured**: SNEK↔ADA came back routed through Minswap V1. | The client refuses any non-V2 hop, and the validator independently pins the V2 order script from Minswap's published README. |
| All 60 live V2 orders sitting on the order script were **`killable: false`**. | An unfilled order is not refunded by the batcher. Every surface (quote card, order card, status message) says so before and after signing. |
| The documented `POST /aggregator/cancel-tx` returns **404** on `agg-api.minswap.org`. Codex found the frontend uses the same path on **`k-aggr-monorepo-mainnet-prod.minswap.org`** (see `CARDANO-RESEARCH-NOTES.md`), but it returned "Not all order UTXOs found" for the sample order, so its transaction shape is unmeasured. | Recovery in this release is **Minswap's Orders page** (`minswap.org/orders`), opened in the wallet's browser and signed through the existing CIP-30 prompt, which decodes transactions. An in-wallet cancel is follow-up work: it spends a script UTxO (redeemer, collateral, reference script) and needs its own validator profile. |
| LP asset names are deterministic: `sha3_256(sha3_256(A) ‖ sha3_256(B))` with the pair sorted (`minswap-dex-v2/lib/amm_dex_v2/utils.ak`). | Routes are verified **offline**. Every hop's pool and direction are recomputed from the quoted path, and the path must end at the approved token. Tested against the contract's own test vector. |

### What was built

| Piece | File |
|---|---|
| Cardano asset identity (`lovelace`, full unit, pinned USDCx mainnet and preprod units) | `src/shared/swap-token-identity.ts` |
| Tag-preserving Plutus Data decoder (the existing CBOR reader drops constructor tags) | `src/main/cardano-plutus-data.ts` |
| Minswap V2 order datum decoder, LP-name derivation and route verifier, to the published Aiken types | `src/main/minswap-v2-order.ts` |
| **Pre-signing validator**: strict parsing, every output classified, inputs must be the wallet's own unspent coins, datum owner/receivers/amount/floor/batcher fee, exact order value, net wallet delta, fee and validity caps; direct-script shapes refused | `src/main/cardano-swap-validate.ts` |
| Device-side Minswap client (estimate, per-hop floor, build-tx, discovery) | `src/main/minswap-client.ts` |
| Quote preparation, fresh re-validation, and order status **measured on Cardano** (the transaction that spent the order, and what it paid the wallet) | `src/main/cardano-swap.ts` |
| Executor path: key controls the quoted address → fresh validation → exactly one payment-key witness → body kept byte-for-byte → submit; an uncertain submit names the tx id and is never retried | `src/main/swap-executor.ts` |
| Sessions: `settlesAfterSource`, so a confirmed order reads "placed", not "completed", and stays on the reconcile list | `src/shared/swap-settlement.ts`, `swap-session.ts` |
| UI: Cardano pairs with itself, cost rows read from the transaction, order disclosure before signing, order tracker with "Manage or cancel on Minswap" | `DexSwapWidget.tsx` (additive), `SwapQuoteCard.tsx`, `CardanoOrderStatusCard.tsx` |

### Evidence

- Recorded live builds in `src/main/__fixtures__/minswap/`: USDCx→SNEK (2-hop),
  ADA→USDCx (1-hop and 2-hop), the refused Danogo direct shape, the sender's
  UTxO set, and 60 live on-chain order datums.
- `cardano-swap-validate.test.ts` covers each recorded build accepted, plus
  one tampered transaction per rule refused: proceeds, refund and canceller
  redirected, lowered floor, sell amount, forged path, wrong end token, unpinned
  fee address, fee and batcher-fee mismatches, a foreign or spent input,
  network, expiry, fee change, and malformed input.
- `cardano-swap-flow.test.ts`, `swap-executor-cardano.test.ts`: client route
  checks, the per-hop re-ask, the policy gate, status mapping, the session
  lifecycle, and executor signing with the real key derivation.
- A **live read-only smoke** at 04:48 UTC: `prepareCardanoSwapQuote` for
  USDCx→SNEK (2 hops) against mainnet quoted, built, re-read the sender's UTxOs
  and tip, and passed the validator in 1.75 s, with the floor inside 1%.
- `e2e/cardano-swap.spec.ts` (real extension): the real resolver offers
  Cardano, the two sides pair, the quote card discloses the order terms, and
  the order tracker goes from placed to filled.

### Not done — needs you or a later change

1. **One real-funds swap per direction** (`RELEASE-QA.md`). Only then move
   Cardano to `verified`.
2. An in-wallet cancel, once the cancel transaction shape is measured on a real
   order this wallet owns.
3. Gate 2 still needs one measured low-value xReserve deposit (charged fee and
   minimum). Gate 3 still needs an official burn integration.
4. The ChainLens swap-core bundle was regenerated and ChainLens's
   `swap-service.js` now **allow-lists** the signing kinds it can complete
   (`evm-eoa`, `solana`), so Cardano stays unavailable there exactly as before.
   It ships with ChainLens's next deploy.
