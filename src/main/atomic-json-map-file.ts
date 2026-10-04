/**
 * atomic-json-map-file.ts — a JSON file holding a string → string map, updated
 * so that an interruption can never lose or corrupt what was there.
 *
 *   • WRITE: the new map goes to `<path>.tmp`, is flushed to disk (fsync), and
 *     is then renamed over `<path>`. A crash before the rename leaves the old
 *     file untouched; the rename itself replaces the file in one step. Any
 *     failure throws, and the old file is still the old file.
 *   • READ: a missing file is an empty map. A file that exists but is not a
 *     well-formed string map THROWS `JsonMapFileError` — it is never read as
 *     empty, so a following read-modify-write cannot overwrite the damaged
 *     records with nothing.
 *
 * `fs` is injected, so interruption at each step can be tested.
 */

export interface JsonMapFs {
  existsSync(path: string): boolean
  readFileSync(path: string, encoding: 'utf-8'): string
  writeFileSync(path: string, data: string): void
  renameSync(from: string, to: string): void
  unlinkSync(path: string): void
  openSync(path: string, flags: string): number
  fsyncSync(fd: number): void
  closeSync(fd: number): void
  mkdirSync(path: string, opts: { recursive: true }): void
}

export class JsonMapFileError extends Error {
  constructor(readonly kind: 'corrupt' | 'write-failed', message: string) { super(message) }
}

/** Read the map. Missing → {}; unreadable or not a string map → throws. */
export function readJsonMapFile(fs: JsonMapFs, path: string): Record<string, string> {
  const raw = readJsonObjectFile(fs, path)
  if (Object.values(raw).some(v => typeof v !== 'string')) {
    throw new JsonMapFileError('corrupt', 'The stored data file is not in the expected format; it was left untouched.')
  }
  return raw as Record<string, string>
}

/** Same atomic store format, allowing nested evidence records as values. */
export function readJsonObjectFile(fs: JsonMapFs, path: string): Record<string, unknown> {
  if (!fs.existsSync(path)) return {}
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(path, 'utf-8'))
  } catch {
    throw new JsonMapFileError('corrupt', 'The stored data file is unreadable; it was left untouched.')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new JsonMapFileError('corrupt', 'The stored data file is not in the expected format; it was left untouched.')
  }
  return raw as Record<string, unknown>
}

/** Replace the map atomically (temp file, fsync, rename). Throws on any failure; the old file survives. */
export function writeJsonMapFileAtomic(fs: JsonMapFs, dir: string, path: string, map: Record<string, string>): void {
  writeJsonObjectFileAtomic(fs, dir, path, map)
}

export function writeJsonObjectFileAtomic(fs: JsonMapFs, dir: string, path: string, map: unknown): void {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new JsonMapFileError('write-failed', 'The data file was not written: invalid record map.')
  }
  const tmp = `${path}.tmp`
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(tmp, JSON.stringify(map))
    const fd = fs.openSync(tmp, 'r+')
    try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
    fs.renameSync(tmp, path)
  } catch {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp) } catch { /* the old file is intact either way */ }
    throw new JsonMapFileError('write-failed', 'The data file could not be written; the previous version was kept.')
  }
}
