import { expect, test } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const extensionFile = (file: string) => resolve(process.cwd(), 'dist-extension', file)

type RuntimeMessage = { type: string; args?: unknown[] }

async function installMockRuntime(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const w = window as typeof window & {
      __mmRuntimeMessages: Array<{ type: string; args?: unknown[] }>
      chrome: unknown
    }
    w.__mmRuntimeMessages = []
    w.chrome = {
      runtime: {
        lastError: undefined,
        onMessage: { addListener: () => undefined },
        sendMessage: (msg: { type: string; args?: unknown[] }, cb?: (res: { ok: boolean; result?: unknown; error?: string }) => void) => {
          w.__mmRuntimeMessages.push(msg)
          const request = msg.args?.[0] as { method?: string } | undefined
          const result = msg.type === 'web3:request' && request?.method === 'eth_chainId'
            ? '0x1'
            : { echoedType: msg.type }
          setTimeout(() => cb?.({ ok: true, result }), 0)
        },
      },
    }
  })
}

async function loadExtensionPageScripts(page: import('@playwright/test').Page, files: string[]) {
  await installMockRuntime(page)
  await page.goto('about:blank')
  for (const file of files) {
    const path = extensionFile(file)
    expect(existsSync(path), `${file} should exist; run npm run build:extension first`).toBe(true)
    await page.addScriptTag({ path })
  }
}

function requestViaPageMessage(page: import('@playwright/test').Page, type: string, args: unknown[] = []) {
  return page.evaluate(({ type, args }) => new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1_000_000)
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return
      const msg = event.data
      if (msg?.__mm === 'bg->page' || msg?.__mm === 'bg→page') {
        if (msg.id === id) {
          window.removeEventListener('message', onMessage)
          resolve(msg)
        }
      }
    }
    window.addEventListener('message', onMessage)
    window.postMessage({ __mm: 'page→bg', id, type, args }, '*')
  }), { type, args })
}

test.describe('extension page boundary', () => {
  test('rebrands Strike\'s VESPR compatibility row as MagicMoney', async ({ page }) => {
    await installMockRuntime(page)
    await page.route('https://app.strikefinance.org/brand-test', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <button id="vespr-row">
          <div><img alt="Vespr" src="/images/vespr.webp"><span>Vespr</span></div>
        </button>
      </body></html>`,
    }))
    await page.goto('https://app.strikefinance.org/brand-test')
    await page.addScriptTag({ path: extensionFile('inject.js') })

    await expect(page.locator('#vespr-row')).toContainText('MagicMoney Wallet')
    await expect(page.locator('#vespr-row img')).toHaveAttribute('alt', 'MagicMoney Wallet')
    await expect(page.locator('#vespr-row img')).toHaveAttribute('src', /^data:image\/png;base64,/)
    await expect(page.evaluate(() => {
      const cardano = (window as typeof window & {
        cardano: Record<string, unknown>
      }).cardano
      return cardano.magicmoney === cardano.vespr
    })).resolves.toBe(true)
  })

  test('rebrands DexHunter\'s VESPR compatibility tile as MagicMoney', async ({ page }) => {
    await installMockRuntime(page)
    await page.route('https://app.dexhunter.io/brand-test', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <div id="vespr-tile">
          <div><img alt="Vespr wallet" src="https://storage.googleapis.com/dexhunter-images/public/vespr.svg"></div>
          <div><span>Vespr</span></div>
        </div>
      </body></html>`,
    }))
    await page.goto('https://app.dexhunter.io/brand-test')
    await page.addScriptTag({ path: extensionFile('inject.js') })

    await expect(page.locator('#vespr-tile')).toContainText('MagicMoney Wallet')
    await expect(page.locator('#vespr-tile img')).toHaveAttribute('alt', 'MagicMoney Wallet')
    await expect(page.locator('#vespr-tile img')).toHaveAttribute('src', /^data:image\/png;base64,/)
  })

  test('leaves VESPR branding alone when a genuine provider owns the key', async ({ page }) => {
    await installMockRuntime(page)
    await page.addInitScript(() => {
      ;(window as typeof window & { cardano: Record<string, unknown> }).cardano = {
        vespr: { name: 'Vespr' },
      }
    })
    await page.route('https://app.dexhunter.io/genuine-vespr-test', route => route.fulfill({
      contentType: 'text/html',
      body: `<!doctype html><html><body>
        <div id="vespr-tile">
          <div><img alt="Vespr wallet" src="https://storage.googleapis.com/dexhunter-images/public/vespr.svg"></div>
          <div><span>Vespr</span></div>
        </div>
      </body></html>`,
    }))
    await page.goto('https://app.dexhunter.io/genuine-vespr-test')
    await page.addScriptTag({ path: extensionFile('inject.js') })

    await expect(page.locator('#vespr-tile')).toContainText('Vespr')
    await expect(page.locator('#vespr-tile img')).toHaveAttribute('alt', 'Vespr wallet')
    await expect(page.locator('#vespr-tile img')).toHaveAttribute('src', /\/vespr\.svg$/)
  })

  test('blocks direct page attempts to call internal wallet methods', async ({ page }) => {
    await loadExtensionPageScripts(page, ['content.js'])

    const sensitiveMethods = [
      ['wallet:reveal-seed', ['pw']],
      ['wallet:unlock', ['pw']],
      ['wallet:get-addresses', []],
      ['swap:execute', [{ provider: '0x' }]],
      ['web3:get-pending-sign', []],
    ] as const

    for (const [type, args] of sensitiveMethods) {
      const result = await requestViaPageMessage(page, type, [...args]) as { error?: string }
      expect(result.error).toContain('Wallet method not available to web pages')
    }

    const forwarded = await page.evaluate(() => (window as typeof window & { __mmRuntimeMessages: RuntimeMessage[] }).__mmRuntimeMessages)
    expect(forwarded).toEqual([])
  })

  test('still forwards provider RPC calls through the approved public route', async ({ page }) => {
    await loadExtensionPageScripts(page, ['content.js'])

    const result = await requestViaPageMessage(page, 'web3:request', [{ method: 'eth_chainId', params: [] }]) as { result?: unknown; error?: string }
    expect(result.error).toBeUndefined()
    expect(result.result).toBe('0x1')

    const forwarded = await page.evaluate(() => (window as typeof window & { __mmRuntimeMessages: RuntimeMessage[] }).__mmRuntimeMessages)
    expect(forwarded).toMatchObject([{ type: 'web3:request' }])
  })

  test('injected EIP-1193 provider routes requests without exposing wallet internals', async ({ page }) => {
    await loadExtensionPageScripts(page, ['content.js', 'inject.js'])

    await expect(page.evaluate(() => Boolean((window as typeof window & { ethereum?: unknown }).ethereum))).resolves.toBe(true)
    await expect(page.evaluate(() => (
      window as typeof window & {
        ethereum: { request: (req: { method: string; params?: unknown[] }) => Promise<unknown> }
      }
    ).ethereum.request({ method: 'eth_chainId' }))).resolves.toBe('0x1')

    const forwarded = await page.evaluate(() => (window as typeof window & { __mmRuntimeMessages: RuntimeMessage[] }).__mmRuntimeMessages)
    expect(forwarded).toMatchObject([{ type: 'web3:request' }])
    expect(forwarded.some((msg) => msg.type.startsWith('wallet:'))).toBe(false)
  })
})
