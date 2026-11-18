import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { app } from 'electron'
import { renderPrompt } from '../core/render'
import { loadSkills, readSkillBody } from '../core/skills'
import { splitLines } from '../shared/ranges'
import { countTokens } from '../core/tokens'
import type {
  ComposeRequest,
  ComposeResult,
  FileContent,
  FileEntry,
  FileSelection,
  ProjectInfo,
  SkillInfo,
  TokenEstimate
} from '../shared/types'
import { codeContextTool } from '../tools/code/compose'
import { FileReader } from '../tools/code/files'
import { scanProject } from '../tools/code/scan'
import { loadProjectState } from './store'

/** The project currently open in the window. All file access goes through it. */
export class Project {
  readonly name: string
  private files = new Map<string, FileEntry>()
  private reader: FileReader
  private info: Omit<ProjectInfo, 'state'> | null = null
  private skillFiles = new Map<string, string>()

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

  private skillLocations() {
    const builtIn = app.isPackaged ? join(process.resourcesPath, 'skills') : join(app.getAppPath(), 'skills')
    return [
      { dir: join(this.root, '.claude', 'skills'), source: 'project' as const },
      { dir: join(this.root, '.agents', 'skills'), source: 'project' as const },
      { dir: join(homedir(), '.claude', 'skills'), source: 'user' as const },
      { dir: join(homedir(), '.agents', 'skills'), source: 'user' as const },
      { dir: builtIn, source: 'built-in' as const }
    ]
  }

  async listSkills(): Promise<SkillInfo[]> {
    const skills = await loadSkills(this.skillLocations())
    this.skillFiles = new Map(skills.map((s) => [s.id, s.file]))
    return skills.map(({ file: _file, ...info }) => info)
  }

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

  async compose(req: ComposeRequest): Promise<ComposeResult & { fileBlocks: Map<string, string> }> {
    const code = await codeContextTool.buildDetailed({
      root: this.root,
      name: this.name,
      types: this.info?.types ?? [],
      files: this.files,
      reader: this.reader,
      selection: this.sanitizeSelection(req.selection),
      treeMode: req.treeMode,
      wholeFileLineNumbers: Boolean(req.wholeFileLineNumbers),
      allow: new Set(req.allow ?? [])
    })
    const text = renderPrompt({
      sections: [code.section],
      skill: await this.skillFor(req.skillId),
      task: String(req.task ?? ''),
      format: req.format === 'markdown' ? 'markdown' : 'xml'
    })
    return {
      text,
      tokens: countTokens(text),
      fileCount: code.fileBlocks.size,
      findings: code.findings,
      allowedCount: code.allowedCount,
      warnings: code.warnings,
      fileBlocks: code.fileBlocks
    }
  }

  private tokenCache = new Map<string, number>()

  /** Per-file token counts (cached by rendered content) plus the rest of the prompt. */
  async estimate(req: ComposeRequest): Promise<TokenEstimate> {
    const code = await codeContextTool.buildDetailed({
      root: this.root,
      name: this.name,
      types: this.info?.types ?? [],
      files: this.files,
      reader: this.reader,
      selection: this.sanitizeSelection(req.selection),
      treeMode: req.treeMode,
      wholeFileLineNumbers: Boolean(req.wholeFileLineNumbers),
      allow: new Set()
    })
    const perFile: Record<string, number> = {}
    let total = 0
    for (const [path, content] of code.fileBlocks) {
      const key = `${content.length}:${content.slice(0, 64)}:${content.slice(-64)}:${path}`
      let tokens = this.tokenCache.get(key)
      if (tokens === undefined) {
        tokens = countTokens(content)
        this.tokenCache.set(key, tokens)
      }
      perFile[path] = tokens
      total += tokens + 12 // tags + attributes
    }
    const tree = code.section.blocks.find((b) => b.tag === 'directory_structure')
    const skill = await this.skillFor(req.skillId)
    total += countTokens([tree?.content ?? '', skill?.body ?? '', String(req.task ?? '')].join('\n')) + 20
    if (this.tokenCache.size > 5000) this.tokenCache.clear()
    return { total, perFile }
  }
}
