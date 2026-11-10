import type { KeyId, Macro, PadKey, Workspace } from '../core/config/model'
import { size } from '../core/config/model'
import {
  macroLabel,
  moveKey,
  parkLayer,
  placeParked,
  setMacro,
  swapLayers,
  swapMacros,
  type OpResult,
} from '../core/config/ops'
import type { CatalogEntry } from '../core/languages'
import type { Tab } from '../state/store'

// Drag ids:  'key:<id>' (Pad shape), 'slot:<keyId>' (a layer on its key), 'parked:<layerId>',
//            'macro:<keyId>' (a macro on its key), 'cmd:<group>/<pair>/<name>' (a row of the command list;
//            the bare 'cmd:<name>' is read too).
// Drop ids:  'cell:<row>:<col>', 'key:<id>', 'shelf'.

export type DropAction =
  | { type: 'moveKey'; id: KeyId; row: number; col: number }
  | { type: 'swapLayers' | 'swapMacros'; a: KeyId; b: KeyId }
  | { type: 'placeParked'; layerId: string; key: KeyId }
  | { type: 'parkLayer'; key: KeyId }
  | { type: 'setMacroFromCommand'; command: string; key: KeyId }

/** 'slot:k1' → ['slot', 'k1']. Only the first colon splits, so a cell's 'cell:2:5' keeps '2:5'. */
function parse(id: string): [string, string] {
  const i = id.indexOf(':')
  return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i + 1)]
}

/** What dropping `dragId` on `overId` means on a tab, or null when it means nothing. */
export function dropAction(tab: Tab, dragId: string, overId: string): DropAction | null {
  const [drag, from] = parse(dragId)
  const [over, to] = parse(overId)

  if (tab === 'shape') {
    if (drag !== 'key' || over !== 'cell') return null
    const cell = /^(\d+):(\d+)$/.exec(to)
    return cell ? { type: 'moveKey', id: from, row: Number(cell[1]), col: Number(cell[2]) } : null
  }

  if (tab === 'layers') {
    if (drag === 'slot' && over === 'key') return from === to ? null : { type: 'swapLayers', a: from, b: to }
    if (drag === 'parked' && over === 'key') return { type: 'placeParked', layerId: from, key: to }
    if (drag === 'slot' && over === 'shelf') return { type: 'parkLayer', key: from }
    return null
  }

  if (over !== 'key') return null
  // A palette row's id is 'group/pair/name' so that a command listed under two file pairs has two ids.
  if (drag === 'cmd') return { type: 'setMacroFromCommand', command: from.slice(from.lastIndexOf('/') + 1), key: to }
  if (drag === 'macro') return from === to ? null : { type: 'swapMacros', a: from, b: to }
  return null
}

/**
 * The description to give a macro made from a command: the first one the catalog has for that
 * name (ignoring case), since one command can be listed twice when its files are paired differently.
 */
export function commandDescription(catalog: CatalogEntry[], command: string): string | undefined {
  const lower = command.toLowerCase()
  return catalog.find((e) => e.name.toLowerCase() === lower && e.description !== '')?.description
}

/**
 * Runs a drop on the workspace. `layerId` is the layer being edited on the Macros tab.
 * `describe` gives a command's description for a macro made from it. A refusal carries the words to
 * show the user.
 */
export function applyDrop(
  ws: Workspace,
  action: DropAction,
  layerId: string | null,
  describe?: (command: string) => string | undefined,
): OpResult {
  switch (action.type) {
    case 'moveKey':
      return moveKey(ws, action.id, action.row, action.col)
    case 'swapLayers':
      return { ok: true, ws: swapLayers(ws, action.a, action.b) }
    case 'placeParked':
      return { ok: true, ws: placeParked(ws, action.layerId, action.key) }
    case 'parkLayer':
      return { ok: true, ws: parkLayer(ws, action.key) }
    case 'swapMacros':
      return layerId
        ? { ok: true, ws: swapMacros(ws, layerId, action.a, action.b) }
        : { ok: false, reason: 'Pick a layer first.' }
    case 'setMacroFromCommand':
      return layerId
        ? {
            ok: true,
            ws: setMacro(ws, layerId, action.key, newMacro(action.command, describe?.(action.command))),
          }
        : { ok: false, reason: 'Pick a layer first.' }
  }
}

function newMacro(command: string, description: string | undefined): Macro {
  const name = macroLabel(command)
  return description ? { action: command, name, description, extra: {} } : { action: command, name, extra: {} }
}

const UNIT_W = 64
const UNIT_H = 83

/**
 * The size a key gets when its corner handle is dragged by (dx, dy) screen pixels, with the
 * grid drawn at `scale`. Whole units, at least 1. `rowPitch` is the row spacing: 83 with labels
 * above the keys (the default), 64 without.
 */
export function resizeFromDelta(
  k: PadKey,
  dx: number,
  dy: number,
  scale: number,
  rowPitch: number = UNIT_H,
): { width: number; height: number } {
  const { w, h } = size(k)
  return {
    width: Math.max(1, w + Math.round(dx / (UNIT_W * scale))),
    height: Math.max(1, h + Math.round(dy / (rowPitch * scale))),
  }
}
