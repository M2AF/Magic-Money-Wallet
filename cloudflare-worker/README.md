# MagicMoney Swap Proxy (Cloudflare Worker)

Security proxy that injects aggregator API keys server-side. The wallet client
calls this worker only — it never holds 0x / 1inch / Jupiter / LI.FI /
SimpleSwap keys, and keys never appear in any client response.

## Deploy

```bash
cd cloudflare-worker
npm i -g wrangler        # if not installed
wrangler login

# Set keys as secrets (never commit them):
wrangler secret put ZEROX_API_KEY
wrangler secret put ONEINCH_API_KEY
wrangler secret put JUPITER_API_KEY        # optional (public endpoint works keyless)
wrangler secret put LIFI_API_KEY           # optional
wrangler secret put SIMPLESWAP_API_KEY

wrangler deploy
```

Then bind `api.magicmoneywallet.com` to the worker (Cloudflare dashboard →
Worker → Triggers → Custom Domains) and set `swapProxyUrl` in the wallet config
to that origin.

## Routes

| Method | Path | Purpose |
|---|---|---|
| GET  | `/quote` | DEX quote (0x→1inch for EVM, Jupiter for Solana) → `NormalizedSwapQuote` |
| GET  | `/tokens?chain=` | Token list (currently returns empty; client uses its curated list) |
| GET  | `/ss/estimate` | SimpleSwap estimate |
| POST | `/ss/exchange` | Create SimpleSwap exchange |
| GET  | `/ss/status/:id` | SimpleSwap exchange status |
| GET  | `/ss/pairs` · `/ss/currencies` | SimpleSwap metadata |

## Local dev

```bash
wrangler dev
# quote smoke test (EVM):
curl "http://localhost:8787/quote?chain=ethereum&sell=0xeee…&buy=0xA0b8…&amount=1000000000000000000&slippageBps=50&taker=0xYourAddr"
```

## Notes

- **Cutover:** until this is deployed, the wallet talks to SimpleSwap's API
  directly (key in the Electron main process). Point `swapProxyUrl` at this
  worker and flip `simpleswap-client.ts` to the `/ss/*` routes to remove the
  client-side key entirely.
- Cardano (MuesliSwap) routing is a stub pending Cardano CBOR signing.
