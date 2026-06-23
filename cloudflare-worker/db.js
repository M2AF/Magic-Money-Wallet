/**
 * db.js — Supabase profile/wallet sync behind the Worker.
 *
 * SECURITY: the Supabase *service-role* key (full read/write, bypasses RLS) used
 * to ship inside the client bundle. It now lives ONLY as a Worker secret
 * (env.SUPABASE_SERVICE_KEY) and is never returned to the client. These routes
 * port the three operations from src/main/supabase-sync.ts via PostgREST.
 *
 * Residual limitation (documented): without wallet-signature auth these routes
 * still trust the caller's claimed address. They are address-scoped (no
 * enumeration) and rate-limited, so the catastrophic "dump the whole DB with the
 * service key" hole is closed; signature-gated writes are a planned follow-up.
 *
 * Required env: SUPABASE_URL, SUPABASE_SERVICE_KEY. Optional: CLIENT_TOKEN, DB_RPM.
 */

import { json, err, clientOk, rateLimit, pathParts, cacheGet, cachePut } from './lib.js'
import { verifyOwnership } from './auth.js'

const DB_NS = new Set(['profile', 'sync'])

// Single-use signature within its 10-min window (replay guard). Fail-open on no KV.
async function replayed(env, ctx, sigHex) {
  if (!env.CACHE || !sigHex) return false
  const key = `nonce:${String(sigHex).slice(2, 42)}`
  if (await cacheGet(env, key)) return true
  cachePut(env, ctx, key, 1, 600)
  return false
}

function sb(env, path, init = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
}

const isEvm = (a) => /^0x[0-9a-f]{40}$/.test(a)

/** Returns a Response for a db route, or null if this isn't a db route. */
export async function handleDb(request, url, env, ctx) {
  const parts = pathParts(url.pathname)
  if (!DB_NS.has(parts[0])) return null

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return err(env, 'DB not configured', 500)
  if (!clientOk(request, env)) return err(env, 'Forbidden', 403)
  // Tighter limit than read routes — these touch the database.
  const limit = Number(env.DB_RPM) || 60
  if (!(await rateLimit(request, env, ctx, { limit, windowSec: 60, bucket: 'db' })))
    return err(env, 'Rate limited', 429)

  // GET /profile?address=0x…
  if (parts[0] === 'profile' && parts.length === 1 && request.method === 'GET') {
    const address = (url.searchParams.get('address') || '').toLowerCase()
    if (!isEvm(address)) return err(env, 'Invalid address')
    return json(env, await getProfileByAddress(address, env))
  }

  // POST /profile/update  { userId, address, ts, signature, display_name?, avatar_url? }
  // Signature-gated: only the EVM owner of the profile may edit it.
  if (parts[0] === 'profile' && parts[1] === 'update' && request.method === 'POST') {
    const b = await request.json().catch(() => null)
    if (!b || !b.userId) return err(env, 'Missing userId')
    const addr = String(b.address || '').toLowerCase()
    if (!isEvm(addr)) return err(env, 'Invalid address')
    if (!verifyOwnership('profile-update', addr, b.ts, b.signature)) return err(env, 'Bad signature', 401)
    if (await replayed(env, ctx, b.signature)) return err(env, 'Replay', 401)
    const updates = {}
    if (typeof b.display_name === 'string') updates.display_name = b.display_name
    if (typeof b.avatar_url === 'string') updates.avatar_url = b.avatar_url
    if (Object.keys(updates).length === 0) return json(env, { success: true, error: null })
    // Constrain to the profile owned by the verified address (can't edit others).
    const res = await sb(env, `cl_users?id=eq.${encodeURIComponent(b.userId)}&provider_id=eq.${addr}`, {
      method: 'PATCH', body: JSON.stringify(updates),
    })
    return json(env, { success: res.ok, error: res.ok ? null : `DB ${res.status}` }, res.ok ? 200 : 502)
  }

  // POST /sync  { evm, ts, signature, solana?, cardano?, bitcoin?, polkadot? }
  // Signature-gated: the EVM key owner authorizes linking these addresses.
  if (parts[0] === 'sync' && request.method === 'POST') {
    const b = await request.json().catch(() => null)
    const evm = String(b?.evm || '').toLowerCase()
    if (!b || !isEvm(evm)) return err(env, 'Invalid evm address')
    if (!verifyOwnership('sync', evm, b.ts, b.signature)) return err(env, 'Bad signature', 401)
    if (await replayed(env, ctx, b.signature)) return err(env, 'Replay', 401)
    return json(env, await syncWallets(b, env))
  }

  return err(env, 'Not found', 404)
}

async function getProfileByAddress(evmAddress, env) {
  const wRes = await sb(env, `cl_wallets?address=eq.${evmAddress}&chain=eq.evm&select=user_id`, { method: 'GET' })
  const wallets = wRes.ok ? await wRes.json().catch(() => []) : []
  const userId = wallets[0]?.user_id
  if (!userId) return null
  const uRes = await sb(env, `cl_users?id=eq.${encodeURIComponent(userId)}&select=*,cl_wallets(*),cl_linked_accounts(*)`, { method: 'GET' })
  const users = uRes.ok ? await uRes.json().catch(() => []) : []
  return users[0] ?? null
}

async function syncWallets(addresses, env) {
  const evmLower = String(addresses.evm).toLowerCase()
  const shortAddr = `${evmLower.slice(0, 6)}…${evmLower.slice(-4)}`

  // 1. Upsert identity (provider,provider_id unique), return the row.
  const uRes = await sb(env, 'cl_users?on_conflict=provider,provider_id&select=*', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ provider: 'evm_wallet', provider_id: evmLower, display_name: shortAddr, avatar_url: null, email: null }),
  })
  if (!uRes.ok) return { success: false, profile: null, error: `upsert failed ${uRes.status}` }
  const user = (await uRes.json().catch(() => []))[0]
  if (!user) return { success: false, profile: null, error: 'upsert failed' }

  // 2. Link all wallet addresses.
  const now = new Date().toISOString()
  const rows = [
    { chain: 'evm', address: evmLower, watch_only: false },
    addresses.solana ? { chain: 'solana', address: addresses.solana, watch_only: false } : null,
    addresses.cardano ? { chain: 'cardano', address: addresses.cardano, watch_only: false } : null,
    addresses.bitcoin ? { chain: 'bitcoin', address: addresses.bitcoin, watch_only: false } : null,
    addresses.polkadot ? { chain: 'polkadot', address: addresses.polkadot, watch_only: false } : null,
  ].filter(Boolean).map(w => ({ ...w, user_id: user.id, verified_at: now }))
  await sb(env, 'cl_wallets?on_conflict=user_id,address', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows),
  })

  // 3. Re-fetch the full profile with joined tables.
  const fRes = await sb(env, `cl_users?id=eq.${encodeURIComponent(user.id)}&select=*,cl_wallets(*),cl_linked_accounts(*)`, { method: 'GET' })
  const full = fRes.ok ? (await fRes.json().catch(() => []))[0] : null
  return { success: true, profile: full ?? user, error: null }
}
