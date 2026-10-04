# xReserve testnet QA — Ethereum Sepolia USDC → Cardano Preprod USDCx

This is testnet evidence only. It does **not** count toward `RELEASE-QA.md`, which records real-funds passes only. Mainnet execution stays disabled. Mainnet fee/minimum quoting and the outbound (burn) path remain separate, unresolved gates (`XRESERVE-GATE2-RESEARCH.md`, `XRESERVE-GATE3-RESEARCH.md`).

## Run 1 — 2026-09-30: PASS (first live run through the wallet)

**Setup.** The wallet was in Testnet Mode, with the Swap tab's xReserve test panel and keyless Koios as the Cardano Preprod source. The deposit was 20 USDC with a 10 USDC `maxFee`, the values from Circle's Cardano quickstart example. Those are example inputs, not a published fee or minimum. The approval and the deposit were two separate, explicit signing actions in the wallet. Nothing was signed or sent by the verification below.

| Item | Value |
| --- | --- |
| Sender (Sepolia) | `0x01faF6DFc230d755141D84d7cB980dd68f5Efe13` |
| Recipient (Preprod, base address) | `addr_test1qp50qv0ks9t29mavulaa5jr3sk2s50r5jfsddydjs0pazrfh32tdpt7zttt4mhl6t9purm4c9rv555z7r5mulq78aleqm7ccfg` (payment key `68f031f6…d10d`, stake key `378a96d0…eff2`) |
| Approval (Sepolia) | [`0xa0abbd0f1baf9b0070bfa8d2207331f2770624c757a94d249fcf398b8fec7dfa`](https://sepolia.etherscan.io/tx/0xa0abbd0f1baf9b0070bfa8d2207331f2770624c757a94d249fcf398b8fec7dfa), block 11816479. `Approval(owner = sender, spender = xReserve 0x0088…4442, value = 20000000)` — exactly the deposit amount |
| Deposit (Sepolia) | [`0x9df79fe3f3f0b21210ef9fc810dd95311d7fed3242db14b03a2003809ec0ed10`](https://sepolia.etherscan.io/tx/0x9df79fe3f3f0b21210ef9fc810dd95311d7fed3242db14b03a2003809ec0ed10), block 11816481, status success. USDC 20 moved sender → xReserve, then xReserve → `0x0077777d7eba4688bdef3e311b846f25870a19b9` in the same transaction |
| Circle attestation (testnet API) | one attestation, `remoteDomain` 10004, messageHash `0x3a1a0687b086594d6893dd3096d779ff44ed74e97c872f77d6bef58769154205` |
| Cardano mint (Preprod) | [`0d76ff8bdd9033caf61e60e3bb8730a85ffae8e3f31777af08829c6f3671b1ab`](https://preprod.cardanoscan.io/transaction/0d76ff8bdd9033caf61e60e3bb8730a85ffae8e3f31777af08829c6f3671b1ab), block 5238697 |

### Timing (UTC, from chain timestamps)

| Event | Time | Elapsed from deposit |
| --- | --- | --- |
| Approval mined | 2026-09-30 18:32:48 | −24 s |
| Deposit mined | 2026-09-30 18:33:12 | 0 |
| Circle attestation first observed | by 19:59 (Codex check); present at 20:22 (Claude check) | ≤ 1 h 26 min |
| Cardano mint | 2026-09-30 20:45:15 | 2 h 12 min |

Circle's API returns no attestation timestamp, so only an upper bound on when it was issued is known. IOG's FAQ describes about 15–25 minutes for the operator's mint. This Preprod mint took about 2 h 12 min, and no Preprod completion time is published.

### Independent verification (read-only)

The check used the wallet's own modules. The Ethereum reads went to a keyless public Sepolia RPC. Circle's attestation came from `https://xreserve-api-testnet.circle.com`. Cardano reads went to keyless Koios Preprod.

| Stage | Module | Result |
| --- | --- | --- |
| Source deposit | `verifyXReserveEthereumDeposit` (Sepolia profile, 12 confirmations) | `verified`: 727 confirmations at check time. Calldata was byte-identical to the approved deposit, and the event matched (`maxFee` 10000000, hookData 95 bytes = base-address staking payload) |
| Source ↔ attestation | `linkXReserveSourceToAttestation` | `linked`, with no mismatched fields (amount, token, depositor, domain, recipient, remote token, max fee, hookData) |
| Attestation ↔ approval | `validateXReserveAttestation` | ok: amount 20000000, domain 10004, recipient credential = the wallet's payment key, Sepolia USDC |
| Mint | `evaluateMintCandidate` (unchanged proof rules) | `verified`: attestation carried by a withdraw-zero redeemer; minted 20000000; credited 15000000 to output 0 (the recipient's full base address, stake key included); `sourceMinusCredited` 5000000 |
| Recipient scan | `locateXReserveCardanoMint` over Koios, cursor 200 blocks before the mint | `minted` on the first poll |
| Global audit | `auditXReserveCardanoMint` over Koios (`asset_history` mint events) | `minted` on the first poll |

**Wallet vs independent check.** The wallet reported "Minted on Cardano Preprod", 31 confirmations and 15 USDCx credited. The independent check found the same mint and the same credit (40 confirmations a few minutes later). There was **no verifier or tracking discrepancy**. The wallet's intermediate states arrived in the expected order:
1. waiting for the Sepolia deposit to confirm (`source-pending` / `insufficient-confirmations`);
2. waiting for Circle's attestation (`attestation-pending`);
3. attested, waiting for the Cardano mint (`awaiting-mint`);
4. minted.

**What this establishes on Preprod.**
- The wallet signs the approval and the deposit correctly.
- Circle's quickstart encoding of a base address (recipient credential plus 95-byte staking hookData) delivers USDCx to the full base address.
- Preprod carries the attestation the same way as the mainnet example examined earlier: a withdraw-zero redeemer with Circle's payload and signature byte for byte.
- The existing proof rules (minted = attested; 0 < credited ≤ minted) hold without change.

### The 5 USDCx output

Output 1 of the mint paid 5000000 USDCx base units to `addr_test1qqqftz3dhzefxw7megme00l0qc6uuzwemptc8ydjssx0jpd8t786un8h6nwte34k308nxjvwyvu9wf7ap2hcwmg3lyfqwvqemz`. That is an ordinary base address (key payment credential `00958a2d…f905`, key stake credential `a75f8fae…f912`), not a script, and not the recipient. The transaction's ADA change (output 4) went to a separate address, `addr_test1qr4w9ser…8c7`. That address pays every recent mint's ADA change, so it is presumably the minting operator.

Across the 15 most recent positive Preprod USDCx mints (Koios `asset_history` plus `tx_info`, read 2026-09-30), that same address received:

- exactly 5000000 in 13 mints, independent of the mint size (11, 15, 20, 21, 25, 40 and 60 USDCx);
- 6470002 in one 11 USDCx mint (`8635da33…`);
- 5581586 in one 15 USDCx mint (`e557a4dd…`), where the operator address also received 9418414.

**Interpretation, stated as such.** The data shows a recurring, mostly flat 5 USDCx allocation to one address on Preprod, within this deposit's 10 USDC `maxFee`. Neither Circle nor IOG documentation examined so far identifies that address or defines the amount, so this QA does **not** call it a fee. The one public mainnet mint examined earlier (`24da9d4f…`) allocated a single base unit to a second address instead. The Preprod figure must not be used as a mainnet fee, minimum or quote.

### Not established by this run

- Mainnet behaviour, fee, minimum or completion time.
- A supported quote API for the fee, the minimum and a recommended `maxFee`.
- What happens when `maxFee` is below the operator's cost (IOG's FAQ mentions a self-submit option; no supported procedure has been found).
- The outbound burn path (gate 3).
- The recovery windows noted in the executor:
  - the moment between the deposit broadcast and saving its tracking record;
  - prepared deposits held only in memory;
  - the desktop tracking file being written in place.
