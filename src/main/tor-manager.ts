/**
 * Managed Tor runtime for the Electron dApp browser.
 *
 * On Windows, first use downloads the Tor Project's signed Expert Bundle release
 * from its official archive. The archive SHA-256 is pinned here after verifying
 * the accompanying OpenPGP signature with the Tor Browser Developers key.
 * Installed files live under Electron userData, never inside the source tree.
 */

import { app, net } from 'electron'
import { createHash } from 'crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, posix, resolve, sep } from 'path'
import { gunzipSync } from 'zlib'

const TOR_BUNDLE_VERSION = '15.0.18'
const TOR_DOWNLOAD = {
  url: 'https://archive.torproject.org/tor-package-archive/torbrowser/15.0.18/tor-expert-bundle-windows-x86_64-15.0.18.tar.gz',
  sha256: '6ac067402c7b4a3dc37887ed3754b3914b67fdc220c966190683e9ccf91abf0f',
}
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024

let managedProcess: ChildProcessWithoutNullStreams | null = null
let managedReady: Promise<void> | null = null

function managedRoot(): string {
  return join(app.getPath('userData'), 'tor-runtime')
}

function bundleRoot(): string {
  return join(managedRoot(), TOR_BUNDLE_VERSION)
}

function cachedTorExecutable(): string {
  return join(bundleRoot(), 'tor', 'tor.exe')
}

function packagedTorExecutable(): string | null {
  const candidates = [
    join(process.resourcesPath, 'tor', 'tor.exe'),
    join(app.getAppPath(), 'resources', 'tor', 'tor.exe'),
  ]
  return candidates.find(existsSync) ?? null
}

function safeChild(root: string, relative: string): string {
  const normalized = posix.normalize(relative.replace(/\\/g, '/'))
  if (!normalized || normalized === '.' || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new Error('Unsafe path in Tor archive')
  }
  const target = resolve(root, ...normalized.split('/'))
  const rootPrefix = `${resolve(root)}${sep}`
  if (!target.startsWith(rootPrefix)) throw new Error('Tor archive path escaped its install directory')
  return target
}

function headerString(buffer: Buffer, start: number, length: number): string {
  const end = buffer.indexOf(0, start)
  return buffer.subarray(start, end >= start && end < start + length ? end : start + length).toString('utf8').trim()
}

function headerOctal(buffer: Buffer, start: number, length: number): number {
  const value = headerString(buffer, start, length).replace(/\0/g, '').trim()
  return value ? parseInt(value, 8) : 0
}

/** Minimal, path-hardened ustar extractor for the official Expert Bundle. */
function extractTarGz(archive: Buffer, destination: string): void {
  const tar = gunzipSync(archive)
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break
    const name = headerString(header, 0, 100)
    const prefix = headerString(header, 345, 155)
    const relative = prefix ? `${prefix}/${name}` : name
    const size = headerOctal(header, 124, 12)
    const type = String.fromCharCode(header[156] || 48)
    const target = safeChild(destination, relative)
    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > tar.length) throw new Error('Truncated Tor archive')

    if (type === '5') {
      mkdirSync(target, { recursive: true })
    } else if (type === '0' || type === '\0') {
      mkdirSync(resolve(target, '..'), { recursive: true })
      writeFileSync(target, tar.subarray(dataStart, dataEnd))
    }
    offset = dataStart + Math.ceil(size / 512) * 512
  }
}

async function installTor(onProgress: (message: string) => void): Promise<string> {
  const cached = cachedTorExecutable()
  if (existsSync(cached)) return cached
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Automatic Tor setup is currently available for 64-bit Windows. Start a local Tor service on port 9050 or 9150.')
  }

  onProgress('Downloading the verified Tor Expert Bundle (first use only)…')
  const response = await net.fetch(TOR_DOWNLOAD.url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Tor download failed (${response.status})`)
  const archive = Buffer.from(await response.arrayBuffer())
  if (archive.length === 0 || archive.length > MAX_ARCHIVE_BYTES) throw new Error('Tor download had an unexpected size')
  const digest = createHash('sha256').update(archive).digest('hex')
  if (digest !== TOR_DOWNLOAD.sha256) throw new Error('Tor download integrity check failed')

  onProgress('Installing the verified Tor runtime…')
  const root = managedRoot()
  const target = bundleRoot()
  const temporary = `${target}.installing-${process.pid}`
  mkdirSync(root, { recursive: true })
  rmSync(temporary, { recursive: true, force: true })
  mkdirSync(temporary, { recursive: true })
  try {
    extractTarGz(archive, temporary)
    const extractedExe = join(temporary, 'tor', 'tor.exe')
    if (!existsSync(extractedExe)) throw new Error('Tor executable was missing from the verified bundle')
    rmSync(target, { recursive: true, force: true })
    renameSync(temporary, target)
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true })
    throw error
  }
  return cached
}

function startTor(executable: string, port: number, onProgress: (message: string) => void): Promise<void> {
  const dataDirectory = join(managedRoot(), 'data')
  const staticData = join(dirname(dirname(executable)), 'data')
  mkdirSync(dataDirectory, { recursive: true })
  const args = [
    '--SocksPort', `127.0.0.1:${port}`,
    '--DataDirectory', dataDirectory,
    '--GeoIPFile', join(staticData, 'geoip'),
    '--GeoIPv6File', join(staticData, 'geoip6'),
    '--ClientOnly', '1',
    '--AvoidDiskWrites', '1',
    '--Log', 'notice stdout',
  ]

  const child = spawn(executable, args, { windowsHide: true })
  child.stdin.end()
  managedProcess = child
  return new Promise((resolveReady, reject) => {
    let settled = false
    let lastError = ''
    const timeout = setTimeout(() => finish(new Error('Tor took too long to connect')), 90_000)

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) {
        try { child.kill() } catch { /* already stopped */ }
        if (managedProcess === child) managedProcess = null
        reject(error)
      } else {
        resolveReady()
      }
    }

    const consume = (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      lastError = `${lastError}\n${text}`.trim().slice(-1200)
      const matches = [...text.matchAll(/Bootstrapped (\d+)%[^:]*:?\s*([^\r\n]*)/g)]
      for (const match of matches) {
        const percent = Number(match[1])
        const detail = match[2]?.trim()
        onProgress(`Connecting to Tor… ${percent}%${detail ? ` · ${detail}` : ''}`)
        if (percent >= 100) finish()
      }
    }
    child.stdout.on('data', consume)
    child.stderr.on('data', consume)
    child.once('error', error => finish(error))
    child.once('exit', code => {
      if (!settled) finish(new Error(lastError || `Tor exited before connecting (${code ?? 'unknown'})`))
      if (managedProcess === child) managedProcess = null
    })
  })
}

export async function ensureManagedTor(port: number, onProgress: (message: string) => void): Promise<void> {
  if (managedProcess && !managedProcess.killed && managedReady) return managedReady
  const executable = packagedTorExecutable() ?? await installTor(onProgress)
  onProgress('Starting the private Tor service…')
  managedReady = startTor(executable, port, onProgress)
  try {
    await managedReady
  } catch (error) {
    managedReady = null
    throw error
  }
}

export function stopManagedTor(): void {
  const child = managedProcess
  managedProcess = null
  managedReady = null
  if (child && !child.killed) {
    try { child.kill() } catch { /* already stopped */ }
  }
}

// Referenced by tests/debugging without reading the downloaded binary.
export function managedTorInfo(): { version: string; sha256: string } {
  return { version: TOR_BUNDLE_VERSION, sha256: TOR_DOWNLOAD.sha256 }
}
