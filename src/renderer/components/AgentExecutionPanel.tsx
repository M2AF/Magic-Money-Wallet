import { useEffect, useRef, useState } from 'react'
import type { AgentGrantView } from '../../shared/agent-access'
import type { AgentExecutionSnapshot, AgentTransaction } from '../../shared/agent-execution'
import { agentNativeSymbol } from '../../shared/agent-execution'
import type { X402Snapshot } from '../../shared/x402'
import { X402AccountControls, X402Inbox } from './X402Controls'
import { AgentNativePanel } from './AgentNativePanel'

function eth(raw: string): string {
  const digits = raw.padStart(19, '0')
  return `${digits.slice(0, -18)}.${digits.slice(-18)}`.replace(/\.?0+$/, '')
}

export function AgentExecutionPanel({ grants, ownerAddress, contextKey }: { grants: AgentGrantView[]; ownerAddress: string; contextKey: string | null }) {
  const bridge = window.wallet.agentExecution
  const [snapshot, setSnapshot] = useState<AgentExecutionSnapshot | null>(null)
  const [x402, setX402] = useState<X402Snapshot>({ available: false, payments: [], limits: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [clientId, setClientId] = useState('')
  const [recipients, setRecipients] = useState('')
  const [perSend, setPerSend] = useState('0.001')
  const [daily, setDaily] = useState('0.005')
  const [total, setTotal] = useState('0.01')
  const [maxFee, setMaxFee] = useState('0.0001')
  const [minutes, setMinutes] = useState('60')
  const [password, setPassword] = useState('')
  const [chain, setChain] = useState<'ethereum' | 'monad'>('ethereum')
  const [allowCare, setAllowCare] = useState(false), [tokenIds, setTokenIds] = useState('')
  const [recoverId, setRecoverId] = useState('')
  const [recoverTo, setRecoverTo] = useState(ownerAddress)
  const [recoverAmount, setRecoverAmount] = useState('')
  const [recoverPassword, setRecoverPassword] = useState('')
  const [now, setNow] = useState(Date.now())
  const mounted = useRef(true)
  const latch = useRef(false)
  const version = useRef(0)
  const refresh = async () => {
    if (!bridge) return
    const request = ++version.current
    const next = await bridge.snapshot()
    if (mounted.current && request === version.current) setSnapshot(next)
    if (window.wallet.agentX402) {
      try {
        const payments = await window.wallet.agentX402.snapshot()
        if (mounted.current && request === version.current) setX402(payments)
      } catch { if (mounted.current && request === version.current) setError('x402 journal unavailable. Preserve it; no authorizations can be issued.') }
    }
  }
  useEffect(() => {
    mounted.current = true
    setSnapshot(null); setX402({ available: false, payments: [], limits: [] }); setPassword(''); setRecoverPassword(''); setRecoverId(''); setRecoverTo(ownerAddress)
    refresh().catch(() => { if (mounted.current) setError('Execution journal unavailable. Preserve it for recovery; do not delete it.') })
    const timer = setInterval(() => { setNow(Date.now()); refresh().catch(() => {}) }, 2000)
    return () => { mounted.current = false; version.current++; clearInterval(timer) }
  }, [bridge, contextKey, ownerAddress])
  if (!bridge) return null
  const act = async (action: () => Promise<unknown>) => {
    if (latch.current) return
    latch.current = true; setBusy(true); setError('')
    try { await action(); await refresh() }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Action could not be completed.') }
    finally { latch.current = false; if (mounted.current) setBusy(false) }
  }
  // This must remain available while another operation is awaiting RPC/signing.
  const kill = async (id?: string) => {
    try { await bridge.kill(id); await refresh() }
    catch { if (mounted.current) setError('Could not persist the stop. Disable Agent Access immediately and keep the wallet open for recovery.') }
  }
  const eligible = grants.filter(g => g.proposals && g.expiresAt > now)
  const selected = eligible.find(g => g.id === clientId)?.id ?? eligible[0]?.id ?? ''
  const transactions = snapshot?.transactions ?? []
  const policyChain = chain === 'monad' && snapshot?.chainId !== 11155111 ? 'monad' : 'ethereum'
  const symbol = policyChain === 'monad' ? 'MON' : 'ETH'
  const renderTx = (tx: AgentTransaction) => <article key={tx.id} className="agent-proposal" data-testid="agent-transaction">
    <strong>{tx.clientName}</strong> · {tx.network} · {tx.mode} · <strong>{tx.state}</strong>
    <p>{tx.call ? `Call ${tx.call.function}(${tx.call.args.join(', ')}) · ` : 'Send '}{eth(tx.valueRaw)} {agentNativeSymbol(tx.chainId)}</p>
    <p className="agent-identity">From: {tx.from}<br />To: {tx.recipient}<br />Request: {tx.requestId}</p>
    {tx.plan && tx.state === 'prepared' && <div className="agent-send-review">
      <p>Maximum network fee: <strong>{eth(tx.plan.maxFeeRaw)} {agentNativeSymbol(tx.chainId)}</strong><br />Maximum total: <strong>{eth(tx.plan.totalRaw)} {agentNativeSymbol(tx.chainId)}</strong></p>
      <p className="agent-muted">Nonce {tx.plan.nonce}. Review expires {new Date(tx.plan.expiresAt).toLocaleTimeString()}. Approval signs and submits these exact fields.</p>
    </div>}
    {tx.error && <p role="status">{tx.error}</p>}
    {tx.txHash && <><p className="agent-identity">Hash: {tx.txHash}</p>
      <p>{tx.confirmations} confirmations · {tx.finalized ? 'Finalized' : 'Finality not verified'}</p>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => bridge.status(tx.id))}>Check confirmation</button></>}
    {['pending-approval', 'prepared'].includes(tx.state) && tx.mode !== 'autonomous' && <div className="agent-actions">
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => bridge.reject(tx.id))}>Reject request</button>
      {tx.plan && tx.state === 'prepared' && tx.plan.expiresAt > now
        ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => bridge.approve(tx.id, tx.plan!.reviewId))}>Approve and send</button>
        : <button type="button" className="btn btn-primary" disabled={busy || tx.expiresAt <= now} onClick={() => act(() => bridge.prepare(tx.id))}>Review transaction</button>}
    </div>}
  </article>
  return <section className="agent-section" aria-label="Agent transactions">
    <div className="agent-row"><h3>Transactions &amp; spending accounts</h3><button type="button" className="btn btn-ghost agent-stop" onClick={() => kill()}>Stop all autonomous sending</button></div>
    <p>ETH on Ethereum/Sepolia and MON on Monad mainnet. Each normal request needs your approval here. Autonomous sends use separately funded accounts with the limits you authorize below.</p>
    <p className="agent-muted">Native transfers go to externally owned accounts. Monad contract calls require an explicit Emogotchi policy; other token transfers, contract calls and swaps use the existing wallet flows.</p>
    {error && <p role="alert" className="agent-error">{error}</p>}
    {!transactions.length && <p className="agent-muted">No execution requests yet. Agents use request-transaction, then poll transaction-status.</p>}
    {transactions.slice(0, 50).map(renderTx)}
    <X402Inbox snapshot={x402} busy={busy} act={act} />
    <details className="agent-section"><summary>Authorize an autonomous spending account</summary>
      <p>Creates a new isolated account. Fund only the amount you intend this assistant to spend. Limits include the transfer amount plus its maximum network fee. No automatic top-ups.</p>
      <label>Assistant<select className="input" value={selected} onChange={e => setClientId(e.target.value)} disabled={busy}>
        {!eligible.length && <option value="">Pair an assistant with request permission first</option>}
        {eligible.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select></label>
      <label>Spending network<select aria-label="Spending network" className="input" value={policyChain} onChange={e => { setChain(e.target.value as 'ethereum' | 'monad'); setAllowCare(false) }} disabled={busy}>
        <option value="ethereum">{snapshot?.chainId === 11155111 ? 'Sepolia (ETH)' : 'Ethereum (ETH)'}</option>
        {snapshot?.chainId !== 11155111 && <option value="monad">Monad mainnet (MON) · chain 143</option>}
      </select></label>
      <label>Allowed recipient addresses (one per line)<textarea className="input" rows={3} value={recipients} onChange={e => setRecipients(e.target.value)} /></label>
      {policyChain === 'monad' && <>
        <label><input type="checkbox" checked={allowCare} onChange={e => setAllowCare(e.target.checked)} /> Allow Emogotchi care calls</label>
        {allowCare && <div className="agent-section">
          <p className="agent-identity">Contract: 0xC0A0808cbAF507b80df92b22feD8D3810eAB45d5</p>
          <label>Allowed pet token IDs (one per line)<textarea className="input" rows={3} value={tokenIds} onChange={e => setTokenIds(e.target.value)} /></label>
          <p>feed, wash, play, sleep and clean cost exactly 1 MON per call; pet(id, count 1–20) sends 0 MON. Fees count toward the budgets below. Per-call value cap: 1 MON. revive and setName remain blocked.</p>
          <p className="agent-muted">This isolated account must own the allowed pets. Native recipient addresses can be empty for care calls only. Fund pets with a normal wallet transfer. NFT recovery from this isolated account currently requires a trusted wallet supporting its displayed seed path; the recovery button below sends native MON only.</p>
        </div>}
      </>}
      <div className="agent-limit-grid">
        <label>Per-send cap ({symbol})<input className="input" inputMode="decimal" value={perSend} onChange={e => setPerSend(e.target.value)} /></label>
        <label>Rolling 24-hour cap ({symbol})<input className="input" inputMode="decimal" value={daily} onChange={e => setDaily(e.target.value)} /></label>
        <label>Total budget ({symbol})<input className="input" inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></label>
        <label>Maximum fee per send ({symbol})<input className="input" inputMode="decimal" value={maxFee} onChange={e => setMaxFee(e.target.value)} /></label>
      </div>
      <label>Expires after (minutes, 1–480)<input className="input" type="number" min="1" max="480" value={minutes} onChange={e => setMinutes(e.target.value)} /></label>
      <label>Wallet password<input className="input" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <p className="agent-muted">These terms cannot be expanded by the assistant. Revoke, disable access, lock the wallet, expire the policy, or use Stop to block further sends. Restart stops all policies. A transaction already handed to the network cannot be recalled.</p>
      <button type="button" className="btn btn-primary" disabled={busy || !selected || !password || !snapshot?.supported} onClick={() => {
        const secret = password; setPassword('')
        act(() => bridge.createPolicy({ clientId: selected, chain: policyChain, recipients: recipients.split(/[\s,]+/).filter(Boolean), perSend, daily, total, maxFee, minutes: Number(minutes),
          ...(policyChain === 'monad' && allowCare ? { emogotchiTokenIds: tokenIds.split(/[\s,]+/).filter(Boolean) } : {}) }, secret))
      }}>Authorize isolated account</button>
    </details>
    {!!snapshot?.policies.length && <div className="agent-section"><h3>Isolated accounts</h3>{snapshot.policies.map(p => <article className="agent-proposal" key={p.id}>
      <strong>{p.clientName}</strong> · {p.network} · {p.active ? 'Active' : 'Stopped / expired'}
      <p className="agent-identity">Funding address: {p.address}<br />Policy: {p.id}<br />Recovery path: m/44'/60'/{p.accountIndex}'/0/0</p>
      <p className="agent-muted">Backed up by this wallet's seed. Funding uses a separate normal wallet transfer. Keep the derivation path with your offline backup.</p>
      <p>Caps incl. fees: {eth(p.perSendRaw)} {agentNativeSymbol(p.chainId)}/send · {eth(p.dailyRaw)} {agentNativeSymbol(p.chainId)}/24h · {eth(p.totalRaw)} {agentNativeSymbol(p.chainId)} total<br />Max fee: {eth(p.maxFeeRaw)} {agentNativeSymbol(p.chainId)} · Expires {new Date(p.expiresAt).toLocaleString()}</p>
      {p.emogotchiTokenIds && <p className="agent-identity">Emogotchi token IDs: {p.emogotchiTokenIds.join(', ')}<br />Allowed: feed, wash, play, sleep, clean (1 MON); pet (0 MON, count 1–20). Value cap 1 MON plus bounded fees. revive/setName blocked.</p>}
      <p className="agent-identity">Allowed recipients: {p.recipients.join('\n')}</p>
      <p>Reserved budget: {eth(transactions.filter(t => t.policyId === p.id && t.mode === 'autonomous' && t.plan && !['pending-approval', 'prepared', 'rejected', 'expired'].includes(t.state)).reduce((sum, t) => sum + BigInt(t.plan!.totalRaw), 0n).toString())} {agentNativeSymbol(p.chainId)}</p>
      {p.stoppedReason && <p className="agent-muted">{p.stoppedReason}</p>}
      {x402.available && <X402AccountControls policy={p} limits={x402.limits.filter(l => l.policyId === p.id)} busy={busy}
        configure={(input, secret) => act(() => window.wallet.agentX402!.configure(input, secret))} />}
      <div className="agent-actions"><button type="button" className="btn btn-ghost" onClick={() => navigator.clipboard.writeText(p.address).catch(() => setError('Copy failed. Select and copy the displayed address.'))}>Copy funding address</button>
        <button type="button" className="btn btn-ghost agent-stop" onClick={() => kill(p.id)}>Stop account</button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setRecoverId(p.id); setRecoverTo(ownerAddress); setRecoverAmount('') }}>Recover {agentNativeSymbol(p.chainId)}</button></div>
      {recoverId === p.id && <div className="agent-section">
        <p>Recovery stops this policy. Leave enough {agentNativeSymbol(p.chainId)} for the displayed fee; review before sending. This sends native currency only.</p>
        <label>Recovery recipient<input className="input" value={recoverTo} onChange={e => setRecoverTo(e.target.value)} /></label>
        <label>Recovery amount ({agentNativeSymbol(p.chainId)})<input className="input" inputMode="decimal" value={recoverAmount} onChange={e => setRecoverAmount(e.target.value)} /></label>
        <label>Wallet password<input className="input" type="password" autoComplete="off" value={recoverPassword} onChange={e => setRecoverPassword(e.target.value)} /></label>
        <button type="button" className="btn btn-primary" disabled={busy || !recoverPassword} onClick={() => {
          const secret = recoverPassword; setRecoverPassword('')
          act(async () => { await bridge.recovery(p.id, recoverTo, recoverAmount, secret); setRecoverId('') })
        }}>Prepare recovery</button>
      </div>}
    </article>)}</div>}
    <AgentNativePanel grants={grants} contextKey={contextKey} />
  </section>
}
