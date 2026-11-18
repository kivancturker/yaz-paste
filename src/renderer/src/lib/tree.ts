import type { FileEntry, FileSelection } from '../../../shared/types'

export interface DirNode {
  kind: 'dir'
  name: string
  path: string
  children: TreeNode[]
}

export interface FileNode {
  kind: 'file'
  name: string
  path: string
  entry: FileEntry
}

export type TreeNode = DirNode | FileNode

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

export function buildTree(files: FileEntry[]): DirNode {
  const root: DirNode = { kind: 'dir', name: '', path: '', children: [] }
  const dirs = new Map<string, DirNode>([['', root]])
  for (const entry of files) {
    const parts = entry.path.split('/')
    let parent = root
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join('/')
      let dir = dirs.get(path)
      if (!dir) {
        dir = { kind: 'dir', name: parts[i], path, children: [] }
        dirs.set(path, dir)
        parent.children.push(dir)
      }
      parent = dir
    }
    parent.children.push({ kind: 'file', name: parts[parts.length - 1], path: entry.path, entry })
  }
  const sort = (dir: DirNode): void => {
    dir.children.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : collator.compare(a.name, b.name)))
    for (const child of dir.children) if (child.kind === 'dir') sort(child)
  }
  sort(root)
  return root
}

export function parentDirs(path: string): string[] {
  const parts = path.split('/')
  const out: string[] = []
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join('/'))
  return out
}

/** `*` matches within a folder, `**` across folders, `?` one character. A glob without `/` matches file names anywhere. */
export function globToRegExp(glob: string): RegExp {
  let g = glob.trim()
  if (!g.includes('/')) g = '**/' + g
  let re = ''
  for (let i = 0; i < g.length; i++) {
    const c = g[i]
    if (c === '*') {
      if (g[i + 1] === '*') {
        i++
        if (g[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else re += '.*'
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, 'i')
}

export function makeFilter(query: string): ((path: string) => boolean) | null {
  const q = query.trim()
  if (!q) return null
  if (/[*?]/.test(q)) {
    const re = globToRegExp(q)
    return (path) => re.test(path)
  }
  const lower = q.toLowerCase()
  return (path) => path.toLowerCase().includes(lower)
}

export interface DirStats {
  tickable: number
  selected: number
}

/** For every folder: how many files below it can be ticked, and how many are. */
export function folderStats(files: FileEntry[], selection: Record<string, FileSelection>): Map<string, DirStats> {
  const stats = new Map<string, DirStats>()
  for (const f of files) {
    if (f.status !== 'ok') continue
    const selected = f.path in selection
    for (const dir of ['', ...parentDirs(f.path)]) {
      let s = stats.get(dir)
      if (!s) {
        s = { tickable: 0, selected: 0 }
        stats.set(dir, s)
      }
      s.tickable++
      if (selected) s.selected++
    }
  }
  return stats
}

export function tickableUnder(files: FileEntry[], dirPath: string): string[] {
  const prefix = dirPath ? dirPath + '/' : ''
  return files.filter((f) => f.status === 'ok' && f.path.startsWith(prefix)).map((f) => f.path)
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}
