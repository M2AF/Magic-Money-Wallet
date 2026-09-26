# Cardano swap integration research

Research date: **2026-09-26**. These findings are observations, not a production integration contract. No transaction was signed or submitted.

## 1. Minswap cancellation

**2026-09-26 finding:** The live `minswap.org/orders` frontend calls **`POST https://k-aggr-monorepo-mainnet-prod.minswap.org/aggregator/cancel-tx`**, rather than the public documentation host `agg-api.minswap.org`. Its loaded cancellation module sends JSON using a `keyAggregatorRestfulApi` client; the loaded configuration sets that client's base URL to `https://k-aggr-monorepo-mainnet-prod.minswap.org`. Sources: [orders page](https://minswap.org/orders), [frontend cancellation module](https://minswap.org/_next/static/chunks/0m0sie0u6ghfx.js), [frontend API-client module](https://minswap.org/_next/static/chunks/0d8azvqn_ci35.js), [frontend configuration module](https://minswap.org/_next/static/chunks/02t3dzmq_p4z9.js).

**2026-09-26 request shape:** The frontend's order-cancellation call constructs this body, which also matches [Minswap's published Aggregator API reference](https://docs.minswap.org/developer/aggregator-api):

```http
POST /aggregator/cancel-tx
Host: k-aggr-monorepo-mainnet-prod.minswap.org
Content-Type: application/json

{
  "sender": "<owner Cardano bech32 address>",
  "orders": [{ "protocol": "MinswapV2", "tx_in": "<transaction hash>#<output index>" }]
}
```

The frontend calls `walletHelper.getBaseAddress()`, passes that as `sender`, then signs and submits the returned `cbor` in the user wallet. **Do not call the latter step in research.** Source: [orders-page handler](https://minswap.org/_next/static/chunks/0mht4l0p1w2s3.js). The [official API reference](https://docs.minswap.org/developer/aggregator-api) says a successful build responds with `{ "cbor": "<hex-encoded unsigned transaction>" }`; this success response was **not** observed in the live probe.

**2026-09-26 live probe:** One unsigned-build request to the frontend's host, using the supplied owner and `f7cd594e8d453ce380f374bd3c08179511e45cc992512fd19877b6d600586c30#1`, reached the route. It returned HTTP 500:

```json
{"statusCode":500,"error":"Internal Server Error","message":"Invariant failed: Not all order UTXOs found"}
```

This proves the route exists at the frontend host, but does not prove the sample output is still pending, that the protocol label is correct for it, or that a cancellation can be built. No CBOR was returned. The response was observed directly from the endpoint above on 2026-09-26; the [frontend source](https://minswap.org/_next/static/chunks/0m0sie0u6ghfx.js) identifies the endpoint. Minswap's [public docs](https://docs.minswap.org/developer/aggregator-api) still point to `https://agg-api.minswap.org/aggregator/cancel-tx`, which was reported to return a route-level 404. Treat the frontend host as **observed, not guaranteed stable**; obtain Minswap's partner API commitment before shipping.

**2026-09-26 next verification:** Obtain a *currently pending* order from a wallet whose owner can confirm it, check its `protocol` and UTXO live, then perform only the unsigned build and inspect the CBOR. The sample order cannot supply that evidence. The frontend calls its cancellation route directly, so guessing `/cancel-order`, `/cancel-orders`, `/cancel`, or `/build-cancel-tx` is unnecessary. Source: [frontend cancellation module](https://minswap.org/_next/static/chunks/0m0sie0u6ghfx.js).

## 2. xReserve on Arc and Ethereum-to-Cardano deposit economics

**2026-09-26 verified addresses:** Circle's [supported domains table](https://developers.circle.com/xreserve/references/supported-blockchains-and-domains) lists Arc mainnet as source domain **26**, USDC `0x3600000000000000000000000000000000000000`, and xReserve `0x8888888199b2Df864bf678259607d6D5EBb4e3Ce`. The same xReserve address is listed for Ethereum mainnet, where USDC is `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48`. Cardano is remote domain **10004** (`0x2714`). These values come from Circle, rather than an inferred Arc chain ID.

**2026-09-26 contract behavior:** Circle's [deposit quickstart](https://developers.circle.com/xreserve/tutorials/deposit-usdc-into-xreserve) defines `depositToRemote(value, remoteDomain, remoteRecipient, localToken, maxFee, hookData)`. Circle's [contract source](https://github.com/circlefin/evm-xreserve-contracts/blob/master/src/modules/x-reserve/DepositToRemote.sol) describes `maxFee` as the **maximum fee payable on the remote domain**, in local-token units. The emitted `DepositedToRemote` event records `value` and `maxFee`; it does **not** record the fee actually charged on Cardano. The source-side input check rejects `value == 0` but has no fixed 11-USDC threshold in that function. This does not establish that the remote mint service accepts every positive deposit.

**2026-09-26 on-chain sample:** Reading `DepositedToRemote` logs from Ethereum mainnet xReserve over the latest 10,000 blocks and decoding only remote domain `10004` yielded 20 Cardano-directed events. One transaction deposited **3.981721 USDC** with `maxFee = 0.01 USDC`: [Ethereum transaction](https://etherscan.io/tx/0x6a7f66cb047de10b8db091403dac8791ad291e9c501f734fbdde65e20aae2c99). Another deposited **123.4 USDC** with `maxFee = 10 USDC`: [Ethereum transaction](https://etherscan.io/tx/0x5bab7db80cec3b8cf2c4e9f8e34d4febdb139963d1ce09fee9664b559f5b472a). The event signature and field meanings are in [Circle's contract source](https://github.com/circlefin/evm-xreserve-contracts/blob/master/src/modules/x-reserve/DepositToRemote.sol). These events show submitted/confirmed Ethereum deposits, **not** successful Cardano mint amounts or the charged fee. In particular, `maxFee = 10` must not be presented as a 10-USDC charge.

**2026-09-26 unresolved:** A current, generally applicable **charged Ethereum→Cardano bridge fee** and **minimum deposit that successfully mints USDCx** could not be established from Circle's public contract/docs or the sampled events. The [IOG portal terms, section 4](https://usdcx.iog.io/docs/USDCx_portal_terms_of_use.pdf) say a mint bridge fee can cover Cardano costs, minimum UTXO, and service costs; IOG can change or set fees to zero, and current fees appear in the Portal before confirmation. The observed 3.981721-USDC source event makes an asserted 11-USDC *contract* minimum untenable, but does not prove that amount minted. For implementation, obtain a live fee/minimum quote or documented rule from IOG, then reconcile its Cardano mint result with an Ethereum deposit ID before advertising an executable route.

## 3. Cardano USDCx burn and USDC withdrawal

**2026-09-26 verified workflow:** Circle's [xReserve mechanics](https://developers.circle.com/xreserve/concepts/how-xreserve-works) say the user requests a burn on the remote chain; the remote token contract burns and emits a burn event; the remote attestation service signs a burn intent for xReserve; xReserve verifies it and issues a withdrawal attestation before USDC is released. The [IOG portal terms, section 2](https://usdcx.iog.io/docs/USDCx_portal_terms_of_use.pdf) specifically describe IOG and Midgard Labs as co-attesters for Cardano USDCx mint/burn and Circle's attestation for release. The [official portal](https://usdcx.iog.io/bridge) offers the user-facing bridge.

**2026-09-26 integration status:** The reviewed [Circle xReserve docs](https://developers.circle.com/xreserve), [Circle's deposit quickstart](https://developers.circle.com/xreserve/tutorials/deposit-usdc-into-xreserve), [IOG portal](https://usdcx.iog.io/bridge), and [IOG portal terms](https://usdcx.iog.io/docs/USDCx_portal_terms_of_use.pdf) do **not** publish a third-party Cardano burn transaction API, SDK, datum/redeemer specification, attester access procedure, or status endpoint that this research can verify. Circle's quickstart is for **depositing** USDC from a source EVM chain, not constructing a Cardano burn. Absence from these reviewed sources is **not proof no private or forthcoming interface exists**. A wallet should not implement automated outbound routing from portal behavior alone.

**2026-09-26 status gap:** Circle documents the conceptual burn/withdrawal state transitions, but the reviewed public material does not define a Cardano-specific correlation ID, polling API, webhook, or terminal failure/recovery statuses for a third-party wallet. Sources: [Circle xReserve mechanics](https://developers.circle.com/xreserve/concepts/how-xreserve-works), [Circle xReserve docs](https://developers.circle.com/xreserve), [IOG portal terms](https://usdcx.iog.io/docs/USDCx_portal_terms_of_use.pdf). Ask IOG/Midgard for the supported Cardano burn builder or contract blueprint, attestation authorization, fee quote, and status/recovery contract before enabling USDCx→USDC in-wallet.
