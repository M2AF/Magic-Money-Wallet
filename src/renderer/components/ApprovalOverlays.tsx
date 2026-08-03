/**
 * ApprovalOverlays.tsx — dApp connect / transaction / signature approval UI
 *
 * Extracted from ExtApp.tsx so both approval hosts render the same overlays:
 *  - Extension: ExtApp (requests arrive via chrome.runtime messages)
 *  - Android:   CapApp (requests arrive via the in-process bus)
 * Pure presentation — each host owns the request state and the approve/reject
 * plumbing (the window.wallet web3Approve… / web3Reject… calls).
 */

export type ConnRequest = { id: string; origin: string }
export type TxApprovalRequest = { id: string; origin?: string; chainId?: string; from?: string; to?: string; value?: string; data?: string }
export type SignApprovalRequest = { id: string; origin: string; chain: string; method: string; summary: string; details?: string }

interface Props {
  connRequest: ConnRequest | null
  txRequest: TxApprovalRequest | null
  signRequest: SignApprovalRequest | null
  connAddress: string
  onApproveConnection(): void
  onRejectConnection(): void
  onApproveTx(): void
  onRejectTx(): void
  onApproveSign(): void
  onRejectSign(): void
}

export function ApprovalOverlays({
  connRequest, txRequest, signRequest, connAddress,
  onApproveConnection, onRejectConnection, onApproveTx, onRejectTx, onApproveSign, onRejectSign,
}: Props) {
  let hostname = ''
  try { hostname = connRequest ? new URL(connRequest.origin).hostname : '' } catch { hostname = connRequest?.origin ?? '' }
  let txHostname = ''
  try { txHostname = txRequest?.origin ? new URL(txRequest.origin).hostname : '' } catch { txHostname = txRequest?.origin ?? '' }
  let signHostname = ''
  try { signHostname = signRequest?.origin ? new URL(signRequest.origin).hostname : '' } catch { signHostname = signRequest?.origin ?? '' }

  // The decoded-transaction formatter appends its risk callouts as ⚠ lines.
  // Split them back out so they sit above the amounts rather than below them,
  // where they would be the first thing scrolled past.
  const signLines = (signRequest?.details ?? '').split('\n')
  const signWarnings = signLines.filter(l => l.startsWith('⚠')).map(l => l.slice(1).trim())
  const signDetails = signLines.filter(l => !l.startsWith('⚠')).join('\n').trimEnd()
  const txNativeValue = txRequest?.value ? formatWei(txRequest.value) : '0'

  return (
    <>
      {txRequest && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100000,
          background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: '#111', borderRadius: 20, padding: '26px 22px', width: '100%',
            maxWidth: 360, border: '1px solid #2a2a2a',
            display: 'flex', flexDirection: 'column', gap: 14
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>✍</div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Approve Transaction</div>
              <div style={{ color: '#888', fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ color: '#a78bfa', fontWeight: 600 }}>{txHostname || 'Connected site'}</span>
                {' '}wants to send a transaction
              </div>
            </div>

            <div style={detailBoxStyle}>
              <DetailRow label="Chain" value={txRequest.chainId ?? 'current'} />
              <DetailRow label="To" value={shorten(txRequest.to)} mono />
              <DetailRow label="Value" value={`${txNativeValue} native`} />
              {txRequest.data && txRequest.data !== '0x' && <DetailRow label="Data" value={`${txRequest.data.slice(0, 18)}…${txRequest.data.slice(-8)}`} mono />}
            </div>

            <div style={{ color: '#777', fontSize: 11, lineHeight: 1.55 }}>
              Only approve if you trust this site and recognize the transaction.
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={onRejectTx} style={{ ...rejectBtnStyle, flex: 1 }} type="button">Reject</button>
              <button onClick={onApproveTx} style={{ ...btnStyle, flex: 2, marginTop: 0 }} type="button">Approve</button>
            </div>
          </div>
        </div>
      )}

      {signRequest && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100001,
          background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: '#111', borderRadius: 20, padding: '26px 22px', width: '100%',
            maxWidth: 360, border: '1px solid #2a2a2a',
            display: 'flex', flexDirection: 'column', gap: 14
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, marginBottom: 8 }}>✎</div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Approve Signature</div>
              <div style={{ color: '#888', fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ color: '#a78bfa', fontWeight: 600 }}>{signHostname || 'Connected site'}</span>
                {' '}wants your signature
              </div>
            </div>

            {signWarnings.length > 0 && (
              <div style={warningBoxStyle}>
                {signWarnings.map((w, i) => <div key={i} style={{ marginTop: i ? 5 : 0 }}>{w}</div>)}
              </div>
            )}

            <div style={detailBoxStyle}>
              <DetailRow label="Chain" value={signRequest.chain} />
              <DetailRow label="Method" value={signRequest.method} mono />
              <DetailRow label="Request" value={signRequest.summary} />
            </div>

            {signDetails && (
              // pre-wrap, not a DetailRow: a decoded transaction summary is
              // line-oriented, and collapsing it into one paragraph is exactly
              // how a blind sign gets approved by accident.
              <div style={{ ...detailBoxStyle, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 11.5, color: '#ddd', lineHeight: 1.6, maxHeight: 240, overflowY: 'auto' }}>
                {signDetails}
              </div>
            )}

            <div style={{ color: '#777', fontSize: 11, lineHeight: 1.55 }}>
              Signatures can grant permissions or authorize off-chain actions. Approve only if you understand this request.
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={onRejectSign} style={{ ...rejectBtnStyle, flex: 1 }} type="button">Reject</button>
              <button onClick={onApproveSign} style={{ ...btnStyle, flex: 2, marginTop: 0 }} type="button">Sign</button>
            </div>
          </div>
        </div>
      )}

      {connRequest && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20
        }}>
          <div style={{
            background: '#111', borderRadius: 20, padding: '28px 24px', width: '100%',
            maxWidth: 340, border: '1px solid #2a2a2a',
            display: 'flex', flexDirection: 'column', gap: 16
          }}>
            {/* Header */}
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🌐</div>
              <div style={{ color: '#fff', fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Connect Wallet</div>
              <div style={{ color: '#888', fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ color: '#a78bfa', fontWeight: 600 }}>{hostname}</span>
                {' '}wants to see your wallet address
              </div>
            </div>

            {/* Address preview */}
            {connAddress && (
              <div style={{
                background: '#1a1a1a', borderRadius: 12, padding: '10px 14px',
                display: 'flex', alignItems: 'center', gap: 10, border: '1px solid #2a2a2a'
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
                <div>
                  <div style={{ color: '#666', fontSize: 10, marginBottom: 2 }}>YOUR ADDRESS</div>
                  <div style={{ color: '#fff', fontSize: 12, fontFamily: 'monospace' }}>
                    {connAddress.slice(0, 8)}…{connAddress.slice(-6)}
                  </div>
                </div>
              </div>
            )}

            {/* What this allows */}
            <div style={{ color: '#555', fontSize: 11, lineHeight: 1.6, padding: '0 2px' }}>
              This will allow the site to see your address. It cannot move funds without your approval on each transaction.
            </div>

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button onClick={onRejectConnection} style={{ ...rejectBtnStyle, flex: 1 }} type="button">
                Reject
              </button>
              <button onClick={onApproveConnection} style={{ ...btnStyle, flex: 2, marginTop: 0 }} type="button">
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function shorten(value?: string): string {
  if (!value) return '-'
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
}

function formatWei(value: string): string {
  try {
    const wei = BigInt(value)
    const whole = wei / 1_000_000_000_000_000_000n
    const frac = (wei % 1_000_000_000_000_000_000n).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '')
    return frac ? `${whole}.${frac}` : whole.toString()
  } catch {
    return value
  }
}

function DetailRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '72px 1fr', gap: 10, alignItems: 'start' }}>
      <div style={{ color: '#666', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      <div style={{ color: '#fff', fontSize: 12, fontFamily: mono ? 'monospace' : undefined, overflowWrap: 'anywhere' }}>{value}</div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  width: '100%', padding: '12px', borderRadius: 12,
  background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
  color: '#fff', fontWeight: 700, fontSize: 15,
  border: 'none', cursor: 'pointer', marginTop: 4
}

const rejectBtnStyle: React.CSSProperties = {
  padding: '12px', borderRadius: 12,
  background: 'transparent', color: '#888', fontWeight: 600, fontSize: 14,
  border: '1px solid #2a2a2a', cursor: 'pointer'
}

const warningBoxStyle: React.CSSProperties = {
  background: 'rgba(245,158,11,.12)',
  border: '1px solid rgba(245,158,11,.35)',
  borderRadius: 12,
  padding: '10px 12px',
  color: '#fcd34d',
  fontSize: 11.5,
  lineHeight: 1.45,
}

const detailBoxStyle: React.CSSProperties = {
  background: '#1a1a1a',
  borderRadius: 12,
  padding: '12px 14px',
  border: '1px solid #2a2a2a',
  display: 'flex',
  flexDirection: 'column',
  gap: 8
}
