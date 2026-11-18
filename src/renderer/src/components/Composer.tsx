import type { ComposeResult, OutputFormat, SkillInfo, TokenEstimate, TreeMode } from '../../../shared/types'

interface Props {
  skills: SkillInfo[]
  skillId: string | null
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
  onSkill(id: string | null): void
  onTask(task: string): void
  onFormat(format: OutputFormat): void
  onTreeMode(mode: TreeMode): void
  onLineNumbers(on: boolean): void
  onToggleAllow(id: string): void
  onPreview(): void
  onCopy(): void
}

const BUDGET = 200_000
const SOURCE_LABEL: Record<SkillInfo['source'], string> = { project: 'Project skills', user: 'Your skills', 'built-in': 'Built-in skills' }

export function Composer(props: Props) {
  const { skills, skillId, estimate, result } = props
  const skill = skills.find((s) => s.id === skillId) ?? null
  const groups = (['project', 'user', 'built-in'] as const).map((source) => ({ source, items: skills.filter((s) => s.source === source) }))
  const total = estimate?.total ?? 0
  const pct = Math.min(100, (total / BUDGET) * 100)

  return (
    <div className="composer">
      <section>
        <label className="label" htmlFor="skill">
          Skill
        </label>
        <select id="skill" value={skillId ?? ''} onChange={(e) => props.onSkill(e.target.value || null)}>
          <option value="">No skill</option>
          {groups
            .filter((g) => g.items.length)
            .map((g) => (
              <optgroup key={g.source} label={SOURCE_LABEL[g.source]}>
                {g.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ))}
        </select>
        {skill && (
          <p className="hint" title={skill.dir}>
            {skill.description || 'No description.'}
            {skill.extraFiles.length > 0 && <span className="muted"> · {skill.extraFiles.length} extra file(s) not included</span>}
          </p>
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
