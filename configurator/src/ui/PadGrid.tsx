import {
  DndContext,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core'
import { createContext, useContext, type KeyboardEvent, type ReactNode } from 'react'
import { size, type KeyId, type PadKey, type Workspace } from '../core/config/model'
import { findLayer, resizeKey, type OpResult } from '../core/config/ops'
import { keyRect } from '../core/overlay'
import { useEditor, type Tab } from '../state/store'
import { applyDrop, commandDescription, dropAction, resizeFromDelta } from './dnd'

/** The grid is drawn this many times larger than the overlay, so it is easy to grab. */
const SCALE = 1.25
const UNIT = 64
const LABEL_H = 17
const px = (n: number) => n * SCALE

const rowPitch = (labels: boolean) => (labels ? 83 : UNIT)
/** Where a free cell sits: the key area of row `row`, column `col`. */
const cellRect = (row: number, col: number, labels: boolean) => ({
  x: UNIT * (col - 1),
  y: rowPitch(labels) * (row - 1) + (labels ? LABEL_H : 0),
  w: UNIT,
  h: UNIT,
})

/**
 * On the Pad shape tab a dragged key lands on the cell nearest its top-left corner, however big it is.
 * Everywhere else the drop target is the thing under the pointer.
 */
const collide: CollisionDetection = (args) => {
  if (!String(args.active.id).startsWith('key:')) {
    const hits = pointerWithin(args)
    return hits.length > 0 ? hits : rectIntersection(args)
  }
  const at = args.collisionRect
  let best: Collision | null = null
  let nearest = UNIT * SCALE
  for (const c of args.droppableContainers) {
    const rect = args.droppableRects.get(c.id)
    if (!rect || !String(c.id).startsWith('cell:')) continue
    const d = Math.hypot(rect.left - at.left, rect.top - at.top)
    if (d < nearest) {
      nearest = d
      best = { id: c.id }
    }
  }
  return best ? [best] : []
}

const InsideDnd = createContext(false)

function editableLayer(ws: Workspace, layerId: string | null): string | null {
  return layerId !== null && findLayer(ws, layerId) ? layerId : null
}

/**
 * Drag and drop for a tab. PadGrid wraps itself in one; wrap the whole tab in a PadDnd instead when
 * something outside the grid is dragged too (the command list, the parked-layer shelf), so both
 * sit in the same context.
 */
export function PadDnd({ mode, children }: Readonly<{ mode: Tab; children: ReactNode }>) {
  const { state, dispatch } = useEditor()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const labels = state.ws.options.showLabels ?? false

  const commit = (result: OpResult): boolean => {
    if (result.ok) dispatch({ type: 'edit', ws: result.ws })
    else dispatch({ type: 'banner', banner: { text: result.reason, kind: 'error' } })
    return result.ok
  }

  const onDragEnd = (e: DragEndEvent) => {
    const { ws } = state
    const active = String(e.active.id)
    if (active.startsWith('resize:')) {
      const id = active.slice('resize:'.length)
      const key = id === 'fn' ? ws.fn : ws.keys.find((k) => k.id === id)
      if (!key) return
      const next = resizeFromDelta(key, e.delta.x, e.delta.y, SCALE, rowPitch(labels))
      const now = size(key)
      if (next.width !== now.w || next.height !== now.h) commit(resizeKey(ws, id, next.width, next.height))
      return
    }
    if (!e.over) return
    const action = dropAction(mode, active, String(e.over.id))
    if (!action) return
    const describe = (command: string) => commandDescription(state.catalog, command)
    const done = commit(applyDrop(ws, action, editableLayer(ws, state.selectedLayer), describe))
    if (done && action.type === 'moveKey') dispatch({ type: 'select', key: action.id })
  }

  return (
    <InsideDnd.Provider value>
      <DndContext
        sensors={sensors}
        collisionDetection={collide}
        onDragEnd={onDragEnd}
        accessibility={{
          screenReaderInstructions: { draggable: 'Drag with the mouse. Select a key to see its details.' },
        }}
      >
        {children}
      </DndContext>
    </InsideDnd.Provider>
  )
}

function Cell({ row, col, labels, drop }: Readonly<{ row: number; col: number; labels: boolean; drop: boolean }>) {
  const { setNodeRef, isOver } = useDroppable({ id: `cell:${row}:${col}`, disabled: !drop })
  const r = cellRect(row, col, labels)
  return (
    <div
      ref={setNodeRef}
      aria-hidden="true"
      className={`absolute rounded-md border border-dotted ${
        isOver ? 'border-sky-400 bg-sky-400/10' : 'border-zinc-700'
      }`}
      style={{ left: px(r.x + 2), top: px(r.y + 2), width: px(r.w - 4), height: px(r.h - 4) }}
    />
  )
}

function ResizeHandle({ k }: Readonly<{ k: PadKey }>) {
  const { setNodeRef, attributes, listeners, transform } = useDraggable({ id: `resize:${k.id}` })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={`Resize ${k.key}`}
      className="absolute -bottom-1 -right-1 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-sky-300 bg-sky-500"
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 } : undefined}
    />
  )
}

interface KeyBoxProps {
  k: PadKey
  mode: Tab
  labels: boolean
  selected: boolean
  /** The drag id, or null when this key cannot be dragged here. */
  dragId: string | null
  /** Whether other things can be dropped on this key. */
  droppable: boolean
  /** What to draw in the label strip above the key; null or left out draws no strip. */
  strip?: ReactNode
  onSelect: () => void
  children: ReactNode
}

function KeyBox({ k, mode, labels, selected, dragId, droppable, strip, onSelect, children }: Readonly<KeyBoxProps>) {
  const { key: r, label } = keyRect(k, labels)
  const drag = useDraggable({ id: dragId ?? `still:${k.id}`, disabled: dragId === null })
  const drop = useDroppable({ id: `key:${k.id}`, disabled: !droppable })
  const setRefs = (node: HTMLElement | null) => {
    drag.setNodeRef(node)
    drop.setNodeRef(node)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }
  const { x, y } = drag.transform ?? { x: 0, y: 0 }
  const tone = selected ? 'border-sky-400 ring-2 ring-sky-400/40' : 'border-transparent'
  return (
    <li
      className="absolute"
      style={{ left: px(r.x + 2), top: px(r.y + 2), width: px(r.w - 4), height: px(r.h - 4) }}
    >
      <div
        ref={setRefs}
        {...(dragId === null ? { role: 'button', tabIndex: 0 } : drag.attributes)}
        {...drag.listeners}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className={`flex h-full w-full touch-none select-none items-center justify-center rounded-lg border ${tone} ${
          dragId === null ? 'cursor-pointer' : 'cursor-grab'
        } ${drop.isOver ? 'ring-2 ring-sky-400' : ''}`}
        style={{
          transform: drag.transform ? `translate3d(${x}px, ${y}px, 0)` : undefined,
          zIndex: drag.isDragging ? 10 : undefined,
        }}
      >
        {children}
      </div>
      {mode === 'shape' && <ResizeHandle k={k} />}
      {label && strip !== undefined && strip !== null && (
        <div
          className="pointer-events-none absolute overflow-hidden whitespace-nowrap bg-[#101010] text-center font-mono text-xs font-bold italic leading-[21px] text-white"
          style={{ left: px(label.x - (r.x + 2)), top: px(label.y - (r.y + 2)), width: px(label.w), height: px(label.h) }}
        >
          {strip}
        </div>
      )}
    </li>
  )
}

export interface PadGridProps {
  mode: Tab
  /** What to draw inside a key. The Fn key goes through here too. */
  renderKey: (k: PadKey) => ReactNode
  /** Draws one extra row and column of free cells, as drop targets for moving a key. */
  extraCell?: boolean
  /**
   * What to write in the label strip above a key (the layer's title, say). Giving it draws the grid
   * with label strips whatever the overlay option says, since the strips are the point of the tab.
   */
  renderStrip?: (k: PadKey) => ReactNode
}

function Grid({ mode, renderKey, extraCell = false, renderStrip }: Readonly<PadGridProps>) {
  const { state, dispatch } = useEditor()
  const { ws, selectedKey, selectedLayer } = state
  const labels = renderStrip !== undefined || (ws.options.showLabels ?? false)
  const all = [ws.fn, ...ws.keys]

  let rows = 1
  let cols = 1
  for (const k of all) {
    const s = size(k)
    rows = Math.max(rows, s.row + s.h - 1)
    cols = Math.max(cols, s.col + s.w - 1)
  }
  if (extraCell) {
    rows += 1
    cols += 1
  }

  const cells: ReactNode[] = []
  for (let row = 1; row <= rows; row++) {
    for (let col = 1; col <= cols; col++) {
      cells.push(<Cell key={`${row}:${col}`} row={row} col={col} labels={labels} drop={mode === 'shape'} />)
    }
  }

  const layer = selectedLayer === null ? undefined : findLayer(ws, selectedLayer)
  const dragIdOf = (id: KeyId): string | null => {
    if (mode === 'shape') return `key:${id}`
    if (id === 'fn') return null
    if (mode === 'layers') return ws.slots[id] ? `slot:${id}` : null
    return layer?.macros[id] ? `macro:${id}` : null
  }

  const bottom = cellRect(rows, 1, labels).y + UNIT
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-6">
      <div className="relative" style={{ width: px(cols * UNIT), height: px(bottom) }}>
        {cells}
        <ul aria-label="Keys">
          {all.map((k) => (
            <KeyBox
              key={k.id}
              k={k}
              mode={mode}
              labels={labels}
              selected={selectedKey === k.id}
              dragId={dragIdOf(k.id)}
              droppable={mode !== 'shape' && k.id !== 'fn'}
              strip={renderStrip?.(k)}
              onSelect={() => dispatch({ type: 'select', key: k.id })}
            >
              {renderKey(k)}
            </KeyBox>
          ))}
        </ul>
      </div>
    </div>
  )
}

/** The pad as a grid of keys. The Pad shape, Layers and Macros tabs all use it, with a different mode. */
export function PadGrid(props: Readonly<PadGridProps>) {
  const inside = useContext(InsideDnd)
  return inside ? (
    <Grid {...props} />
  ) : (
    <PadDnd mode={props.mode}>
      <Grid {...props} />
    </PadDnd>
  )
}
