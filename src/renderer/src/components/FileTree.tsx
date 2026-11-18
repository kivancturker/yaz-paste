import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry, FileSelection } from '../../../shared/types'
import { formatRanges, countRangeLines } from '../../../shared/ranges'
import { buildTree, folderStats, formatTokens, makeFilter, parentDirs, type DirNode, type TreeNode } from '../lib/tree'

interface Props {
  files: FileEntry[]
  selection: Record<string, FileSelection>
  activePath: string | null
  tokens: Record<string, number>
  onToggleFile(path: string): void
  onSetMany(paths: string[], selected: boolean): void
  onOpen(path: string): void
}

const MAX_ROWS = 3000

function TriCheckbox(props: { checked: boolean; indeterminate: boolean; disabled?: boolean; onChange(): void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = props.indeterminate
  }, [props.indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={props.label}
      checked={props.checked}
      disabled={props.disabled}
      onChange={props.onChange}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

interface Row {
  node: TreeNode
  depth: number
}

export function FileTree({ files, selection, activePath, tokens, onToggleFile, onSetMany, onOpen }: Props) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const tree = useMemo(() => buildTree(files), [files])
  const stats = useMemo(() => folderStats(files, selection), [files, selection])
  const filter = useMemo(() => makeFilter(query), [query])

  const matches = useMemo(() => {
    if (!filter) return null
    const fileSet = new Set<string>()
    const dirSet = new Set<string>()
    for (const f of files) {
      if (filter(f.path)) {
        fileSet.add(f.path)
        for (const d of parentDirs(f.path)) dirSet.add(d)
      }
    }
    return { fileSet, dirSet }
  }, [files, filter])

  // reveal the file opened in the viewer
  useEffect(() => {
    if (!activePath) return
    setExpanded((prev) => {
      const dirs = parentDirs(activePath)
      if (dirs.every((d) => prev.has(d))) return prev
      return new Set([...prev, ...dirs])
    })
  }, [activePath])

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (dir: DirNode, depth: number): void => {
      for (const node of dir.children) {
        if (out.length >= MAX_ROWS) return
        if (matches) {
          if (node.kind === 'dir' ? !matches.dirSet.has(node.path) : !matches.fileSet.has(node.path)) continue
        }
        out.push({ node, depth })
        if (node.kind === 'dir' && (matches || expanded.has(node.path))) walk(node, depth + 1)
      }
    }
    walk(tree, 0)
    return out
  }, [tree, expanded, matches])

  const toggleExpand = (path: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const toggleDir = (path: string): void => {
    const prefix = path + '/'
    const under = files.filter((f) => f.status === 'ok' && f.path.startsWith(prefix) && (!matches || matches.fileSet.has(f.path)))
    const allSelected = under.every((f) => f.path in selection)
    onSetMany(
      under.map((f) => f.path),
      !allSelected
    )
  }

  const shownTickable = matches ? files.filter((f) => f.status === 'ok' && matches.fileSet.has(f.path)).map((f) => f.path) : []
  const rootStats = stats.get('') ?? { tickable: 0, selected: 0 }
  const selectedCount = Object.keys(selection).length

  return (
    <div className="tree-panel">
      <div className="tree-toolbar">
        <input
          className="search"
          type="search"
          placeholder="Filter files…  (e.g. Order or src/**/*.cs)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <div className="tree-actions">
          {matches ? (
            <>
              <span className="muted">{matches.fileSet.size} match{matches.fileSet.size === 1 ? '' : 'es'}</span>
              <button className="link" disabled={shownTickable.length === 0} onClick={() => onSetMany(shownTickable, true)}>
                Tick all shown
              </button>
              <button className="link" disabled={shownTickable.length === 0} onClick={() => onSetMany(shownTickable, false)}>
                Untick shown
              </button>
            </>
          ) : (
            <>
              <span className="muted">
                {selectedCount} of {rootStats.tickable} files ticked
              </span>
              <button className="link" disabled={selectedCount === 0} onClick={() => onSetMany(Object.keys(selection), false)}>
                Clear
              </button>
              <button className="link" disabled={expanded.size === 0} onClick={() => setExpanded(new Set())}>
                Collapse all
              </button>
            </>
          )}
        </div>
      </div>

      <div className="tree" role="tree">
        {rows.map(({ node, depth }) => {
          const pad = { paddingLeft: 8 + depth * 14 }
          if (node.kind === 'dir') {
            const s = stats.get(node.path) ?? { tickable: 0, selected: 0 }
            const isOpen = Boolean(matches) || expanded.has(node.path)
            return (
              <div key={node.path} className="row dir" style={pad} role="treeitem" aria-expanded={isOpen} onClick={() => toggleExpand(node.path)}>
                <span className="chevron">{isOpen ? '▾' : '▸'}</span>
                <TriCheckbox
                  label={`Tick folder ${node.path}`}
                  checked={s.tickable > 0 && s.selected === s.tickable}
                  indeterminate={s.selected > 0 && s.selected < s.tickable}
                  disabled={s.tickable === 0}
                  onChange={() => toggleDir(node.path)}
                />
                <span className="name">{node.name}</span>
                {s.selected > 0 && <span className="count">{s.selected}</span>}
              </div>
            )
          }
          const { entry } = node
          const sel = selection[node.path]
          const locked = entry.status !== 'ok'
          return (
            <div
              key={node.path}
              className={`row file${activePath === node.path ? ' active' : ''}${locked ? ' locked' : ''}`}
              style={pad}
              role="treeitem"
              title={entry.reason ?? node.path}
              onClick={() => onOpen(node.path)}
            >
              <span className="chevron" />
              <TriCheckbox
                label={`Tick ${node.path}`}
                checked={Boolean(sel)}
                indeterminate={false}
                disabled={locked}
                onChange={() => onToggleFile(node.path)}
              />
              <span className="name">{node.name}</span>
              {locked && <span className="badge lock" title={entry.reason}>🔒</span>}
              {entry.sensitive && <span className="badge shield" title="Config file that often holds secrets. Always scanned before copying.">🛡</span>}
              {sel?.mode === 'ranges' && (
                <span className="badge ranges" title={`Lines ${formatRanges(sel.ranges)}`}>
                  {sel.ranges.length === 1 ? `L${formatRanges(sel.ranges)}` : `${countRangeLines(sel.ranges)} lines`}
                </span>
              )}
              {sel && tokens[node.path] !== undefined && <span className="tokens">{formatTokens(tokens[node.path])}</span>}
            </div>
          )
        })}
        {rows.length >= MAX_ROWS && <div className="muted pad">Showing the first {MAX_ROWS} rows. Use the filter to narrow down.</div>}
        {rows.length === 0 && <div className="muted pad">{matches ? 'No files match.' : 'No files found.'}</div>}
      </div>
    </div>
  )
}
