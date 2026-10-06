/**
 * JourneyRoutesPanel.tsx — routes across networks from every route family
 * (USDCx via Circle xReserve, cbADA via Chainlink CCIP, Coinbase conversion),
 * as the privileged layer discovered and ranked them (swap:journeyPlan).
 *
 * Layout follows the ranking's contract:
 *   - Recommended: chosen by the shared routing policy among routes that are
 *     executable, validated and fully priced. Shown alone, with the actual best
 *     net result when the policy preferred another.
 *   - Previews: everything else, visibly separate, never marked cheapest, each
 *     with its costs (unknown ones named), refundable deposits apart, and why it
 *     cannot run yet.
 * Nothing here can start a transfer. For a plain Base cbADA -> Solana cbADA
 * transfer (no swap on either side) it offers CbAdaTermsPanel, which only
 * stores approved terms. Loaded on an explicit click — several quote APIs
 * behind it are rate-limited per IP.
 */

import { useEffect, useRef, useState } from 'react'
import {
  summarizeCosts, type JourneyCandidate, type JourneyCost, type JourneyPlanRequest, type JourneyRanking,
} from '../../shared/journey-candidate'
import { CbAdaTermsPanel } from './CbAdaTermsPanel'
import { fmt } from './journey-format'
const usd = (n: number) => `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`
const chainName = (c: string) => c.charAt(0).toUpperCase() + c.slice(1)

function costLine(c: JourneyCost): string {
  if (c.amountRaw === null && c.usd === null) return `${c.label}: unknown`
  const amount = c.amountRaw !== null ? `${fmt(c.amountRaw, c.decimals)} ${c.symbol}` : ''
  const price = c.usd !== null ? `${amount ? ' (' : ''}≈${usd(c.usd)}${amount ? ')' : ''}` : ''
  const note = c.kind === 'deposit' ? ' — returned' : c.includedInOutput ? ' — already in the quoted output' : ''
  return `${c.label}: ${amount}${price}${note}`
}

function CandidateCard({ c, tag }: { c: JourneyCandidate; tag: 'recommended' | 'executable' | 'preview' }) {
  const s = summarizeCosts(c)
  const final = c.finalMinRaw ?? c.finalExpectedRaw
  const counted = c.costs.filter(k => k.kind !== 'deposit')
  return (
    <div data-testid={`journey-${tag}-${c.family}`} style={{
      border: `1px solid ${tag === 'recommended' ? 'rgba(34,197,94,0.4)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)',
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{c.label}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', textAlign: 'right' }}>
          {final ? <>≥ {fmt(final, c.destination.decimals)} {c.destination.symbol}{tag === 'preview' ? ' (estimate)' : ''}</> : 'Output unknown'}
        </div>
      </div>
      {c.legs.map((l, i) => (
        <div key={i} style={{ fontSize: 11, lineHeight: 1.45, color: l.status === 'unavailable' ? '#facc15' : 'var(--text-secondary)' }}>
          {i + 1}. {l.label} —{' '}
          {l.status === 'skipped' ? 'not needed'
            : l.status === 'unavailable' ? (l.reason ?? 'unavailable')
            : <>≥ {fmt(l.minOutRaw, l.to.decimals)} {l.to.symbol}{l.via ? ` via ${l.via}` : ''}{l.inputBasis === 'indicative' ? ' · re-quoted from what actually arrives' : ''}</>}
        </div>
      ))}
      {counted.length > 0 && (
        <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-muted)' }}>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
            Costs{s.countedUsd !== null ? `: ≈${usd(s.countedUsd)} in total` : ' (total unknown)'}
          </div>
          {counted.map((k, i) => <div key={i}>• {costLine(k)}</div>)}
        </div>
      )}
      {s.deposits.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Deposits (returned, not a cost): {s.deposits.map(costLine).join('; ')}</div>
      )}
      {c.blockers.length > 0 && (
        <div style={{ fontSize: 11, lineHeight: 1.45, color: 'var(--text-muted)' }}>
          {c.blockers.map(b => <div key={b}>• {b}</div>)}
        </div>
      )}
    </div>
  )
}

export function JourneyRoutesPanel({ request }: { request: JourneyPlanRequest | null }) {
  const [ranking, setRanking] = useState<JourneyRanking | null>(null)
  const [empty, setEmpty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const key = request ? JSON.stringify(request) : ''
  // The request the screen shows NOW. A lookup that returns after the pair or
  // amount changed (or after unmount) answered a different question: dropped.
  const currentKey = useRef(key)
  currentKey.current = key
  useEffect(() => () => { currentKey.current = '\u0000unmounted' }, [])

  useEffect(() => { setRanking(null); setError(null); setEmpty(false); setLoading(false) }, [key])

  if (!request || !window.wallet.swapJourneyPlan) return null

  const load = async () => {
    const asked = key
    const current = () => currentKey.current === asked
    setLoading(true); setError(null)
    try {
      const r = await window.wallet.swapJourneyPlan!(request)
      if (!current()) return
      if (!r.ok) { setError(r.message); return }
      setRanking(r.value.ranking)
      setEmpty(r.value.candidates.length === 0)
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : 'Routes could not be discovered.')
    } finally {
      if (current()) setLoading(false)
    }
  }

  const rec = ranking?.recommended
  // A plain cbADA transfer: both swap steps are "not needed". The privileged
  // layer re-derives every identity; this only decides whether to offer it.
  const same = (a: { address: string; decimals: number }, b: { address: string; decimals: number }) =>
    a.address.toLowerCase() === b.address.toLowerCase() && a.decimals === b.decimals
  const plainCbAda = request.fromChain === 'base' && request.toChain === 'solana' && !!ranking
    && [...ranking.executable, ...ranking.previews].some(c => c.family === 'cbada-ccip'
      && c.legs.length === 3 && c.legs[0].status === 'skipped' && c.legs[2].status === 'skipped'
      && same(c.legs[1].from, request.fromToken) && same(c.legs[1].to, request.toToken))
  return (
    <div data-testid="journey-routes" style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
      padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 700 }}>
        Routes from {chainName(request.fromChain)} to {chainName(request.toChain)}
      </div>
      {!ranking && (
        <>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Compare multi-step routes through an intermediate asset (USDCx, cbADA). Each step is a separate transaction.
          </div>
          <button type="button" onClick={load} disabled={loading}
            style={{ padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'transparent',
              color: 'var(--text-primary)', fontSize: 12, fontWeight: 600, cursor: loading ? 'wait' : 'pointer' }}>
            {loading ? 'Checking each route…' : 'Find routes'}
          </button>
        </>
      )}
      {error && <div style={{ fontSize: 11, color: '#fca5a5' }}>{error}</div>}
      {ranking && empty && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>No route family serves this pair.</div>}
      {ranking && (
        <>
          {rec ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e' }}>Recommended</div>
              <CandidateCard c={rec.candidate} tag="recommended" />
              {rec.best !== rec.candidate && (
                <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  Best net result: {rec.best.label} ({(rec.shortfallBps / 100).toFixed(2)}% more).
                </div>
              )}
              {ranking.executable.filter(c => c !== rec.candidate).map((c, i) => <CandidateCard key={i} c={c} tag="executable" />)}
            </div>
          ) : (
            ranking.noRecommendation && <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{ranking.noRecommendation}</div>
          )}
          {ranking.previews.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#facc15' }}>Previews — not executable yet</div>
              {ranking.previews.map((c, i) => <CandidateCard key={i} c={c} tag="preview" />)}
            </div>
          )}
          {plainCbAda && <CbAdaTermsPanel amountRaw={request.sellAmountRaw} />}
        </>
      )}
    </div>
  )
}
