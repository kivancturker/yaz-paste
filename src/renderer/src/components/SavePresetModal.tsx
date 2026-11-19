import { useEffect, useState } from 'react'
import type { LibraryScope, Preset, PresetInput } from '../../../shared/types'

interface Props {
  skillIds: string[]
  contextIds: string[]
  task: string
  /** The preset currently applied, used to prefill the form when updating it. */
  current: Preset | null
  onCancel(): void
  onSave(input: PresetInput): void
}

export function SavePresetModal({ skillIds, contextIds, task, current, onCancel, onSave }: Props) {
  const editable = current && current.source !== 'built-in' ? current : null
  const [name, setName] = useState(editable?.name ?? '')
  const [description, setDescription] = useState(editable?.description ?? '')
  const [scope, setScope] = useState<LibraryScope>(editable?.source === 'project' ? 'project' : 'user')
  const [includeTask, setIncludeTask] = useState(Boolean(editable?.task))

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  const submit = (): void => {
    if (!name.trim()) return
    onSave({ name: name.trim(), description, skills: skillIds, context: contextIds, task: includeTask ? task : '', scope })
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal small-modal"
        role="dialog"
        aria-label="Save preset"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <div className="modal-head">
          <strong>Save as preset</strong>
        </div>
        <div className="form">
          <p className="muted small">
            A preset saves the current skills and context files so you can apply them again in one click.
          </p>
          <div className="summary">
            <div>
              <span className="label">Skills</span> {skillIds.length ? skillIds.join(' → ') : <span className="muted">none</span>}
            </div>
            <div>
              <span className="label">Context</span>{' '}
              {contextIds.length ? contextIds.join(', ') : <span className="muted">none</span>}
            </div>
          </div>
          <label className="field">
            <span className="label">Name</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Checkout bugs" maxLength={120} />
          </label>
          {current?.source === 'built-in' && name.trim() === current.name && (
            <p className="hint">This name matches a built-in preset; yours will take its place.</p>
          )}
          <label className="field">
            <span className="label">Description</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="When to use it" />
          </label>
          <fieldset className="field">
            <span className="label">Save to</span>
            <label className="check">
              <input type="radio" checked={scope === 'user'} onChange={() => setScope('user')} />
              My presets <span className="muted small">(~/.yaz/presets, all projects)</span>
            </label>
            <label className="check">
              <input type="radio" checked={scope === 'project'} onChange={() => setScope('project')} />
              This project <span className="muted small">(.yaz/presets, share it through git)</span>
            </label>
          </fieldset>
          <label className="check">
            <input type="checkbox" checked={includeTask} onChange={(e) => setIncludeTask(e.target.checked)} disabled={!task.trim()} />
            Save the current task as a template
          </label>
        </div>
        <div className="modal-foot">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!name.trim()}>
            Save preset
          </button>
        </div>
      </form>
    </div>
  )
}
