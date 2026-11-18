import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve, sep } from 'node:path'

/** Project-relative path → absolute path, refusing anything that would escape the project root. */
export async function resolveInside(root: string, relPath: string): Promise<string> {
  if (typeof relPath !== 'string' || relPath.length === 0 || relPath.includes('\0')) throw new Error('Invalid path')
  if (isAbsolute(relPath) || /^[a-zA-Z]:/.test(relPath)) throw new Error('Path must be relative to the project')
  const segments = relPath.split(/[\\/]/)
  if (segments.some((s) => s === '..')) throw new Error('Path escapes the project')
  const full = resolve(root, join(...segments))
  const rootResolved = resolve(root)
  if (full !== rootResolved && !full.startsWith(rootResolved + sep)) throw new Error('Path escapes the project')
  // symlinks inside the project could point outside it
  const [realFull, realRoot] = await Promise.all([fs.realpath(full), fs.realpath(rootResolved)])
  if (realFull !== realRoot && !realFull.startsWith(realRoot + sep)) throw new Error('Path escapes the project')
  return full
}

export interface DecodedFile {
  content: string
  binary: boolean
  hash: string
}

/** Decodes bytes as text: handles UTF-8 BOM, UTF-16 LE/BE BOMs, and normalizes CRLF/CR to LF. */
export function decodeText(buf: Buffer): { content: string; binary: boolean } {
  let content: string
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    content = buf.subarray(2).toString('utf16le')
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2))
    swapped.swap16()
    content = swapped.toString('utf16le')
  } else {
    // a NUL byte in the first 8 KB means it isn't text
    if (buf.subarray(0, 8000).includes(0)) return { content: '', binary: true }
    const start = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? 3 : 0
    content = buf.subarray(start).toString('utf8')
  }
  return { content: content.replace(/\r\n?/g, '\n'), binary: false }
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16)
}

interface CacheEntry {
  mtimeMs: number
  size: number
  file: DecodedFile
}

/** Reads and decodes project files, cached by mtime + size so repeated estimates stay cheap. */
export class FileReader {
  private cache = new Map<string, CacheEntry>()

  constructor(private root: string) {}

  async read(relPath: string): Promise<DecodedFile & { mtimeMs: number }> {
    const full = await resolveInside(this.root, relPath)
    const stat = await fs.stat(full)
    const cached = this.cache.get(relPath)
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return { ...cached.file, mtimeMs: stat.mtimeMs }
    const decoded = decodeText(await fs.readFile(full))
    const file: DecodedFile = { ...decoded, hash: hashContent(decoded.content) }
    this.cache.set(relPath, { mtimeMs: stat.mtimeMs, size: stat.size, file })
    return { ...file, mtimeMs: stat.mtimeMs }
  }
}
