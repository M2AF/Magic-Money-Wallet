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

// ─── Hidden/spam asset lists (cl_asset_filters) ──────────────────────────────
//
// Ported from src/shared/asset-filter-key.ts — the SAME merge the wallet and the
// ChainLens website run. Every client pushes its whole list, so a plain overwrite
// would let the desktop silently undo a hide made on the phone; merging per key
// on the newer timestamp is what makes them converge, and what lets a restore
// ('a') out-rank a stale hide instead of being re-added by it.
const MAX_FILTER_ENTRIES = 2000

function sanitizeEntries(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [key, e] of Object.entries(value)) {
    if (!key || key.length > 256) continue
    if (!e || typeof e !== 'object') continue
    if (e.s !== 'h' && e.s !== 's' && e.s !== 'a') continue
    if (typeof e.t !== 'number' || !Number.isFinite(e.t)) continue
    out[key] = { s: e.s, t: e.t }
  }
  return out
}

function mergeEntries(base, incoming) {
  const out = {}
  for (const src of [sanitizeEntries(base), sanitizeEntries(incoming)]) {
    for (const [key, e] of Object.entries(src)) {
      if (!out[key] || e.t > out[key].t) out[key] = e
    }
  }
  const keys = Object.keys(out)
  if (keys.length <= MAX_FILTER_ENTRIES) return out
  const kept = {}
  for (const key of keys.sort((a, b) => out[b].t - out[a].t).slice(0, MAX_FILTER_ENTRIES)) kept[key] = out[key]
  return kept
}

async function readFilters(userId, env) {
  const res = await sb(env, `cl_asset_filters?user_id=eq.${encodeURIComponent(userId)}&select=entries`, { method: 'GET' })
  // A missing table (operator hasn't run sql/cl_asset_filters.sql yet) reads as
  // "nothing hidden" rather than a 500 — the wallet then keeps its local list.
  if (!res.ok) return {}
  const rows = await res.json().catch(() => [])
  return sanitizeEntries(rows[0]?.entries)
}

// ─── Custom themes (cl_themes) ────────────────────────────────────────────────
//
// HAND-KEPT PORT of src/shared/theme-sync-wire.ts. Drift is SILENT — a theme
// simply never shows up on the other device — so change the two together.
//
// Same reason the merge lives server-side as the filters above: every client
// pushes its whole list, so a plain overwrite would let the desktop undo a theme
// made on the phone. `d: 1` is a TOMBSTONE; dropping the key instead would let
// another device's copy resurrect a deleted theme forever.
const MAX_THEME_ENTRIES = 64
const THEME_ID_MAX = 64
const THEME_NAME_MAX = 24
const THEME_HEX = /^#[0-9a-f]{6}$/i

function cleanThemeHex(value) {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return THEME_HEX.test(v) ? v.toLowerCase() : null
}

function sanitizeThemes(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  let seen = 0
  for (const [id, e] of Object.entries(value)) {
    if (seen >= MAX_THEME_ENTRIES) break
    if (!id || id.length > THEME_ID_MAX || !id.startsWith('custom-')) continue
    if (!e || typeof e !== 'object') continue
    // typeof first: Number(null) is 0, a finite non-negative number, so a null
    // timestamp would sail through as "oldest possible" instead of being
    // rejected. t = 0 itself stays legal (migrated pre-sync themes use it).
    if (typeof e.t !== 'number' || !Number.isFinite(e.t) || e.t < 0) continue

    if (e.d === 1) {
      out[id] = { n: '', c: { bg: '', accent: '', text: '' }, t: e.t, d: 1 }
      seen++
      continue
    }
    const bg = cleanThemeHex(e.c?.bg)
    const accent = cleanThemeHex(e.c?.accent)
    const text = cleanThemeHex(e.c?.text)
    if (!bg || !accent || !text) continue
    out[id] = {
      n: (typeof e.n === 'string' ? e.n : '').trim().slice(0, THEME_NAME_MAX) || 'Custom',
      c: { bg, accent, text },
      t: e.t,
    }
    seen++
  }
  return out
}

function mergeThemes(base, incoming) {
  const out = {}
  for (const src of [sanitizeThemes(base), sanitizeThemes(incoming)]) {
    for (const [id, e] of Object.entries(src)) {
      if (!out[id] || e.t >= out[id].t) out[id] = e
    }
  }
  const ids = Object.keys(out)
  if (ids.length <= MAX_THEME_ENTRIES) return out
  // Over the ceiling, live themes are kept and the OLDEST TOMBSTONES go first:
  // dropping a live theme here would delete someone's work.
  const live = ids.filter(id => out[id].d !== 1)
  const dead = ids.filter(id => out[id].d === 1).sort((a, b) => out[b].t - out[a].t)
  const kept = {}
  for (const id of [...live, ...dead.slice(0, Math.max(0, MAX_THEME_ENTRIES - live.length))]) kept[id] = out[id]
  return kept
}

/**
 * Returns { entries, ok }. `ok: false` means the read itself failed — almost
 * always because sql/cl_themes.sql has not been run yet.
 *
 * The two cases MUST be distinguishable. Collapsing them both to `{}`, the way
 * readFilters does, makes "you have no themes" and "the table does not exist"
 * look identical to every caller, which is precisely how a broken deployment
 * hid behind a working-looking wallet.
 */
async function readThemes(userId, env) {
  const res = await sb(env, `cl_themes?user_id=eq.${encodeURIComponent(userId)}&select=entries`, { method: 'GET' })
  if (!res.ok) return { entries: {}, ok: false }
  const rows = await res.json().catch(() => [])
  return { entries: sanitizeThemes(rows[0]?.entries), ok: true }
}

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

  // GET /profile/filters?address=0x…  → { entries }
  // Unsigned like GET /profile: the list of assets someone chose not to look at
  // is not a secret, and the route is address-scoped so it can't be enumerated.
  // No profile is an empty list, not an error — the client keeps its local one.
  if (parts[0] === 'profile' && parts[1] === 'filters' && request.method === 'GET') {
    const address = (url.searchParams.get('address') || '').toLowerCase()
    if (!isEvm(address)) return err(env, 'Invalid address')
    const userId = await pickOwner(await candidateOwners(address, env, false), env)
    return json(env, { entries: userId ? await readFilters(userId, env) : {} })
  }

  // POST /profile/filters  { address, ts, signature, entries }  → { entries }
  // Signature-gated, and resolved against VERIFIED links only: honouring a
  // watch-only link would let anyone who adds your address to their profile
  // rewrite what your wallet shows you.
  if (parts[0] === 'profile' && parts[1] === 'filters' && request.method === 'POST') {
    const b = await request.json().catch(() => null)
    const addr = String(b?.address || '').toLowerCase()
    if (!b || !isEvm(addr)) return err(env, 'Invalid address')
    if (!verifyOwnership('filters-update', addr, b.ts, b.signature)) return err(env, 'Bad signature', 401)
    if (await replayed(env, ctx, b.signature)) return err(env, 'Replay', 401)

    const userId = await pickOwner(await candidateOwners(addr, env, true), env)
    // 404 is the contract with the client: it means "create a profile, then push
    // again". Creating one here would mint accounts on an unauthenticated shape
    // this route never validates, so that stays on /sync.
    if (!userId) return err(env, 'No profile', 404)

    // Read-merge-write. Two devices pushing in the same instant can still lose
    // one side's newest decision; the user simply hides it again, which is not
    // worth a transaction on a preferences list.
    const merged = mergeEntries(await readFilters(userId, env), b.entries)
    const wRes = await sb(env, 'cl_asset_filters?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: userId, entries: merged, updated_at: new Date().toISOString() }),
    })
    if (!wRes.ok) return err(env, `DB ${wRes.status}`, 502)
    return json(env, { entries: merged, error: null })
  }

  // GET /profile/themes?address=0x…  → { entries }
  // Unsigned like GET /profile/filters: a colour scheme is not a secret, and the
  // route is address-scoped so it can't be enumerated. No profile is an empty
  // map, not an error — the client keeps the themes it has locally.
  if (parts[0] === 'profile' && parts[1] === 'themes' && request.method === 'GET') {
    const address = (url.searchParams.get('address') || '').toLowerCase()
    if (!isEvm(address)) return err(env, 'Invalid address')
    const userId = await pickOwner(await candidateOwners(address, env, false), env)
    if (!userId) return json(env, { entries: {}, profile: false })
    const read = await readThemes(userId, env)
    // `unavailable` lets the wallet say "the table isn't there" instead of
    // silently showing an empty list that looks like a working empty profile.
    return json(env, { entries: read.entries, profile: true, unavailable: !read.ok })
  }

  // POST /profile/themes  { address, ts, signature, entries }  → { entries }
  // Signature-gated and resolved against VERIFIED links only, same as filters:
  // honouring a watch-only link would let anyone who adds your address to their
  // profile rewrite the themes your wallet offers you.
  if (parts[0] === 'profile' && parts[1] === 'themes' && request.method === 'POST') {
    const b = await request.json().catch(() => null)
    const addr = String(b?.address || '').toLowerCase()
    if (!b || !isEvm(addr)) return err(env, 'Invalid address')
    if (!verifyOwnership('themes-update', addr, b.ts, b.signature)) return err(env, 'Bad signature', 401)
    if (await replayed(env, ctx, b.signature)) return err(env, 'Replay', 401)

    const userId = await pickOwner(await candidateOwners(addr, env, true), env)
    // Same contract as filters: 404 means "create a profile, then push again".
    if (!userId) return err(env, 'No profile', 404)

    const merged = mergeThemes((await readThemes(userId, env)).entries, b.entries)
    const wRes = await sb(env, 'cl_themes?on_conflict=user_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ user_id: userId, entries: merged, updated_at: new Date().toISOString() }),
    })
    if (!wRes.ok) {
      // Pass Postgres's own words through — "relation cl_themes does not exist"
      // is an instruction; "DB 404" is a riddle. Nothing sensitive: this is a
      // schema error on a table whose shape is public in the repo.
      const detail = await wRes.text().catch(() => '')
      let hint = ''
      try { hint = JSON.parse(detail).message || '' } catch { hint = detail.slice(0, 120) }
      return err(env, `DB ${wRes.status}${hint ? `: ${hint}` : ''}`, 502)
    }
    return json(env, { entries: merged, error: null })
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

/**
 * Which account does this EVM address belong to?
 *
 * One address can legitimately sit under several accounts — you sign in with it
 * on one, someone adds it watch-only on another — so "whichever row the database
 * returned first" is not an answer: it makes the wallet show a different profile
 * on different loads, with no code change in between.
 *
 * Accounts that PROVED ownership (watch_only=false) always beat watch-only ones.
 */
async function candidateOwners(evmAddress, env, verifiedOnly) {
  const wRes = await sb(env, `cl_wallets?address=eq.${evmAddress}&chain=eq.evm&select=user_id,watch_only`, { method: 'GET' })
  const rows = wRes.ok ? await wRes.json().catch(() => []) : []
  const verified = rows.filter(r => r.watch_only === false).map(r => r.user_id)
  if (verifiedOnly) return [...new Set(verified)]
  return [...new Set(verified.length ? verified : rows.map(r => r.user_id))]
}

/**
 * Tie-break on cl_users.created_at: the ORIGINAL account wins.
 *
 * Deliberately not cl_wallets.verified_at — every sync rewrites that, so an
 * ordering built on it would flip to a different account the moment you pressed
 * Connect. created_at never changes, so this returns the same answer forever.
 */
async function pickOwner(ids, env) {
  if (ids.length <= 1) return ids[0] ?? null
  const list = ids.map(encodeURIComponent).join(',')
  const uRes = await sb(env, `cl_users?id=in.(${list})&select=id,created_at&order=created_at.asc.nullslast&limit=1`, { method: 'GET' })
  const rows = uRes.ok ? await uRes.json().catch(() => []) : []
  return rows[0]?.id ?? ids[0]
}

async function getProfileByAddress(evmAddress, env) {
  const userId = await pickOwner(await candidateOwners(evmAddress, env, false), env)
  if (!userId) return null
  const uRes = await sb(env, `cl_users?id=eq.${encodeURIComponent(userId)}&select=*,cl_wallets(*),cl_linked_accounts(*)`, { method: 'GET' })
  const users = uRes.ok ? await uRes.json().catch(() => []) : []
  return users[0] ?? null
}

async function syncWallets(addresses, env) {
  const evmLower = String(addresses.evm).toLowerCase()
  const shortAddr = `${evmLower.slice(0, 6)}…${evmLower.slice(-4)}`

  // 1. Identity. Join the account this address ALREADY belongs to, if there is
  //    one, instead of minting a parallel identity for the same person.
  //
  //    Someone who signed in on the ChainLens website with a Solana wallet has a
  //    cl_users row keyed ('solana_wallet', <sol addr>) carrying their Google and
  //    Discord links. Upserting ('evm_wallet', <evm addr>) unconditionally built
  //    a SECOND account for that same human: the wallet showed a profile with no
  //    socials, and the one EVM address then resolved to two different accounts
  //    depending on which row the database returned first.
  //
  //    Only signature-proved links are adopted (watch_only=false). Honouring a
  //    watch-only link would let anyone who adds your address to their profile
  //    absorb your Solana/Cardano/BTC addresses on your next sync.
  let user = null
  const ownerId = await pickOwner(await candidateOwners(evmLower, env, true), env)
  if (ownerId) {
    const eRes = await sb(env, `cl_users?id=eq.${encodeURIComponent(ownerId)}&select=*`, { method: 'GET' })
    user = (eRes.ok ? await eRes.json().catch(() => []) : [])[0] ?? null
  }

  if (!user) {
    const uRes = await sb(env, 'cl_users?on_conflict=provider,provider_id&select=*', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ provider: 'evm_wallet', provider_id: evmLower, display_name: shortAddr, avatar_url: null, email: null }),
    })
    if (!uRes.ok) return { success: false, profile: null, error: `upsert failed ${uRes.status}` }
    user = (await uRes.json().catch(() => []))[0]
    if (!user) return { success: false, profile: null, error: 'upsert failed' }
  }

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
