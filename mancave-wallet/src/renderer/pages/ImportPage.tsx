import { useState, useRef } from 'react'
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
    </div>
  )
}
