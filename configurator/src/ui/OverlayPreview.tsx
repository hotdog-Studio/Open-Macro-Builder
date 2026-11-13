import { useState } from 'react'
import type { Workspace } from '../core/config/model'
import { overlayCells, overlaySize } from '../core/overlay'
import type { OverlayCell } from '../core/overlay'
import { useEditor } from '../state/store'
import { useAsset } from './useAsset'

const NO_LAYER = 'No layer is on a key yet.'

/** The key a layer sits on, or undefined when the layer is parked or unknown. */
function keyOfLayer(ws: Workspace, layerId: string | null): string | undefined {
  if (layerId === null) return undefined
  return ws.keys.find((k) => ws.slots[k.id]?.id === layerId)?.id
}

/**
 * The key whose layer the overlay shows: the selected key of the Layers tab when it has a layer,
 * else the layer chosen for the Macros tab, else the start layer, else the first layer on a key.
 * On the other tabs the selected key is a macro key or a pad key, so it does not count.
 */
export function previewKey(
  ws: Workspace,
  tab: string,
  selectedKey: string | null,
  selectedLayer: string | null,
): string | undefined {
  if (tab === 'layers' && selectedKey !== null && ws.slots[selectedKey]) return selectedKey
  const chosen = keyOfLayer(ws, selectedLayer)
  if (chosen !== undefined) return chosen
  const start = ws.options.defaultKey
  if (start !== null && ws.slots[start]) return start
  return ws.keys.find((k) => ws.slots[k.id])?.id
}

function CellImage({ cell }: Readonly<{ cell: OverlayCell }>) {
  const src = useAsset(cell.image)
  return (
    <img
      alt=""
      data-path={cell.image ?? undefined}
      src={src ?? undefined}
      draggable={false}
      style={{ position: 'absolute', left: cell.key.x, top: cell.key.y, width: cell.key.w, height: cell.key.h }}
    />
  )
}

function CellLabel({ cell }: Readonly<{ cell: OverlayCell }>) {
  const label = cell.label
  if (!label) return null
  return (
    <div
      style={{
        position: 'absolute',
        left: label.rect.x,
        top: label.rect.y,
        width: label.rect.w,
        height: label.rect.h,
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textAlign: 'center',
        fontFamily: 'Consolas, "Courier New", monospace',
        fontWeight: 'bold',
        fontStyle: 'italic',
        fontSize: 12,
        lineHeight: `${label.rect.h}px`,
        color: label.filled ? '#FEFEFE' : 'transparent',
        backgroundColor: label.filled ? '#101010' : 'transparent',
      }}
    >
      {label.text}
    </div>
  )
}

/** The overlay the pad shows while Fn is held, at real size, for one layer. */
export function OverlayPreview() {
  const { state } = useEditor()
  const { ws, tab, selectedKey, selectedLayer } = state
  const [shown, setShown] = useState(true)
  const key = previewKey(ws, tab, selectedKey, selectedLayer)

  let body = null
  if (shown && key === undefined) {
    body = <p className="text-[11px] text-zinc-300">{NO_LAYER}</p>
  } else if (shown) {
    const { w, h } = overlaySize(ws)
    const cells = overlayCells(ws, key as string)
    body = (
      <div className="overflow-auto">
        <div style={{ position: 'relative', width: w, height: h }}>
          {cells.map((c) => (
            <CellImage key={c.keyId} cell={c} />
          ))}
          {cells.map((c) => (
            <CellLabel key={c.keyId} cell={c} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <section
      aria-label="Overlay preview"
      className="mt-4 rounded-md border border-zinc-700 bg-gradient-to-br from-indigo-950 via-slate-900 to-purple-950 p-3"
    >
      <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        <span>Overlay preview · real size</span>
        <button type="button" className="normal-case tracking-normal text-sky-400 hover:underline" onClick={() => setShown(!shown)}>
          {shown ? 'hide' : 'show'}
        </button>
      </div>
      {body}
    </section>
  )
}
