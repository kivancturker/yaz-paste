import type { ContextBlock, ContextSection, ContextTool } from '../../core/context'
import { countRangeLines, formatRanges, normalizeRanges, renderRanges, splitLines, withLineNumbers } from '../../shared/ranges'
import { renderTree } from '../../core/render'
import { maskedLinePreview, redact, scanSecrets, type SecretFinding } from '../../core/secrets'
import { languageFor } from '../../shared/languages'
import type { ComposeWarning, FileEntry, FileSelection, ProjectType, SecretFindingInfo, TreeMode } from '../../shared/types'
import type { FileReader } from './files'

export interface CodeContextRequest {
  root: string
  name: string
  types: ProjectType[]
  files: Map<string, FileEntry>
  reader: FileReader
  selection: Record<string, FileSelection>
  treeMode: TreeMode
  wholeFileLineNumbers: boolean
  allow: Set<string>
}

export interface CodeContextOutput {
  section: ContextSection
  findings: SecretFindingInfo[]
  allowedCount: number
  warnings: ComposeWarning[]
  /** Path → rendered content of that file's block (for token estimates). */
  fileBlocks: Map<string, string>
}

export function findingId(path: string, f: SecretFinding): string {
  return `${path}:${f.rule}:${f.valueHash}`
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

/** Tool #1: turns ticked files / line ranges into a `<project>` section, with secrets redacted. */
export const codeContextTool: ContextTool<CodeContextRequest> & {
  buildDetailed(req: CodeContextRequest): Promise<CodeContextOutput>
} = {
  id: 'code',
  displayName: 'Code Context',

  async build(req) {
    return (await this.buildDetailed(req)).section
  },

  async buildDetailed(req) {
    const warnings: ComposeWarning[] = []
    const findings: SecretFindingInfo[] = []
    const fileBlocks = new Map<string, string>()
    let allowedCount = 0
    const blocks: ContextBlock[] = []
    const included: { path: string; note?: string }[] = []

    const paths = Object.keys(req.selection).sort(collator.compare)
    for (const path of paths) {
      const sel = req.selection[path]
      const entry = req.files.get(path)
      if (!entry) {
        warnings.push({ path, message: 'No longer in the project; skipped.' })
        continue
      }
      if (entry.status !== 'ok') {
        warnings.push({ path, message: `${entry.reason ?? 'Not allowed'}; skipped.` })
        continue
      }

      let file
      try {
        file = await req.reader.read(path)
      } catch (err) {
        warnings.push({ path, message: `Couldn't read the file (${(err as Error).message}); skipped.` })
        continue
      }
      if (file.binary) {
        warnings.push({ path, message: 'Binary file; skipped.' })
        continue
      }

      const allLines = splitLines(file.content)
      let ranges = sel.mode === 'ranges' ? normalizeRanges(sel.ranges, allLines.length) : null
      if (ranges && ranges.length === 0) ranges = null
      if (sel.mode === 'ranges' && sel.hash !== file.hash) {
        warnings.push({ path, message: 'File changed since you picked lines. Check that the selected lines are still the right ones.' })
      }

      // Only secrets inside the included lines matter.
      const inScope = (f: SecretFinding): boolean => {
        if (!ranges) return true
        const endLine = f.line + (file.content.slice(f.start, f.end).split('\n').length - 1)
        return ranges.some(([a, b]) => f.line <= b && endLine >= a)
      }
      const all = scanSecrets(file.content).filter(inScope)
      for (const f of all) {
        const id = findingId(path, f)
        if (req.allow.has(id)) allowedCount++
        findings.push({ id, path, line: f.line, rule: f.rule, preview: maskedLinePreview(file.content, all, f.line) })
      }
      const redacted = redact(file.content, all, (f) => req.allow.has(findingId(path, f)))
      const lines = splitLines(redacted)

      let content: string
      const attributes: Record<string, string> = { path }
      let title = path
      if (ranges) {
        content = renderRanges(lines, ranges)
        attributes.lines = formatRanges(ranges)
        attributes.total_lines = String(lines.length)
        title = `${path} (lines ${formatRanges(ranges)} of ${lines.length})`
        included.push({ path, note: `lines ${formatRanges(ranges)} (${countRangeLines(ranges)} of ${lines.length})` })
      } else {
        content = req.wholeFileLineNumbers ? withLineNumbers(lines) : lines.join('\n')
        included.push({ path })
      }
      fileBlocks.set(path, content)
      blocks.push({ tag: 'file', attributes, content, title: `File: ${title}`, language: languageFor(path), group: 'files' })
    }

    if (req.treeMode !== 'none' && (included.length > 0 || req.treeMode === 'full')) {
      const notes = new Map<string, string>()
      let treePaths: string[]
      if (req.treeMode === 'full') {
        treePaths = [...req.files.keys()]
        for (const inc of included) notes.set(inc.path, inc.note ?? 'included')
      } else {
        treePaths = included.map((i) => i.path)
        for (const inc of included) if (inc.note) notes.set(inc.path, inc.note)
      }
      blocks.unshift({
        tag: 'directory_structure',
        attributes: {},
        content: renderTree(treePaths, notes),
        title: 'Directory structure',
        language: 'text'
      })
    }

    const section: ContextSection = {
      tag: 'project',
      title: `Project: ${req.name}`,
      attributes: { name: req.name, type: req.types.join(',') },
      blocks
    }
    return { section, findings, allowedCount, warnings, fileBlocks }
  }
}
