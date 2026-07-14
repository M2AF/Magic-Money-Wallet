/**
 * offscreen-rpc.ts — service-worker side of the offscreen-document RPC.
 *
 * The MV3 service worker can neither spawn Web Workers nor use dynamic
 * import(), so all WASM-heavy work (monero-ts chain scanning, ledger-v9
 * Midnight key crypto) runs in a Chrome offscreen document (reason: WORKERS)
 * and the SW talks to it over chrome.runtime messaging.
 *
 * Messages are JSON-serialized by Chrome — binary payloads must travel as hex
 * (see midnight-ledger.ts / monero.ts proxies). background.ts ignores messages
 * carrying this target marker so they only reach the offscreen listener.
 */

export const OFFSCREEN_TARGET = 'mm-offscreen'

let _creating: Promise<void> | null = null

async function ensureOffscreen(): Promise<void> {
  const offscreen = chrome.offscreen
  if (!offscreen) throw new Error('Offscreen API unavailable (Chrome too old?)')
  // hasDocument is the supported existence probe on modern Chrome.
  if (await offscreen.hasDocument?.().catch(() => false)) return
  if (!_creating) {
    _creating = offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS' as chrome.offscreen.Reason],
      justification: 'Monero chain scanning and Midnight key derivation run WASM in Web Workers, which service workers cannot spawn.',
    }).catch((e: unknown) => {
      // Racing a concurrent create is fine — "Only a single offscreen document may be created".
      if (!String(e).toLowerCase().includes('single offscreen')) throw e
    }).finally(() => { _creating = null })
  }
  await _creating
}

export async function callOffscreen<T>(op: string, args: unknown): Promise<T> {
  await ensureOffscreen()
  const res = await chrome.runtime.sendMessage({ target: OFFSCREEN_TARGET, op, args }) as
    { ok: true; data: T } | { ok: false; error: string } | undefined
  if (!res) throw new Error('Offscreen document did not respond')
  if (!res.ok) throw new Error(res.error)
  return res.data
}
