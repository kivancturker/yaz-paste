import type { SkillInfo, SkillSource } from '../../../shared/types'

const SOURCE_LABEL: Record<SkillSource, string> = { project: 'Project', user: 'Yours', 'built-in': 'Built-in' }
const SOURCES: SkillSource[] = ['project', 'user', 'built-in']

interface Props {
  skills: SkillInfo[]
  /** Ticked skill ids, in prompt order. */
  selected: string[]
  onChange(selected: string[]): void
  disabled?: boolean
  /** Smaller list, no descriptions (for the preset editor). */
  compact?: boolean
}

/**
 * Tick any number of skills. They go into the prompt in the order they were ticked; with two or more,
 * a row of chips shows that order and lets you move them.
 */
export function SkillPicker({ skills, selected, onChange, disabled, compact }: Props) {
  const sorted = SOURCES.flatMap((source) => skills.filter((s) => s.source === source))
  // ids that are ticked but no longer exist (e.g. a preset naming a deleted skill)
  const missing = selected.filter((id) => !skills.some((s) => s.id === id))

  const toggle = (id: string): void => onChange(selected.includes(id) ? selected.filter((k) => k !== id) : [...selected, id])
  const move = (id: string, delta: -1 | 1): void => {
    const i = selected.indexOf(id)
    const j = i + delta
    if (i < 0 || j < 0 || j >= selected.length) return
    const next = [...selected]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }

  return (
    <>
      {sorted.length === 0 && missing.length === 0 ? (
        <p className="hint">No skills found.</p>
      ) : (
        <ul className={`context-list skill-list${compact ? ' compact' : ''}`} aria-label="Skills">
          {sorted.map((s) => {
            const order = selected.indexOf(s.id)
            const on = order >= 0
            return (
              <li key={s.id} title={[s.description, s.dir].filter(Boolean).join('\n')}>
                <label className={on ? 'on' : ''}>
                  <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(s.id)} />
                  <span className="context-name">{s.name}</span>
                  {on && selected.length > 1 && (
                    <span className="order-badge" title="Position in the prompt">
                      {order + 1}
                    </span>
                  )}
                  <span className={`source source-${s.source}`}>{SOURCE_LABEL[s.source]}</span>
                </label>
                {on && !compact && (
                  <span className="context-desc">
                    {s.description || 'No description.'}
                    {s.extraFiles.length > 0 && ` · ${s.extraFiles.length} extra file(s) not included`}
                  </span>
                )}
              </li>
            )
          })}
          {missing.map((id) => (
            <li key={id} title="This skill wasn't found">
              <label className="on">
                <input type="checkbox" checked disabled={disabled} onChange={() => toggle(id)} />
                <span className="context-name">{id}</span>
                <span className="source missing">missing</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {selected.length > 1 && (
        <div className="skill-order" aria-label="Order of the skills in the prompt">
          <span className="muted small">Prompt order</span>
          {selected.map((id, i) => (
            <span key={id} className="skill-chip">
              <button
                type="button"
                className="chip-move"
                disabled={disabled || i === 0}
                onClick={() => move(id, -1)}
                aria-label={`Move ${id} earlier`}
                title="Earlier"
              >
                ‹
              </button>
              <span className="chip-name">
                {i + 1}. {id}
              </span>
              <button
                type="button"
                className="chip-move"
                disabled={disabled || i === selected.length - 1}
                onClick={() => move(id, 1)}
                aria-label={`Move ${id} later`}
                title="Later"
              >
                ›
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  )
}
