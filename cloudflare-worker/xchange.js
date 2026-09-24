/**
 * xchange.js — deposit-address exchange routes (SimpleSwap /ss/*, ChangeNOW /cn/*).
 *
 * These forward to providers with server-held keys, so every route is:
 *   1. validated — only known parameters/fields are rebuilt and forwarded; a caller
 *      can no longer pass arbitrary query strings or bodies to the provider APIs,
 *      and an empty or malformed exchange id can no longer reach a list endpoint;
 *   2. rate limited — per route class, per caller IP, via Workers Rate Limiting
 *      bindings (per Cloudflare location, eventually consistent), plus a per-IP
 *      hourly cap and a location-wide cap on exchange creation.
 *
 * Neither CORS nor the wallet's public x-mm-client tag is authentication, and
 * nothing here depends on them. Callers today: Magic Money desktop/extension/
 * mobile (one user per IP) and the ChainLens backend (many users behind one
 * server IP, already limited per end user on its side). The per-IP budgets below
 * are sized for the ChainLens server; see the README "Exchange routes" note.
 */

import { json, err, cors, rateLimit } from './lib.js'

const SS = 'https://api.simpleswap.io/v3'
const CN = 'https://api.changenow.io/v2'

const MAX_BODY_BYTES = 4096
const CODE = /^[A-Za-z0-9_-]{1,24}$/            // provider ticker / network code
const ID = /^[A-Za-z0-9_-]{4,100}$/              // provider exchange id
const ADDRESS = /^[\x21-\x7e]{1,150}$/          // printable, no whitespace
const MEMO = /^[\x20-\x7e]{0,100}$/
const RATE_ID = /^[\x21-\x7e]{1,200}$/

/** Hourly per-IP creation cap (KV-backed; see lib.rateLimit). */
export const CREATE_PER_HOUR = 200

// ─── Validation ──────────────────────────────────────────────────────────────

class BadRequest extends Error {
  constructor(message, status = 400) { super(message); this.status = status }
}

function amount(value, name) {
  const v = String(value ?? '').trim()
  // Plain decimal (wallet inputs may be ".5" or "0.50"); positive and finite.
  if (!/^(?=.*\d)\d{0,24}(?:\.\d{0,24})?$/.test(v) || !(Number(v) > 0) || !Number.isFinite(Number(v))) {
    throw new BadRequest(`Invalid ${name}.`)
  }
  return v
}
function code(value, name) {
  const v = String(value ?? '')
  if (!CODE.test(v)) throw new BadRequest(`Invalid ${name}.`)
  return v
}
function optional(value, re, name) {
  if (value == null || value === '') return ''
  if (typeof value !== 'string' || !re.test(value)) throw new BadRequest(`Invalid ${name}.`)
  return value
}
function bool(value, name) {
  if (value === true || value === 'true') return true
  if (value === false || value === 'false' || value == null || value === '') return false
  throw new BadRequest(`Invalid ${name}.`)
}
function oneOf(value, allowed, fallback, name) {
  if (value == null || value === '') return fallback
  if (!allowed.includes(value)) throw new BadRequest(`Invalid ${name}.`)
  return value
}

/** Read a small JSON object body, refusing oversized or non-object payloads. */
async function jsonBody(request) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw new BadRequest('Request body too large.', 413)
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new BadRequest('Request body too large.', 413)
  let body
  try { body = JSON.parse(text) } catch { throw new BadRequest('Request body must be JSON.') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequest('Request body must be a JSON object.')
  return body
}

/** `/ss/status/<id>` → id, with exactly one non-empty, well-formed segment. */
function statusId(pathname, prefix) {
  const rest = pathname.slice(prefix.length)
  let id
  try { id = decodeURIComponent(rest) } catch { throw new BadRequest('Invalid exchange id.') }
  if (!ID.test(id)) throw new BadRequest('Invalid exchange id.')
  return id
}

// ─── Upstream ────────────────────────────────────────────────────────────────

const PROVIDER_NAME = { ss: 'SimpleSwap', cn: 'ChangeNOW' }

function keyHeaders(provider, env) {
  if (provider === 'ss') {
    if (!env.SIMPLESWAP_API_KEY) return null
    return { 'x-api-key': env.SIMPLESWAP_API_KEY, accept: 'application/json' }
  }
  if (!env.CHANGENOW_API_KEY) return null
  return { 'x-changenow-api-key': env.CHANGENOW_API_KEY, accept: 'application/json' }
}

/**
 * Call the provider and relay its answer verbatim (status + body), so both
 * clients keep reading the provider shapes they already parse. A provider that
 * cannot be reached becomes a 502 JSON error rather than an opaque Worker 500.
 */
async function upstream(env, provider, url, { method = 'GET', body = null, create = false } = {}) {
  const headers = keyHeaders(provider, env)
  if (!headers) return err(env, `${PROVIDER_NAME[provider]} is not configured.`, 503)
  let res
  try {
    res = await fetch(url, {
      method,
      headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(create ? 20_000 : 15_000),
    })
  } catch {
    // For a create, a lost response does not mean no exchange was made.
    return err(env, create
      ? `${PROVIDER_NAME[provider]} did not answer. The exchange may or may not have been created; check its status before trying again.`
      : `${PROVIDER_NAME[provider]} is unavailable. Try again shortly.`, 502)
  }
  const text = await res.text()
  return new Response(text, { status: res.status, headers: { 'Content-Type': 'application/json', ...cors(env) } })
}

// ─── Rate limits ─────────────────────────────────────────────────────────────

/** Route class → the Rate Limiting binding that meters it. */
export const LIMITERS = {
  quote: 'XCHANGE_QUOTE_LIMITER',    // estimate + range
  status: 'XCHANGE_STATUS_LIMITER',
  create: 'XCHANGE_CREATE_LIMITER',
  list: 'XCHANGE_LIST_LIMITER',      // pairs / currencies
}
export const CREATE_GLOBAL_LIMITER = 'XCHANGE_CREATE_GLOBAL_LIMITER'

const callerIp = (request) => request.headers.get('CF-Connecting-IP') || 'unknown'

/**
 * One Rate Limiting binding check. A missing binding (local dev, or a deploy
 * without the config) or a binding error is fail-open, like lib.rateLimit: this
 * is abuse control and must not take the exchange down on its own failure.
 */
export async function bindingAllows(env, bindingName, key) {
  const binding = env[bindingName]
  if (!binding || typeof binding.limit !== 'function') return true
  try {
    const { success } = await binding.limit({ key })
    return success !== false
  } catch {
    return true
  }
}

function tooMany(env, message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors(env) },
  })
}

async function limited(request, env, ctx, kind) {
  const ip = callerIp(request)
  if (!(await bindingAllows(env, LIMITERS[kind], `${kind}:${ip}`))) {
    return tooMany(env, 'Too many exchange requests. Please wait a minute and try again.')
  }
  if (kind === 'create') {
    if (!(await bindingAllows(env, CREATE_GLOBAL_LIMITER, 'create:all'))) {
      return tooMany(env, 'Exchange creation is busy. Please try again in a minute.')
    }
    if (!(await rateLimit(request, env, ctx, { limit: CREATE_PER_HOUR, windowSec: 3600, bucket: 'xcreate-h' }))) {
      return tooMany(env, 'Too many exchanges created from this network in the last hour.')
    }
  }
  return null
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const routes = {
  // SimpleSwap: short param names from the wallet; the Worker adds the key.
  '/ss/estimate': ['quote', 'GET', (p) => {
    const q = new URLSearchParams({
      tickerFrom: code(p.get('from'), 'from'), networkFrom: code(p.get('fromNet'), 'fromNet'),
      tickerTo: code(p.get('to'), 'to'), networkTo: code(p.get('toNet'), 'toNet'),
      amount: amount(p.get('amount'), 'amount'), fixed: String(bool(p.get('fixed'), 'fixed')), reverse: 'false',
    })
    return ['ss', `${SS}/estimates?${q}`]
  }],
  '/ss/ranges': ['quote', 'GET', (p) => {
    const q = new URLSearchParams({
      tickerFrom: code(p.get('from'), 'from'), networkFrom: code(p.get('fromNet'), 'fromNet'),
      tickerTo: code(p.get('to'), 'to'), networkTo: code(p.get('toNet'), 'toNet'),
      fixed: String(bool(p.get('fixed'), 'fixed')),
    })
    return ['ss', `${SS}/ranges?${q}`]
  }],
  '/ss/pairs': ['list', 'GET', (p) => {
    const q = new URLSearchParams({ fixed: String(bool(p.get('fixed'), 'fixed')) })
    return ['ss', `${SS}/pairs?${q}`]
  }],
  '/ss/currencies': ['list', 'GET', () => ['ss', `${SS}/currencies`]],

  // ChangeNOW: its own v2 param names; only the ones the clients use pass through.
  '/cn/estimate': ['quote', 'GET', (p) => {
    const q = new URLSearchParams({
      fromCurrency: code(p.get('fromCurrency'), 'fromCurrency'), toCurrency: code(p.get('toCurrency'), 'toCurrency'),
      fromNetwork: code(p.get('fromNetwork'), 'fromNetwork'), toNetwork: code(p.get('toNetwork'), 'toNetwork'),
      fromAmount: amount(p.get('fromAmount'), 'fromAmount'),
      flow: oneOf(p.get('flow'), ['standard', 'fixed-rate'], 'standard', 'flow'),
      type: oneOf(p.get('type'), ['direct'], 'direct', 'type'),
    })
    const useRateId = p.get('useRateId')
    if (useRateId != null) q.set('useRateId', String(bool(useRateId, 'useRateId')))
    return ['cn', `${CN}/exchange/estimated-amount?${q}`]
  }],
  '/cn/range': ['quote', 'GET', (p) => {
    const q = new URLSearchParams({
      fromCurrency: code(p.get('fromCurrency'), 'fromCurrency'), toCurrency: code(p.get('toCurrency'), 'toCurrency'),
      fromNetwork: code(p.get('fromNetwork'), 'fromNetwork'), toNetwork: code(p.get('toNetwork'), 'toNetwork'),
      flow: oneOf(p.get('flow'), ['standard', 'fixed-rate'], 'standard', 'flow'),
    })
    return ['cn', `${CN}/exchange/range?${q}`]
  }],
}

function ssExchangeBody(b) {
  if (b.reverse === true || b.reverse === 'true') throw new BadRequest('Reverse exchanges are not supported.')
  const addressTo = String(b.addressTo ?? '')
  if (!ADDRESS.test(addressTo)) throw new BadRequest('Invalid addressTo.')
  const rateId = b.rateId == null || b.rateId === '' ? null : optional(b.rateId, RATE_ID, 'rateId')
  return {
    fixed: bool(b.fixed, 'fixed'),
    tickerFrom: code(b.tickerFrom, 'tickerFrom'), networkFrom: code(b.networkFrom, 'networkFrom'),
    tickerTo: code(b.tickerTo, 'tickerTo'), networkTo: code(b.networkTo, 'networkTo'),
    amount: amount(b.amount, 'amount'),
    reverse: false,
    addressTo,
    extraIdTo: optional(b.extraIdTo, MEMO, 'extraIdTo'),
    userRefundAddress: optional(b.userRefundAddress, ADDRESS, 'userRefundAddress'),
    userRefundExtraId: optional(b.userRefundExtraId, MEMO, 'userRefundExtraId'),
    rateId,
  }
}

function cnExchangeBody(b) {
  const address = String(b.address ?? '')
  if (!ADDRESS.test(address)) throw new BadRequest('Invalid address.')
  const out = {
    fromCurrency: code(b.fromCurrency, 'fromCurrency'), toCurrency: code(b.toCurrency, 'toCurrency'),
    fromNetwork: code(b.fromNetwork, 'fromNetwork'), toNetwork: code(b.toNetwork, 'toNetwork'),
    fromAmount: amount(b.fromAmount, 'fromAmount'),
    address,
    extraId: optional(b.extraId, MEMO, 'extraId'),
    refundAddress: optional(b.refundAddress, ADDRESS, 'refundAddress'),
    refundExtraId: optional(b.refundExtraId, MEMO, 'refundExtraId'),
    flow: oneOf(b.flow, ['standard', 'fixed-rate'], 'standard', 'flow'),
    type: oneOf(b.type, ['direct'], 'direct', 'type'),
  }
  if (b.rateId != null && b.rateId !== '') out.rateId = optional(b.rateId, RATE_ID, 'rateId')
  return out
}

/**
 * Handle /ss/* and /cn/*. Returns null for any other path so the caller's
 * dispatch continues unchanged.
 */
export async function handleXchange(request, url, env, ctx) {
  const { pathname } = url
  if (!pathname.startsWith('/ss/') && !pathname.startsWith('/cn/')) return null
  const provider = pathname.startsWith('/ss/') ? 'ss' : 'cn'
  const isCreate = pathname === `/${provider}/exchange`
  const statusPrefix = `/${provider}/status/`
  const isStatus = pathname.startsWith(statusPrefix)
  const route = routes[pathname]
  if (!route && !isCreate && !isStatus) return err(env, 'Not found', 404)

  const kind = isCreate ? 'create' : isStatus ? 'status' : route[0]
  const method = isCreate ? 'POST' : 'GET'
  if (request.method !== method) {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json', Allow: method, ...cors(env) },
    })
  }

  // Limit before validating, so malformed floods are metered too.
  const blocked = await limited(request, env, ctx, kind)
  if (blocked) return blocked

  try {
    if (isCreate) {
      const body = await jsonBody(request)
      return provider === 'ss'
        ? await upstream(env, 'ss', `${SS}/exchanges`, { method: 'POST', body: ssExchangeBody(body), create: true })
        : await upstream(env, 'cn', `${CN}/exchange`, { method: 'POST', body: cnExchangeBody(body), create: true })
    }
    if (isStatus) {
      const id = encodeURIComponent(statusId(pathname, statusPrefix))
      return await upstream(env, provider, provider === 'ss' ? `${SS}/exchanges/${id}` : `${CN}/exchange/by-id?id=${id}`)
    }
    const [p, target] = route[2](url.searchParams)
    return await upstream(env, p, target)
  } catch (e) {
    if (e instanceof BadRequest) return err(env, e.message, e.status)
    throw e
  }
}
