# DEX swap — discovery, execution safety, lifecycle and monetization

Status of the staged plan in `MAGIC_MONEY_SWAP_CLAUDE_PLAN.md`, plus the fee work
in `MAGIC_MONEY_DEX_FEE_PLAN.md`.

**Stages 0-3 done, plus the Stage 2 review fixes, the network-coverage
expansion, and (2026-09-21) provider-aggregated routing: every applicable
provider is queried and compared, not just LI.FI and Relay, and the imported-
network boundary moved from those two alone to any execution-capable provider.
Monetization is done in CODE, not in payout evidence — see "App fee", where
that distinction is load-bearing.**

**Broad CROSS-CHAIN is ALLOWED on LI.FI and Relay only**, and only when all of:
the provider states its own floor, its lifecycle is verified against real
provider records, the route's destination failure mode is known and shown before
signing, and settlement tracking is running. It is refused on every other
provider — this is unchanged by the routing-policy work, which decides WHICH
safe route is offered, never which providers may reach broad-cross-chain tier at
all. Broad SAME-CHAIN swaps are not restricted this way and may use any
same-chain provider that passes the ordinary minimum-received and simulation
checks. No swap of any kind has been executed with real funds from this wallet,
so "allowed by policy" is not "proven in production" — see "Support levels" for
exactly which claim each piece of evidence supports.

**Baseline.** Branch `main`, HEAD `745039e`. **No swap work is committed** — all
of it is uncommitted working-tree state. Earlier reports that seemed to disagree
about when the Stage 2 fixes landed were describing two different things: Stage 2
(the plan stage) was implemented first; the Stage 2 *review* then found four
defects inside that work, which were reproduced as live failures and fixed later.
Same checkout throughout, no regression; all four fixes are present and their
tests pass.

---

## Support levels — what each claim actually rests on

Four levels, kept apart because each is easy to mistake for the next:

| Level | Means | Established by |
|---|---|---|
| **Discovered** | tokens on the chain can be found, by search and exact address | live `/tokens` probes |
| **Quotable** | a provider returned signable calldata for a real pair, at a realistic size | live read-only quote probes |
| **Executable** | the privileged layer WOULD sign it: chain capability, provider adapter, step validation, policy gate and pre-signing validator all pass | tests through the real gate and validator, on recorded provider payloads — **not** a broadcast |
| **Settlement-verified** | the provider's outcome vocabulary (success / partial / refund / failure) is mapped and checked against REAL settled records | recorded live provider history run through the real mapper |

A fifth claim — **payout verified**, i.e. our fee actually arrived — has
**not** been established for any provider. Relay is the only one that publishes
the evidence needed (`paidAppFees[]`), and the reconciliation that reads it is
built and tested against the real record shape; no swap of ours has settled for
it to confirm.

| Provider | Discovered | Quotable | Executable | Settlement-verified |
|---|---|---|---|---|
| LI.FI | ✅ | ✅ live | ✅ | ✅ 3 real PARTIAL + 2 real REFUNDED |
| **Relay** | ✅ | ✅ live, EMO→PIXL through the real Worker | ✅ incl. the pre-signing validator | ✅ real success / refund / failure records |
| Jupiter | ✅ | ✅ live | ✅ | n/a — same-chain, atomic |
| 0x / 1inch / Uniswap | — | needs keys; not measured here | ✅ curated pairs | n/a — same-chain, atomic |
| Rango | — | needs a key | curated only | ❌ docs only |
| SwapKit | — | needs a key | curated only | ❌ no partial/refund mapping |

---

## Production deployment (2026-09-22)

The Worker is **deployed** (user-approved). Live version
`a3b0d3b2-733e-4cdc-88fa-63621fdfa5d1`; rollback target (the pre-swap build)
`01ab2935-ab9b-4cfa-b50a-bcc61de0d2e9`, confirmed byte-identical to the
committed HEAD before deploying, so the deploy changed only the swap modules.
Bindings unchanged except `FEE_BPS` 90 → 100. Nothing signed or broadcast.

**Found during post-deploy verification and fixed:** token discovery
(`tokens.js`) and the wallet's identity core (`EVM_SWAP_CHAINS` in
`swap-token-identity.ts`) still listed only the original 8 EVM chains, so
`/tokens?chain=robinhood` returned nothing and the wallet treated every
Robinhood/Arc/… address as malformed. Both widened to the executor's 19 chains;
`swap-chain-set-parity.test.ts` now pins all four copies together.

**Live, read-only, through the app's own `getSwapQuote` → signing checks →
intent binding** (placeholder addresses):

| Route | Provider | App fee | Floor vs 2.50% slippage | Signable |
|---|---|---|---|---|
| Monad EMO→MON | Relay | not reconciled client-side (see below) | 2.48% | ✅ |
| Monad MON→USDC | Relay | 1% verified | 2.49% | ✅ |
| Solana SOL→USDC | Jupiter | 1% verified | 2.49% | ✅ |
| Solana BONK→SOL | Jupiter | 1% verified | 2.49% | ✅ |
| Robinhood ETH→USDG | Relay | 1% verified | 2.49% | ✅ |
| Robinhood ETH→cbBTC | Relay | 1% verified | 2.48% | ✅ |
| Base ETH → Arbitrum USDC | Relay (2 safe routes) | 1% verified | 2.49% | ✅ |
| Monad EMO → Ethereum PIXL | Relay; LI.FI excluded (floor 4.93%) | not reconciled client-side | 2.49% | ✅ |

**Token identity is by contract address.** Every "USDC" that discovery returns
on Robinhood is an imposter ("Unconditional Support Dog Coin", …), correctly
labelled unverified. USDG `0x5fc5…d168` is confirmed by the issuer (Paxos) and
by Robinhood's contracts page. cbBTC `0xcec1…0be4` is a real contract, and
Coinbase's usual cbBTC address has no code on Robinhood — consistent with its
CCIP launch there — but no issuer page listing that address was found, so it is
unconfirmed.

**Limitations seen live:**
- *Uniswap* is excluded on every non-curated pair: its response carries no
  minimum-received field the adapter recognizes, so its floor is only an
  estimate. Mapping it needs a real keyed response sample.
- *Relay fee on non-USDC sell tokens* (EMO): the Worker measures ~100 bps by USD
  ratio and marks it applied-verified; the wallet's own check compares raw
  amounts in different tokens and does not reconcile, so the route is offered
  but not COUNTED as fee-paying. The quote card still discloses the fee; the
  conservative side wins.
- *Rango* `/basic/meta` returns HTTP 403 with the configured key, so its chain
  list falls back to the documented one; no Rango route appeared in any verified
  swap.
- Older installed builds lose same-chain Solana and key-gated EVM routes against
  this Worker until updated (accepted before deploying).

## Provider-aggregated routing (2026-09-21)

Every applicable provider is now queried and compared for every quote, not just
LI.FI and Relay, and route SELECTION no longer uses the fee as an absolute
barrier. This section covers the routing-policy replacement, the
provider-aggregated `/swap/chains`, the resulting coverage matrix, and a
same-chain-adapter signing bug the coverage matrix surfaced.

### Route selection replaced: best real result wins, fee is a tie-breaker

**What it was.** Two-tier: any route whose app fee was VERIFIED beat every
route that was not, however much less the verified one actually returned. A
fee-paying route that gave the user 5% less than a fee-free alternative still
won outright, because the tier was decided before price was ever compared.

**What it is now** (`src/shared/swap-routing-policy.ts`, mirrored rule-for-rule
in `cloudflare-worker/swap-routing.js`, parity-tested against each other):

1. Rank every safe candidate by its real net result — output minus gas and
   other source-side costs, all in USD, when every candidate priced them; net
   output alone otherwise (**never a guessed cost**).
2. The best result wins by default.
3. A verified fee-paying route is preferred over it ONLY when it is
   **competitive**: within `feePreferenceMaxShortfallBps` (25 bps, a quarter of
   the fee itself) AND `feePreferenceMaxShortfallUsd` ($10) of the best result,
   with a guaranteed-minimum floor and execution risk that are no worse.
4. If the best safe route pays no fee at all, it is still offered — never
   dropped to protect revenue.

The tolerance is a versioned setting (`SWAP_ROUTING_POLICY.version:
'2026-09-21.routing-v1'`), not a magic number: changing it changes the version,
so every selection can be traced to the rule that produced it. Every candidate
is ranked, not only the winner — the Worker's `/quote` response now also carries
`alternatives` (up to 3, provider/output/fee/eta) and a `routing` object stating
why the served quote won.

USD valuation is real where the provider supplies it (LI.FI: `estimate.toAmountUSD`
+ `gasCosts[].amountUSD`; Relay: `details.currencyOut.amountUsd`, with source
cost fixed at 0 since Relay's quoted output is already net of its own gas and
relayer fee, not charged again on top) and simply absent otherwise — a mixed
same-chain comparison (say 0x priced, LI.FI unpriced) falls back to comparing
raw net output rather than inventing a number for 0x's gas.

Verified with 28 tests: `src/shared/swap-routing-policy.test.ts` (unit rules +
parity with the Worker mirror) and `src/main/swap-quote-aggregation.test.ts`
(`pickBestRoute` directly, plus `handleQuote` end to end against mocked
upstreams).

### Same-chain now queries every applicable provider concurrently

**What it was.** Same-chain EVM ran 0x/1inch/Uniswap in parallel, and consulted
LI.FI or Rango only as a fallback IF the trio returned literally nothing usable.
A materially better LI.FI or Rango route was invisible whenever the trio
returned anything at all, however weak — the opposite of "use every applicable
provider to maximize route availability."

**What it is now.** All five same-chain-capable providers (0x, 1inch, Uniswap,
LI.FI, Rango) are queried CONCURRENTLY via `Promise.all`, each under a 9-second
per-call deadline (`withTimeout`) so one slow provider cannot hold up the whole
batch, and the winner is chosen by the routing policy above. The cross-chain
`tries` array (Relay, Rango, SwapKit, LI.FI) was already gathered before
selecting, but ran sequentially — it is now concurrent too. Pinned by
`swap-quote-aggregation.test.ts`: a same-chain request where 0x returns a WEAK
route and LI.FI returns a materially better fee-free one now selects LI.FI, which
the old staged logic would never even have tried.

### `/swap/chains` v2 — every provider, with its own evidence

**What it was.** `{lifi: number[], relay: number[], fetchedAt, stale}` — the
only two providers ever asked.

**What it is now** (`cloudflare-worker/swap-chains.js`,
`providerChainIndex`/`handleSwapChains`): one entry per provider we have an
execution adapter for (`lifi, relay, '0x', '1inch', uniswap, rango, swapkit`,
plus `jupiter` for completeness though it is Solana-only and irrelevant to EVM
imports), each carrying:

| Field | Meaning |
|---|---|
| `chains` | numeric EVM chain ids this provider lists |
| `nonEvm` | non-EVM chains it lists (`solana`, `bitcoin`, `cardano`) |
| `source` | `'live'` (fetched from the provider's own endpoint just now) / `'documented'` (its published list, used when no endpoint exists or this deployment holds no key) / `'unavailable'` |
| `evidence` | `'discovered'` / `'documented'` / `'none'` — how a caller should weigh it |
| `url`, `fetchedAt`, `expiresAt`, `stale`, `error` | full provenance and freshness |

A chain id appearing in one provider's list is a claim about THAT provider's
support, never that every pair on it is routable, and never that another
provider covers it too — `providersForChainId` names exactly which providers
listed a given id.

**Live-list providers**, fetched keylessly or with a key when configured:
LI.FI (`li.quest/v1/chains`), Relay (`api.relay.link/chains`), and — with a key
— 0x, Rango, SwapKit. **Documented-only providers** (no chain-list endpoint, or
this deployment holds no key): 1inch and Uniswap always; 0x/Rango/SwapKit fall
back to their documented list whenever no key is configured or the live call
fails, WITHOUT dropping to "nothing supported" — a live entry that later fails
keeps its last-known live list and is flagged `stale` rather than shrinking
coverage on a transient outage.

Documented lists were read from the raw page at each URL on 2026-09-21, not
from a summary (verified against the actual HTML/markdown response), and are
re-read at least every 90 days:

| Provider | EVM chain ids documented | Source |
|---|---|---|
| 0x | 22 chains: 1, 10, 56, 130, 137, 143, 146, 480, 999, 2741, 4217, 4663, 5000, 5042, 8453, 9745, 42161, 43114, 57073, 59144, 80094, 534352 | docs.0x.org/docs/introduction/supported-chains |
| 1inch | 17 chains: 1, 10, 25, 56, 100, 130, 137, 143, 146, 324, 999, 4663, 5042, 8453, 42161, 43114, 59144 | business.1inch.com Classic Swap v6.1 docs |
| Uniswap | 21 mainnet chains: 1, 10, 56, 130, 137, 143, 196, 324, 480, 1868, 4217, 4326, 4663, 5042, 8453, 42161, 42220, 43114, 57073, 59144, 7777777 | developers.uniswap.org/docs/trading/swapping-api/supported-chains (each with its own Universal Router address per chain) |
| SwapKit | 15 EVM chains (1, 10, 56, 100, 137, 143, 196, 999, 4663, 5042, 8453, 36900, 42161, 43114, 80094) + solana/bitcoin/cardano | docs.swapkit.dev `/providers` reference table |
| Rango | 8 chains it has a NAME mapping for in this adapter (1, 10, 56, 137, 143, 8453, 42161, 43114) + solana/bitcoin/cardano/polkadot; routes by blockchain NAME, not id, so full coverage needs the live `/basic/meta` call | docs.rango.exchange `Get Blockchains & Tokens` |

Live measured 2026-09-20/21 (no keys, keyless endpoints): LI.FI 71 chains
(includes Solana), Relay 60 EVM chains across 8 VM types (`evm`, `hypevm`,
`xrpvm`, `lvm`, `bvm`, `svm`, `tonvm`, `tvm` — only `evm`/`svm` counted here).

### Coverage matrix — what each source claims vs what Magic Money can use

| Layer | Chains |
|---|---|
| **Chains any provider documents or lists** | union of the table above — largest set, means nothing on its own |
| **Chains this wallet can currently USE for swaps** | built-ins: everything in `SWAP_NETWORKS` (`src/shared/swap-networks.ts`) marked `verified`/`implemented-unverified` with a non-empty `sameChain` or `crossChainSource`. Imports: reach **quotable**, not executable — see above |
| **Blocked by the EXECUTOR (signing), not by provider coverage** | Bitcoin, Cardano, Polkadot, Tron, Dogecoin (no PSBT/CBOR/Substrate/Tron signing path); Abstract Global Wallet specifically (smart-account balance, EOA signing key — see below); imports generally, at the signing gate (see above) |
| **Blocked by SAFETY policy, not by provider or executor capability** | broad (non-curated) cross-chain pairs on any provider outside `LIFI_CHAIN`/`RELAY_CHAIN` lifecycle-verified set, and any route whose minimum-received cannot be pinned to an enforced floor |
| **Pair-specific vs chain-wide** | a chain in a provider's list is a CANDIDATE only — e.g. Abstract lists 14 LI.FI tokens and ETH→USDC.e routes while ETH→PENGU returns no quote on the same chain; ApeChain routes bridging IN but returns HTTP 404 swapping OUT; these are pair/direction failures, not "ApeChain isn't supported" |

### A signing bug the coverage work surfaced and fixed

While reconciling "chains this wallet can use" against "chains the executor can
sign for," `src/main/swap-executor.ts`'s OWN chain-id map (`EVM_CHAIN_ID`, used
for `isSupportedEvmChain`/`resolveEvmChainId`) turned out to list only 8 chains,
though `tx-sender.ts` (and the coverage matrix in `swap-networks.ts`, and the
network-expansion work from the previous pass) already supported 19. A quote on
Robinhood, Arc, Abstract, HyperEVM, Zora, Soneium, Ronin, Gnosis, Blast or
ApeChain would pass every policy check (`decideSwapPolicy` reads the correct,
already-expanded matrix) and then throw at the signing step — "Could not resolve
EVM network for robinhood" — the exact BSC-regression class `chain-parity.test.ts`
exists to catch, just not yet caught for these ten. Fixed by widening
`EVM_CHAIN_ID` to match `tx-sender.ts`'s set exactly (same numeric ids), and by
adding `resolveEvmChainId(chain, config?)`, which ALSO resolves an imported
chain by its registry entry once `config` is threaded through (used at
signing time; unused, so unchanged, everywhere a test calls the validator
without a config). Pinned by 13 new tests in `swap-executor.test.ts` and the
existing `chain-parity.test.ts`, which now covers the wider set.

### Field reports, 2026-09-21 — three failures, three causes

Reproduced before fixing; pinned by `swap-safe-route-selection.test.ts` and
`swap-relay.test.ts`.

| What the user saw | Cause | Fix |
|---|---|---|
| Monad EMO→MON and Solana →SOL: *"Quote does not match the request (app fee terms)"* | **Version skew.** The deployed Worker is the July build: `/swap/chains` returns 404 and its quotes carry no `appFee` and no provider floor (probed read-only). The locally built app correctly refuses a quote with no fee terms. | Not fixable client-side — the Worker must be redeployed. The app now says so (*"the swap service … is running an older version than this app … the Worker needs redeploying"*) instead of blaming the request. Against the CURRENT Worker code, both pairs return a bindable quote (live, read-only). |
| EMO→PIXL: a LI.FI quote was shown, then refused at "Swap" (*floor 4.93% below, slippage 2.50%*) | **The app still short-circuited.** The previous pass replaced fee-first selection in the Worker only; the app's own `getSwapQuote` still returned the first fee-verified LI.FI-direct quote without checking it could be signed or comparing it with anything. | `getSwapQuote` now runs the signing checks (fee integrity, `decideSwapPolicy`, exact minimum for broad tokens) on EVERY candidate — LI.FI direct and every Worker candidate — excludes the unsignable ones with their reason, and ranks the rest with `selectRoute`. The Worker returns its full ranked `candidates`, so a route it ranks first but the app cannot sign no longer hides a safe one. EMO→PIXL now resolves to Relay, whose floor matches the slippage. |
| (found while fixing the above) Monad EMO→MON had no route locally | Relay fills same-chain swaps but was never asked same-chain; and its floor came back at 2.52% for a 2.50% request, which the exact check refuses. | Relay added to the same-chain candidate set. When Relay's floor overshoots, the adapter re-asks ONCE with a tolerance scaled by the measured overshoot — only ever TIGHTENING the floor; the user's slippage is unchanged and still checked exactly. Live: Relay, 1% fee applied-verified, floor 2.48% at 2.50%, policy allowed, intent bound. |

**Consequence for imports:** the signing gate now also runs at quote time, so an
imported network's quote is WITHHELD with the gate's reason rather than shown
and then refused. Imports remain quotable at the provider level and not
executable, as documented under "Imported custom networks".

---

## Stage 1 — discovery

### What was broken

Verified against the code, not inherited from the research:

| Finding | Evidence |
|---|---|
| `/tokens` was a stub returning `[]` unconditionally | `cloudflare-worker/swap-proxy.js:824` (old) |
| The picker never called the bridge | `swapGetTokens` existed in all four bridges; **no renderer component called it** |
| Tokens were identified by symbol | `DexSwapWidget.tsx:305,335` |
| SPL balances always read as zero | balance match did `contractAddress.toLowerCase()`; base58 is case-SENSITIVE |
| Balances ≥ 1000 read wrong | `parseFloat(match.balance)` on a comma-grouped **display** string — `parseFloat("1,234.5") === 1` |

### Measured provider facts

Read-only probes, no keys, no wallet:

| Fact | Consequence |
|---|---|
| LI.FI Base: **1074** tokens by default, **1694** at `minPriceUSD=0` | The default hides **36%** of the chain. We request `0`. |
| Jupiter omits `isVerified` for unverified mints (never `false`) | Verification is tri-state; absent means UNKNOWN. |
| Jupiter "BONK" → 5 mints, decimals 5/9/6/6/6, one Token-2022 | Symbol is not an identity. |
| Relay lowercases EVM, LI.FI checksums it | Dedupe must case-fold EVM, and *only* EVM. |
| Relay spells EVM native as the zero address | Normalized to the `0xeee…` sentinel. |

### Capability matrix — discovery only

| Chain | Source | Search | Exact address |
|---|---|---|---|
| ethereum, arbitrum, optimism, base, polygon, avalanche, bsc | Relay + LI.FI | ✅ | ✅ |
| monad | Relay + LI.FI | ⚠️ in maps, per-token coverage unmeasured | ⚠️ |
| solana | Jupiter tokens/v2 | ✅ | ✅ |
| bitcoin, cardano, polkadot | none (by design) | — | — |

`DEX_CHAINS` is **unchanged** — no network was added.

---

## Stage 2 — execution safety

### The trust problem

`swap:execute` received a `NormalizedSwapQuote` **object from the renderer** and
signed it. Every material term — calldata, router, recipient, approval spender,
minimum received — round-tripped through the untrusted side. Structural
validation cannot close that: `0xdead…beef` is a valid address and a substituted
router is valid calldata.

**Now:** the privileged layer stores the quote it issued (`swap-intent.ts`),
returns only an opaque `intentId`, and on execute **signs its own stored copy**.
The submitted object is used solely to look up the intent and to diff against it
so tampering is reported rather than silently dropped. Intents are single-use,
account-bound, TTL-bounded, and in-memory by design (never persisted — that
would create a replayable on-disk record of signable transactions).

### The gate — `src/main/swap-policy.ts`

Runs where the keys are, not in the UI. Classification is by **address**, never
symbol (minting a token called "USDC" is trivial; minting one at a curated
address is not).

| Tier | Same-chain | Cross-chain |
|---|---|---|
| **curated** (both sides in `swap-curated-tokens.ts`) | allowed; simulation advisory | allowed — existing behaviour |
| **broad** (anything discovery unlocked) | allowed **only** with a valid minimum received **and** a simulation that ran and passed | **REFUSED** |

Curated pairs keep their pre-discovery behaviour on purpose: a simulation we
could not *run* (dead RPC) must not break a swap that has always worked. A
simulation that definitively *reverts* blocks both tiers — that is evidence,
not the absence of it. Broad swaps fail **closed**.

The curated list moved to `src/shared/swap-curated-tokens.ts` so the UI and the
gate read one source. A renderer-owned list could widen the policy set.

### Other Stage 2 fixes

| Fix | Why it mattered |
|---|---|
| `waitForEvmReceipt` now throws on `status: 'reverted'` | It **discarded the receipt**. A reverted ERC-20 approval read as success, and the swap fired against an allowance that was never granted. |
| Allowance is read before approving | Saves gas, and some tokens (USDT) revert on a non-zero→non-zero approve, so a needless re-approval could fail a working swap. |
| Quote freshness re-checked **after** the approval mines | An approval can take minutes; a quote lives ~30s. Stops rather than executing a route priced minutes ago. The approval stands and is reported, so re-quoting needs no second approval. |
| Nonce pinned; reconciled on ambiguous broadcast | A send that times out may still have landed. If the nonce advanced, it refuses to retry instead of double-spending. |
| Solana: fee payer and signer count verified, then simulated before broadcast | The send loop runs `skipPreflight` (deliberately, for rebroadcast), so this is the only point a doomed transaction is caught. |
| Minimum received threaded end-to-end + shown in the UI | It is the number the trade actually reverts below. Absent, zero, above the quote, or inconsistent with stated slippage all reject for broad tokens. |

### Stage 2 review fixes

Four findings from the Stage 2 review, each reproduced before being fixed and
pinned by a regression test:

| Finding | Reproduced as | Fix |
|---|---|---|
| **The stored quote was mutable through the Capacitor caller.** `wallet-local.ts` calls `handle()` in the same JS realm — no serialization — and `bindSwapIntent` returned the very object it stored, nested `txData` included. | `held.quote === issued` → `true`; `issued.txData.to = attacker` rewrote the wallet's own record, and the submitted-vs-stored diff saw nothing because both sides were one object. | Deep-copy in BOTH directions and deep-freeze the stored copy. Each consumer gets a fresh copy, so mutation during async execution cannot reach validated terms. Copying stops reference sharing; it does **not** create process isolation on Android/iOS, where renderer and wallet share one heap — that boundary is a discipline this module enforces, and the header says so. |
| **The slippage validator silently allowed five extra percentage points.** `MIN_RECEIVED_TOLERANCE_BPS = 500` was added to the approved slippage. | `{buyAmountRaw: 10000, minBuyAmountRaw: 9450, slippageBps: 50}` → `{ok: true, shortfallBps: 550}`: a quote displaying 0.5% accepted a floor 5.5% below expected output. | Validate against the EXACT approved bound in integer arithmetic, with one raw output unit of rounding headroom — not a percentage tolerance. Invalid, non-finite and out-of-range slippage are rejected outright. Fees are not folded in: a fee that reduces receipt belongs in the quoted output where it is visible. |
| **A derived minimum plus a passing `eth_call` was treated as an enforced floor.** | — | `minReceivedSource` now records provenance (`provider` vs `derived`) end to end. A broad token executes only on a PROVIDER floor from an adapter whose floor semantics are established, so a renamed provider field degrades to `derived` and refuses rather than silently becoming a verified-looking number. `eth_call` proves the route works now; it does not prove the payload contains the displayed bound. |
| **The intent bound an account INDEX, not a signing identity.** Index 0 means a different wallet after an import. | — | Intents bind a fingerprint of the wallet's public addresses, the account index, the environment, and the canonical source/destination addresses the wallet itself derived — re-derived at execute time and compared. The provider's response is validated against the canonical request (chains, tokens, amount, recipient), and a forged `taker` cannot become a signable intent. Pending authorizations are dropped on lock and on wallet import. No secret material is stored. |

Also fixed in the same pass: `executeBoundSwap` released an intent on any
preflight error, including after an approval had been broadcast. Broadcast state
is now tracked explicitly, release refuses once anything reached the network, and
error messages no longer say "Nothing was sent" when an approval went out. Quote
freshness is re-checked immediately before signing, not only after an approval
mines. A nonce that cannot be READ now refuses to send rather than sending
unpinned — an unpinned send is precisely the case that cannot be reconciled.

### Minimum received — provider sources

| Provider | Field | Status |
|---|---|---|
| Jupiter | `otherAmountThreshold` | **verified live** — exactly `outAmount × (1 − slippage)` |
| LI.FI | `estimate.toAmountMin` | **verified live** — exactly `toAmount × (1 − slippage)` |
| 0x | `minBuyAmount` | per docs; needs a key to exercise |
| Uniswap / Rango / SwapKit | documented field, several spellings tried | per docs; needs a key to exercise |
| 1inch v6 | none returned | derived from accepted slippage |

Unverified field names fall back to a derived floor, so a renamed field degrades
rather than shipping a bogus number. A *derived* floor is not proof the router
enforces it — which is exactly why broad swaps also require simulation.

---

## Verification

| Layer | Method | Result |
|---|---|---|
| Identity core | 29 unit tests | pass |
| Policy + intent | 36 unit tests | pass |
| Execution gate | 9 tests through the real `executeSwap` / `executeBoundSwap` | pass |
| Fee policy + Worker parity | 42 unit tests, importing BOTH copies of the policy | pass |
| Fee verification (client) | 23 unit tests incl. real serialized Solana transactions | pass |
| Settlement accounting | 20 unit tests (charge-once, refund, partial, idempotence) | pass |
| Session registry | 8 unit tests incl. a simulated restart | pass |
| Full suite | **1251 tests / 78 files** | pass |
| Safe-route selection (field reports) | 4 tests: outdated Worker named, unsignable LI.FI excluded, Relay offered; mutation check: disabling the filter fails 3 | pass |
| Relay floor tightening | 4 tests incl. a mocked re-ask; live EMO→MON floor 2.48% at 2.50% | pass |
| Routing policy | 23 unit tests + Worker-mirror parity | pass |
| Provider-aggregated quoting | 7 tests: `pickBestRoute` directly, staged-vs-concurrent regression, imported-chain numeric-id quoting | pass |
| Imported-network eligibility (provider-aggregated) | 22 tests incl. via 0x/1inch alone, with NO LI.FI/Relay coverage | pass |
| Execution-gate boundary for imports | 1 test pinning the REFUSAL (quotable ≠ executable, on purpose) | pass |
| Executor chain-id gap (Robinhood/Arc/etc.) | 13 new tests + existing `chain-parity.test.ts` | pass |
| Live LI.FI PARTIAL/REFUNDED | 5 RECORDED LIVE responses through the real Worker + real client mapper | pass |
| Destination terms | 11 unit tests on RECORDED LIVE route shapes | pass |
| Network resolver | 14 unit tests incl. dynamic eligibility for imports | pass |
| Relay adapter | 20 tests: step validation, real refund/failure/success records, the real pre-signing validator | pass |
| EMO→PIXL regression | 14 tests on RECORDED LIVE Relay responses at three amounts | pass |
| Relay persisted path | 5 session tests; mutation check confirms the refund regression is caught | pass |
| Worker `/quote` (Relay) | `wrangler dev`, live EMO→PIXL at 100 / 100,000 / 10M EMO | too-low / fee-paying Relay quote / impact-too-high |
| Worker `/swap/chains` (v1 shape, prior pass) | `wrangler dev`, live | 70 LI.FI + 60 Relay chains |
| Worker `/swap/chains` v2 live-list shapes | direct probe of `li.quest`/`api.relay.link` response shapes this pass reads | LI.FI 71 chains (`chainType` EVM/SVM present); Relay 60 chains, 0 disabled, `vmType` present |
| Provider documented-chain lists | read from the RAW page at each URL (0x, 1inch, Uniswap, SwapKit, Rango docs), not a summary | transcribed into `DOCUMENTED_CHAINS` |
| Popup layout | Playwright at 400×600, real extension | no overflow; new chains listed, BSC absent |
| Worker `/tokens` | `wrangler dev` (real workerd + KV) vs live providers | pass |
| Worker `/quote` | `wrangler dev`, real keyless LI.FI + Jupiter routes | `appFee.verification === applied-verified`, dust and misconfiguration refused |
| Worker bundle | `wrangler deploy --dry-run` with `FEE_BPS=100` | pass |
| Picker UI | Playwright, real unpacked extension + screenshots | pass |
| Electron smoke | navigates every tab incl. Swap | pass |
| Typecheck | all 5 tsconfigs | pass |
| Desktop / Extension | `npm run build`, `build:extension` | pass |
| Android | `build:capacitor` + **real `gradlew assembleDebug`** | BUILD SUCCESSFUL |

The gate tests were confirmed non-vacuous by probing what each case actually
throws: a broad cross-chain quote raises `SwapPreflightError` **before any key
derivation**, while a curated pair gets through the gate and fails later at
`Invalid mnemonic` — i.e. in the real execution path.

**iOS: NOT verified.** It cannot be built on Windows, and per the current
instruction it is not being chased. `src/shared/**` was added to `ios.yml`'s push
path filter so a change to the shared swap core can no longer ship unbuilt; that
workflow has not been run. Nothing else in the build/release configuration was
touched.

**No transaction was signed or broadcast. No funds moved.** No real-funds QA has
been performed and none is authorized.
*(Superseded 2026-09-23: the wallet owner has since run real swaps from this
wallet. See "Real-wallet evidence and acceptance measurements" at the end.)*

---

## Deploy order (unchanged, still on hold)

1. Deploy the Worker **first** — it is backward compatible (clients derive a
   minimum received when the Worker does not send one, and an empty `/tokens`
   falls back to curated entries).
2. Verify `/tokens?chain=base&q=degen` and that `/quote` returns `minBuyAmountRaw`.
3. Then ship clients.

**Rollback:** revert `cloudflare-worker/tokens.js` plus the two `swap-proxy.js`
route lines; the picker degrades to curated + held tokens. For the client, the
gate is a pure addition — reverting `swap-policy.ts`/`swap-intent.ts` and the two
handler call sites restores the previous behaviour. No persisted state or wire
format changed, so there is nothing to migrate back.

`TOKENS_RPM` (default 120/min per IP) caps discovery. Every cache miss spends
Jupiter/Relay quota, which is per-key for the whole user base.

---

## Remaining gaps - NOT done

**Closed since earlier drafts:** the lifecycle mapper (verified against real
provider records), the persisted session store, the restart-safe status card, the
fee-gap ranking, the silent fee-free fallbacks, the four Stage 2 review findings,
the destination-guarantee model (was dead code, now wired end to end), the
hand-kept `DEX_CHAINS` list, **Relay execution**, **the structural block on
imported custom networks**, **the two-tier fee-first route selection** (replaced
by the routing policy), **same-chain routing being staged instead of
concurrent**, and **an imported network's quote always failing** (numeric-id
fallback).

Still open:

- **An imported network can now be quoted but still cannot be SIGNED.**
  `checkChainCapability` resolves only against the static built-in matrix; a
  fully-formed import quote is refused at the signing gate on purpose (see
  "Imported custom networks" above), pending a safely-designed extension that
  re-derives capability synchronously at signing time rather than trusting the
  picker or the quote.
- **Rango and SwapKit are not covered by the imported-network numeric-id
  fallback.** Both route by a provider-specific NAME, not a numeric chain id;
  an import can currently only reach them if it happens to share a built-in's
  NAME mapping, which it structurally cannot (imports never shadow a built-in).
  Rango's name mapping is buildable live from `/basic/meta` (already captured
  as `identifiers` in `swap-chains.js`, not yet read by `rangoQuote`); SwapKit
  has no equivalent lookup built yet.
- **The routing policy's tolerance (25 bps / $10) is a considered default, not a
  measured-optimal one.** It has not been tuned against real quote-to-quote price
  movement data; it was set from the existing auto-slippage floor (50 bps for
  blue chips) and the fee size itself, and is versioned so it can be revisited
  without ambiguity about which rule produced a past selection.
- **USD valuation for route comparison is real but partial.** Only LI.FI and
  Relay currently report it in the fields the Worker reads; 0x, 1inch, Uniswap,
  Rango and SwapKit routes compare on raw net output alone when mixed with a
  priced route, which is honest (no guessed cost) but coarser than a fully
  cost-normalized comparison would be.

- *(Superseded 2026-09-23 by "Real-wallet evidence and acceptance measurements":
  four swaps settled from the owner's wallet, not a designated QA wallet.)*
  **Nothing has been executed with real funds.** Every "executable" claim rests on
  the real gate and validator run over recorded provider payloads. Real-funds
  execution remains on hold and unauthorized. EMO→PIXL in particular has been
  quoted live and gated; it has never been signed.
- *(Superseded 2026-09-23: Relay's payout was confirmed by the app; LI.FI's and
  Jupiter's were confirmed on-chain by hand. See the evidence section.)*
  **No payout has been verified for any provider.** Relay's reconciliation is
  built and tested against the real record shape, but no swap of ours has settled
  for it to read.
- **Relay app fees cannot be confirmed at signing time.** The recipient is held
  in Relay's off-chain intent, not the signed bytes, so a fee-paying Relay route
  is trusted on Relay's quote and checked only after settlement. If `payout`
  starts coming back `mismatch`, Relay's fee tier should be disabled.
- **Relay is cross-chain only in this wallet**, and **EVM sources only**. Relay
  also quotes same-chain and Solana-source routes; neither is wired.
- **Relay rate limits.** Keyless Relay allows a limited quote rate and the Worker
  is a shared egress IP. `RELAY_API_KEY` is read if set; none is configured.
- **Rango/SwapKit remain refused for broad routes.** Rango's lifecycle is mapped
  from docs but never seen live, and its minimum field spelling is unconfirmed;
  SwapKit's THORNode status has no partial/refund concept we map.
- **LI.FI's `FAILED + REFUND_IN_PROGRESS`** and **Relay's `delayed`/`waiting`**
  are mapped from docs only; neither has been observed live.
- **Imported networks are eligible, not measured.** An eligible import is
  `implemented-unverified` — listed by a provider and signable, with no pair
  quoted on it.
- `apechain`, `ronin` and `arc` same-chain results are from a dust-sized probe
  and are NOT confirmed negatives; keyless LI.FI rate-limited before they could
  be re-measured at a realistic size.
- **Zora** is routed by Relay only (LI.FI rejects the chain). With the Relay
  adapter it is now executable in principle, cross-chain; no Zora pair has been
  quoted, so it stays `implemented-unverified`.
- An MV3 service-worker suspension between quote and execute loses the intent and
  forces a re-quote. Fails closed; a SESSION survives it, the signable intent
  deliberately does not.
- Simulation is `eth_call` only — no state-override or token-tax modelling, so a
  transfer-fee token can pass simulation and still deliver less than quoted.
- Token-2022 transfer fees and transfer hooks are surfaced in discovery but not
  modelled in the amount maths.
- 0x/Uniswap minimum-received AND fee field names are unexercised (no keys here).
  Both fail closed if a field is renamed.
- Solana fee collection needs a referral token account per output mint. BONK has
  none, so Jupiter drops those routes and LI.FI carries them; creating more
  accounts costs rent and needs explicit authorization.
- Normalization is duplicated between `tokens.js` (Worker, no TS build) and
  `swap-token-identity.ts`, and the fee policy between `swap-fee.js` and
  `swap-fee-policy.ts`. The fee pair has a parity test (now including Relay); the
  token pair is re-validated client-side.
- **iOS is UNVERIFIED and deliberately not pursued.** It cannot be built on
  Windows. `src/shared/**` is in `ios.yml`'s push path filter so shared swap code
  cannot ship unbuilt, but that workflow has not been run.

### The other agent's UI changes — reviewed, no conflict

`DashboardPage.tsx`, `MarketPage.tsx`, `SwapPage.tsx` and `index.css` carry
layout changes from the other agent. They are preserved as-is.

- `index.css` adds only `.network-grid` rules, scoped to the Networks tab; no
  swap class is touched.
- `DashboardPage`/`MarketPage` do not touch the swap flow.
- `SwapPage` widens the swap column (440→520px) and centres it vertically. This
  IS in the swap flow, so it was checked at the real popup size (400×600) in the
  real extension: no horizontal overflow, and the network pickers render the
  registry-derived list. The token picker is a fixed overlay and is unaffected.

No concrete conflict found.

---

## App fee (1%) — monetization

### The policy

One rate, one place: `src/shared/swap-fee-policy.ts`, mirrored for the Worker in
`cloudflare-worker/swap-fee.js` and held in step by a parity test that fails if
they drift.

**100 bps charged to the user, replacing the previous 90.** Not added to it. The
Worker's `FEE_BPS` and `FEE_*` recipients are now VALIDATED against that policy
rather than trusted: a rate outside 0–150 bps, or a recipient that is not the
checked-in beneficiary, makes the Worker refuse to quote — because the wallet
validates the same values before signing and would refuse anyway.

Provider revenue shares are reported separately and are NOT added on top of the
user's 1%. Where a provider's share is unknown it stays `null` — never 0.

### Three different claims, kept apart

| | what it means | who can establish it |
|---|---|---|
| **requested** | we asked the provider to charge it | our own request — not evidence |
| **applied** | the response states what it charged, and it reconciles to 100 bps of the base it names | the quote response |
| **collected** | the money reached us | only a settled swap session, never a quote |

### Two tiers: preferred, not mandatory

An earlier revision of this work refused any route that could not prove an
applied fee. That protected revenue by deleting working swaps, which is the wrong
trade, and it has been reversed:

| | |
|---|---|
| **Tier 1** | the provider's response confirms an applied 1% to one of our beneficiaries |
| **Tier 2** | no app fee is charged at all, and the UI says so |

Tier 1 wins whenever it has an executable route; within a tier the winner is the
highest ACTUAL net output. Because the tier is chosen before price is compared,
**the served route is the best route that pays us, which is not necessarily the
best route that exists** - nothing in the product calls it the cheapest.

A tier-2 fallback asks the provider for NO fee rather than requesting one it
could not account for, so the honest statement is "no Magic Money fee on this
route" instead of an unexplained 1% charge. Provider, bridge and network costs
are unaffected: a fee-free route is not a free route.

**1inch, Rango and SwapKit serve routes again.** They were excluded only because
their fee is unverifiable. Their other limits were re-checked rather than
relaxed - 1inch still returns no minimum-received floor so it still cannot carry
a broad token, and SwapKit's status vocabulary is still unmapped so it still
cannot carry a broad cross-chain route.

### Three fee states, never two

| State | Meaning | Revenue? |
|---|---|---|
| `verified` | the provider stated an applied fee and it reconciles | yes |
| `confirmed-none` | we asked for no fee and none was applied | no - and it is not a failure |
| `unknown` | we asked for a fee and cannot tell what happened | **no, and never rendered as zero** |

`classifyFeeStatus` derives this in one shared place, so the quote card, the
Worker's tier selection and the revenue accounting cannot disagree. The settlement
store has a matching `no-fee` outcome kept apart from `not-collected` (a failed
attempt) and `unknown` (missing information).

### What still blocks signing

Not being paid does not. `checkQuoteFeeIntegrity` refuses exactly three things:

- a "Magic Money fee" that would be paid to an address that is not ours
- terms carried over from a policy version the user never saw
- a fee the user is told they are paying that the transaction does not actually
  pay (the recipient is nowhere in the payload)

These are disclosure and tampering failures. Everything else about fees is a
routing and accounting question.

### The silent fallbacks that are still gone

The policy change restores fee-free ROUTES; it does not restore fee-free
SURPRISES. All three of these remain deleted:

- **Jupiter's fee-less retry.** It caught any error mentioning "fee", "account"
  or "referral" and re-quoted with no platform fee, inside the adapter, invisibly.
  The replacement is a deliberate tier-2 path chosen by the ROUTER with both
  options in hand and reported to the user as "no Magic Money fee".
- **The EVM fee-gap ranking.** It discounted each quote by the fee it had NOT
  charged and then returned that quote unchanged - an accounting fiction in both
  directions. Ranking is now real net output only, within a tier.
- **Unconditional first-success fallbacks.** Every exit from `handleQuote` is
  tier-classified, and the ordered branches gather all results before choosing, so
  a later provider that CAN pay is not beaten merely by being later in the list.
- **The direct LI.FI path** (which bypasses the Worker entirely) runs the same
  gate in the client. It used to carry its own hardcoded 90 bps that no Worker
  deploy could correct.

### Provider capability / payout matrix

"Code verified" = the check runs and is tested. "Payout verified" = money was
observed arriving. **Nothing below is payout verified. No transaction has been
signed or broadcast.**

| Provider | Fee base | Mechanism | Code verified | Measured live | Carries routes? |
|---|---|---|---|---|---|
| **LI.FI** | input | registered integrator `ChainLens` | applied amount + integrator named in `feeSplit.recipients` | **yes, keyless, 19 Sep 2026** | **yes** |
| **Jupiter v1** | output | referral token account (PDA per mint) | `platformFee` reconciles to 100 bps of gross out; fee account validated on-chain AND confirmed present in the transaction's account keys | **yes, keyless, 19 Sep 2026** | **yes, where the mint's fee account exists** |
| **0x v2** | output (input fallback) | `swapFeeRecipient` + `swapFeeBps` | `fees.integratorFee` reconciled; recipient bytes sought in calldata | no — needs a key | yes, if the response matches its documented schema |
| **Uniswap** | output | `portionBips` + `portionRecipient` | portion reconciled; output normalized to net (their quote is GROSS) | no — needs a key AND Uniswap-side fee enablement | yes, once enabled |
| **1inch v6** | n/a | quoted fee-free | n/a | n/a | **tier 2** - v6 states no applied amount |
| **Rango** | n/a | quoted fee-free | n/a | n/a | **tier 2** - no applied-fee echo |
| **SwapKit v3** | n/a | quoted fee-free | n/a | n/a | **tier 2** - beneficiaries unreadable from here |

The last column is which TIER a provider can reach, not whether it may serve a
swap. All seven serve swaps. Each tier-2 entry is one measured response away from
tier 1 (`maxVerification` in the policy table); until then we forgo that revenue
rather than bill for it unaccountably. **That forgone revenue is a real cost and
is stated here rather than hidden**: with no 0x or Uniswap key configured, every
same-chain EVM route currently settles through a fee-free provider or LI.FI.

### Measured evidence (read-only, no keys, nothing signed)

LI.FI `GET /v1/quote`, 0.1 ETH on Base, `fee=0.01&integrator=ChainLens`:

```json
"feeSplit": {
  "lifiFee":       "250000000000000",
  "integratorFee": "1000000000000000",
  "recipients": [{"name":"lifi"},{"name":"ChainLens","fee":"1000000000000000"}]
}
```

- exactly 100 bps of the INPUT, and `included: true` (already inside `toAmount`)
- LI.FI charges its own **0.25%** either way — reported as an EXTERNAL cost, never
  as our revenue
- the same call with an unregistered integrator is **refused, HTTP 400**
  ("not configured for collecting fees"), which is what makes this checkable —
  and which confirms `ChainLens` IS registered for fee collection

Jupiter `lite-api.jup.ag/swap/v1`, 1 SOL → USDC, `platformFeeBps=100`:

- `platformFee: {"amount":"1101809","feeBps":100}`, and `outAmount` is already net
  (110180976 gross − 1101809 = 109079167)
- `/swap` **refuses to build** without a `feeAccount` once the quote carries a
  platform fee (400 `NOT_SUPPORTED`)
- but it accepts **any** pubkey as that account without checking that it exists or
  matches the mint — it simply embeds it. So the wallet validates the account
  on-chain (exists, owned by a token program, initialized, correct mint) and then
  confirms that same pubkey is in the transaction's static account keys.

On-chain, mainnet: referral account `9vBwk…` exists and is owned by the Jupiter
referral program. Its referral token accounts exist for **USDC** and **wSOL**, and
**not for BONK**.

Through the real Worker (`wrangler dev`, live keyless providers):

| Route | Result |
|---|---|
| Base→Arbitrum USDC | lifi, `applied-verified`, fee `500000` (1% of 50 USDC); LI.FI's `125000` listed separately |
| Base ETH→USDC same-chain | lifi, `applied-verified`, fee `1000000000000000` |
| SOL→USDC with the real referral ATA | jupiter, `applied-verified`, fee `1103672` = 1% of gross out |
| SOL→BONK with no fee account | Jupiter cannot charge; LI.FI carried it **in tier 1 with the fee applied** - the "try another verified fee-paying route" path, working |
| 99 raw units of USDC (dust, 1% floors to zero) | **served in tier 2**: `confirmed-none`, `amountRaw: "0"`, `recipient: null`. Under the previous policy this trade was refused outright. |
| `LIFI_INTEGRATOR` hijacked to another name | **refused**: "Configured LI.FI integrator does not match the fee policy" |
| `FEE_BPS=900` | **HTTP 500**, "FEE_BPS is not a valid app fee rate (0–150 bps)" |

### Where the fee is enforced

In the privileged layer, on the STORED intent, at signing time — not only at
quote time:

1. `swap-proxy.ts` verifies every quote before returning it (Worker AND direct).
2. `swap-intent.ts` binds the fee record into the deep-frozen intent and includes
   it in the tamper diff, so the terms the user approved are the terms that
   execute, and a superseded policy version cannot become signable.
3. `swap-policy.ts` re-verifies at execution, **before** the tier rules.

A verified fee unlocks nothing on its own: broad cross-chain is still refused, and
broad tokens still need an enforceable provider floor plus a passing simulation.
There is a test for exactly that.

### Display

The quote card shows the Magic Money fee as an **amount in its real token** with
the percentage beside it, material external costs (LI.FI's 0.25%, bridge fees) on
their own rows labelled as not-ours, then "You receive" (net) and "Minimum
received" — the last marked "estimate" when it is not an enforceable floor. The
old single "Fee 0.90%" row could not even identify which token it referred to.

---

---

## Broad cross-chain - the EMO -> PIXL investigation

The UI found an EMO(Monad) -> PIXL(Ethereum) quote and blocked it with:

> "Cross-chain swaps are limited to the wallet's verified token list for now.
> Bridge tracking cannot yet tell a partial delivery or a refund apart from a
> completed swap..."

**That explanation was stale.** All three things it blamed were fixed in Stage 3:
`lifiStatus` no longer flattens DONE, sessions survive a restart, and refunds and
partial deliveries are reported as themselves. The message has been removed rather
than left to mislead.

The gate was NOT simply deleted. A bridge cannot give the atomic guarantee a
same-chain swap gives: if the destination leg fails you receive the bridged
intermediate asset, rather than the transaction reverting. So a broad cross-chain
swap is admitted only when all four hold:

1. the provider states its own destination floor (`minReceivedSource: 'provider'`)
2. that provider's floor semantics are verified (`MIN_ENFORCEABLE_PROVIDERS`)
3. that provider's LIFECYCLE semantics are verified too, so a partial or a refund
   is reported as one (`LIFECYCLE_VERIFIED_PROVIDERS`)
4. settlement tracking is active, so the outcome survives a restart

| Provider | floor verified | lifecycle verified | broad cross-chain |
|---|---|---|---|
| LI.FI | yes (measured) | yes (measured) | **allowed** |
| Rango | no - field spelling unconfirmed | yes (from docs) | refused |
| SwapKit | no | **no** - THORNode status has no partial/refund concept we map | refused |

### Minimum receipt, cross-chain — three capabilities, kept apart

An earlier version of this document said the cross-chain floor was "enforced by
DETECTION". That was wrong, and the wording mattered: detection runs after the
money has moved and can only change what the user is TOLD. These are three
different things and only the first makes an amount guaranteed:

| Capability | What it does | Where |
|---|---|---|
| **transaction-enforced** | the payload reverts below the floor; the user keeps their input | same-chain only (`minReceivedScope: 'atomic'`) |
| **provider guarantee** | the provider commits by its own mechanism, with its own failure mode | `'provider-guaranteed'` |
| **post-settlement detection** | compares what arrived against what was approved and reports honestly | `applyDestinationShortfall` |

`src/shared/swap-destination.ts` computes which applies, from the route itself,
in the privileged layer — never from a `destination` field a backend sent, since
that is the claim being checked. It is bound into the intent with the rest of the
quote and shown in the quote card before signing.

**Measured 2026-09-20, from recorded live LI.FI routes** (Base ETH → Arbitrum ARB):

- `protocol > cross > swap` (bridge-then-swap, via `across`): the bridge delivers
  **WETH on Arbitrum**, then a second leg swaps it to ARB. If that leg cannot
  fill, the user holds **WETH on Arbitrum** — the destination chain — and getting
  ARB needs **another transaction**. Scope: `destination-conditional`.
- `protocol > cross` (single step, via `layerswap`/`relaydepository`): the bridge
  delivers the requested token itself; there is no destination leg to fail.
  Scope: `provider-guaranteed`.

This matches what really happens: every recorded live `DONE/PARTIAL` transfer
left the user holding the bridged intermediate on the destination chain, and
every `DONE/REFUNDED` returned the source token on the source chain.

A broad cross-chain route is refused when the fallback asset cannot be
identified, so the user is never asked to approve a failure mode we cannot
describe. Settlement tracking is required too, but as a REPORTING precondition —
it does not satisfy any execution-safety requirement on its own.

### What this means for EMO -> PIXL specifically

Re-investigated 2026-09-20 with EXACT-ADDRESS quotes, because absence from a
provider's token list proves nothing about routability:

- EMO on Monad: `0x81a224f8a62f52bde942dbf23a56df77a10b7777` (18 dp, Relay flags
  it unverified)
- PIXL on Ethereum: `0x427a03fb96d9a94a6727fbcfbba143444090dd64` (18 dp)

**Relay CAN execute this pair, with source-chain signing only.** Quoting
100,000 EMO returns steps `approve > deposit` where **both items are on chain
143** — the source chain — and it returns ~25,408 PIXL. Nothing asks for a
destination-chain signature, so `allowSwitchChain` does not need to change and
has not been changed.

Amount matters, and the earlier "no route" conclusion did not account for it:

| Amount | Relay result |
|---|---|
| 100 EMO | `AMOUNT_TOO_LOW` — output cannot cover execution fees |
| 100,000 EMO | **routes**, `approve > deposit`, source-chain only |
| 10,000,000 EMO | `SWAP_IMPACT_TOO_HIGH` (-37.5%) |

Relay also states its own floor — `details.currencyOut.minimumAmount`, measured
at exactly the quoted 200 bps tolerance — and returns a `requestId` for status.

**Now implemented through the Relay adapter — see the next section.** All four
prerequisites that previously blocked it are met, each with its own evidence. It
passes the broad cross-chain gate end to end in tests, and a live EMO→PIXL quote
through the real Worker returns a fee-paying, provider-floored, source-chain-only
plan. It has **not** been executed: no transaction was signed or broadcast.

LI.FI was not re-probed for this pair (keyless rate limit at the time); its
earlier `allowSwitchChain` finding stands unretested.

---

## Relay execution adapter

`cloudflare-worker/swap-relay.js`. Relay is a **solver** network: it fills the
whole intent or refunds the deposit, so there is no bridged intermediate to be
left holding — a better failure mode than bridge-then-swap, but still the
provider's promise, never the transaction's (`provider-guaranteed`).

### What it will execute — checked on every route

The EMO→PIXL route being `approve` + `deposit` on the source chain is a property
of that route, not of Relay. `validateRelaySteps` refuses, naming the reason:

- any item not on the **source** chain (a destination-chain signature);
- any step that is not `kind: 'transaction'` (e.g. an EIP-712 signature step);
- unknown step ids, duplicate approvals or deposits, multi-transaction steps,
  missing calldata, or no deposit at all;
- a non-standard approve, or an approval whose **spender is not the deposit
  target** — otherwise a route could approve one contract and deposit into
  another, leaving a standing allowance nobody used.

The recorded route's approval is **exact-amount** (100,000 EMO = the sell
amount), not unlimited, and the normalized plan passes the real pre-signing
validator (`validateSwapQuoteForExecution`) unchanged — Relay's approve + deposit
map onto the executor's existing approval + swap path, so it inherits intent
binding, simulation, freshness re-checks, nonce pinning and broadcast recovery
rather than getting a parallel, less-tested path.

Relay's `check.endpoint` is followed only as a relative path on Relay's own API;
an absolute URL a provider hands back is ignored.

### Three minimums, still kept apart

| | Relay |
|---|---|
| provider-stated floor | `details.currencyOut.minimumAmount` — measured at exactly the quoted slippage below `amount` |
| transaction-enforced | **no** — the solver fills or refunds; nothing in the signed deposit reverts below it |
| post-settlement detection | the lifecycle mapper, plus the shortfall check on `completed` |

### The fee — honest about what it proves

`appFees: [{recipient, fee: '100'}]` → `fees.app` reports the applied amount,
denominated in the **source chain's USDC**, not the sell token. So:

- the rate can only be measured as a ratio of two USD figures. Live on EMO→PIXL
  it read **98 bps** repeatably. The tier check compared `appliedBps` exactly, so
  a genuine 1% route was being demoted to the **fee-free fallback**. Within ±5 bps
  of the request the requested rate is now recorded as applied and the measured
  figure stays in the evidence; outside it the route is not fee-verified.
- **the recipient is not in the signed bytes at all.** The 8,330-character
  deposit calldata contains our fee address nowhere; Relay holds it against the
  `requestId`. That is a genuinely weaker guarantee than an address in the
  payload, so it is modelled as its own recipient kind, `provider-intent`, rather
  than as an exemption. The payload-binding check does not look for an address
  that is never there; it instead refuses a fee-bearing Relay quote with **no
  `requestId`**, because then the fee could never be reconciled.
- **payout reconciliation.** Relay's request history names who was actually
  paid (`data.paidAppFees[]`: recipient, bps, amount). Settlement reads it and
  records `payout.status`: `confirmed` when our beneficiary is listed,
  `mismatch` when fees were paid to others but not us — recorded, never hidden.
  Tested against a REAL settled record that paid three other integrators.

### Lifecycle — verified against real records

`api.relay.link/requests/v2` publishes settled requests, filterable by status.
Real `success`, `refund` and `failure` records are fixtures.

The trap: on a **refund**, `metadata.currencyOut` still names the token the user
ASKED for on the destination chain, while the money went back on the **source**
chain. Both recorded refunds show it — in/out on chain 8453 while `currencyOut`
says M87 on chain 1; in/out on chain 56 while `currencyOut` says FRONG on chain
4663. A mapper reading `currencyOut` would report a refund as a perfect delivery.

### A bug found while wiring it

The persisted, restart-safe reconcile loop carried its own
`provider === 'rango' ? … : …` dispatch and never learned about Relay, so a Relay
refund showed correctly on the live card but was **stored as `unknown`** — the
exact live-vs-resumed disagreement the shared mapper was supposed to rule out.
Both paths now go through one `mapStatusForProvider`. A mutation check confirms
the regression test catches it: restoring the old dispatch fails 3 tests.

### Measured live through the real Worker (2026-09-21, read-only)

| Amount | Result |
|---|---|
| 100 EMO | refused — "Swap output amount is too small to cover fees" |
| 100,000 EMO | **Relay, fee-paying** — `applied-verified`, provider floor, approve + deposit, requestId, refund in USDC on chain 143 |
| 10,000,000 EMO | refused — "Swap impact is too high: -37.90%" |

Relay's own words are surfaced rather than collapsed into "no route", because
both tell the user what to change.

## Provider failures explain themselves

Reported from the running app, swapping EMO (Monad) -> PIXL (Ethereum):

> rango: Unexpected token '<', "<!DOCTYPE ... is not valid JSON |
> swapkit: SwapKit: unsupported chain

Two defects in one screen:

1. **Rango answered with an HTML error page and the adapter called `res.json()`
   on it.** Each adapter's thrown message becomes the reason shown in the swap
   screen, so the JSON PARSER's complaint became the explanation for the failed
   swap. It named the symptom and hid the cause. All provider responses now go
   through `readProviderJson`, which reports
   `Rango returned an HTML error page (HTTP 503)` instead.
2. **LI.FI was missing from the list entirely.** Its direct-path failure was only
   `console.warn`ed, so the provider most likely to carry a cross-chain pair
   contributed nothing to the explanation. Its reason is now collected with the
   others.

The same request now reads:

> rango: Rango returned an HTML error page (HTTP 503) | swapkit: SwapKit:
> unsupported chain | lifi: Rate limit exceeded, retry in 2 hours

Pinned by `src/main/swap-quote-errors.test.ts`, which drives the real Worker with
an HTML-answering Rango and asserts the parser error can never come back.

---

## Network coverage

### One registry, not two lists

`DEX_CHAINS` was nine chains typed out by hand in the renderer, and it had
drifted from the wallet's own registry **in both directions**:

- it offered **BSC**, which this wallet has no network for at all; and
- it omitted **Robinhood Chain, Arc, Abstract, HyperEVM, World Chain, Gnosis,
  Blast, Soneium, Ronin, ApeChain and Zora**, which the Networks tab shows and
  the providers do route.

Now identity comes from `chain-config.ts` (the same registry the Networks tab
uses) and capability from `swap-networks.ts` (measured, dated), joined by CHAIN
ID in `src/main/swap-network-resolver.ts` and served over `swapGetNetworks`. The
renderer displays the result; it never decides swappability. `DEX_CHAINS`
survives only as the pre-load fallback.

The same join is enforced again in the policy gate (`checkChainCapability`), so
a renderer offering a chain we never enabled still cannot get it signed.

### Network identity bugs found and fixed

| Fix | Evidence |
|---|---|
| **HyperEVM chain id 998 → 999** | `eth_chainId` on `rpc.hyperliquid.xyz/evm` returns `0x3e7` (999). 998 is HyperEVM **testnet**, and the registry used it for MAINNET — mainnet and testnet both claimed 998. A mainnet transaction signed for 998 would be rejected by replay protection. `NetworkSwitcher` carried the same 998 (announcing a testnet id to dApps) and had a `chainId !== 998` special case that existed only to paper over the collision; both are gone. |
| **World Chain native WLD → ETH** | `eth_chainId` confirms 480; LI.FI reports native **ETH**, 18 dp. WLD is an ERC-20 on World Chain, not its gas asset. Naming WLD mispriced the gas reserve. |
| **HyperEVM unblocked by the id fix** | Under its real id, LI.FI lists 6,891 tokens and every route quotes: same-chain HYPE→USD₮0 via `enso`, out to Ethereum and in from Ethereum via `relaydepository`, all signable. It had been recorded as "blocked — neither aggregator routes this chain", which was an artefact of the wrong id. |

### Measured coverage, 2026-09-20

Read-only LI.FI probes from a burn address. "same" = a quote returned signable
calldata for a real pair; "out"/"in" = cross-chain with a signable SOURCE
transaction and no destination-chain signature.

| Chain | id | LI.FI tokens | same | out | in |
|---|---|---|---|---|---|
| ethereum | 1 | 7416 | ✅ okx | — | — |
| arbitrum | 42161 | 1657 | ✅ nordstern | ✅ relaydepository | ✅ |
| optimism | 10 | 513 | ✅ 1inch | ✅ relaydepository | ✅ across |
| base | 8453 | 1691 | ✅ 1inch | ✅ relaydepository | ✅ across |
| polygon | 137 | 3248 | ✅ kyberswap | ✅ across | ✅ mayanFastMCTP |
| avalanche | 43114 | 529 | ✅ okx | ✅ layerswap | ✅ layerswap |
| monad | 143 | 247 | ✅ kyberswap | ✅ polymerStandard | ✅ mayanFastMCTP |
| **robinhood** | 4663 | 457 | ✅ nordstern | ✅ across | ✅ across |
| **arc** | 5042 | 69 | ✅ (mirror USDC) | ✅ lifiIntents | ✅ across |
| **abstract** | 2741 | 14 | ✅ fly (USDC.e) | ✅ relaydepository | ✅ stargateV2Bus |
| **hyperevm** | 999 | 6891 | ✅ enso / fly | ✅ relaydepository | ✅ relaydepository |
| worldchain | 480 | 18 | ✅ lifidexaggregator | ✅ polymerStandard | ✅ across |
| gnosis | 100 | 723 | ✅ sushiswap | ✅ stargateV2Bus | ✅ |
| blast | 81457 | 51 | ✅ okx | ✅ layerswap | ✅ relaydepository |
| soneium | 1868 | 25 | ✅ nordstern | ✅ across | ✅ across |
| ronin | 2020 | 34 | ✗ | ✅ glacis | ✅ relaydepository |
| apechain | 33139 | 7 | ✗ | ✗ | ✅ relaydepository |
| zora | 7777777 | 0 | ✗ | ✗ LI.FI rejects the chain | ✗ |
| solana | — | — | ✅ jupiter | ✅ lifi | ✅ lifi |

### Two things that make a probe lie

Both were hit during this measurement, and both invalidate naive conclusions:

- **Amount.** A first pass at ~0.01 native reported "no route" for Polygon,
  Avalanche, Monad and Arbitrum. Re-probed at ~$50, **every one routed**, same-chain
  and outbound. The amount was under the bridges' minimums. A "no route" measured
  at dust size is evidence of nothing — and this is exactly what made the earlier
  EMO→PIXL conclusion wrong.
- **Pair ≠ chain.** Abstract ETH→PENGU returns no quote while ETH→USDC.e routes
  via `fly`. Chain support and pair support are different questions.

Keyless LI.FI also rate-limits (`retry in 2 hours`), which ended the probe run —
so `apechain`, `ronin` and `arc` same-chain results are from the small-amount
pass and are **not** confirmed negatives.

### Arc's native asset has two representations

Arc's gas token is USDC, and mixing its two representations is a 10^12 error:

- the **protocol** carries balances and gas in 18-decimal wei units like any EVM
  chain (`eth_gasPrice` ≈ 20.7 gwei — which would be 435 million USDC per 21k-gas
  transaction if the native unit were 6 decimals);
- **LI.FI** swaps it as a **6-decimal ERC-20 mirror** at `0x3600…0000`, normalizes
  the zero address to that mirror, and quotes `value: 0x0` — so selling it is an
  approval flow, not a native-value flow.

The executor already handles that correctly, because the mirror address is not the
native sentinel. `tx-sender.ts`'s 18 decimals for Arc is right for gas; the
capability entry records both representations so neither is read as the other.

### Abstract: EOA and the smart account are not interchangeable

Abstract appears twice in the matrix. The EOA path (`abstract`) is verified.
`abstract-agw` is **blocked**: the Abstract Global Wallet is a smart account with
its own balance, and the key for the regular Abstract address cannot spend it. A
quote taken against one and signed by the other would fail or move the wrong
funds. The user is told to swap from their Abstract address, or move funds out of
the smart wallet first.

### Imported custom networks — provider-aggregated eligibility, quotable, not yet executable

Imports are matched by **verified chain id, never by display name**, and the
prohibition on shadowing a built-in stays in place.

**The architectural dead end, removed.** Capability used to come only from the
static matrix, and every matrix entry IS a built-in — while `chain-config.ts`
forbids an import from sharing a built-in's chain id. So no import could ever
match an entry, however well supported its chain was. Capability for an import is
resolved **dynamically**, against **every provider the Worker has an execution
adapter for** (see "Provider-aggregated routing" below) — this used to be LI.FI
and Relay alone, which simply moved the same dead end one level down: a chain
routed only by 0x, 1inch, Uniswap, Rango or SwapKit could never qualify either,
however well those covered it. It becomes swap-eligible when all four hold:

| Requirement | How it is established |
|---|---|
| **Identity** | the wallet asks the import's OWN RPC for `eth_chainId`; a mismatch or unreachable endpoint refuses with a stated reason |
| **Provider support** | the chain id is listed by ANY provider we have an execution adapter for — 0x, 1inch, Uniswap, LI.FI, Relay, Rango or SwapKit — per `GET /swap/chains` v2, which asks every provider itself (live list, or its documented one where no key is configured or no chain-list endpoint exists) |
| **Signing** | the executor can build and sign for it (`customEvmSenders`) |
| **Settlement** | it runs through the same session store and lifecycle mapper as a built-in |

Gas and simulation are inherited from the EVM path once signing holds — it is the
same code a built-in uses. Same-chain and cross-chain are tracked separately
(`SAME_CHAIN_EVM_PROVIDERS` / `CROSS_CHAIN_EVM_PROVIDERS` in `swap-proxy.ts`,
mirroring exactly which providers `handleQuote` actually queries in which role):
0x/1inch/Uniswap never do cross-chain, so a chain only they list is a source, not
a bridge destination.

An eligible import is labelled `implemented-unverified`: listed by a provider and
signable is **not** the same as a measured pair, and it is not claimed to be.

**Quoting now actually works for an import (2026-09-21).** Being picker-eligible
used to be as far as it went: every per-provider chain map in the Worker (and the
client's own direct LI.FI call) is keyed by the wallet's built-in chain-id
STRINGS, and an import's string id (`custom-1`, etc.) matches none of them — a
selected import would reach `/quote` and be refused as "unsupported chain" no
matter how well covered its actual chain was. `SwapQuoteRequest` now also carries
`fromChainId`/`toChainId` — the SAME RPC-verified numeric id used for
eligibility — and every numeric-id-keyed adapter (0x, 1inch, Uniswap, LI.FI,
Relay) falls back to it wherever the string lookup misses. Rango and SwapKit are
NOT covered by this fallback — both route by a provider-specific NAME, not a
numeric id, and extending them needs that name mapping (Rango's is buildable
live from `/basic/meta`, already captured as `identifiers` in `swap-chains.js`
but not yet wired into `rangoQuote`). Pinned by
`swap-quote-aggregation.test.ts`: a same-chain 0x quote for a chain id no
built-in map recognizes, reached ONLY through the numeric fallback.

**Execution is still refused — deliberately, not by oversight.** `swapCapability`
(`checkChainCapability` in `swap-policy.ts`) resolves ONLY against the static
built-in matrix, so even a fully-formed, successfully quoted import is refused at
the signing gate with "Swaps are not enabled on `<chain>`." This is intentional:
the signing gate exists specifically because the picker (and now the quote) are
both on the untrusted side of the wire, and loosening it to accept "the picker
said so" or "a quote came back" without its OWN re-derived, synchronous evidence
would be exactly the kind of coverage-for-safety trade this work was told never
to make. Extending the gate correctly needs its own design — synchronous,
re-verified-at-signing-time capability data threaded through `decideSwapPolicy` —
which is out of scope for this pass and is pinned as a REFUSAL by
`swap-policy.test.ts` ("an imported network can be QUOTED before it can be
SIGNED"), so a future change cannot loosen it silently. **An imported network's
status today is therefore discovered + quotable, not executable.**

Execution safety is otherwise unchanged — the same broad-token gate, destination
terms, simulation and fee-integrity checks apply to anything that DOES reach
signing, and an import cannot bring its own router, token list or contracts:
nothing it supplies is treated as execution authority.

**What is sent where.** The imported RPC URL is only ever contacted by the wallet
itself, to confirm the chain id. The backend is asked only which chains the
PROVIDERS support; `/swap/chains` takes no user input at all. The numeric chain
id sent with a quote request is the SAME value already confirmed against the
import's own RPC — never a value the backend is trusted to assert.

**Bounded freshness.** Provider coverage is cached for 6 hours in the Worker's KV
and in client memory. If every provider lookup fails, the previous answer is
served and flagged `stale` rather than reporting "nothing is supported" and
disabling every import at once. Measured live 2026-09-21: 70 chains routed by
LI.FI, 60 by Relay (0x/1inch/Uniswap/Rango/SwapKit fall back to their documented
lists here, since this deployment holds no keys for them — see the coverage
matrix below for exactly which chains each documents).

A custom network that does not qualify stays fully usable everywhere else in the
wallet, with a specific reason: its RPC did not confirm the id, no executable
provider routes it, or the wallet cannot build transactions for it.

---

## Stage 3 — cross-chain lifecycle and settlement

### Charge once per user swap

The fee rides **inside** the swap transaction; there is no separate fee transfer
and none was added. One session is opened per authorized swap, keyed by its intent
id, so an approval, a USDT zero-reset, a Permit2 permit, a retry of an uncertain
broadcast and a resumed cross-chain poll all attach to the SAME record. Opening is
idempotent, and every mutation carries an event id derived from what happened (a
hash, a status tuple) rather than when it was observed — so a replayed poll or a
restart cannot double count.

Approvals are explicitly not fee events. An approved-but-never-executed swap counts
as `not-collected`, never as revenue.

### The fee outcome is separate from the swap outcome

| Fee state | Meaning |
|---|---|
| `not-executed` | authorized, nothing broadcast |
| `submitted` | broadcast, inclusion unconfirmed — **not revenue** |
| `collected-onchain` | the fee-bearing transaction confirmed |
| `accrued-claimable` | the provider owes a claimable balance (Relay-style) |
| `not-collected` | the transaction reverted, so no fee was taken |
| `unknown` | we genuinely do not know — never folded into either |

A cross-chain **refund** keeps `collected-onchain` and adds a note: the fee was
taken in the source transaction that settled, and erasing it would be as wrong as
calling the swap a success. A **partial** delivery does the same.
`summarizeFeeRevenue` counts sessions rather than summing amounts, because the fees
are denominated in different tokens on different chains and a dollar total would
need prices we do not have at reconcile time.

### Persistence, and what is deliberately absent

Sessions persist (`swap-sessions.json` on desktop, `chrome.storage` / Capacitor
Preferences elsewhere) BECAUSE they are not signable: hashes, ids, amounts, states,
timestamps, fee terms. No calldata, no serialized transactions, no approval
payloads. That is the mirror image of `swap-intent.ts`, which holds signable
payloads and is therefore never written to disk. A test asserts the persisted JSON
contains none of those keys.

Resuming **reconciles**; it never re-authorizes. Any newly required transaction
goes back through the normal quote-and-approve path.

### Status reporting, fixed

`CrossChainStatusCard` now renders the canonical lifecycle state, so `DONE/PARTIAL`
and `DONE/REFUNDED` no longer read as "✓ Bridge complete — Received <the token you
asked for>". It names the asset that ACTUALLY arrived (on a refund, the one that
was sold), and says "submitted" rather than "confirmed" for a bare broadcast hash.
`expectedToTokenAddress` is now passed, so a refund is distinguishable from a
delivery at all.

---

## Rollout — Worker and clients must move together

The fee policy version is bound into every intent, and both sides validate the same
beneficiary table, so **a one-sided deploy degrades to "no route available", not to
a wrong fee.** That is the safe failure, but it is still an outage.

1. **Deploy the Worker first.** An OLD client against the new Worker has no
   `appFee` handling and never validates a Solana fee account, while the Worker
   refuses Jupiter without one — so same-chain Solana and any keyed EVM route
   report "no route". Cross-chain via direct LI.FI keeps working at the old
   client's hardcoded 90 bps. **Keep this window short.**
2. **Ship clients.** A NEW client against an OLD Worker refuses every Worker quote
   (no `appFee` record) while direct LI.FI still works at 100 bps.
3. Verify `/quote` returns `appFee.verification === "applied-verified"` on a
   keyless LI.FI route before and after.

**Rollback:** reverting `FEE_BPS` to `"90"` makes the Worker throw — deliberately.
A real rollback is reverting `swap-fee.js` plus the adapter blocks and redeploying,
then reverting the client. There is no persisted wire format to migrate; swap
sessions are additive and older clients ignore them.

---

## ChainLens reuse

`src/shared/swap-token-identity.ts` and `src/shared/swap-curated-tokens.ts` are
the reusable core: no Electron, Chrome, Capacitor, `node:` or `fetch`. Neither
touches keys, the vault, or signing. `swap-policy.ts` is pure and portable too,
but lives in `src/main/` because it is a privileged-layer decision and should not
be imported by a renderer as if it were enforcement.

### Stage 5 status (2026-09-23): the signing adapter is built; three decisions are open

*(Superseded 2026-09-24: the owner chose the generated bundle, the ChainLens backend proxy and the existing 1% policy. See "Stage 5: implemented" below.)*

**Built locally, uncommitted, not wired into any page:**
`chainlens/public/swap-wallet-adapter.js` plus 17 `node --test` cases. It is a
UMD module in the same style as `wallet-providers.js` and takes the provider
records that file already discovers.
- It plans a normalized quote for **explicit** source and destination accounts,
  which may be two wallets in different ecosystems. A quote with no recipient
  can pay only its signer.
- Before **every** signature it checks the account, the network and the expiry,
  and cancels on any real account or network change. The wallet echoing a
  switch the adapter itself requested does not count as a change.
- The order is approval → confirmed receipt → swap. Whatever was already sent
  is returned with each error, so the host can record an approval that went
  out without its swap (Magic Money's not-sent state).
- Solana signs through Wallet Standard `solana:signAndSendTransaction` with the
  serialized bytes on `solana:mainnet`, or Phantom's legacy `request` with
  base58 bytes. No web3.js is needed.
- It **refuses to plan** without an injected `validateQuote`. Quote judgement
  (fee terms, minimum received, spender and target rules) stays with the shared
  core. ChainLens holds no key material, and its SimpleSwap iframe is untouched.

**Portable today (dependency-free TypeScript in `src/shared/`):**
- `swap-token-identity`, `swap-curated-tokens`, `swap-networks`
- `swap-routing-policy`, `swap-fee-policy`, `swap-destination`
- `swap-lifecycle`, `swap-session`, `swap-settlement`
- `solana-upfront-cost`

**Not yet portable.** These are what `validateQuote` needs, and they sit in
`src/main/` alongside network and key code:
- `validateSwapQuoteForExecution` and its EVM/Solana/approval/permit validators (`swap-executor.ts`)
- `decideSwapPolicy` and `checkMinReceived` (`swap-policy.ts`, which imports `swap-proxy`)
- `checkQuoteFeeIntegrity` (`swap-fee.ts`, which imports `@solana/web3.js`, `secure-store` and `api-proxy`)

Extracting their pure parts into `src/shared/` is a refactor of the privileged
layer. It needs an architecture review and the full platform suite, and it is
not done.

**Decisions needed from the owner:**
1. **How the shared core reaches ChainLens.** ChainLens pages are classic scripts (React UMD, esbuild-transformed JSX; no module bundler), and the two repos deploy independently (Render vs. Worker/apps). Options:
   - (a) *Recommended:* a script in this repo bundles the portable modules as one IIFE (`window.MagicMoneySwapCore`). The output is committed to `chainlens/public/` with its source commit and a hash, and a ChainLens test fails if the file changes without regeneration.
   - (b) A private npm package or git dependency.
   - (c) A hand-maintained JavaScript copy. Not recommended: it drifts.
2. **How ChainLens reaches `/tokens` and `/quote`:**
   - (a) *Recommended:* through ChainLens's Express backend, which calls the Worker server-side with its own client token. The token and rate limit stay server-side, and the Worker can tell ChainLens traffic apart from the wallet's.
   - (b) Directly from the browser. This requires adding the ChainLens origin to the Worker's `ALLOWED_ORIGIN` and shipping a client token in the page.

   Either way the Worker needs a new secret and a deploy.
3. **Fees on ChainLens swaps.** The Worker applies `FEE_BPS` = 100 with the current `FEE_EVM`/`FEE_SOLANA` (this wallet's own addresses), and LI.FI's integrator id is already `ChainLens`. Should ChainLens swaps charge the same 1% to the same recipients, a different rate or recipients, or nothing? The existing policy is not changed silently.

---

## Real-wallet evidence and acceptance measurements (2026-09-23)

The plan asks for "controlled real-wallet settlement checks before production
enablement" from "a designated test wallet and an explicit spend budget". Those
have **not** been run. What exists instead: the wallet owner swapped with their
own wallet on 2026-09-22/23. Nothing below was signed or broadcast by an agent.
The owner's records were read from `swap-sessions.json` (public data only), and
each claim was checked on-chain read-only.

### What the real swaps prove

All were sent from account index 0: the regular EVM account `0x01faF6…fe13` and
its derived Solana account `3noTu…N98d`. Every recipient was the user's own
address.

| Swap | Route | Outcome, measured on-chain | Fee payout |
|---|---|---|---|
| 5000 EMO (Monad) → PIXL (Ethereum) | Relay, EVM→EVM, token→token, meme on both sides | Delivered 1004.644860 PIXL; approved minimum 974.536042 | Relay `paidAppFees` 52,861 USDC-raw against 52,904 expected, recorded as `confirmed` by the app |
| 100 MON (Monad) → SOL | LI.FI via `relaydepository`, EVM→Solana, native→native | Delivered 21,919,609 lamports; minimum 20,824,338 (LI.FI reported 21,358,296) | Trace: LI.FI's fee contract `0xa5971bd7…` paid **1.0 MON** to `FEE_EVM` and 0.25 MON to LI.FI. The app has no payout record. |
| 55 MON (Monad) → SOL | same | Delivered 12,026,493 lamports; minimum 11,424,383 (LI.FI reported 11,717,316) | Trace: **0.55 MON** to `FEE_EVM`, 0.1375 MON to LI.FI. No payout record in the app. |
| 3000 Tilcayo → SOL (Solana) | Jupiter, same-chain, token→native | Confirmed; wallet +31,740,536 lamports after the 105,000 fee; minimum 31,045,411 | 321,672 wSOL lamports (321,630 expected) to referral token account `XSv8M…`, derived from the policy's referral account `9vBwkLq…` (partner `3noTu…N98d`, this wallet), still unclaimed |
| 3000 PENGU (Abstract) → ETH | Relay: approval only, **no swap** | The approval confirmed; nonce 5→6 with no later transaction, so nothing was swapped | Not executed |

What these swaps establish:
- **Routes.** Cross-chain EVM→EVM token→token (Relay) and EVM→Solana native→native (LI.FI and Relay) settle to the expected asset at the expected recipient above the approved minimum. So does a same-chain Solana token→native swap (Jupiter).
- **Measured delivery.** LI.FI's reported figure is its quote minus slippage, not the fill. Hence the on-chain re-measure; the dry run on the real file moves both records to the measured value and keeps LI.FI's figure alongside.
- **The fee is collected in all three provider models:** Relay app fees, LI.FI's in-transaction native split, and Jupiter referral.
- **No duplicate or wrong-account execution** in these five records. Each has one source transaction, and each is bound to account 0 and its own addresses.
- **Approval without a swap is finalised correctly.** The PENGU session becomes `failed` / "not sent" with the approval hash kept, not left "in progress". This needs the new build; the saved file still says `source-submitted`.

What they do **not** establish:
- **Payouts to a separate recipient.** `FEE_EVM` and `FEE_SOLANA` are this wallet's own addresses, so every fee went back to the payer. That proves the mechanism, not revenue separation. *(Corrected 2026-09-24: an earlier draft named `8oW1Poc2…` as Jupiter's partner. That key belongs to Jupiter's project account `45ruCy…`. The policy's referral account `9vBwkLq…` has partner `3noTu…N98d`, this wallet; see "Fees: charged versus proven paid".)*
- **Solana→EVM execution.** Quoted only.
- **Same-chain EVM swaps** (0x, 1inch, Uniswap). Quoted only.
- **An approval followed by a swap.** The only approval had no swap after it.
- **Refunds or partial deliveries.** None occurred.
- **Resume after restart.** The records carry no restart marker. Later poll times show reconciliation ran, but not that the app restarted in between.
- **The Abstract Global Wallet, other account indexes, and imported networks.** None swapped. The AGW cannot swap; the executor signs from the EOA only.
- **The LI.FI fee as recorded.** The app marks `collected-onchain` from a successful receipt alone; the payout was verified only by the trace above. LI.FI's `/v1/integrators/ChainLens` returns `feeBalances: []`, consistent with direct payment rather than accrual.

**Records still showing old states.** The older build left EMO→PIXL as
`unknown` because it did not recognise Relay's `success` status, and PENGU as
`source-submitted`. The mapper and not-sent fixes correct both on the first
reconcile in a new build. A dry run on the real file showed
`unknown → completed` and `source-submitted → failed`. The file was left
byte-identical.

### Standing Abstract approval: rechecked, not revoked

- Approval transaction `0xdf36702e…8fdf` (block 85,048,688, status success).
- PENGU `0x9ebe3a82…ba62`: owner `0x01faf6df…fe13` (the regular EOA, not the AGW), spender `0xccc88a9d…15be` (Relay ApprovalProxy; 7,746 bytes of deployed code), 3000 PENGU.
- Current allowance: **3000** (unchanged). EOA nonce: 6.
- The EOA's PENGU balance is **0** and it has **never** received PENGU: Alchemy lists no PENGU transfer to or from it. All PENGU activity is on the AGW `0x8a42…0102`.
- So the approval covers tokens this account does not hold. Per Relay's published source, the proxy pulls only for `msg.sender` or a permit owner. It stays in place, as instructed.

### Search and quote timing (measured 2026-09-24 00:34 UTC)

These go through the app's own client functions (`getSwapTokenList` and
`getSwapQuote`) against the deployed Worker, read-only, from this machine.

**Search: 30 requests** (10 fixtures × 3 rounds), **0 errors**. The fixtures:
- DEGEN/Base by text and by address;
- Bonk/Solana by text and by mint;
- PEPE/Ethereum;
- PENGU/Abstract;
- EMO/Monad by address;
- USDC/Base (duplicate symbols);
- an invalid address;
- nonsense text.

Results:
- **All 30: p50 53 ms, p95 3,900 ms.** The plan's target is p95 under 1.5 s: **not met**.
- **Cold (first request per query, n=10): p50 958 ms, p95 6,612 ms.** 4 of 10 took over 1.5 s: PEPE text 6,612; USDC text 3,900; EMO address 2,673; DEGEN text 2,561.
- **Warm (Worker cache, n=20): at most 64 ms.**
- **Both no-result fixtures answered with an explicit empty result.**

The gap is cold provider fan-out. Pre-warming popular queries, or a faster
first-page provider, would address it; neither is done.

**Quotes: 22 requests** over 11 fixtures:
- 4 same-chain: Base ETH→DEGEN, Ethereum ETH→PEPE, Arbitrum ETH→USDC, Solana SOL→BONK;
- 4 cross-chain: MON→SOL, EMO→PIXL, Base USDC→SOL, SOL→Base USDC;
- 1 no-liquidity.

Results:
- **p50 1,296 ms, p95 5,195 ms, max 5,826 ms** (ETH→PEPE, run 2).
- **"Useful quote or explicit outcome within 8 s": 22/22 met.**
- 20/20 routable requests returned a quote. The two no-liquidity requests returned explicit per-provider reasons, one including a Uniswap dependency timeout.

**Denominator note.** A first run counted 2 extra EMO→PIXL requests that failed
with "Cross-chain tracking is not active". The probe had no session store, which
the app always has. They are excluded here and replaced by re-measurements with
the store: Relay quoted in 3,247, 1,963 and 1,754 ms. The excluded raw times
were 2,793 and 2,974 ms.

**Not measured:**
- the time until cached suggestions are visible (renderer-only);
- a mobile network;
- provider rate-limit (429) behaviour. None occurred in these 54 requests.


---

## Fees: charged versus proven paid (checked on-chain 2026-09-24)

"Charged" means the transaction carrying the fee succeeded. "Paid" means the
money reached an account Magic Money controls, and each provider does that
differently:

| Provider | Charged? | Where the fee is now | Proven paid to our recipient? |
|---|---|---|---|
| LI.FI (MON→SOL ×2) | Yes, inside the source transaction | Sent directly to `FEE_EVM` `0x01fa…` in the same transaction: 1.0 MON and 0.55 MON, per the call traces | **Yes.** On-chain transfer to our address |
| Relay (EMO→PIXL) | Yes | Relay's off-chain app balance: 52,861 USDC-raw (0.052861 USDC) on Base for `0x01fa…` (`GET api.relay.link/app-fees/0x01fa…/balances`). No USDC reached `0x01fa…` on any chain | **No.** Credited and claimable, not paid out. Withdrawal needs a signature |
| Jupiter (Tilcayo→SOL) | Yes | 321,672 wSOL lamports in referral token account `XSv8M…`, never claimed | **No.** Held for our partner key, not paid out |

**Jupiter fee account: control verified.** `XSv8M…` is the PDA of the shared
policy's referral account `9vBwkLq…` for wSOL. That account (program `REFER4Zg…`,
name "Magic Money", partner share 10,000 bps) names **`3noTu…N98d` as its
partner**: this wallet's Solana address, which has signed on-chain transactions
(the Tilcayo swap itself). The fee token account's authority is Jupiter's
project account `45ruCy…`, which is how Jupiter referral accounts are
structured. ChainLens's Jupiter fee route was enabled on this evidence; set
`CHAINLENS_JUPITER_FEE=off` to turn it off.

Two labels to read carefully:
- The app's Relay `payout: confirmed` means Relay REPORTED the fee as credited
  (`paidAppFees`). It does not mean it arrived.
- `collected-onchain` means the fee-carrying transaction succeeded.

Only LI.FI's model delivers to our address immediately.

## Search latency: cause and fix (2026-09-24)

**Cause.** A cold EVM text search asked Relay with `useExternalSearch: true`.
Measured directly, that took 1–3.3 s cold and returned fewer hits for text
(USDC on Base: 2 instead of 20). The thin result then triggered the bulk LI.FI
catalogue fetch *serially* behind it. That chain produced the 3.9–6.6 s cold
searches.

**Fix.** Relay's own index answers in about 0.1 s and ranked the canonical token
first for PEPE, USDC, DEGEN, PENGU, USDT and BRETT. Text search now uses the own
index, and runs external search plus LI.FI **in parallel** only when fewer than 5
hits come back. Exact-address lookup keeps external search, which is what finds
unindexed tokens such as EMO.

**Evidence** (local `wrangler dev`, no cache, 24 fresh queries per build):

| Build | p50 | p95 |
|---|---|---|
| Old | 629 ms | 1,129 ms |
| New | 136 ms | 804 ms |

The top result was the same or better in every case (APE not ApeUSD, RON not
WETH, ZORA not $ZRTK). Covered by `worker-tokens-search.test.ts`; reverting the
fix fails 2 of its 3 tests.

**Not yet proven.** The deployed p95 target of 1.5 s is **not** claimed met. It
needs the Worker deploy, then the same 30-request measurement at the edge. If
thin-index queries still miss, a cron pre-warm of the LI.FI catalogues is the
next step.

## Polkadot: Asset Hub migration reconciled

- **Balance.** DOT moved from the relay chain to Asset Hub in November 2025, but
  the balance still read only the relay chain, so a migrated balance would show
  as 0. It now reads the same `System.Account` key on both chains and sums them.
  Asset Hub is read from Parity's public RPC (keyless, CORS-open). If either
  chain is unreadable, the balance is reported unavailable rather than
  understated (`balance-polkadot.test.ts`).
- **History.** This already reads Statescan's Asset Hub and relay-chain APIs.
- **This wallet's account.** Nonce 0 and zero balance on both chains, so "no
  activity" and 0 DOT are both correct.
- **Sending.** The wallet has no DOT send path, so nothing to migrate there.

## MON→SOL record corrections: verified after the app ran

You ran the app at 23:02 on 2026-09-23 with the build containing the
re-measure. It rewrote `swap-sessions.json` at 23:05:46:

| Record | Before | After | Measurement | Kept alongside |
|---|---|---|---|---|
| 100 MON → SOL | LI.FI's quote-derived figure | 21,919,609 lamports | on-chain | LI.FI's 21,358,296 |
| 55 MON → SOL | LI.FI's quote-derived figure | 12,026,493 lamports | on-chain | LI.FI's 11,717,316 |
| EMO → PIXL | `unknown` | `completed` | on-chain, Relay payout recorded | — |
| PENGU (approval only) | `source-submitted` | `failed`, "not sent" | — | approval hash |

Tilcayo→SOL was untouched. The file was only read to verify this.

## Stage 5: implemented (2026-09-24)

**Your choices, as built:**
- **Distribution.** A generated shared browser bundle with drift checks in both repos.
- **Access.** ChainLens's backend as the search, quote and status proxy.
- **Fees.** The existing disclosed 1% policy and recipients.

**Shared code (Magic Money `src/shared`, re-exported by `src/main`, so behaviour
is unchanged; all 1,368 existing tests still pass):**
- `swap-quote` (the contract type)
- `swap-fee-checks`
- `swap-policy-checks`
- `swap-execution-checks`
- `swap-candidates` (filter and rank)
- `solana-transaction`: a web3.js-free parser, verified against web3.js on v0,
  lookup-table, multi-signer and legacy transactions
- `swap-signing-checks`: the pre-signature check. It covers account, chain,
  recipient, token identity by address, amount and slippage, fee integrity with
  unchanged terms, the policy gate, a minimum never below the one shown, the
  exact transaction plan including the approval spender, and the Solana fee
  payer as sole signer.

**Bundle.** `npm run build:swap-core` writes `chainlens/public/swap-core.js` and
its manifest. Two checks catch drift:
- `swap-core-drift.test.ts` here fails if the sources change without regenerating;
- `swap-core-bundle.test.js` in ChainLens fails on a hand edit.

**ChainLens:**
- **`swap-service.js`** proxies `/api/dex/tokens|quote|status|tx-status`. It
  adds the Worker token server-side and runs the shared candidate filter. It
  derives and checks Jupiter fee accounts (the ed25519 PDA check matches
  web3.js on 500 vectors). Transaction status falls back to public RPCs.
- **The page** re-runs the shared check before **every** signature and reads
  allowance, balance and simulation through the wallet's RPC. It persists each
  swap and resumes it after a reload. It shows a confirmation badge (block or
  Solana finality, last check time, why a check failed, "Check now"), and has a
  switch button between the two tokens.
- **Tests:** 111 unit and 29 e2e pass. The e2e tests cover approval → swap →
  confirmation, a rejected approval, an account change mid-flow, a skipped
  approval, EVM→Solana to a separate Solana wallet with partial delivery,
  restart → refunded, the status-service fallback, flip, and tracking active.

**Found live on chainlensnft.info (fixed locally, needs a ChainLens deploy):**
- **Stuck confirmation.** A same-chain swap stayed "waiting for confirmation"
  because `/api/dex/tx-status` returned 502 on every chain. It read through the
  Worker's `/rpc` routes, which require the client token, and
  `MM_SWAP_CLIENT_TOKEN` is not set on Render. Status now falls back to public
  RPCs, then to the connected wallet. Setting the token also enables the
  Jupiter fee route, whose fee-account check reads through the same route.
- **Cross-chain refusal.** "Cross-chain tracking is not active on this device"
  appeared because the browser's copy of the shared core never marked tracking
  active. The page now sets it whenever local storage can persist the record.

## Worker deployed 2026-09-24 (version `8f5106fe`, rollback `a3b0d3b2`)

The deploy contained exactly the two verified changes: the Monad and HyperEVM
history allowlist entries, and Relay own-index text search. Checked live:
- `/health` is OK.
- Monad history comes through `monad-mainnet`.
- HyperEVM answers through `hyperliquid-mainnet`.

**Search, measured at the edge** (same 10 fixtures × 3 rounds, round 1 forced
cold): 30 requests, 0 errors.

| Requests | p50 | p95 | Max | Over 1.5 s |
|---|---|---|---|---|
| All 30 | 171 ms | 922 ms | — | — |
| Cold 10 | 328 ms | 1,269 ms | 1,269 ms | 0 |

**The plan's p95 < 1.5 s target is now met** (previously 3.9 s). The slowest
cold query was an exact-address lookup (external search, by design).
