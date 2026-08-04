/**
 * passkey-window.ts — runs a WebAuthn PRF ceremony for the Electron app.
 *
 * WHY A SEPARATE WINDOW: WebAuthn needs a secure origin whose host matches the
 * relying-party id. The packaged renderer is loaded from file:// (see index.ts),
 * which has neither, so navigator.credentials is unusable there. We therefore
 * serve a single page over http://localhost on an ephemeral port — a trustworthy
 * origin per the secure-context rules — and run the ceremony in that window.
 *
 * WHY NOT A HOSTED DOMAIN: an https rpId we control would isolate the credential
 * better (see the localhost caveat below), but it would put remotely-served
 * JavaScript directly in the wallet's seed-derivation path and make wallet
 * creation depend on a domain staying alive forever. Loopback keeps the whole
 * ceremony offline and inside the app.
 *
 * CAVEAT — rpId 'localhost' is a SHARED NAMESPACE: any other local application
 * serving a localhost page can ask for a credential under the same rpId. It
 * cannot do so silently (user verification is required and the OS prompts), but
 * a user who approves an unexpected Hello prompt from another app could hand
 * over the entropy behind this wallet. The seed phrase remains the recovery
 * path of record, and the passkey option is off by default, for this reason.
 *
 * The 32 bytes never touch the network: the page returns them over Electron IPC
 * from a preload, not by POSTing to the loopback server. The server only ever
 * serves static HTML/JS and is torn down as soon as the ceremony settles.
 */

import { BrowserWindow, ipcMain } from 'electron'
import { createServer, type Server } from 'http'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

/** rpId and origin host must match; 'localhost' is the only one we can serve. */
export const PASSKEY_RP_ID = 'localhost'
const PASSKEY_RP_NAME = 'MagicMoney Wallet'
/** A ceremony involves human interaction (and possibly a retry); be generous. */
const CEREMONY_TIMEOUT_MS = 3 * 60_000

export interface PasskeyCeremonyResult {
  /** base64 PRF output — 32 bytes of entropy. Never logged, never persisted. */
  prfB64: string
  credentialId: string
  transports: string[]
}

/**
 * Ask an existing passkey for its PRF output again — the operation that would
 * reproduce a wallet. Returns null when the platform refuses (Windows Hello
 * mints PRF at registration but will not evaluate it at assertion), which is a
 * legitimate answer, not an error.
 *
 * Kept OUT of the creation ceremony on purpose: it raises an OS failure dialog
 * on those platforms, and showing that mid-onboarding makes a wallet that was
 * created successfully look broken.
 */
export async function verifyPasskeyPrf(opts: {
  parent?: BrowserWindow
  credential: { id: string; transports: string[] }
}): Promise<string | null> {
  const result = await runCeremonyWindow({
    mode: 'verify',
    parent: opts.parent,
    credential: opts.credential,
    timeoutMs: CEREMONY_TIMEOUT_MS,
  }).catch(() => null)
  return (result as { prfB64?: string | null } | null)?.prfB64 ?? null
}

/**
 * Is the passkey option worth offering on this machine? Runs the ceremony page
 * hidden and asks it, WITHOUT any prompt (isUserVerifyingPlatformAuthenticator
 * + getClientCapabilities are both silent).
 *
 * Cached for the process lifetime and lazy: this only runs when the create
 * screen actually asks, never at app start. A probe that fires on every load
 * would spin a server and a window for a screen most sessions never see.
 */
let _supportedCache: Promise<boolean> | undefined
export function passkeyCeremonySupported(): Promise<boolean> {
  if (!_supportedCache) {
    _supportedCache = runCeremonyWindow({ mode: 'probe', hidden: true, timeoutMs: 15_000 })
      .then(r => !!(r as { supported?: boolean }).supported)
      .catch(() => false)
  }
  return _supportedCache
}

/** Bundled by `npm run build:inject` alongside the other injected scripts. */
function ceremonyScript(): string {
  return readFileSync(join(__dirname, '../inject/passkey-ceremony.js'), 'utf8')
}

function ceremonyHtml(nonce: string): string {
  // Inline script + a strict CSP that permits only this exact script: the page
  // is served over plain http on loopback, so we do not want anything else able
  // to run in the origin that holds the wallet's entropy.
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'none'; img-src 'none'">
<title>Create with passkey</title>
<style>
  html,body{margin:0;height:100%;overflow:hidden}
  body{background:#0b0b0f;color:#e8e8ef;font:14px/1.5 system-ui,sans-serif;
       display:flex;align-items:center;justify-content:center;padding:28px;text-align:center}
  .box{max-width:340px}
  h1{font-size:17px;margin:0 0 10px}
  p{color:#9aa3b2;margin:0 0 18px}
  #status{font-size:13px;color:#7dd3fc;min-height:20px}
  .err{color:#f87171 !important}
</style></head>
<body><div class="box">
  <h1>Confirm with your passkey</h1>
  <p id="lede">Your device will ask you to verify. This creates the passkey your wallet is generated from.</p>
  <div id="status">Starting…</div>
</div>
<script nonce="${nonce}">${ceremonyScript()}</script>
</body></html>`
}

/**
 * Open the ceremony window and resolve with the PRF entropy.
 *
 * Rejects when the user dismisses the prompt, when the platform has no PRF, or
 * when the window is closed. Always tears down the server and the window.
 */
export async function runPasskeyCeremony(opts: {
  parent?: BrowserWindow
  userName: string
}): Promise<PasskeyCeremonyResult> {
  const result = await runCeremonyWindow({
    mode: 'create',
    parent: opts.parent,
    userName: opts.userName,
    timeoutMs: CEREMONY_TIMEOUT_MS,
  })
  return result as PasskeyCeremonyResult
}

/**
 * Shared plumbing for both modes: serve the page on loopback, run it in a
 * window, take one IPC result, tear everything down. `probe` runs hidden and
 * silent; `create` is the interactive ceremony.
 */
function runCeremonyWindow(opts: {
  mode: 'probe' | 'create' | 'verify'
  parent?: BrowserWindow
  userName?: string
  credential?: { id: string; transports: string[] }
  hidden?: boolean
  timeoutMs: number
}): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const channel = `passkey:result:${randomUUID()}`
    let server: Server | undefined
    let win: BrowserWindow | undefined
    let settled = false
    let timer: NodeJS.Timeout | undefined

    const cleanup = () => {
      if (timer) clearTimeout(timer)
      ipcMain.removeAllListeners(channel)
      server?.close()
      server = undefined
      if (win && !win.isDestroyed()) win.destroy()
      win = undefined
    }
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      cleanup()
      fn()
    }
    const fail = (message: string) => settle(() => reject(new Error(message)))

    ipcMain.on(channel, (_event, payload: { ok: boolean; result?: unknown; error?: string }) => {
      if (payload?.ok && payload.result) settle(() => resolve(payload.result))
      else fail(payload?.error || 'Passkey setup did not complete')
    })

    const nonce = Buffer.from(randomUUID()).toString('base64')
    const html = ceremonyHtml(nonce)

    server = createServer((req, res) => {
      // Single-purpose server: one document, nothing else, no other paths.
      if (req.url !== '/' && req.url !== '/index.html') { res.writeHead(404); res.end(); return }
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(html)
    })
    server.on('error', e => fail(`Could not start the passkey helper: ${String(e)}`))

    // Bind to loopback only — never 0.0.0.0 — on an OS-assigned port.
    server.listen(0, '127.0.0.1', () => {
      const address = server?.address()
      if (!address || typeof address === 'string') { fail('Passkey helper failed to bind'); return }

      win = new BrowserWindow({
        width: 420,
        height: 300,
        show: !opts.hidden,
        parent: opts.parent,
        modal: !opts.hidden && !!opts.parent,
        resizable: false,
        minimizable: false,
        maximizable: false,
        title: 'Create with passkey',
        autoHideMenuBar: true,
        backgroundColor: '#0b0b0f',
        webPreferences: {
          // Built by build:inject into out/inject (see package.json) — the same
          // place approval-preload.js lives, not the electron-vite preload dir.
          preload: join(__dirname, '../inject/passkey-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          // Nothing else may be loaded into the origin holding the entropy.
          webSecurity: true,
        },
      })

      // A hidden probe window is destroyed by cleanup(), which runs before the
      // promise settles, so only a user-closed visible window is a cancellation.
      if (!opts.hidden) win.on('closed', () => fail('Passkey setup was cancelled'))
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      // Pin the window to its own page; no navigation away from the origin.
      win.webContents.on('will-navigate', e => e.preventDefault())

      // The hostname must literally be "localhost" to match rpId 'localhost';
      // 127.0.0.1 is a different host for relying-party purposes.
      const url = `http://localhost:${address.port}/`
      win.webContents.once('did-finish-load', () => {
        win?.webContents.send('passkey:start', {
          channel,
          mode: opts.mode,
          rpId: PASSKEY_RP_ID,
          rpName: PASSKEY_RP_NAME,
          userName: opts.userName ?? 'MagicMoney wallet',
          credential: opts.credential,
        })
      })
      win.loadURL(url).catch(e => fail(`Passkey helper failed to load: ${String(e)}`))

      timer = setTimeout(() => fail('Passkey setup timed out'), opts.timeoutMs)
    })
  })
}
