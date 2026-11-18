import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react'
import { createPortal } from 'react-dom'
import type { DictEntry, Dictionary } from '../core/commands/dictionary'
import { DocCard } from './code/DocCard'

/** The gap between the card and the panel, and between the card and the window's edge, in pixels. */
const GAP = 8
/** How long the card stays after the pointer leaves its row, so the pointer can reach the card, in milliseconds. */
export const GRACE = 150
/** A card narrower than this beside the panel goes over the panel instead, in pixels. */
const MIN_WIDTH = 240

/** The row a card is up for: the id of its entry, and the row's element. */
interface Shown {
  id: string
  el: HTMLElement
}

/** The row under the pointer and the row holding the focus. The pointer's card wins; the focus's comes back after. */
interface Hover {
  pointer: Shown | null
  focus: Shown | null
}

const NONE: Hover = { pointer: null, focus: null }

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

const HoverContext = createContext<RowHoverFor | null>(null)

/**
 * The handlers of the rows of a list inside a DocHoverProvider. A row's own click runs after the
 * card is hidden: the click reveals the same docs another way.
 */
export function useDocHover(): RowHoverFor {
  const row = useContext(HoverContext)
  if (!row) throw new Error('useDocHover is used outside a DocHoverProvider')
  return row
}

/** The entry with this id in any of the dictionaries. */
const findEntry = (dicts: Dictionary[], id: string) => dicts.flatMap((d) => d.entries).find((e) => e.id === id)

/** `hover` without the rows whose element has left the page; `hover` itself when none has. */
function withoutGoneRows(hover: Hover): Hover {
  const pointer = hover.pointer?.el.isConnected ? hover.pointer : null
  const focus = hover.focus?.el.isConnected ? hover.focus : null
  return pointer === hover.pointer && focus === hover.focus ? hover : { pointer, focus }
}

/** Hides every card on Escape while one is up. */
function useEscape(up: boolean, hide: () => void): void {
  useEffect(() => {
    if (!up) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [up, hide])
}

/** Drops a row's card once the row leaves the page (filtered out, its command deleted), which fires no event of its own. */
function useDropGoneRows(up: boolean, setHover: Dispatch<SetStateAction<Hover>>): void {
  useEffect(() => {
    if (!up) return
    const observer = new MutationObserver(() => setHover(withoutGoneRows))
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [up, setHover])
}

/** What the rows' handlers do to the hover state. */
interface HoverActions {
  set: (change: Partial<Hover>) => void
  /** Hides the pointer's card once the grace has passed, unless the pointer reaches the card first. */
  leaveRow: () => void
  /** Stops a hide that waits for the grace to pass. */
  stay: () => void
  hideAll: () => void
}

/** The handlers of one row; `describedBy` is the card's id while the card is up for this row. */
function rowHandlers(entry: DictEntry, onClick: () => void, actions: HoverActions, describedBy: string | undefined): RowHover {
  return {
    onMouseEnter: (e) => {
      actions.stay()
      actions.set({ pointer: { id: entry.id, el: e.currentTarget } })
    },
    onMouseLeave: actions.leaveRow,
    onFocus: (e) => actions.set({ focus: { id: entry.id, el: e.currentTarget } }),
    onBlur: () => actions.set({ focus: null }),
    onClick: () => {
      actions.hideAll()
      onClick()
    },
    'aria-describedby': describedBy,
  }
}

/** Where the card goes: level with its row beside the panel, or under the row over the panel when the window is too narrow. */
function place(box: HTMLElement, row: HTMLElement): void {
  const rect = row.getBoundingClientRect()
  // Every list of the provider is in the right panel's <aside> (CommandsTab), its only user.
  const panelLeft = row.closest('aside')!.getBoundingClientRect().left
  const { clientWidth, clientHeight } = document.documentElement
  const beside = panelLeft - 2 * GAP >= MIN_WIDTH
  if (beside) {
    box.style.left = ''
    box.style.right = `${clientWidth - panelLeft + GAP}px`
    box.style.maxWidth = `${panelLeft - 2 * GAP}px`
  } else {
    box.style.right = ''
    box.style.left = `${Math.max(GAP, panelLeft)}px`
    box.style.maxWidth = `${clientWidth - Math.max(GAP, panelLeft) - GAP}px`
  }
  // Moved up only as far as it takes to keep the whole card in the window.
  const room = clientHeight - box.offsetHeight - GAP
  box.style.top = `${Math.max(GAP, Math.min(beside ? rect.top : rect.bottom, room))}px`
}

/** Calls `update` on the next frame after any scroll in the page (the panel's included) or a resize of the window. */
function useFollow(update: () => void): void {
  useEffect(() => {
    let frame = 0
    const soon = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    document.addEventListener('scroll', soon, { capture: true, passive: true })
    window.addEventListener('resize', soon)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('scroll', soon, { capture: true })
      window.removeEventListener('resize', soon)
    }
  }, [update])
}

/** What the card's scroll area holds: more than it shows (`tall`), and more below what it shows (`more`). */
function useScrollState(scroller: RefObject<HTMLDivElement | null>) {
  const [tall, setTall] = useState(false)
  const [more, setMore] = useState(false)
  const measure = useCallback(() => {
    const s = scroller.current
    if (!s) return
    setTall(s.scrollHeight > s.clientHeight + 1)
    setMore(s.scrollTop + s.clientHeight < s.scrollHeight - 1)
  }, [scroller])
  return { tall, more, measure }
}

/**
 * Whether the pointer is on the card, from the card's own native mouseenter and mouseleave, which
 * call `onEnter` and `onLeave`. Not React's onMouseLeave: React builds it from a mouseout that reaches
 * the page's root, and when a re-render has just taken away the line under the pointer, the browser
 * sends that mouseout to the line, off the page, and React never sees the pointer leave.
 */
function usePointerOn(box: RefObject<HTMLDivElement | null>, onEnter: () => void, onLeave: () => void): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const enter = () => {
      setOn(true)
      onEnter()
    }
    const leave = () => {
      setOn(false)
      onLeave()
    }
    el.addEventListener('mouseenter', enter)
    el.addEventListener('mouseleave', leave)
    return () => {
      el.removeEventListener('mouseenter', enter)
      el.removeEventListener('mouseleave', leave)
    }
  }, [box, onEnter, onLeave])
  return on
}

/**
 * The card beside the panel, portalled into the page. A card taller than the window takes the
 * pointer, so that it can be scrolled, and its last line says so while there is more below; a card
 * that fits lets the pointer through to what lies under it.
 */
function FloatingCard({
  id,
  entry,
  row,
  onEnter,
  onLeave,
}: Readonly<{ id: string; entry: DictEntry; row: HTMLElement; onEnter: () => void; onLeave: () => void }>) {
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const { tall, more, measure } = useScrollState(scroller)
  // A card the pointer is on keeps it until the pointer leaves, even when its docs change and fit.
  const pointerOn = usePointerOn(box, onEnter, onLeave)
  const update = useCallback(() => {
    // A row that has just left the page (filtered out, its group closed) waits for useDropGoneRows to drop its card.
    if (!row.isConnected) return
    if (box.current) place(box.current, row)
    measure()
  }, [row, measure])
  // After every render: the docs may have changed, and with them the card's height. The card's own
  // scroll reaches useFollow too, so the last line follows it.
  useLayoutEffect(update)
  useFollow(update)
  return createPortal(
    <div
      ref={box}
      id={id}
      role="tooltip"
      style={{ maxHeight: `calc(100vh - ${2 * GAP}px)`, pointerEvents: tall || pointerOn ? 'auto' : 'none' }}
      className="fixed z-50 flex flex-col rounded-md border border-zinc-700 bg-zinc-900 shadow-xl"
    >
      <div ref={scroller} className="min-h-0 overflow-y-auto">
        <DocCard entry={entry} />
      </div>
      {more && (
        <p className="shrink-0 border-t border-zinc-800 px-3 py-1 text-[11px] text-zinc-500">
          More below. Scroll the card, or click the row.
        </p>
      )}
    </div>,
    document.body,
  )
}

/**
 * What the rows' handlers do to the hover state, the same functions on every render. Leaving a row
 * or the card hides the pointer's card after the grace, which entering a row or the card cancels.
 */
function useHoverActions(setHover: Dispatch<SetStateAction<Hover>>): HoverActions {
  const grace = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const actions = useMemo<HoverActions>(
    () => ({
      set: (change) => setHover((was) => ({ ...was, ...change })),
      leaveRow: () => {
        clearTimeout(grace.current)
        grace.current = setTimeout(() => setHover((was) => ({ ...was, pointer: null })), GRACE)
      },
      stay: () => clearTimeout(grace.current),
      hideAll: () => setHover(NONE),
    }),
    [setHover],
  )
  // No hide may land once the lists are gone.
  useEffect(() => actions.stay, [actions])
  return actions
}

/**
 * One floating card of docs for the lists inside it: for the row under the pointer, else for the row
 * holding the focus. The card shows the entry with the row's id in `dicts` as they are now, so it
 * follows typing, and goes when the entry or the row does.
 */
export function DocHoverProvider({ dicts, children }: Readonly<{ dicts: Dictionary[]; children: ReactNode }>) {
  const [hover, setHover] = useState<Hover>(NONE)
  const id = useId()
  const actions = useHoverActions(setHover)
  const shown = hover.pointer ?? hover.focus
  // Undefined once the entry is gone from the dictionaries (renamed, deleted, another file shown): no card then.
  const entry = shown ? findEntry(dicts, shown.id) : undefined
  const shownId = entry?.id
  useEscape(shown !== null, actions.hideAll)
  useDropGoneRows(shown !== null, setHover)

  // The same function until another entry's card is up, so the lists re-render only then.
  const row = useCallback<RowHoverFor>(
    (rowEntry, onClick) => {
      if (!rowEntry) return { onClick }
      return rowHandlers(rowEntry, onClick, actions, rowEntry.id === shownId ? id : undefined)
    },
    [actions, shownId, id],
  )

  return (
    <HoverContext.Provider value={row}>
      {children}
      {shown && entry && <FloatingCard id={id} entry={entry} row={shown.el} onEnter={actions.stay} onLeave={actions.leaveRow} />}
    </HoverContext.Provider>
  )
}
