/**
 * fetch-guard.ts — AbortSignal semantics over CapacitorHttp's patched fetch
 *
 * With CapacitorHttp enabled, Capacitor replaces window.fetch with a native
 * passthrough (that's what bypasses WebView CORS, matching Electron's Node
 * fetch and the extension's host_permissions). The catch: the patched fetch
 * IGNORES `signal`, and this codebase leans on `AbortSignal.timeout(...)` in
 * nearly every fetcher — without this guard a stalled native call would hang
 * the JS promise forever instead of rejecting.
 *
 * The guard re-arms rejection: when the signal fires, the JS promise rejects
 * immediately (the native request may still complete in the background — its
 * result is discarded). Under a real browser fetch (vite dev in a desktop
 * browser) the double-abort path is harmless: the first rejection wins.
 *
 * Must be installed AFTER Capacitor has patched fetch (i.e. at module-eval time
 * of main.tsx, which runs after capacitor's runtime injects).
 */

export function installFetchGuard(): void {
  const patched = window.fetch.bind(window)

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? (input instanceof Request ? input.signal : undefined)
    if (!signal) return patched(input, init)

    if (signal.aborted) {
      return Promise.reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
    }

    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => {
        reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      patched(input, init).then(
        v => { signal.removeEventListener('abort', onAbort); resolve(v) },
        e => { signal.removeEventListener('abort', onAbort); reject(e) }
      )
    })
  }) as typeof window.fetch
}
