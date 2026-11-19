import type { ComposeResult, ContextItem, LibraryKind, LibraryScope, OutputFormat, Preset, SkillInfo, TokenEstimate, TreeMode } from '../../../shared/types'
import { formatTokens } from '../lib/tree'
import { MenuButton } from './MenuButton'
import { SkillPicker } from './SkillPicker'

interface Props {
  skills: SkillInfo[]
  contextItems: ContextItem[]
  presets: Preset[]
  presetId: string | null
  contextIds: string[]
  onPreset(id: string | null): void
  onSavePreset(): void
  /** Opens the library editor on a kind, at an item or (null) a new one. */
  onOpenLibrary(kind: LibraryKind, id: string | null): void
  onToggleContext(id: string): void
  onAddContext(scope: LibraryScope): void
  /** Ticked skills, in prompt order. */
  skillIds: string[]
  task: string
  format: OutputFormat
  treeMode: TreeMode
  wholeFileLineNumbers: boolean
  fileCount: number
  estimate: TokenEstimate | null
  busy: boolean
  result: { kind: 'copy' | 'preview'; data: ComposeResult } | null
  allow: Set<string>
  mod: string
  /** The new list of ticked skills, in prompt order. */
  onSkills(ids: string[]): void
  onTask(task: string): void
  onFormat(format: OutputFormat): void
  onTreeMode(mode: TreeMode): void
  onLineNumbers(on: boolean): void
  onToggleAllow(id: string): void
  onPreview(): void
  onCopy(): void
}

const BUDGET = 200_000
const SOURCE_LABEL: Record<SkillInfo['source'], string> = { project: 'Project', user: 'Yours', 'built-in': 'Built-in' }
const SOURCES = ['project', 'user', 'built-in'] as const

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

export function Composer(props: Props) {
  const { skills, skillIds, estimate, result } = props
  const firstSkill = skills.find((s) => s.id === skillIds[0]) ?? null
  const preset = props.presets.find((p) => p.id === props.presetId) ?? null
  const presetChanged = preset !== null && (preset.skills.join('\n') !== skillIds.join('\n') || !sameSet(preset.context, props.contextIds))
  const presetGroups = SOURCES.map((source) => ({ source, items: props.presets.filter((p) => p.source === source) }))
  const total = estimate?.total ?? 0
  const pct = Math.min(100, (total / BUDGET) * 100)

  return (
    <div className="composer">
      <section>
        <div className="label-row">
          <label className="label" htmlFor="preset">
            Preset
          </label>
          <div className="label-actions">
            <button
              className="link"
              onClick={props.onSavePreset}
              disabled={skillIds.length === 0 && props.contextIds.length === 0}
              title="Save the current skills and context files as a preset"
            >
              Save current…
            </button>
            <button className="link" onClick={() => props.onOpenLibrary('presets', null)} title="Create a preset from scratch">
              New
            </button>
            <button className="link" onClick={() => props.onOpenLibrary('presets', props.presetId)} title="Edit, duplicate or delete presets">
              {preset ? 'Edit' : 'Manage'}
            </button>
          </div>
        </div>
        <select id="preset" value={props.presetId ?? ''} onChange={(e) => props.onPreset(e.target.value || null)}>
          <option value="">No preset</option>
          {presetGroups
            .filter((g) => g.items.length)
            .map((g) => (
              <optgroup key={g.source} label={`${SOURCE_LABEL[g.source]} presets`}>
                {g.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
        {preset && (
          <p className="hint">
            {preset.description || 'No description.'}
            {presetChanged && <span className="changed"> · changed since applied</span>}
          </p>
        )}
      </section>

      <section>
        <div className="label-row">
          <span className="label">
            Skills{skillIds.length > 0 && <span className="count-pill">{skillIds.length}</span>}
          </span>
          <div className="label-actions">
            <button className="link" onClick={() => props.onOpenLibrary('skills', null)} title="Write a new skill">
              New
            </button>
            <button className="link" onClick={() => props.onOpenLibrary('skills', skillIds[0] ?? null)} title="View, edit, duplicate or delete skills">
              {firstSkill && skillIds.length === 1 ? (firstSkill.source === 'built-in' ? 'View' : 'Edit') : 'Manage'}
            </button>
          </div>
        </div>
        <SkillPicker skills={skills} selected={skillIds} onChange={props.onSkills} />
      </section>

      <section>
        <div className="label-row">
          <span className="label">
            Context{props.contextIds.length > 0 && <span className="count-pill">{props.contextIds.length}</span>}
          </span>
          <div className="label-actions">
            <button className="link" onClick={() => props.onOpenLibrary('context', null)} title="Write or paste a new context file">
              New
            </button>
            <MenuButton
              label="Import…"
              items={[
                { label: 'Import files to my library…', hint: 'available in every project', onSelect: () => props.onAddContext('user') },
                { label: 'Import files to this project…', hint: '.yaz/context, shared through git', onSelect: () => props.onAddContext('project') }
              ]}
            />
            <button
              className="link"
              onClick={() => props.onOpenLibrary('context', props.contextIds[0] ?? props.contextItems[0]?.id ?? null)}
              title="Edit or delete context files"
            >
              Manage
            </button>
          </div>
        </div>
        {props.contextItems.length === 0 ? (
          <p className="hint">
            No saved context yet. Click <strong>New</strong> to write or paste guidelines, architecture notes or examples, or <strong>Import…</strong> existing files.
          </p>
        ) : (
          <ul className="context-list">
            {props.contextItems.map((item) => {
              const on = props.contextIds.includes(item.id)
              const tokens = estimate?.perFile[`context/${item.id}`]
              return (
                <li key={item.id} title={item.description || item.name}>
                  <label className={on ? 'on' : ''}>
                    <input type="checkbox" checked={on} onChange={() => props.onToggleContext(item.id)} />
                    <span className="context-name">{item.name}</span>
                    <span className={`source source-${item.source}`}>{SOURCE_LABEL[item.source]}</span>
                    {on && tokens !== undefined && <span className="tokens">{formatTokens(tokens)}</span>}
                  </label>
                  {item.description && <span className="context-desc">{item.description}</span>}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="grow">
        <label className="label" htmlFor="task">
          Task
        </label>
        <textarea
          id="task"
          placeholder="What should the AI do? e.g. “Creating an order with zero items returns 500. Find the cause and fix it.”"
          value={props.task}
          onChange={(e) => props.onTask(e.target.value)}
        />
      </section>

      <section className="options">
        <div className="option">
          <span className="label">Format</span>
          <div className="segmented">
            {(['xml', 'markdown'] as const).map((f) => (
              <button key={f} className={props.format === f ? 'on' : ''} onClick={() => props.onFormat(f)}>
                {f === 'xml' ? 'XML' : 'Markdown'}
              </button>
            ))}
          </div>
        </div>
        <div className="option">
          <label className="label" htmlFor="tree-mode">
            Directory tree
          </label>
          <select id="tree-mode" value={props.treeMode} onChange={(e) => props.onTreeMode(e.target.value as TreeMode)}>
            <option value="selected">Selected files only</option>
            <option value="full">Whole project</option>
            <option value="none">None</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={props.wholeFileLineNumbers} onChange={(e) => props.onLineNumbers(e.target.checked)} />
          Line numbers on whole files
        </label>
      </section>

      <section className="budget">
        <div className="budget-row">
          <span>
            {props.fileCount} file{props.fileCount === 1 ? '' : 's'}
            {props.contextIds.length > 0 && <span className="muted"> (incl. {props.contextIds.length} context)</span>}
          </span>
          <span title="Estimated with the o200k tokenizer; Claude and Gemini counts are similar">≈ {total.toLocaleString()} tokens</span>
        </div>
        <div className="meter" title={`${pct.toFixed(0)}% of a 200k context window`}>
          <div className={`meter-fill${pct > 90 ? ' danger' : pct > 60 ? ' warn' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      </section>

      <div className="actions">
        <button onClick={props.onPreview} disabled={props.busy || props.fileCount === 0 && !props.task.trim()}>
          Preview
        </button>
        <button className="primary" onClick={props.onCopy} disabled={props.busy || (props.fileCount === 0 && !props.task.trim())}>
          {props.busy ? 'Working…' : 'Copy prompt'}
          <kbd>{props.mod}⇧C</kbd>
        </button>
      </div>

      {result && <Review {...props} result={result} />}
    </div>
  )
}

function Review({ result, allow, onToggleAllow, onCopy, busy }: Props & { result: NonNullable<Props['result']> }) {
  const { data } = result
  const redacted = data.findings.filter((f) => !allow.has(f.id)).length
  const pendingAllow = data.findings.filter((f) => allow.has(f.id)).length
  const files = new Set(data.findings.map((f) => f.path)).size
  return (
    <div className="review">
      <div className={`review-head ${data.findings.length ? 'warn' : 'ok'}`}>
        {result.kind === 'copy' ? '✓ Copied to clipboard' : 'Preview ready'} · {data.tokens.toLocaleString()} tokens
        {data.allowedCount > 0 && <> · {data.allowedCount} secret(s) included on request</>}
      </div>
      {data.findings.length > 0 && (
        <div className="findings">
          <p>
            <strong>
              {data.findings.length} secret{data.findings.length === 1 ? '' : 's'} found in {files} file{files === 1 ? '' : 's'}
            </strong>{' '}
            {data.allowedCount === data.findings.length ? '(all included as you asked)' : '— replaced with [REDACTED] markers.'}
          </p>
          <ul>
            {data.findings.map((f) => (
              <li key={f.id + f.line}>
                <label>
                  <input type="checkbox" checked={allow.has(f.id)} onChange={() => onToggleAllow(f.id)} />
                  <span className="where">
                    {f.path}:{f.line}
                  </span>
                  <span className="rule">{f.rule}</span>
                </label>
                <code className="preview">{f.preview}</code>
              </li>
            ))}
          </ul>
          {pendingAllow > 0 && (
            <button onClick={onCopy} disabled={busy} className="danger">
              Copy again, including {pendingAllow} ticked secret{pendingAllow === 1 ? '' : 's'} (this copy only)
            </button>
          )}
          {pendingAllow === 0 && redacted > 0 && <p className="muted small">Tick a finding only if it's a false positive or a fake value.</p>}
        </div>
      )}
      {data.warnings.length > 0 && (
        <ul className="warnings">
          {data.warnings.map((w) => (
            <li key={w.path + w.message}>
              ⚠ <span className="where">{w.path}</span> {w.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
