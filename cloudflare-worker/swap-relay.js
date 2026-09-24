/**
 * swap-relay.js — Relay execution adapter for the MagicMoney Worker.
 *
 * WHY RELAY
 *
 * Relay is a SOLVER network, not a bridge-then-swap router. It either fills the
 * whole intent or refunds the deposit, so there is no "you now hold the bridged
 * intermediate" outcome to recover from. It also routes pairs the other
 * providers do not: EMO(Monad) -> PIXL(Ethereum) quotes here and nowhere else we
 * have configured.
 *
 * WHAT THIS ADAPTER WILL AND WILL NOT EXECUTE
 *
 * Relay returns an ORDERED list of steps, each with items that each carry their
 * own `chainId`. The EMO -> PIXL route happened to be `approve` + `deposit` with
 * both items on the SOURCE chain, which this wallet can sign. That is a property
 * of that route, NOT of Relay, and it must be checked every time:
 *
 *   - every item must be on the SOURCE chain. An item on the destination chain
 *     needs a second signature there, which the swap executor cannot produce.
 *   - every step must be `kind: 'transaction'`. A `signature` step (EIP-712
 *     order, permit) is a different signing path and is not wired.
 *   - at most one approval, exactly one deposit, and nothing else.
 *
 * Anything outside that shape is REFUSED with a reason naming what was
 * unsupported, rather than executed partially. `validateRelaySteps` is exported
 * so the refusals are unit-tested against recorded routes.
 *
 * The fee rides inside the deposit: Relay takes `appFees: [{recipient, bps}]`
 * and reports the applied amount back in `fees.app`. It does NOT echo the
 * recipient at quote time, so the quote proves the amount and not the
 * destination; `data.paidAppFees[]` in the request history names the recipient
 * after settlement, which is where that gets reconciled.
 */

import {
  SWAP_FEE_POLICY_VERSION, SWAP_FEE_PROVIDERS, policyFeeBps, feeFreeRecord,
} from './swap-fee.js'
import { toChainId } from './swap-chains.js'

const RELAY_API = 'https://api.relay.link'

/**
 * Build the app-fee record from Relay's response.
 *
 * Relay normalizes its fee into a FEE CURRENCY — USDC on the source chain —
 * which is usually not the token being sold. So the applied rate cannot be a
 * ratio of raw amounts the way it is for LI.FI or Jupiter; the only common
 * denominator Relay gives is USD. That is accurate enough to confirm ~100 bps
 * and is recorded as the method, so nobody later mistakes it for an on-chain
 * measurement.
 *
 * The recipient is NOT echoed at quote time. It is carried as `recipient`
 * because that is who we asked to be paid, and the evidence says plainly that
 * the response did not confirm it.
 */
function relayAppFeeRecord(d, q, bps, recipient) {
  const cap = SWAP_FEE_PROVIDERS.relay
  const app = (d.fees && d.fees.app) || {}
  const cur = app.currency || {}
  const inUsd = Number((d.details && d.details.currencyIn && d.details.currencyIn.amountUsd) || 0)
  const feeUsd = Number(app.amountUsd || 0)
  // The only rate Relay lets us MEASURE: a ratio of two USD figures, each
  // rounded to 6dp. Measured live on EMO -> PIXL it landed at 98 (repeatably,
  // 2026-09-21) and at ~100 in the recorded fixture for the same 100 bps request,
  // so it is evidence ABOUT the rate, not the rate itself. Before this, the exact
  // tier check demoted the genuine 1% route to the fee-free fallback.
  const measuredBps = inUsd > 0 && feeUsd > 0 ? Math.round((feeUsd / inUsd) * 10000) : null

  const evidence = []
  let verification = 'requested-unverified'
  let appliedBps = null
  if (measuredBps == null) {
    evidence.push('relay: response stated no app fee amount')
  } else {
    evidence.push(`relay: fees.app = ${app.amount} ${cur.symbol || '?'} (${feeUsd} USD) on ${inUsd} USD input`)
    evidence.push(`relay: measured ~${measuredBps} bps by USD ratio (fee is denominated in the source chain's fee currency, not the sell token)`)
    // Within USD-rounding of what we asked for: Relay applied the requested
    // rate. `appliedBps` then records THAT rate, because the tier check compares
    // it exactly and a rounding artefact must not demote a genuinely fee-paying
    // route to the fee-free fallback. The measured figure stays in the evidence.
    // Outside the band it is left as measured and the route is not fee-verified.
    if (Math.abs(measuredBps - bps) <= 5) {
      verification = 'applied-verified'
      appliedBps = bps
    } else {
      appliedBps = measuredBps
      evidence.push(`relay: measured rate does not match the ${bps} bps requested`)
    }
  }
  evidence.push('relay: quote does NOT echo the fee recipient; data.paidAppFees[] names it only after settlement')

  return {
    policyVersion: SWAP_FEE_POLICY_VERSION,
    provider: 'relay',
    requestedBps: bps,
    appliedBps,
    base: cap.bases[0],
    chain: q.fromChain,
    tokenAddress: cur.address || null,
    tokenSymbol: cur.symbol || null,
    tokenDecimals: typeof cur.decimals === 'number' ? cur.decimals : null,
    amountRaw: app.amount != null ? String(app.amount) : null,
    recipient,
    recipientKind: cap.recipientKind,
    collection: cap.collection,
    providerSharePct: cap.providerSharePct ?? null,
    verification,
    evidence,
  }
}

/** Relay's own costs, reported separately — never as Magic Money revenue. */
function relayExternalFees(d) {
  const out = []
  const push = (name, f) => {
    if (!f || !f.amount || f.amount === '0') return
    out.push({
      name,
      tokenSymbol: (f.currency && f.currency.symbol) || null,
      tokenDecimals: (f.currency && typeof f.currency.decimals === 'number') ? f.currency.decimals : null,
      amountRaw: String(f.amount),
      amountUsd: f.amountUsd != null ? Number(f.amountUsd) : null,
    })
  }
  const fees = d.fees || {}
  push('Relay solver', fees.relayer)
  push('Network', fees.gas)
  return out
}

/** Our chain id -> Relay numeric chain id. Relay uses EVM ids plus its own for Solana. */
export const RELAY_CHAIN = {
  ethereum: 1, optimism: 10, bsc: 56, gnosis: 100, polygon: 137, monad: 143,
  worldchain: 480, hyperevm: 999, soneium: 1868, ronin: 2020, abstract: 2741,
  robinhood: 4663, arc: 5042, base: 8453, apechain: 33139, arbitrum: 42161,
  avalanche: 43114, blast: 81457, zora: 7777777, solana: 792703809,
}

const NATIVE_EVM = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
const NATIVE_ZERO = '0x0000000000000000000000000000000000000000'
const SOL_NATIVE_MINT = 'So11111111111111111111111111111111111111112'

/** Relay spells a chain's own coin as the zero address (EVM) / system id (Solana). */
function relayCurrency(chain, address) {
  const a = (address || '').trim()
  if (chain === 'solana') return a === SOL_NATIVE_MINT ? '11111111111111111111111111111111' : a
  return a.toLowerCase() === NATIVE_EVM ? NATIVE_ZERO : a
}

/**
 * Reject any route this wallet cannot complete, naming what was unsupported.
 *
 * Returns `{ ok, reason, approval, deposit }`. Pure, so the recorded routes in
 * src/shared/__fixtures__/relay can be asserted against it directly.
 */
export function validateRelaySteps(steps, sourceChainId) {
  if (!Array.isArray(steps) || steps.length === 0) {
    return { ok: false, reason: 'Relay returned no execution steps.' }
  }
  let approval = null
  let deposit = null

  for (const step of steps) {
    const id = String((step && step.id) || '')
    const kind = String((step && step.kind) || '')
    const items = Array.isArray(step && step.items) ? step.items : []

    if (kind !== 'transaction') {
      return { ok: false, reason: `Relay route needs a '${kind || 'unknown'}' step this wallet cannot sign.` }
    }
    if (items.length !== 1) {
      return { ok: false, reason: `Relay '${id}' step has ${items.length} transactions; only single-transaction steps are supported.` }
    }
    const data = (items[0] && items[0].data) || {}
    if (Number(data.chainId) !== Number(sourceChainId)) {
      // The whole reason cross-chain works here: we sign on the source chain
      // only. An item elsewhere means a destination-chain signature.
      return {
        ok: false,
        reason: `Relay route requires signing on chain ${data.chainId}, but this wallet signs the source chain (${sourceChainId}) only.`,
      }
    }
    if (!data.to || !data.data) {
      return { ok: false, reason: `Relay '${id}' step is missing transaction data.` }
    }

    if (id === 'approve' || id === 'approval') {
      if (approval) return { ok: false, reason: 'Relay route has more than one approval step.' }
      approval = data
    } else if (id === 'deposit' || id === 'swap' || id === 'send') {
      if (deposit) return { ok: false, reason: 'Relay route has more than one deposit step.' }
      deposit = data
    } else {
      return { ok: false, reason: `Relay route includes an unsupported '${id}' step.` }
    }
  }

  if (!deposit) return { ok: false, reason: 'Relay route has no deposit transaction to execute.' }

  // An approval must grant its allowance to the contract the deposit is sent to.
  // Otherwise the route approves one contract and deposits into another, and
  // the allowance outlives the swap as a standing grant nobody used. Measured on
  // EMO -> PIXL: spender and deposit target are both Relay's depository.
  if (approval) {
    const calldata = String(approval.data || '').toLowerCase()
    if (!calldata.startsWith('0x095ea7b3') || calldata.length !== 138) {
      return { ok: false, reason: 'Relay approval is not a standard ERC-20 approve.' }
    }
    const spender = `0x${calldata.slice(34, 74)}`
    if (spender !== String(deposit.to || '').toLowerCase()) {
      return {
        ok: false,
        reason: 'Relay approval grants an allowance to a different contract than the one receiving the deposit.',
      }
    }
  }
  return { ok: true, reason: null, approval, deposit }
}

/** The status endpoint Relay names on the deposit item, restricted to Relay's own origin. */
export function relayCheckEndpoint(steps) {
  for (const step of steps || []) {
    for (const item of (step && step.items) || []) {
      const ep = item && item.check && item.check.endpoint
      // Only a relative path on Relay's own API is ever followed. A provider
      // handing back an absolute URL must not become an outbound request target.
      if (typeof ep === 'string' && ep.startsWith('/')) return ep
    }
  }
  return null
}

/**
 * Quote a Relay route and map it onto the wallet's normalized shape.
 *
 * `noFee` asks for an explicitly fee-free quote, used as the tier-2 fallback
 * when a fee-paying route cannot be confirmed.
 */
async function relayPost(body, headers) {
  const res = await fetch(`${RELAY_API}/quote`, { method: 'POST', headers, body: JSON.stringify(body) })
  const text = await res.text()
  let d
  try {
    d = JSON.parse(text)
  } catch {
    throw new Error(`Relay returned a non-JSON response (HTTP ${res.status})`)
  }
  if (!res.ok) {
    // Relay's own words are more useful than a generic failure: AMOUNT_TOO_LOW
    // and SWAP_IMPACT_TOO_HIGH both tell the user what to change.
    throw new Error(d.message || d.errorCode || `Relay ${res.status}`)
  }
  return d
}

/**
 * A tighter tolerance when Relay's floor overshot the requested one, else null.
 *
 * Scaled by the MEASURED overshoot (requested / observed) and rounded down one
 * more bps, so the floor it enforces lands inside the approved bound. Returns
 * null when the floor is already inside it, or when the response has no floor
 * to measure (the wallet then refuses it on its own terms).
 */
export function relayTightenedTolerance(d, requestedBps) {
  const out = d && d.details && d.details.currencyOut
  if (!out || !/^[0-9]+$/.test(String(out.amount || '')) || !/^[0-9]+$/.test(String(out.minimumAmount || ''))) return null
  const amount = BigInt(out.amount), min = BigInt(out.minimumAmount)
  if (amount <= 0n || min <= 0n || min > amount) return null
  // Inside the bound: (amount - min) / amount <= requested / 10000.
  if ((amount - min) * 10000n <= BigInt(requestedBps) * amount) return null
  const observedBps = Number(((amount - min) * 1000000n) / amount) / 100
  if (!(observedBps > 0)) return null
  return Math.max(1, Math.floor((requestedBps * requestedBps) / observedBps) - 1)
}

export async function relayQuote(q, env, noFee) {
  // For every EVM chain, Relay's own id IS the standard EIP-155 chain id (only
  // Solana's 792703809 differs) — so the RPC-verified numeric id an imported
  // network sends is a valid fallback wherever the wallet chain-id STRING
  // (RELAY_CHAIN's key) has no entry.
  const fromId = RELAY_CHAIN[q.fromChain] ?? toChainId(q.fromChainId)
  const toId = RELAY_CHAIN[q.toChain] ?? toChainId(q.toChainId)
  if (fromId == null || toId == null) throw new Error('Relay: unsupported chain')
  // Solana source needs the Solana signing path plus Relay's own transaction
  // shape; only EVM sources are wired here.
  if (q.fromChain === 'solana') throw new Error('Relay: Solana source not enabled here')

  const bps = policyFeeBps(env)
  const recipient = env.FEE_EVM || ''
  const wantFee = !noFee && bps > 0 && !!recipient

  const body = {
    user: q.taker,
    recipient: q.toAddress || q.taker,
    originChainId: fromId,
    destinationChainId: toId,
    originCurrency: relayCurrency(q.fromChain, q.sell),
    destinationCurrency: relayCurrency(q.toChain, q.buy),
    amount: q.amount,
    tradeType: 'EXACT_INPUT',
    slippageTolerance: String(Number(q.slippageBps || 50)),
  }
  if (wantFee) body.appFees = [{ recipient, fee: String(bps) }]

  const headers = { 'content-type': 'application/json', accept: 'application/json' }
  if (env.RELAY_API_KEY) headers['x-api-key'] = env.RELAY_API_KEY

  let d = await relayPost(body, headers)

  // Relay's enforced floor can land slightly OUTSIDE the tolerance we asked for
  // (measured 2026-09-21, EMO -> MON on Monad: 250 bps requested, floor 2.52%
  // below output). The wallet refuses a floor weaker than the slippage the user
  // approved, exactly, so that quote could never be signed. Re-ask ONCE with a
  // tolerance scaled by the measured overshoot. This only ever TIGHTENS the
  // floor — the user's approved slippage is unchanged and the wallet still
  // checks the result exactly — so it cannot weaken any protection.
  const requestedBps = Number(q.slippageBps || 50)
  const tighter = relayTightenedTolerance(d, requestedBps)
  if (tighter != null) {
    d = await relayPost({ ...body, slippageTolerance: String(tighter) }, headers)
  }

  const steps = d.steps || []
  const check = validateRelaySteps(steps, fromId)
  if (!check.ok) throw new Error(check.reason)

  const details = d.details || {}
  const out = details.currencyOut || {}
  const outAmount = String(out.amount || '0')
  if (!outAmount || outAmount === '0') throw new Error('Relay: no output amount')

  const appFee = wantFee
    ? relayAppFeeRecord(d, q, bps, recipient)
    : feeFreeRecord('relay', q.fromChain, noFee ? 'quoted without an app fee (tier-2 fallback)' : 'no fee recipient configured')

  const sellAmt = Number(q.amount), buyAmt = Number(outAmount)
  // Relay quotes a GUARANTEED output: currencyOut.amount is already net of gas,
  // its relayer fee AND the app fee (fees.gas / fees.relayer are the solver's
  // own cost, already priced into that number, not charged separately on top).
  // So there is no additional source-side cost to normalize here — it is 0, not
  // unknown, which is why this is set rather than left null.
  const outUsd = out.amountUsd != null ? Number(out.amountUsd) : null
  return {
    provider: 'relay',
    fromChain: q.fromChain, toChain: q.toChain,
    fromTokenAddress: q.sell, toTokenAddress: q.buy,
    fromTokenSymbol: q.sellSymbol || '', toTokenSymbol: q.buySymbol || '',
    valuation: { outputUsd: Number.isFinite(outUsd) ? outUsd : null, sourceCostUsd: 0 },
    sellAmountRaw: q.amount,
    buyAmountRaw: outAmount,
    // Relay states its own floor. Measured 2026-09-20: minimumAmount is exactly
    // the quoted slippageTolerance below currencyOut.amount.
    minBuyAmountRaw: /^[0-9]+$/.test(String(out.minimumAmount || '')) ? String(out.minimumAmount) : undefined,
    minReceivedSource: /^[0-9]+$/.test(String(out.minimumAmount || '')) ? 'provider' : 'derived',
    estimatedGasRaw: '0',
    slippageBps: Number(q.slippageBps || 50),
    priceImpactPct: Number((details.totalImpact && details.totalImpact.percent) || 0),
    rate: sellAmt > 0 ? buyAmt / sellAmt : 0,
    expiresAt: Date.now() + 30_000,
    isCrossChain: q.fromChain !== q.toChain,
    toAddress: q.toAddress || q.taker,
    bridgeTool: 'relay',
    estimatedDurationSec: Number(details.timeEstimate || 0),
    feeBps: appFee.appliedBps ?? 0,
    appFee,
    externalFees: relayExternalFees(d),
    // Relay polls by requestId, not by transaction hash.
    requestId: d.requestId || null,
    relayCheckEndpoint: relayCheckEndpoint(steps),
    // The refund asset, so the failure mode can be shown before signing.
    relayRefund: details.refundCurrency && details.refundCurrency.currency
      ? {
          chainId: details.refundCurrency.currency.chainId ?? null,
          symbol: details.refundCurrency.currency.symbol ?? null,
          address: details.refundCurrency.currency.address ?? null,
        }
      : null,
    txData: { to: check.deposit.to, data: check.deposit.data, value: String(check.deposit.value || '0') },
    approvalTx: check.approval
      ? { to: check.approval.to, data: check.approval.data, value: String(check.approval.value || '0') }
      : null,
  }
}

/**
 * Relay settlement status.
 *
 * Returns the provider's own vocabulary plus the chains the money actually moved
 * on; `src/shared/swap-lifecycle.ts` decides what it means. A refund is paid on
 * the SOURCE chain while `metadata.currencyOut` still names the token that was
 * requested, so the delivered asset is never read from `currencyOut`.
 */
export async function relayStatus(p, env) {
  const requestId = p.get('requestId')
  if (!requestId) throw new Error('Relay: missing requestId')
  const headers = { accept: 'application/json' }
  if (env.RELAY_API_KEY) headers['x-api-key'] = env.RELAY_API_KEY

  const res = await fetch(`${RELAY_API}/requests/v2?id=${encodeURIComponent(requestId)}`, { headers })
  const text = await res.text()
  let d
  try {
    d = JSON.parse(text)
  } catch {
    return { status: 'pending', provider: 'relay', error: null }
  }
  const req = (d.requests || [])[0]
  if (!req) return { status: 'unknown', providerStatus: 'unknown', provider: 'relay', notFound: true, error: null }

  const data = req.data || {}
  const meta = data.metadata || {}
  const inTx = (data.inTxs || [])[0] || {}
  const outTx = (data.outTxs || [])[0] || {}
  const status = String(req.status || '')
  const refunded = status === 'refund'

  // On a refund the money came back on the SOURCE chain; on success the
  // delivered asset is the one the solver actually sent.
  const deliveredCurrency = refunded
    ? (data.currencyObject || null)
    : ((meta.currencyOut && meta.currencyOut.currency) || null)

  return {
    status: status === 'success' ? 'done' : status === 'failure' ? 'failed' : 'pending',
    provider: 'relay',
    providerStatus: status || null,
    failReason: data.failReason && data.failReason !== 'N/A' ? data.failReason : null,
    receivedAmountRaw: refunded ? null : ((meta.currencyOut && meta.currencyOut.amount) || null),
    receivedTokenAddress: deliveredCurrency ? (deliveredCurrency.address || null) : null,
    receivedTokenSymbol: deliveredCurrency ? (deliveredCurrency.symbol || null) : null,
    receivedTokenDecimals: deliveredCurrency && typeof deliveredCurrency.decimals === 'number'
      ? deliveredCurrency.decimals : null,
    receivedTokenChain: outTx.chainId != null ? String(outTx.chainId) : null,
    sourceChain: inTx.chainId != null ? String(inTx.chainId) : null,
    outboundChain: outTx.chainId != null ? String(outTx.chainId) : null,
    destTxHash: outTx.hash || null,
    destExplorerUrl: null,
    // Recipient-level fee evidence, available only AFTER settlement. This is the
    // one provider that states who was actually paid.
    paidAppFees: Array.isArray(data.paidAppFees) ? data.paidAppFees : null,
    error: null,
  }
}
