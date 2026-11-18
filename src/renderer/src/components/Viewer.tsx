import { useEffect, useRef } from 'react'
import type { FileContent, FileEntry, FileSelection, LineRange } from '../../../shared/types'
import { languageFor } from '../../../shared/languages'
import { addRange, countRangeLines, formatRanges, normalizeRanges, removeRange } from '../../../shared/ranges'
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

export function Viewer({ entry, file, loading, error, selection, dark, onChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null)
  // latest props for the editor's event handlers, which are registered once
  const latest = useRef({ file, selection, onChange })
  latest.current = { file, selection, onChange }

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

    let drag: { anchor: number; current: number; shift: boolean; add: boolean } | null = null
    let lastAnchor: { path: string; line: number } | null = null

    const apply = (from: number, to: number, shift: boolean, add: boolean, isClick: boolean): void => {
      const { file: f, selection: sel, onChange: change } = latest.current
      if (!f) return
      const current: LineRange[] = sel?.mode === 'ranges' ? sel.ranges : []
      let next: LineRange[]
      if (shift && lastAnchor?.path === f.path) next = addRange(current, [lastAnchor.line, to])
      else if (add) {
        const inside = current.some(([a, b]) => from >= a && from <= b)
        next = isClick && inside ? removeRange(current, [from, from]) : addRange(current, [from, to])
      } else next = normalizeRanges([[from, to]])
      if (!shift || lastAnchor?.path !== f.path) lastAnchor = { path: f.path, line: from }
      if (next.length === 0) change(sel?.mode === 'ranges' ? null : (sel ?? null))
      else change({ mode: 'ranges', ranges: next, hash: f.hash })
    }

    const down = editor.onMouseDown((e) => {
      if (!GUTTER_TARGETS.has(e.target.type) || !e.target.position) return
      const line = e.target.position.lineNumber
      drag = { anchor: line, current: line, shift: e.event.shiftKey, add: e.event.ctrlKey || e.event.metaKey }
    })
    // Monaco runs its own drag while the button is down, so read the line under the pointer directly
    const lineAt = (clientX: number, clientY: number): number | null =>
      editor.getTargetAtClientPoint(clientX, clientY)?.position?.lineNumber ?? null
    const onMove = (e: MouseEvent): void => {
      if (!drag) return
      const line = lineAt(e.clientX, e.clientY)
      if (line !== null) drag.current = line
    }
    window.addEventListener('mousemove', onMove)
    const up = (e: MouseEvent): void => {
      if (!drag) return
      const line = lineAt(e.clientX, e.clientY)
      if (line !== null) drag.current = line
      const d = drag
      drag = null
      apply(Math.min(d.anchor, d.current), Math.max(d.anchor, d.current), d.shift, d.add, d.anchor === d.current)
    }
    window.addEventListener('mouseup', up)

    return () => {
      down.dispose()
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', up)
      editor.getModel()?.dispose()
      editor.dispose()
    }
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
      if (sel?.mode === 'ranges' && sel.ranges[0]) editor.revealLineInCenter(sel.ranges[0][0])
      else editor.setScrollTop(0)
    } else editor.setModel(null)
    old?.dispose()
  }, [file])

  // highlight the chosen lines
  useEffect(() => {
    const ranges = selection?.mode === 'ranges' ? selection.ranges : []
    decorationsRef.current?.set(
      ranges.map(([a, b]) => ({
        range: new monaco.Range(a, 1, b, 1),
        options: { isWholeLine: true, className: 'yaz-line-selected', linesDecorationsClassName: 'yaz-gutter-selected' }
      }))
    )
  }, [selection, file])

  useEffect(() => {
    monaco.editor.setTheme(dark ? 'vs-dark' : 'vs')
  }, [dark])

  const useTextSelection = (): void => {
    const editor = editorRef.current
    if (!editor || !file) return
    const picked: LineRange[] = (editor.getSelections() ?? []).map((s) => {
      // a selection ending at column 1 of the next line doesn't include that line
      const end = s.endColumn === 1 && s.endLineNumber > s.startLineNumber ? s.endLineNumber - 1 : s.endLineNumber
      return [s.startLineNumber, end]
    })
    const current = selection?.mode === 'ranges' ? selection.ranges : []
    const ranges = normalizeRanges([...current, ...picked])
    if (ranges.length) onChange({ mode: 'ranges', ranges, hash: file.hash })
  }

  const status = !selection
    ? 'Not included'
    : selection.mode === 'whole'
      ? 'Whole file included'
      : `Lines ${formatRanges(selection.ranges)} (${countRangeLines(selection.ranges)} of ${file?.lineCount ?? '?'})`

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
              <button onClick={() => onChange({ mode: 'whole' })} disabled={selection?.mode === 'whole'}>
                Whole file
              </button>
              <button onClick={useTextSelection} title="Include the lines of the text you selected in the editor">
                Use text selection
              </button>
              <button onClick={() => onChange(null)} disabled={!selection}>
                Remove
              </button>
            </div>
          )}
        </div>
      )}
      {entry && showEditor && (
        <div className="viewer-hint">Click or drag line numbers to pick lines · Shift-click extends · {window.api.platform === 'darwin' ? '⌘' : 'Ctrl'}-click adds or removes</div>
      )}
      <div className="editor-host" ref={hostRef} style={{ display: showEditor ? 'block' : 'none' }} />
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
