// Test wrapper main: isolate userData so e2e runs never touch a real wallet
// profile. Electron resolves appData via the OS known-folder API, so setting
// the APPDATA env var does NOT work — the path must be overridden in-process
// before the real main runs.
const { app } = require('electron')
app.setName('MagicMoneyE2E')
app.setPath('userData', process.env.MM_TEST_USERDATA)
require(process.env.MM_REAL_MAIN)
