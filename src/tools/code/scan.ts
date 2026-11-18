import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join, posix, sep } from 'node:path'
import ignore, { type Ignore } from 'ignore'
import type { FileEntry, ProjectType } from '../../shared/types'
import { blockReason, contentBlockFor, defaultIgnores, isSensitive, MAX_FILE_BYTES, MAX_FILES } from './rules'

export interface ScanResult {
  files: FileEntry[]
  types: ProjectType[]
  scanMode: 'git' | 'walk'
  truncated: boolean
}

const DOTNET_MARKER = /\.(sln|slnx|csproj|fsproj|vbproj)$|^(global\.json|Directory\.Build\.props)$/i

/** Looks two levels deep for .NET / Node markers. */
export async function detectProjectTypes(root: string): Promise<ProjectType[]> {
  const types = new Set<ProjectType>()
  const visit = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isFile()) {
        if (DOTNET_MARKER.test(e.name)) types.add('dotnet')
        if (e.name === 'package.json') types.add('node')
      } else if (e.isDirectory() && depth > 0 && !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'bin' && e.name !== 'obj') {
        await visit(join(dir, e.name), depth - 1)
      }
    }
  }
  await visit(root, 2)
  return [...types].sort()
}

function gitListFiles(root: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=off', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: root, maxBuffer: 256 * 1024 * 1024, windowsHide: true, timeout: 30_000 },
      (error, stdout) => {
        if (error) resolve(null)
        else resolve(stdout.split('\0').filter(Boolean))
      }
    )
  })
}

async function readIgnoreFile(path: string): Promise<string | null> {
  try {
    return await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** Walks the folder without git, honouring nested .gitignore / .ignore files. Symlinks are skipped. */
async function walkFiles(root: string, base: Ignore, limit: number): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = []
  let truncated = false
  const stack: { dir: string; rel: string; matchers: { base: string; ig: Ignore }[] }[] = [{ dir: root, rel: '', matchers: [] }]

  const ignored = (rel: string, isDir: boolean, matchers: { base: string; ig: Ignore }[]): boolean => {
    const target = isDir ? rel + '/' : rel
    if (base.ignores(target)) return true
    return matchers.some((m) => {
      const sub = m.base ? posix.relative(m.base, rel) : rel
      return m.ig.ignores(isDir ? sub + '/' : sub)
    })
  }

  while (stack.length) {
    const { dir, rel, matchers } = stack.pop()!
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    let local = matchers
    for (const name of ['.gitignore', '.ignore']) {
      if (entries.some((e) => e.isFile() && e.name === name)) {
        const text = await readIgnoreFile(join(dir, name))
        if (text) local = [...local, { base: rel, ig: ignore().add(text) }]
      }
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (!ignored(childRel, true, local)) stack.push({ dir: join(dir, e.name), rel: childRel, matchers: local })
      } else if (e.isFile()) {
        if (ignored(childRel, false, local)) continue
        if (files.length >= limit) {
          truncated = true
          return { files, truncated }
        }
        files.push(childRel)
      }
    }
  }
  return { files, truncated }
}

/**
 * Lists the project's files. Uses `git ls-files` when the folder is in a git repo (exactly matches what git
 * tracks or would track), otherwise walks the folder with .gitignore support. Default ignores for the
 * detected project types and the project's `.yazignore` apply on top in both modes.
 */
export async function scanProject(root: string): Promise<ScanResult> {
  const types = await detectProjectTypes(root)
  const base = ignore().add(defaultIgnores(types))
  const yazignore = await readIgnoreFile(join(root, '.yazignore'))
  if (yazignore) base.add(yazignore)

  let scanMode: 'git' | 'walk' = 'git'
  let truncated = false
  let paths = await gitListFiles(root)
  // an empty list means the folder is ignored by a parent repo (or empty): walk it instead
  if (paths && paths.length > 0) {
    paths = paths.map((p) => p.split(sep).join('/')).filter((p) => !base.ignores(p))
    if (paths.length > MAX_FILES) {
      paths = paths.slice(0, MAX_FILES)
      truncated = true
    }
  } else {
    scanMode = 'walk'
    const walked = await walkFiles(root, base, MAX_FILES)
    paths = walked.files
    truncated = walked.truncated
  }

  const files: FileEntry[] = []
  await Promise.all(
    paths.map(async (path) => {
      const full = join(root, ...path.split('/'))
      let stat
      try {
        stat = await fs.lstat(full)
      } catch {
        return // listed by git but deleted on disk
      }
      if (!stat.isFile()) return // symlinks and others are never followed
      const entry: FileEntry = { path, size: stat.size, status: 'ok' }
      const reason = blockReason(path)
      if (reason) {
        entry.status = 'blocked'
        entry.reason = reason
      } else if (stat.size > MAX_FILE_BYTES) {
        entry.status = 'too-large'
        entry.reason = `Larger than ${Math.round(MAX_FILE_BYTES / 1024)} KB`
      } else {
        const contentRule = contentBlockFor(path)
        if (contentRule) {
          const text = await readIgnoreFile(full)
          if (text && contentRule.test.test(text)) {
            entry.status = 'blocked'
            entry.reason = contentRule.reason
          }
        }
        if (entry.status === 'ok' && isSensitive(path)) entry.sensitive = true
      }
      files.push(entry)
    })
  )
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })
  files.sort((a, b) => collator.compare(a.path, b.path))
  return { files, types, scanMode, truncated }
}
