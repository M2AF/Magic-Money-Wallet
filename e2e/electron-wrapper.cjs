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

require(process.env.MM_REAL_MAIN)
