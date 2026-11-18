import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { app, shell } from 'electron'
import {
  addContextFile,
  buildContextSection,
  isInside,
  readContextForEdit,
  writeContext,
  writeSkill,
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
  LibraryItemDetail,
  LibraryItemInput,
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

/** The user's home for the library (`~/.yaz`, `~/.claude/skills`). YAZ_HOME overrides it for tests. */
function userHome(): string {
  return process.env['YAZ_HOME'] ? resolve(process.env['YAZ_HOME']) : homedir()
}

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
  private skills: (SkillInfo & { file: string })[] = []
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
    const base = scope === 'project' ? this.root : userHome()
    return kind === 'skills' ? join(base, '.claude', 'skills') : join(base, '.yaz', kind)
  }

  private locations(kind: 'context' | 'presets'): LibraryLocation[] {
    return [
      { dir: this.libraryDir('project', kind), source: 'project' },
      { dir: this.libraryDir('user', kind), source: 'user' },
      { dir: builtInDir(kind), source: 'built-in' }
    ]
  }

  private skillDirs(): { dir: string; source: 'project' | 'user' | 'built-in' }[] {
    return [
      { dir: this.libraryDir('project', 'skills'), source: 'project' },
      { dir: join(this.root, '.agents', 'skills'), source: 'project' },
      { dir: this.libraryDir('user', 'skills'), source: 'user' },
      { dir: join(userHome(), '.agents', 'skills'), source: 'user' },
      { dir: builtInDir('skills'), source: 'built-in' }
    ]
  }

  async listSkills(): Promise<SkillInfo[]> {
    const skills = await loadSkills(this.skillDirs())
    this.skills = skills
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
    await this.deleteLibraryItem('presets', id)
  }

  // ---- creating, editing and deleting library items ------------------------------------------

  /** Folders the app may write to for a kind (never the built-in ones). */
  private writableDirs(kind: LibraryKind): string[] {
    if (kind === 'skills') return this.skillDirs().filter((d) => d.source !== 'built-in').map((d) => d.dir)
    return [this.libraryDir('project', kind), this.libraryDir('user', kind)]
  }

  private assertWritable(kind: LibraryKind, path: string): void {
    if (!this.writableDirs(kind).some((dir) => isInside(path, dir) && resolve(path) !== resolve(dir))) {
      throw new Error('That item is not in one of your library folders')
    }
  }

  /** The loaded item with its file, refreshed from disk. */
  private async findItem(kind: LibraryKind, id: string): Promise<{ file: string; source: 'project' | 'user' | 'built-in' }> {
    if (typeof id !== 'string') throw new Error('Invalid id')
    if (kind === 'skills') {
      await this.listSkills()
      const s = this.skills.find((x) => x.id === id)
      if (s) return { file: s.file, source: s.source }
    } else if (kind === 'context') {
      await this.listContext()
      const c = this.contextItems.find((x) => x.id === id)
      if (c) return { file: c.file, source: c.source }
    } else if (kind === 'presets') {
      await this.listPresets()
      const p = this.presets.find((x) => x.id === id)
      if (p) return { file: p.file, source: p.source }
    }
    throw new Error('Not found in the library')
  }

  async getLibraryItem(kind: LibraryKind, id: string): Promise<LibraryItemDetail> {
    const { file, source } = await this.findItem(kind, id)
    const base = { kind, id, source, editable: source !== 'built-in', location: file, skill: null, context: [] as string[] }
    if (kind === 'skills') {
      const skill = this.skills.find((s) => s.id === id)!
      return { ...base, name: skill.name, description: skill.description, body: (await readSkillBody(file)).replace(/^\n+/, '') }
    }
    if (kind === 'context') {
      const { description, body } = await readContextForEdit(file)
      return { ...base, name: id.split('/').pop() ?? id, description, body }
    }
    const preset = this.presets.find((p) => p.id === id)!
    return { ...base, name: preset.name, description: preset.description, body: preset.task, skill: preset.skill, context: preset.context }
  }

  async saveLibraryItem(input: LibraryItemInput): Promise<LibraryItemDetail> {
    if (!input || !['skills', 'context', 'presets'].includes(input.kind)) throw new Error('Invalid library item')
    const kind = input.kind
    const scope: LibraryScope = input.scope === 'project' ? 'project' : 'user'
    const fields = {
      name: String(input.name ?? ''),
      description: String(input.description ?? ''),
      body: String(input.body ?? '')
    }
    let existing: { file: string; source: 'project' | 'user' | 'built-in' } | null = null
    if (input.originalId) {
      existing = await this.findItem(kind, input.originalId)
      if (existing.source === 'built-in') throw new Error('Built-in items are read-only. Duplicate it to make your own copy.')
      this.assertWritable(kind, existing.file)
    }

    // never silently replace another item with the same name in the same place
    const targetSource = existing ? existing.source : scope
    if (kind !== 'context') {
      const list = kind === 'skills' ? (await this.listSkills(), this.skills) : (await this.listPresets(), this.presets)
      const clash = list.find((x) => x.id === fields.name.trim() && x.source === targetSource && x.file !== existing?.file)
      if (clash) throw new Error(`A ${kind === 'skills' ? 'skill' : 'preset'} named "${clash.id}" already exists there`)
    }

    let id: string
    if (kind === 'skills') {
      await writeSkill(this.libraryDir(scope, 'skills'), fields, existing?.file)
      id = fields.name.trim()
    } else if (kind === 'context') {
      // an existing file keeps its own folder root (project or user)
      const root = existing ? this.writableDirs('context').find((d) => isInside(existing!.file, d))! : this.libraryDir(scope, 'context')
      id = await writeContext(root, fields, existing ?? undefined)
    } else {
      await this.listPresets()
      const presetScope: LibraryScope = existing ? (existing.source === 'project' ? 'project' : 'user') : scope
      await writePreset(
        this.libraryDir(presetScope, 'presets'),
        {
          ...fields,
          task: fields.body,
          skill: typeof input.skill === 'string' && input.skill ? input.skill : null,
          context: Array.isArray(input.context) ? input.context.filter((c) => typeof c === 'string') : [],
          scope: presetScope
        },
        this.presets,
        existing?.file
      )
      id = fields.name.trim()
    }
    return this.getLibraryItem(kind, id)
  }

  async deleteLibraryItem(kind: LibraryKind, id: string): Promise<void> {
    const item = await this.findItem(kind, id)
    if (item.source === 'built-in') throw new Error("Built-in items can't be deleted")
    // a skill is its whole folder (SKILL.md plus any extra files)
    const target = kind === 'skills' ? resolve(item.file, '..') : item.file
    this.assertWritable(kind, target)
    // YAZ_NO_TRASH is for automated tests, so they don't fill the real trash
    if (process.env['YAZ_NO_TRASH']) await fs.rm(target, { recursive: true, force: true })
    else await shell.trashItem(target)
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
