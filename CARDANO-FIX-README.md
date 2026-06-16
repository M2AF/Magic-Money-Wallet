# Cardano Derivation Fix — MagicMoney Wallet

## What was wrong

Your dashboard showed **"Error / Cardano library not installed"** because
`@emurgo/cardano-serialization-lib-asmjs` is an ESM-only package that Electron's
main process (running as CommonJS) couldn't reliably `import()` at runtime. When
the lazy `getCSL()` load failed, `deriveAddresses()` returned `cardano: null`,
the balance fetcher hit its "no address" branch, and the UI showed the error.

## The fix

Removed the CSL dependency entirely and replaced it with **`cardano-pure.ts`** —
a dependency-free implementation of Cardano's address derivation
(CIP-3 v2 Icarus + CIP-1852 + BIP32-Ed25519) using packages you already had:

- `@noble/hashes`  — pbkdf2, hmac, sha512, blake2b
- `@noble/curves`  — ed25519 raw scalar multiplication
- `@scure/base`    — bech32 encoding

No native binaries, no ESM interop, no build workarounds.

## The critical bug that cross-validation caught

The first pure version produced a **valid-looking but WRONG** address — it would
have shown a different (empty) balance than your real Yoroi/Eternl wallet,
because the PBKDF2 arguments were swapped. The widely-copied "entropy as
password" convention (which appeared in the original planning docs) is wrong for
the CSL/Yoroi scheme. The correct order is:

```
pbkdf2(sha512, passphrase /* password, usually empty */, entropy /* salt */, ...)
```

`verify-cardano.cjs` locks this in: it checks our output against a hardcoded
reference vector produced by the real EMURGO library. Both base and stake
addresses now match **byte-for-byte**.

## How to apply

1. Copy these files over your existing ones:
   - `src/main/cardano-pure.ts`  (new file)
   - `src/main/wallet-core.ts`   (replaces CSL block)
   - `src/main/balance-fetcher.ts` (uses derived stake address)
   - `src/renderer/types/wallet.ts` (cardano now non-null + cardanoStake)
   - `src/renderer/components/ChainCard.tsx` (stale message removed)
   - `electron-vite.config.ts`   (removed CSL externals)
   - `package.json`              (dropped @emurgo, added @noble/curves + @scure/base)

2. Reinstall and rebuild:
   ```
   npm install
   npm run build
   ```

3. Verify the derivation any time:
   ```
   node verify-cardano.cjs
   ```

## Important: re-import your wallet

If you set up a wallet on the old (broken) build, the stored Cardano address was
either null or, if you tested an intermediate version, potentially wrong. Delete
and re-import your seed phrase so the correct address is derived and saved.

## A note on the stake address

`balance-fetcher.ts` now queries `/accounts/{stake_address}` for the **total
controlled balance** (sum across all addresses sharing your stake key) rather
than just one payment address — the same approach that fixed ChainLens. Because
the wallet now derives the stake address locally, balances resolve correctly
even before the payment address has any on-chain history.
