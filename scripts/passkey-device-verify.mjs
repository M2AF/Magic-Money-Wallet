/**
 * passkey-device-verify.mjs — Android device check for the passkey shim
 *
 * Proves the Phase 3 claim on real hardware: that Magic Money's own in-app
 * browser can do WebAuthn, which no password manager will allow it to do. On the
 * Galaxy S21+ Samsung Pass refuses an embedded WebView by name, and before this
 * phase `window.PublicKeyCredential` was simply **undefined** in the dApp
 * WebView — so `installed: true` plus `uvpaa: true` below is the whole point.
 *
 * ⚠ THE PHONE MUST BE UNLOCKED AND THE APP IN THE FOREGROUND. Android suspends
 * background WebViews, and the devtools socket stops answering the moment the
 * keyguard comes up — an automated run against a locked phone reports nothing.
 *
 * Run:
 *   1. npm run build:capacitor && (cd android && ./gradlew assembleDebug)
 *   2. adb install -r android/app/build/outputs/apk/debug/app-debug.apk
 *   3. Unlock the phone, open Magic Money, unlock the wallet.
 *   4. node scripts/passkey-device-verify.mjs
 *
 * It serves ChainLens's passkey routes locally (e2e/chainlens-rp.cjs), reverses
 * the port onto the device, opens it in the in-app browser, and reports what the
 * page can see. Add RUN_CEREMONY=1 to drive a real registration — that needs two
 * taps on the phone (the approval sheet, then BiometricPrompt), which is exactly
 * the point and cannot be automated away.
 *
 * ⚠ Debug builds install as info.chainlens.magicmoney.DEBUG, side by side with
 * the release app. Target the right one or you will probe a stale build.
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { chromium } from 'playwright'

const require = createRequire(import.meta.url)
const rp = require('../e2e/chainlens-rp.cjs')

const PORT = Number(process.env.RP_PORT || 7799)
const PKG = process.env.MM_PKG || 'info.chainlens.magicmoney.debug'
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' })

const log = (...a) => console.log(...a)
const fail = (m) => { console.error(`\n✗ ${m}`); process.exit(1) }

// ── Device + WebView socket ──────────────────────────────────────────────────
const devices = adb('devices').split('\n').filter(l => /\tdevice$/.test(l))
if (devices.length === 0) fail('no adb device attached')
log('device:', devices[0].split('\t')[0])

const pid = adb('shell', 'pidof', PKG).trim().split(/\s+/)[0]
if (!pid) fail(`${PKG} is not running — open the app first`)

const socket = adb('shell', 'cat', '/proc/net/unix')
  .split('\n').map(l => (l.match(/webview_devtools_remote_\d+/) || [])[0])
  .filter(Boolean).find(s => s.endsWith(`_${pid}`))
if (!socket) fail('no WebView devtools socket — is this a debug build with CAP_WEB_DEBUG?')

adb('forward', '--remove-all')
adb('forward', 'tcp:9222', `localabstract:${socket}`)

// ── Local relying party, reachable from the device ───────────────────────────
const server = await rp.start('localhost', PORT)
adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`)
log('relying party:', server.url, '(reversed onto the device)')

let browser
try {
  browser = await chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 15_000 })
} catch {
  fail('CDP did not answer — Android suspends background WebViews, so unlock the phone and bring Magic Money to the front')
}
const ctx = browser.contexts()[0]

const wallet = ctx.pages().find(p => p.url().startsWith('https://localhost'))
if (!wallet) fail('the wallet WebView is not open')

const state = await wallet.evaluate(async () => ({
  isSetup: await window.wallet?.isSetup?.().catch(() => 'err'),
  isUnlocked: await window.wallet?.isUnlocked?.().catch(() => 'err'),
}))
log('wallet:', JSON.stringify(state))
if (state.isUnlocked !== true) {
  log('⚠ the wallet is locked — a ceremony will refuse; unlock it for the full check')
}

// ── Open the site in the in-app browser ──────────────────────────────────────
adb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', server.url, '-n', `${PKG}/info.chainlens.magicmoney.MainActivity`)

let site = null
for (let i = 0; i < 40 && !site; i++) {
  site = ctx.pages().find(p => p.url().includes(`:${PORT}`))
  if (!site) await new Promise(r => setTimeout(r, 500))
}
if (!site) fail('the page never opened in the in-app browser (is the app in the foreground?)')
log('dApp tab:', site.url())

// ── What the page can see ────────────────────────────────────────────────────
const caps = await site.evaluate(async () => ({
  installed: window.__MAGICMONEY_PASSKEY_INSTALLED__ === true,
  hasCredentials: typeof navigator.credentials?.create === 'function',
  createIsNative: /\[native code\]/.test(String(navigator.credentials?.create)),
  hasPublicKeyCredential: typeof window.PublicKeyCredential !== 'undefined',
  uvpaa: window.PublicKeyCredential
    ? await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => 'err')
    : false,
  origin: location.origin,
}))
log('\nSHIM:', JSON.stringify(caps, null, 1))

const ok = caps.installed && caps.hasCredentials && !caps.createIsNative && caps.hasPublicKeyCredential && caps.uvpaa === true
log(ok
  ? '\n✓ Magic Money is the authenticator in its own browser'
  : '\n✗ the shim is NOT in control of navigator.credentials here')

// ── Optional: a real ceremony (needs two taps on the phone) ──────────────────
if (process.env.RUN_CEREMONY === '1' && ok) {
  log('\nregistering — approve the sheet on the phone, then the biometric prompt…')
  await site.evaluate(() => { window.__mmResult = null; document.getElementById('reg').click() })
  for (let i = 0; i < 180; i++) {
    const r = await site.evaluate(() => window.__mmResult).catch(() => null)
    if (r) { log('REGISTER:', JSON.stringify(r)); break }
    await new Promise(r2 => setTimeout(r2, 1000))
  }
  log('\nsigning in — approve again…')
  await site.evaluate(() => { window.__mmResult = null; document.getElementById('login').click() })
  for (let i = 0; i < 180; i++) {
    const r = await site.evaluate(() => window.__mmResult).catch(() => null)
    if (r) { log('LOGIN:', JSON.stringify(r)); break }
    await new Promise(r2 => setTimeout(r2, 1000))
  }
}

await browser.close()
await server.close()
try { adb('reverse', '--remove-all'); adb('forward', '--remove-all') } catch { /* best effort */ }
process.exit(ok ? 0 : 1)
