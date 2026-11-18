import { useEffect, useReducer, useRef, useState } from 'react'
import type { FileContent, FileEntry, FileSelection, LineRange } from '../../../shared/types'
import { languageFor } from '../../../shared/languages'
import { addRange, countRangeLines, formatRanges, normalizeRanges, parseRanges, removeRange } from '../../../shared/ranges'
import { monaco, monacoLanguage } from '../monaco'

interface Props {
  entry: FileEntry | null
  file: FileContent | null
  loading: boolean
  error: string | null
  selection: FileSelection | undefined
  dark: boolean
  onChange(selection: FileSelection | null): void
}

const GUTTER_TARGETS = new Set([
  monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS,
  monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS,
  monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN
])

/** Width of the selection rail on the left of the editor. */
const RAIL_WIDTH = 34
/** Distance from the top/bottom edge (px) where dragging starts auto-scrolling. */
const AUTOSCROLL_EDGE = 28

type Drag =
  | { kind: 'paint'; anchor: number; base: LineRange[]; shift: boolean }
  | { kind: 'start' | 'end'; index: number; base: LineRange[] }
  | { kind: 'move'; index: number; base: LineRange[]; offset: number }

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

/** The ranges a drag would produce if the pointer were released on `line`. */
function draftFor(drag: Drag, line: number, lineCount: number): LineRange[] {
  const others = (i: number): LineRange[] => drag.base.filter((_, j) => j !== i)
  switch (drag.kind) {
    case 'paint': {
      if (drag.shift && drag.base.length) {
        // extend the nearest range to the clicked line
        let nearest = 0
        let best = Infinity
        drag.base.forEach(([a, b], i) => {
          const d = line < a ? a - line : line > b ? line - b : 0
          if (d < best) {
            best = d
            nearest = i
          }
        })
        const [a, b] = drag.base[nearest]
        return normalizeRanges([...others(nearest), [Math.min(a, line), Math.max(b, line)]], lineCount)
      }
      return addRange(drag.base, [Math.min(drag.anchor, line), Math.max(drag.anchor, line)])
    }
    case 'start':
      return normalizeRanges([...others(drag.index), [line, drag.base[drag.index][1]]], lineCount)
    case 'end':
      return normalizeRanges([...others(drag.index), [drag.base[drag.index][0], line]], lineCount)
    case 'move': {
      const [a, b] = drag.base[drag.index]
      const start = clamp(line - drag.offset, 1, Math.max(1, lineCount - (b - a)))
      return normalizeRanges([...others(drag.index), [start, start + (b - a)]], lineCount)
    }
  }
}

function displayRanges(ranges: LineRange[]): string {
  return formatRanges(ranges).replace(/,/g, ', ')
}

export function Viewer({ entry, file, loading, error, selection, dark, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  const dragRef = useRef<{ drag: Drag; clientY: number; raf: number } | null>(null)
  const [draft, setDraft] = useState<LineRange[] | null>(null)
  const [hoverLine, setHoverLine] = useState<number | null>(null)
  const [rangeText, setRangeText] = useState('')
  const [rangeError, setRangeError] = useState(false)
  const [rangeFocused, setRangeFocused] = useState(false)
  // re-render the rail when the editor scrolls, resizes or folds
  const [, redrawRail] = useReducer((n: number) => n + 1, 0)

  // latest props for event handlers that are registered once
  const latest = useRef({ file, selection, onChange })
  latest.current = { file, selection, onChange }

  const currentRanges = (): LineRange[] => (latest.current.selection?.mode === 'ranges' ? latest.current.selection.ranges : [])

  const commit = (ranges: LineRange[]): void => {
    const { file: f, selection: sel, onChange: change } = latest.current
    if (!f) return
    if (ranges.length) change({ mode: 'ranges', ranges, hash: f.hash })
    else change(sel?.mode === 'ranges' ? null : (sel ?? null))
  }

  const lineCount = (): number => editorRef.current?.getModel()?.getLineCount() ?? 1

  /** The editor line at a screen Y position (works with folded regions). */
  const lineAtClientY = (clientY: number): number => {
    const editor = editorRef.current
    const host = hostRef.current
    if (!editor || !host) return 1
    const rect = host.getBoundingClientRect()
    const y = clamp(clientY, rect.top + 1, rect.bottom - 1)
    const x = rect.left + editor.getLayoutInfo().contentLeft + 4
    const line = editor.getTargetAtClientPoint(x, y)?.position?.lineNumber
    if (line) return clamp(line, 1, lineCount())
    return clientY < rect.top ? 1 : lineCount()
  }

  // create the editor once
  useEffect(() => {
    if (!hostRef.current) return
    const editor = monaco.editor.create(hostRef.current, {
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      minimap: { enabled: true, renderCharacters: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbersMinChars: 4,
      glyphMargin: false,
      folding: true,
      renderLineHighlight: 'none',
      contextmenu: true,
      wordWrap: 'off',
      lineDecorationsWidth: 10,
      model: null
    })
    editorRef.current = editor
    decorationsRef.current = editor.createDecorationsCollection()
    const subs = [
      editor.onDidScrollChange(redrawRail),
      editor.onDidLayoutChange(redrawRail),
      editor.onDidChangeHiddenAreas(redrawRail),
      editor.onDidChangeModel(redrawRail)
    ]

    // Line numbers still work too: click/drag replaces, Shift extends, Ctrl/Cmd adds or removes.
    let gutter: { anchor: number; current: number; shift: boolean; add: boolean } | null = null
    let lastAnchor: { path: string; line: number } | null = null
    subs.push(
      editor.onMouseDown((e) => {
        if (!GUTTER_TARGETS.has(e.target.type) || !e.target.position) return
        const line = e.target.position.lineNumber
        gutter = { anchor: line, current: line, shift: e.event.shiftKey, add: e.event.ctrlKey || e.event.metaKey }
      })
    )
    const onGutterMove = (e: MouseEvent): void => {
      if (gutter) gutter.current = lineAtClientY(e.clientY)
    }
    const onGutterUp = (e: MouseEvent): void => {
      if (!gutter) return
      const g = gutter
      gutter = null
      g.current = lineAtClientY(e.clientY)
      const f = latest.current.file
      if (!f) return
      const from = Math.min(g.anchor, g.current)
      const to = Math.max(g.anchor, g.current)
      const current = currentRanges()
      let next: LineRange[]
      if (g.shift && lastAnchor?.path === f.path) next = addRange(current, [lastAnchor.line, to])
      else if (g.add) {
        const inside = current.some(([a, b]) => from >= a && from <= b)
        next = g.anchor === g.current && inside ? removeRange(current, [from, from]) : addRange(current, [from, to])
      } else next = normalizeRanges([[from, to]])
      if (!g.shift || lastAnchor?.path !== f.path) lastAnchor = { path: f.path, line: from }
      commit(next)
    }
    window.addEventListener('mousemove', onGutterMove)
    window.addEventListener('mouseup', onGutterUp)

    return () => {
      subs.forEach((s) => s.dispose())
      window.removeEventListener('mousemove', onGutterMove)
      window.removeEventListener('mouseup', onGutterUp)
      editor.getModel()?.dispose()
      editor.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // swap the model when another file opens
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const old = editor.getModel()
    if (file && !file.binary) {
      const model = monaco.editor.createModel(file.content, monacoLanguage(languageFor(file.path)))
      editor.setModel(model)
      const sel = latest.current.selection
      if (sel?.mode === 'ranges' && sel.ranges[0]) editor.revealLineNearTop(sel.ranges[0][0])
      else editor.setScrollTop(0)
    } else editor.setModel(null)
    old?.dispose()
    setDraft(null)
  }, [file])

  const shownRanges: LineRange[] = draft ?? (selection?.mode === 'ranges' ? selection.ranges : [])

  // highlight the chosen lines in the editor
  useEffect(() => {
    decorationsRef.current?.set(
      shownRanges.map(([a, b]) => ({
        range: new monaco.Range(a, 1, b, 1),
        options: { isWholeLine: true, className: 'yaz-line-selected', linesDecorationsClassName: 'yaz-gutter-selected' }
      }))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(shownRanges), file])

  useEffect(() => {
    monaco.editor.setTheme(dark ? 'vs-dark' : 'vs')
  }, [dark])

  // keep the typed ranges field in sync unless the user is editing it
  useEffect(() => {
    if (rangeFocused) return
    setRangeText(selection?.mode === 'ranges' ? displayRanges(selection.ranges) : '')
    setRangeError(false)
  }, [selection, rangeFocused])

  // ---- selection rail ------------------------------------------------------------------------

  const startDrag = (drag: Drag, clientY: number): void => {
    const state = { drag, clientY, raf: 0 }
    dragRef.current = state
    setHoverLine(null)
    setDraft(draftFor(drag, lineAtClientY(clientY), lineCount()))

    const tick = (): void => {
      const editor = editorRef.current
      const host = hostRef.current
      if (!dragRef.current || !editor || !host) return
      const rect = host.getBoundingClientRect()
      const y = dragRef.current.clientY
      let delta = 0
      if (y < rect.top + AUTOSCROLL_EDGE) delta = -Math.ceil((rect.top + AUTOSCROLL_EDGE - y) / 3)
      else if (y > rect.bottom - AUTOSCROLL_EDGE) delta = Math.ceil((y - (rect.bottom - AUTOSCROLL_EDGE)) / 3)
      if (delta) {
        editor.setScrollTop(editor.getScrollTop() + clamp(delta, -40, 40))
        setDraft(draftFor(drag, lineAtClientY(y), lineCount()))
      }
      dragRef.current.raf = requestAnimationFrame(tick)
    }
    state.raf = requestAnimationFrame(tick)

    const onMove = (e: MouseEvent): void => {
      if (!dragRef.current) return
      dragRef.current.clientY = e.clientY
      setDraft(draftFor(drag, lineAtClientY(e.clientY), lineCount()))
    }
    const onUp = (e: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (!dragRef.current) return
      cancelAnimationFrame(dragRef.current.raf)
      dragRef.current = null
      commit(draftFor(drag, lineAtClientY(e.clientY), lineCount()))
      setDraft(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onRailMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || !file) return
    e.preventDefault()
    const target = e.target as HTMLElement
    const rangeEl = target.closest<HTMLElement>('[data-index]')
    const base = currentRanges()
    if (rangeEl) {
      const index = Number(rangeEl.dataset.index)
      const part = target.closest<HTMLElement>('[data-part]')?.dataset.part
      if (part === 'remove') {
        commit(base.filter((_, i) => i !== index))
        return
      }
      if (part === 'start' || part === 'end') {
        startDrag({ kind: part, index, base }, e.clientY)
        return
      }
      if (e.detail === 2) {
        // double-click a bar to remove it
        commit(base.filter((_, i) => i !== index))
        return
      }
      startDrag({ kind: 'move', index, base, offset: lineAtClientY(e.clientY) - base[index][0] }, e.clientY)
      return
    }
    startDrag({ kind: 'paint', anchor: lineAtClientY(e.clientY), base, shift: e.shiftKey }, e.clientY)
  }

  const editor = editorRef.current
  const lineHeight = editor?.getOption(monaco.editor.EditorOption.lineHeight) ?? 19
  const scrollTop = editor?.getScrollTop() ?? 0
  const topOf = (line: number): number => (editor ? editor.getTopForLineNumber(line) - scrollTop : 0)
  const dragging = draft !== null

  const applyTyped = (): void => {
    if (!file) return
    const parsed = parseRanges(rangeText, lineCount())
    if (parsed === null) {
      setRangeError(true)
      return
    }
    setRangeError(false)
    if (parsed.length === 0) {
      if (selection?.mode === 'ranges') onChange({ mode: 'whole' })
      return
    }
    onChange({ mode: 'ranges', ranges: parsed, hash: file.hash })
    editorRef.current?.revealLineNearTop(parsed[0][0])
  }

  const useTextSelection = (): void => {
    if (!editor || !file) return
    const picked: LineRange[] = (editor.getSelections() ?? []).map((s) => {
      // a selection ending at column 1 of the next line doesn't include that line
      const end = s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber
      return [s.startLineNumber, end]
    })
    const ranges = normalizeRanges([...currentRanges(), ...picked])
    if (ranges.length) onChange({ mode: 'ranges', ranges, hash: file.hash })
  }

  const status = !selection
    ? 'Not included'
    : selection.mode === 'whole'
      ? 'Whole file included'
      : `Lines ${displayRanges(selection.ranges)} (${countRangeLines(selection.ranges)} of ${file?.lineCount ?? '?'})`

  const showEditor = Boolean(file && !file.binary && !error)

  return (
    <div className="viewer">
      {entry && (
        <div className="viewer-toolbar">
          <div className="viewer-title">
            <span className="path" title={entry.path}>
              {entry.path}
            </span>
            <span className={`status ${selection ? (selection.mode === 'whole' ? 'whole' : 'ranges') : ''}`}>{status}</span>
          </div>
          {entry.status === 'ok' && file && !file.binary && (
            <div className="viewer-actions">
              <label className={`range-field${rangeError ? ' invalid' : ''}`} title="Type line ranges, e.g. 10-25, 40. Press Enter to apply.">
                <span>Lines</span>
                <input
                  aria-label="Line ranges"
                  placeholder="e.g. 10-25, 40"
                  value={rangeText}
                  spellCheck={false}
                  onFocus={() => setRangeFocused(true)}
                  onBlur={() => {
                    setRangeFocused(false)
                    applyTyped()
                  }}
                  onChange={(e) => {
                    setRangeText(e.target.value)
                    setRangeError(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyTyped()
                    if (e.key === 'Escape') {
                      setRangeText(selection?.mode === 'ranges' ? displayRanges(selection.ranges) : '')
                      ;(e.target as HTMLInputElement).blur()
                    }
                  }}
                />
              </label>
              <button onClick={() => onChange({ mode: 'whole' })} disabled={selection?.mode === 'whole'}>
                Whole file
              </button>
              <button onClick={useTextSelection} title="Include the lines of the text you selected in the editor">
                From text selection
              </button>
              <button onClick={() => onChange(null)} disabled={!selection}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}
      {entry && showEditor && (
        <div className="viewer-hint">
          <span className="rail-swatch" /> Drag in the strip on the left to pick lines · drag the handles to resize, the bar to move · × removes
        </div>
      )}
      <div className="editor-wrap" style={{ display: showEditor ? 'block' : 'none' }}>
        <div
          className={`rail${dragging ? ' dragging' : ''}`}
          style={{ width: RAIL_WIDTH }}
          onMouseDown={onRailMouseDown}
          onMouseMove={(e) => {
            if (!dragRef.current && !(e.target as HTMLElement).closest('[data-index]')) setHoverLine(lineAtClientY(e.clientY))
            else setHoverLine(null)
          }}
          onMouseLeave={() => setHoverLine(null)}
          title=""
        >
          {editor &&
            shownRanges.map(([a, b], i) => {
              const top = topOf(a)
              const height = topOf(b) + lineHeight - top
              return (
                <div key={`${a}-${b}`} className="rail-range" data-index={draft ? undefined : i} style={{ top, height }}>
                  <div className="rail-bar" data-part="move" title={`Lines ${a}–${b}: drag to move, double-click to remove`} />
                  <div className="rail-handle top" data-part="start" title="Drag to change the first line" />
                  <div className="rail-handle bottom" data-part="end" title="Drag to change the last line" />
                  {!draft && (
                    <button className="rail-remove" data-part="remove" title="Remove these lines" tabIndex={-1}>
                      ×
                    </button>
                  )}
                  {draft && (
                    <div className="rail-bubble" style={{ top: Math.max(0, -top) }}>
                      {a === b ? `Line ${a}` : `Lines ${a}–${b}`}
                    </div>
                  )}
                </div>
              )
            })}
          {editor && hoverLine !== null && !dragging && (
            <div className="rail-ghost" style={{ top: topOf(hoverLine), height: lineHeight }}>
              <span>+</span>
            </div>
          )}
        </div>
        <div className="editor-host" ref={hostRef} style={{ left: RAIL_WIDTH }} />
      </div>
      {!showEditor && (
        <div className="viewer-empty">
          {loading ? (
            <p className="muted">Loading…</p>
          ) : error ? (
            <p className="error-text">{error}</p>
          ) : entry && entry.status !== 'ok' ? (
            <div>
              <p className="big">🔒 This file can't be viewed or included.</p>
              <p className="muted">{entry.reason}</p>
            </div>
          ) : file?.binary ? (
            <p className="muted">Binary file. It can't be included.</p>
          ) : (
            <div>
              <p className="big">Click a file to view it.</p>
              <p className="muted">Tick files to include them whole, or pick specific lines here in the viewer.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
