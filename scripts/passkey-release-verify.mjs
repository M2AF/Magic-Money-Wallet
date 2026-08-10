/**
 * passkey-release-verify.mjs — prove the RELEASE build serves passkeys to Chrome
 *
 * The debug build is already device-verified. This script exists for the one
 * thing debug can never test: `PrivilegedAllowlist.ownSigningFingerprint()`
 * computes this app's certificate AT RUNTIME, and release is signed with a
 * different key than debug. A pasted constant would have broken here silently,
 * so the release cert has to be exercised on a device at least once.
 *
 * ⚠ THE AAGUID IS THE ONLY FIELD THAT NAMES WHO MINTED THE CREDENTIAL.
 * Five earlier scripted runs "passed" while Google Password Manager quietly did
 * the work — verified:true, multiDevice, backedUp:true, every field plausible.
 * Chrome offers Google first and CDP cannot drive the Android system sheet, so
 * a human must tap "More options" → Magic Money. This script therefore only
 * OBSERVES: it wraps navigator.credentials and reads the AAGUID out of the
 * authenticator data, then asserts it is ours.
 *
 * Usage:
 *   1. Release app installed, a wallet created, provider enrolled in-app, and
 *      Magic Money enabled under Settings → Passwords, passkeys & accounts.
 *   2. node scripts/passkey-release-verify.mjs
 *   3. Drive the phone by hand when it says to. The script prints each ceremony
 *      as it lands and stops when it has both a create and a get.
 */

import { execFileSync, spawn } from 'node:child_process'
import { chromium } from 'playwright'

const OURS = '2c4b3c62-a6fc-6b9f-47f2-4ede41f1b4bf'
const GPM = 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4'
const PKG = process.env.MM_PKG || 'info.chainlens.magicmoney'
const SITE = process.env.MM_SITE || 'https://www.chainlensnft.info'
const PORT = Number(process.env.CDP_PORT || 9333)
const WAIT_MS = Number(process.env.MM_WAIT_MS || 15 * 60 * 1000)

// Windows adb.exe ends every line with CRLF, so a trailing-anchored regex like
// /\tdevice$/ never matches ("…\tdevice\r"). Strip it once, centrally.
const adb = (...args) =>
  execFileSync('adb', args, { encoding: 'utf8', maxBuffer: 32 << 20 }).replace(/\r\n/g, '\n')
const tryAdb = (...args) => { try { return adb(...args) } catch { return '' } }

const log = (...a) => console.log(...a)
const fail = (m) => { console.error(`\n✗ ${m}`); process.exit(1) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── Preflight ────────────────────────────────────────────────────────────────
const devices = adb('devices').split('\n').filter(l => /\tdevice$/.test(l))
if (devices.length === 0) fail('no adb device attached')
log('device:', devices[0].split('\t')[0])

if (!tryAdb('shell', 'pm', 'list', 'packages', PKG).split('\n').includes(`package:${PKG}`)) {
  fail(`${PKG} is not installed`)
}
log('package:', PKG, '(release — no .debug suffix)')

// Is the RELEASE component the enabled provider? The debug package name is a
// prefix of nothing, but the release name IS a prefix of the debug one, so
// compare the package half of each component rather than substring-matching.
const enabledProviders = (tryAdb('shell', 'settings', 'get', 'secure', 'credential_service') || '')
  .trim().split(':').filter(Boolean)
const providerEnabled = enabledProviders.some(c => c.split('/')[0] === PKG)
log('enabled as a credential provider:', providerEnabled ? 'yes' : 'NO')
if (!providerEnabled) {
  log('  → Settings → Passwords, passkeys & accounts → turn Magic Money on.')
  log('  → Debug enablement does NOT carry over; this is a different package.')
}

// ── Logcat: 16M first, or the default buffer rolls and loses the ceremony ─────
tryAdb('logcat', '-G', '16M')
tryAdb('logcat', '-c')
// ⚠ The debug and release apps use the SAME log tag, so a bare message cannot
// say which one served the ceremony. threadtime carries the pid; resolve it to
// a package and refuse to credit a line that did not come from the release app.
const releasePid = (tryAdb('shell', 'pidof', PKG) || '').trim().split(/\s+/)[0] || null
log('release pid:', releasePid || '(not running yet)')

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
    log(`   [provider pid=${pid}]`, msg.trim())
  }
})

// ── Open the live site in Chrome ─────────────────────────────────────────────
log('\nopening', SITE, 'in Chrome…')
tryAdb('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', SITE, '-n',
  'com.android.chrome/com.google.android.apps.chrome.Main')

// Chrome only publishes its devtools socket while it is running.
let socket = null
for (let i = 0; i < 30 && !socket; i++) {
  socket = (tryAdb('shell', 'cat', '/proc/net/unix').match(/chrome_devtools_remote\S*/) || [])[0]
  if (!socket) await sleep(1000)
}
if (!socket) {
  logcat.kill()
  fail('Chrome never published a devtools socket — is Chrome enabled and open on the phone?')
}
tryAdb('forward', '--remove-all')
adb('forward', `tcp:${PORT}`, `localabstract:${socket}`)
log('cdp:', socket, '→ 127.0.0.1:' + PORT)

let browser
try {
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20_000 })
} catch (e) {
  logcat.kill()
  fail('CDP did not answer: ' + e.message)
}
const ctx = browser.contexts()[0]

// ── The observer ─────────────────────────────────────────────────────────────
// Wraps navigator.credentials and records what the authenticator actually
// returned. Results go to localStorage so they survive the sign-out/sign-in
// navigation between the register and login halves.
const HOOK = () => {
  if (window.__MMPK_HOOK__) return
  window.__MMPK_HOOK__ = true
  const KEY = '__mmpk_capture'
  const hex = (u8) => [...u8].map(b => b.toString(16).padStart(2, '0')).join('')
  const uuid = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
  const push = (rec) => {
    try {
      const all = JSON.parse(localStorage.getItem(KEY) || '[]')
      all.push({ t: Date.now(), ...rec })
      localStorage.setItem(KEY, JSON.stringify(all))
    } catch { /* private mode — the live read still sees it */ }
  }

  // Chrome exposes getAuthenticatorData() on the attestation response. Fall
  // back to locating authData inside the CBOR by its map key, so a browser
  // without the accessor still yields an AAGUID rather than "unknown".
  const authDataOf = (response) => {
    if (typeof response.getAuthenticatorData === 'function') {
      return new Uint8Array(response.getAuthenticatorData())
    }
    const att = new Uint8Array(response.attestationObject)
    const needle = [0x61, 0x75, 0x74, 0x68, 0x44, 0x61, 0x74, 0x61] // "authData"
    for (let i = 0; i < att.length - needle.length; i++) {
      if (needle.every((b, j) => att[i + j] === b)) {
        let p = i + needle.length
        const head = att[p++]
        let len
        if (head === 0x58) len = att[p++]
        else if (head === 0x59) { len = (att[p] << 8) | att[p + 1]; p += 2 }
        else continue
        return att.slice(p, p + len)
      }
    }
    throw new Error('authData not found in attestationObject')
  }

  const creds = navigator.credentials
  const origCreate = creds.create.bind(creds)
  const origGet = creds.get.bind(creds)

  creds.create = async (opts) => {
    try {
      const cred = await origCreate(opts)
      let aaguid = null
      let flags = null
      try {
        const ad = authDataOf(cred.response)
        flags = ad[32]
        aaguid = uuid(hex(ad.slice(37, 53)))
      } catch (e) { aaguid = 'unreadable: ' + e.message }
      push({
        op: 'create', ok: true, aaguid, flags,
        credentialId: cred.id,
        rpId: opts?.publicKey?.rp?.id ?? null,
        transports: cred.response.getTransports ? cred.response.getTransports() : null,
      })
      return cred
    } catch (e) {
      push({ op: 'create', ok: false, error: `${e.name}: ${e.message}` })
      throw e
    }
  }

  creds.get = async (opts) => {
    try {
      const cred = await origGet(opts)
      let flags = null
      let signCount = null
      try {
        const ad = new Uint8Array(cred.response.authenticatorData)
        flags = ad[32]
        signCount = new DataView(ad.buffer, ad.byteOffset, ad.byteLength).getUint32(33)
      } catch { /* shape is the RP's problem, not ours */ }
      push({
        op: 'get', ok: true, credentialId: cred.id, flags, signCount,
        rpId: opts?.publicKey?.rpId ?? null,
      })
      return cred
    } catch (e) {
      push({ op: 'get', ok: false, error: `${e.name}: ${e.message}` })
      throw e
    }
  }
}

await ctx.addInitScript(HOOK).catch(() => { /* re-applied by the poll below */ })

const chainlensPages = () => ctx.pages().filter(p => /chainlensnft\.info/.test(p.url()))

log('\n────────────────────────────────────────────────────────────────')
log('ON THE PHONE — Chrome, not the wallet\'s own browser:')
log('  1. Sign in to ChainLens (Google or Discord).')
log('  2. Profile → add a passkey.')
log('  3. ⚠ On the system sheet tap "More options" → Magic Money.')
log('     Google Password Manager is the DEFAULT and will silently win.')
log('  4. Approve, then the biometric prompt.')
log('  5. Sign out → "Sign in with a passkey" → More options → Magic Money.')
log('────────────────────────────────────────────────────────────────\n')
log('watching… (Ctrl-C to stop early)\n')

const seen = new Set()
const captures = []
const deadline = Date.now() + WAIT_MS

while (Date.now() < deadline) {
  const pages = chainlensPages()
  for (const page of pages) {
    // Idempotent: re-installs only where a navigation dropped the wrapper.
    await page.evaluate(HOOK).catch(() => {})
    const rows = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('__mmpk_capture') || '[]') } catch { return [] }
    }).catch(() => [])
    for (const row of rows) {
      const key = `${row.op}:${row.t}`
      if (seen.has(key)) continue
      seen.add(key)
      captures.push(row)
      log(`   [${row.op}]`, JSON.stringify(row))
    }
  }
  const create = captures.find(c => c.op === 'create' && c.ok)
  const get = captures.find(c => c.op === 'get' && c.ok)
  if (create && get) break
  await sleep(2000)
}

// ── Verdict ──────────────────────────────────────────────────────────────────
log('\n════════════════════ VERDICT ════════════════════')
const create = captures.find(c => c.op === 'create' && c.ok)
const get = captures.find(c => c.op === 'get' && c.ok)
let ok = true

if (!create) {
  log('✗ REGISTER: no successful create() was observed')
  ok = false
} else if (create.aaguid === OURS) {
  log(`✓ REGISTER: aaguid ${create.aaguid} — MAGIC MONEY minted it`)
  log(`  credentialId ${create.credentialId}`)
  log(`  flags 0x${(create.flags ?? 0).toString(16)} (UP=${!!(create.flags & 1)} UV=${!!(create.flags & 4)} BE=${!!(create.flags & 8)} BS=${!!(create.flags & 16)})`)
} else {
  log(`✗ REGISTER: aaguid ${create.aaguid} — NOT ours`)
  if (create.aaguid === GPM) log('  that is Google Password Manager: the sheet defaulted, "More options" was not tapped')
  ok = false
}

if (!get) {
  log('✗ SIGN-IN: no successful get() was observed')
  ok = false
} else {
  const sameCred = create && get.credentialId === create.credentialId
  log(`${sameCred ? '✓' : '✗'} SIGN-IN: credentialId ${get.credentialId}${sameCred ? ' (the one we just minted)' : ''}`)
  log(`  flags 0x${(get.flags ?? 0).toString(16)}  signCount ${get.signCount}`)
  if (!sameCred) ok = false
}

// Credit only lines from the release process — the debug app logs under the
// same tag, and "some Magic Money served it" is not the claim being tested.
const pids = [...new Set(providerLog.map(l => l.pid))]
const pkgOf = {}
for (const pid of pids) {
  const owner = (tryAdb('shell', `cat /proc/${pid}/cmdline 2>/dev/null`) || '').replace(/\0.*$/, '').trim()
  pkgOf[pid] = owner || (pid === releasePid ? PKG : '(exited)')
}
const fromRelease = providerLog.filter(l => pkgOf[l.pid] === PKG || l.pid === releasePid)
const offeredCreate = fromRelease.filter(l => /CREATE offered/.test(l.msg)).length
const offeredGet = fromRelease.filter(l => /GET offered/.test(l.msg)).length
log(`\nprovider log (pid ${releasePid} = ${PKG}): ${offeredCreate} × "CREATE offered", ${offeredGet} × "GET offered"`)
for (const [pid, pkg] of Object.entries(pkgOf)) {
  if (pkg !== PKG && pid !== releasePid) log(`  ⚠ ${providerLog.filter(l => l.pid === pid).length} line(s) from pid ${pid} (${pkg}) — NOT credited`)
}
for (const l of providerLog.filter(l => /not allowlisted|failed/.test(l.msg))) log(`  ⚠ pid=${l.pid}`, l.msg)
if (offeredCreate === 0 && offeredGet === 0) {
  log('  ⚠ the release provider never logged — Credential Manager did not consult it at all')
  ok = false
}

log(ok
  ? '\n✓ RELEASE BUILD VERIFIED: the release-signed app served the ceremony'
  : '\n✗ NOT VERIFIED')

logcat.kill()
await browser.close().catch(() => {})
try { adb('forward', '--remove-all') } catch { /* best effort */ }
process.exit(ok ? 0 : 1)