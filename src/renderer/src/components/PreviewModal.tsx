import { useEffect } from 'react'

interface Props {
  text: string
  tokens: number
  onClose(): void
  onCopy(): void
}

export function PreviewModal({ text, tokens, onClose, onCopy }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Prompt preview" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Prompt preview</strong>
          <span className="muted">
            {tokens.toLocaleString()} tokens · {text.length.toLocaleString()} characters
          </span>
          <div className="spacer" />
          <button className="primary" onClick={onCopy}>
            Copy
          </button>
          <button onClick={onClose}>Close</button>
        </div>
        <pre className="modal-body">{text}</pre>
      </div>
    </div>
  )
}
