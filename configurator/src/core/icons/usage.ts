import { size, type Layer, type PadKey, type Workspace } from '../config/model'
import { normalizeSizes, sizeName } from './recipe'

/** A layer that has an icon set as its picture. */
export interface LayerUse {
  title: string
  /** The key the layer sits on; null for a parked layer. */
  key: string | null
  /** The key's size, `<w>x<h>`; null for a parked layer. */
  size: string | null
}

/** A macro whose own icon is the set. */
export interface MacroUse {
  layer: string
  macro: string
  key: string
  size: string
}

/** Where an icon set is used in the layout. */
export interface SetUsage {
  layers: LayerUse[]
  macros: MacroUse[]
  /** The key sizes the set's pictures are shown at, in order. */
  sizes: string[]
}

function sizeOf(key: PadKey | undefined): string {
  const s = key ? size(key) : { w: 1, h: 1 }
  return sizeName(s.w, s.h)
}

function macroUses(ws: Workspace, layer: Layer, set: string): MacroUse[] {
  return Object.entries(layer.macros)
    .filter(([, m]) => m.icon === set)
    .map(([keyId, m]) => ({
      layer: layer.title,
      macro: m.name,
      key: keyId,
      size: sizeOf(ws.keys.find((k) => k.id === keyId)),
    }))
}

/** Which layers and macros of the layout use the icon set, and at which key sizes. */
export function setUsage(ws: Workspace, set: string): SetUsage {
  const layers: LayerUse[] = []
  const macros: MacroUse[] = []
  const place = (layer: Layer, key: string | null) => {
    if (layer.icon === set) {
      layers.push({ title: layer.title, key, size: key === null ? null : sizeOf(ws.keys.find((k) => k.id === key)) })
    }
    macros.push(...macroUses(ws, layer, set))
  }
  for (const [key, layer] of Object.entries(ws.slots)) place(layer, key)
  for (const layer of ws.parked) place(layer, null)
  const sizes = normalizeSizes([...layers.map((l) => l.size), ...macros.map((m) => m.size)].filter((s) => s !== null))
  return { layers, macros, sizes }
}

/** The sizes of the keys of the pad, whatever they show: for the empty key frames of keys with a macro but no layer. */
export function padSizes(ws: Workspace): string[] {
  return normalizeSizes([...ws.keys, ws.fn].map((k) => sizeOf(k)))
}
