import { DragOverlay, useDndContext, useDraggable, useDroppable } from '@dnd-kit/core'
import { useId, type KeyboardEvent } from 'react'
import type { Layer, PadKey } from '../core/config/model'
import { addLayer, layerOnKey, parkLayer, setDefaultLayer, updateLayer } from '../core/config/ops'
import { useEditor } from '../state/store'
import { PadDnd, PadGrid, usePadActions } from './PadGrid'
import { CentrePanel, LeftPanel, RightPanel, STYLE } from './Panels'
import { useAsset } from './useAsset'

/** A layer's picture: the layer.png of its icon set. */
export function LayerIcon({ icon, title, className }: Readonly<{ icon: string; title: string; className: string }>) {
  const src = useAsset(`img/${icon}/layer.png`)
  // Until it loads, or when the set has no layer.png, keep the room so nothing jumps.
  return src ? (
    <img src={src} alt={title} draggable={false} className={`pointer-events-none object-contain ${className}`} />
  ) : (
    <span role={title ? 'img' : undefined} aria-label={title || undefined} aria-hidden={title ? undefined : true} className={className} />
  )
}

function KeyFace({ k }: Readonly<{ k: PadKey }>) {
  const { state } = useEditor()
  const { ws } = state
  if (k.id === 'fn') {
    return (
      <span className="flex h-full w-full items-center justify-center rounded-[7px] border border-amber-600 bg-amber-950/60 text-[10px] text-amber-300">
        <b className="mr-1">Fn</b>
        {k.key}
      </span>
    )
  }
  const layer = layerOnKey(ws, k.id)
  if (!layer) {
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-[7px] border border-dashed border-zinc-600 text-[10px] text-zinc-600">
        <span aria-hidden="true" className="text-base leading-none">
          +
        </span>
        <span>{k.key}</span>
      </span>
    )
  }
  return (
    <span className="relative flex h-full w-full items-center justify-center rounded-[7px] border border-zinc-500 bg-zinc-800">
      <LayerIcon icon={layer.icon} title={layer.title} className="max-h-[85%] max-w-[85%]" />
      {ws.options.defaultKey === k.id && (
        <>
          {/* The space keeps the button's name readable: "Media Start layer". */}{' '}
          <span
            role="img"
            aria-label="Start layer"
            title="The pad starts on this layer"
            className="absolute right-1 top-0 text-[10px] text-amber-400"
          >
            ★
          </span>
        </>
      )}
    </span>
  )
}

function ParkedChip({ layer }: Readonly<{ layer: Layer }>) {
  return (
    <>
      <LayerIcon icon={layer.icon} title="" className="h-5 w-5 shrink-0" />
      <span className="truncate">{layer.title}</span>
    </>
  )
}

const CHIP = 'mb-1 flex items-center gap-2 rounded border border-zinc-700 bg-zinc-950 px-2 py-1'

function ParkedItem({ layer }: Readonly<{ layer: Layer }>) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `parked:${layer.id}` })
  const { state, dispatch } = useEditor()
  const pad = usePadActions()
  // Without the mouse: Enter or Space puts the layer on the selected key.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    const key = state.selectedKey
    if (key === null || key === 'fn') {
      const text = 'Select a key first, then press Enter on the parked layer to put it there.'
      dispatch({ type: 'banner', banner: { text, kind: 'info' } })
    } else {
      pad.run({ type: 'placeParked', layerId: layer.id, key })
    }
  }
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      className={`${CHIP} cursor-grab touch-none select-none ${isDragging ? 'opacity-40' : ''}`}
    >
      <ParkedChip layer={layer} />
    </div>
  )
}

/**
 * dnd-kit keeps the overlay box, invisible, on top of the page during every drag and for the quarter
 * second of its drop animation. It must not take the mouse, or a press where something was just
 * dropped lands on nothing.
 */
export const OVERLAY_STYLE = { pointerEvents: 'none' } as const

/** The layer being dragged follows the pointer even outside the side panel, which would clip it. */
function DraggedLayer() {
  const { state } = useEditor()
  const { active } = useDndContext()
  const id = String(active?.id ?? '')
  const layer = id.startsWith('parked:') ? state.ws.parked.find((l) => `parked:${l.id}` === id) : undefined
  return <DragOverlay style={OVERLAY_STYLE}>{layer ? <div className={`${CHIP} cursor-grabbing`}><ParkedChip layer={layer} /></div> : null}</DragOverlay>
}

function Shelf() {
  const { state, dispatch } = useEditor()
  const { ws } = state
  const { setNodeRef, isOver } = useDroppable({ id: 'shelf' })
  const heading = useId()
  return (
    <>
      <div className={STYLE.heading}>
        <span id={heading}>Parked</span>
        <span>{ws.parked.length}</span>
      </div>
      <div
        ref={setNodeRef}
        role="group"
        aria-labelledby={heading}
        className={`min-h-[5rem] rounded-lg border border-dashed p-1.5 ${isOver ? 'border-sky-400 bg-sky-400/10' : 'border-zinc-700'}`}
      >
        {ws.parked.map((l) => (
          <ParkedItem key={l.id} layer={l} />
        ))}
        <p className="px-1 pt-1 text-[11px] text-zinc-600">Saved as "disabled": true.</p>
        <p className="px-1 pb-1 text-[11px] text-zinc-600">Drop a layer here to keep it without a key. Enter on a parked layer puts it on the selected key.</p>
      </div>
      <button
        type="button"
        className={`${STYLE.button} mt-3 w-full`}
        onClick={() => dispatch({ type: 'edit', ws: addLayer(ws, 'New layer', 'default_commands').ws })}
      >
        + New layer
      </button>
    </>
  )
}

function IconChoice({ name, chosen, onChoose }: Readonly<{ name: string; chosen: boolean; onChoose: () => void }>) {
  return (
    <button
      type="button"
      title={name}
      aria-label={name}
      aria-pressed={chosen}
      className={`rounded border p-1 ${chosen ? 'border-sky-500 bg-sky-500/15' : 'border-zinc-800 hover:border-zinc-600'}`}
      onClick={onChoose}
    >
      <LayerIcon icon={name} title="" className="h-7 w-7" />
    </button>
  )
}

function LayerDetails({ keyId, keyName }: Readonly<{ keyId: string; keyName: string }>) {
  const { state, dispatch } = useEditor()
  const { ws, iconSets } = state
  const titleId = useId()
  const layer = layerOnKey(ws, keyId)
  const edit = (next: typeof ws) => dispatch({ type: 'edit', ws: next })
  return (
    <>
      <h3 className={STYLE.heading}>Fn + {keyName}</h3>
      {layer ? (
        <>
          <label htmlFor={titleId} className={`${STYLE.label} mt-0`}>
            Title
          </label>
          <input
            id={titleId}
            className={STYLE.input}
            value={layer.title}
            onChange={(e) => edit(updateLayer(ws, layer.id, { title: e.target.value }))}
          />
          <p className={STYLE.label}>Icon</p>
          <div className="grid grid-cols-5 gap-1">
            {iconSets.map((name) => (
              <IconChoice
                key={name}
                name={name}
                chosen={layer.icon === name}
                onChoose={() => edit(updateLayer(ws, layer.id, { icon: name }))}
              />
            ))}
          </div>
          <button
            type="button"
            className={`${STYLE.button} mt-3 w-full`}
            disabled={ws.options.defaultKey === keyId}
            onClick={() => edit(setDefaultLayer(ws, keyId))}
          >
            Start on this layer
          </button>
          <button
            type="button"
            className="mt-2 w-full rounded-md bg-sky-600 px-3 py-1 font-medium text-white hover:bg-sky-500"
            onClick={() => {
              dispatch({ type: 'select', layer: layer.id })
              dispatch({ type: 'tab', tab: 'macros' })
            }}
          >
            Edit macros →
          </button>
          <button type="button" className={`${STYLE.button} mt-2 w-full`} onClick={() => edit(parkLayer(ws, keyId))}>
            Park layer
          </button>
        </>
      ) : (
        <p className="text-zinc-500">No layer on this key.</p>
      )}
    </>
  )
}

/** The Layers tab: which layer each key selects, and the parked layers that have no key. */
export function LayersTab() {
  const { state } = useEditor()
  const { ws, selectedKey } = state
  const selected = selectedKey === null || selectedKey === 'fn' ? undefined : ws.keys.find((k) => k.id === selectedKey)
  return (
    <PadDnd mode="layers">
      <LeftPanel>
        <Shelf />
      </LeftPanel>
      <CentrePanel>
        <p className="text-zinc-400">What each key selects while Fn is held.</p>
        <PadGrid
          mode="layers"
          renderKey={(k) => <KeyFace k={k} />}
          renderStrip={(k) => (k.id === 'fn' ? null : (layerOnKey(ws, k.id)?.title ?? null))}
        />
        <p className="text-[11px] text-zinc-500">
          Drag a layer to another key to move or swap it, or focus it and press Alt+arrows · ★ marks the layer the pad
          starts on
        </p>
      </CentrePanel>
      <RightPanel>
        {selected ? <LayerDetails keyId={selected.id} keyName={selected.key} /> : <p className="text-zinc-500">Select a key.</p>}
      </RightPanel>
      <DraggedLayer />
    </PadDnd>
  )
}
