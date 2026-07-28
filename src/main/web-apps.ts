/**
 * web-apps.ts — MagicMoney Wallet
 *
 * "Install this page as an app": creates an OS shortcut that launches MagicMoney
 * with the page's URL, so the site gets a Start-menu/desktop entry that opens
 * inside the MagicMoney browser instead of the system default browser.
 *
 * The launch path already exists — index.ts's urlFromArgv() picks the first
 * http(s) argument out of argv and hands it to openBrowserWithUrl(), which is the
 * same route Windows uses when MagicMoney is the registered default browser. So a
 * shortcut is just `MagicMoney.exe "https://site"`; no new protocol or flag.
 *
 * Windows  — .lnk via WScript.Shell (PowerShell, no native module)
 * Linux    — .desktop entry in ~/.local/share/applications
 * macOS    — unsupported: a Dock/Launchpad entry requires a real signed .app
 *            bundle, and this project deliberately has no Apple certificate.
 *            installWebApp reports that instead of writing something that
 *            wouldn't work.
 */

import { app } from 'electron'
import { spawn } from 'child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { recordWebApp, forgetWebApp, findWebApp, getWebApps, type WebApp } from './browser-store'

export interface WebAppInstallResult {
  ok: boolean
  /** Where the shortcut landed, for the "Installed to …" confirmation. */
  path?: string
  apps: WebApp[]
  error?: string
}

/** Can this platform create app shortcuts at all? Drives whether the row is shown. */
export function webAppsSupported(): boolean {
  return process.platform === 'win32' || process.platform === 'linux'
}

/** Strip anything that can't be a file name (or could escape the target folder). */
function sanitizeName(raw: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 60)
  return cleaned || 'Web App'
}

/**
 * Arguments the shortcut passes to MagicMoney. Packaged builds are the exe
 * itself; in dev, process.execPath is electron.exe and needs the app directory
 * as its first argument before the URL.
 */
function launchArgs(url: string): string[] {
  return app.isPackaged ? [url] : [app.getAppPath(), url]
}

/** Icon for the shortcut: the packaged browser icon, else the executable's own. */
function iconPath(): string {
  const packaged = join(process.resourcesPath ?? '', 'browser-icon.ico')
  if (app.isPackaged && existsSync(packaged)) return packaged
  return process.execPath
}

function psStr(v: string): string {
  return "'" + v.replace(/'/g, "''") + "'"
}

function runPowerShell(script: string): Promise<{ ok: boolean; error?: string }> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  return new Promise(resolve => {
    let stderr = ''
    let child
    try {
      child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true })
    } catch (e) {
      resolve({ ok: false, error: String(e) })
      return
    }
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', e => resolve({ ok: false, error: String(e) }))
    child.on('close', code => resolve(code === 0 ? { ok: true } : { ok: false, error: stderr.trim() || `PowerShell exited ${code}` }))
  })
}

/** Where installed app shortcuts live, so they're grouped and easy to remove. */
function windowsShortcutDir(): string {
  const appData = process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming')
  return join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'MagicMoney Apps')
}

function linuxShortcutDir(): string {
  const dataHome = process.env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share')
  return join(dataHome, 'applications')
}

async function installWindows(name: string, url: string): Promise<{ path?: string; error?: string }> {
  const dir = windowsShortcutDir()
  const target = join(dir, `${name}.lnk`)
  // Quote each argument so URLs with & or spaces survive the shell.
  const args = launchArgs(url).map(a => `"${a}"`).join(' ')
  const script = `
$ErrorActionPreference = 'Stop'
$dir = ${psStr(dir)}
if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
$shell = New-Object -ComObject WScript.Shell
$lnk = $shell.CreateShortcut(${psStr(target)})
$lnk.TargetPath = ${psStr(process.execPath)}
$lnk.Arguments = ${psStr(args)}
$lnk.WorkingDirectory = ${psStr(process.cwd())}
$lnk.IconLocation = ${psStr(iconPath())}
$lnk.Description = ${psStr(`${name} — opens in MagicMoney Browser`)}
$lnk.Save()
`.trim()

  const result = await runPowerShell(script)
  if (!result.ok) return { error: result.error || 'Could not create the shortcut' }
  return { path: target }
}

function installLinux(name: string, url: string): { path?: string; error?: string } {
  const dir = linuxShortcutDir()
  const file = join(dir, `magicmoney-${sanitizeName(name).toLowerCase().replace(/\s+/g, '-')}.desktop`)
  const exec = [process.execPath, ...launchArgs(url)].map(a => `"${a}"`).join(' ')
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    `Name=${name}`,
    `Comment=${name} — opens in MagicMoney Browser`,
    `Exec=${exec}`,
    'Terminal=false',
    'Categories=Network;WebBrowser;',
    '',
  ].join('\n')
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, content, 'utf-8')
    chmodSync(file, 0o755)
    return { path: file }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Could not create the desktop entry' }
  }
}

/**
 * Create the shortcut and remember it. Re-installing the same URL replaces the
 * previous record (recordWebApp de-duplicates on canonical URL).
 */
export async function installWebApp(url: string, rawName: string): Promise<WebAppInstallResult> {
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, apps: getWebApps(), error: 'Only web pages can be installed as apps' }
  }
  if (!webAppsSupported()) {
    return {
      ok: false,
      apps: getWebApps(),
      error: 'Installing pages as apps needs a signed application bundle on macOS, which MagicMoney does not ship. Bookmark the page instead.',
    }
  }

  const name = sanitizeName(rawName || new URL(url).hostname)
  const result = process.platform === 'win32'
    ? await installWindows(name, url)
    : installLinux(name, url)

  if (result.error || !result.path) {
    return { ok: false, apps: getWebApps(), error: result.error || 'Could not create the shortcut' }
  }

  const apps = recordWebApp({ url, name, shortcutPath: result.path })
  return { ok: true, path: result.path, apps }
}

/** Remove the shortcut file and the record. Missing files are not an error. */
export function uninstallWebApp(id: string): WebApp[] {
  const target = getWebApps().find(a => a.id === id)
  if (target?.shortcutPath) {
    try { rmSync(target.shortcutPath, { force: true }) } catch { /* already gone / no permission */ }
  }
  return forgetWebApp(id)
}

export function isWebAppInstalled(url: string): boolean {
  return findWebApp(url) !== undefined
}
