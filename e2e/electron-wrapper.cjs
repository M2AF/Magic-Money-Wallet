// Test wrapper main: isolate userData so e2e runs never touch a real wallet
// profile. Electron resolves appData via the OS known-folder API, so setting
// the APPDATA env var does NOT work — the path must be overridden in-process
// before the real main runs.
const { app } = require('electron')
app.setName('MagicMoneyE2E')
app.setPath('userData', process.env.MM_TEST_USERDATA)

// Optional: make this look like a machine with no Windows Hello enrolled.
//
// The passkey gate shells out to PowerShell (hello-bridge.ts) and, where Hello
// IS set up, pops a native consent dialog no automation can dismiss — so an
// e2e on a developer's own machine would hang forever. Stubbing the spawn here
// keeps that entirely in the TEST HARNESS: no production code learns it is
// being tested, and the app simply takes the documented fallback path for a
// machine without biometrics (verification = the unlocked wallet's password).
if (process.env.MM_TEST_NO_BIOMETRICS === '1') {
  const cp = require('child_process')
  const realSpawn = cp.spawn
  cp.spawn = function (command, args, options) {
    if (typeof command === 'string' && /powershell(\.exe)?$/i.test(command)) {
      const { Readable } = require('stream')
      const { EventEmitter } = require('events')
      const child = new EventEmitter()
      child.stdout = Readable.from([JSON.stringify({ ok: true, status: 'Success', supported: false })])
      child.stderr = Readable.from([])
      child.stdin = { write() {}, end() {} }
      setImmediate(() => child.emit('close', 0))
      return child
    }
    return realSpawn.call(this, command, args, options)
  }
}

// Optional: make this look like a machine where Windows Hello ALWAYS succeeds.
//
// The inverse of the stub above, and for the same reason — the real ceremony
// pops a native dialog no automation can dismiss. Everything downstream of the
// dialog is production code: the signature below is deterministic per key name,
// exactly as a real RSASSA-PKCS1-v1.5 signature over a fixed challenge is, so
// enroll and unlock derive the same wrap key and the AES-GCM round trip is real.
//
// Each call is appended to MM_TEST_HELLO_LOG as `<command>:<keyName>`, which is
// what lets a spec assert WHICH key the app reached for — the whole point of
// giving the password manager its own gate.
if (process.env.MM_TEST_FAKE_HELLO === '1') {
  const cp = require('child_process')
  const fs = require('fs')
  const crypto = require('crypto')
  const { Readable } = require('stream')
  const { EventEmitter } = require('events')
  const realSpawn = cp.spawn
  const log = process.env.MM_TEST_HELLO_LOG

  cp.spawn = function (command, args, options) {
    if (typeof command === 'string' && /powershell(\.exe)?$/i.test(command)) {
      // hello-bridge sends the script as UTF-16LE base64 via -EncodedCommand.
      const i = Array.isArray(args) ? args.indexOf('-EncodedCommand') : -1
      const script = i >= 0 ? Buffer.from(args[i + 1], 'base64').toString('utf16le') : ''
      const cmd = (script.match(/^\$Command = '([^']*)'/m) || [])[1] || ''
      const key = (script.match(/^\$KeyName = '([^']*)'/m) || [])[1] || ''
      if (log) { try { fs.appendFileSync(log, `${cmd}:${key}\n`) } catch { /* best effort */ } }

      const reply = cmd === 'supported' ? { ok: true, status: 'Success', supported: true }
        : cmd === 'delete' ? { ok: true, status: 'Success' }
        : {
          ok: true,
          status: 'Success',
          signatureB64: crypto.createHash('sha256').update(`fake-hello:${key}`).digest('base64'),
        }

      const child = new EventEmitter()
      child.stdout = Readable.from([JSON.stringify(reply)])
      child.stderr = Readable.from([])
      child.stdin = { write() {}, end() {} }
      setImmediate(() => child.emit('close', 0))
      return child
    }
    return realSpawn.call(this, command, args, options)
  }
}

// Optional: stand in for the ChainLens profile server on the /profile/themes
// routes only.
//
// WHY THIS IS NOT OPTIONAL-IN-PRACTICE for the theme specs: the default config
// points at the LIVE Worker, and pushing a theme with no profile auto-creates a
// ChainLens account (theme-sync.ts). Left alone, every `npm run test:e2e:app`
// would mint a real account for the public Anvil test key and write themes to
// production. It also makes the specs hermetic — they pass whether or not the
// Worker has been deployed.
//
// Everything downstream of this is production code: the wallet still builds the
// entries map, signs, posts, and applies whatever comes back. MM_TEST_SYNC_STATE
// is the fake server's stored row — a spec seeds it to play "a theme made on
// another device" — and MM_TEST_SYNC_LOG records each push so a spec can assert
// what the wallet actually sent (a tombstone on delete, for instance).
if (process.env.MM_TEST_FAKE_PROFILE_SYNC === '1') {
  const fs = require('fs')
  const statePath = process.env.MM_TEST_SYNC_STATE
  const logPath = process.env.MM_TEST_SYNC_LOG
  const realFetch = globalThis.fetch

  const readRaw = () => {
    try { return JSON.parse(fs.readFileSync(statePath, 'utf8')) } catch { return {} }
  }
  // `__mode` is a control channel a spec can flip mid-run; it is never a theme.
  const readState = () => {
    const out = {}
    for (const [k, v] of Object.entries(readRaw())) if (!k.startsWith('__')) out[k] = v
    return out
  }
  const writeState = (entries) => {
    try { fs.writeFileSync(statePath, JSON.stringify({ ...entries, __mode: readRaw().__mode })) }
    catch { /* best effort */ }
  }
  const log = (record) => {
    if (!logPath) return
    try { fs.appendFileSync(logPath, JSON.stringify(record) + '\n') } catch { /* best effort */ }
  }
  const reply = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

  globalThis.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input)
    const method = ((init && init.method) || 'GET').toUpperCase()

    // /sync is intercepted too, and NOT because a spec needs it: it is the
    // account-creating upsert theme-sync falls back to on a "No profile" 404.
    // Left to the real network it would write a live ChainLens account for the
    // public test key on any run that took that path. Logged so a spec can
    // assert the wallet did NOT reach for it.
    if (/\/sync(\?|$)/.test(url)) {
      log({ sync: true })
      return Promise.resolve(reply({ success: true, profile: null, error: null }))
    }

    if (!url.includes('/profile/themes')) return realFetch.call(this, input, init)

    // Play a Worker that has not had this route deployed: the ROUTER's 404,
    // which is a different thing from the handler's "No profile" 404 and must
    // not be mistaken for it.
    if (readRaw().__mode === 'missing-route') {
      log({ missingRoute: method })
      return Promise.resolve(reply({ error: 'Not found' }, 404))
    }

    if (method === 'GET') return Promise.resolve(reply({ entries: readState() }))

    let pushed = {}
    try { pushed = JSON.parse((init && init.body) || '{}').entries || {} } catch { /* malformed */ }
    log(pushed)

    // The same per-id newest-wins merge the Worker runs, so a spec sees the real
    // convergence behaviour rather than a plain overwrite.
    const merged = readState()
    for (const [id, e] of Object.entries(pushed)) {
      if (!merged[id] || (e && typeof e.t === 'number' && e.t >= merged[id].t)) merged[id] = e
    }
    writeState(merged)
    return Promise.resolve(reply({ entries: merged, error: null }))
  }
}

require(process.env.MM_REAL_MAIN)
