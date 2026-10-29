import { useEffect, useRef, useState } from 'react'
import type { AgentGrantView } from '../../shared/agent-access'
import { NATIVE_NETWORKS, type NativeSnapshot, type NativePolicyInput, type NativePolicy } from '../../shared/agent-native'

export function nativeDisplay(raw: string, decimals: number) {
  const s = raw.padStart(decimals + 1, '0'), fraction = s.slice(-decimals).replace(/0+$/, '')
  return `${s.slice(0, -decimals)}${fraction ? `.${fraction}` : ''}`
}
export function AgentNativePanel({ grants, contextKey }: { grants: AgentGrantView[]; contextKey: string | null }) {
  const bridge = window.wallet.agentNative, [snapshot, setSnapshot] = useState<NativeSnapshot | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const mounted = useRef(true), latch = useRef(false), version = useRef(0)
  const [form, setForm] = useState<NativePolicyInput>({ chain: 'solana', clientId: '', recipients: [], perSend: '0.01', daily: '0.05', total: '0.1', maxFee: '0.001', minutes: 60 })
  const [recipients, setRecipients] = useState(''), [password, setPassword] = useState('')
  const [xPolicy, setXPolicy] = useState(''), [urls, setUrls] = useState(''), [xPer, setXPer] = useState('0.1'), [xDaily, setXDaily] = useState('1'), [xTotal, setXTotal] = useState('5'), [xPassword, setXPassword] = useState('')
  const [recover, setRecover] = useState(''), [recoverTo, setRecoverTo] = useState(''), [recoverAmount, setRecoverAmount] = useState(''), [recoverPassword, setRecoverPassword] = useState('')
  const refresh = async () => { if (!bridge) return; const request = ++version.current, next = await bridge.snapshot(); if (mounted.current && request === version.current) setSnapshot(next) }
  useEffect(() => {
    mounted.current = true; setSnapshot(null); setPassword(''); setXPassword(''); setRecoverPassword('')
    refresh().catch(() => { if (mounted.current) setError('SOL/ADA journal unavailable. Preserve it for recovery.') })
    const timer = setInterval(() => { refresh().catch(() => {}) }, 2000)
    return () => { mounted.current = false; version.current++; clearInterval(timer) }
  }, [bridge, contextKey])
  if (!bridge) return null
  const act = async (fn: () => Promise<unknown>) => {
    if (latch.current) return
    latch.current = true; setBusy(true); setError('')
    try { await fn(); await refresh() } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : 'Native action failed.') }
    finally { latch.current = false; if (mounted.current) setBusy(false) }
  }
  const stop = async (id?: string) => { try { await bridge.kill(id); await refresh() } catch { setError('Stop could not be saved. Disable Agent Access and preserve the journal.') } }
  const eligible = grants.filter(g => g.proposals && g.expiresAt > Date.now()), selected = eligible.find(g => g.id === form.clientId)?.id ?? eligible[0]?.id ?? ''
  const symbol = form.chain === 'solana' ? 'SOL' : 'ADA'
  const recoveryPath = (p: NativePolicy) => NATIVE_NETWORKS[p.network].chain === 'solana' ? `m/44'/501'/${p.accountIndex}'/0'` : `m/1852'/1815'/${p.accountIndex}'/0/0`
  return <section className="agent-section" aria-label="Solana and Cardano agents">
    <div className="agent-row"><h3>Solana &amp; Cardano agents</h3><button type="button" className="btn btn-ghost agent-stop" onClick={() => stop()}>Stop SOL/ADA accounts</button></div>
    <p>Native SOL and ADA transfers use exact wallet-built transactions. x402 uses USDC on Solana and direct ADA payments on Cardano from these same isolated accounts.</p>
    {error && <p className="agent-error" role="alert">{error}</p>}
    {(snapshot?.transactions ?? []).slice(0, 50).map(tx => {
      const n = NATIVE_NETWORKS[tx.network], assetSymbol = tx.x402 && n.chain === 'solana' ? 'USDC' : n.symbol, decimals = assetSymbol === 'USDC' ? 6 : n.decimals
      return <article className="agent-proposal" key={tx.id} data-testid="agent-native-transaction">
        <strong>{tx.clientName}</strong> · {n.name} · {tx.mode} · <strong>{tx.state}</strong>
        <p>{nativeDisplay(tx.amountRaw, decimals)} {assetSymbol} ({tx.amountRaw} base units)</p>
        <p className="agent-identity">From: {tx.from}<br />Pay to: {tx.recipient}<br />Request: {tx.requestId}<br />Transaction: {tx.id}</p>
        {tx.x402 && <><p className="agent-identity">Resource: {tx.x402.resourceUrl}<br />Asset: {tx.asset}<br />Replay identity: {n.chain === 'cardano' ? tx.plan?.locks[0] ?? 'Input selected during review' : tx.x402.required.accepts[0].extra.memo ?? tx.x402.nonce}</p>
          {tx.x402.reasons.map(r => <p key={r}>{r}</p>)}
          <p className="agent-muted">Authorization is spendable by the facilitator; it does not prove payment or resource delivery. URL restrictions are enforced inside the wallet. Stop cannot recall released transactions. {n.chain === 'solana' ? 'The sponsor supplies its signature and pays fees. On-chain validity ends with the recent blockhash; local retrieval expires sooner.' : 'You pay the ADA network fee. The transaction expires at its signed TTL slot.'}</p></>}
        {tx.plan && <p>Maximum fee: {nativeDisplay(tx.plan.feeRaw, n.decimals)} {n.symbol} · native cost: {nativeDisplay(tx.plan.totalRaw, n.decimals)} {n.symbol}<br />Review/retrieval expires {new Date(tx.plan.expiresAt).toLocaleTimeString()}{tx.plan.ttl ? ` · TTL slot ${tx.plan.ttl}` : ` · last valid block height ${tx.plan.lastValidBlockHeight}`}</p>}
        {tx.error && <p role="status">{tx.error}</p>}
        {['pending-approval', 'prepared'].includes(tx.state) && tx.mode !== 'autonomous' && <div className="agent-actions">
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => bridge.reject(tx.id))}>Reject SOL/ADA request</button>
          {tx.state === 'prepared' && tx.plan && tx.plan.expiresAt > Date.now()
            ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => bridge.approve(tx.id, tx.plan!.reviewId))}>{tx.x402 ? 'Approve one x402 exception' : 'Approve SOL/ADA send'}</button>
            : <button type="button" className="btn btn-primary" disabled={busy} onClick={() => act(() => bridge.prepare(tx.id))}>Review SOL/ADA request</button>}
        </div>}
        {tx.x402 && tx.state === 'prepared' && <p>One-payment approval overrides the listed recipient, URL and budget restrictions. The exact amount and network fee above remain fixed.</p>}
        {tx.txHash && <><p className="agent-identity">Hash: {tx.txHash}</p><p>{tx.confirmations} confirmations · {tx.finalized ? 'Finalized' : 'Finality not verified'}</p><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => act(() => bridge.status(tx.id))}>Check SOL/ADA confirmation</button></>}
      </article>
    })}
    <details className="agent-section"><summary>Authorize SOL/ADA spending account</summary>
      <label>Assistant<select className="input" value={selected} onChange={e => setForm({ ...form, clientId: e.target.value })}>{!eligible.length && <option value="">Pair an assistant with request permission first</option>}{eligible.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
      <label>Native spending network<select className="input" aria-label="Native spending network" value={form.chain} onChange={e => { setForm({ ...form, chain: e.target.value as 'solana' | 'cardano' }); setRecipients('') }}><option value="solana">Solana · SOL (Devnet in Testnet Mode)</option><option value="cardano">Cardano · ADA (Preprod in Testnet Mode)</option></select></label>
      <label>Allowed SOL/ADA recipients (one per line)<textarea className="input" value={recipients} onChange={e => setRecipients(e.target.value)} /></label>
      <div className="agent-limit-grid">{(['perSend', 'daily', 'total', 'maxFee'] as const).map(key => <label key={key}>{{ perSend: 'Per-send cap', daily: '24-hour cap', total: 'Total budget', maxFee: 'Maximum fee' }[key]} ({symbol})<input className="input" inputMode="decimal" value={form[key]} onChange={e => setForm({ ...form, [key]: e.target.value })} /></label>)}</div>
      <label>Native policy expiry (minutes, 1–480)<input className="input" type="number" min="1" max="480" value={form.minutes} onChange={e => setForm({ ...form, minutes: Number(e.target.value) })} /></label>
      <label>Password for native account<input className="input" type="password" autoComplete="off" value={password} onChange={e => setPassword(e.target.value)} /></label>
      <p>Fund only what this assistant may spend. Native caps include fees; token x402 has an additional explicit budget. No automatic top-ups. Stop, expiry, revocation, lock and restart block further spending.</p>
      <button type="button" className="btn btn-primary" disabled={busy || !selected || !password} onClick={() => { const secret = password; setPassword(''); act(() => bridge.createPolicy({ ...form, clientId: selected, recipients: recipients.split(/[\s,]+/).filter(Boolean) }, secret)) }}>Authorize SOL/ADA account</button>
    </details>
    {(snapshot?.policies ?? []).map(p => {
      const n = NATIVE_NETWORKS[p.network], xSymbol = n.chain === 'solana' ? 'USDC' : 'ADA', limit = snapshot!.limits.find(l => l.policyId === p.id)
      return <article className="agent-proposal" key={p.id} data-testid="agent-native-account"><strong>{p.clientName}</strong> · {n.name} · {p.active ? 'Active' : 'Stopped / expired'}
        <p className="agent-identity">Funding address: {p.address}<br />Policy: {p.id}<br />Recovery path: {recoveryPath(p)}</p>
        <p>Caps including fees: {nativeDisplay(p.perSendRaw, n.decimals)} {n.symbol}/send · {nativeDisplay(p.dailyRaw, n.decimals)} {n.symbol}/24h · {nativeDisplay(p.totalRaw, n.decimals)} {n.symbol} total<br />Max fee {nativeDisplay(p.maxFeeRaw, n.decimals)} {n.symbol} · expires {new Date(p.expiresAt).toLocaleString()}</p>
        <p className="agent-identity">Recipients: {p.recipients.join('\n')}</p>
        <p className="agent-muted">Backed by this wallet's seed. Keep the recovery path with your offline backup. Recovery below sends native {n.symbol} only; Solana USDC recovery uses a trusted wallet with this path. Cardano inputs carrying tokens/NFTs are preserved and excluded from agent ADA sends.</p>
        {p.stoppedReason && <p>{p.stoppedReason}</p>}
        {snapshot!.x402Available && <details className="agent-section"><summary>{xSymbol} x402 rules on {n.name}</summary>
          {limit ? <p>Authorized: {nativeDisplay(limit.perPaymentRaw, 6)}/payment · {nativeDisplay(limit.dailyRaw, 6)}/24h · {nativeDisplay(limit.totalRaw, 6)} total {xSymbol}<br />Resources: {limit.resourceUrls.join('\n')}</p>
            : <><button type="button" className="btn btn-ghost" onClick={() => setXPolicy(p.id)}>Configure {xSymbol} x402</button>{xPolicy === p.id && <>
              <label>Exact resource URLs<textarea aria-label="Exact resource URLs" className="input" value={urls} onChange={e => setUrls(e.target.value)} /></label>
              <label>x402 per-payment cap ({xSymbol})<input className="input" value={xPer} onChange={e => setXPer(e.target.value)} /></label>
              <label>x402 daily cap ({xSymbol})<input className="input" value={xDaily} onChange={e => setXDaily(e.target.value)} /></label>
              <label>x402 total budget ({xSymbol})<input className="input" value={xTotal} onChange={e => setXTotal(e.target.value)} /></label>
              <label>Password for native x402<input className="input" type="password" autoComplete="off" value={xPassword} onChange={e => setXPassword(e.target.value)} /></label>
              <p>These rules authorize automatic spendable x402 transactions on this exact network and asset. Other valid payments need your approval. Released signatures cannot be recalled.</p>
              <button type="button" className="btn btn-primary" disabled={busy || !xPassword || !p.active} onClick={() => { const secret = xPassword; setXPassword(''); act(() => bridge.configureX402({ policyId: p.id, resourceUrls: urls.split(/\r?\n/).map(v => v.trim()).filter(Boolean), perPayment: xPer, daily: xDaily, total: xTotal }, secret)) }}>Authorize native x402 rules</button>
            </>}</>}
        </details>}
        <div className="agent-actions"><button type="button" className="btn btn-ghost agent-stop" onClick={() => stop(p.id)}>Stop SOL/ADA account</button><button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { setRecover(p.id); setRecoverTo(''); setRecoverAmount('') }}>Recover {n.symbol}</button></div>
        {recover === p.id && <div className="agent-section"><label>Native recovery recipient<input className="input" value={recoverTo} onChange={e => setRecoverTo(e.target.value)} /></label><label>Native recovery amount ({n.symbol})<input className="input" value={recoverAmount} onChange={e => setRecoverAmount(e.target.value)} /></label><label>Password for native recovery<input className="input" type="password" value={recoverPassword} onChange={e => setRecoverPassword(e.target.value)} /></label><button type="button" className="btn btn-primary" disabled={busy || !recoverPassword} onClick={() => { const secret = recoverPassword; setRecoverPassword(''); act(async () => { await bridge.recovery(p.id, recoverTo, recoverAmount, secret); setRecover('') }) }}>Prepare SOL/ADA recovery</button></div>}
      </article>
    })}
  </section>
}
