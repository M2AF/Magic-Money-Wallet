import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The Midnight dApp connector is injected by the Electron preload as a source
 * STRING handed to webFrame.executeJavaScript, so nothing about it is checked
 * by tsc and a syntax slip would only ever surface on a live dApp page. These
 * tests load the built bundle, recover that string, and run it in a real page
 * against a stand-in for the detection code Pulse Finance actually ships.
 */

const bundlePath = resolve(process.cwd(), 'out/inject/web3-inject.js')

/** Recover the main-world source the preload evaluates into dApp pages. */
function injectedSource(): string {
  expect(existsSync(bundlePath), 'out/inject/web3-inject.js should exist; run npm run build:inject first').toBe(true)

  const scripts: string[] = []
  const electronStub = {
    contextBridge: { exposeInMainWorld: () => undefined },
    ipcRenderer: { on: () => undefined, invoke: () => Promise.resolve(), sendSync: () => '' },
    webFrame: {
      executeJavaScript: (source: string) => { scripts.push(source); return Promise.resolve() },
    },
  }
  // The preload also runs isolated-world DOM code (the login-form scanner) at
  // import time, so it needs a window to load at all under Node. Everything
  // that matters here is the source string it hands to executeJavaScript.
  const noop = () => undefined
  const domStub = new Proxy({}, { get: () => noop }) as unknown as Window & typeof globalThis

  const module_ = { exports: {} as Record<string, unknown> }
  new Function(
    'require', 'module', 'exports', 'window', 'document', 'MutationObserver', 'requestAnimationFrame',
    readFileSync(bundlePath, 'utf8'),
  )(
    (id: string) => {
      if (id !== 'electron') throw new Error(`unexpected require(${id}) in preload bundle`)
      return electronStub
    },
    module_,
    module_.exports,
    domStub,
    domStub,
    class { observe() {} disconnect() {} },
    noop,
  )

  const source = scripts.find(s => s.includes('window.midnight'))
  expect(source, 'preload should evaluate a script that registers window.midnight').toBeTruthy()
  return source as string
}

/** Pulse Finance's real shape: enumerate window.midnight, keep hardcoded rdns. */
const PULSE_PAGE = `<!doctype html><html><body>
  <div role="dialog">
    <button id="row-1am"><img alt="1AM" src="/_next/static/media/1am.abc123.png"><span>1AM</span></button>
    <button id="row-lace"><img alt="Lace" src="/_next/static/media/lace.54f76d5.png"><span>Lace</span></button>
    <button id="row-eternl"><img alt="Eternl" src="/_next/static/media/eternl.54f76d5.png"><span>Eternl</span></button>
  </div>
  <script>
    var WALLETS = [
      { rdns: 'com.midnight.1am', id: 'row-1am' },
      { rdns: 'io.lace.wallet',   id: 'row-lace' },
      { rdns: 'cardano:eternl',   id: 'row-eternl' },
    ]
    WALLETS.forEach(function (w) {
      var installed = !!window.midnight && Object.values(window.midnight).some(function (p) {
        return p && p.rdns === w.rdns
      })
      document.getElementById(w.id).disabled = !installed
    })
  <\/script>
</body></html>`

async function openFakePulse(page: Page, url = 'https://pulsefinance.org/') {
  await page.addInitScript({ content: `
    window.__mmCalls = []
    window.__mmBridge__ = {
      call: (channel, args) => {
        window.__mmCalls.push({ channel, args })
        return Promise.resolve(channel === 'midnight:enable' ? true : null)
      }
    }
  ` })
  await page.addInitScript({ content: injectedSource() })
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: PULSE_PAGE }))
  await page.goto(url)
}

test.describe('Midnight Lace compatibility alias', () => {
  test('announces MagicMoney under Lace\'s rdns so an allowlist dApp can see it', async ({ page }) => {
    await openFakePulse(page)

    // The whole point: the row is selectable, where before it was greyed out.
    await expect(page.locator('#row-lace')).toBeEnabled()
    await expect(page.locator('#row-1am')).toBeDisabled()
    await expect(page.locator('#row-eternl')).toBeDisabled()

    const registry = await page.evaluate(() => Object.entries(
      (window as typeof window & { midnight: Record<string, { rdns: string; name: string }> }).midnight,
    ).map(([key, w]) => ({ key, rdns: w.rdns, name: w.name })))

    // The alias carries Lace's rdns but MagicMoney's identity, and the
    // canonical entries keep ours — the alias is discovery, not impersonation.
    expect(registry).toContainEqual({ key: 'mnLace', rdns: 'io.lace.wallet', name: 'MagicMoney Wallet' })
    expect(registry.filter(w => w.rdns === 'info.chainlens.magicmoney').map(w => w.key).sort())
      .toEqual(['b7f3c1d2-5a4e-4f8b-9c2d-1e6a3b8d7f04', 'magicmoney'])
    expect(registry.every(w => w.name === 'MagicMoney Wallet')).toBe(true)

    // The Midnight registry shares ONE injected script with the Cardano/VESPR
    // announcement, so a slip in this block would silently take that down too.
    await expect(page.evaluate(() => {
      const cardano = (window as typeof window & {
        cardano?: Record<string, { name?: string }>
      }).cardano
      return { magicmoney: cardano?.magicmoney?.name, vespr: cardano?.vespr?.name }
    })).resolves.toEqual({ magicmoney: 'MagicMoney Wallet', vespr: 'MagicMoney Wallet' })

    // The alias must be a live provider, not a detection decoy.
    await expect(page.evaluate(() => {
      const lace = (window as typeof window & {
        midnight: Record<string, { connect?: unknown; enable?: unknown; isEnabled?: unknown }>
      }).midnight.mnLace
      return typeof lace.connect === 'function' && typeof lace.enable === 'function' && typeof lace.isEnabled === 'function'
    })).resolves.toBe(true)
  })

  test('exposes signData and forwards the payload untouched', async ({ page }) => {
    // Pulse's note-owner registration calls signData(message, { encoding:
    // 'text', keyType: 'unshielded' }) on the connected API and reads back
    // `verifyingKey`. Without this method the dApp connects and then silently
    // fails — its own handler only console.errors the rejection.
    await openFakePulse(page)

    const calls = await page.evaluate(async () => {
      const w = window as typeof window & {
        midnight: Record<string, { connect(n: string): Promise<Record<string, unknown>> }>
        __mmCalls: Array<{ channel: string; args: unknown[] }>
      }
      const api = await w.midnight.mnLace.connect('mainnet')
      if (typeof api.signData !== 'function') throw new Error('signData missing from the connected API')
      await (api.signData as (p: unknown, o: unknown) => Promise<unknown>)(
        'Pulse Finance note owner registration',
        { encoding: 'text', keyType: 'unshielded' },
      )
      return w.__mmCalls
    })

    // The message and options must reach main verbatim — main decides what to
    // sign and what to show, and cannot do that from a mangled payload.
    expect(calls).toContainEqual({
      channel: 'midnight:sign-data',
      args: ['Pulse Finance note owner registration', { encoding: 'text', keyType: 'unshielded' }],
    })
  })

  test('sends byte payloads as plain arrays that survive the IPC hop', async ({ page }) => {
    await openFakePulse(page)

    const calls = await page.evaluate(async () => {
      const w = window as typeof window & {
        midnight: Record<string, { connect(n: string): Promise<Record<string, unknown>> }>
        __mmCalls: Array<{ channel: string; args: unknown[] }>
      }
      const api = await w.midnight.mnLace.connect('mainnet')
      await (api.signData as (p: unknown, o: unknown) => Promise<unknown>)(new Uint8Array([1, 2, 255]), {})
      return w.__mmCalls
    })

    const signCall = calls.find(c => c.channel === 'midnight:sign-data')
    expect(signCall?.args[0]).toEqual([1, 2, 255])
  })

  test('rebrands the Lace row as MagicMoney on Pulse Finance', async ({ page }) => {
    await openFakePulse(page)

    await expect(page.locator('#row-lace')).toContainText('MagicMoney Wallet')
    await expect(page.locator('#row-lace img')).toHaveAttribute('alt', 'MagicMoney Wallet')
    await expect(page.locator('#row-lace img')).toHaveAttribute('src', /^data:image\/png;base64,/)

    // Only the aliased row is touched.
    await expect(page.locator('#row-eternl')).toContainText('Eternl')
    await expect(page.locator('#row-1am')).toContainText('1AM')
  })

  test('rebrands rows that Pulse renders after the wallet was injected', async ({ page }) => {
    await openFakePulse(page)

    // The modal mounts on click, long after document-start — the observer is
    // what makes the shim work at all on a client-rendered dApp.
    await page.evaluate(() => {
      const row = document.createElement('button')
      row.id = 'row-lace-late'
      row.innerHTML = '<img alt="Lace" src="/_next/static/media/lace.54f76d5.png"><span>Lace</span>'
      document.body.appendChild(row)
    })

    await expect(page.locator('#row-lace-late')).toContainText('MagicMoney Wallet')
    await expect(page.locator('#row-lace-late img')).toHaveAttribute('alt', 'MagicMoney Wallet')
  })

  test('never displaces a genuine Lace, and leaves its branding alone', async ({ page }) => {
    await page.addInitScript({ content: `
      window.__mmBridge__ = { call: () => Promise.resolve(null) }
      window.midnight = { mnLace: { rdns: 'io.lace.wallet', name: 'Lace', connect: () => {}, __genuine: true } }
    ` })
    await page.addInitScript({ content: injectedSource() })
    await page.route('https://pulsefinance.org/', route => route.fulfill({ contentType: 'text/html', body: PULSE_PAGE }))
    await page.goto('https://pulsefinance.org/')

    await expect(page.evaluate(() => (window as typeof window & {
      midnight: Record<string, { __genuine?: boolean; name: string }>
    }).midnight.mnLace.__genuine)).resolves.toBe(true)

    // MagicMoney is still announced under its own identity.
    await expect(page.evaluate(() => (window as typeof window & {
      midnight: Record<string, { rdns: string }>
    }).midnight.magicmoney.rdns)).resolves.toBe('info.chainlens.magicmoney')

    await expect(page.locator('#row-lace')).toContainText('Lace')
    await expect(page.locator('#row-lace img')).toHaveAttribute('alt', 'Lace')
    await expect(page.locator('#row-lace img')).toHaveAttribute('src', /lace\.54f76d5\.png$/)
  })

  test('registers the alias everywhere but only rebrands its target host', async ({ page }) => {
    await openFakePulse(page, 'https://some-other-midnight-dapp.example/')

    await expect(page.locator('#row-lace')).toBeEnabled()
    await expect(page.locator('#row-lace')).toContainText('Lace')
    await expect(page.locator('#row-lace img')).toHaveAttribute('alt', 'Lace')
  })
})