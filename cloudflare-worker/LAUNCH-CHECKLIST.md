# Launch Checklist — API key cutover

The client no longer ships any provider keys; they're injected by this Worker.
Do these steps **in order** before shipping. Steps 1–4 are yours (they need your
Cloudflare account + provider dashboards).

## Why (one line)
The old keys were public in the shipped bundle (worst: a Supabase **service-role**
key in the Chrome listing). They're now Worker-only. The old keys are burned —
rotate them.

## 1. Rotate every exposed key
Generate a NEW key in each provider and **revoke the old one** (old keys leaked):

- Alchemy, Helius, Blockfrost, Tatum, Moralis, OpenSea
- SimpleSwap (+ the existing 0x / 1inch for swaps)
- **Supabase: rotate the service-role key** (Project → Settings → API → service_role → reset)
- WalletConnect projectId is low-risk (designed to be client-side) — optional rotate

## 2. Create the KV cache + set the namespace id
```bash
cd cloudflare-worker
wrangler kv namespace create CACHE
# paste the printed id into wrangler.toml → [[kv_namespaces]] id
```

## 3. Set Worker secrets (the ROTATED keys) + vars
```bash
wrangler secret put ALCHEMY_KEY
wrangler secret put HELIUS_KEY
wrangler secret put TATUM_KEY
wrangler secret put BLOCKFROST_KEY
wrangler secret put MORALIS_KEY
wrangler secret put OPENSEA_KEY
wrangler secret put ORDISCAN_API_KEY         # Bitcoin Ordinals/Runes/BRC-20
wrangler secret put ANKR_API_KEY             # keyed RPC fallback (EVM)
wrangler secret put ANVIL_API_KEY            # Cardano marketplace floors (NFT USD valuation)
wrangler secret put SUPABASE_SERVICE_KEY     # rotated service-role key
wrangler secret put SIMPLESWAP_API_KEY
wrangler secret put ZEROX_API_KEY            # if not already set
wrangler secret put ONEINCH_API_KEY          # if not already set
wrangler secret put CLIENT_TOKEN             # must match clientToken in wallet config
```
Confirm `SUPABASE_URL` is set in `wrangler.toml [vars]` (already added), and
set `ALLOWED_ORIGIN` to a specific production origin. Do not leave it as `*`.

## 4. Deploy
```bash
wrangler deploy
```

## 5. Verify the Worker (curl)
```bash
W=https://magicmoney-swap-proxy.guildfordking.workers.dev
curl -s "$W/health?mm_client=magicmoney-wallet-v1"
curl -s -X POST "$W/rpc/alchemy/eth-mainnet?mm_client=magicmoney-wallet-v1" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
curl -s "$W/opensea/collections/boredapeyachtclub/stats?mm_client=magicmoney-wallet-v1"          # 2nd call = KV hit
curl -s "$W/profile?address=0x0000000000000000000000000000000000000000&mm_client=magicmoney-wallet-v1"
```
None of the responses may contain a key/secret.

## 6. Verify the clients (already done in code, re-confirm after your deploy)
- Electron app + extension: dashboard loads balances, tokens, NFTs (EVM/Solana/Cardano);
  send a small tx (proxy broadcast); run a SimpleSwap estimate; trigger a profile sync.
- Bundle grep is clean (verified): no key fragments in `out/` or `dist-extension/`.
- CoinGecko / DexScreener / Binance still go direct (per-IP) — confirm in DevTools network.

## Notes
- **Sequencing:** the client is proxy-first. Until step 4 redeploys the Worker with
  the new read routes, native balances still resolve via public-RPC fallback, but
  tokens/NFTs/prices/sync need the deployed Worker. Deploy before release.
- **Plan tier:** the KV cache + secrets assume Workers Paid ($5/mo) for KV write
  headroom; free tier KV write limits are very low.
- **Supabase writes are signature-gated:** /sync and /profile/update require an
  EVM EIP-191 ownership signature (verified in the Worker via @noble/curves), with a
  ±10-min freshness window + KV replay-nonce. Only the EVM key owner can write to a
  profile. The /profile GET read stays open (rate-limited). One EVM signature covers
  the whole sync because the profile's identity is the EVM address (other chains are
  linked sub-records) — no ed25519 path needed.
