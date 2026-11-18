import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { DictEntry } from '../core/commands/dictionary'
import { DocCard } from './code/DocCard'

/** The gap between the card and the panel, and between the card and the window's edge, in pixels. */
const GAP = 8

interface Shown {
  entry: DictEntry
  /** The row's top edge, in window coordinates. */
  top: number
  /** The panel's left edge, in window coordinates. */
  panelLeft: number
}

/** What a row of a list needs to show the card: the handlers, and `aria-describedby` while its card is up. */
export interface RowHover {
  onMouseEnter?: (e: MouseEvent<HTMLElement>) => void
  onMouseLeave?: () => void
  onFocus?: (e: FocusEvent<HTMLElement>) => void
  onBlur?: () => void
  onClick: () => void
  'aria-describedby'?: string
}

export type RowHoverFor = (entry: DictEntry | undefined, onClick: () => void) => RowHover

const sameEntry = (a: DictEntry, b: DictEntry) => a.source.path === b.source.path && a.fn.name === b.fn.name

/**
 * A floating card of docs for the row under the pointer or holding the focus, one at a time. `row`
 * gives a row its handlers (its own click runs after the card is hidden: the click reveals the same
 * docs another way); `card` is the card to render once, anywhere, as it is portalled into the page.
 */
export function useDocHover(): { row: RowHoverFor; card: ReactNode } {
  const [shown, setShown] = useState<Shown | null>(null)
  const id = useId()
  const hide = useCallback(() => setShown(null), [])
  const show = (entry: DictEntry, from: HTMLElement) =>
    setShown({
      entry,
      top: from.getBoundingClientRect().top,
      panelLeft: (from.closest('aside') ?? from).getBoundingClientRect().left,
    })

  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [shown, hide])

  const box = useRef<HTMLDivElement>(null)
  // Level with the row, moved up only as far as it takes to keep the whole card in the window.
  useLayoutEffect(() => {
    if (!shown || !box.current) return
    const room = document.documentElement.clientHeight - box.current.offsetHeight - GAP
    box.current.style.top = `${Math.max(GAP, Math.min(shown.top, room))}px`
  }, [shown])

  const row: RowHoverFor = (entry, onClick) => {
    if (!entry) return { onClick }
    return {
      onMouseEnter: (e) => show(entry, e.currentTarget),
      onMouseLeave: hide,
      onFocus: (e) => show(entry, e.currentTarget),
      onBlur: hide,
      onClick: () => {
        hide()
        onClick()
      },
      'aria-describedby': shown && sameEntry(shown.entry, entry) ? id : undefined,
    }
  }

  const card = shown
    ? createPortal(
        <div
          ref={box}
          id={id}
          role="tooltip"
          style={{ top: shown.top, right: document.documentElement.clientWidth - shown.panelLeft + GAP }}
          className="pointer-events-none fixed z-50 max-h-screen overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 shadow-xl"
        >
          <DocCard entry={shown.entry} />
        </div>,
        document.body,
      )
    : null
  return { row, card }
}
