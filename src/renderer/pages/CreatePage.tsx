import { useState, useEffect } from 'react'
import type { AppPage, WalletAddresses } from '../types/wallet'

interface Props {
  onNavigate: (page: AppPage) => void
  onComplete: (addresses: WalletAddresses) => void
}

export function CreatePage({ onNavigate }: Props) {
  const [words, setWords] = useState<string[]>([])
  const [blurred, setBlurred] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    window.wallet.generate().then(w => {
      if (cancelled) return
      setWords(w)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(String(e?.message ?? e))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [retryKey])

  // Android: block screenshots/recents preview while the seed is on screen.
  useEffect(() => {
    window.wallet.setSecureScreen?.(true)
    return () => { window.wallet.setSecureScreen?.(false) }
  }, [])

  return (
    <div className="page fade-in" style={{ gap: 20 }}>
      <div>
        <button
          onClick={() => onNavigate('welcome')}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, padding: 0, marginBottom: 16 }}
        >
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
        <h1 className="page-title">Your Seed Phrase</h1>
        <p className="page-subtitle">Write these 12 words down in order and store them somewhere safe. This is the only way to recover your wallet.</p>
      </div>

      {/* Warning */}
      <div className="warning-box">
        <span className="warning-icon">⚠️</span>
        <span>Never share your seed phrase. Anyone with these words has full access to your funds.</span>
      </div>

      {/* Seed grid */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div className="spinner" />
        </div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: '24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Couldn't generate your seed phrase: {error}
          </p>
          <button
            className="btn"
            type="button"
            onClick={() => setRetryKey(k => k + 1)}
            style={{ alignSelf: 'center' }}
          >
            Try Again
          </button>
        </div>
      ) : (
        <div>
          <div className={`seed-grid${blurred ? ' blurred' : ''}`}>
            {words.map((word, i) => (
              <div key={i} className="seed-word">
                <span className="seed-word-num">{i + 1}</span>
                <span className="seed-word-text">{word}</span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setBlurred(b => !b)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, marginTop: 10, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              {blurred
                ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
              }
            </svg>
            {blurred ? 'Reveal phrase' : 'Hide phrase'}
          </button>
        </div>
      )}

      <button
        className="btn btn-primary"
        disabled={loading || blurred}
        onClick={() => onNavigate('confirm')}
      >
        I've Written It Down — Continue
      </button>

      {blurred && !loading && (
        <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
          Reveal your phrase first, then confirm you've saved it.
        </p>
      )}
    </div>
  )
}
