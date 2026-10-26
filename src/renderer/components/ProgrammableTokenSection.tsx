/**
 * ProgrammableTokenSection.tsx — CIP-113 facts inside the universal token panel.
 *
 * Presents only what `token.programmable` proves: observed balance, the
 * authenticated registry/protocol wiring, and recent balance changes. It makes
 * NO claim of safety, issuer identity, KYC state or user intent. Unknown /
 * loading / error are always shown as themselves, never as "unrestricted".
 */

import { useState } from 'react'
import type { Cip113Credential, Cip113ProgrammableDetails } from '../../shared/cip113-wire'
import type { TokenRestrictionFacts } from '../../shared/token-details'
import { formatUnits } from '../lib/asset-send'

export function ProgrammableBadge() {
  return (
    <span
      title="Programmable token (CIP-113) — transfers may be governed by on-chain rules"
      className="tdp-chip tdp-chip--prog"
    >
      ◇ Programmable
    </span>
  )
}

const short = (s: string, n = 10) => (s.length <= n * 2 + 1 ? s : `${s.slice(0, n)}…${s.slice(-n)}`)
const cred = (c: Cip113Credential) => `${c.type === 'script' ? 'Script' : 'Key'} ${c.hash}`
const yesNo = (v: boolean | null) => (v === null ? 'Unknown' : v ? 'Yes' : 'No')
const when = (ms: number) => new Date(ms).toLocaleString()

function Restrictions({ prog }: { prog: Cip113ProgrammableDetails }) {
  const r = prog.restrictions
  if (r.state !== 'ready') {
    return (
      <p className="tdp-note" role={r.state === 'loading' ? 'status' : undefined}>
        {r.state === 'loading' ? 'Checking token rules…'
          : r.state === 'error' ? `Could not check token rules: ${r.reason}`
          : `Token-specific rules are not verified: ${r.reason}`}
        {' '}This is not the same as unrestricted.
      </p>
    )
  }
  const f: TokenRestrictionFacts = r.value
  return (
    <dl className="tdp-facts tdp-facts--compact">
      <div><dt>Currently frozen</dt><dd>{yesNo(f.currentlyFrozen)}</dd></div>
      <div><dt>Can be frozen</dt><dd>{yesNo(f.canFreeze)}</dd></div>
      <div><dt>Can be seized</dt><dd>{yesNo(f.canSeize)}</dd></div>
      <div><dt>Can force transfer</dt><dd>{yesNo(f.canForceTransfer)}</dd></div>
      {f.transferRequirements.length > 0 && (
        <div><dt>Transfer requirements</dt><dd>{f.transferRequirements.join('; ')}</dd></div>
      )}
      <div>
        <dt>Third-party authority</dt>
        <dd className="tdp-mono tdp-wrap">{f.thirdPartyAuthority ?? 'Unknown'}</dd>
      </div>
      <div><dt>Evidence</dt><dd className="tdp-wrap">{f.evidenceSource} · checked {when(f.checkedAt)}</dd></div>
    </dl>
  )
}

function History({ prog, decimals, symbol }: { prog: Cip113ProgrammableDetails; decimals: number; symbol: string }) {
  const h = prog.history
  if (h.state === 'loading') return <p className="tdp-note" role="status">Loading token balance changes…</p>
  if (h.state !== 'ready') {
    return (
      <p className="tdp-note">
        {h.state === 'error' ? `Could not load token balance changes: ${h.reason}` : `Token balance changes are unavailable: ${h.reason}`}
        {' '}Your holding above is unaffected.
      </p>
    )
  }
  const events = h.value.events
  return (
    <>
      <p className="tdp-note">
        Recent balance changes for this token only — from the latest 20 transactions of this account, not complete history.
        What caused a change is not identified.
      </p>
      {events.length === 0 ? (
        <p className="tdp-note">No balance changes in the recent transactions.</p>
      ) : (
        <ul className="tdp-events">
          {events.map(e => {
            const label = e.change === 'increase' ? 'Balance increase'
              : e.change === 'decrease' ? 'Balance decrease' : 'Balance unchanged'
            const abs = e.netRawQuantity.replace(/^-/, '')
            const sign = e.change === 'increase' ? '+' : e.change === 'decrease' ? '−' : ''
            return (
              <li key={e.txHash}>
                <span className="tdp-event-label">{label}</span>
                <span className="tdp-mono">{sign}{formatUnits(abs, decimals)} {symbol}</span>
                <span className="tdp-event-meta">
                  {new Date(e.timestamp * 1000).toLocaleDateString()} · <span className="tdp-mono">{short(e.txHash, 8)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export function ProgrammableTokenSection({ token }: {
  token: { programmable?: Cip113ProgrammableDetails; decimals: number; symbol: string; balance: string }
}) {
  const [open, setOpen] = useState(false)
  const prog = token.programmable
  if (!prog) return null
  const { registry, protocol } = prog

  return (
    <section className="tdp-prog" aria-label="Programmable token details">
      <div className="tdp-section-title">Programmable token</div>
      <p className="tdp-note">
        Cardano mainnet · deployment {short(prog.deploymentId, 8)} · observed {when(prog.checkedAt)}.
        Balances and wiring below are read from the chain; token-specific rules are shown only when verified.
      </p>

      <dl className="tdp-facts tdp-facts--compact">
        <div><dt>Held</dt><dd className="tdp-mono">{token.balance} {token.symbol}</dd></div>
        <div>
          <dt>Available to send</dt>
          <dd>Unknown <span className="tdp-note-inline">— needs token-specific transfer checks; not zero</span></dd>
        </div>
      </dl>

      {!protocol.matchesPublishedWiring && (
        <p className="tdp-note tdp-note--warn" role="alert">
          The live protocol wiring differs from the published release. Treat this deployment's behaviour as unverified.
        </p>
      )}

      <div className="tdp-section-title tdp-sub-title">Rules and restrictions</div>
      <Restrictions prog={prog} />

      <button type="button" className="tdp-link" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? 'Hide' : 'Show'} on-chain references
      </button>
      {open && (
        <dl className="tdp-facts tdp-facts--compact tdp-refs">
          <div><dt>Registry policy</dt><dd className="tdp-mono tdp-wrap">{registry.policyId}</dd></div>
          <div><dt>Registry entry</dt><dd className="tdp-mono tdp-wrap">{registry.outputReference}</dd></div>
          <div><dt>Transfer hook</dt><dd className="tdp-mono tdp-wrap">{cred(registry.transfer)}</dd></div>
          <div><dt>Third-party hook</dt><dd className="tdp-mono tdp-wrap">{cred(registry.thirdParty)}</dd></div>
          <div><dt>Minting hook</dt><dd className="tdp-mono tdp-wrap">{cred(registry.minting)}</dd></div>
          <div><dt>Unfracking hook</dt><dd className="tdp-mono tdp-wrap">{cred(registry.unfracking)}</dd></div>
          <div><dt>Protocol parameters</dt><dd className="tdp-mono tdp-wrap">{protocol.outputReference}</dd></div>
          <div>
            <dt>Upgrade authority</dt>
            <dd className="tdp-mono tdp-wrap">{cred(protocol.upgradeAuthority)}</dd>
          </div>
          <div>
            <dt>Pending upgrade nomination</dt>
            <dd className="tdp-mono tdp-wrap">{protocol.pendingUpgradeAuthority ? cred(protocol.pendingUpgradeAuthority) : 'None'}</dd>
          </div>
          <div className="tdp-ref-note">
            Script hashes identify on-chain hooks, not what they do or who operates them. The upgrade authority
            can change protocol wiring; it is separate from the token's own transfer rules.
          </div>
        </dl>
      )}

      <div className="tdp-section-title tdp-sub-title">Token balance changes</div>
      <History prog={prog} decimals={token.decimals} symbol={token.symbol} />
    </section>
  )
}
