import type { KeyId, Layer, Macro, Options, PadKey, Workspace } from './model'
import { size } from './model'
import { readMacro } from './parse'

export type OpResult = { ok: true; ws: Workspace } | { ok: false; reason: string }

const TAKEN = 'That space is taken.'
const TOO_LOW = 'Keys start at row 1 and column 1.'
const TOO_SMALL = 'A key is at least 1 wide and 1 tall.'

// ---------------------------------------------------------------- lookups

const allKeys = (ws: Workspace): PadKey[] => [ws.fn, ...ws.keys]

function keyOf(ws: Workspace, id: KeyId): PadKey | undefined {
  return id === 'fn' ? ws.fn : ws.keys.find((k) => k.id === id)
}

export function findLayer(ws: Workspace, layerId: string): Layer | undefined {
  return [...Object.values(ws.slots), ...ws.parked].find((l) => l.id === layerId)
}

export function layerOnKey(ws: Workspace, key: KeyId): Layer | undefined {
  return ws.slots[key]
}

// ---------------------------------------------------------------- copy helpers

/** Replaces one key (by id) with a changed copy; the rest of the workspace is shared. */
function withKey(ws: Workspace, id: KeyId, change: (k: PadKey) => PadKey): Workspace {
  if (id === 'fn') return { ...ws, fn: change(ws.fn) }
  return { ...ws, keys: ws.keys.map((k) => (k.id === id ? change(k) : k)) }
}

/** Replaces one layer (wherever it sits) with a changed copy. */
function withLayer(ws: Workspace, layerId: string, change: (l: Layer) => Layer): Workspace {
  const slots: Record<KeyId, Layer> = {}
  for (const [k, l] of Object.entries(ws.slots)) slots[k] = l.id === layerId ? change(l) : l
  return { ...ws, slots, parked: ws.parked.map((l) => (l.id === layerId ? change(l) : l)) }
}

function without<T extends object>(obj: Record<string, T>, key: string): Record<string, T> {
  const out = { ...obj }
  delete out[key]
  return out
}

// ---------------------------------------------------------------- keys

function overlaps(a: { row: number; col: number; w: number; h: number }, b: typeof a): boolean {
  return a.row < b.row + b.h && b.row < a.row + a.h && a.col < b.col + b.w && b.col < a.col + a.w
}

function checkPlace(ws: Workspace, id: KeyId, row: number, col: number, w: number, h: number): string | null {
  if (!Number.isInteger(row) || !Number.isInteger(col) || row < 1 || col < 1) return TOO_LOW
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1) return TOO_SMALL
  const me = { row, col, w, h }
  for (const k of allKeys(ws)) {
    if (k.id !== id && overlaps(me, size(k))) return TAKEN
  }
  return null
}

export function moveKey(ws: Workspace, id: KeyId, row: number, col: number): OpResult {
  const key = keyOf(ws, id)
  if (!key) return { ok: false, reason: 'There is no such key.' }
  const { w, h } = size(key)
  const reason = checkPlace(ws, id, row, col, w, h)
  if (reason) return { ok: false, reason }
  return { ok: true, ws: withKey(ws, id, (k) => ({ ...k, row, col })) }
}

export function resizeKey(ws: Workspace, id: KeyId, width: number, height: number): OpResult {
  const key = keyOf(ws, id)
  if (!key) return { ok: false, reason: 'There is no such key.' }
  const { row, col } = size(key)
  const reason = checkPlace(ws, id, row, col, width, height)
  if (reason) return { ok: false, reason }
  return {
    ok: true,
    ws: withKey(ws, id, (k) => {
      const next: PadKey = { ...k, width, height }
      if (width === 1) delete next.width
      if (height === 1) delete next.height
      return next
    }),
  }
}

export function renameKey(ws: Workspace, id: KeyId, key: string): Workspace {
  return withKey(ws, id, (k) => ({ ...k, key }))
}

/**
 * Both runtimes give macro N to key N, so once the pad has one more key, the first
 * macro written past the old last key belongs to the new key. Move it there, so the
 * editor shows what the saved file means.
 */
function takeOverflow(ws: Workspace, added: PadKey): Workspace {
  const notices = [...ws.notices]
  const take = (l: Layer): Layer => {
    if (l.overflowMacros.length === 0) return l
    const macro = readMacro(l.overflowMacros[0])
    if (macro) notices.push(`Layer "${l.title}" had a macro past the last key; it is now on ${added.key}.`)
    return {
      ...l,
      macros: macro ? { ...l.macros, [added.id]: macro } : l.macros,
      overflowMacros: l.overflowMacros.slice(1),
    }
  }
  const slots: Record<KeyId, Layer> = {}
  for (const [k, l] of Object.entries(ws.slots)) slots[k] = take(l)
  return { ...ws, slots, parked: ws.parked.map(take), notices }
}

export function addKey(ws: Workspace, key: string): { ws: Workspace; id: KeyId } {
  const highest = ws.keys.reduce((n, k) => Math.max(n, Number(/^k(\d+)$/.exec(k.id)?.[1] ?? 0)), 0)
  const id = `k${highest + 1}`
  let width = 0
  let height = 0
  for (const k of allKeys(ws)) {
    const s = size(k)
    width = Math.max(width, s.col + s.w - 1)
    height = Math.max(height, s.row + s.h - 1)
  }
  // The grid is at most `height` rows tall, so row height + 1 always has room.
  for (let row = 1; row <= height + 1; row++) {
    for (let col = 1; col <= width + 1; col++) {
      if (checkPlace(ws, id, row, col, 1, 1) === null) {
        const added: PadKey = { id, key, row, col, extra: {} }
        return { ws: takeOverflow({ ...ws, keys: [...ws.keys, added] }, added), id }
      }
    }
  }
  throw new Error('unreachable: the row below the grid is always free')
}

export interface RemovalImpact {
  layer: string | null
  macros: { layer: string; name: string }[]
}

export function removalImpact(ws: Workspace, id: KeyId): RemovalImpact {
  const macros: { layer: string; name: string }[] = []
  for (const l of [...ws.keys.map((k) => ws.slots[k.id]).filter(Boolean), ...ws.parked]) {
    const m = l.macros[id]
    if (m) macros.push({ layer: l.title, name: m.name })
  }
  return { layer: ws.slots[id]?.title ?? null, macros }
}

export function removeKey(ws: Workspace, id: KeyId): OpResult {
  if (id === 'fn') return { ok: false, reason: 'The Fn key cannot be removed.' }
  if (!ws.keys.some((k) => k.id === id)) return { ok: false, reason: 'There is no such key.' }
  if (ws.keys.length <= 1) return { ok: false, reason: 'A pad needs at least one macro key.' }
  const owner = ws.slots[id]
  const strip = (l: Layer): Layer => (id in l.macros ? { ...l, macros: without(l.macros, id) } : l)
  const slots: Record<KeyId, Layer> = {}
  for (const [k, l] of Object.entries(ws.slots)) if (k !== id) slots[k] = strip(l)
  const parked = ws.parked.map(strip)
  if (owner) parked.push(strip(owner))
  const options = ws.options.defaultKey === id ? { ...ws.options, defaultKey: null } : ws.options
  return { ok: true, ws: { ...ws, keys: ws.keys.filter((k) => k.id !== id), slots, parked, options } }
}

// ---------------------------------------------------------------- layers

/** Moves the start layer along with its layer: only when the layer was on that key. */
function followStart(options: Options, from: KeyId, to: KeyId | null): Options {
  return options.defaultKey === from ? { ...options, defaultKey: to } : options
}

export function swapLayers(ws: Workspace, a: KeyId, b: KeyId): Workspace {
  if (a === b) return ws
  const la = ws.slots[a]
  const lb = ws.slots[b]
  if (!la && !lb) return ws
  const slots = { ...ws.slots }
  if (lb) slots[a] = lb
  else delete slots[a]
  if (la) slots[b] = la
  else delete slots[b]
  let options = ws.options
  if (la && options.defaultKey === a) options = { ...options, defaultKey: b }
  else if (lb && options.defaultKey === b) options = { ...options, defaultKey: a }
  return { ...ws, slots, options }
}

export function parkLayer(ws: Workspace, key: KeyId): Workspace {
  const layer = ws.slots[key]
  if (!layer) return ws
  return {
    ...ws,
    slots: without(ws.slots, key),
    parked: [...ws.parked, layer],
    options: followStart(ws.options, key, null),
  }
}

export function placeParked(ws: Workspace, layerId: string, key: KeyId): Workspace {
  const layer = ws.parked.find((l) => l.id === layerId)
  if (!layer || !ws.keys.some((k) => k.id === key)) return ws
  const occupant = ws.slots[key]
  const parked = ws.parked.filter((l) => l.id !== layerId)
  if (occupant) parked.push(occupant)
  return {
    ...ws,
    slots: { ...ws.slots, [key]: layer },
    parked,
    options: occupant ? followStart(ws.options, key, null) : ws.options,
  }
}

export function addLayer(ws: Workspace, title: string, icon: string): { ws: Workspace; layerId: string } {
  const highest = [...Object.values(ws.slots), ...ws.parked].reduce(
    (n, l) => Math.max(n, Number(/^L(\d+)$/.exec(l.id)?.[1] ?? 0)),
    0,
  )
  const layerId = `L${highest + 1}`
  const layer: Layer = { id: layerId, title, icon, macros: {}, overflowMacros: [], extra: {} }
  return { ws: { ...ws, parked: [...ws.parked, layer] }, layerId }
}

export function updateLayer(ws: Workspace, layerId: string, patch: { title?: string; icon?: string }): Workspace {
  return withLayer(ws, layerId, (l) => ({
    ...l,
    ...(patch.title !== undefined && { title: patch.title }),
    ...(patch.icon !== undefined && { icon: patch.icon }),
  }))
}

export function setDefaultLayer(ws: Workspace, key: KeyId | null): Workspace {
  const options: Options = { ...ws.options, defaultKey: key, hasDefault: key !== null }
  delete options.defaultRaw
  return { ...ws, options }
}

// ---------------------------------------------------------------- macros

export function setMacro(ws: Workspace, layerId: string, key: KeyId, macro: Macro | null): Workspace {
  return withLayer(ws, layerId, (l) => ({
    ...l,
    macros: macro ? { ...l.macros, [key]: macro } : without(l.macros, key),
  }))
}

export function swapMacros(ws: Workspace, layerId: string, a: KeyId, b: KeyId): Workspace {
  if (a === b) return ws
  return withLayer(ws, layerId, (l) => {
    const macros = { ...l.macros }
    const ma = macros[a]
    const mb = macros[b]
    if (mb) macros[a] = mb
    else delete macros[a]
    if (ma) macros[b] = ma
    else delete macros[b]
    return { ...l, macros }
  })
}

/** Empty description or icon removes the field; an empty name stays empty. */
export function updateMacro(
  ws: Workspace,
  layerId: string,
  key: KeyId,
  patch: { name?: string; description?: string; icon?: string },
): Workspace {
  if (!findLayer(ws, layerId)?.macros[key]) return ws
  return withLayer(ws, layerId, (l) => {
    const next: Macro = { ...l.macros[key] }
    if (patch.name !== undefined) next.name = patch.name
    for (const f of ['description', 'icon'] as const) {
      const v = patch[f]
      if (v === undefined) continue
      if (v === '') delete next[f]
      else next[f] = v
    }
    return { ...l, macros: { ...l.macros, [key]: next } }
  })
}

// ---------------------------------------------------------------- options

export function setOptions(ws: Workspace, patch: Partial<Options>): Workspace {
  return { ...ws, options: { ...ws.options, ...patch } }
}

// ---------------------------------------------------------------- labels

/** 'OpenGmail1' → 'Gmail 1', 'ChromeNewTab' → 'Chrome New Tab'. */
export function macroLabel(command: string): string {
  const name = /^Open(?=[A-Z])/.test(command) ? command.slice(4) : command
  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
}
