import { useEffect, useRef, useState } from 'react'
import type { AgentProposal, AgentSnapshot } from '../../shared/agent-access'
import type { WalletAddresses } from '../types/wallet'
import { BodyPortal } from './BodyPortal'
import { SendModal } from './SendModal'
import { DexSwapWidget } from './DexSwapWidget'
import { AgentExecutionPanel } from './AgentExecutionPanel'
import './AgentAccessPanel.css'

type Review = { proposal: AgentProposal; context: string; balance: string | null }

/** Desktop-only: optional bridge keeps extension and native targets unchanged. */
export function AgentAccessPanel({ addresses }: { addresses: WalletAddresses }) {
  const bridge = window.wallet.agentAccess
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<AgentSnapshot | null>(null)
  const [name, setName] = useState('My assistant')
  const [proposals, setProposals] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [exported, setExported] = useState<{ command?: string; configPath?: string } | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [executing, setExecuting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const requestVersion = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requestVersion.current++ } }, [])

  useEffect(() => {
    if (!bridge) return
    let active = true
    let pending = false
    const refresh = async () => {
      if (pending) return
      pending = true
      const version = ++requestVersion.current
      try {
        const next = await bridge.snapshot()
        if (!active || version !== requestVersion.current) return
        setSnapshot(next)
        setReview(current => current && (current.context !== next.context || !next.enabled
          || !next.grants.some(g => g.id === current.proposal.clientId && g.expiresAt > Date.now())) ? null : current)
      } catch {
        if (active && version === requestVersion.current) { setSnapshot(null); setReview(null) }
      } finally { pending = false }
    }
    refresh()
    const timer = setInterval(refresh, open ? 2000 : 5000)
    return () => { active = false; clearInterval(timer) }
  }, [bridge, open, addresses.accountIndex, addresses.evm])

  useEffect(() => {
    if (!open || review?.proposal.draft.kind === 'transfer') return
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy && !review) { event.preventDefault(); setOpen(false) }
      if (event.key !== 'Tab') return
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, [tabindex="0"]')
      const items = nodes ? Array.from(nodes).filter(n => n.offsetParent !== null) : []
      if (!items.length) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === items[0] || document.activeElement === dialogRef.current)) { event.preventDefault(); items[items.length - 1]?.focus() }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus() }
    }
    window.addEventListener('keydown', key)
    return () => { window.removeEventListener('keydown', key); previous?.focus() }
  }, [open, busy, review])

  if (!bridge) return null
  const pending = snapshot?.proposals.filter(p => p.state === 'pending') ?? []
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError('')
    ++requestVersion.current
    try {
      await action()
      const next = await bridge.snapshot()
      if (mounted.current) setSnapshot(next)
    } catch {
      if (mounted.current) setError('Could not complete this action. Check the wallet is unlocked on the paired account, or try again.')
    } finally { if (mounted.current) setBusy(false) }
  }
  const close = () => { if (!busy && !review) { setOpen(false); setExported(null); triggerRef.current?.focus() } }
  const openProposal = (p: AgentProposal) => act(async () => { const result = await bridge.review(p.id, 'open'); if (mounted.current) setReview(result) })
  const draft = review?.proposal.draft
  return <>
    <button ref={triggerRef} type="button" className="agent-trigger" title="Agent Access" onClick={() => setOpen(true)} aria-label={`Agent Access${pending.length ? `, ${pending.length} pending` : ''}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 3v4M8 16h8M8 11v2M16 11v2M1 12h3M20 12h3" />
      </svg>
      {pending.length > 0 && <span>{pending.length}</span>}
    </button>
    {open && <BodyPortal><div className="agent-overlay">
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="agent-access-title" className="agent-panel art-panel">
        <div className="agent-heading"><h2 id="agent-access-title">Agent Access</h2>
          <button type="button" className="btn btn-ghost" disabled={busy || !!review} onClick={close}>Close</button></div>
        {error && <p role="alert" className="agent-error">{error}</p>}
        {review && draft ? <>
          <p>Proposal from <strong>{review.proposal.clientName}</strong>. Review the fields and current costs before confirming.</p>
          <p className="agent-muted">Opening this form has not signed or sent anything. You can edit the draft. Closing it leaves the proposal marked “opened”.</p>
          {draft.kind === 'swap' && <>
            <p className="agent-identity">Pay: {draft.swap.from.chain} · {draft.swap.from.address}<br />Receive: {draft.swap.to.chain} · {draft.swap.to.address}</p>
            <DexSwapWidget key={review.proposal.id} addresses={addresses} active initialAgentSwap={draft.swap}
              beforeExecute={() => bridge.checkReview(review.proposal.id)} onExecutionBusy={setExecuting} />
            <button type="button" className="btn btn-ghost" disabled={executing} onClick={() => setReview(null)}>Back to Agent Access</button>
          </>}
        </> : <>
          <p>Let paired assistants read this account and request transactions. You approve sends here, or authorize a separately funded spending account.</p>
          <div className="agent-row"><span>{snapshot?.enabled ? 'Access enabled for this app session' : 'Access is off'}</span>
            <button type="button" className="btn btn-ghost" disabled={busy || !snapshot?.available} onClick={() => act(async () => {
              await bridge.enable(!snapshot?.enabled); setExported(null); setReview(null)
            })}>{snapshot?.enabled ? 'Disable access' : 'Enable access'}</button></div>
          {!snapshot?.available && <p className="agent-muted">Unlock a wallet outside Privacy Mode to manage agent access.</p>}
          {snapshot?.enabled && <section aria-label="Pair an agent" className="agent-section">
            <h3>Pair an assistant</h3>
            <label>Assistant name<input className="input" value={name} maxLength={48} onChange={e => setName(e.target.value)} /></label>
            <label className="agent-check"><input type="checkbox" checked={proposals} onChange={e => setProposals(e.target.checked)} />Allow transfer and swap proposals</label>
            <p className="agent-muted">Request permission also allows ETH transaction requests. Autonomous sending needs a separate policy and wallet password below.</p>
            <p className="agent-muted">Reads include public addresses, balances, tokens and swap history for the current account and mode. Pairing expires after 8 hours or when the app restarts. Locked wallets deny requests.</p>
            <p className="agent-muted">Save connection files in a private folder. They grant access to this account; keep them out of shared folders and source control.</p>
            <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => act(async () => {
              const result = await bridge.pair(name.trim(), proposals)
              if (result.exported && mounted.current) setExported(result)
            })}>Pair and save connection files</button>
            {exported && <div role="status"><p>Connection files saved. MCP launch command:</p><pre>{exported.command}</pre><p className="agent-muted">For CLI use, replace the final “mcp” with “tools” or “balances”. Node.js 20 or newer is required.</p></div>}
          </section>}
          {!!snapshot?.grants.length && <section className="agent-section"><h3>Paired assistants</h3>{snapshot.grants.map(g => <div className="agent-grant" key={g.id}>
            <div><strong>{g.name}</strong><p className="agent-muted">Account {g.accountIndex + 1} · {g.environment} · {g.proposals ? 'Read and propose' : 'Read only'}<br />Expires {new Date(g.expiresAt).toLocaleTimeString()}</p></div>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => bridge.revoke(g.id))}>Revoke {g.name}</button>
          </div>)}</section>}
          <AgentExecutionPanel grants={snapshot?.grants ?? []} ownerAddress={addresses.evm} contextKey={snapshot?.context ?? null} />
          <section className="agent-section"><h3>Proposal inbox {pending.length > 0 && `(${pending.length})`}</h3>
            {pending.length === 0 && <p className="agent-muted">No proposals waiting for review.</p>}
            {snapshot?.proposals.map(p => <article key={p.id} className="agent-proposal">
              <strong>{p.clientName}</strong><span className="agent-muted"> · {p.state}</span>
              <p>{p.draft.kind === 'transfer' ? `Send ${p.draft.amount} ${p.draft.symbol} on ${p.draft.network}`
                : `Swap ${p.draft.swap.amount} ${p.draft.swap.from.symbol} on ${p.draft.swap.from.chain} → ${p.draft.swap.to.symbol} on ${p.draft.swap.to.chain}`}</p>
              <p className="agent-identity">{p.draft.kind === 'transfer' ? `Recipient: ${p.draft.recipient}`
                : `Pay asset: ${p.draft.swap.from.address} · Receive asset: ${p.draft.swap.to.address}`}</p>
              {p.state === 'pending' && <><p className="agent-muted">Expires {new Date(p.expiresAt).toLocaleTimeString()}. Current fees and a fresh quote appear during wallet review.</p>
                <div className="agent-actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(async () => { await bridge.review(p.id, 'reject') })}>Reject</button>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => openProposal(p)}>Review in wallet</button></div></>}
            </article>)}
            <p className="agent-muted">“Opened” means a form was opened. It does not prove broadcast or settlement. Check Swap history for transaction outcomes.</p>
          </section>
          <section className="agent-section"><h3>Activity this session</h3>{snapshot?.activity.slice(0, 15).map((event, i) => <p key={i} className="agent-muted">{new Date(event.at).toLocaleTimeString()} · {event.client} · {event.action} · {event.outcome}</p>)}</section>
        </>}
      </div>
    </div></BodyPortal>}
    {review && draft?.kind === 'transfer' && <SendModal key={review.proposal.id} chainId={draft.chain} symbol={draft.symbol}
      chainLabel={draft.network} balance={review.balance} contextKey={snapshot?.context ?? ''} initialDraft={{ recipient: draft.recipient, amount: draft.amount }}
      beforeSend={() => bridge.checkReview(review.proposal.id)} onClose={() => setReview(null)} />}
  </>
}
