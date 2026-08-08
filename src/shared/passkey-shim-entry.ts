/**
 * passkey-shim-entry.ts — MagicMoney Wallet
 *
 * Electron entry point for the page-world passkey shim. esbuild bundles this to
 * out/inject/passkey-shim.js as an IIFE (see build:inject); web3-inject reads
 * that file and evaluates it in the dApp page's MAIN world via
 * webFrame.executeJavaScript.
 *
 * It has to be a separate bundle rather than an import: the preload is typed
 * without the DOM lib and runs in an isolated world, so a `navigator.credentials`
 * patch made there would never be visible to the page.
 *
 * The transport is `__mmBridge__`, the contextBridge relay web3-inject already
 * exposes for every other provider call.
 */

import { installPasskeyShim, type PasskeyShimTransport } from './passkey-shim'

interface MmBridge { call(channel: string, args: unknown[]): Promise<Record<string, unknown>> }

const bridge = (globalThis as unknown as { __mmBridge__?: MmBridge }).__mmBridge__

if (bridge) {
  const send: PasskeyShimTransport = (type, payload) => bridge.call(type, [payload])
  installPasskeyShim(send)
}
