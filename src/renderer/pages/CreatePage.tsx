import { useState, useEffect } from 'react'
import type { AppPage, WalletAddresses } from '../types/wallet'
import { copySeedPhrase, SEED_CLIPBOARD_TTL_MS } from '../lib/copy-seed'

interface Props {
  onNavigate: (page: AppPage) => void
  onComplete: (addresses: WalletAddresses) => void
  /** Chosen seed length — owned by App so ConfirmPage can name it too. */
  wordCount: 12 | 24
  onWordCountChange: (count: 12 | 24) => void
}

export function CreatePage({ onNavigate, wordCount, onWordCountChange }: Props) {
  const [words, setWords] = useState<string[]>([])
  const [blurred, setBlurred] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retryKey, setRetryKey] = useState(0)
  // Passkey path (optional, never the default). `source` tracks which entropy
  // produced the phrase on screen; `reproducible` is what the device told us
  // about re-deriving it, and is shown rather than acted on.
  const [passkeyOffered, setPasskeyOffered] = useState(false)
  const [source, setSource] = useState<'random' | 'passkey'>('random')
  // null = not checked. Checking costs another device prompt and fails loudly
  // on some platforms, so it is opt-in rather than part of creation.
  const [reproducible, setReproducible] = useState<boolean | null>(null)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyPhrase = async () => {
    if (!words.length) return
    if (await copySeedPhrase(words)) {
      setCopied(true)
      setTimeout(() => setCopied(false), SEED_CLIPBOARD_TTL_MS)
    }
  }

  // Capability check runs once, only on this screen, and shows no prompt.
  useEffect(() => {
    let cancelled = false
    window.wallet.passkeySupported?.()
      .then(ok => { if (!cancelled) setPasskeyOffered(!!ok) })
      .catch(() => { /* option stays hidden */ })
    return () => { cancelled = true }
  }, [])

  const createWithPasskey = async () => {
    if (!window.wallet.generateWithPasskey) return
    setPasskeyBusy(true)
    setError('')
    try {
      const res = await window.wallet.generateWithPasskey(wordCount)
      setWords(res.words)
      setSource('passkey')
      setReproducible(null)
      setCopied(false)
      setBlurred(true)
      setLoading(false)
    } catch (e) {
      setError(String((e as Error)?.message ?? e))
    } finally {
      setPasskeyBusy(false)
    }
  }

  // Opt-in. Prompts the device again and, on platforms that refuse PRF at
  // assertion, shows an OS error the user must dismiss — which is why this is
  // never run automatically. Either answer is harmless: the wallet already exists.
  const checkReproducible = async () => {
    if (!window.wallet.passkeyVerify) return
    setChecking(true)
    try {
      setReproducible(await window.wallet.passkeyVerify())
    } catch {
      setReproducible(false)
    } finally {
      setChecking(false)
    }
  }

  // Re-runs when the user flips 12 ⇄ 24: a new phrase of that length replaces
  // the pending one in the main process, so nothing half-generated can be saved.
  // Flipping the length after a passkey run falls back to a random phrase rather
  // than silently re-prompting the device; the user can pick the passkey again.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setBlurred(true)
    setSource('random')
    setReproducible(null)
    // The phrase on screen is about to change; any earlier copy is now stale.
    // The scheduled clipboard clear is deliberately left running.
    setCopied(false)
    window.wallet.generate(wordCount).then(w => {
      if (cancelled) return
      setWords(w)
      setLoading(false)
    }).catch(e => {
      if (cancelled) return
      setError(String(e?.message ?? e))
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [retryKey, wordCount])

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
        <p className="page-subtitle">Write these {wordCount} words down in order and store them somewhere safe. This is the only way to recover your wallet.</p>
      </div>

      {/* Word count toggle — mirrors the one on the import screen. 24 words is
          256-bit entropy instead of 128; both are standard BIP-39. */}
      <div style={{ display: 'flex', gap: 8 }}>
        {([12, 24] as const).map(n => (
          <button
            key={n}
            onClick={() => onWordCountChange(n)}
            disabled={loading}
            style={{
              flex: 1, padding: '8px 0', borderRadius: 'var(--radius-sm)',
              border: `1px solid ${wordCount === n ? 'var(--border-active)' : 'var(--border)'}`,
              background: wordCount === n ? 'var(--accent-dim)' : 'transparent',
              color: wordCount === n ? 'var(--accent-text)' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 500, cursor: loading ? 'default' : 'pointer',
              opacity: loading ? 0.6 : 1, transition: 'all var(--transition)'
            }}
          >{n} words</button>
        ))}
      </div>

      {/* Optional passkey path. Hidden unless the platform can actually do it,
          and never the default — the phrase above is already a valid wallet. */}
      {passkeyOffered && source === 'random' && (
        <button
          type="button"
          onClick={createWithPasskey}
          disabled={passkeyBusy || loading}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '10px 0', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)', background: 'transparent',
            color: 'var(--text-muted)', fontSize: 12, fontWeight: 500,
            cursor: passkeyBusy || loading ? 'default' : 'pointer',
            opacity: passkeyBusy || loading ? 0.6 : 1,
            transition: 'all var(--transition)',
          }}
        >
          {passkeyBusy ? (
            <>
              <div className="spinner" style={{ width: 14, height: 14 }} />
              Waiting for your device…
            </>
          ) : (
            <>
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                <circle cx="10" cy="8" r="4"/>
                <path d="M10.3 14H7a4 4 0 0 0-4 4v2"/>
                <circle cx="17" cy="15" r="2.5"/>
                <path d="M17 17.5V21l1.5-1.5"/>
              </svg>
              Generate from a passkey instead
            </>
          )}
        </button>
      )}

      {source === 'passkey' && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
          <strong style={{ fontSize: 13 }}>Generated from your passkey</strong>
          <span style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {reproducible === true
              ? 'Confirmed: this passkey can re-create the same wallet. Still write the words down — losing the passkey without them means losing access.'
              : reproducible === false
                ? 'This device can’t re-create the wallet from the passkey, so these words are your only way back in. Your wallet is fine — write them down.'
                : 'Your wallet was created from this passkey. Write the words down: they are what restores it.'}
          </span>
          {reproducible === null && (
            <button
              type="button"
              onClick={checkReproducible}
              disabled={checking}
              style={{
                alignSelf: 'flex-start', background: 'none', border: 'none', padding: 0,
                color: 'var(--accent-text)', fontSize: 11,
                cursor: checking ? 'default' : 'pointer', opacity: checking ? 0.6 : 1,
              }}
            >
              {checking ? 'Checking…' : 'Can this passkey restore my wallet? Check (asks again)'}
            </button>
          )}
        </div>
      )}

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => setBlurred(b => !b)}
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              {blurred
                ? <><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>
                : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
              }
            </svg>
            {blurred ? 'Reveal phrase' : 'Hide phrase'}
          </button>

          <button
            onClick={copyPhrase}
            style={{ background: 'none', border: 'none', color: copied ? 'var(--accent-text)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              {copied
                ? <path d="M20 6L9 17l-5-5"/>
                : <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>
              }
            </svg>
            {copied ? 'Copied — clears in 90s' : `Copy all ${wordCount} words`}
          </button>
          </div>

          {copied && (
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
              Paste it somewhere safe now — a password manager, not a chat or notes app.
              Other programs can read your clipboard, so it’s cleared automatically.
            </p>
          )}
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
