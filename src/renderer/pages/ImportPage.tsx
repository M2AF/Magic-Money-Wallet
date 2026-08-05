import { useState, useRef, useEffect } from 'react'
import type { AppPage, WalletAddresses } from '../types/wallet'

interface Props {
  onNavigate: (page: AppPage) => void
  onComplete: (addresses: WalletAddresses) => void
}

export function ImportPage({ onNavigate, onComplete }: Props) {
  const [wordCount, setWordCount] = useState<12 | 24>(12)
  const [words, setWords]         = useState<string[]>(Array(12).fill(''))
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])
  // Passkey recovery — the counterpart of "Generate with Passkey".
  const [passkeyOffered, setPasskeyOffered] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)

  // Prompt-free capability check. `fn?.()` alone would NOT guard an absent
  // method — optional chaining stops at the call, so `.then` would throw.
  useEffect(() => {
    const probe = window.wallet?.passkeySupported
    if (typeof probe !== 'function' || !window.wallet.importWithPasskey) return
    let cancelled = false
    Promise.resolve(probe.call(window.wallet))
      .then(ok => { if (!cancelled) setPasskeyOffered(!!ok) })
      .catch(() => { /* option stays hidden */ })
    return () => { cancelled = true }
  }, [])

  // Uses the SAME 12/24 selector as the typed import above: the same passkey
  // yields a different wallet at each length, so the user must pick the one they
  // created with. If the addresses look wrong, they flip it and retry.
  const importWithPasskey = async () => {
    if (!window.wallet.importWithPasskey) return
    setPasskeyBusy(true)
    setError(null)
    try {
      onComplete(await window.wallet.importWithPasskey(wordCount))
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setPasskeyBusy(false)
    }
  }

  // Android: block screenshots/recents preview while the seed is on screen.
  useEffect(() => {
    window.wallet.setSecureScreen?.(true)
    return () => { window.wallet.setSecureScreen?.(false) }
  }, [])

  const setWord = (i: number, val: string) => {
    // Handle paste of full phrase
    if (val.includes(' ')) {
      const pasted = val.trim().split(/\s+/)
      if (pasted.length >= 12) {
        const count = pasted.length >= 24 ? 24 : 12
        setWordCount(count as 12 | 24)
        const filled = [...pasted.slice(0, count), ...Array(count).fill('')].slice(0, count)
        setWords(filled)
        setTimeout(() => inputRefs.current[count - 1]?.focus(), 0)
        return
      }
    }
    const updated = [...words]
    updated[i] = val.toLowerCase().trim()
    setWords(updated)
  }

  const handleWordCountChange = (count: 12 | 24) => {
    setWordCount(count)
    setWords(prev => count === 24
      ? [...prev, ...Array(12).fill('')].slice(0, 24)
      : prev.slice(0, 12)
    )
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Tab') {
      e.preventDefault()
      inputRefs.current[i + 1]?.focus()
    }
  }

  const handleImport = async () => {
    const phrase = words.slice(0, wordCount).join(' ').trim()
    if (words.slice(0, wordCount).some(w => !w)) {
      setError('Please fill in all words.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const addresses = await window.wallet.import(phrase)
      onComplete(addresses)
    } catch (err) {
      setError(String(err).replace('Error: ', ''))
      setLoading(false)
    }
  }

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
        <h1 className="page-title">Import Wallet</h1>
        <p className="page-subtitle">Enter your BIP-39 seed phrase. You can also paste the full phrase into word 1.</p>
      </div>

      {/* Word count toggle */}
      <div style={{ display: 'flex', gap: 8 }}>
        {([12, 24] as const).map(n => (
          <button
            key={n}
            onClick={() => handleWordCountChange(n)}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${wordCount === n ? 'var(--border-active)' : 'var(--border)'}`,
              background: wordCount === n ? 'var(--accent-dim)' : 'transparent',
              color: wordCount === n ? 'var(--accent-text)' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', transition: 'all var(--transition)'
            }}
          >{n} words</button>
        ))}
      </div>

      {/* Word grid */}
      <div className="import-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {Array.from({ length: wordCount }).map((_, i) => (
          <div key={i} className="import-word-wrapper">
            <span className="import-word-num">{i + 1}</span>
            <input
              ref={el => { inputRefs.current[i] = el }}
              className="import-word-input"
              type="text"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={words[i] ?? ''}
              placeholder={`word ${i + 1}`}
              onChange={e => setWord(i, e.target.value)}
              onKeyDown={e => handleKeyDown(i, e)}
            />
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius-md)', fontSize: 12, color: 'var(--error)' }}>
          {error}
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={handleImport}
        disabled={loading}
      >
        {loading ? (
          <>
            <div style={{ width: 14, height: 14, border: '2px solid rgba(0,0,0,0.3)', borderTop: '2px solid #000', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            Importing wallet…
          </>
        ) : 'Import Wallet'}
      </button>

      {/* Passkey recovery. Only shown where the platform can run WebAuthn — and
          note that even there the assertion may refuse to release the key
          (Windows Hello does), which the handler reports as "this device can't
          read your passkey" rather than blaming the passkey. */}
      {passkeyOffered && (
        <>
          <div style={{ position: 'relative', textAlign: 'center', margin: '2px 0' }}>
            <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, height: 1, background: 'var(--border)', transform: 'translateY(-50%)' }} />
            <span style={{ position: 'relative', background: 'var(--bg-dark)', padding: '0 10px', fontSize: 11, color: 'var(--text-muted)' }}>or</span>
          </div>
          <button
            className="btn btn-ghost"
            onClick={importWithPasskey}
            disabled={passkeyBusy || loading}
            style={{
              background: 'linear-gradient(135deg, rgba(0,170,255,0.12) 0%, rgba(56,189,248,0.12) 100%)',
              border: '1px solid rgba(0,170,255,0.35)',
              color: '#7dd3fc'
            }}
          >
            {passkeyBusy ? (
              <>
                <div className="spinner" style={{ width: 14, height: 14 }} />
                Waiting for your device…
              </>
            ) : (
              <>
                <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" viewBox="0 0 24 24">
                  <circle cx="10" cy="8" r="4"/>
                  <path d="M10.3 14H7a4 4 0 0 0-4 4v2"/>
                  <circle cx="17" cy="15" r="2.5"/>
                  <path d="M17 17.5V21l1.5-1.5"/>
                </svg>
                Import with Passkey
              </>
            )}
          </button>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5, marginTop: -4 }}>
            Uses the {wordCount}-word setting above — pick the length you created the wallet with.
          </p>
        </>
      )}
    </div>
  )
}
