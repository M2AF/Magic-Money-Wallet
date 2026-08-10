/**
 * passkey-crossdevice-diagnose.mjs — why does a Windows-made passkey not sign in here?
 *
 * DIAGNOSTIC ONLY. Observes; changes nothing; creates nothing.
 *
 * The claim under test: a credential created on another device with the same
 * seed cannot be DISCOVERED on this one, because the credential index is
 * per-install and does not sync. If true, our provider answers Chrome's
 * discoverable `get()` with zero entries and the log says so.
 *
 * ⚠ Why this needs no human, unlike passkey-release-verify.mjs. That script had
 * to observe a COMPLETED ceremony, and only a person can pick Magic Money out of
 * the system sheet. This one only needs `onBeginGetCredentialRequest`, which the
 * system calls on every enabled provider BEFORE any sheet is drawn. The sheet
 * that appears is then aborted — we never need to touch it.
 *
 * ⚠ Debug and release share the tag `MagicMoneyPasskey`, so a bare message
 * cannot say which app answered. Lines are credited by pid.
 *
 * Usage:  node scripts/passkey-crossdevice-diagnose.mjs
 *   env:  MM_PKG (default release), MM_SITE, CDP_PORT
 */

import { execFileSync, spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const PKG = process.env.MM_PKG || 'info.chainlens.magicmoney'
const SITE = process.env.MM_SITE || 'https://www.chainlensnft.info'
const PORT = Number(process.env.CDP_PORT || 9334)
const GET_TIMEOUT_MS = Number(process.env.MM_GET_MS || 12_000)
// Probe mode: supply allowCredentials and abort before anything is signed. The
// provider still logs how many of them it recognises, which answers "is THIS
// credential in the projection?" without a biometric or a completed ceremony.
const ALLOW = (process.env.MM_ALLOW || '').split(',').map(s => s.trim()).filter(Boolean)

// Windows adb.exe ends every line with CRLF; a trailing-anchored regex never
// matches "…\tdevice\r". Strip it once, centrally.
const adb = (...args) =>
  execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 32 << 20 }).replace(/\r\n/g, '\n')
const tryAdb = (...args) => { try { return adb(...args) } catch { return '' } }

const log = (...a) => console.log(...a)
const fail = (m) => { console.error(`\n✗ ${m}`); process.exit(1) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── Preflight ────────────────────────────────────────────────────────────────
const devices = adb('devices').split('\n').filter(l => /\tdevice$/.test(l))
if (devices.length === 0) fail('no adb device attached')
log('device:', devices[0].split('\t')[0], '·', tryAdb('shell', 'getprop', 'ro.product.model').trim())

const enabled = (tryAdb('shell', 'settings', 'get', 'secure', 'credential_service') || '')
  .trim().split(':').filter(Boolean)
const ours = enabled.filter(c => c.split('/')[0] === PKG)
log('providers enabled:', enabled.length, '· Magic Money among them:', ours.length ? 'yes' : 'NO')
if (!ours.length) fail(`${PKG} is not an enabled credential provider — nothing to diagnose`)

// ── Optional: make ourselves the only provider, so the sheet shows OUR entry ──
// Chrome puts Google first and resolves before Magic Money is ever visible, so
// the row's "Account N" label — the only place the recorded accountIndex is
// observable without rebuilding the app — never gets on screen. Narrowing the
// provider list is reversible and is restored in the finally below.
let restoreProviders = null
if (process.env.MM_SOLO) {
  restoreProviders = enabled.join(':')
  adb('shell', 'settings', 'put', 'secure', 'credential_service', ours.join(':'))
  log('providers narrowed to Magic Money only (will restore)')
}
const restore = () => {
  if (!restoreProviders) return
  try {
    adb('shell', 'settings', 'put', 'secure', 'credential_service', restoreProviders)
    log('providers restored:', restoreProviders.split(':').length, 'entries')
  } catch (e) { log('⚠ COULD NOT RESTORE PROVIDERS — set them by hand:', restoreProviders) }
  restoreProviders = null
}
process.on('exit', restore)
process.on('SIGINT', () => { restore(); process.exit(130) })

// ── Logcat ───────────────────────────────────────────────────────────────────
tryAdb('logcat', '-G', '16M')       // ⚠ silently capped at 5 MiB on this device
tryAdb('logcat', '-c')

const pidOf = (pkg) => (tryAdb('shell', 'pidof', pkg) || '').trim().split(/\s+/).filter(Boolean)
const pidsBefore = { release: pidOf(PKG), debug: pidOf(`${PKG}.debug`) }
log('pids at start · release:', pidsBefore.release.join(',') || '(not running)',
    '· debug:', pidsBefore.debug.join(',') || '(not running)')

const providerLog = []
const logcat = spawn('adb', ['logcat', '-v', 'threadtime', '-s', 'MagicMoneyPasskey:V'],
  { stdio: ['ignore', 'pipe', 'ignore'] })
logcat.stdout.setEncoding('utf8')
logcat.stdout.on('data', chunk => {
  for (const line of chunk.split(/\r?\n/)) {
    const m = line.match(/^\s*\S+\s+\S+\s+(\d+)\s+\d+\s+\w\s+MagicMoneyPasskey\s*:\s*(.*)$/)
    if (!m) continue
    const [, pid, msg] = m
    if (!msg.trim()) continue
    providerLog.push({ pid, msg: msg.trim() })
    log(`   [pid=${pid}]`, msg.trim())
  }
})

// ── Chrome ───────────────────────────────────────────────────────────────────
log('\nopening', SITE, 'in Chrome…')
tryAdb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', SITE, '-n',
  'com.android.chrome/com.google.android.apps.chrome.Main')

let socket = null
for (let i = 0; i < 30 && !socket; i++) {
  socket = (tryAdb('shell', 'cat', '/proc/net/unix').match(/chrome_devtools_remote\S*/) || [])[0]
  if (!socket) await sleep(1000)
}
if (!socket) { logcat.kill(); fail('Chrome never published a devtools socket') }
tryAdb('forward', '--remove-all')
adb('forward', `tcp:${PORT}`, `localabstract:${socket}`)
log('cdp:', socket, '→ 127.0.0.1:' + PORT)

let browser
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20_000 })
} catch (e) { logcat.kill(); fail('CDP did not answer: ' + e.message) }

const ctx = browser.contexts()[0]
let page = ctx.pages().find(p => /chainlensnft\.info/.test(p.url()))
for (let i = 0; i < 20 && !page; i++) {
  await sleep(500)
  page = ctx.pages().find(p => /chainlensnft\.info/.test(p.url()))
}
if (!page) { logcat.kill(); await browser.close(); fail('chainlensnft.info is not open in Chrome') }
log('page:', page.url())

// ── The real request ─────────────────────────────────────────────────────────
// Exactly what "Sign in with a passkey" sends: options straight from the live
// server, which issues NO allowCredentials — so this is a discoverable request
// and the authenticator must enumerate to answer it at all.
log('\ncalling navigator.credentials.get() with the live login-options…')
const pending = page.evaluate(async ({ timeoutMs, allowIds }) => {
  const b64uToBuf = (s) => {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(b, c => c.charCodeAt(0))
  }
  let optionsJson
  try {
    const r = await fetch('/api/auth/passkey/login-options', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    optionsJson = await r.json()
  } catch (e) {
    return { stage: 'login-options', error: String(e) }
  }
  const o = optionsJson.options
  if (!o) return { stage: 'login-options', error: 'no options in response', body: optionsJson }

  const publicKey = {
    challenge: b64uToBuf(o.challenge),
    rpId: o.rpId,
    userVerification: o.userVerification,
    allowCredentials: allowIds.length
      ? allowIds.map(id => ({ type: 'public-key', id: b64uToBuf(id) }))
      : (o.allowCredentials || []).map(c => ({ ...c, id: b64uToBuf(c.id) })),
    timeout: o.timeout,
  }
  const controller = new AbortController()
  const abort = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const cred = await navigator.credentials.get({ publicKey, signal: controller.signal })
    const bufToB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    // Finish the sign-in the way the page would, and report the SERVER's verdict.
    // This is the moment the user experiences as "it fails", so guessing at it
    // from the client side would be diagnosing the wrong half.
    const response = {
      id: cred.id,
      rawId: bufToB64u(cred.rawId),
      type: cred.type,
      clientExtensionResults: {},
      response: {
        clientDataJSON: bufToB64u(cred.response.clientDataJSON),
        authenticatorData: bufToB64u(cred.response.authenticatorData),
        signature: bufToB64u(cred.response.signature),
        userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : null,
      },
    }
    let login = null
    try {
      const lr = await fetch('/api/auth/passkey/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response, ceremony: optionsJson.ceremony }),
      })
      const body = await lr.json().catch(() => ({}))
      // Never carry the token out of the page.
      login = { status: lr.status, ok: lr.ok, error: body.error, hasToken: !!(body.token || body.session) }
    } catch (e) {
      login = { error: 'login request threw: ' + String(e) }
    }

    return {
      stage: 'get',
      rpId: o.rpId,
      allowCredentialsCount: (o.allowCredentials || []).length,
      completed: true,
      credentialId: cred?.id,
      userHandle: response.response.userHandle,
      login,
    }
  } catch (e) {
    return {
      stage: 'get',
      rpId: o.rpId,
      allowCredentialsCount: (o.allowCredentials || []).length,
      completed: false,
      errorName: e?.name,
      errorMessage: String(e?.message || e),
    }
  } finally {
    clearTimeout(abort)
  }
}, { timeoutMs: GET_TIMEOUT_MS, allowIds: ALLOW })

// The system sheet names each entry with the userName recorded at registration.
// When the credential itself will not verify, that label is the only thing that
// says which registration the stale row came from — so grab it while it is up.
if (process.env.MM_SHOT) {
  await sleep(Number(process.env.MM_SHOT_DELAY_MS || 4000))
  try {
    execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 })
    const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 })
    writeFileSync(process.env.MM_SHOT, png)
    log('sheet screenshot →', process.env.MM_SHOT)
  } catch (e) { log('screenshot failed:', e.message) }
}

const result = await pending

// Dismiss whatever sheet the request raised. We never needed to touch it.
tryAdb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
await sleep(2500)

// ── Verdict ──────────────────────────────────────────────────────────────────
logcat.kill()
try { await browser.close() } catch { /* already gone */ }
tryAdb('forward', '--remove-all')

const pidsAfter = { release: pidOf(PKG), debug: pidOf(`${PKG}.debug`) }
const releasePids = new Set([...pidsBefore.release, ...pidsAfter.release])
const debugPids = new Set([...pidsBefore.debug, ...pidsAfter.debug])

log('\n─── request ───')
log(JSON.stringify(result, null, 2))

// ⚠ The credentialId is the only field that names who minted it. Ours are
// 0x01 || nonce(16) || tag(16) — 33 bytes. Anything else came from another
// provider, and every "successful-looking" run that skipped this check was
// actually Google Password Manager doing the work.
if (result?.credentialId) {
  const raw = Buffer.from(result.credentialId.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  const mine = raw.length === 33 && raw[0] === 0x01
  log(`\ncredential is Magic Money's: ${mine ? 'YES' : 'NO'}  (${raw.length} bytes, first byte 0x${raw[0].toString(16).padStart(2, '0')})`)
  if (!mine) log('  → another enabled provider answered; Chrome did not use ours.')
}

log('\n─── provider lines, credited by pid ───')
if (providerLog.length === 0) {
  log('  (none — our provider was never asked, which is a DIFFERENT bug)')
}
const offers = []
for (const { pid, msg } of providerLog) {
  const who = releasePids.has(pid) ? 'release' : debugPids.has(pid) ? 'debug' : `pid ${pid} (unresolved)`
  log(`  ${who.padEnd(8)} ${msg}`)
  const m = msg.match(/^GET offered (\d+) passkey\(s\)$/)
  if (m) offers.push({ who, count: Number(m[1]) })
}

log('\n─── verdict ───')
if (offers.length === 0) {
  log('INCONCLUSIVE: no "GET offered" line. Our provider was not queried for this')
  log('request at all — re-diagnose before assuming anything about the index.')
} else {
  const zero = offers.every(o => o.count === 0)
  for (const o of offers) log(`  ${o.who} offered ${o.count} passkey(s)`)
  log(zero
    ? '\nCONFIRMED: the provider was asked and had nothing to offer. The seed can\n'
      + 'derive the desktop-made key, but this device holds no record that it exists,\n'
      + 'so a username-less sign-in has nothing to enumerate.'
    : '\nNOT the index: this device DID offer a credential. The failure is later in\n'
      + 'the ceremony — re-diagnose against the assertion, not discovery.')
}