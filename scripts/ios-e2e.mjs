#!/usr/bin/env node
/**
 * ios-e2e.mjs — drive the real app on an iOS Simulator via Appium/XCUITest.
 *
 * WHY THIS EXISTS: nobody on this project owns an Apple device and never will.
 * GitHub Actions macOS runners are the ONLY place iOS code can run, so this is
 * the entire functional test surface for the platform. The repo is public, so
 * those runner minutes are free — there is no reason not to test properly.
 *
 * APPROACH: the app is a WebView, so after the session starts we switch to the
 * WEBVIEW context and work against the DOM instead of native accessibility
 * selectors. Two reasons:
 *   1. The React UI has no test IDs and labels shift; DOM queries by text are
 *      far less brittle than XCUITest element trees.
 *   2. It lets us call `window.wallet.*` directly — which is how the NATIVE
 *      plugins get exercised (SecureVault → Secure Enclave, AppInfo → secure
 *      screen). Those are the parts that can't be tested any other way, and
 *      testing them through the bridge beats hunting for UI that triggers them.
 *
 * Run by .github/workflows/ios.yml. Expects an Appium server on :4723 and the
 * simulator already booted with biometrics enrolled.
 *
 * Env:
 *   IOS_APP_PATH   path to the built .app (simulator slice)   [required]
 *   IOS_UDID       booted simulator UDID                       [required]
 *   IOS_PLATFORM   iOS version, e.g. "17.4"                    [optional]
 *   SHOT_DIR       where to write screenshots (default ./ios-shots)
 */

import { remote } from 'webdriverio'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const APP = process.env.IOS_APP_PATH
const UDID = process.env.IOS_UDID
const PLATFORM = process.env.IOS_PLATFORM || undefined
const SHOT_DIR = process.env.SHOT_DIR || 'ios-shots'

if (!APP || !UDID) {
  console.error('ios-e2e: IOS_APP_PATH and IOS_UDID are required')
  process.exit(1)
}

const PKG_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version

mkdirSync(SHOT_DIR, { recursive: true })

let shotN = 0
const failures = []
const notes = []

function pass(msg) { console.log(`  ✓ ${msg}`) }
function fail(msg) { console.log(`  ✗ ${msg}`); failures.push(msg) }
function note(msg) { console.log(`  · ${msg}`); notes.push(msg) }

async function shot(driver, name) {
  const file = join(SHOT_DIR, `${String(++shotN).padStart(2, '0')}-${name}.png`)
  writeFileSync(file, Buffer.from(await driver.takeScreenshot(), 'base64'))
  console.log(`  📸 ${file}`)
}

/**
 * Evaluate an async expression inside the page and return its value.
 *
 * Deliberately NOT executeAsync: its callback form is flaky across the
 * Appium/remote-debugger bridge. Instead we kick the promise off, park the
 * result on window, and poll for it — plain `execute` calls the whole way.
 */
async function evalAsync(driver, body, timeoutMs = 20000) {
  const key = `__mmE2E_${Date.now()}_${Math.random().toString(36).slice(2)}`
  await driver.execute(`
    window['${key}'] = undefined;
    Promise.resolve((async () => { ${body} })())
      .then(v => { window['${key}'] = { ok: true, v: v === undefined ? null : v }; },
            e => { window['${key}'] = { ok: false, e: String((e && e.message) || e) }; });
  `)
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const r = await driver.execute(`return window['${key}'] || null;`)
    if (r) {
      if (!r.ok) throw new Error(r.e)
      return r.v
    }
    if (Date.now() > deadline) throw new Error(`evalAsync timed out after ${timeoutMs}ms`)
    await new Promise(res => setTimeout(res, 250))
  }
}

/** Poll until a WEBVIEW context appears — it is not ready at session start. */
async function switchToWebview(driver, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const contexts = await driver.getContexts()
    const names = contexts.map(c => (typeof c === 'string' ? c : c.id))
    const webview = names.find(n => String(n).startsWith('WEBVIEW'))
    if (webview) {
      await driver.switchContext(webview)
      return webview
    }
    if (Date.now() > deadline) {
      throw new Error(`No WEBVIEW context after ${timeoutMs}ms. Contexts: ${names.join(', ') || '(none)'}`)
    }
    await new Promise(res => setTimeout(res, 1000))
  }
}

const caps = {
  platformName: 'iOS',
  'appium:automationName': 'XCUITest',
  'appium:udid': UDID,
  'appium:app': APP,
  'appium:noReset': false,
  // WebView discovery on a simulator goes through the remote debugger; give it
  // room, the first attach after a cold boot is slow.
  'appium:webviewConnectTimeout': 30000,
  'appium:newCommandTimeout': 180,
  // Appium compiles WebDriverAgent from source the first time it drives a
  // device, and CI runners are ephemeral so EVERY run pays that cost (~3-5
  // min of xcodebuild). The driver's own defaults are far below that.
  'appium:wdaLaunchTimeout': 600000,
  'appium:wdaConnectionTimeout': 600000,
  // Verbose, but the WebDriverAgent build is the most likely thing to break
  // here and its errors are otherwise swallowed ("Output from xcodebuild will
  // only be logged if any errors are present"). With no Mac to reproduce on,
  // the log is the only diagnosis available.
  'appium:showXcodeLog': true,
  ...(PLATFORM ? { 'appium:platformVersion': PLATFORM } : {}),
}

const driver = await remote({
  hostname: '127.0.0.1',
  port: 4723,
  path: '/',
  logLevel: 'error',
  // WebdriverIO's default is 120s, which expires while WDA is still building
  // and surfaces as an opaque UND_ERR_HEADERS_TIMEOUT on POST /session rather
  // than anything pointing at WebDriverAgent.
  connectionRetryTimeout: 900000,
  connectionRetryCount: 1,
  capabilities: caps,
})

try {
  console.log('\n── context ──')
  const ctx = await switchToWebview(driver)
  pass(`switched to ${ctx}`)

  // ── 1. The app actually rendered ────────────────────────────────────────
  console.log('\n── render ──')
  const dom = await evalAsync(driver, `
    const root = document.getElementById('root');
    return {
      readyState: document.readyState,
      rootChildren: root ? root.children.length : -1,
      bodyText: (document.body.innerText || '').slice(0, 400),
      origin: location.origin,
    };
  `)
  console.log(`     origin=${dom.origin} readyState=${dom.readyState} #root children=${dom.rootChildren}`)
  if (dom.rootChildren > 0) pass('React mounted and rendered into #root')
  else fail(`#root has ${dom.rootChildren} children — nothing rendered`)

  for (const label of ['Create New Wallet', 'Import Existing Wallet']) {
    if (dom.bodyText.includes(label)) pass(`onboarding shows "${label}"`)
    else fail(`onboarding missing "${label}"`)
  }
  await shot(driver, 'onboarding')

  // ── 2. The native bridge is wired ───────────────────────────────────────
  console.log('\n── bridge ──')
  const bridge = await evalAsync(driver, `
    const w = window.wallet;
    if (!w) return { present: false };
    return {
      present: true,
      hasHelloStatus:  typeof w.helloStatus === 'function',
      hasSecureScreen: typeof w.setSecureScreen === 'function',
      hasDownloadFile: typeof w.downloadFile === 'function',
      hasScanQr:       typeof w.scanQr === 'function',
      // MUST be present: the app is self-distributed (never an App Store
      // build), so the GitHub-Releases updater is deliberately kept and
      // isPlayStoreInstall() returns false so it is never stripped.
      hasUpdateCheck:  typeof w.updateCheck === 'function',
    };
  `)
  if (!bridge.present) {
    fail('window.wallet is not installed')
  } else {
    pass('window.wallet installed')
    for (const [k, v] of Object.entries(bridge)) {
      if (k === 'present') continue
      if (v) pass(`  ${k}`)
      else fail(`  ${k} is missing from window.wallet`)
    }
  }

  // Default browser has no iOS equivalent — the alias stub must report
  // unsupported rather than a native plugin rejecting at runtime.
  const defaultBrowser = await evalAsync(driver, `
    if (typeof window.wallet.defaultBrowserGetState !== 'function') return 'absent';
    return await window.wallet.defaultBrowserGetState();
  `)
  if (defaultBrowser === 'absent' || (defaultBrowser && defaultBrowser.supported === false)) {
    pass('default-browser correctly reports unsupported on iOS')
  } else {
    fail(`default-browser should be unsupported on iOS, got ${JSON.stringify(defaultBrowser)}`)
  }

  const version = await evalAsync(driver, `return await window.wallet.getAppVersion();`)
  if (version === PKG_VERSION) pass(`getAppVersion() = ${version} (matches package.json)`)
  else fail(`getAppVersion() = ${version}, expected ${PKG_VERSION} — patch-ios-native.js version sync broken`)

  // ── 3. AppInfoPlugin.swift — secure screen ──────────────────────────────
  console.log('\n── AppInfoPlugin (secure screen) ──')
  try {
    await evalAsync(driver, `await window.wallet.setSecureScreen(true); return null;`)
    await evalAsync(driver, `await window.wallet.setSecureScreen(false); return null;`)
    pass('setSecureScreen(true/false) round-tripped without error')
  } catch (e) {
    fail(`setSecureScreen threw: ${e.message}`)
  }

  // ── 4. SecureVaultPlugin.swift — Secure Enclave / Face ID ───────────────
  // Biometrics are enrolled by the workflow before launch, so a correctly
  // registered plugin must report the sensor as available. This is the only
  // automated coverage the Secure Enclave path will ever get.
  console.log('\n── SecureVaultPlugin (Face ID) ──')
  try {
    const hello = await evalAsync(driver, `return await window.wallet.helloStatus();`)
    console.log(`     helloStatus() = ${JSON.stringify(hello)}`)
    if (hello && hello.supported) pass(`biometrics available (method=${hello.method})`)
    else fail('helloStatus().supported is false despite simulator enrollment — SecureVaultPlugin not reached?')
    if (hello && hello.enrolled === false) pass('enrolled=false on a fresh install (expected)')
  } catch (e) {
    fail(`helloStatus threw: ${e.message}`)
  }

  // ── 5. DappBrowserPlugin.swift — registered and callable ────────────────
  // getTorState is the ideal probe: it reaches the native plugin but opens no
  // web views and changes no state. A reply proves the plugin registered; an
  // "not implemented" rejection proves it did not.
  console.log('\n── DappBrowserPlugin ──')
  try {
    const tor = await evalAsync(driver, `
      const { DappBrowser } = window.Capacitor.registerPlugin
        ? { DappBrowser: window.Capacitor.registerPlugin('DappBrowser') }
        : {};
      if (!DappBrowser) return { unavailable: true };
      return await DappBrowser.getTorState();
    `)
    console.log(`     getTorState() = ${JSON.stringify(tor)}`)
    if (tor && tor.unavailable) {
      fail('Capacitor.registerPlugin unavailable — cannot probe DappBrowser')
    } else if (tor && typeof tor.status === 'string') {
      pass(`DappBrowser plugin responded (tor status=${tor.status})`)
      // Tor is deliberately NOT part of the iOS build, so this must always
      // report unsupported. Reporting anything else would tell the user their
      // traffic is anonymised when it is in clear.
      if (tor.status === 'unsupported' && tor.isTor === false) {
        pass('Tor correctly reports unsupported (not a false "connected")')
      } else {
        fail(`Tor should report unsupported on iOS, got status=${tor.status} isTor=${tor.isTor}`)
      }
    }
  } catch (e) {
    fail(`DappBrowser.getTorState threw: ${e.message}`)
  }

  // ── Magic Guard — the rulesets must actually compile ────────────────────
  // status 'ready' is the meaningful assertion: it means all four
  // WKContentRuleList chunks inflated from the bundle and compiled in WebKit.
  // 'degraded' means the filter data is missing or failed to compile, which
  // would leave the browser silently unprotected.
  console.log('\n── Magic Guard ──')
  try {
    const guard = await evalAsync(driver, `
      const DappBrowser = window.Capacitor.registerPlugin('DappBrowser');
      return await DappBrowser.getMagicGuardState();
    `, 90000)   // first launch compiles ~134k rules; WebKit needs a while
    console.log(`     getMagicGuardState() = ${JSON.stringify(guard)}`)
    if (guard && guard.status === 'ready') {
      pass(`content blocking compiled (listVersion=${guard.listVersion})`)
    } else if (guard && guard.status === 'disabled') {
      pass('content blocking compiled but is switched off')
    } else {
      fail(`Magic Guard status=${guard && guard.status} error=${guard && guard.error} — rulesets did not compile`)
    }
  } catch (e) {
    fail(`getMagicGuardState threw: ${e.message}`)
  }

  // ── 6. Navigation works (React state + event handling) ──────────────────
  console.log('\n── navigation ──')
  const clicked = await evalAsync(driver, `
    const btn = [...document.querySelectorAll('button')]
      .find(b => (b.textContent || '').includes('Create New Wallet'));
    if (!btn) return false;
    btn.click();
    return true;
  `)
  if (!clicked) {
    fail('could not find the "Create New Wallet" button')
  } else {
    await new Promise(r => setTimeout(r, 1500))
    const after = await evalAsync(driver, `return (document.body.innerText || '').slice(0, 400);`)
    if (!after.includes('Create New Wallet') || after.length === 0) {
      pass('navigated away from the welcome screen')
    } else {
      note('welcome text still present after click — flow may not have advanced')
    }
    await shot(driver, 'after-create-tap')
  }
} finally {
  await driver.deleteSession().catch(() => {})
}

console.log('\n──────────── summary ────────────')
console.log(`  passed checks with ${failures.length} failure(s), ${notes.length} note(s)`)
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log('  iOS end-to-end checks passed.\n')
