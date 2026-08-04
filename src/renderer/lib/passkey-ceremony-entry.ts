/**
 * passkey-ceremony-entry.ts — the script that runs inside the Electron loopback
 * ceremony window (main/passkey-window.ts serves it inline).
 *
 * Bundled standalone by `npm run build:inject` into out/inject/passkey-ceremony.js
 * because it executes in a plain page, not in the app's renderer bundle.
 *
 * Its whole job: run the shared ceremony, check whether the passkey can
 * reproduce its own output on this device, and hand both back over IPC.
 */
import {
  createPasskeyPrf,
  getPasskeyPrf,
  isPasskeySupported,
  PasskeyPrfError,
} from './passkey-prf'

interface StartOptions {
  channel: string
  /**
   * 'probe'  — silent capability check, no prompt.
   * 'create' — the ceremony that generates the wallet.
   * 'verify' — re-ask an existing passkey for its PRF, to find out whether it
   *            can reproduce the wallet. Deliberately a SEPARATE, user-initiated
   *            mode: on stacks that mint PRF at registration but refuse it at
   *            assertion (Windows Hello, measured), this shows an OS error
   *            dialog, which must never appear in the middle of onboarding.
   */
  mode: 'probe' | 'create' | 'verify'
  rpId: string
  rpName: string
  userName: string
  credential?: { id: string; transports: string[] }
}

declare global {
  interface Window {
    mmPasskey?: {
      onStart(fn: (opts: StartOptions) => void): void
      report(channel: string, payload: unknown): void
    }
  }
}

function setStatus(text: string, isError = false): void {
  const el = document.getElementById('status')
  if (!el) return
  el.textContent = text
  el.classList.toggle('err', isError)
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

window.mmPasskey?.onStart(async opts => {
  const bridge = window.mmPasskey!

  // Capability probe: no ceremony, no prompt, window stays hidden.
  if (opts.mode === 'probe') {
    bridge.report(opts.channel, { ok: true, result: { supported: await isPasskeySupported() } })
    return
  }

  // Verification: user-initiated, and expected to fail on some platforms. The
  // caller compares the returned bytes; a failure here is a supported answer
  // ("no, this passkey can't reproduce the wallet"), not an error to surface.
  if (opts.mode === 'verify') {
    const lede = document.getElementById('lede')
    if (lede) {
      lede.textContent =
        'Checking whether this passkey can rebuild your wallet. If your device reports a problem, that is a normal answer here — your wallet is already created and unaffected.'
    }
    try {
      setStatus('Asking your passkey for the same key…')
      const prf = await getPasskeyPrf({ rpId: opts.rpId, credential: opts.credential })
      bridge.report(opts.channel, { ok: true, result: { prfB64: toBase64(prf) } })
    } catch {
      bridge.report(opts.channel, { ok: true, result: { prfB64: null } })
    }
    return
  }

  try {
    setStatus('Waiting for your device…')
    const { prf, credential } = await createPasskeyPrf({
      rpId: opts.rpId,
      rpName: opts.rpName,
      userName: opts.userName,
      userDisplayName: opts.userName,
    })

    // NOTE: we deliberately do NOT verify reproducibility here. That needs a
    // second assertion, which on Windows Hello raises an OS error dialog — a
    // confusing failure in the middle of a flow that has already succeeded.
    // The wallet exists at this point; verification is offered separately.
    setStatus('Done.')
    bridge.report(opts.channel, {
      ok: true,
      result: {
        prfB64: toBase64(prf),
        credentialId: credential.id,
        transports: credential.transports,
      },
    })
  } catch (e) {
    const err = e as PasskeyPrfError
    const message = err?.code === 'CANCELLED'
      ? 'Passkey setup was cancelled.'
      : err?.code === 'PRF_UNAVAILABLE'
        ? 'This device’s passkeys can’t generate wallet keys. Create a wallet the normal way instead.'
        : err?.message || 'Passkey setup failed.'
    setStatus(message, true)
    // Leave the message on screen briefly so it isn't a window that just blinks.
    setTimeout(() => bridge.report(opts.channel, { ok: false, error: message }), 1200)
  }
})
