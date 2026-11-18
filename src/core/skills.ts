import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { SkillInfo, SkillSource } from '../shared/types'

/**
 * Skills use the Agent Skills format (as in Claude Code): one folder per skill holding a SKILL.md with
 * YAML frontmatter (`name`, `description`) and a Markdown body. Extra files in the folder are listed.
 *
 * The frontmatter is parsed with the `yaml` package, which never executes code. (gray-matter is avoided on
 * purpose: it evaluates `---js` frontmatter, and project skills come from repositories you may not trust.)
 */

const MAX_SKILL_BYTES = 256 * 1024
const MAX_EXTRA_FILES = 50

export interface ParsedSkill {
  meta: Record<string, unknown>
  body: string
}

export function parseSkillMarkdown(raw: string): ParsedSkill {
  // skills checked out on Windows may have CRLF line endings
  const markdown = raw.replace(/\r\n?/g, '\n')
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(markdown)
  if (!match) return { meta: {}, body: markdown.replace(/^\uFEFF/, '') }
  let meta: Record<string, unknown> = {}
  try {
    const parsed: unknown = parseYaml(match[1])
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>
  } catch {
    // malformed frontmatter: keep the body, fall back to the folder name
  }
  return { meta, body: markdown.slice(match[0].length) }
}

export interface SkillLocation {
  dir: string
  source: SkillSource
}

async function findSkillFile(dir: string): Promise<string | null> {
  for (const name of ['SKILL.md', 'skill.md', 'Skill.md']) {
    const p = join(dir, name)
    try {
      const stat = await fs.stat(p)
      if (stat.isFile() && stat.size <= MAX_SKILL_BYTES) return p
    } catch {
      // not there
    }
  }
  return null
}

async function listExtraFiles(dir: string, skillFile: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string): Promise<void> => {
    if (out.length >= MAX_EXTRA_FILES) return
    let entries
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= MAX_EXTRA_FILES) return
      if (e.name.startsWith('.')) continue
      const full = join(d, e.name)
      if (e.isDirectory()) await walk(full)
      else if (e.isFile() && full !== skillFile) out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  await walk(dir)
  return out.sort()
}

export async function loadSkill(dir: string, source: SkillSource, folderName: string): Promise<(SkillInfo & { file: string }) | null> {
  const file = await findSkillFile(dir)
  if (!file) return null
  const { meta } = parseSkillMarkdown(await fs.readFile(file, 'utf8'))
  const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : folderName
  const description = typeof meta.description === 'string' ? meta.description.trim() : ''
  return { id: name, name, description, source, dir, file, extraFiles: await listExtraFiles(dir, file) }
}

/**
 * Loads skills from every location. On a name clash the earlier location wins, so pass them from most
 * specific (project) to least specific (built-in).
 */
export async function loadSkills(locations: SkillLocation[]): Promise<(SkillInfo & { file: string })[]> {
  const byId = new Map<string, SkillInfo & { file: string }>()
  for (const loc of locations) {
    let entries
    try {
      entries = await fs.readdir(loc.dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue
      const skill = await loadSkill(join(loc.dir, e.name), loc.source, e.name)
      if (skill && !byId.has(skill.id)) byId.set(skill.id, skill)
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export async function readSkillBody(file: string): Promise<string> {
  return parseSkillMarkdown(await fs.readFile(file, 'utf8')).body
}
