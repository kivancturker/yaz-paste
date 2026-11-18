import { useEffect, useRef, useState } from 'react'

export interface MenuItem {
  label: string
  hint?: string
  onSelect(): void
}

/** A small button that opens a list of actions. Closes on outside click or Escape. */
export function MenuButton({ label, items, className }: { label: string; items: (MenuItem | 'divider')[]; className?: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="menu-button" ref={ref}>
      <button className={className ?? 'link'} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {label}
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((item, i) =>
            item === 'divider' ? (
              <div key={`d${i}`} className="menu-divider" />
            ) : (
              <button
                key={item.label}
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <span>{item.label}</span>
                {item.hint && <span className="muted small">{item.hint}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}
