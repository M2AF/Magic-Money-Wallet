// Electron stub for extension build — replaces 'electron' imports so shared
// business logic files can be bundled in the service worker without modification.

export const app = {
  getPath: (_: string) => '/ext'
}

export const BrowserWindow = {
  getAllWindows: () => [] as { webContents: { send: (ch: string, d: unknown) => void } }[]
}

export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: (s: string) => Buffer.from(s),
  decryptString: (b: Buffer) => b.toString('utf-8')
}

export const ipcMain = {
  handle: () => {},
  on: () => {}
}

export const dialog = {
  showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] })
}

export const shell = { openExternal: async (_: string) => {} }

export default { app, BrowserWindow, safeStorage, ipcMain, dialog, shell }
