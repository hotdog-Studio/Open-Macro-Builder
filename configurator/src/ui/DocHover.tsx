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
export const GAP = 8
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
  onMouseLeave?: (e: MouseEvent<HTMLElement>) => void
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

/**
 * Hides every card on Escape while one is up, listening from the commit that shows the card (a layout
 * effect): the pointer brings it up in a render whose passive effects React runs in a later task, and a key
 * pressed in between reaches the document at once.
 */
function useEscape(up: boolean, hide: () => void): void {
  useLayoutEffect(() => {
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

/** Where the pointer was last seen, in the window's coordinates; null once it has left the window. */
type Seen = { x: number; y: number } | null

/**
 * Where a leave left the pointer: nowhere when it went to no element (out of the window), whatever point
 * the event gives. The browser's leave then has no relatedTarget; React's has the window.
 */
const pointLeftAt = (e: { clientX: number; clientY: number; relatedTarget: EventTarget | null }): Seen =>
  e.relatedTarget instanceof Node ? { x: e.clientX, y: e.clientY } : null

/** What the rows' handlers do to the hover state. */
interface HoverActions {
  set: (change: Partial<Hover>) => void
  /** The pointer entered row `el` at `at`: its card is asked for, and known as the pointer's row from now on. */
  enterRow: (id: string, el: HTMLElement, at: Seen) => void
  /** Records where the pointer is, as the event that tells it (a move, a leave, an enter of the card), and looks. */
  lookAt: (at: Seen) => void
  /**
   * Looks where the pointer is: on the pointer's row or on the card, its card stays; on neither, the
   * card goes once the grace has passed, unless by then the pointer is on one of them again.
   */
  check: () => void
  /** Stops a hide that waits for the grace to pass. */
  stay: () => void
  hideAll: () => void
}

/** The handlers of one row; `describedBy` is the card's id while the card is up for this row. */
function rowHandlers(entry: DictEntry, onClick: () => void, actions: HoverActions, describedBy: string | undefined): RowHover {
  return {
    onMouseEnter: (e) => actions.enterRow(entry.id, e.currentTarget, { x: e.clientX, y: e.clientY }),
    onMouseLeave: (e) => actions.lookAt(pointLeftAt(e)),
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

/**
 * Calls `update` on the next frame after any scroll in the page (the panel's included) or a resize of the
 * window, from the commit that shows the card (a layout effect): React yields for the paint before that
 * render's passive effects, and the paint is where the browser scrolls and resizes.
 */
function useFollow(update: () => void): void {
  useLayoutEffect(() => {
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
 * both pass the pointer's point to `onPointer`. Not React's onMouseLeave: React builds it from a
 * mouseout that reaches the page's root, and when a re-render has just taken away the line under the
 * pointer, the browser sends that mouseout to the line, off the page, and React never sees the pointer leave.
 */
function usePointerOn(box: RefObject<HTMLDivElement | null>, onPointer: (at: Seen) => void): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const enter = (e: globalThis.MouseEvent) => {
      setOn(true)
      onPointer({ x: e.clientX, y: e.clientY })
    }
    const leave = (e: globalThis.MouseEvent) => {
      setOn(false)
      onPointer(pointLeftAt(e))
    }
    el.addEventListener('mouseenter', enter)
    el.addEventListener('mouseleave', leave)
    return () => {
      el.removeEventListener('mouseenter', enter)
      el.removeEventListener('mouseleave', leave)
    }
  }, [box, onPointer])
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
  onPointer,
  onMoved,
}: Readonly<{ id: string; entry: DictEntry; row: HTMLElement; onPointer: (at: Seen) => void; onMoved: () => void }>) {
  const box = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const { tall, more, measure } = useScrollState(scroller)
  // A card the pointer is on keeps it until the pointer leaves, even when its docs change and fit.
  const pointerOn = usePointerOn(box, onPointer)
  const update = useCallback(() => {
    // A row that has just left the page (filtered out, its group closed) waits for useDropGoneRows to drop its card.
    if (!row.isConnected) return
    if (box.current) place(box.current, row)
    measure()
    // Placed and sized again, the card may no longer lie under a pointer that has not moved.
    onMoved()
  }, [row, measure, onMoved])
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
 * Whether what lies at `seen` is `row` or the card with the id `cardId`, as the page's own hit test
 * tells it: not `:hover`, which a held mouse button freezes, and not enter and leave events, which can
 * come in either order or not at all. A card that lets the pointer through is not hit.
 */
function onRowOrCard(seen: Seen, row: HTMLElement | undefined, cardId: string): boolean {
  const at = seen && document.elementFromPoint(seen.x, seen.y)
  return Boolean(at && (row?.contains(at) || document.getElementById(cardId)?.contains(at)))
}

/**
 * What the rows' handlers do to the hover state, the same functions on every render. Whether the
 * pointer's card goes rests on one thing, where the pointer is: each look (`check`) that finds it on
 * neither its row nor the card starts the grace, and when the grace ends the card goes only if the
 * pointer is still on neither. Enter and leave events only ask for a look, so their order never decides.
 */
function useHoverActions(setHover: Dispatch<SetStateAction<Hover>>, cardId: string, pointerRowRef: RefObject<HTMLElement | null>): HoverActions {
  const grace = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const seen = useRef<Seen>(null)
  const actions = useMemo<HoverActions>(() => {
    const stay = () => {
      clearTimeout(grace.current)
      grace.current = undefined
    }
    const hideUnlessBack = () => {
      grace.current = undefined
      setHover((was) => (was.pointer && !onRowOrCard(seen.current, was.pointer.el, cardId) ? { ...was, pointer: null } : was))
    }
    const check = () => {
      const row = pointerRowRef.current
      if (!row) return
      if (onRowOrCard(seen.current, row, cardId)) stay()
      // The grace counts from the first look that found the pointer on neither.
      else grace.current ??= setTimeout(hideUnlessBack, GRACE)
    }
    return {
      set: (change) => setHover((was) => ({ ...was, ...change })),
      // The point and the row are known from the event itself, before React has shown the card: a look
      // made before then (a leave a moment later) reads them, not an older point or no row at all.
      enterRow: (id, el, at) => {
        seen.current = at
        pointerRowRef.current = el
        stay()
        setHover((was) => ({ ...was, pointer: { id, el } }))
      },
      lookAt: (at) => {
        seen.current = at
        check()
      },
      check,
      stay,
      hideAll: () => {
        stay()
        pointerRowRef.current = null
        setHover(NONE)
      },
    }
  }, [setHover, cardId, pointerRowRef])
  // No hide may land once the lists are gone.
  useEffect(() => actions.stay, [actions])
  return actions
}

/**
 * While a card is up for the row under the pointer, follows the pointer over the whole page and looks
 * where it is (HoverActions.check) whenever that may have changed without an enter or leave of the row
 * or the card: a move, the button let go, the pointer leaving the window, a scroll, a resize. The
 * listeners go when that card goes, and when the lists do.
 */
function useFollowPointer(up: boolean, actions: HoverActions): void {
  useEffect(() => {
    if (!up) return
    const move = (e: PointerEvent) => actions.lookAt({ x: e.clientX, y: e.clientY })
    // A mouseout to nothing: the pointer has left the window.
    const out = (e: globalThis.MouseEvent) => {
      if (e.relatedTarget === null) actions.lookAt(null)
    }
    const look = () => actions.check()
    const passive = { capture: true, passive: true }
    document.addEventListener('pointermove', move, passive)
    document.addEventListener('pointerup', move, passive)
    document.addEventListener('mouseout', out, passive)
    document.addEventListener('scroll', look, passive)
    window.addEventListener('resize', look)
    // Whatever happened before the listeners were there, one look now from what is known.
    actions.check()
    return () => {
      document.removeEventListener('pointermove', move, { capture: true })
      document.removeEventListener('pointerup', move, { capture: true })
      document.removeEventListener('mouseout', out, { capture: true })
      document.removeEventListener('scroll', look, { capture: true })
      window.removeEventListener('resize', look)
    }
  }, [up, actions])
}

/**
 * One floating card of docs for the lists inside it: for the row under the pointer, else for the row
 * holding the focus. The card shows the entry with the row's id in `dicts` as they are now, so it
 * follows typing, and goes when the entry or the row does.
 */
export function DocHoverProvider({ dicts, children }: Readonly<{ dicts: Dictionary[]; children: ReactNode }>) {
  const [hover, setHover] = useState<Hover>(NONE)
  const id = useId()
  // The row of the pointer's card for a look between renders: set by a row's enter at once, and by every
  // render (a card dropped or hidden). The hide itself reads the state.
  const pointerRow = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    pointerRow.current = hover.pointer?.el ?? null
  })
  const actions = useHoverActions(setHover, id, pointerRow)
  const shown = hover.pointer ?? hover.focus
  // Undefined once the entry is gone from the dictionaries (renamed, deleted, another file shown): no card then.
  const entry = shown ? findEntry(dicts, shown.id) : undefined
  const shownId = entry?.id
  useEscape(shown !== null, actions.hideAll)
  useDropGoneRows(shown !== null, setHover)
  useFollowPointer(hover.pointer !== null, actions)

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
      {shown && entry && <FloatingCard id={id} entry={entry} row={shown.el} onPointer={actions.lookAt} onMoved={actions.check} />}
    </HoverContext.Provider>
  )
}
