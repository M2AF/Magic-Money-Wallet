/**
 * browser-context-menu.ts — right-click menu for dApp browser tabs
 *
 * Electron gives a WebContentsView NO context menu at all: right-clicking a page
 * in the built-in browser did nothing, so images and links could not be saved,
 * copied or opened in a new tab. This builds the same menu other browsers offer,
 * from the `context-menu` event's params.
 *
 * Saving goes through webContents.downloadURL(), which lands in the dApp
 * session's `will-download` handler (browser-manager's initBrowserDownloads) —
 * that is what actually writes the file and reports progress.
 */

import { Menu, clipboard, shell } from 'electron'
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions, WebContents } from 'electron'

export interface ContextMenuHooks {
  /** Open `url` as a new tab in the browser. */
  openInNewTab: (url: string) => void
  /** Download `url`; `saveAs` prompts for a location instead of auto-saving. */
  download: (wc: WebContents, url: string, saveAs: boolean) => void
  /** Window to anchor the popup to. */
  window: () => BrowserWindow | null
}

const isWebUrl = (url: string | undefined): url is string =>
  typeof url === 'string' && /^https?:\/\//i.test(url)

/** A data:/blob: image can be copied but not downloaded by URL. */
const isImage = (params: ContextMenuParams): boolean =>
  params.mediaType === 'image' && !!params.srcURL

export function showBrowserContextMenu(
  wc: WebContents,
  params: ContextMenuParams,
  hooks: ContextMenuHooks
): void {
  const items: MenuItemConstructorOptions[] = []
  const push = (item: MenuItemConstructorOptions): void => { items.push(item) }
  const separator = (): void => {
    if (items.length > 0 && items[items.length - 1].type !== 'separator') push({ type: 'separator' })
  }

  // ── Link ────────────────────────────────────────────────────────────────
  if (isWebUrl(params.linkURL)) {
    const link = params.linkURL
    push({ label: 'Open link in new tab', click: () => hooks.openInNewTab(link) })
    push({ label: 'Copy link address', click: () => clipboard.writeText(link) })
    push({ label: 'Save link as…', click: () => hooks.download(wc, link, true) })
    separator()
  }

  // ── Image ───────────────────────────────────────────────────────────────
  if (isImage(params)) {
    const src = params.srcURL
    if (isWebUrl(src)) {
      push({ label: 'Open image in new tab', click: () => hooks.openInNewTab(src) })
    }
    // copyImageAt puts the decoded BITMAP on the clipboard (paste into an editor),
    // which is what "Copy image" means everywhere else — distinct from copying
    // its address. Works for data:/blob: images too.
    push({ label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) })
    push({ label: 'Copy image address', click: () => clipboard.writeText(src) })
    if (isWebUrl(src)) {
      push({ label: 'Save image as…', click: () => hooks.download(wc, src, true) })
    }
    separator()
  }

  // ── Video / audio ───────────────────────────────────────────────────────
  if ((params.mediaType === 'video' || params.mediaType === 'audio') && isWebUrl(params.srcURL)) {
    const src = params.srcURL
    push({ label: `Copy ${params.mediaType} address`, click: () => clipboard.writeText(src) })
    push({ label: `Save ${params.mediaType} as…`, click: () => hooks.download(wc, src, true) })
    separator()
  }

  // ── Editable field ──────────────────────────────────────────────────────
  if (params.isEditable) {
    push({ role: 'undo', enabled: params.editFlags.canUndo })
    push({ role: 'redo', enabled: params.editFlags.canRedo })
    separator()
    push({ role: 'cut', enabled: params.editFlags.canCut })
    push({ role: 'copy', enabled: params.editFlags.canCopy })
    push({ role: 'paste', enabled: params.editFlags.canPaste })
    push({ role: 'selectAll' })
    separator()
  } else if (params.selectionText) {
    const text = params.selectionText.trim()
    push({ role: 'copy' })
    if (text) {
      const query = text.length > 80 ? `${text.slice(0, 77)}…` : text
      push({
        label: `Search the web for “${query}”`,
        click: () => hooks.openInNewTab(`https://duckduckgo.com/?q=${encodeURIComponent(text)}`),
      })
    }
    separator()
  }

  // ── Page ────────────────────────────────────────────────────────────────
  push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() })
  push({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() })
  push({ label: 'Reload', click: () => wc.reload() })
  separator()
  push({
    label: 'Copy page address',
    click: () => clipboard.writeText(wc.getURL()),
  })
  push({
    label: 'Open page in system browser',
    click: () => {
      const url = wc.getURL()
      if (isWebUrl(url)) shell.openExternal(url)
    },
  })
  push({ type: 'separator' })
  push({
    label: 'Inspect element',
    click: () => wc.inspectElement(params.x, params.y),
  })

  const win = hooks.window()
  const menu = Menu.buildFromTemplate(items)
  if (win && !win.isDestroyed()) menu.popup({ window: win })
  else menu.popup()
}
