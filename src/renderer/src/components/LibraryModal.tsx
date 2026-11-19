import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ContextItem, LibraryItemDetail, LibraryKind, LibraryScope, Preset, SkillInfo, SkillSource } from '../../../shared/types'
import { MenuButton } from './MenuButton'
import { SkillPicker } from './SkillPicker'

const api = window.api

export interface LibraryTarget {
  kind: LibraryKind
  /** An item to open, or null to start a new one. */
  id: string | null
}

interface Props {
  target: LibraryTarget
  skills: SkillInfo[]
  contextItems: ContextItem[]
  presets: Preset[]
  /** The composer's current choices, offered as a starting point for new presets. */
  current: { skillIds: string[]; contextIds: string[]; task: string }
  onClose(): void
  /** Reloads the library lists after a change. */
  onChanged(): Promise<void>
  /** Apply a preset / select a skill / tick a context file in the composer. */
  onUse(kind: LibraryKind, id: string): void
  onAddContextFiles(scope: LibraryScope): void
  onOpenFolder(scope: LibraryScope, kind: LibraryKind): void
  onError(message: string): void
}

interface Draft {
  name: string
  description: string
  body: string
  skills: string[]
  context: string[]
  scope: LibraryScope
}

const EMPTY: Draft = { name: '', description: '', body: '', skills: [], context: [], scope: 'user' }

const TABS: { kind: LibraryKind; label: string; singular: string }[] = [
  { kind: 'presets', label: 'Presets', singular: 'preset' },
  { kind: 'skills', label: 'Skills', singular: 'skill' },
  { kind: 'context', label: 'Context', singular: 'context file' }
]

const SOURCE_LABEL: Record<SkillSource, string> = { project: 'Project', user: 'Yours', 'built-in': 'Built-in' }

const SKILL_TEMPLATE = `You are a senior engineer. <What role should the AI take?>

1. <First thing to do>
2. <Next step>
3. <What the answer should contain and look like>

<Rules: what to avoid, what to keep, when to ask instead of guessing.>`

function draftFrom(detail: LibraryItemDetail): Draft {
  return {
    name: detail.name,
    description: detail.description,
    body: detail.body,
    skills: detail.skills,
    context: detail.context,
    scope: detail.source === 'project' ? 'project' : 'user'
  }
}

function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.body === b.body &&
    a.skills.join('\n') === b.skills.join('\n') &&
    a.context.join('\n') === b.context.join('\n') &&
    a.scope === b.scope
  )
}

export function LibraryModal(props: Props) {
  const { skills, contextItems, presets } = props
  const [kind, setKind] = useState<LibraryKind>(props.target.kind)
  const [selectedId, setSelectedId] = useState<string | null>(props.target.id)
  const [detail, setDetail] = useState<LibraryItemDetail | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [baseline, setBaseline] = useState<Draft>(EMPTY)
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isNew = selectedId === null
  const readOnly = Boolean(detail && !detail.editable)
  const dirty = !readOnly && !sameDraft(draft, baseline)
  const singular = TABS.find((t) => t.kind === kind)!.singular

  const items: { id: string; name: string; description: string; source: SkillSource }[] = useMemo(() => {
    const list = kind === 'presets' ? presets : kind === 'skills' ? skills : contextItems
    const q = filter.trim().toLowerCase()
    return list.filter((i) => !q || i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q))
  }, [kind, presets, skills, contextItems, filter])

  const startNew = useCallback(
    (forKind: LibraryKind, prefill?: Partial<Draft>) => {
      const fresh: Draft = {
        ...EMPTY,
        ...(forKind === 'skills' ? { body: SKILL_TEMPLATE } : {}),
        ...(forKind === 'presets' ? { skills: props.current.skillIds, context: props.current.contextIds } : {}),
        ...prefill
      }
      setSelectedId(null)
      setDetail(null)
      setDraft(fresh)
      setBaseline(fresh)
      setError(null)
    },
    [props.current.skillIds, props.current.contextIds]
  )

  // opened on "New": start an empty item once
  useEffect(() => {
    if (props.target.id === null) startNew(props.target.kind)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // load the selected item
  useEffect(() => {
    if (selectedId === null) return
    let cancelled = false
    api.getLibraryItem(kind, selectedId).then(
      (d) => {
        if (cancelled) return
        setDetail(d)
        const next = draftFrom(d)
        setDraft(next)
        setBaseline(next)
        setError(null)
      },
      (err: Error) => !cancelled && setError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    )
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, selectedId])

  const confirmDiscard = (): boolean => !dirty || window.confirm('Discard your unsaved changes?')

  const switchKind = (k: LibraryKind): void => {
    if (k === kind || !confirmDiscard()) return
    setKind(k)
    setFilter('')
    startNew(k)
  }

  const select = (id: string | null): void => {
    if (id === selectedId || !confirmDiscard()) return
    if (id === null) startNew(kind)
    else {
      setDetail(null)
      setSelectedId(id)
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && (!dirty || window.confirm('Discard your unsaved changes?'))) props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, props])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const saved = await api.saveLibraryItem({
        kind,
        originalId: isNew ? null : selectedId,
        scope: draft.scope,
        name: draft.name,
        description: draft.description,
        body: draft.body,
        skills: draft.skills,
        context: draft.context
      })
      await props.onChanged()
      setDetail(saved)
      setSelectedId(saved.id)
      const next = draftFrom(saved)
      setDraft(next)
      setBaseline(next)
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!detail || !selectedId) return
    const what = kind === 'skills' ? `the skill "${detail.name}" and its folder` : `"${detail.name}"`
    if (!window.confirm(`Move ${what} to the trash?`)) return
    try {
      await api.deleteLibraryItem(kind, selectedId)
      await props.onChanged()
      startNew(kind)
    } catch (err) {
      props.onError((err as Error).message)
    }
  }

  const duplicate = (): void => {
    if (!detail) return
    startNew(kind, { ...draftFrom(detail), scope: 'user' })
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft((d) => ({ ...d, [key]: value }))
  const isMarkdownName = kind !== 'context' || !/\.[a-z0-9]+$/i.test(draft.name.trim()) || /\.md$/i.test(draft.name.trim())
  const useLabel = kind === 'presets' ? 'Apply preset' : kind === 'skills' ? 'Use this skill' : 'Tick for this prompt'

  return (
    <div className="modal-backdrop" onMouseDown={() => confirmDiscard() && props.onClose()}>
      <div className="modal library-modal" role="dialog" aria-label="Library" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Library</strong>
          <div className="segmented tabs">
            {TABS.map((t) => (
              <button key={t.kind} className={kind === t.kind ? 'on' : ''} onClick={() => switchKind(t.kind)}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <button onClick={() => confirmDiscard() && props.onClose()}>Close</button>
        </div>

        <div className="library-body">
          <aside className="library-list">
            <div className="library-list-head">
              <button className="primary" onClick={() => select(null)}>
                + New {singular}
              </button>
              {kind === 'context' && (
                <MenuButton
                  className=""
                  label="Import…"
                  items={[
                    { label: 'Import files to my library…', hint: 'available in every project', onSelect: () => props.onAddContextFiles('user') },
                    { label: 'Import files to this project…', hint: '.yaz/context, shared through git', onSelect: () => props.onAddContextFiles('project') }
                  ]}
                />
              )}
            </div>
            <input className="search" type="search" placeholder={`Filter ${TABS.find((t) => t.kind === kind)!.label.toLowerCase()}…`} value={filter} onChange={(e) => setFilter(e.target.value)} />
            <ul>
              {isNew && (
                <li className="selected new-item">
                  <span className="item-name">{draft.name.trim() || `New ${singular}`}</span>
                  <span className="source">new</span>
                </li>
              )}
              {items.map((item) => (
                <li key={item.id} className={item.id === selectedId ? 'selected' : ''} onClick={() => select(item.id)} title={item.description || item.name}>
                  <span className="item-name">{item.name}</span>
                  <span className={`source source-${item.source}`}>{SOURCE_LABEL[item.source]}</span>
                </li>
              ))}
              {items.length === 0 && !isNew && <li className="muted empty">Nothing here yet.</li>}
            </ul>
          </aside>

          <section className="library-editor">
            {readOnly && (
              <div className="banner">
                <span>
                  This is a built-in {singular}, so it's read-only. Duplicate it to make your own version
                  {kind !== 'context' && ' (a copy with the same name replaces the built-in one)'}.
                </span>
                <button onClick={duplicate}>Duplicate to edit</button>
              </div>
            )}

            <div className="editor-fields">
              <label className="field">
                <span className="label">{kind === 'context' ? 'File name' : 'Name'}</span>
                <input
                  value={draft.name}
                  disabled={readOnly}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder={kind === 'context' ? 'e.g. coding-guidelines.md' : kind === 'skills' ? 'e.g. api-design-review' : 'e.g. Checkout bugs'}
                  maxLength={120}
                  autoFocus={isNew}
                />
                {kind === 'context' && <span className="hint">Any text file type works: .md, .txt, .cs, .ts, .json… (.md if you leave it out)</span>}
              </label>

              <label className="field">
                <span className="label">Description</span>
                <input
                  value={draft.description}
                  disabled={readOnly || !isMarkdownName}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder={isMarkdownName ? 'When to use it (shown in lists)' : 'Only saved for .md files'}
                />
              </label>

              {isNew && (
                <fieldset className="field">
                  <span className="label">Save to</span>
                  <div className="radio-row">
                    <label className="check">
                      <input type="radio" checked={draft.scope === 'user'} onChange={() => set('scope', 'user')} />
                      My library <span className="muted small">(all projects)</span>
                    </label>
                    <label className="check">
                      <input type="radio" checked={draft.scope === 'project'} onChange={() => set('scope', 'project')} />
                      This project <span className="muted small">(share through git)</span>
                    </label>
                  </div>
                </fieldset>
              )}

              {kind === 'presets' && (
                <>
                  <div className="field">
                    <span className="label">Skills</span>
                    <SkillPicker skills={skills} selected={draft.skills} onChange={(list) => set('skills', list)} disabled={readOnly} compact />
                  </div>
                  <div className="field">
                    <div className="label-row">
                      <span className="label">Context files</span>
                      {!readOnly && (
                        <button className="link" onClick={() => setDraft((d) => ({ ...d, skills: props.current.skillIds, context: props.current.contextIds }))}>
                          Use current skills &amp; context
                        </button>
                      )}
                    </div>
                    {contextItems.length === 0 ? (
                      <p className="hint">No context files yet. Create some in the Context tab.</p>
                    ) : (
                      <ul className="context-list compact">
                        {contextItems.map((c) => (
                          <li key={c.id}>
                            <label className={draft.context.includes(c.id) ? 'on' : ''}>
                              <input
                                type="checkbox"
                                disabled={readOnly}
                                checked={draft.context.includes(c.id)}
                                onChange={() =>
                                  set('context', draft.context.includes(c.id) ? draft.context.filter((x) => x !== c.id) : [...draft.context, c.id])
                                }
                              />
                              <span className="context-name">{c.name}</span>
                              <span className={`source source-${c.source}`}>{SOURCE_LABEL[c.source]}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}

              <label className="field grow">
                <span className="label">{kind === 'presets' ? 'Task template (optional)' : kind === 'skills' ? 'Instructions' : 'Content'}</span>
                <textarea
                  className={kind === 'presets' ? '' : 'mono'}
                  value={draft.body}
                  disabled={readOnly}
                  spellCheck={kind !== 'context'}
                  onChange={(e) => set('body', e.target.value)}
                  placeholder={
                    kind === 'presets'
                      ? 'Filled into the task box when it is empty, e.g.\nBug:\nSteps to reproduce:\nExpected:\nActual:'
                      : kind === 'skills'
                        ? 'How should the AI approach the task?'
                        : 'Paste or write the reference text: guidelines, architecture notes, example code…'
                  }
                />
              </label>
            </div>

            {error && <p className="error-text editor-error">{error}</p>}

            <div className="modal-foot">
              {detail?.editable && !isNew && (
                <button className="danger-outline" onClick={() => void remove()}>
                  Delete
                </button>
              )}
              {detail && (
                <span className="muted small location" title={detail.location}>
                  {detail.location}
                </span>
              )}
              {!detail && (
                <button className="link" onClick={() => props.onOpenFolder(draft.scope, kind)}>
                  Open {draft.scope === 'project' ? 'project' : 'my'} {kind} folder
                </button>
              )}
              <div className="spacer" />
              {detail && !dirty && (
                <button
                  onClick={() => {
                    props.onUse(kind, detail.id)
                    props.onClose()
                  }}
                >
                  {useLabel}
                </button>
              )}
              {!readOnly && (
                <button className="primary" disabled={saving || !dirty || !draft.name.trim()} onClick={() => void save()}>
                  {saving ? 'Saving…' : isNew ? `Create ${singular}` : 'Save changes'}
                </button>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
