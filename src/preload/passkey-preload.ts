/**
 * passkey-preload.ts — bridge for the loopback passkey ceremony window.
 *
 * Deliberately tiny: it hands the page its ceremony parameters and takes back a
 * single result. The PRF entropy travels over Electron IPC (main ← renderer),
 * never over the loopback HTTP server, so the bytes never touch a socket any
 * other local process could read.
 */
import { contextBridge, ipcRenderer } from 'electron'

export interface PasskeyStartOptions {
  channel: string
  rpId: string
  rpName: string
  userName: string
}

contextBridge.exposeInMainWorld('mmPasskey', {
  /** Main sends the parameters once the page has loaded. */
  onStart: (fn: (opts: PasskeyStartOptions) => void) => {
    ipcRenderer.on('passkey:start', (_e, opts: PasskeyStartOptions) => fn(opts))
  },
  /** Reported exactly once; main tears the window down on receipt. */
  report: (channel: string, payload: unknown) => {
    ipcRenderer.send(channel, payload)
  },
})
