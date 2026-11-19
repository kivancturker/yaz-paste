/**
 * Maps the paths written in a diff to files of the open project, and groups the patches per file.
 * Pure TypeScript with no Node or DOM imports.
 */
import type { FilePatch } from './parse'

export interface ResolvedPath {
  /** Project-relative path of the existing file, or null when it isn't in the project. */
  path: string | null
  /** How the path was found, shown to the user when it isn't a plain match. */
  note: string | null
}

/** Paths to try for a diff path: git's `a/` / `b/` prefix removed first (when used), then as written. */
function candidates(raw: string, gitPrefixes: boolean): string[] {
  const p = raw.replace(/^\.\//, '')
  const stripped = /^[ab]\//.test(p) ? p.slice(2) : null
  const list = gitPrefixes && stripped ? [stripped, p] : stripped ? [p, stripped] : [p]
  return [...new Set(list)]
}

/**
 * Finds a diff path among the project's files. Tries exact paths, then a case-insensitive match, then a unique
 * suffix match (the AI wrote `Services/OrderService.cs` for `src/Shop.Api/Services/OrderService.cs`).
 * Never picks between several possible files.
 */
export function resolvePath(raw: string, gitPrefixes: boolean, projectFiles: string[]): ResolvedPath {
  const all = new Set(projectFiles)
  const tries = candidates(raw, gitPrefixes)
  for (const c of tries) if (all.has(c)) return { path: c, note: null }

  for (const c of tries) {
    const lower = c.toLowerCase()
    const matches = projectFiles.filter((f) => f.toLowerCase() === lower)
    if (matches.length === 1) return { path: matches[0], note: `Matched “${c}” to ${matches[0]} (different letter case).` }
  }

  for (const c of tries) {
    const matches = projectFiles.filter((f) => f.endsWith('/' + c))
    if (matches.length === 1) return { path: matches[0], note: `The diff says “${c}”; matched to ${matches[0]}.` }
    if (matches.length > 1)
      return { path: null, note: `The diff says “${c}”, which matches ${matches.length} files (${matches.slice(0, 3).join(', ')}${matches.length > 3 ? ', …' : ''}).` }
  }
  return { path: null, note: null }
}

/** The path a new file should get: git's `b/` prefix removed when the diff uses git prefixes. */
export function newFilePath(raw: string, gitPrefixes: boolean): string {
  const p = raw.replace(/^\.\//, '')
  return gitPrefixes && /^b\//.test(p) ? p.slice(2) : p
}

export interface FileGroup {
  /** Key for the UI: the target path (or the raw path when it couldn't be resolved). */
  key: string
  /** Project file the patches apply to; null for new files or files not found. */
  sourcePath: string | null
  /** Path of the file after the change (differs from sourcePath on renames; null when deleted). */
  targetPath: string | null
  /** The path as the diff wrote it, for display. */
  displayPath: string
  patches: FilePatch[]
  notes: string[]
  /** True when the file is created by the diff. */
  isNew: boolean
  isDeleted: boolean
  isRename: boolean
  /** The diff names a file that isn't in the project (and doesn't create it). */
  missing: boolean
}

/** Resolves every patch's paths and merges patches that change the same file. */
export function groupPatches(patches: FilePatch[], projectFiles: string[]): FileGroup[] {
  const groups = new Map<string, FileGroup>()
  for (const patch of patches) {
    const notes: string[] = []
    let sourcePath: string | null = null
    let missing = false
    let targetPath: string | null = null
    const shownOld = patch.oldPath ? (patch.gitPrefixes ? patch.oldPath.replace(/^a\//, '') : patch.oldPath) : null
    const shownNew = patch.newPath ? newFilePath(patch.newPath, patch.gitPrefixes) : null

    if (patch.isNew) {
      targetPath = shownNew
      // a "new" file that exists already is reported by applyPatch
      const existing = shownNew ? resolveExact(shownNew, projectFiles) : null
      sourcePath = existing
    } else if (patch.oldPath) {
      const r = resolvePath(patch.oldPath, patch.gitPrefixes, projectFiles)
      if (r.note) notes.push(r.note)
      sourcePath = r.path
      missing = r.path === null
      if (patch.isDeleted) targetPath = null
      else if (patch.isRename && patch.newPath) targetPath = newFilePath(patch.newPath, patch.gitPrefixes)
      else targetPath = sourcePath ?? shownNew
    }

    const displayPath = targetPath ?? sourcePath ?? shownOld ?? shownNew ?? '(unknown)'
    const key = sourcePath ?? targetPath ?? displayPath
    const existing = groups.get(key)
    if (existing) {
      existing.patches.push(patch)
      existing.notes.push(...notes.filter((n) => !existing.notes.includes(n)))
      existing.isDeleted = existing.isDeleted || patch.isDeleted
      existing.isRename = existing.isRename || patch.isRename
      if (patch.isRename) existing.targetPath = targetPath
      continue
    }
    groups.set(key, {
      key,
      sourcePath,
      targetPath,
      displayPath,
      patches: [patch],
      notes,
      isNew: patch.isNew,
      isDeleted: patch.isDeleted,
      isRename: patch.isRename,
      missing
    })
  }
  return [...groups.values()]
}

function resolveExact(path: string, projectFiles: string[]): string | null {
  return projectFiles.includes(path) ? path : null
}
