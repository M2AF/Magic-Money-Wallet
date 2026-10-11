import { useEffect, useState } from 'react'
import { onSovereignAccess, sovereignAccess, refreshSovereignAccess } from '../lib/sovereign-access'

export function SovereignAccessNote({ hideBalance = true }: { hideBalance?: boolean }) {
  const [access, setAccess] = useState(sovereignAccess)
  useEffect(() => {
    const off = onSovereignAccess(() => setAccess(sovereignAccess()))
    void refreshSovereignAccess()
    return off
  }, [])
  return <div className="sovereign-access-note" aria-live="polite">
    <span>{access.status === 'owned' ? hideBalance ? 'REDACTED ownership verified · Sovereign unlocked' : `${access.balance} REDACTED NFT${access.balance === '1' ? '' : 's'} · Sovereign unlocked`
      : access.status === 'error' ? 'Ownership check unavailable. Try again to unlock Sovereign.'
      : access.checking || access.status === 'checking' ? 'Checking REDACTED ownership…'
      : 'Own a REDACTED NFT on Robinhood Chain to unlock Sovereign.'}</span>
    <button type="button" onClick={() => { void refreshSovereignAccess() }} disabled={access.checking}>Recheck ownership</button>
  </div>
}
