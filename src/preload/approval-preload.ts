/**
 * approval-preload.ts — MagicMoney Wallet
 *
 * Preload for the branded in-house approval/signing window (showApprovalWindow
 * in browser-manager.ts). The window's content is OUR own HTML, so we just need
 * a tiny secure bridge to send the user's decision back to the main process.
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('__mmApproval__', {
  respond: (approved: boolean) => ipcRenderer.send('approval:respond', !!approved)
})
