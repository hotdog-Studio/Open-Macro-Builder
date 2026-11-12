import type { Layer, Workspace } from '../config/model'

export interface KeyUse {
  layer: string
  /** The key's name, such as F13. */
  key: string
  parked: boolean
}

/**
 * The macros whose action is `name`, ignoring case. Layers on a key come first in key order,
 * then parked layers; within a layer, keys are in key order.
 */
export function keysUsing(ws: Workspace, name: string): KeyUse[] {
  const lower = name.toLowerCase()
  const uses: KeyUse[] = []
  const collect = (layer: Layer, parked: boolean) => {
    for (const k of ws.keys) {
      if (layer.macros[k.id]?.action.toLowerCase() === lower) uses.push({ layer: layer.title, key: k.key, parked })
    }
  }
  for (const k of ws.keys) {
    const layer = ws.slots[k.id]
    if (layer) collect(layer, false)
  }
  for (const layer of ws.parked) collect(layer, true)
  return uses
}
