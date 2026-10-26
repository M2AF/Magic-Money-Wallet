import { useState } from 'react'
import type { AgentSpendingPolicy } from '../../shared/agent-execution'
import type { X402Limits, X402LimitsInput, X402Snapshot } from '../../shared/x402'

export function usdc(raw: string): string {
  const value = raw.padStart(7, '0')
  return `${value.slice(0, -6)}.${value.slice(-6)}`.replace(/\.?0+$/, '')
}
export function X402AccountControls({ policy, limit, busy, configure }: {
  policy: AgentSpendingPolicy; limit?: X402Limits; busy: boolean
  configure(input: X402LimitsInput, password: string): void
}) {
  const [urls, setUrls] = useState(''), [perPayment, setPerPayment] = useState('0.10')
  const [daily, setDaily] = useState('1'), [total, setTotal] = useState('5'), [password, setPassword] = useState('')
  const network = policy.chainId === 11155111 ? 'Base Sepolia' : 'Base'
  return <details className="agent-section" data-testid="x402-account-controls"><summary>USDC x402 on this account</summary>
    <p>Fund the address above with USDC on <strong>{network}</strong>. Automatic payments use the existing recipient allowlist and the exact resource URLs below. These limits are in USDC.</p>
    <p className="agent-muted">Stop account, Stop all, revocation and expiry block new authorizations. Signatures already released remain redeemable until their signed expiry (at most 5 minutes). URL restrictions are enforced inside the wallet.</p>
    {limit ? <>
      <p>Authorized USDC caps: {usdc(limit.perPaymentRaw)}/payment · {usdc(limit.dailyRaw)}/24h · {usdc(limit.totalRaw)} total</p>
      <p className="agent-identity">Allowed resources: {limit.resourceUrls.join('\n')}</p>
      <p className="agent-muted">Limits are immutable. Payments outside them require a visible, one-payment exception in this inbox.</p>
    </> : <>
      <label>Allowed x402 resource URLs (one per line)<textarea className="input" rows={3} value={urls} onChange={e => setUrls(e.target.value)} /></label>
      <div className="agent-limit-grid">
        <label>Per-payment cap (USDC)<input className="input" inputMode="decimal" value={perPayment} onChange={e => setPerPayment(e.target.value)} /></label>
        <label>24-hour cap (USDC)<input className="input" inputMode="decimal" value={daily} onChange={e => setDaily(e.target.value)} /></label>
        <label>Total budget (USDC)<input className="input" inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></label>
      </div>
      <label>Wallet password for x402<input className="input" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <p>Authorizing these rules lets the assistant obtain spendable USDC signatures automatically within the caps. Every signature fixes its recipient, amount and expiry. Facilitators settle outside the wallet's Send flow.</p>
      <button type="button" className="btn btn-primary" disabled={busy || !password || !policy.active} onClick={() => {
        const secret = password; setPassword('')
        configure({ policyId: policy.id, resourceUrls: urls.split(/\r?\n/).map(v => v.trim()).filter(Boolean), perPayment, daily, total }, secret)
      }}>Authorize USDC x402 rules</button>
    </>}
    <p className="agent-muted">The seed recovery path above controls this USDC too. Native recovery handles the account policy's native currency; USDC recovery currently requires a trusted wallet supporting that derivation path. Keep the path with your offline backup.</p>
  </details>
}
export function X402Inbox({ snapshot, busy, act }: { snapshot: X402Snapshot; busy: boolean; act(action: () => Promise<unknown>): void }) {
  const bridge = window.wallet.agentX402
  if (!snapshot.available || !bridge) return null
  return <div className="agent-section" aria-label="x402 payments"><h3>USDC x402 payments</h3>
    <p className="agent-muted">Within the account's USDC rules, authorizations sign automatically. Valid exceptions require approval below. Authorization status does not prove settlement or resource delivery.</p>
    {!snapshot.payments.length && <p className="agent-muted">No x402 requests yet. Configure USDC rules on an isolated account below.</p>}
    {snapshot.payments.slice(0, 50).map(p => <article key={p.id} className="agent-proposal" data-testid="x402-payment">
      <strong>{p.clientName}</strong> · {p.networkName} · <strong>{p.state}</strong>
      <p>{usdc(p.amountRaw)} USDC ({p.amountRaw} base units) · {p.automatic ? 'Automatic policy' : 'Owner review'}</p>
      <p className="agent-identity">Resource: {p.resourceUrl}<br />From: {p.from}<br />Pay to: {p.recipient}<br />Asset: {p.asset}<br />Request: {p.requestId}</p>
      <p className="agent-muted">Valid after {new Date(Number(p.authorization.validAfter) * 1000).toLocaleTimeString()} · expires {new Date(p.expiresAt).toLocaleTimeString()}</p>
      <p className="agent-identity">Nonce: {p.authorization.nonce}</p>
      {p.reasons.map(reason => <p key={reason}>{reason}</p>)}
      {p.error && <p role="status">{p.error}</p>}
      {['pending-approval', 'prepared'].includes(p.state) && <>
        {p.state === 'prepared' && <div className="agent-send-review"><p>This authorizes exactly {usdc(p.amountRaw)} USDC from the isolated account. This one-payment approval overrides the listed URL, recipient and cap restrictions without changing automatic rules.</p>
          <p>The merchant/facilitator can redeem the signature outside the wallet. Revoking or locking afterward cannot recall it. The URL is checked inside the wallet, not on-chain.</p></div>}
        <div className="agent-actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => bridge.reject(p.id))}>Reject USDC payment</button>
          {p.state === 'prepared' ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => bridge.approve(p.id, p.reviewId!))}>Approve one USDC payment</button>
            : <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => bridge.prepare(p.id))}>Review USDC exception</button>}</div>
      </>}
    </article>)}
  </div>
}
