import type { BrowserContext } from '@playwright/test'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isWorkerUrl, workerStubResponse } = require('./worker-stub.cjs') as {
  isWorkerUrl(url: string): boolean
  workerStubResponse(url: string, method: string, bodyText: string | null): { status: number; body: string }
}

/**
 * Answer every request to the MagicMoney Worker from the shared e2e stub, so an
 * extension spec never spends the live Worker's daily quota (see
 * worker-stub.cjs). Call it right after launching the context: routes a spec
 * registers afterwards take precedence over this one.
 *
 * The extension's service worker is covered too — playwright.config.ts turns
 * on PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS, without which background
 * fetches bypass context.route.
 */
export async function stubWorker(ctx: BrowserContext): Promise<void> {
  await ctx.route(url => isWorkerUrl(url.href), async route => {
    const req = route.request()
    const { status, body } = workerStubResponse(req.url(), req.method(), req.postData())
    await route.fulfill({ status, body, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' } })
  })
}
