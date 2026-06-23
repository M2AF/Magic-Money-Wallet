# MagicMoney Proxy (Cloudflare Worker)

Security proxy that injects all provider API keys server-side. The wallet client
(Electron app **and** browser extension) calls this Worker only — it never holds
Alchemy / Helius / Tatum / Blockfrost / Moralis / OpenSea / SimpleSwap / 0x /
1inch / Jupiter keys, nor the Supabase service key. Keys never appear in any
client response. A cross-user KV cache collapses shared, expensive, immutable
data (token metadata, NFT floors, contract→slug maps) so the shared monthly
quotas aren't burned per-user.

> **Keyless, per-IP endpoints stay on the client** (CoinGecko, DexScreener,
> DefiLlama, Magic Eden, mempool.space, Binance). Proxying them would collapse
> every user onto the Worker's IP and create a rate-limit bottleneck.

## Files

| File | Role |
|---|---|
| `swap-proxy.js` | Entry. Dispatches read → db → swap routes. |
| `read.js` | Keyed read providers (RPC + NFT/REST) + KV cache. |
| `db.js` | Supabase profile/wallet sync (service key server-side). |
| `lib.js` | CORS/JSON, KV cache, rate limit, client gate. |

## Routes

**Read-path** (keys injected from `env`):

| Method | Path | Upstream / cache |
|---|---|---|
| POST | `/rpc/alchemy/:network` | Alchemy JSON-RPC. `alchemy_getTokenMetadata` cached per-contract **24h** |
| POST | `/rpc/helius` | Helius JSON-RPC (passthrough) |
| GET | `/helius-api/*` | Helius enhanced REST (`api.helius.xyz`); tx history |
| POST | `/rpc/tatum/:gateway` | Tatum gateway (`polkadot`/`bitcoin`), passthrough |
| GET | `/alchemy-nft/:network/*` | Alchemy NFT v3 (passthrough) |
| GET·POST | `/blockfrost/*` | Blockfrost; `/assets/*` cached **24h**; POST = `tx/submit` (CBOR) |
| GET | `/moralis/*` | Moralis v2.2; cached **60s** (burst dedup) |
| GET | `/opensea/*` | OpenSea v2; floors **10m**, contract→slug **7d** |

**Supabase** (service key server-side only):

| Method | Path | Op |
|---|---|---|
| GET | `/profile?address=0x…` | profile by EVM address |
| POST | `/sync` | upsert user + link wallets |
| POST | `/profile/update` | update display_name / avatar |

**Swap**: `/quote`, `/tokens`, `/ss/estimate`, `/ss/ranges`, `/ss/exchange`,
`/ss/status/:id`, `/ss/pairs`, `/ss/currencies` (client now routes SimpleSwap here).

## Deploy

```bash
cd cloudflare-worker
npm i -g wrangler        # if not installed
wrangler login

# 1. Create the cache namespace, then paste its id into wrangler.toml (kv_namespaces.id):
wrangler kv namespace create CACHE

# 2. Set ROTATED keys as secrets (old keys shipped in the bundle = burned).
#    Swap (existing):
wrangler secret put ZEROX_API_KEY
wrangler secret put ONEINCH_API_KEY
wrangler secret put JUPITER_API_KEY        # optional
wrangler secret put LIFI_API_KEY           # optional
wrangler secret put SIMPLESWAP_API_KEY
#    Read-path (new):
wrangler secret put ALCHEMY_KEY
wrangler secret put HELIUS_KEY
wrangler secret put TATUM_KEY
wrangler secret put BLOCKFROST_KEY
wrangler secret put MORALIS_KEY
wrangler secret put OPENSEA_KEY
#    Supabase (new — service-role key, server-side only):
wrangler secret put SUPABASE_SERVICE_KEY
#    Optional client gate (filters drive-by abuse):
wrangler secret put CLIENT_TOKEN

# 3. Deploy
wrangler deploy
```

`SUPABASE_URL` is a non-secret `[vars]` entry in `wrangler.toml`. Optional
per-IP limits: `READ_RPM` (default 600), `DB_RPM` (default 60).

## Local dev / smoke tests

```bash
# Provide secrets locally via .dev.vars (gitignored), then:
wrangler dev

# Alchemy RPC:
curl -s -X POST http://localhost:8787/rpc/alchemy/eth-mainnet \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

# OpenSea floor (should be a KV hit on the 2nd call):
curl -s "http://localhost:8787/opensea/collections/boredapeyachtclub/stats"

# Profile read:
curl -s "http://localhost:8787/profile?address=0x0000000000000000000000000000000000000000"
```

Verify **no key/secret** appears in any response body or header.

## Hardening notes

- The new read/db routes are rate-limited per IP and gated by an optional
  `x-mm-client` header (not a secret — it filters casual abuse). Swap routes are
  unchanged.
- **Supabase write auth:** `/sync` and `/profile/update` are gated by an EVM
  EIP-191 ownership signature (recovered in `auth.js` via `@noble/curves`), with a
  ±10-min freshness window and a KV replay-nonce — only the EVM key owner can write
  to a profile. `/profile` (GET) stays open + rate-limited. The profile identity is
  the EVM address (other chains are linked sub-records), so one secp256k1 signature
  authorizes the whole sync — no ed25519 path needed.
- Cardano (MuesliSwap) routing is a stub pending Cardano CBOR signing.
