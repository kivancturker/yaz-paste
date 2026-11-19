import type { OutputFormat } from '../shared/types'
import type { ContextSection } from './context'

export interface PromptParts {
  sections: ContextSection[]
  /** In prompt order. */
  skills: { name: string; body: string }[]
  task: string
  format: OutputFormat
}

/** Escapes a value for use inside a double-quoted XML attribute. */
export function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function attrs(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
    .join('')
}

/**
 * Picks a code fence longer than any backtick run inside the content, so code that itself contains
 * ``` can't close the fence early.
 */
export function fenceFor(content: string): string {
  let longest = 0
  for (const run of content.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  return '`'.repeat(Math.max(3, longest + 1))
}

function renderXml(parts: PromptParts): string {
  const out: string[] = []
  for (const section of parts.sections) {
    out.push(`<${section.tag}${attrs(section.attributes)}>`)
    let openGroup: string | undefined
    for (const block of section.blocks) {
      if (block.group !== openGroup) {
        if (openGroup) out.push(`</${openGroup}>`, '')
        if (block.group) out.push(`<${block.group}>`)
        openGroup = block.group
      }
      // Content is not XML-escaped on purpose: models read raw code best, and escaping would cost tokens.
      out.push(`<${block.tag}${attrs(block.attributes)}>`, block.content, `</${block.tag}>`)
      if (!openGroup) out.push('')
    }
    if (openGroup) out.push(`</${openGroup}>`)
    out.push(`</${section.tag}>`, '')
  }
  for (const skill of parts.skills) out.push(`<skill name="${escapeAttr(skill.name)}">`, skill.body.trim(), '</skill>', '')
  if (parts.task.trim()) out.push('<task>', parts.task.trim(), '</task>', '')
  return out.join('\n').trimEnd() + '\n'
}

function renderMarkdown(parts: PromptParts): string {
  const out: string[] = []
  for (const section of parts.sections) {
    out.push(`# ${section.title}`, '')
    for (const block of section.blocks) {
      const fence = fenceFor(block.content)
      out.push(`## ${block.title}`, '', `${fence}${block.language ?? 'text'}`, block.content, fence, '')
    }
  }
  for (const skill of parts.skills) out.push(`# Skill: ${skill.name}`, '', skill.body.trim(), '')
  if (parts.task.trim()) out.push('# Task', '', parts.task.trim(), '')
  return out.join('\n').trimEnd() + '\n'
}

/** Long context first, then the skills, then the task last: models follow instructions better after the code. */
export function renderPrompt(parts: PromptParts): string {
  return parts.format === 'markdown' ? renderMarkdown(parts) : renderXml(parts)
}

export interface TreeMark {
  path: string
  note?: string
}

/**
 * Renders an indented directory tree. Directories come first and end with `/`.
 * `notes` adds a `← …` marker after a file.
 */
export function renderTree(paths: string[], notes: Map<string, string> = new Map()): string {
  interface Node {
    dirs: Map<string, Node>
    files: string[]
  }
  const root: Node = { dirs: new Map(), files: [] }
  for (const p of paths) {
    const parts = p.split('/')
    let node = root
    for (const dir of parts.slice(0, -1)) {
      let next = node.dirs.get(dir)
      if (!next) {
        next = { dirs: new Map(), files: [] }
        node.dirs.set(dir, next)
      }
      node = next
    }
    node.files.push(p)
  }

  const lines: string[] = []
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
  const walk = (node: Node, depth: number): void => {
    const indent = '  '.repeat(depth)
    for (const name of [...node.dirs.keys()].sort(collator.compare)) {
      lines.push(`${indent}${name}/`)
      walk(node.dirs.get(name)!, depth + 1)
    }
    for (const file of [...node.files].sort((a, b) => collator.compare(a, b))) {
      const name = file.slice(file.lastIndexOf('/') + 1)
      const note = notes.get(file)
      lines.push(`${indent}${name}${note ? `  ← ${note}` : ''}`)
    }
  }
  walk(root, 0)
  return lines.join('\n')
}
