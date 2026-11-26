import type { PadKey, Workspace } from './config/model'
import { size } from './config/model'
import { layerOnKey } from './config/ops'
import type { IconIndex, IconState } from './iconIndex'
import { STOCK_ICONS, emptyImage, iconImage } from './iconIndex'

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
export function emptyIconPath(k: PadKey, icons: IconIndex = STOCK_ICONS): string {
  const { w, h } = size(k)
  return emptyImage(icons, w, h)
}

function keyImage(ws: Workspace, selected: string, k: PadKey, icons: IconIndex): string {
  const { w, h } = size(k)
  const image = (set: string, state: IconState) => iconImage(icons, set, state, w, h)
  const markers = ws.options.showMacroMarkers ?? false
  const selectedLayer = layerOnKey(ws, selected)
  const macro = selectedLayer?.macros[k.id]
  const macroIcon = ws.options.useMacroIcons ? macro?.icon : undefined

  const marked = markers && macro !== undefined
  if (k.id === selected && selectedLayer) {
    // A macro's own icon is marked whenever markers are on; the layer's icon only on a key with a macro.
    if (macroIcon) return image(macroIcon, markers ? 'selected_macro' : 'selected')
    return image(selectedLayer.icon, marked ? 'selected_macro' : 'selected')
  }
  if (macroIcon) return image(macroIcon, markers ? 'macro' : 'layer')
  return unselectedImage(ws, k, marked, icons)
}

/** The picture on a key that is not the selected one and shows no macro icon. */
function unselectedImage(ws: Workspace, k: PadKey, marked: boolean, icons: IconIndex): string {
  const layer = layerOnKey(ws, k.id)
  if (!layer) return marked ? emptyIconPath(k, icons) : 'img/blank.png'
  const { w, h } = size(k)
  return iconImage(icons, layer.icon, marked ? 'macro' : 'layer', w, h)
}

function keyLabel(ws: Workspace, selected: string, k: PadKey): { text: string; filled: boolean } {
  if (ws.options.useMacroIcons) {
    const layer = layerOnKey(ws, k.id)
    return layer ? { text: layer.title, filled: true } : { text: '', filled: false }
  }
  const macro = layerOnKey(ws, selected)?.macros[k.id]
  return macro ? { text: macro.name, filled: true } : { text: '', filled: false }
}

/**
 * The cells of the overlay while the layer on `selected` is selected: macro keys in order, then Fn when shown.
 * `icons` says which pictures the folder has (sized pictures, sets of your own); without it, the stock ones.
 */
export function overlayCells(ws: Workspace, selected: string, icons: IconIndex = STOCK_ICONS): OverlayCell[] {
  const labels = ws.options.showLabels ?? false
  const cells: OverlayCell[] = ws.keys.map((k) => {
    const rect = keyRect(k, labels)
    return {
      keyId: k.id,
      key: rect.key,
      image: keyImage(ws, selected, k, icons),
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
      image: emptyIconPath(ws.fn, icons),
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
