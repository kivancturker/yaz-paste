import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry } from '../../../shared/types'
import { languageFor } from '../../../shared/languages'
import { applyPatches, type ApplyResult, type HunkNote } from '../../../tools/diff/apply'
import { parseDiff, type FilePatch } from '../../../tools/diff/parse'
import { groupPatches, type FileGroup } from '../../../tools/diff/resolve'
import { monaco, monacoLanguage } from '../monaco'
import { Splitter, usePanelWidth } from './Splitter'

const api = window.api
const LIMITS = { min: 260, max: 760, initial: 400 }

type FileState =
  | { kind: 'missing'; message: string }
  | { kind: 'read-error'; message: string }
  | { kind: 'result'; original: string | null; result: ApplyResult }

interface Entry {
  group: FileGroup
  state: FileState
  added: number
  removed: number
}

type Tone = 'ok' | 'warn' | 'bad' | 'muted'

function statusOf(entry: Entry): { label: string; tone: Tone; icon: string } {
  const s = entry.state
  if (s.kind === 'missing') return { label: 'Not in project', tone: 'bad', icon: '✕' }
  if (s.kind === 'read-error') return { label: 'Can’t read', tone: 'bad', icon: '✕' }
  switch (s.result.status) {
    case 'clean':
      return { label: 'Ready', tone: 'ok', icon: '✓' }
    case 'warnings':
      return { label: 'Check', tone: 'warn', icon: '!' }
    case 'already-applied':
      return { label: 'Already applied', tone: 'muted', icon: '=' }
    case 'failed':
      return { label: 'Can’t apply', tone: 'bad', icon: '✕' }
  }
}

function countChanges(patches: FilePatch[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const p of patches)
    for (const h of p.hunks)
      for (const l of h.lines) {
        if (l.kind === '+') added++
        else if (l.kind === '-') removed++
      }
  return { added, removed }
}

function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/')
  // no trailing slash: the folder is shown right-to-left (so long paths keep their end), which would move it to the front
  return i === -1 ? { dir: '', name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) }
}

async function evaluate(text: string, files: FileEntry[]): Promise<{ entries: Entry[]; warnings: string[] }> {
  const parsed = parseDiff(text)
  const groups = groupPatches(
    parsed.files,
    files.map((f) => f.path)
  )
  const byPath = new Map(files.map((f) => [f.path, f]))
  const entries = await Promise.all(
    groups.map(async (group): Promise<Entry> => {
      const counts = countChanges(group.patches)
      if (group.missing)
        return {
          group,
          ...counts,
          state: { kind: 'missing', message: group.notes[0] ?? 'This file isn’t in the open project (or it’s ignored by the scan).' }
        }
      let original: string | null = null
      if (group.sourcePath) {
        const entry = byPath.get(group.sourcePath)
        if (entry && entry.status !== 'ok')
          return { group, ...counts, state: { kind: 'read-error', message: entry.reason ?? 'This file can’t be opened.' } }
        try {
          const file = await api.readFile(group.sourcePath)
          if (file.binary) return { group, ...counts, state: { kind: 'read-error', message: 'This is a binary file.' } }
          original = file.content
        } catch (err) {
          return { group, ...counts, state: { kind: 'read-error', message: cleanError(err) } }
        }
      }
      return { group, ...counts, state: { kind: 'result', original, result: applyPatches(original, group.patches) } }
    })
  )
  return { entries, warnings: parsed.warnings }
}

function cleanError(err: unknown): string {
  return String((err as Error)?.message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

interface Props {
  files: FileEntry[]
  /** Changes whenever the project is rescanned, so files are read again. */
  scanKey: unknown
  text: string
  onText(text: string): void
  dark: boolean
  onToast(text: string, error?: boolean): void
}

export function DiffTool({ files, scanKey, text, onText, dark, onToast }: Props) {
  const [width, setWidth, resetWidth] = usePanelWidth('yaz.panel.diff', LIMITS)
  const [data, setData] = useState<{ entries: Entry[]; warnings: string[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [view, setView] = useState<'changes' | 'code'>('changes')
  const [layout, setLayout] = useState<'split' | 'inline'>(() => {
    try {
      return window.localStorage.getItem('yaz.diff.layout') === 'inline' ? 'inline' : 'split'
    } catch {
      return 'split'
    }
  })
  const [refresh, setRefresh] = useState(0)
  const [sideOpen, setSideOpen] = useState(() => {
    try {
      return window.localStorage.getItem('yaz.diff.side') !== 'closed'
    } catch {
      return true
    }
  })
  const toggleSide = (): void =>
    setSideOpen((open) => {
      try {
        window.localStorage.setItem('yaz.diff.side', open ? 'closed' : 'open')
      } catch {
        // not remembered
      }
      return !open
    })
  const toggleRef = useRef(toggleSide)
  toggleRef.current = toggleSide

  // Ctrl/Cmd+B shows or hides the answer panel (like the sidebar in VS Code)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        toggleRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // parse + apply, debounced while typing
  useEffect(() => {
    if (!text.trim()) {
      setData(null)
      return
    }
    let cancelled = false
    const t = window.setTimeout(() => {
      setBusy(true)
      evaluate(text, files)
        .then((d) => {
          if (cancelled) return
          setData(d)
          setSelected((cur) => (cur && d.entries.some((e) => e.group.key === cur) ? cur : (d.entries[0]?.group.key ?? null)))
        })
        .catch((err) => !cancelled && onToast(cleanError(err), true))
        .finally(() => !cancelled && setBusy(false))
    }, 200)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [text, files, scanKey, refresh, onToast])

  const entry = data?.entries.find((e) => e.group.key === selected) ?? null
  const summary = useMemo(() => {
    const list = data?.entries ?? []
    const by = (tone: Tone): number => list.filter((e) => statusOf(e).tone === tone).length
    return { total: list.length, ok: by('ok'), warn: by('warn'), bad: by('bad'), same: by('muted') }
  }, [data])

  const result = entry?.state.kind === 'result' ? entry.state : null
  const content = result?.result.content ?? null
  const canCopy = content !== null && result?.result.status !== 'failed'

  const copy = async (): Promise<void> => {
    if (content === null) return
    try {
      await api.copyText(content)
      onToast(`Copied ${entry ? splitPath(entry.group.displayPath).name : 'file'} (${content.split('\n').length - (content.endsWith('\n') ? 1 : 0)} lines)`)
    } catch (err) {
      onToast(cleanError(err), true)
    }
  }

  const setLayoutRemembered = (l: 'split' | 'inline'): void => {
    setLayout(l)
    try {
      window.localStorage.setItem('yaz.diff.layout', l)
    } catch {
      // not remembered
    }
  }

  const jumpRef = useRef<((line: number) => void) | null>(null)

  return (
    <main className="workspace diff-workspace" style={{ gridTemplateColumns: sideOpen ? `${width}px auto minmax(0, 1fr)` : 'minmax(0, 1fr)' }}>
      {sideOpen && (
      <aside className="diff-side">
        <section className="diff-input">
          <div className="diff-input-head">
            <span className="label">AI answer</span>
            <span className="spacer" />
            {text && (
              <button className="link small" onClick={() => setRefresh((n) => n + 1)} title="Read the files from disk again">
                Re-check
              </button>
            )}
            {text && (
              <button className="link small" onClick={() => onText('')}>
                Clear
              </button>
            )}
          </div>
          <textarea
            className="diff-textarea"
            value={text}
            spellCheck={false}
            placeholder={'Paste the whole answer here.\n\nDiffs are found inside it (```diff blocks or raw git diff output) and checked line by line against the files of this project.'}
            onChange={(e) => onText(e.target.value)}
            aria-label="AI answer with diffs"
          />
        </section>

        {data && (
          <section className="diff-files">
            <div className="diff-summary">
              <span className="label">Files</span>
              <span className="muted small">
                {busy
                  ? 'Checking…'
                  : summary.total === 0
                    ? 'no diffs found'
                    : [
                        summary.ok && `${summary.ok} ready`,
                        summary.warn && `${summary.warn} to check`,
                        summary.bad && `${summary.bad} can’t apply`,
                        summary.same && `${summary.same} already applied`
                      ]
                        .filter(Boolean)
                        .join(' · ')}
              </span>
            </div>
            <ul className="diff-file-list" role="listbox" aria-label="Changed files">
              {data.entries.map((e) => {
                const st = statusOf(e)
                const { dir, name } = splitPath(e.group.displayPath)
                return (
                  <li key={e.group.key}>
                    <button
                      className={`diff-file${e.group.key === selected ? ' active' : ''}`}
                      onClick={() => setSelected(e.group.key)}
                      role="option"
                      aria-selected={e.group.key === selected}
                      title={e.group.displayPath}
                    >
                      <span className={`diff-dot ${st.tone}`} aria-label={st.label}>
                        {st.icon}
                      </span>
                      <span className="diff-file-name">
                        <span className="name">{name}</span>
                        {dir && <span className="dir">{dir}</span>}
                      </span>
                      {e.group.isNew && <span className="tag new">new</span>}
                      {e.group.isDeleted && <span className="tag del">deleted</span>}
                      {e.group.isRename && <span className="tag">renamed</span>}
                      <span className="diff-counts">
                        <span className="add">+{e.added}</span> <span className="rem">−{e.removed}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {data.warnings.map((w) => (
              <p key={w} className="hint warn-text">
                {w}
              </p>
            ))}
          </section>
        )}
      </aside>

      )}
      {sideOpen && <Splitter width={width} direction={1} onResize={setWidth} onReset={resetWidth} label="Resize answer panel" />}

      <section className="viewer diff-main">
        {!sideOpen && (!text.trim() || !entry) && (
          <div className="viewer-toolbar">
            <SideToggle open={sideOpen} onToggle={toggleSide} />
            <span className="muted small">Show the answer panel to paste an AI answer.</span>
          </div>
        )}
        {!text.trim() ? (
          <EmptyState />
        ) : !entry ? (
          <div className="viewer-empty">
            <div>
              <div className="big">{busy ? 'Checking…' : 'No diffs found in this text'}</div>
              {!busy && (
                <p className="muted small">
                  Diffs need file headers (<code>--- a/path</code> and <code>+++ b/path</code>) followed by <code>@@</code> hunks.
                </p>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="viewer-toolbar">
              <SideToggle open={sideOpen} onToggle={toggleSide} />
              {!sideOpen && data && data.entries.length > 1 && (
                <select className="diff-file-select" value={selected ?? ''} onChange={(e) => setSelected(e.target.value)} aria-label="Changed file">
                  {data.entries.map((e) => {
                    const st = statusOf(e)
                    return (
                      <option key={e.group.key} value={e.group.key}>
                        {st.icon} {splitPath(e.group.displayPath).name} · {st.label}
                      </option>
                    )
                  })}
                </select>
              )}
              <div className="viewer-title">
                <span className="path">
                  {entry.group.isRename && entry.group.sourcePath ? `${entry.group.sourcePath} → ` : ''}
                  {entry.group.displayPath}
                </span>
                <span className={`status tone-${statusOf(entry).tone}`}>{describe(entry)}</span>
              </div>
              <div className="viewer-actions">
                {result && content !== null && (
                  <div className="segmented" role="group" aria-label="View">
                    <button className={view === 'changes' ? 'on' : ''} onClick={() => setView('changes')}>
                      Changes
                    </button>
                    <button className={view === 'code' ? 'on' : ''} onClick={() => setView('code')}>
                      Full code
                    </button>
                  </div>
                )}
                {result && content !== null && view === 'changes' && (
                  <div className="segmented" role="group" aria-label="Layout">
                    <button className={layout === 'split' ? 'on' : ''} onClick={() => setLayoutRemembered('split')} title="Old and new side by side">
                      Side by side
                    </button>
                    <button className={layout === 'inline' ? 'on' : ''} onClick={() => setLayoutRemembered('inline')} title="One column">
                      Inline
                    </button>
                  </div>
                )}
                <button className="primary" disabled={!canCopy} onClick={() => void copy()} title={canCopy ? 'Copy the complete new file' : 'Nothing to copy: the diff couldn’t be applied'}>
                  Copy full file
                </button>
              </div>
            </div>
            <Notes entry={entry} onJump={(line) => jumpRef.current?.(line)} />
            {result && (content !== null || result.result.status !== 'failed') ? (
              <CodeView
                key={entry.group.key}
                path={entry.group.targetPath ?? entry.group.displayPath}
                original={result.original ?? ''}
                modified={content ?? ''}
                mode={view === 'code' && content !== null ? 'code' : layout}
                dark={dark}
                jumpRef={jumpRef}
              />
            ) : (
              <RawPatch patches={entry.group.patches} result={result?.result ?? null} />
            )}
          </>
        )}
      </section>
    </main>
  )
}

const MOD = window.api.platform === 'darwin' ? '⌘' : 'Ctrl+'

function SideToggle({ open, onToggle }: { open: boolean; onToggle(): void }) {
  return (
    <button
      className={`icon-button${open ? ' on' : ''}`}
      onClick={onToggle}
      title={`${open ? 'Hide' : 'Show'} the answer panel (${MOD}B)`}
      aria-label={open ? 'Hide the answer panel' : 'Show the answer panel'}
      aria-pressed={open}
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.2" />
        {open && <rect x="2.2" y="3.2" width="3.3" height="9.6" rx="0.8" fill="currentColor" opacity="0.35" />}
      </svg>
    </button>
  )
}

function describe(entry: Entry): string {
  const s = entry.state
  if (s.kind !== 'result') return statusOf(entry).label
  const r = s.result
  const hunks = r.hunks.length
  const n = `${hunks} change${hunks === 1 ? '' : 's'}`
  switch (r.status) {
    case 'clean':
      return entry.group.isNew ? 'New file · ready to copy' : entry.group.isDeleted ? 'File deleted' : `${n} applied exactly · ready to copy`
    case 'warnings':
      return `${n} applied · check the flagged ones before copying`
    case 'already-applied':
      return 'The file already contains these changes'
    case 'failed':
      return 'The diff doesn’t match the file · no full code produced'
  }
}

function EmptyState() {
  return (
    <div className="viewer-empty">
      <div className="diff-empty">
        <div className="big">Paste an AI answer to see its diffs</div>
        <p className="muted small">
          Each diff is applied to the real file from this project, line by line. You get a clean side-by-side view and the complete new file, ready to copy, so the AI
          never has to write both.
        </p>
        <ul className="muted small diff-rules">
          <li>
            <strong className="tone-ok">Ready</strong>: every change was found in exactly one place in the file.
          </li>
          <li>
            <strong className="tone-warn">Check</strong>: applied, but something needs a look (the match was found by ignoring indentation, or a repeated block was
            placed by its line number).
          </li>
          <li>
            <strong className="tone-bad">Can’t apply</strong>: a line doesn’t match the file. You’ll see which one; no full code is produced, so nothing wrong gets copied.
          </li>
        </ul>
        <p className="muted small">
          Tip: in the Prompt tab, pick the <em>Change with diffs</em> preset or the <em>diff-patch</em> skill (or tick the <em>answer-with-diffs</em> context file) so the AI answers in exactly this format.
        </p>
      </div>
    </div>
  )
}

function Notes({ entry, onJump }: { entry: Entry; onJump(line: number): void }) {
  const items: { level: HunkNote['level']; text: string; line?: number; label?: string }[] = []
  const s = entry.state
  if (s.kind !== 'result') items.push({ level: 'error', text: s.message })
  for (const n of entry.group.notes) if (s.kind === 'result') items.push({ level: 'info', text: n })
  for (const p of entry.group.patches) for (const w of p.warnings) items.push({ level: 'info', text: w })
  if (s.kind === 'result') {
    for (const n of s.result.notes) items.push(n)
    s.result.hunks.forEach((h) => {
      for (const n of h.notes) items.push({ ...n, line: h.newLine ?? undefined, label: `Change ${h.index + 1}` })
    })
  }
  const important = items.filter((i) => i.level !== 'info')
  const info = items.filter((i) => i.level === 'info')
  const [showInfo, setShowInfo] = useState(false)
  if (!items.length) return null
  return (
    <div className="diff-notes">
      {[...important, ...(showInfo ? info : [])].map((n, i) => (
        <div key={i} className={`diff-note ${n.level}`}>
          <span className="diff-note-icon">{n.level === 'error' ? '✕' : n.level === 'warn' ? '!' : 'i'}</span>
          <span>
            {n.label && (
              <button className="link" disabled={n.line === undefined} onClick={() => n.line !== undefined && onJump(n.line)}>
                {n.label}
              </button>
            )}
            {n.label && ': '}
            {n.text}
          </span>
        </div>
      ))}
      {info.length > 0 && (
        <button className="link small diff-notes-toggle" onClick={() => setShowInfo((v) => !v)}>
          {showInfo ? 'Hide details' : `${info.length} detail${info.length === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  )
}

/** Monaco diff editor (original vs rebuilt file), or the rebuilt file alone. Diffs are computed from the real files. */
function CodeView({
  path,
  original,
  modified,
  mode,
  dark,
  jumpRef
}: {
  path: string
  original: string
  modified: string
  mode: 'split' | 'inline' | 'code'
  dark: boolean
  jumpRef: React.MutableRefObject<((line: number) => void) | null>
}) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    monaco.editor.setTheme(dark ? 'vs-dark' : 'vs')
  }, [dark])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const language = monacoLanguage(languageFor(path))
    const common: monaco.editor.IEditorOptions = {
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbersMinChars: 4,
      renderLineHighlight: 'none',
      minimap: { enabled: false },
      wordWrap: 'off'
    }
    const modifiedModel = monaco.editor.createModel(modified, language)
    if (mode === 'code') {
      const editor = monaco.editor.create(host, { ...common, model: modifiedModel, minimap: { enabled: true, renderCharacters: false } })
      jumpRef.current = (line) => {
        editor.revealLineInCenter(line)
        editor.setSelection(new monaco.Selection(line, 1, line, 1))
      }
      return () => {
        jumpRef.current = null
        editor.dispose()
        modifiedModel.dispose()
      }
    }
    const originalModel = monaco.editor.createModel(original, language)
    const editor = monaco.editor.createDiffEditor(host, {
      ...common,
      originalEditable: false,
      renderSideBySide: mode === 'split',
      useInlineViewWhenSpaceIsLimited: false,
      ignoreTrimWhitespace: false,
      renderIndicators: true,
      // One scrollbar only: Monaco's own diff overview ruler is a second, 30px-wide strip with its own slider,
      // and each side has a scrollbar too. The sides scroll together, so the right editor's scrollbar is enough;
      // the change markers are drawn into it below.
      renderOverviewRuler: false,
      hideUnchangedRegions: { enabled: true, contextLineCount: 4, minimumLineCount: 6, revealLineCount: 20 },
      diffAlgorithm: 'advanced'
    })
    editor.setModel({ original: originalModel, modified: modifiedModel })
    const left = editor.getOriginalEditor()
    const right = editor.getModifiedEditor()
    left.updateOptions({ scrollbar: { vertical: 'hidden', verticalScrollbarSize: 0 }, overviewRulerLanes: 0, overviewRulerBorder: false })
    right.updateOptions({ overviewRulerLanes: 1, overviewRulerBorder: false, hideCursorInOverviewRuler: true })

    // change markers in the remaining scrollbar: green = added, blue = changed, red = removed
    const markers = right.createDecorationsCollection()
    const paintMarkers = (): void => {
      const changes = editor.getLineChanges() ?? []
      markers.set(
        changes.map((c) => {
          const removedOnly = c.modifiedEndLineNumber === 0
          const added = c.originalEndLineNumber === 0
          const start = Math.max(1, c.modifiedStartLineNumber)
          const end = removedOnly ? start : c.modifiedEndLineNumber
          return {
            range: new monaco.Range(start, 1, end, 1),
            options: {
              overviewRuler: {
                color: removedOnly ? 'rgba(220, 70, 70, 0.9)' : added ? 'rgba(60, 170, 90, 0.9)' : 'rgba(80, 130, 240, 0.9)',
                position: monaco.editor.OverviewRulerLane.Full
              }
            }
          }
        })
      )
    }
    const diffSub = editor.onDidUpdateDiff(paintMarkers)
    jumpRef.current = (line) => right.revealLineInCenter(line)
    return () => {
      jumpRef.current = null
      diffSub.dispose()
      markers.clear()
      editor.dispose()
      originalModel.dispose()
      modifiedModel.dispose()
    }
  }, [path, original, modified, mode, jumpRef])

  return (
    <div className="editor-wrap">
      <div ref={hostRef} className="editor-host diff-editor-host" />
    </div>
  )
}

/** The diff as the AI wrote it, for files where it couldn't be applied: still readable, with failing hunks marked. */
function RawPatch({ patches, result }: { patches: FilePatch[]; result: ApplyResult | null }) {
  let index = 0
  return (
    <div className="raw-patch">
      {patches.map((p, pi) =>
        p.hunks.map((h, hi) => {
          const hr = result?.hunks[index++]
          let oldNo = h.oldStart ?? 0
          let newNo = h.newStart ?? 0
          const numbered = h.oldStart !== null
          return (
            <div key={`${pi}-${hi}`} className={`raw-hunk${hr?.status === 'failed' ? ' failed' : ''}`}>
              <div className="raw-hunk-head">
                <span>
                  Change {index}
                  {h.oldStart !== null ? ` · line ${h.oldStart}` : ''}
                  {h.section ? ` · ${h.section}` : ''}
                </span>
                {hr && <span className={`tone-${hr.status === 'failed' ? 'bad' : hr.status === 'applied' ? 'ok' : 'muted'}`}>{hr.status === 'failed' ? 'doesn’t match' : hr.status === 'applied' ? 'matches' : 'already applied'}</span>}
              </div>
              <table className="raw-lines">
                <tbody>
                  {h.lines.map((l, li) => {
                    const o = l.kind !== '+' && numbered ? oldNo++ : ''
                    const n = l.kind !== '-' && numbered ? newNo++ : ''
                    return (
                      <tr key={li} className={l.kind === '+' ? 'add' : l.kind === '-' ? 'rem' : ''}>
                        <td className="no">{o}</td>
                        <td className="no">{n}</td>
                        <td className="sign">{l.kind === ' ' ? '' : l.kind === '-' ? '−' : '+'}</td>
                        <td className="code">{l.text || ' '}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })
      )}
    </div>
  )
}
