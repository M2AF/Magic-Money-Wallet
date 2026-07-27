/**
 * Turn a rejected IPC call into the message the main process actually threw.
 *
 * Electron wraps handler errors twice, so a thrown `new Error('Bad RPC')` arrives
 * in the renderer as:
 *   "Error: Error invoking remote method 'wallet:x': Error: Bad RPC"
 * Order matters — the outer "Error: " has to come off BEFORE the remote-method
 * wrapper can be matched, or the user sees the plumbing instead of the reason.
 */
export function ipcErrorMessage(err: unknown): string {
  return String(err)
    .replace(/^Error:\s*/, '')
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
    .trim()
}
