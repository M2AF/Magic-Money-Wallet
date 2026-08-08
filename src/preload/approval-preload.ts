/**
 * approval-preload.ts — MagicMoney Wallet
 *
 * Preload for the branded in-house approval/signing window (showApprovalWindow
 * in browser-manager.ts). The window's content is OUR own HTML, so we just need
 * a tiny secure bridge to send the user's decision back to the main process.
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('__mmApproval__', {
  respond: (approved: boolean) => ipcRenderer.send('approval:respond', !!approved),
  /**
   * Chooser form: carries WHICH entry was picked (a discoverable passkey
   * sign-in that matched several credentials). `choiceId` is whatever the radio
   * list held — main treats a non-string as absent, so a malformed selection
   * degrades to a plain approve rather than silently picking for the user.
   */
  respondWith: (approved: boolean, choiceId?: unknown) =>
    ipcRenderer.send('approval:respond', !!approved, typeof choiceId === 'string' ? choiceId : undefined),
})
