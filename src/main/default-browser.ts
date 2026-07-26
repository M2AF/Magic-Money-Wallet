/**
 * default-browser.ts — MagicMoney Wallet
 *
 * Lets the user pick MagicMoney as the system's default web browser, so links
 * clicked anywhere in Windows open in the built-in dApp browser.
 *
 * Windows will NOT let an app make itself the default browser — that has been a
 * user-only decision since Windows 10 (the UserChoice key is hash-protected).
 * What an app CAN do is *register itself as a candidate*, which is what
 * `register()` does, and then send the user to Settings → Default apps to
 * confirm. The two required halves are:
 *
 *   1. A ProgId (MagicMoneyHTML) whose shell\open\command launches the exe with
 *      the URL as argv — index.ts turns that argv into a browser tab.
 *   2. A `StartMenuInternet` client entry + `Capabilities\URLAssociations`
 *      mapping http/https to that ProgId, cross-listed under
 *      RegisteredApplications. This is what makes Windows show MagicMoney in the
 *      "Web browser" default-app list at all.
 *
 * Everything is written under HKCU, so no elevation is needed and nothing is
 * changed for other users of the machine. Registration only happens when the
 * user explicitly asks (Settings row) and only in a packaged build — pointing
 * the system browser at an unpackaged `electron.exe` dev binary would be wrong.
 *
 * macOS/Linux: `app.setAsDefaultProtocolClient` is the whole story there and is
 * a no-op-ish best effort, so those platforms report `supported: false` and the
 * Settings row stays hidden rather than promising something we can't verify.
 */

import { app, shell } from 'electron'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/** Registry-visible identifiers. Changing these orphans a prior registration. */
const APP_KEY = 'MagicMoney'
const PROG_ID = 'MagicMoneyHTML'
const APP_NAME = 'MagicMoney Wallet'
const APP_DESCRIPTION = 'Multi-chain crypto wallet with a built-in dApp browser'

export interface DefaultBrowserState {
  /** False on non-Windows or in dev — the renderer hides the row entirely. */
  supported: boolean
  /** MagicMoney appears in the Windows default-apps list. */
  registered: boolean
  /** MagicMoney currently owns the https:// association. */
  isDefault: boolean
}

const UNSUPPORTED: DefaultBrowserState = { supported: false, registered: false, isDefault: false }

function isSupported(): boolean {
  return process.platform === 'win32' && (app.isPackaged || process.env['MM_FORCE_DEFAULT_BROWSER_UI'] === '1')
}

async function reg(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('reg.exe', args, { windowsHide: true })
  return stdout
}

/** reg.exe exits non-zero when a key/value is missing — treat that as "absent". */
async function regQuery(key: string, value?: string): Promise<string | null> {
  try {
    const out = await reg(value ? ['query', key, '/v', value] : ['query', key])
    if (!value) return out
    // "    ProgId    REG_SZ    MagicMoneyHTML"
    const match = out.match(new RegExp(`${value}\\s+REG_[A-Z_]+\\s+(.*)`, 'i'))
    return match ? match[1]!.trim() : null
  } catch {
    return null
  }
}

async function regAdd(key: string, value: string | null, data: string): Promise<void> {
  const args = ['add', key, '/f', '/t', 'REG_SZ', '/d', data]
  if (value === null) args.splice(2, 0, '/ve')
  else args.splice(2, 0, '/v', value)
  await reg(args)
}

const CLIENT_KEY = `HKCU\\Software\\Clients\\StartMenuInternet\\${APP_KEY}`
const CAPABILITIES = `${CLIENT_KEY}\\Capabilities`
const PROG_ID_KEY = `HKCU\\Software\\Classes\\${PROG_ID}`

/** Writes every key Windows needs to list MagicMoney as a browser candidate. */
async function register(): Promise<void> {
  const exe = process.execPath
  const icon = `${exe},0`
  const openCommand = `"${exe}" "%1"`

  // 1 — the document type our URLs open with
  await regAdd(PROG_ID_KEY, null, `${APP_NAME} HTML Document`)
  await regAdd(`${PROG_ID_KEY}\\DefaultIcon`, null, icon)
  await regAdd(`${PROG_ID_KEY}\\shell\\open\\command`, null, openCommand)

  // 2 — the "internet client" entry Settings enumerates
  await regAdd(CLIENT_KEY, null, APP_NAME)
  await regAdd(`${CLIENT_KEY}\\DefaultIcon`, null, icon)
  await regAdd(`${CLIENT_KEY}\\shell\\open\\command`, null, `"${exe}"`)
  await regAdd(CAPABILITIES, 'ApplicationName', APP_NAME)
  await regAdd(CAPABILITIES, 'ApplicationIcon', icon)
  await regAdd(CAPABILITIES, 'ApplicationDescription', APP_DESCRIPTION)
  await regAdd(`${CAPABILITIES}\\StartMenu`, 'StartMenuInternet', APP_KEY)
  // Only URL associations — no FileAssociations, because the wallet deliberately
  // does not open local .html files.
  await regAdd(`${CAPABILITIES}\\URLAssociations`, 'http', PROG_ID)
  await regAdd(`${CAPABILITIES}\\URLAssociations`, 'https', PROG_ID)

  // 3 — cross-list so Windows reads the capabilities above
  await regAdd(
    'HKCU\\Software\\RegisteredApplications',
    APP_KEY,
    `Software\\Clients\\StartMenuInternet\\${APP_KEY}\\Capabilities`
  )

  // Belt-and-braces: also claim the protocols through Electron's own helper so
  // "Open with" lists us even before the user visits Settings.
  app.setAsDefaultProtocolClient('http')
  app.setAsDefaultProtocolClient('https')
}

async function isRegistered(): Promise<boolean> {
  return (await regQuery('HKCU\\Software\\RegisteredApplications', APP_KEY)) !== null
}

/**
 * The live https association. UserChoice is written by Windows itself when the
 * user picks a browser, so it is the only trustworthy "am I default?" signal.
 */
async function isDefault(): Promise<boolean> {
  const progId = await regQuery(
    'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice',
    'ProgId'
  )
  return progId === PROG_ID
}

export async function getDefaultBrowserState(): Promise<DefaultBrowserState> {
  if (!isSupported()) return UNSUPPORTED
  try {
    const [registered, dflt] = await Promise.all([isRegistered(), isDefault()])
    return { supported: true, registered, isDefault: dflt }
  } catch {
    return { supported: true, registered: false, isDefault: false }
  }
}

/**
 * Register (idempotent) and open the Windows default-apps page so the user can
 * confirm. Windows 11 accepts a `registeredAppUser` hint that deep-links
 * straight to our entry; older builds ignore the query and show the list.
 */
export async function requestDefaultBrowser(): Promise<DefaultBrowserState> {
  if (!isSupported()) return UNSUPPORTED
  try {
    await register()
  } catch (e) {
    console.error('[DefaultBrowser] registration failed:', e)
  }
  try {
    await shell.openExternal(`ms-settings:defaultapps?registeredAppUser=${encodeURIComponent(APP_NAME)}`)
  } catch {
    await shell.openExternal('ms-settings:defaultapps').catch(() => {})
  }
  return getDefaultBrowserState()
}
