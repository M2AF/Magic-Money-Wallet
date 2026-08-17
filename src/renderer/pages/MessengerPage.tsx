/**
 * MessengerPage.tsx — ChainLens Messenger, as a wallet page.
 *
 * Its own space rather than a popup (the ChainLens website runs it as a floating
 * panel; here it is a full tab, reached from the header like Profile), but the
 * SAME backend and the same rows: World Chat, friends, DMs, GIFs and deletions
 * are shared with the website and with every other MagicMoney build.
 *
 * Nothing in this file talks to the network. Every call goes through
 * `window.wallet.chat*` into src/main/chainlens-chat.ts, because the packaged
 * renderer's CSP forbids reaching chainlensnft.info or GIPHY directly and the
 * session token is deliberately kept out of the renderer entirely.
 *
 * ── Scroll behaviour ──────────────────────────────────────────────────────────
 * Three rules, and they interact: a conversation opens at the bottom; new
 * messages arriving while the user is reading history must NOT drag them down;
 * and a conversation is only marked read while the user is actually at the
 * bottom looking at the newest message. `stickToBottom` is the single piece of
 * state all three read from.
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { ChatFriend, ChatFriends, ChatGif, ChatMessage, ChatStatus, ChatUnread } from '../types/wallet'
import { ipcErrorMessage } from '../ipc-error'

interface Props {
  /** Jump to the Profile tab — the fix for every "not connected" state here. */
  onProfile: () => void
  unread: ChatUnread | null
  /** Re-poll the header badge now, rather than waiting for the next tick. */
  onUnreadRefresh: () => void
}

// Poll cadences, matched to the ChainLens website so the two feel identical.
const POLL_MESSAGES_MS = 3_000
// A full re-read, which is how a deletion made on another client disappears
// here: incremental polling only ever ADDS ids greater than the cursor.
const RECONCILE_MS = 15_000
const POLL_FRIENDS_MS = 6_000

const MAX_MESSAGE_LENGTH = 500
const CHAINLENS_ID_LENGTH = 36

// ─── Text helpers ─────────────────────────────────────────────────────────────

/** Merge by id and re-sort: polls overlap, and a message must never double up. */
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map(m => [String(m.id), m]))
  for (const message of incoming) byId.set(String(message.id), message)
  return [...byId.values()].sort((a, b) => Number(a.id) - Number(b.id))
}

function formatTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Byte-identical to CHAT_LINK_RE in chainlens/chat-service.js. The server is the
// authority — this copy exists so World Chat can refuse a link before spending a
// round trip on it, not to make a different decision.
const LINK_SOURCE =
  '(?:\\b[a-z][a-z0-9+.-]*:\\/\\/[^\\s<]+|\\bmailto:[^\\s<]+|\\bwww\\.[^\\s<]+' +
  '|\\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}(?:[/?#][^\\s<]*)?)'

const containsLink = (value: string) => new RegExp(LINK_SOURCE, 'i').test(value)

/** Open a link in the wallet's OWN browser — never the system one. */
function openLink(url: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tabs = (globalThis as any).chrome?.tabs
  if (tabs) { tabs.create({ url }); return }
  if (window.wallet.openBrowserInNewTab) { window.wallet.openBrowserInNewTab(url); return }
  window.wallet.openBrowser()
  setTimeout(() => window.wallet.browserNavigate(url), 400)
}

/**
 * Render message text, linkifying only where links are allowed (DMs).
 *
 * Non-http(s) schemes are left as plain text on purpose: a `file:` or custom
 * protocol URL from another user is not something to hand a click target for.
 */
function renderText(content: string, allowLinks: boolean) {
  if (!allowLinks) return content
  const parts = content.split(new RegExp(`(${LINK_SOURCE})`, 'gi'))
  return parts.map((part, index) => {
    if (!new RegExp(`^(?:${LINK_SOURCE})$`, 'i').test(part)) return part
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(part) && !/^https?:\/\//i.test(part)) return part
    const href = /^(?:https?:\/\/|mailto:)/i.test(part) ? part : `https://${part}`
    return (
      <a
        key={`${part}-${index}`}
        href={href}
        onClick={e => { e.preventDefault(); openLink(href) }}
        style={{ color: 'inherit', fontWeight: 700, textDecoration: 'underline', textUnderlineOffset: 2 }}
      >{part}</a>
    )
  })
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

const AVATAR_PALETTE = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#06b6d4', '#10b981']

function Avatar({ profile, size = 32 }: { profile: { id?: string; display_name?: string | null; avatar_url?: string | null } | null; size?: number }) {
  const name = profile?.display_name || 'ChainLens user'
  if (profile?.avatar_url) {
    return (
      <img
        src={profile.avatar_url} alt="" referrerPolicy="no-referrer"
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, display: 'block' }}
      />
    )
  }
  const seed = String(profile?.id || name)
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  const colour = AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length]
  const initials = name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'CL'
  return (
    <span style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `linear-gradient(135deg, ${colour} 0%, ${colour}99 100%)`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 800, fontSize: Math.max(9, Math.round(size * 0.34)),
    }}>{initials}</span>
  )
}

// ─── One message ──────────────────────────────────────────────────────────────

function MessageRow({ message, own, allowLinks, deleting, onDelete, onMediaLoad }: {
  message: ChatMessage
  own: boolean
  allowLinks: boolean
  deleting: boolean
  onDelete: (message: ChatMessage) => void
  onMediaLoad: () => void
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexDirection: own ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
      <Avatar profile={message.author} size={28} />
      <div style={{ minWidth: 0, maxWidth: '78%', display: 'flex', flexDirection: 'column', alignItems: own ? 'flex-end' : 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3, flexDirection: own ? 'row-reverse' : 'row' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }}>
            {message.author?.display_name || 'ChainLens user'}
          </span>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0, fontFamily: 'var(--font-mono)' }}>
            {formatTime(message.created_at)}
          </span>
          {/* Only ever rendered for your own messages; the server enforces the
              same rule, so a forged click cannot delete someone else's. */}
          {own && (
            <button
              type="button" onClick={() => onDelete(message)} disabled={deleting}
              title="Delete message" aria-label="Delete message"
              style={{
                background: 'none', border: 'none', padding: 0, cursor: deleting ? 'default' : 'pointer',
                color: 'var(--text-muted)', opacity: deleting ? 0.4 : 1, display: 'flex', flexShrink: 0,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/>
              </svg>
            </button>
          )}
        </div>

        {message.message_type === 'gif' ? (
          <div style={{
            overflow: 'hidden', borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)', background: 'var(--bg-dark)',
            // Squared-off corner on the side the avatar sits — the classic
            // "this bubble belongs to that person" cue.
            borderTopRightRadius: own ? 4 : undefined,
            borderTopLeftRadius: own ? undefined : 4,
          }}>
            <img
              src={message.content} alt={`GIF from ${message.author?.display_name || 'ChainLens user'}`}
              loading="lazy" onLoad={onMediaLoad}
              style={{ display: 'block', maxHeight: 190, width: '100%', objectFit: 'contain' }}
            />
          </div>
        ) : (
          <div style={{
            display: 'inline-block', padding: '7px 11px',
            borderRadius: 'var(--radius-md)',
            borderTopRightRadius: own ? 4 : undefined,
            borderTopLeftRadius: own ? undefined : 4,
            background: own ? 'var(--accent)' : 'var(--bg-surface)',
            color: own ? 'var(--on-accent)' : 'var(--text-primary)',
            border: own ? 'none' : '1px solid var(--border)',
            fontSize: 12.5, lineHeight: 1.5, textAlign: 'left',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {renderText(message.content, allowLinks)}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function MessengerPage({ onProfile, unread, onUnreadRefresh }: Props) {
  const [tab, setTab] = useState<'world' | 'friends'>('world')
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [messagesLoading, setMessagesLoading] = useState(false)
  const [friends, setFriends] = useState<ChatFriends>({ friends: [], incoming: [], outgoing: [] })
  const [friendsLoading, setFriendsLoading] = useState(false)
  const [selectedFriend, setSelectedFriend] = useState<ChatFriend | null>(null)
  const [directMessages, setDirectMessages] = useState<ChatMessage[]>([])
  const [directLoading, setDirectLoading] = useState(false)

  const [friendIdInput, setFriendIdInput] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [busyFriendship, setBusyFriendship] = useState<number | 'new' | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const [showGifs, setShowGifs] = useState(false)
  const [gifQuery, setGifQuery] = useState('')
  const [gifs, setGifs] = useState<ChatGif[]>([])
  const [gifsLoading, setGifsLoading] = useState(false)
  const [showScrollDown, setShowScrollDown] = useState(false)

  const worldCursor = useRef(0)
  const directCursor = useRef(0)
  const feedRef = useRef<HTMLDivElement | null>(null)
  const stickToBottom = useRef(true)
  const scrollingDown = useRef(false)
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Highest id already reported read, per conversation — stops the mark-read
  // POST firing again on every 3s poll when nothing has actually changed.
  const marked = useRef<Record<string, number>>({})

  const eligible = !!status?.eligible
  const inConversation = eligible && (tab === 'world' || !!selectedFriend)
  const currentMessages = selectedFriend ? directMessages : messages
  const currentLoading = selectedFriend ? directLoading : messagesLoading

  const unreadByFriend = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of unread?.conversations ?? []) map.set(row.friend_id, row.unread)
    return map
  }, [unread])

  const flashNotice = (value: string) => {
    setNotice(value)
    setTimeout(() => setNotice(''), 2500)
  }

  // ── Scrolling ───────────────────────────────────────────────────────────────

  const nearBottom = useCallback(() => {
    const feed = feedRef.current
    if (!feed) return true
    return feed.scrollHeight - feed.scrollTop - feed.clientHeight <= 56
  }, [])

  const syncScrollState = useCallback(() => {
    const atBottom = nearBottom()
    // An in-flight smooth scroll passes through "not at bottom"; treating that
    // as the user scrolling away would cancel the very scroll we asked for.
    if (scrollingDown.current && !atBottom) return
    if (atBottom) scrollingDown.current = false
    stickToBottom.current = atBottom
    setShowScrollDown(!atBottom)
  }, [nearBottom])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const feed = feedRef.current
    if (!feed) return
    scrollingDown.current = true
    stickToBottom.current = true
    setShowScrollDown(false)
    const apply = () => {
      const current = feedRef.current
      if (current) current.scrollTo({ top: current.scrollHeight, behavior })
    }
    requestAnimationFrame(() => {
      apply()
      // A second frame catches rows whose height settles after first paint.
      if (behavior === 'auto') requestAnimationFrame(apply)
    })
    if (settleTimer.current) clearTimeout(settleTimer.current)
    settleTimer.current = setTimeout(() => {
      scrollingDown.current = false
      const atBottom = nearBottom()
      stickToBottom.current = atBottom
      setShowScrollDown(!atBottom)
    }, behavior === 'smooth' ? 500 : 80)
  }, [nearBottom])

  const handleMediaLoad = useCallback(() => {
    if (stickToBottom.current) scrollToBottom('auto')
    else syncScrollState()
  }, [scrollToBottom, syncScrollState])

  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current) }, [])

  // ── Loading ─────────────────────────────────────────────────────────────────

  const advanceCursor = (ref: { current: number }, rows: ChatMessage[]) => {
    for (const row of rows) ref.current = Math.max(ref.current, Number(row.id) || 0)
  }

  const loadWorld = useCallback(async (incremental: boolean, quiet = false) => {
    if (!incremental && !quiet) setMessagesLoading(true)
    try {
      const rows = await window.wallet.chatWorld(incremental ? worldCursor.current : null)
      advanceCursor(worldCursor, rows)
      setMessages(current => (incremental ? mergeMessages(current, rows) : rows))
      setError('')
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      if (!incremental && !quiet) setMessagesLoading(false)
    }
  }, [])

  const loadFriends = useCallback(async (quiet = false) => {
    if (!quiet) setFriendsLoading(true)
    try {
      const body = await window.wallet.chatFriends()
      setFriends(body)
      // An unfriend from the other side has to close the open thread, not leave
      // it sending into a friendship that no longer exists.
      setSelectedFriend(current => (current ? body.friends.find(f => f.id === current.id) ?? null : null))
      setError('')
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      if (!quiet) setFriendsLoading(false)
    }
  }, [])

  const loadDirect = useCallback(async (friend: ChatFriend, incremental: boolean, quiet = false) => {
    if (!incremental && !quiet) setDirectLoading(true)
    try {
      const rows = await window.wallet.chatDirect(friend.id, incremental ? directCursor.current : null)
      advanceCursor(directCursor, rows)
      setDirectMessages(current => (incremental ? mergeMessages(current, rows) : rows))
      setError('')
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      if (!incremental && !quiet) setDirectLoading(false)
    }
  }, [])

  // Sign in and check eligibility once on entry.
  useEffect(() => {
    let cancelled = false
    setStatusLoading(true)
    window.wallet.chatStatus()
      .then(body => {
        if (cancelled) return
        setStatus(body)
        setError('')
        // Opening the tab is the strongest signal that chat is reachable, so
        // re-arm the badge here: it may have backed off while the profile was
        // still connecting, and the friends list needs the counts immediately.
        if (body.eligible) onUnreadRefresh()
      })
      .catch(e => { if (!cancelled) setError(ipcErrorMessage(e)) })
      .finally(() => { if (!cancelled) setStatusLoading(false) })
    return () => { cancelled = true }
    // Deliberately once per mount — onUnreadRefresh is a stable App callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!eligible || tab !== 'world' || selectedFriend) return
    loadWorld(false)
    const poll = setInterval(() => loadWorld(true), POLL_MESSAGES_MS)
    const reconcile = setInterval(() => loadWorld(false, true), RECONCILE_MS)
    return () => { clearInterval(poll); clearInterval(reconcile) }
  }, [eligible, tab, selectedFriend, loadWorld])

  useEffect(() => {
    if (!eligible || tab !== 'friends') return
    loadFriends(false)
    const poll = setInterval(() => loadFriends(true), POLL_FRIENDS_MS)
    return () => clearInterval(poll)
  }, [eligible, tab, loadFriends])

  useEffect(() => {
    if (!eligible || !selectedFriend) return
    directCursor.current = 0
    setDirectMessages([])
    loadDirect(selectedFriend, false)
    const poll = setInterval(() => loadDirect(selectedFriend, true), POLL_MESSAGES_MS)
    const reconcile = setInterval(() => loadDirect(selectedFriend, false, true), RECONCILE_MS)
    return () => { clearInterval(poll); clearInterval(reconcile) }
  }, [eligible, selectedFriend, loadDirect])

  // Opening a conversation puts you at the newest message.
  useEffect(() => {
    stickToBottom.current = true
    scrollingDown.current = false
    setShowScrollDown(false)
    scrollToBottom('auto')
  }, [tab, selectedFriend?.id, scrollToBottom])

  // ── Read cursors ────────────────────────────────────────────────────────────

  /**
   * Report the newest visible message as read — but only while the user is
   * genuinely at the bottom of an open conversation. Scrolled up, they have not
   * seen it, and marking it read would clear a badge on their phone for a
   * message they never looked at.
   */
  const markRead = useCallback(() => {
    if (!inConversation) return
    if (!stickToBottom.current) return
    const list = selectedFriend ? directMessages : messages
    const newest = list.length ? Number(list[list.length - 1].id) : 0
    if (!newest) return

    const key = selectedFriend ? selectedFriend.id : 'world'
    if ((marked.current[key] ?? 0) >= newest) return
    marked.current[key] = newest

    window.wallet.chatMarkRead(newest, selectedFriend?.id ?? null)
      // World Chat is excluded from the header badge, so only a DM needs to
      // refresh it — and refreshing on world traffic would be constant churn.
      .then(() => { if (selectedFriend) onUnreadRefresh() })
      // Let the next tick try again rather than losing the cursor entirely.
      .catch(() => { marked.current[key] = 0 })
  }, [inConversation, selectedFriend, directMessages, messages, onUnreadRefresh])

  // New messages: follow them only if the user was already at the bottom.
  useEffect(() => {
    if (!feedRef.current) return
    if (currentLoading) return
    if (stickToBottom.current) scrollToBottom('auto')
    else syncScrollState()
    markRead()
  }, [messages.length, directMessages.length, currentLoading, scrollToBottom, syncScrollState, markRead])

  // ── Actions ─────────────────────────────────────────────────────────────────

  const sendMessage = async (type: 'text' | 'gif', content: string) => {
    if (sending || !content.trim()) return
    // Checked here as well as on the server so the composer can say why without
    // a round trip. The server remains the authority.
    if (!selectedFriend && type === 'text' && containsLink(content)) {
      setError('Links can only be sent in direct messages.')
      return
    }
    setSending(true)
    setError('')
    try {
      const message = selectedFriend
        ? await window.wallet.chatSendDirect(selectedFriend.id, type, content)
        : await window.wallet.chatSendWorld(type, content)
      stickToBottom.current = true
      setShowScrollDown(false)
      if (selectedFriend) {
        advanceCursor(directCursor, [message])
        setDirectMessages(current => mergeMessages(current, [message]))
      } else {
        advanceCursor(worldCursor, [message])
        setMessages(current => mergeMessages(current, [message]))
      }
      setDraft('')
      setShowGifs(false)
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setSending(false)
    }
  }

  const deleteMessage = async (message: ChatMessage) => {
    if (deletingId !== null) return
    if (!window.confirm('Delete this message? This cannot be undone.')) return
    const id = String(message.id)
    setDeletingId(id)
    setError('')
    try {
      if (selectedFriend) await window.wallet.chatDeleteDirect(selectedFriend.id, message.id)
      else await window.wallet.chatDeleteWorld(message.id)
      if (selectedFriend) setDirectMessages(current => current.filter(m => String(m.id) !== id))
      else setMessages(current => current.filter(m => String(m.id) !== id))
      flashNotice('Message deleted')
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setDeletingId(null)
    }
  }

  const addFriend = async (event: React.FormEvent) => {
    event.preventDefault()
    const id = friendIdInput.trim()
    if (!id) return
    setBusyFriendship('new')
    setError('')
    try {
      await window.wallet.chatAddFriend(id)
      setFriendIdInput('')
      flashNotice('Friend request sent')
      await loadFriends(true)
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setBusyFriendship(null)
    }
  }

  const changeFriendship = async (friend: ChatFriend, action: 'accept' | 'remove') => {
    setBusyFriendship(friend.friendship_id)
    setError('')
    try {
      if (action === 'accept') await window.wallet.chatAcceptFriend(friend.friendship_id)
      else await window.wallet.chatRemoveFriend(friend.friendship_id)
      flashNotice(action === 'accept' ? `${friend.display_name ?? 'Friend'} is now your friend` : 'Friend list updated')
      if (action === 'remove' && selectedFriend?.id === friend.id) setSelectedFriend(null)
      await loadFriends(true)
      // Accepting or declining changes the pending count the badge shows.
      onUnreadRefresh()
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setBusyFriendship(null)
    }
  }

  const loadGifs = async (query: string) => {
    setGifsLoading(true)
    setError('')
    try {
      setGifs(await window.wallet.chatGifs(query))
    } catch (e) {
      setError(ipcErrorMessage(e))
    } finally {
      setGifsLoading(false)
    }
  }

  const toggleGifs = () => {
    const next = !showGifs
    setShowGifs(next)
    if (next && gifs.length === 0) loadGifs('')
  }

  const copyId = () => {
    navigator.clipboard.writeText(status?.userId ?? '').catch(() => {})
    flashNotice('ChainLens ID copied')
  }

  // ── Chrome ──────────────────────────────────────────────────────────────────

  const openConversation = (friend: ChatFriend | null) => {
    setSelectedFriend(friend)
    setShowGifs(false)
    setDraft('')
    setError('')
  }

  const surface: React.CSSProperties = {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
  }

  const header = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px', flexShrink: 0 }}>
      <span style={{
        width: 34, height: 34, borderRadius: 'var(--radius-sm)', flexShrink: 0,
        background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)',
        boxShadow: '0 0 14px var(--accent-glow)',
      }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 5.5h16v11H8.5L4 20V5.5Z"/><path d="M8 10h8M8 13h5"/>
        </svg>
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          ChainLens
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17, letterSpacing: '-0.01em' }}>
          Messenger
        </div>
      </div>
      {status && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
          <div style={{ textAlign: 'right', minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 120 }}>
              {status.displayName ?? 'You'}
            </div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {status.userId.slice(0, 8)}…
            </div>
          </div>
          <Avatar profile={{ id: status.userId, display_name: status.displayName, avatar_url: status.avatarUrl }} size={30} />
        </div>
      )}
    </div>
  )

  const tabs = (
    <div style={{ display: 'flex', gap: 4, padding: '0 16px', flexShrink: 0 }}>
      {([
        ['world', 'World Chat', 0],
        ['friends', 'Friends', (unread?.pending_requests ?? 0) + (unread?.unread_direct ?? 0)],
      ] as const).map(([value, label, badge]) => (
        <button
          key={value} type="button"
          onClick={() => { setTab(value); openConversation(null) }}
          style={{
            flex: 1, padding: '9px 0', background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 800,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            color: tab === value ? 'var(--accent)' : 'var(--text-muted)',
            borderBottom: `2px solid ${tab === value ? 'var(--accent)' : 'transparent'}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          {label}
          {badge > 0 && (
            <span style={{
              minWidth: 15, height: 15, padding: '0 4px', borderRadius: 8,
              background: 'var(--accent)', color: 'var(--on-accent)',
              fontSize: 9, fontWeight: 800, lineHeight: '15px',
            }}>{badge > 99 ? '99+' : badge}</span>
          )}
        </button>
      ))}
    </div>
  )

  // ── Gate states ─────────────────────────────────────────────────────────────

  if (statusLoading && !status) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {header}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          Signing in to ChainLens…
        </div>
      </div>
    )
  }

  if (!status) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {header}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '24px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 34 }}>💬</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>Messenger needs your profile</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.6, maxWidth: 300 }}>
            {error || 'Connect this wallet to ChainLens first. Messenger uses the ChainLens name, picture and ID your Profile shows.'}
          </div>
          <button type="button" onClick={onProfile} style={{
            marginTop: 4, padding: '11px 26px', borderRadius: 'var(--radius-md)', border: 'none',
            background: 'var(--accent)', color: 'var(--btn-primary-text)',
            fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
          }}>Open Profile</button>
        </div>
      </div>
    )
  }

  if (!eligible) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {header}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '24px 28px', textAlign: 'center' }}>
          <div style={{ fontSize: 34 }}>🔐</div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 17 }}>Unlock Messenger</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12.5, lineHeight: 1.6, maxWidth: 300 }}>
            Chat needs one verified wallet and either Google or Discord on the same ChainLens account.
          </div>
          <div style={{ ...surface, width: '100%', maxWidth: 320, overflow: 'hidden', textAlign: 'left' }}>
            {([
              ['Verified wallet', status.walletLinked],
              ['Google or Discord', status.socialLinked],
            ] as const).map(([label, done], index) => (
              <div key={label} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '11px 14px', fontSize: 12.5,
                borderTop: index === 0 ? 'none' : '1px solid var(--border)',
              }}>
                <span>{label}</span>
                <strong style={{ color: done ? 'var(--success)' : 'var(--warning)', fontSize: 11.5 }}>
                  {done ? 'Linked ✓' : 'Required'}
                </strong>
              </div>
            ))}
          </div>
          <button type="button" onClick={onProfile} style={{
            marginTop: 4, padding: '11px 26px', borderRadius: 'var(--radius-md)', border: 'none',
            background: 'var(--accent)', color: 'var(--btn-primary-text)',
            fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: 13, cursor: 'pointer',
          }}>Manage Profile</button>
        </div>
      </div>
    )
  }

  // ── Friends list ────────────────────────────────────────────────────────────

  const friendsList = (
    <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ ...surface, padding: 12 }}>
        <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>
          Your ChainLens ID
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)', fontSize: 10.5, wordBreak: 'break-all', color: 'var(--text-secondary)' }}>
            {status.userId}
          </span>
          <button type="button" onClick={copyId} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)',
            fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0,
          }}>Copy</button>
        </div>
      </div>

      <form onSubmit={addFriend} style={{ display: 'flex', gap: 8 }}>
        <input
          value={friendIdInput}
          onChange={e => setFriendIdInput(e.target.value)}
          placeholder="Friend's ChainLens ID"
          aria-label="Friend's ChainLens ID"
          maxLength={CHAINLENS_ID_LENGTH}
          style={{
            flex: 1, minWidth: 0, background: 'var(--input-bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '9px 11px', color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)', fontSize: 11, outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={busyFriendship === 'new' || friendIdInput.trim().length !== CHAINLENS_ID_LENGTH}
          style={{
            padding: '0 16px', borderRadius: 'var(--radius-sm)', border: 'none',
            background: 'var(--accent)', color: 'var(--btn-primary-text)',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 800,
            letterSpacing: '0.1em', textTransform: 'uppercase',
            cursor: 'pointer', opacity: friendIdInput.trim().length === CHAINLENS_ID_LENGTH ? 1 : 0.4,
          }}
        >Add</button>
      </form>

      {friendsLoading && friends.friends.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5, padding: '28px 0' }}>Loading friends…</div>
      ) : (
        <>
          {friends.incoming.length > 0 && (
            <section>
              <SectionLabel>Friend requests</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {friends.incoming.map(request => (
                  <div key={request.friendship_id} style={{ ...surface, display: 'flex', alignItems: 'center', gap: 10, padding: 10 }}>
                    <Avatar profile={request} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{request.display_name}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{request.id}</div>
                    </div>
                    <button
                      type="button" onClick={() => changeFriendship(request, 'accept')}
                      disabled={busyFriendship === request.friendship_id}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--success)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                    >Accept</button>
                    <button
                      type="button" onClick={() => changeFriendship(request, 'remove')}
                      disabled={busyFriendship === request.friendship_id}
                      aria-label={`Decline friend request from ${request.display_name ?? 'this user'}`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15, lineHeight: 1 }}
                    >×</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <SectionLabel>Friends · {friends.friends.length}</SectionLabel>
            {friends.friends.length === 0 ? (
              <div style={{
                border: '1px dashed var(--border)', borderRadius: 'var(--radius-md)',
                padding: '26px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5,
              }}>Add a friend by their ChainLens ID.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {friends.friends.map(friend => {
                  const count = unreadByFriend.get(friend.id) ?? 0
                  return (
                    <button
                      key={friend.id} type="button" onClick={() => openConversation(friend)}
                      aria-label={count > 0
                        ? `${friend.display_name ?? 'Friend'}, ${count} unread message${count === 1 ? '' : 's'}`
                        : String(friend.display_name ?? 'Friend')}
                      style={{
                        ...surface, display: 'flex', alignItems: 'center', gap: 10, padding: 10,
                        textAlign: 'left', cursor: 'pointer', color: 'var(--text-primary)',
                        fontFamily: 'var(--font-body)',
                      }}
                    >
                      <Avatar profile={friend} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{friend.display_name}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{friend.id}</div>
                      </div>
                      {count > 0 && (
                        <span aria-hidden="true" style={{
                          minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                          background: 'var(--accent)', color: 'var(--on-accent)',
                          fontSize: 10, fontWeight: 800, lineHeight: '18px', textAlign: 'center', flexShrink: 0,
                        }}>{count > 99 ? '99+' : count}</span>
                      )}
                      <span style={{ color: 'var(--accent)', flexShrink: 0 }}>›</span>
                    </button>
                  )
                })}
              </div>
            )}
          </section>

          {friends.outgoing.length > 0 && (
            <section>
              <SectionLabel>Sent requests</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {friends.outgoing.map(request => (
                  <div key={request.friendship_id} style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px',
                    background: 'var(--hover-faint)', borderRadius: 'var(--radius-sm)', fontSize: 12,
                  }}>
                    <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{request.display_name}</span>
                    <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>Pending</span>
                    <button
                      type="button" onClick={() => changeFriendship(request, 'remove')}
                      disabled={busyFriendship === request.friendship_id}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 10, fontWeight: 800, textTransform: 'uppercase' }}
                    >Cancel</button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )

  // ── Conversation ────────────────────────────────────────────────────────────

  const conversation = (
    <>
      {selectedFriend && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
          borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)',
          background: 'var(--hover-faint)', flexShrink: 0,
        }}>
          <button
            type="button" onClick={() => openConversation(null)} aria-label="Back to friends"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', fontSize: 18, lineHeight: 1, padding: '0 4px' }}
          >‹</button>
          <Avatar profile={selectedFriend} size={28} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedFriend.display_name}</div>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selectedFriend.id}</div>
          </div>
          <button
            type="button" onClick={() => changeFriendship(selectedFriend, 'remove')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}
          >Unfriend</button>
        </div>
      )}

      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        <div
          ref={feedRef} onScroll={syncScrollState}
          style={{ height: '100%', overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          {currentLoading && currentMessages.length === 0 ? (
            <div style={{ margin: 'auto', color: 'var(--text-muted)', fontSize: 12.5 }}>Loading messages…</div>
          ) : currentMessages.length === 0 ? (
            <div style={{ margin: 'auto', textAlign: 'center', color: 'var(--text-muted)', padding: '0 28px' }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>👋</div>
              <div style={{ fontSize: 12.5 }}>
                {selectedFriend ? `Start a conversation with ${selectedFriend.display_name}.` : 'World Chat is quiet. Say hello!'}
              </div>
            </div>
          ) : currentMessages.map(message => (
            <MessageRow
              key={message.id}
              message={message}
              own={message.author?.id === status.userId}
              allowLinks={!!selectedFriend}
              deleting={deletingId === String(message.id)}
              onDelete={deleteMessage}
              onMediaLoad={handleMediaLoad}
            />
          ))}
        </div>

        {showScrollDown && (
          <button
            type="button" onClick={() => scrollToBottom('smooth')}
            style={{
              position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px',
              borderRadius: 999, border: '1px solid var(--border-active)',
              background: 'var(--bg-surface)', color: 'var(--accent)',
              fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 800,
              letterSpacing: '0.08em', textTransform: 'uppercase', cursor: 'pointer',
              boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6"/>
            </svg>
            Scroll to bottom
          </button>
        )}
      </div>

      {showGifs && (
        <div style={{ height: 236, flexShrink: 0, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--border)', background: 'var(--bg-dark)' }}>
          <form
            onSubmit={e => { e.preventDefault(); loadGifs(gifQuery) }}
            style={{ display: 'flex', gap: 8, padding: 10 }}
          >
            <input
              value={gifQuery} onChange={e => setGifQuery(e.target.value)}
              placeholder="Search GIPHY" aria-label="Search GIPHY" maxLength={50}
              style={{
                flex: 1, minWidth: 0, background: 'var(--input-bg)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', padding: '8px 11px', color: 'var(--text-primary)',
                fontFamily: 'var(--font-body)', fontSize: 12, outline: 'none',
              }}
            />
            <button type="submit" style={{
              padding: '0 14px', borderRadius: 'var(--radius-sm)', border: 'none',
              background: 'var(--accent)', color: 'var(--btn-primary-text)',
              fontSize: 10.5, fontWeight: 800, textTransform: 'uppercase', cursor: 'pointer',
              fontFamily: 'var(--font-body)',
            }}>Search</button>
          </form>
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 10px 8px' }}>
            {gifsLoading ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Finding GIFs…</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {gifs.map(gif => (
                  <button
                    key={gif.id} type="button" title={gif.title}
                    onClick={() => sendMessage('gif', gif.url)} disabled={sending}
                    style={{
                      aspectRatio: '1', borderRadius: 'var(--radius-sm)', overflow: 'hidden',
                      border: '1px solid var(--border)', background: 'var(--bg-surface)',
                      padding: 0, cursor: 'pointer',
                    }}
                  >
                    <img src={gif.preview} alt={gif.title} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div style={{
            display: 'flex', justifyContent: 'space-between', padding: '4px 12px 6px',
            fontSize: 8.5, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)',
          }}>
            <span>{gifs.length ? `${gifs.length} GIFs` : ''}</span>
            <span>Powered by GIPHY</span>
          </div>
        </div>
      )}

      <form
        onSubmit={e => { e.preventDefault(); sendMessage('text', draft) }}
        style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: 12, borderTop: '1px solid var(--border)', flexShrink: 0 }}
      >
        {status.giphyAvailable && (
          <button
            type="button" onClick={toggleGifs} aria-label="Open GIPHY picker"
            style={{
              height: 38, padding: '0 11px', borderRadius: 'var(--radius-sm)', flexShrink: 0,
              border: `1px solid ${showGifs ? 'var(--accent)' : 'var(--border)'}`,
              background: showGifs ? 'var(--accent)' : 'transparent',
              color: showGifs ? 'var(--btn-primary-text)' : 'var(--accent)',
              fontFamily: 'var(--font-body)', fontSize: 10.5, fontWeight: 800, cursor: 'pointer',
            }}
          >GIF</button>
        )}
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          maxLength={MAX_MESSAGE_LENGTH}
          rows={1}
          placeholder={selectedFriend ? `Message ${selectedFriend.display_name}` : 'Message World Chat · no links'}
          aria-label={selectedFriend ? `Message ${selectedFriend.display_name}` : 'Message World Chat'}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage('text', draft) } }}
          style={{
            flex: 1, minWidth: 0, minHeight: 38, maxHeight: 96, resize: 'none',
            background: 'var(--input-bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)', padding: '10px 12px',
            color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 12.5,
            lineHeight: 1.4, outline: 'none',
          }}
        />
        <button
          type="submit" disabled={sending || !draft.trim()} aria-label="Send message"
          style={{
            width: 38, height: 38, borderRadius: 'var(--radius-sm)', border: 'none', flexShrink: 0,
            background: 'var(--accent)', color: 'var(--btn-primary-text)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: sending || !draft.trim() ? 'default' : 'pointer',
            opacity: sending || !draft.trim() ? 0.4 : 1,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 3 18 9-18 9 3-9-3-9Z"/><path d="M6 12h15"/>
          </svg>
        </button>
      </form>
    </>
  )

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {header}
      {tabs}
      {tab === 'friends' && !selectedFriend ? friendsList : conversation}

      {(error || notice) && (
        <div
          aria-live="polite"
          style={{
            flexShrink: 0, padding: '8px 16px', fontSize: 11.5, fontWeight: 600,
            borderTop: '1px solid var(--border)',
            background: error ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
            color: error ? 'var(--error)' : 'var(--success)',
          }}
        >{error || notice}</div>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9.5, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase',
      color: 'var(--text-muted)', marginBottom: 7,
    }}>{children}</div>
  )
}
