import { promises as fs } from 'node:fs'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { languageFor } from '../shared/languages'
import type { ComposeWarning, ContextItem, Preset, PresetInput, SecretFindingInfo, SkillSource } from '../shared/types'
import { blockReason } from '../tools/code/rules'
import { decodeText } from '../tools/code/files'
import type { ContextBlock, ContextSection } from './context'
import { scanAndRedact } from './secrets'
import { parseSkillMarkdown } from './skills'

/**
 * The library holds reusable pieces that aren't part of the project's code:
 *  - context: saved reference files (guidelines, architecture notes, examples, any text file)
 *  - presets: ready-made combinations of a skill + context files + an optional task template
 *
 * Each lives in three places: the project (`<project>/.yaz/…`, shareable through git), the user's home
 * (`~/.yaz/…`), and the built-in set shipped with the app. On a name clash the most specific one wins.
 */

export const MAX_CONTEXT_BYTES = 1024 * 1024
const MAX_CONTEXT_FILES = 500
const MAX_DEPTH = 4

export interface LibraryLocation {
  dir: string
  source: SkillSource
}

export interface LoadedContextItem extends ContextItem {
  file: string
}

export interface LoadedPreset extends Preset {
  file: string
}

function toId(dir: string, file: string): string {
  return relative(dir, file).split(sep).join('/')
}

async function contextDescription(file: string): Promise<string> {
  if (extname(file).toLowerCase() !== '.md') return ''
  try {
    const handle = await fs.open(file, 'r')
    try {
      const buf = Buffer.alloc(4096)
      const { bytesRead } = await handle.read(buf, 0, buf.length, 0)
      const { meta } = parseSkillMarkdown(buf.subarray(0, bytesRead).toString('utf8'))
      return typeof meta.description === 'string' ? meta.description.trim() : ''
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/** Lists context files. Dot-files, blocked files (keys, .env…) and files over 1 MB are skipped. */
export async function loadContextItems(locations: LibraryLocation[]): Promise<LoadedContextItem[]> {
  const byId = new Map<string, LoadedContextItem>()
  for (const loc of locations) {
    const files: string[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || files.length >= MAX_CONTEXT_FILES) return
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.isSymbolicLink()) continue
        const full = join(dir, e.name)
        if (e.isDirectory()) await walk(full, depth + 1)
        else if (e.isFile() && files.length < MAX_CONTEXT_FILES) files.push(full)
      }
    }
    await walk(loc.dir, 0)
    for (const file of files) {
      const id = toId(loc.dir, file)
      if (byId.has(id) || blockReason(id)) continue
      const stat = await fs.stat(file)
      if (stat.size > MAX_CONTEXT_BYTES) continue
      byId.set(id, { id, name: id, description: await contextDescription(file), source: loc.source, size: stat.size, file })
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Reads a context file as text. Markdown frontmatter (metadata) is dropped. Returns null for binary files. */
export async function readContextFile(file: string): Promise<string | null> {
  const { content, binary } = decodeText(await fs.readFile(file))
  if (binary) return null
  return extname(file).toLowerCase() === '.md' ? parseSkillMarkdown(content).body.replace(/^\n+/, '') : content
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()) : []
}

export function parsePreset(markdown: string, fallbackName: string): Omit<Preset, 'source'> {
  const { meta, body } = parseSkillMarkdown(markdown)
  const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : fallbackName
  return {
    id: name,
    name,
    description: typeof meta.description === 'string' ? meta.description.trim() : '',
    skill: typeof meta.skill === 'string' && meta.skill.trim() ? meta.skill.trim() : null,
    context: stringList(meta.context),
    task: body.trim()
  }
}

export function serializePreset(input: Pick<PresetInput, 'name' | 'description' | 'skill' | 'context' | 'task'>): string {
  const meta = stringifyYaml({
    name: input.name.trim(),
    description: input.description.trim(),
    skill: input.skill,
    context: input.context
  })
  const task = input.task.trim()
  return `---\n${meta}---\n${task ? task + '\n' : ''}`
}

export async function loadPresets(locations: LibraryLocation[]): Promise<LoadedPreset[]> {
  const byId = new Map<string, LoadedPreset>()
  for (const loc of locations) {
    let entries
    try {
      entries = await fs.readdir(loc.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isFile() || e.name.startsWith('.') || extname(e.name).toLowerCase() !== '.md') continue
      const file = join(loc.dir, e.name)
      try {
        const preset = parsePreset(await fs.readFile(file, 'utf8'), basename(e.name, '.md'))
        if (!byId.has(preset.id)) byId.set(preset.id, { ...preset, source: loc.source, file })
      } catch {
        // unreadable preset: skip it
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** A safe file name for a preset or context file: letters, digits, dots, dashes and underscores. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return slug.slice(0, 80) || 'untitled'
}

/** Writes a preset into `dir`, replacing a preset with the same name in that folder. */
export async function writePreset(dir: string, input: PresetInput, existing: LoadedPreset[]): Promise<string> {
  const name = input.name.trim()
  if (!name) throw new Error('A preset needs a name')
  if (name.length > 120) throw new Error('Preset name is too long')
  await fs.mkdir(dir, { recursive: true })
  const same = existing.find((p) => p.id === name && resolve(p.file, '..') === resolve(dir))
  const file = same ? same.file : await uniquePath(dir, slugify(name), '.md')
  await fs.writeFile(file, serializePreset(input), 'utf8')
  return file
}

async function exists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/** `dir/base.ext`, or `dir/base-2.ext`, `-3`… if taken. */
export async function uniquePath(dir: string, base: string, ext: string): Promise<string> {
  let candidate = join(dir, base + ext)
  for (let n = 2; await exists(candidate); n++) candidate = join(dir, `${base}-${n}${ext}`)
  return candidate
}

/** Copies a file into the context folder after the same checks the code tool uses. */
export async function addContextFile(dir: string, source: string): Promise<{ id: string } | { reason: string }> {
  const name = basename(source)
  const blocked = blockReason(name)
  if (blocked) return { reason: blocked }
  const stat = await fs.stat(source)
  if (!stat.isFile()) return { reason: 'Not a file' }
  if (stat.size > MAX_CONTEXT_BYTES) return { reason: 'Larger than 1 MB' }
  const buf = await fs.readFile(source)
  if (decodeText(buf).binary) return { reason: 'Binary file' }
  await fs.mkdir(dir, { recursive: true })
  const ext = extname(name)
  const target = await uniquePath(dir, slugify(basename(name, ext)) || 'context', ext.toLowerCase())
  await fs.writeFile(target, buf)
  return { id: toId(dir, target) }
}

export interface ContextSectionOutput {
  section: ContextSection | null
  findings: SecretFindingInfo[]
  allowedCount: number
  warnings: ComposeWarning[]
  /** Context id → rendered content (for token estimates). */
  blocks: Map<string, string>
}

/** Builds the `<additional_context>` section from ticked context files, with secrets redacted. */
export async function buildContextSection(
  ids: string[],
  items: LoadedContextItem[],
  allow: Set<string>
): Promise<ContextSectionOutput> {
  const out: ContextSectionOutput = { section: null, findings: [], allowedCount: 0, warnings: [], blocks: new Map() }
  const byId = new Map(items.map((i) => [i.id, i]))
  const blocks: ContextBlock[] = []
  for (const id of [...new Set(ids)]) {
    const label = `context/${id}`
    const item = byId.get(id)
    if (!item) {
      out.warnings.push({ path: label, message: 'Saved context file not found; skipped.' })
      continue
    }
    let content: string | null
    try {
      content = await readContextFile(item.file)
    } catch (err) {
      out.warnings.push({ path: label, message: `Couldn't read the file (${(err as Error).message}); skipped.` })
      continue
    }
    if (content === null) {
      out.warnings.push({ path: label, message: 'Binary file; skipped.' })
      continue
    }
    const scanned = scanAndRedact(label, content, allow)
    out.findings.push(...scanned.findings)
    out.allowedCount += scanned.allowedCount
    const text = scanned.text.replace(/\n+$/, '')
    out.blocks.set(id, text)
    blocks.push({ tag: 'document', attributes: { name: id }, content: text, title: id, language: languageFor(id) })
  }
  if (blocks.length) out.section = { tag: 'additional_context', title: 'Additional context', attributes: {}, blocks }
  return out
}
