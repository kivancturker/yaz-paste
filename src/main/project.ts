import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { app } from 'electron'
import {
  addContextFile,
  buildContextSection,
  loadContextItems,
  loadPresets,
  writePreset,
  type LibraryLocation,
  type LoadedContextItem,
  type LoadedPreset
} from '../core/library'
import { renderPrompt } from '../core/render'
import { loadSkills, readSkillBody } from '../core/skills'
import { countTokens } from '../core/tokens'
import { splitLines } from '../shared/ranges'
import type {
  AddContextResult,
  ComposeRequest,
  ComposeResult,
  ContextItem,
  FileContent,
  FileEntry,
  FileSelection,
  LibraryKind,
  LibraryScope,
  Preset,
  PresetInput,
  ProjectInfo,
  SkillInfo,
  TokenEstimate
} from '../shared/types'
import { codeContextTool } from '../tools/code/compose'
import { FileReader } from '../tools/code/files'
import { scanProject } from '../tools/code/scan'
import { loadProjectState } from './store'

/** Folder holding the app's built-in skills, context files and presets. */
function builtInDir(name: string): string {
  return app.isPackaged ? join(process.resourcesPath, name) : join(app.getAppPath(), name)
}

/** The project currently open in the window. All file access goes through it. */
export class Project {
  readonly name: string
  private files = new Map<string, FileEntry>()
  private reader: FileReader
  private info: Omit<ProjectInfo, 'state'> | null = null
  private skillFiles = new Map<string, string>()
  private contextItems: LoadedContextItem[] = []
  private presets: LoadedPreset[] = []

  constructor(readonly root: string) {
    this.name = basename(root)
    this.reader = new FileReader(root)
  }

  static async open(path: string): Promise<{ project: Project; info: ProjectInfo }> {
    const root = await fs.realpath(resolve(path))
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Not a folder')
    const project = new Project(root)
    const info = await project.scan()
    return { project, info: { ...info, state: await loadProjectState(root) } }
  }

  async scan(): Promise<Omit<ProjectInfo, 'state'>> {
    const result = await scanProject(this.root)
    this.files = new Map(result.files.map((f) => [f.path, f]))
    this.reader = new FileReader(this.root)
    this.info = { root: this.root, name: this.name, ...result }
    return this.info
  }

  async readFile(path: string): Promise<FileContent> {
    const entry = this.files.get(path)
    if (!entry) throw new Error('File is not part of the project scan')
    if (entry.status !== 'ok') throw new Error(entry.reason ?? 'File is not allowed')
    const file = await this.reader.read(path)
    return {
      path,
      content: file.binary ? '' : file.content,
      hash: file.hash,
      binary: file.binary,
      lineCount: file.binary ? 0 : splitLines(file.content).length
    }
  }

  // ---- library: skills, context files, presets --------------------------------------------------

  /** Where each kind of library item is stored for a scope. Skills follow the Claude Code layout. */
  libraryDir(scope: LibraryScope, kind: LibraryKind): string {
    const base = scope === 'project' ? this.root : homedir()
    return kind === 'skills' ? join(base, '.claude', 'skills') : join(base, '.yaz', kind)
  }

  private locations(kind: 'context' | 'presets'): LibraryLocation[] {
    return [
      { dir: this.libraryDir('project', kind), source: 'project' },
      { dir: this.libraryDir('user', kind), source: 'user' },
      { dir: builtInDir(kind), source: 'built-in' }
    ]
  }

  async listSkills(): Promise<SkillInfo[]> {
    const skills = await loadSkills([
      { dir: this.libraryDir('project', 'skills'), source: 'project' },
      { dir: join(this.root, '.agents', 'skills'), source: 'project' },
      { dir: this.libraryDir('user', 'skills'), source: 'user' },
      { dir: join(homedir(), '.agents', 'skills'), source: 'user' },
      { dir: builtInDir('skills'), source: 'built-in' }
    ])
    this.skillFiles = new Map(skills.map((s) => [s.id, s.file]))
    return skills.map(({ file: _file, ...info }) => info)
  }

  async listContext(): Promise<ContextItem[]> {
    this.contextItems = await loadContextItems(this.locations('context'))
    return this.contextItems.map(({ file: _file, ...item }) => item)
  }

  async listPresets(): Promise<Preset[]> {
    this.presets = await loadPresets(this.locations('presets'))
    return this.presets.map(({ file: _file, ...preset }) => preset)
  }

  async addContextFiles(scope: LibraryScope, paths: string[]): Promise<AddContextResult> {
    const dir = this.libraryDir(scope, 'context')
    const result: AddContextResult = { added: [], skipped: [] }
    for (const path of paths) {
      try {
        const r = await addContextFile(dir, path)
        if ('id' in r) result.added.push(r.id)
        else result.skipped.push({ name: basename(path), reason: r.reason })
      } catch (err) {
        result.skipped.push({ name: basename(path), reason: (err as Error).message })
      }
    }
    return result
  }

  async savePreset(input: PresetInput): Promise<Preset> {
    if (!input || typeof input.name !== 'string') throw new Error('Invalid preset')
    const scope: LibraryScope = input.scope === 'project' ? 'project' : 'user'
    const clean: PresetInput = {
      name: input.name,
      description: String(input.description ?? ''),
      skill: typeof input.skill === 'string' && input.skill ? input.skill : null,
      context: Array.isArray(input.context) ? input.context.filter((c) => typeof c === 'string') : [],
      task: String(input.task ?? ''),
      scope
    }
    await this.listPresets()
    await writePreset(this.libraryDir(scope, 'presets'), clean, this.presets)
    const saved = (await this.listPresets()).find((p) => p.id === clean.name.trim())
    if (!saved) throw new Error('Preset was saved but could not be read back')
    return saved
  }

  async deletePreset(id: string): Promise<void> {
    await this.listPresets()
    const preset = this.presets.find((p) => p.id === id)
    if (!preset) throw new Error('Preset not found')
    if (preset.source === 'built-in') throw new Error("Built-in presets can't be deleted")
    // only ever delete inside the preset folders
    const allowed = [this.libraryDir('project', 'presets'), this.libraryDir('user', 'presets')].map((d) => resolve(d))
    if (!allowed.includes(resolve(preset.file, '..'))) throw new Error('Preset is outside the preset folders')
    await fs.unlink(preset.file)
  }

  // ---- composing -----------------------------------------------------------------------------

  private async skillFor(id: string | null): Promise<{ name: string; body: string } | null> {
    if (!id) return null
    if (!this.skillFiles.has(id)) await this.listSkills()
    const file = this.skillFiles.get(id)
    if (!file) return null
    return { name: id, body: await readSkillBody(file) }
  }

  private sanitizeSelection(selection: Record<string, FileSelection>): Record<string, FileSelection> {
    const out: Record<string, FileSelection> = {}
    for (const [path, sel] of Object.entries(selection ?? {})) {
      if (typeof path !== 'string' || !sel || typeof sel !== 'object') continue
      if (sel.mode === 'whole') out[path] = { mode: 'whole' }
      else if (sel.mode === 'ranges' && Array.isArray(sel.ranges)) {
        const ranges = sel.ranges
          .filter((r) => Array.isArray(r) && r.length === 2 && r.every((n) => Number.isInteger(n) && n > 0))
          .map((r) => [r[0], r[1]] as [number, number])
        out[path] = { mode: 'ranges', ranges, hash: String(sel.hash ?? '') }
      }
    }
    return out
  }

  private async build(req: ComposeRequest, allow: Set<string>) {
    const code = await codeContextTool.buildDetailed({
      root: this.root,
      name: this.name,
      types: this.info?.types ?? [],
      files: this.files,
      reader: this.reader,
      selection: this.sanitizeSelection(req.selection),
      treeMode: req.treeMode,
      wholeFileLineNumbers: Boolean(req.wholeFileLineNumbers),
      allow
    })
    const contextIds = Array.isArray(req.contextIds) ? req.contextIds.filter((c) => typeof c === 'string') : []
    if (contextIds.length && this.contextItems.length === 0) await this.listContext()
    const context = await buildContextSection(contextIds, this.contextItems, allow)
    return { code, context }
  }

  async compose(req: ComposeRequest): Promise<ComposeResult> {
    const { code, context } = await this.build(req, new Set(req.allow ?? []))
    const text = renderPrompt({
      sections: context.section ? [code.section, context.section] : [code.section],
      skill: await this.skillFor(req.skillId),
      task: String(req.task ?? ''),
      format: req.format === 'markdown' ? 'markdown' : 'xml'
    })
    return {
      text,
      tokens: countTokens(text),
      fileCount: code.fileBlocks.size + context.blocks.size,
      findings: [...code.findings, ...context.findings],
      allowedCount: code.allowedCount + context.allowedCount,
      warnings: [...code.warnings, ...context.warnings]
    }
  }

  private tokenCache = new Map<string, number>()

  private cachedTokens(key: string, content: string): number {
    const cacheKey = `${content.length}:${content.slice(0, 64)}:${content.slice(-64)}:${key}`
    let tokens = this.tokenCache.get(cacheKey)
    if (tokens === undefined) {
      tokens = countTokens(content)
      this.tokenCache.set(cacheKey, tokens)
    }
    return tokens
  }

  /** Per-file token counts (cached by rendered content) plus the rest of the prompt. */
  async estimate(req: ComposeRequest): Promise<TokenEstimate> {
    const { code, context } = await this.build(req, new Set())
    const perFile: Record<string, number> = {}
    let total = 0
    for (const [path, content] of code.fileBlocks) {
      perFile[path] = this.cachedTokens(path, content)
      total += perFile[path] + 12 // tags + attributes
    }
    for (const [id, content] of context.blocks) {
      perFile[`context/${id}`] = this.cachedTokens(`context/${id}`, content)
      total += perFile[`context/${id}`] + 12
    }
    const tree = code.section.blocks.find((b) => b.tag === 'directory_structure')
    const skill = await this.skillFor(req.skillId)
    total += countTokens([tree?.content ?? '', skill?.body ?? '', String(req.task ?? '')].join('\n')) + 20
    if (this.tokenCache.size > 5000) this.tokenCache.clear()
    return { total, perFile }
  }
}
