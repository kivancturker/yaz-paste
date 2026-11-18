import { useCallback, useState } from 'react'

interface PanelLimits {
  min: number
  max: number
  initial: number
}

function readStored(key: string, limits: PanelLimits): number {
  try {
    const v = Number(window.localStorage.getItem(key))
    return Number.isFinite(v) && v >= limits.min && v <= limits.max ? v : limits.initial
  } catch {
    return limits.initial
  }
}

/** A panel width that the user can drag, remembered across launches (per machine). */
export function usePanelWidth(key: string, limits: PanelLimits): [number, (w: number) => void, () => void] {
  const [width, setWidth] = useState(() => readStored(key, limits))
  const set = useCallback(
    (w: number) => {
      const clamped = Math.round(Math.max(limits.min, Math.min(limits.max, w)))
      setWidth(clamped)
      try {
        window.localStorage.setItem(key, String(clamped))
      } catch {
        // storage unavailable: the width just isn't remembered
      }
    },
    [key, limits.min, limits.max]
  )
  const reset = useCallback(() => set(limits.initial), [set, limits.initial])
  return [width, set, reset]
}

interface SplitterProps {
  /** Current width of the panel this splitter resizes. */
  width: number
  /** +1 when dragging right makes the panel wider (left panel), -1 for a right-hand panel. */
  direction: 1 | -1
  onResize(width: number): void
  onReset(): void
  label: string
}

/** A vertical drag handle between two panels. Double-click restores the default width. */
export function Splitter({ width, direction, onResize, onReset, label }: SplitterProps) {
  const [dragging, setDragging] = useState(false)

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = width
    setDragging(true)
    document.body.classList.add('resizing')
    const onMove = (ev: MouseEvent): void => onResize(startWidth + (ev.clientX - startX) * direction)
    const onUp = (): void => {
      setDragging(false)
      document.body.classList.remove('resizing')
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const step = e.shiftKey ? 40 : 10
    if (e.key === 'ArrowLeft') onResize(width - step * direction)
    else if (e.key === 'ArrowRight') onResize(width + step * direction)
    else return
    e.preventDefault()
  }

  return (
    <div
      className={`splitter${dragging ? ' dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onMouseDown={onMouseDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
    />
  )
}
