import type { PadKey, Workspace } from './config/model'
import { size } from './config/model'
import { layerOnKey } from './config/ops'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface OverlayCell {
  keyId: string
  key: Rect
  image: string | null
  label: { rect: Rect; text: string; filled: boolean } | null
}

const UNIT = 64
const LABEL_H = 17
const ROW_PITCH = 83 // rows are 83 px apart when labelled (key.ahk)

/** Where a key and its label strip sit in the overlay, as the runtimes place them. */
export function keyRect(k: PadKey, labels: boolean): { label: Rect | null; key: Rect } {
  const { w, h, row, col } = size(k)
  const x = UNIT * (col - 1)
  if (!labels) return { label: null, key: { x, y: UNIT * (row - 1), w: UNIT * w, h: UNIT * h } }
  const y = ROW_PITCH * (row - 1)
  return {
    label: { x, y, w: UNIT * w, h: LABEL_H },
    key: { x, y: y + LABEL_H, w: UNIT * w, h: UNIT * h + LABEL_H * (h - 1) },
  }
}

/** The blank image the runtimes use for a key of this size. */
export function emptyIconPath(k: PadKey): string {
  const { w, h } = size(k)
  const stock = [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ]
  return stock.some(([sw, sh]) => sw === w && sh === h) ? `img/empty_${w}x${h}.png` : 'img/empty.png'
}

function keyImage(ws: Workspace, selected: string, k: PadKey): string {
  const markers = ws.options.showMacroMarkers ?? false
  const selectedLayer = layerOnKey(ws, selected)
  const macro = selectedLayer?.macros[k.id]
  const macroIcon = ws.options.useMacroIcons ? macro?.icon : undefined

  const marked = markers && macro !== undefined
  if (k.id === selected && selectedLayer) {
    // A macro's own icon is marked whenever markers are on; the layer's icon only on a key with a macro.
    if (macroIcon) return `img/${macroIcon}/${markers ? 'selected_macro' : 'selected'}.png`
    return `img/${selectedLayer.icon}/${marked ? 'selected_macro' : 'selected'}.png`
  }
  if (macroIcon) return `img/${macroIcon}/${markers ? 'macro' : 'layer'}.png`
  return unselectedImage(ws, k, marked)
}

/** The picture on a key that is not the selected one and shows no macro icon. */
function unselectedImage(ws: Workspace, k: PadKey, marked: boolean): string {
  const layer = layerOnKey(ws, k.id)
  if (!layer) return marked ? emptyIconPath(k) : 'img/blank.png'
  return `img/${layer.icon}/${marked ? 'macro' : 'layer'}.png`
}

function keyLabel(ws: Workspace, selected: string, k: PadKey): { text: string; filled: boolean } {
  if (ws.options.useMacroIcons) {
    const layer = layerOnKey(ws, k.id)
    return layer ? { text: layer.title, filled: true } : { text: '', filled: false }
  }
  const macro = layerOnKey(ws, selected)?.macros[k.id]
  return macro ? { text: macro.name, filled: true } : { text: '', filled: false }
}

/** The cells of the overlay while the layer on `selected` is selected: macro keys in order, then Fn when shown. */
export function overlayCells(ws: Workspace, selected: string): OverlayCell[] {
  const labels = ws.options.showLabels ?? false
  const cells: OverlayCell[] = ws.keys.map((k) => {
    const rect = keyRect(k, labels)
    return {
      keyId: k.id,
      key: rect.key,
      image: keyImage(ws, selected, k),
      label: rect.label && { rect: rect.label, ...keyLabel(ws, selected, k) },
    }
  })

  const showFn = ws.options.showFn
  if (showFn) {
    const rect = keyRect(ws.fn, labels)
    const text = typeof showFn === 'string' ? showFn : ws.fn.key
    cells.push({
      keyId: ws.fn.id,
      key: rect.key,
      image: emptyIconPath(ws.fn),
      label: rect.label && { rect: rect.label, text, filled: text !== ' ' },
    })
  }
  return cells
}

/** The overlay window: the largest right and bottom edge of all cells. */
export function overlaySize(ws: Workspace): { w: number; h: number } {
  let w = 0
  let h = 0
  for (const c of overlayCells(ws, ws.keys[0]?.id ?? 'k1')) {
    for (const r of [c.key, c.label?.rect]) {
      if (!r) continue
      w = Math.max(w, r.x + r.w)
      h = Math.max(h, r.y + r.h)
    }
  }
  return { w, h }
}
