import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatProfileRef, ChatRelationship, ChatReportReason } from '../types/wallet'
import { ipcErrorMessage } from '../ipc-error'
import { BodyPortal } from './BodyPortal'
import './ChatProfileMenu.css'

interface Props {
  person: ChatProfileRef
  own: boolean
  anchor: HTMLButtonElement
  onClose: (restoreFocus?: boolean) => void
  onChanged: (profileId: string, blocked?: boolean) => Promise<void>
}

export function ChatProfileMenu({ person, own, anchor, onClose, onChanged }: Props) {
  const name = person.display_name || 'ChainLens user'
  const [relationship, setRelationship] = useState<ChatRelationship | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState<ChatReportReason>('spam')
  const [details, setDetails] = useState('')
  const [position, setPosition] = useState({ left: 12, top: 12 })
  const menu = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLFormElement>(null)
  const anchorRect = useRef(anchor.getBoundingClientRect())
  const self = own || relationship?.own
  const friendship = relationship?.friendship

  useEffect(() => {
    if (own) return
    let cancelled = false
    window.wallet.chatRelationship(person.id)
      .then(value => { if (!cancelled) setRelationship(value) })
      .catch(err => { if (!cancelled) setError(ipcErrorMessage(err)) })
    return () => { cancelled = true }
  }, [person.id, own])

  // A body portal escapes the feed's scrolling and the themes' transformed
  // cards. Measure the actual menu, then clamp both edges to the viewport.
  useLayoutEffect(() => {
    if (reporting) return
    const place = () => {
      if (!menu.current) return
      if (anchor.isConnected) anchorRect.current = anchor.getBoundingClientRect()
      const rect = anchorRect.current
      const { width, height } = menu.current.getBoundingClientRect()
      const below = rect.bottom + 5
      setPosition({
        left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(below + height <= window.innerHeight - 12 ? below : rect.top - height - 5, window.innerHeight - height - 12)),
      })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, relationship, reporting, error, notice])

  useEffect(() => {
    const root = reporting ? dialog.current : menu.current
    root?.querySelector<HTMLElement>('select, [role="menuitem"]')?.focus()
  }, [reporting])

  useEffect(() => {
    if (reporting && busy) dialog.current?.focus()
  }, [reporting, busy])

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!reporting && !menu.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose(false)
    }
    const scroll = (event: Event) => {
      if (!reporting && !menu.current?.contains(event.target as Node)) onClose(false)
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !(reporting && busy)) { event.preventDefault(); onClose() }
      if (!reporting && menu.current?.contains(document.activeElement)) {
        if (event.key === 'Tab') { onClose(false); return }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const items = [...menu.current.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')]
          const index = items.indexOf(document.activeElement as HTMLElement)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
          items[next]?.focus()
        }
      }
      if (reporting && event.key === 'Tab' && dialog.current) {
        const controls = [...dialog.current.querySelectorAll<HTMLElement>('select:not(:disabled), textarea:not(:disabled), button:not(:disabled)')]
        const first = controls[0], last = controls[controls.length - 1]
        if (!first) { event.preventDefault(); dialog.current.focus(); return }
        if (!dialog.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); return }
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [anchor, reporting, busy, onClose])

  const act = async (action: 'add' | 'accept' | 'remove' | 'block') => {
    if (busy || !relationship) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (action === 'add') await window.wallet.chatAddFriend(person.id)
      if (action === 'accept' && friendship) await window.wallet.chatAcceptFriend(friendship.friendship_id)
      if (action === 'remove' && friendship) await window.wallet.chatRemoveFriend(friendship.friendship_id)
      if (action === 'block') await window.wallet.chatSetBlocked(person.id, !relationship.blocked)
      await onChanged(person.id, action === 'block' ? !relationship.blocked : undefined)
      setNotice(action === 'block' ? (relationship.blocked ? 'User unblocked' : 'User blocked') : action === 'add' ? 'Friend request sent' : 'Friend list updated')
      // Do not guess that a pending request became a friend; re-read the server.
      setRelationship(await window.wallet.chatRelationship(person.id))
    } catch (err) { setError(ipcErrorMessage(err)) }
    finally { setBusy(false) }
  }

  const viewProfile = async () => {
    const url = `https://www.chainlensnft.info/${encodeURIComponent(person.id)}`
    try {
      if (window.wallet.openInAppBrowser) window.wallet.openInAppBrowser(url)
      else await window.wallet.browserNavigate(url)
      onClose()
    } catch (err) { setError(ipcErrorMessage(err)) }
  }

  const submitReport = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      await window.wallet.chatReport(person.id, reason, details)
      setReporting(false); setNotice('Report submitted')
    } catch (err) { setError(ipcErrorMessage(err)) }
    finally { setBusy(false) }
  }

  return <BodyPortal>
    {reporting ? <div className="chat-report-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <form ref={dialog} tabIndex={-1} className="chat-report-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-report-title" onSubmit={submitReport}>
        <h2 id="chat-report-title">Report {name}</h2>
        <label>Reason<select aria-label="Report reason" value={reason} onChange={event => setReason(event.target.value as ChatReportReason)} disabled={busy}>
          <option value="spam">Spam</option><option value="harassment">Harassment</option><option value="impersonation">Impersonation</option><option value="other">Other</option>
        </select></label>
        <label>Details (optional)<textarea aria-label="Report details" maxLength={1000} value={details} onChange={event => setDetails(event.target.value)} disabled={busy} /></label>
        {error && <p role="alert">{error}</p>}
        <footer><button type="button" onClick={() => onClose()} disabled={busy}>Cancel</button><button type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Submit Report'}</button></footer>
      </form>
    </div> : <div ref={menu} className="chat-person-menu" role="menu" aria-label={`${name} options`} style={position}>
      <strong>{name}</strong>
      <a role="menuitem" href={`https://www.chainlensnft.info/${encodeURIComponent(person.id)}`} onClick={event => { event.preventDefault(); void viewProfile() }}>View Profile</a>
      {!self && <>
        {!relationship && !error && <p role="status">Loading options…</p>}
        {relationship && <>
          {relationship.interactionAllowed && (friendship?.status === 'accepted'
            ? <button role="menuitem" disabled={busy} onClick={() => act('remove')}>Remove Friend</button>
            : friendship?.status === 'pending'
              ? friendship.incoming
                ? <><button role="menuitem" disabled={busy} onClick={() => act('accept')}>Accept Request</button><button role="menuitem" disabled={busy} onClick={() => act('remove')}>Decline Request</button></>
                : <button role="menuitem" disabled={busy} onClick={() => act('remove')}>Cancel Request</button>
              : <button role="menuitem" disabled={busy} onClick={() => act('add')}>Add Friend</button>)}
          <button role="menuitem" disabled={busy} onClick={() => act('block')}>{relationship.blocked ? 'Unblock' : 'Block'}</button>
        </>}
        <button role="menuitem" disabled={busy} onClick={() => { setError(''); setReporting(true) }}>Report</button>
      </>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>}
  </BodyPortal>
}
