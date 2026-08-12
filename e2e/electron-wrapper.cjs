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

require(process.env.MM_REAL_MAIN)
