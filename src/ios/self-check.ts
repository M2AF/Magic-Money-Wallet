/**
 * self-check.ts (iOS) — in-app runtime verification.
 *
 * WHY THIS EXISTS INSTEAD OF AN APPIUM SUITE: nobody on this project owns an
 * Apple device, so GitHub Actions is the only place iOS ever runs. Appium's
 * XCUITest driver could not attach to the WebView (it reported only
 * NATIVE_APP), and each attempt cost ~10 minutes of CI with no way to
 * reproduce locally. Running the checks INSIDE the app removes Appium,
 * WebDriverAgent and the webview-attach problem altogether — and tests more
 * than tapping buttons would.
 *
 * Results go to console.log as `[MM-SELFCHECK] PASS|FAIL <name>` lines. CI
 * already captures the app's stdout via `simctl launch --console-pipe`, so no
 * new plumbing is needed; the workflow just greps for FAIL and for the final
 * DONE marker (a missing marker means the app died mid-run, which must also
 * fail the build).
 *
 * Enabled only when __MM_SELF_CHECK__ is true — a Vite define driven by the
 * same CAP_WEB_DEBUG env var capacitor.config.ts reads. Release builds
 * dead-code-eliminate the whole module.
 *
 * ── The crypto vectors are the point ────────────────────────────────────────
 * `npm test`'s unit suite runs in Node/V8, and Android's WebView is V8 as well.
 * **iOS is the only JavaScriptCore target in the project.** Derivation,
 * signing or WASM could break on iOS alone through a JSC/V8 difference —
 * BigInt semantics, TypedArray behaviour, WASM instantiation, WebCrypto
 * availability at a non-standard origin — and nothing else in the pipeline
 * would notice. So the vectors below are re-derived in the real runtime and
 * compared against the same values src/main/wallet-core.test.ts asserts.
 */

import { deriveAddresses } from '../main/wallet-core'
import { encryptWithKeyMaterial, decryptWithKeyMaterial } from '../main/crypto-vault'

const TAG = '[MM-SELFCHECK]'

/**
 * Foundry/Anvil account #0 — the same fixed external reference the unit tests
 * use (src/main/wallet-core.test.ts). NOT a wallet anyone funds.
 */
const VECTOR_MNEMONIC = 'test test test test test test test test test test test junk'

/** Expected derivation for VECTOR_MNEMONIC at account 0, per the unit suite. */
const EXPECTED = {
  evm: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  solana: 'oeYf6KAJkLYhBuR8CiGc6L4D4Xtfepr85fuDgA9kq96',
  cardano: 'addr1qy4jrrcfzylccwgqu3su865es52jkf7yzrdu9cw3z84nycnn3zz9lvqj7vs95tej896xkekzkufhpuk64ja7pga2g8kswl6kh2',
  cardanoStake: 'stake1u9ec3pzlkqf0xgz69uerjartvmptwyms7td2ewlq5w4yrmgt9207g',
  bitcoin: 'bc1q4qw42stdzjqs59xvlrlxr8526e3nunw7mp73te',
  bitcoinTaproot: 'bc1pfzhx49qe6s5exppe5hqljg3n6587xk0w75xqr70pgdt7ygnfkssqxqjd9l',
  polkadot: '13AYmj8xmDGKixenStJSz6j5B9HeRR7Kx4yRLpSR6C5UDLvf',
  tron: 'TWer2Ygk5TEheHp3TPuYeqxmB6SsGZmaL6',
  dogecoin: 'DT6SkrdLDPUAhjV8gbEJFouEMM9vZx686g',
} as const

/**
 * Host used for the Magic Guard differential test. Must be stable, boring, and
 * NOT itself in any filter list — the control load has to succeed for the
 * comparison to mean anything.
 */
const GUARD_CONTROL_HOST = 'https://example.com'

let failures = 0

function pass(name: string, detail = ''): void {
  console.log(`${TAG} PASS ${name}${detail ? ' — ' + detail : ''}`)
}
function fail(name: string, detail: string): void {
  failures++
  console.log(`${TAG} FAIL ${name} — ${detail}`)
}
function skip(name: string, why: string): void {
  console.log(`${TAG} SKIP ${name} — ${why}`)
}

async function check(name: string, fn: () => Promise<string | void>): Promise<void> {
  try {
    const detail = await fn()
    pass(name, typeof detail === 'string' ? detail : '')
  } catch (e) {
    fail(name, e instanceof Error ? e.message : String(e))
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const w = () => (window as any).wallet

// ── 1. Bridge + plugins ──────────────────────────────────────────────────────

async function checkBridge(): Promise<void> {
  await check('bridge.installed', async () => {
    if (!w()) throw new Error('window.wallet is missing')
    return 'window.wallet present'
  })

  await check('bridge.version', async () => {
    const v = await w().getAppVersion()
    // Guards scripts/patch-ios-native.js: the Capacitor template hardcodes 1.0,
    // which would make the updater believe every release is newer forever.
    if (!v || v === '1.0') throw new Error(`app version is "${v}" — MARKETING_VERSION was not patched`)
    return `v${v}`
  })

  await check('plugin.AppInfo.setSecureScreen', async () => {
    await w().setSecureScreen(true)
    await w().setSecureScreen(false)
    return 'round-tripped'
  })

  await check('plugin.SecureVault.helloStatus', async () => {
    const s = await w().helloStatus()
    // CI enrolls Face ID on the simulator before launching, so an unsupported
    // result means the plugin was not reached rather than "no hardware".
    if (!s || !s.supported) throw new Error(`supported=${s && s.supported} method=${s && s.method}`)
    return `method=${s.method}`
  })
}

// ── 2. Crypto core, in JavaScriptCore ────────────────────────────────────────

async function checkCrypto(): Promise<void> {
  await check('crypto.subtle', async () => {
    if (!globalThis.crypto?.subtle) throw new Error('crypto.subtle unavailable at this origin')
    const material = crypto.getRandomValues(new Uint8Array(32))
    const blob = await encryptWithKeyMaterial('self-check plaintext', material)
    const back = await decryptWithKeyMaterial(blob, material)
    if (back !== 'self-check plaintext') throw new Error('AES-GCM round-trip mismatch')
    return 'AES-GCM round-trip OK'
  })

  await check('crypto.derivation', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a = await deriveAddresses(VECTOR_MNEMONIC, 0) as any
    const wrong: string[] = []
    for (const [chain, expected] of Object.entries(EXPECTED)) {
      if (a[chain] !== expected) wrong.push(`${chain}: got ${a[chain]}`)
    }
    if (wrong.length) throw new Error(`derivation differs under JavaScriptCore — ${wrong.join('; ')}`)
    return `${Object.keys(EXPECTED).length} chains match the reference vectors`
  })
}

// ── 3. Network — the capacitor://localhost origin against the Worker ─────────

async function checkNetwork(): Promise<void> {
  await check('network.worker-cors', async () => {
    // The iOS origin is capacitor://localhost, NOT Android's https://localhost.
    // cloudflare-worker/swap-proxy.js lists both in APP_ORIGINS, but that has
    // never been exercised from a real iOS build — if it regresses, every
    // portfolio fetch fails while the app still looks fine.
    const res = await fetch('https://magicmoney-swap-proxy.guildfordking.workers.dev/health', {
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) throw new Error(`Worker /health returned ${res.status}`)
    return `origin ${location.origin} accepted`
  })
}

// ── 4. dApp browser + Magic Guard ────────────────────────────────────────────

interface GuardManifest { sampleBlockedPath?: string | null; totalRules?: number; version?: string }

async function loadGuardManifest(): Promise<GuardManifest | null> {
  try {
    const res = await fetch('magic-guard/manifest.json')
    return res.ok ? await res.json() as GuardManifest : null
  } catch {
    return null
  }
}

/** Navigate the active tab and report the URL it settled on ('' when blocked). */
async function navigateAndSettle(DappBrowser: any, url: string): Promise<string> {
  await DappBrowser.navigate({ url })
  // No load event crosses the bridge, so poll the plugin's own state.
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500))
    const s = await DappBrowser.getState()
    if (!s.loading && s.url) return s.url
  }
  return ''
}

async function checkBrowserAndGuard(): Promise<void> {
  const { registerPlugin } = await import('@capacitor/core')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const DappBrowser = registerPlugin<any>('DappBrowser')

  await check('plugin.DappBrowser.tor-unsupported', async () => {
    const tor = await DappBrowser.getTorState()
    // Tor is deliberately absent on iOS. Anything other than 'unsupported'
    // would tell the user their traffic is anonymised when it is in clear.
    if (tor.status !== 'unsupported' || tor.isTor !== false) {
      throw new Error(`expected unsupported/false, got ${tor.status}/${tor.isTor}`)
    }
    return 'reports unsupported'
  })

  await check('plugin.MagicGuard.compiled', async () => {
    const g = await DappBrowser.getMagicGuardState()
    if (g.status !== 'ready' && g.status !== 'disabled') {
      throw new Error(`status=${g.status} error=${g.error ?? 'none'}`)
    }
    return `status=${g.status} listVersion=${g.listVersion}`
  })

  // The dApp browser has never been exercised on iOS at all — opening a real
  // page is the first proof the WKWebView tab machinery works end to end.
  let opened = false
  await check('plugin.DappBrowser.open', async () => {
    await DappBrowser.open({
      url: `${GUARD_CONTROL_HOST}/`,
      bounds: { x: 0, y: 0, width: 320, height: 480 },
    })
    const settled = await navigateAndSettle(DappBrowser, `${GUARD_CONTROL_HOST}/`)
    if (!settled.includes('example.com')) throw new Error(`control page did not load (url="${settled}")`)
    opened = true
    return `loaded ${settled}`
  })

  // THE test that turns "the rules compiled" into "blocking works".
  const manifest = await loadGuardManifest()
  const blockedPath = manifest?.sampleBlockedPath
  if (!opened) {
    skip('magicguard.blocks', 'browser did not open')
  } else if (!blockedPath) {
    skip('magicguard.blocks', 'manifest has no sampleBlockedPath')
  } else {
    await check('magicguard.blocks', async () => {
      const probe = `${GUARD_CONTROL_HOST}${blockedPath}`
      const settled = await navigateAndSettle(DappBrowser, probe)
      // A blocked navigation never commits, so the tab stays on the control
      // page. Landing ON the probe URL means the rule did not fire.
      if (settled.includes(blockedPath)) {
        throw new Error(`navigation to a blocked path succeeded: ${settled}`)
      }
      return `blocked ${blockedPath}`
    })
  }

  try { await DappBrowser.close() } catch { /* nothing open */ }
}

// ── Runner ───────────────────────────────────────────────────────────────────

export async function runSelfCheck(): Promise<void> {
  console.log(`${TAG} START origin=${location.origin}`)
  try {
    await checkBridge()
    await checkCrypto()
    await checkNetwork()
    await checkBrowserAndGuard()
  } catch (e) {
    fail('runner', e instanceof Error ? e.message : String(e))
  }
  // CI requires this marker: without it the run is treated as a crash
  // mid-check rather than a pass.
  console.log(`${TAG} DONE failures=${failures}`)
}
