/**
 * near-intents.js — NEAR Intents 1Click, with Magic Money's partner key.
 *
 *   POST /near-intents/quote    forwards a quote request to 1click.chaindefuser.com/v0/quote
 *   GET  /near-intents/status   forwards /v0/status?depositAddress=...
 *
 * The partner key (ONE_CLICK_API_KEY, a Worker secret) never reaches the app:
 * it is attached here. Only the fields a Cardano-ADA quote needs are forwarded,
 * and only Cardano ADA is accepted as the origin, so the key cannot be used to
 * quote arbitrary routes. `appFees` may only name the configured Magic Money
 * NEAR account (NEAR_FEE_ACCOUNT) at the configured rate (NEAR_FEE_BPS).
 *
 * The response is passed through verbatim: the wallet verifies 1Click's quote
 * signature itself, so a proxy cannot alter a deposit address or minimum
 * without the quote being refused.
 */
import { cors, err, clientOk } from './lib.js'
import { bindingAllows } from './xchange.js'

const ONE_CLICK = 'https://1click.chaindefuser.com'
const CARDANO_ADA = 'nep141:cardano.omft.near'
const FIELDS = ['dry', 'swapType', 'slippageTolerance', 'originAsset', 'depositType', 'destinationAsset', 'amount',
  'refundTo', 'refundType', 'recipient', 'recipientType', 'deadline']

const out = (env, status, body) => new Response(body, { status, headers: { 'Content-Type': 'application/json', ...cors(env) } })

export async function handleNearIntents(request, url, env) {
  if (!url.pathname.startsWith('/near-intents/')) return null
  if (!clientOk(request, env)) return err(env, 'Forbidden', 403)
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
  const quote = url.pathname === '/near-intents/quote'
  if (!(await bindingAllows(env, quote ? 'SWAP_QUOTE_LIMITER' : 'SWAP_STATUS_LIMITER', `near:${quote ? 'quote' : 'status'}:${ip}`))) {
    return new Response(JSON.stringify({ message: 'Too many swap requests. Please wait a minute and try again.' }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors(env) },
    })
  }
  const headers = { accept: 'application/json' }
  if (env.ONE_CLICK_API_KEY) headers['x-api-key'] = env.ONE_CLICK_API_KEY

  if (quote) {
    if (request.method !== 'POST') return err(env, 'Method not allowed', 405)
    let body
    try { body = await request.json() } catch { return err(env, 'Invalid JSON', 400) }
    // Into or out of Cardano: exactly one side is Cardano ADA.
    if (!body || typeof body !== 'object' || (body.originAsset === CARDANO_ADA) === (body.destinationAsset === CARDANO_ADA)) {
      return err(env, 'Only quotes into or out of Cardano ADA are served here.', 400)
    }
    const forward = {}
    for (const k of FIELDS) if (body[k] !== undefined) forward[k] = body[k]
    if (body.appFees !== undefined) {
      const bps = Number(env.NEAR_FEE_BPS ?? 0)
      const ok = Array.isArray(body.appFees) && body.appFees.length === 1 && env.NEAR_FEE_ACCOUNT && bps > 0
        && body.appFees[0]?.recipient === env.NEAR_FEE_ACCOUNT && body.appFees[0]?.fee === bps
      if (!ok) return err(env, 'App fees must name the configured Magic Money account and rate.', 400)
      forward.appFees = [{ recipient: env.NEAR_FEE_ACCOUNT, fee: bps }]
    }
    const res = await fetch(`${ONE_CLICK}/v0/quote`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(forward),
    })
    return out(env, res.status, await res.text())
  }

  if (url.pathname === '/near-intents/status') {
    const deposit = url.searchParams.get('depositAddress') || ''
    if (!/^[A-Za-z0-9_]{20,140}$/.test(deposit)) return err(env, 'Invalid deposit address.', 400)
    const res = await fetch(`${ONE_CLICK}/v0/status?depositAddress=${encodeURIComponent(deposit)}`, { headers })
    return out(env, res.status, await res.text())
  }
  return err(env, 'Not found', 404)
}
