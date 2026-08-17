/**
 * chainlens-chat.ts — MagicMoney Wallet
 *
 * The wallet's client for the ChainLens Messenger.
 *
 * ChainLens is the ONE canonical chat backend. Nothing here stores a message, a
 * friendship or a read cursor: every call is a thin pass-through to the same
 * `/api/chat/*` routes the ChainLens website uses, against the same Supabase
 * rows. That is what makes a message sent on the desktop wallet show up on the
 * website, and a DM read on the website clear the badge on Android.
 *
 * ── Why this lives in main, not the renderer ──────────────────────────────────
 *
 * Two reasons, and both are load-bearing:
 *
 *   1. The session is a 30-day bearer token for the user's whole ChainLens
 *      account. It never crosses the IPC boundary, so no renderer bug, injected
 *      script or dApp page in the built-in browser can read it. The renderer
 *      gets messages; it never gets credentials.
 *   2. The packaged renderer's CSP is `connect-src 'self' <the Worker>`
 *      (WALLET_CSP in src/main/index.ts). A direct fetch to chainlensnft.info or
 *      api.giphy.com from a React component is blocked outright — main is the
 *      only place these requests CAN be made.
 *
 * ── Why the session is in memory only ─────────────────────────────────────────
 *
 * Persisting it would mean writing a long-lived account credential to disk for
 * no benefit: re-acquiring costs one signature with a key the wallet already
 * holds, with no prompt and no user-visible step. So the token dies with the
 * process, and a locked wallet cannot mint a new one (signing needs the
 * mnemonic). Losing it on restart is the feature.
 */

import { getProfileByAddress } from './supabase-sync'
import { loadAddresses, loadMnemonic, loadConfig } from './secure-store'
import { CHAINLENS_ORIGIN, evmSigner } from './passkey-reconcile-chainlens'
import { chainlensWalletSession, isChainLensSession } from './chainlens-auth'

// ── Wire types (mirror backend-server.js) ─────────────────────────────────────

export interface ChatProfileRef {
  id: string
  display_name: string | null
  avatar_url: string | null
}

export interface ChatMessage {
  id: number
  message_type: 'text' | 'gif'
  content: string
  created_at: string
  author: ChatProfileRef
}

export interface ChatFriend extends ChatProfileRef {
  friendship_id: number
  created_at: string | null
  accepted_at: string | null
}

export interface ChatFriends {
  friends: ChatFriend[]
  incoming: ChatFriend[]
  outgoing: ChatFriend[]
}

/**
 * Eligibility, as the wallet shows it. `giphyApiKey` from the server is
 * deliberately NOT here — the key stays in main and only ever reaches GIPHY, so
 * the renderer learns whether GIF search works, not how to do it itself.
 */
export interface ChatStatus {
  eligible: boolean
  walletLinked: boolean
  socialLinked: boolean
  giphyAvailable: boolean
  /** The account chat is running as — always the id ProfilePage displays. */
  userId: string
  displayName: string | null
  avatarUrl: string | null
}

export interface ChatUnread {
  pending_requests: number
  unread_direct: number
  conversations: Array<{ friendship_id: number; friend_id: string; unread: number }>
}

export interface ChatGif {
  id: string
  title: string
  url: string
  preview: string
}

// ── Session ───────────────────────────────────────────────────────────────────

interface ActiveSession {
  token: string
  /** The ChainLens account this token names. */
  userId: string
  /** Name and picture as ProfilePage shows them, snapshotted at sign-in. */
  profile: ChatProfileRef
  /** The EVM address it was issued for — changing accounts invalidates it. */
  address: string
  /** Local re-auth deadline. The JWT itself lasts 30d; we refresh well inside. */
  refreshAt: number
  giphyApiKey: string | null
}

let active: ActiveSession | null = null

/** Re-auth a day into a 30-day token, so expiry is never the user's problem. */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Drop the session. Called when the wallet locks, when a wallet is deleted, and
 * whenever the active account changes — a token for account A must never be
 * used to speak as account B.
 */
export function clearChatSession(): void {
  active = null
}

/** Thrown with a message the UI shows as-is (see renderer/ipc-error.ts). */
class ChatError extends Error {
  constructor(message: string, readonly status = 0) { super(message) }
}

/**
 * The ChainLens account the wallet is CURRENTLY DISPLAYING.
 *
 * Everything downstream is bound to this id. Resolving it through the same
 * `getProfileByAddress` that ProfilePage renders from is the whole mechanism:
 * chat cannot end up as a different identity than the one the user is being
 * told to hand out, because there is only one lookup.
 */
async function resolveDisplayedProfile(evm: string): Promise<ChatProfileRef> {
  const profile = await getProfileByAddress(evm, await loadConfig())
  if (!profile?.id) {
    throw new ChatError('No ChainLens profile yet. Open Profile and connect to ChainLens first.', 404)
  }
  return { id: profile.id, display_name: profile.display_name, avatar_url: profile.avatar_url }
}

async function authenticate(): Promise<ActiveSession> {
  const addresses = await loadAddresses()
  const evm = addresses?.evm
  if (!evm) throw new ChatError('No wallet address.', 400)

  // Switching account inside the wallet is switching ChainLens user. This check
  // is local and runs on every call, so the swap can never be missed; the
  // network identity lookup below only runs when a token is actually minted.
  if (active && active.address.toLowerCase() !== evm.toLowerCase()) active = null
  if (active && Date.now() < active.refreshAt) return active

  const profile = await resolveDisplayedProfile(evm)
  const signer = await evmSigner(await loadMnemonic(), addresses.accountIndex ?? 0)
  const result = await chainlensWalletSession(fetch, CHAINLENS_ORIGIN, signer, profile.id)
  if (!isChainLensSession(result)) throw new ChatError(result.error, result.mismatch ? 403 : 503)

  active = {
    token: result.token,
    userId: result.userId,
    profile,
    address: evm,
    refreshAt: Date.now() + SESSION_TTL_MS,
    giphyApiKey: null,
  }
  return active
}

/**
 * One authenticated call, with a single silent re-auth on 401.
 *
 * The retry is what makes a rotated JWT secret or a server restart invisible:
 * the token is re-minted from the wallet key without the user seeing anything.
 * Bounded to one attempt so a genuinely rejected identity fails fast instead of
 * signing in a loop.
 */
async function chatFetch<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const session = await authenticate()
  let response: Response
  try {
    response = await fetch(`${CHAINLENS_ORIGIN}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.token}`,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new ChatError('ChainLens is unreachable right now.', 0)
  }

  if (response.status === 401 && retry) {
    clearChatSession()
    return chatFetch<T>(path, init, false)
  }

  const body = await response.json().catch(() => ({})) as Record<string, unknown> & { error?: string }
  if (!response.ok) throw new ChatError(body.error || 'Messenger request failed', response.status)
  return body as T
}

// ── Status ────────────────────────────────────────────────────────────────────

export async function chatStatus(): Promise<ChatStatus> {
  const body = await chatFetch<{
    eligible?: boolean; walletLinked?: boolean; socialLinked?: boolean; giphyApiKey?: string | null
  }>('/api/chat/status')
  // chatFetch guarantees a session; re-read it rather than capture one from
  // before the call, since a 401 retry may have minted a new one.
  const session = active!

  // Held in main for the GIF proxy below; never returned to the renderer.
  session.giphyApiKey = body.giphyApiKey ?? null

  return {
    eligible: !!body.eligible,
    walletLinked: !!body.walletLinked,
    socialLinked: !!body.socialLinked,
    giphyAvailable: !!body.giphyApiKey,
    userId: session.userId,
    displayName: session.profile.display_name,
    avatarUrl: session.profile.avatar_url,
  }
}

// ── World Chat ────────────────────────────────────────────────────────────────

const cursorSuffix = (after?: number | null) =>
  after && after > 0 ? `?after=${encodeURIComponent(after)}` : ''

export async function chatWorld(after?: number | null): Promise<ChatMessage[]> {
  const body = await chatFetch<{ messages?: ChatMessage[] }>(`/api/chat/world${cursorSuffix(after)}`)
  return body.messages || []
}

export async function chatSendWorld(type: 'text' | 'gif', content: string): Promise<ChatMessage> {
  const body = await chatFetch<{ message: ChatMessage }>('/api/chat/world', {
    method: 'POST',
    body: JSON.stringify({ type, content }),
  })
  return body.message
}

export async function chatDeleteWorld(messageId: number): Promise<void> {
  await chatFetch(`/api/chat/world/${encodeURIComponent(messageId)}`, { method: 'DELETE' })
}

// ── Friends ───────────────────────────────────────────────────────────────────

export async function chatFriends(): Promise<ChatFriends> {
  const body = await chatFetch<ChatFriends>('/api/chat/friends')
  return { friends: body.friends || [], incoming: body.incoming || [], outgoing: body.outgoing || [] }
}

export async function chatAddFriend(chainlensId: string): Promise<void> {
  await chatFetch('/api/chat/friends', {
    method: 'POST',
    body: JSON.stringify({ chainlens_id: chainlensId }),
  })
}

export async function chatAcceptFriend(friendshipId: number): Promise<void> {
  await chatFetch(`/api/chat/friends/${encodeURIComponent(friendshipId)}/accept`, { method: 'POST' })
}

/** Decline an incoming request, cancel an outgoing one, or unfriend. */
export async function chatRemoveFriend(friendshipId: number): Promise<void> {
  await chatFetch(`/api/chat/friends/${encodeURIComponent(friendshipId)}`, { method: 'DELETE' })
}

// ── Direct messages ───────────────────────────────────────────────────────────

export async function chatDirect(friendId: string, after?: number | null): Promise<ChatMessage[]> {
  const body = await chatFetch<{ messages?: ChatMessage[] }>(
    `/api/chat/friends/${encodeURIComponent(friendId)}/messages${cursorSuffix(after)}`,
  )
  return body.messages || []
}

export async function chatSendDirect(friendId: string, type: 'text' | 'gif', content: string): Promise<ChatMessage> {
  const body = await chatFetch<{ message: ChatMessage }>(
    `/api/chat/friends/${encodeURIComponent(friendId)}/messages`,
    { method: 'POST', body: JSON.stringify({ type, content }) },
  )
  return body.message
}

export async function chatDeleteDirect(friendId: string, messageId: number): Promise<void> {
  await chatFetch(
    `/api/chat/friends/${encodeURIComponent(friendId)}/messages/${encodeURIComponent(messageId)}`,
    { method: 'DELETE' },
  )
}

// ── Read state ────────────────────────────────────────────────────────────────

export async function chatUnread(): Promise<ChatUnread> {
  const body = await chatFetch<ChatUnread>('/api/chat/unread')
  return {
    pending_requests: body.pending_requests || 0,
    unread_direct: body.unread_direct || 0,
    conversations: body.conversations || [],
  }
}

/** Advance a read cursor. Omit `friendId` for World Chat. */
export async function chatMarkRead(lastReadId: number, friendId?: string | null): Promise<void> {
  await chatFetch('/api/chat/read', {
    method: 'POST',
    body: JSON.stringify({ last_read_id: lastReadId, ...(friendId ? { friend_id: friendId } : {}) }),
  })
}

// ── GIPHY ─────────────────────────────────────────────────────────────────────

/**
 * Search or trend GIPHY with the key ChainLens issued to this session.
 *
 * Proxied rather than handed to the renderer for the same two reasons as
 * everything else here: the renderer's CSP forbids the call, and the key is a
 * credential the wallet was lent — not one to spread around. `/api/chat/status`
 * only returns it to eligible accounts, so an ineligible wallet simply has no
 * GIF search.
 */
export async function chatSearchGifs(query: string): Promise<ChatGif[]> {
  const session = await authenticate()
  if (!session.giphyApiKey) {
    await chatStatus()   // populates the key on first use / after a re-auth
    if (!active?.giphyApiKey) throw new ChatError('GIF search is unavailable right now.', 503)
  }

  const search = query.trim()
  const url = new URL(`https://api.giphy.com/v1/gifs/${search ? 'search' : 'trending'}`)
  url.searchParams.set('api_key', active!.giphyApiKey!)
  url.searchParams.set('limit', '30')
  url.searchParams.set('rating', 'pg-13')
  if (search) {
    url.searchParams.set('q', search.slice(0, 50))
    url.searchParams.set('lang', 'en')
  }

  let response: Response
  try {
    response = await fetch(url.toString(), { signal: AbortSignal.timeout(12_000) })
  } catch {
    throw new ChatError('GIPHY is unreachable right now.', 0)
  }
  const body = await response.json().catch(() => ({})) as {
    data?: Array<{ id?: string; title?: string; images?: Record<string, { url?: string; webp?: string }> }>
  }
  if (!response.ok || !Array.isArray(body.data)) throw new ChatError('GIPHY search is unavailable right now.', 502)

  return body.data.map(gif => ({
    id: String(gif.id ?? ''),
    title: gif.title || 'GIPHY GIF',
    // `content` is validated server-side against *.giphy.com over HTTPS, so the
    // picked URL has to be one GIPHY itself served.
    url: gif.images?.fixed_width?.url || gif.images?.downsized_medium?.url || gif.images?.original?.url || '',
    preview: gif.images?.fixed_width?.webp || gif.images?.fixed_width?.url || gif.images?.original?.url || '',
  })).filter(gif => gif.id && gif.url && gif.preview)
}
