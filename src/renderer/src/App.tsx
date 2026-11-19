import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposeRequest,
  ComposeResult,
  ContextItem,
  LibraryKind,
  LibraryScope,
  Preset,
  PresetInput,
  FileContent,
  FileSelection,
  OutputFormat,
  ProjectInfo,
  ProjectState,
  SkillInfo,
  TokenEstimate,
  TreeMode
} from '../../shared/types'
import { Composer } from './components/Composer'
import { DiffTool } from './components/DiffTool'
import { FileTree } from './components/FileTree'
import { PreviewModal } from './components/PreviewModal'
import { LibraryModal, type LibraryTarget } from './components/LibraryModal'
import { SavePresetModal } from './components/SavePresetModal'
import { Splitter, usePanelWidth } from './components/Splitter'
import { Viewer } from './components/Viewer'

const api = window.api
const MOD = api.platform === 'darwin' ? '⌘' : 'Ctrl+'

const LEFT_LIMITS = { min: 200, max: 640, initial: 300 }
const RIGHT_LIMITS = { min: 300, max: 720, initial: 370 }

const DEFAULT_STATE: ProjectState = {
  selection: {},
  task: '',
  skillIds: [],
  format: 'xml',
  treeMode: 'selected',
  wholeFileLineNumbers: false,
  contextIds: [],
  presetId: null
}

function useDarkMode(): boolean {
  const query = useMemo(() => window.matchMedia('(prefers-color-scheme: dark)'), [])
  const [dark, setDark] = useState(query.matches)
  useEffect(() => {
    const onChange = (e: MediaQueryListEvent): void => setDark(e.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [query])
  return dark
}

/** Drops selections for files that disappeared or became blocked since the last session. */
function pruneSelection(selection: Record<string, FileSelection>, project: ProjectInfo): Record<string, FileSelection> {
  const ok = new Set(project.files.filter((f) => f.status === 'ok').map((f) => f.path))
  return Object.fromEntries(Object.entries(selection).filter(([path]) => ok.has(path)))
}

export function App() {
  const dark = useDarkMode()
  const [leftWidth, setLeftWidth, resetLeft] = usePanelWidth('yaz.panel.left', LEFT_LIMITS)
  const [rightWidth, setRightWidth, resetRight] = usePanelWidth('yaz.panel.right', RIGHT_LIMITS)
  const [project, setProject] = useState<ProjectInfo | null>(null)
  const [state, setState] = useState<ProjectState>(DEFAULT_STATE)
  const [recent, setRecent] = useState<string[]>([])
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [contextItems, setContextItems] = useState<ContextItem[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [savingPreset, setSavingPreset] = useState(false)
  const [library, setLibrary] = useState<LibraryTarget | null>(null)
  const [activePath, setActivePath] = useState<string | null>(null)
  const [file, setFile] = useState<FileContent | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<TokenEstimate | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ kind: 'copy' | 'preview'; data: ComposeResult } | null>(null)
  const [preview, setPreview] = useState<ComposeResult | null>(null)
  const [allow, setAllow] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [starting, setStarting] = useState(true)
  const [tool, setTool] = useState<'prompt' | 'diff'>('prompt')
  const [diffText, setDiffText] = useState('')

  const showToast = useCallback((text: string, error = false) => {
    setToast({ text, error })
    window.setTimeout(() => setToast((t) => (t?.text === text ? null : t)), error ? 6000 : 2500)
  }, [])

  const refreshLibrary = useCallback(async () => {
    const [s, c, p] = await Promise.all([api.listSkills(), api.listContext(), api.listPresets()])
    setSkills(s)
    setContextItems(c)
    setPresets(p)
    return { skills: s, context: c, presets: p }
  }, [])

  const loadProject = useCallback(async (info: ProjectInfo | null) => {
    if (!info) return
    setProject(info)
    setState({ ...DEFAULT_STATE, ...(info.state ?? {}), selection: pruneSelection(info.state?.selection ?? {}, info) })
    setActivePath(null)
    setFile(null)
    setResult(null)
    setAllow(new Set())
    setEstimate(null)
    const library = await refreshLibrary()
    // forget skills and context files that were deleted from the library since last time
    const known = new Set(library.context.map((c) => c.id))
    const knownSkills = new Set(library.skills.map((k) => k.id))
    setState((s) => ({ ...s, contextIds: s.contextIds.filter((id) => known.has(id)), skillIds: s.skillIds.filter((id) => knownSkills.has(id)) }))
    setRecent(await api.recentProjects())
    document.title = `${info.name} — yaz-paste`
  }, [refreshLibrary])

  const run = useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn()
      } catch (err) {
        showToast(String((err as Error).message ?? err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true)
        return undefined
      }
    },
    [showToast]
  )

  // startup: folder from the command line, or the last project
  useEffect(() => {
    void (async () => {
      setRecent(await api.recentProjects())
      await run(async () => loadProject(await api.startupProject()))
      setStarting(false)
    })()
  }, [loadProject, run])

  const openFolder = useCallback(() => run(async () => loadProject(await api.openFolder())), [run, loadProject])
  const openRecent = useCallback((root: string) => run(async () => loadProject(await api.openProject(root))), [run, loadProject])
  const rescan = useCallback(
    () =>
      run(async () => {
        const info = await api.rescan()
        if (!info) return
        setProject(info)
        setState((s) => ({ ...s, selection: pruneSelection(s.selection, info) }))
        await refreshLibrary()
        showToast(`Rescanned: ${info.files.length.toLocaleString()} files`)
      }),
    [run, showToast, refreshLibrary]
  )

  // ---- presets and context library ----
  const applyPreset = useCallback(
    (id: string | null) => {
      if (!id) {
        setState((s) => ({ ...s, presetId: null }))
        return
      }
      const preset = presets.find((p) => p.id === id)
      if (!preset) return
      const known = new Set(contextItems.map((c) => c.id))
      const missing = preset.context.filter((c) => !known.has(c))
      const knownSkills = new Set(skills.map((s) => s.id))
      const skillsMissing = preset.skills.filter((s) => !knownSkills.has(s))
      setState((s) => ({
        ...s,
        presetId: id,
        skillIds: preset.skills.filter((k) => knownSkills.has(k)),
        contextIds: preset.context.filter((c) => known.has(c)),
        task: s.task.trim() ? s.task : preset.task
      }))
      if (missing.length || skillsMissing.length)
        showToast(`Preset applied, but ${[...skillsMissing.map((k) => `skill "${k}"`), ...missing].join(', ')} not found`, true)
    },
    [presets, contextItems, skills, showToast]
  )

  const addContext = useCallback(
    (scope: LibraryScope) =>
      run(async () => {
        const result = await api.addContextFiles(scope)
        if (!result.added.length && !result.skipped.length) return
        await refreshLibrary()
        setState((s) => ({ ...s, contextIds: [...new Set([...s.contextIds, ...result.added])] }))
        if (result.skipped.length) showToast(`Skipped ${result.skipped.map((f) => `${f.name} (${f.reason})`).join(', ')}`, true)
        else showToast(`Added ${result.added.length} context file${result.added.length === 1 ? '' : 's'}`)
      }),
    [run, refreshLibrary, showToast]
  )

  const openLibraryFolder = useCallback(
    (scope: LibraryScope, kind: LibraryKind) => run(() => api.openLibraryFolder(scope, kind)),
    [run]
  )

  const savePreset = useCallback(
    (input: PresetInput) =>
      run(async () => {
        const saved = await api.savePreset(input)
        await refreshLibrary()
        setState((s) => ({ ...s, presetId: saved.id }))
        setSavingPreset(false)
        showToast(`Saved preset "${saved.name}"`)
      }),
    [run, refreshLibrary, showToast]
  )


  // persist state (debounced)
  useEffect(() => {
    if (!project) return
    const t = window.setTimeout(() => void api.saveState(state).catch(() => undefined), 400)
    return () => window.clearTimeout(t)
  }, [state, project])

  const request: ComposeRequest = useMemo(
    () => ({
      selection: state.selection,
      contextIds: state.contextIds,
      task: state.task,
      skillIds: state.skillIds,
      format: state.format,
      treeMode: state.treeMode,
      wholeFileLineNumbers: state.wholeFileLineNumbers
    }),
    [state]
  )

  // token estimate (debounced)
  useEffect(() => {
    if (!project) return
    const t = window.setTimeout(() => {
      api.estimate(request).then(setEstimate, () => undefined)
    }, 300)
    return () => window.clearTimeout(t)
  }, [request, project])

  // open a file in the viewer
  const openFile = useCallback(
    async (path: string) => {
      setActivePath(path)
      setFileError(null)
      const entry = project?.files.find((f) => f.path === path)
      if (!entry || entry.status !== 'ok') {
        setFile(null)
        return
      }
      setFileLoading(true)
      try {
        setFile(await api.readFile(path))
      } catch (err) {
        setFile(null)
        setFileError((err as Error).message)
      } finally {
        setFileLoading(false)
      }
    },
    [project]
  )

  const setSelection = useCallback((update: (sel: Record<string, FileSelection>) => Record<string, FileSelection>) => {
    setState((s) => ({ ...s, selection: update(s.selection) }))
  }, [])

  const toggleFile = useCallback(
    (path: string) =>
      setSelection((sel) => {
        const next = { ...sel }
        if (next[path]) delete next[path]
        else next[path] = { mode: 'whole' }
        return next
      }),
    [setSelection]
  )

  const setMany = useCallback(
    (paths: string[], selected: boolean) =>
      setSelection((sel) => {
        const next = { ...sel }
        for (const p of paths) {
          if (selected) next[p] ??= { mode: 'whole' }
          else delete next[p]
        }
        return next
      }),
    [setSelection]
  )

  const setFileSelection = useCallback(
    (path: string, value: FileSelection | null) =>
      setSelection((sel) => {
        const next = { ...sel }
        if (value) next[path] = value
        else delete next[path]
        return next
      }),
    [setSelection]
  )

  const copy = useCallback(async () => {
    if (!project || busy) return
    setBusy(true)
    const data = await run(() => api.copy({ ...request, allow: [...allow] }))
    setBusy(false)
    if (!data) return
    setResult({ kind: 'copy', data })
    setAllow(new Set()) // an allowed secret is included for that one copy only
    showToast(data.findings.length - data.allowedCount > 0 ? `Copied · ${data.findings.length - data.allowedCount} secret(s) redacted` : 'Copied to clipboard')
  }, [project, busy, run, request, allow, showToast])

  const openPreview = useCallback(async () => {
    if (!project || busy) return
    setBusy(true)
    const data = await run(() => api.compose({ ...request, allow: [...allow] }))
    setBusy(false)
    if (!data) return
    setResult({ kind: 'preview', data })
    setPreview(data)
  }, [project, busy, run, request, allow])

  // menu shortcuts
  const handlers = useRef({ openFolder, rescan, copy, openPreview, tool })
  handlers.current = { openFolder, rescan, copy, openPreview, tool }
  useEffect(
    () =>
      api.onMenu((command) => {
        const h = handlers.current
        if (command === 'open-folder') void h.openFolder()
        else if (command === 'rescan') void h.rescan()
        // the prompt shortcuts only act in the prompt tool, so they never copy something you can't see
        else if (command === 'copy' && h.tool === 'prompt') void h.copy()
        else if (command === 'preview' && h.tool === 'prompt') void h.openPreview()
      }),
    []
  )

  const activeEntry = project?.files.find((f) => f.path === activePath) ?? null
  const fileCount = Object.keys(state.selection).length + state.contextIds.length

  if (!project) {
    return (
      <div className="welcome">
        <div className="welcome-card">
          <h1>yaz-paste</h1>
          <p className="muted">Pick files from a project, add a task and skills, and copy one clean prompt for any AI chat. Secrets are redacted before anything reaches your clipboard.</p>
          <button className="primary big-button" onClick={() => void openFolder()} disabled={starting}>
            Open folder… <kbd>{MOD}O</kbd>
          </button>
          {recent.length > 0 && (
            <div className="recent">
              <h2>Recent</h2>
              <ul>
                {recent.map((root) => (
                  <li key={root}>
                    <button className="link" onClick={() => void openRecent(root)} title={root}>
                      <strong>{root.split(/[\\/]/).pop()}</strong> <span className="muted">{root}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        {toast && <div className={`toast${toast.error ? ' error' : ''}`}>{toast.text}</div>}
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">yaz-paste</div>
        <nav className="tool-tabs" role="tablist" aria-label="Tools">
          <button role="tab" aria-selected={tool === 'prompt'} className={tool === 'prompt' ? 'on' : ''} onClick={() => setTool('prompt')} title="Build a prompt from your code">
            Prompt
          </button>
          <button role="tab" aria-selected={tool === 'diff'} className={tool === 'diff' ? 'on' : ''} onClick={() => setTool('diff')} title="See an AI answer's diffs and get the full files">
            Diff
          </button>
        </nav>
        <div className="spacer" />
        <div className="project-info" title={project.root}>
          <strong>{project.name}</strong>
          {project.types.map((t) => (
            <span key={t} className="pill">
              {t === 'dotnet' ? '.NET' : 'Node'}
            </span>
          ))}
          <span className="muted small">
            {project.files.length.toLocaleString()} files · {project.scanMode === 'git' ? 'git' : 'folder scan'}
            {project.truncated && ' · truncated'}
          </span>
        </div>
        <select
          className="recent-select"
          value=""
          onChange={(e) => {
            if (e.target.value === '__open') void openFolder()
            else if (e.target.value) void openRecent(e.target.value)
          }}
          aria-label="Switch project"
        >
          <option value="">Switch project…</option>
          <option value="__open">Open folder…</option>
          {recent
            .filter((r) => r !== project.root)
            .map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
        </select>
        <button onClick={() => setLibrary({ kind: 'presets', id: state.presetId })} title="Create and edit presets, skills and context files">
          Library
        </button>
        <button onClick={() => void rescan()} title="Rescan folder (F5)">
          Rescan
        </button>
      </header>

      {tool === 'diff' ? (
        <DiffTool files={project.files} scanKey={project} text={diffText} onText={setDiffText} dark={dark} onToast={showToast} />
      ) : (
      <main className="workspace" style={{ gridTemplateColumns: `${leftWidth}px auto minmax(0, 1fr) auto ${rightWidth}px` }}>
        <FileTree
          files={project.files}
          selection={state.selection}
          activePath={activePath}
          tokens={estimate?.perFile ?? {}}
          onToggleFile={toggleFile}
          onSetMany={setMany}
          onOpen={(p) => void openFile(p)}
        />
        <Splitter width={leftWidth} direction={1} onResize={setLeftWidth} onReset={resetLeft} label="Resize file tree" />
        <Viewer
          entry={activeEntry}
          file={file && file.path === activePath ? file : null}
          loading={fileLoading}
          error={fileError}
          selection={activePath ? state.selection[activePath] : undefined}
          dark={dark}
          onChange={(sel) => activePath && setFileSelection(activePath, sel)}
        />
        <Splitter width={rightWidth} direction={-1} onResize={setRightWidth} onReset={resetRight} label="Resize prompt panel" />
        <Composer
          skills={skills}
          contextItems={contextItems}
          presets={presets}
          presetId={state.presetId}
          contextIds={state.contextIds}
          onPreset={applyPreset}
          onSavePreset={() => setSavingPreset(true)}
          onOpenLibrary={(kind, id) => setLibrary({ kind, id })}
          onToggleContext={(id) =>
            setState((s) => ({
              ...s,
              contextIds: s.contextIds.includes(id) ? s.contextIds.filter((c) => c !== id) : [...s.contextIds, id]
            }))
          }
          onAddContext={(scope) => void addContext(scope)}
          skillIds={state.skillIds}
          task={state.task}
          format={state.format}
          treeMode={state.treeMode}
          wholeFileLineNumbers={state.wholeFileLineNumbers}
          fileCount={fileCount}
          estimate={estimate}
          busy={busy}
          result={result}
          allow={allow}
          mod={MOD}
          onSkills={(skillIds) => setState((s) => ({ ...s, skillIds }))}
          onTask={(task) => setState((s) => ({ ...s, task }))}
          onFormat={(format: OutputFormat) => setState((s) => ({ ...s, format }))}
          onTreeMode={(treeMode: TreeMode) => setState((s) => ({ ...s, treeMode }))}
          onLineNumbers={(wholeFileLineNumbers) => setState((s) => ({ ...s, wholeFileLineNumbers }))}
          onToggleAllow={(id) =>
            setAllow((prev) => {
              const next = new Set(prev)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }
          onPreview={() => void openPreview()}
          onCopy={() => void copy()}
        />
      </main>
      )}

      {preview && (
        <PreviewModal
          text={preview.text}
          tokens={preview.tokens}
          onClose={() => setPreview(null)}
          onCopy={() => {
            setPreview(null)
            void copy()
          }}
        />
      )}
      {library && (
        <LibraryModal
          target={library}
          skills={skills}
          contextItems={contextItems}
          presets={presets}
          current={{ skillIds: state.skillIds, contextIds: state.contextIds, task: state.task }}
          onClose={() => setLibrary(null)}
          onChanged={async () => {
            const lib = await refreshLibrary()
            // drop a skill or context file that was just deleted or renamed
            setState((s) => ({
              ...s,
              skillIds: s.skillIds.filter((id) => lib.skills.some((k) => k.id === id)),
              contextIds: s.contextIds.filter((id) => lib.context.some((c) => c.id === id))
            }))
          }}
          onUse={(kind, id) => {
            if (kind === 'presets') applyPreset(id)
            else if (kind === 'skills') setState((s) => ({ ...s, skillIds: s.skillIds.includes(id) ? s.skillIds : [...s.skillIds, id] }))
            else setState((s) => ({ ...s, contextIds: s.contextIds.includes(id) ? s.contextIds : [...s.contextIds, id] }))
          }}
          onAddContextFiles={(scope) => void addContext(scope)}
          onOpenFolder={(scope, kind) => void openLibraryFolder(scope, kind)}
          onError={(message) => showToast(message, true)}
        />
      )}
      {savingPreset && (
        <SavePresetModal
          skillIds={state.skillIds}
          contextIds={state.contextIds}
          task={state.task}
          current={presets.find((p) => p.id === state.presetId) ?? null}
          onCancel={() => setSavingPreset(false)}
          onSave={(input) => void savePreset(input)}
        />
      )}
      {toast && <div className={`toast${toast.error ? ' error' : ''}`}>{toast.text}</div>}
    </div>
  )
}
