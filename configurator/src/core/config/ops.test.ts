import { describe, expect, it } from 'vitest'
import { readRepoText } from '../../../test/repo'
import type { Workspace } from './model'
import {
  addKey,
  addLayer,
  findLayer,
  layerOnKey,
  macroLabel,
  moveKey,
  parkLayer,
  placeParked,
  removalImpact,
  removeKey,
  renameKey,
  resizeKey,
  setDefaultLayer,
  setMacro,
  setOptions,
  swapLayers,
  swapMacros,
  updateLayer,
  updateMacro,
} from './ops'
import { parseConfig } from './parse'
import { writeConfig } from './write'

const example = () => parseConfig(readRepoText('config.json'), 'config.json')

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error('expected the operation to succeed')
  return r as Extract<T, { ok: true }>
}

describe('pad edits', () => {
  it('moving a key keeps its layer and macros', () => {
    const ws = example()
    const media = layerOnKey(ws, 'k1')
    const explorer = findLayer(ws, 'L2')!.macros.k1
    expect(media?.title).toBe('Media')
    expect(explorer.name).toBe('Explorer')

    const moved = ok(moveKey(ws, 'k1', 5, 1)).ws
    expect(moved.keys[0]).toMatchObject({ id: 'k1', row: 5, col: 1 })
    expect(layerOnKey(moved, 'k1')).toBe(media)
    expect(findLayer(moved, 'L2')!.macros.k1).toEqual(explorer)
  })

  it('moves the Fn key', () => {
    const moved = ok(moveKey(example(), 'fn', 5, 1)).ws
    expect(moved.fn).toMatchObject({ row: 5, col: 1, width: 2 })
  })

  it('refuses to move or resize onto another key', () => {
    const ws = example()
    expect(moveKey(ws, 'k1', 1, 2)).toEqual({ ok: false, reason: 'That space is taken.' })
    expect(moveKey(ws, 'k1', 4, 2)).toEqual({ ok: false, reason: 'That space is taken.' }) // Fn is wide
    expect(resizeKey(ws, 'k1', 2, 1)).toEqual({ ok: false, reason: 'That space is taken.' })
    expect(resizeKey(ws, 'k10', 1, 3)).toEqual({ ok: false, reason: 'That space is taken.' })
  })

  it('lets a key stay where it is', () => {
    const ws = example()
    expect(moveKey(ws, 'k10', 1, 4).ok).toBe(true)
  })

  it('refuses positions below 1', () => {
    const ws = example()
    const reason = 'Keys start at row 1 and column 1.'
    expect(moveKey(ws, 'k1', 0, 1)).toEqual({ ok: false, reason })
    expect(moveKey(ws, 'k1', 1, 0)).toEqual({ ok: false, reason })
    expect(moveKey(ws, 'fn', -1, 3)).toEqual({ ok: false, reason })
  })

  it('resizing back to 1 removes width and height', () => {
    const ws = example()
    const small = ok(resizeKey(ws, 'k10', 1, 1)).ws
    expect('height' in small.keys[9]).toBe(false)
    expect('width' in small.keys[9]).toBe(false)
    const grown = ok(resizeKey(small, 'k10', 1, 2)).ws
    expect(grown.keys[9].height).toBe(2)
  })

  it('renames a key', () => {
    const ws = renameKey(example(), 'k1', 'F1')
    expect(ws.keys[0].key).toBe('F1')
    expect(renameKey(ws, 'fn', 'Pause').fn.key).toBe('Pause')
  })

  it('adds a key in the first free cell', () => {
    const { ws, id } = addKey(example(), 'F25')
    expect(id).toBe('k13')
    expect(ws.keys[12]).toMatchObject({ id: 'k13', key: 'F25', row: 1, col: 5 })
    expect(ws.keys).toHaveLength(13)
  })

  it('adds a key into a gap before the end of the grid', () => {
    const ws = ok(moveKey(example(), 'k2', 5, 1)).ws
    const added = addKey(ws, 'F25')
    expect(added.ws.keys[12]).toMatchObject({ row: 1, col: 2 })
  })

  it('numbers a new key after the highest id in use', () => {
    const ws = ok(removeKey(example(), 'k3')).ws
    expect(addKey(ws, 'F25').id).toBe('k13')
    const without12 = ok(removeKey(example(), 'k12')).ws
    expect(addKey(without12, 'F25').id).toBe('k12')
  })

  it('removing a key parks its layer and clears its macros everywhere', () => {
    const ws = example()
    const impact = removalImpact(ws, 'k2')
    expect(impact.layer).toBe('Programs')
    expect(impact.macros).toContainEqual({ layer: 'Media', name: 'Play' })

    const out = ok(removeKey(ws, 'k2')).ws
    expect(out.keys.map((k) => k.id)).not.toContain('k2')
    for (const l of [...Object.values(out.slots), ...out.parked]) expect(l.macros.k2).toBeUndefined()
    expect(out.parked.map((l) => l.title)).toContain('Programs')
    expect(out.slots.k2).toBeUndefined()
    expect(layerOnKey(out, 'k3')?.title).toBe('Chrome')
  })

  it('clears the macros of a parked layer too', () => {
    let ws = parkLayer(example(), 'k1') // Media is parked
    expect(ws.parked[0].macros.k2).toBeDefined()
    ws = ok(removeKey(ws, 'k2')).ws
    expect(ws.parked.find((l) => l.title === 'Media')!.macros.k2).toBeUndefined()
  })

  it('reports no layer when the key has none', () => {
    expect(removalImpact(example(), 'k4').layer).toBeNull()
  })

  it('refuses to remove the Fn key or the last macro key', () => {
    const ws = example()
    expect(removeKey(ws, 'fn')).toEqual({ ok: false, reason: 'The Fn key cannot be removed.' })
    const one: Workspace = { ...ws, keys: [ws.keys[0]] }
    expect(removeKey(one, 'k1')).toEqual({ ok: false, reason: 'A pad needs at least one macro key.' })
  })

  it('the start layer follows its layer', () => {
    const ws = example()
    expect(ws.options.defaultKey).toBe('k1')
    const swapped = swapLayers(ws, 'k1', 'k2')
    expect(swapped.options.defaultKey).toBe('k2')
    expect(layerOnKey(swapped, 'k2')?.title).toBe('Media')
    expect(layerOnKey(swapped, 'k1')?.title).toBe('Programs')
    expect(swapLayers(swapped, 'k3', 'k4').options.defaultKey).toBe('k2')
    expect(parkLayer(ws, 'k1').options.defaultKey).toBeNull()
    expect(parkLayer(ws, 'k2').options.defaultKey).toBe('k1')
    expect(ok(removeKey(ws, 'k1')).ws.options.defaultKey).toBeNull()
  })

  it('swaps a layer onto an empty key', () => {
    const swapped = swapLayers(example(), 'k1', 'k4')
    expect(layerOnKey(swapped, 'k4')?.title).toBe('Media')
    expect(layerOnKey(swapped, 'k1')).toBeUndefined()
    expect(swapped.options.defaultKey).toBe('k4')
  })

  it('setting the start layer writes the default field', () => {
    const base = setDefaultLayer(example(), null)
    expect(base.options.defaultKey).toBeNull()
    expect(writeConfig(base)).not.toContain('"default"')
    const set = setDefaultLayer(base, 'k3')
    expect(set.options).toMatchObject({ defaultKey: 'k3', hasDefault: true })
    expect(writeConfig(set)).toContain('"default": 3')
  })

  it('placing a parked layer parks the one already there', () => {
    const parked = parkLayer(example(), 'k3') // Chrome is parked
    const chrome = parked.parked[0]
    const out = placeParked(parked, chrome.id, 'k2')
    expect(layerOnKey(out, 'k2')?.title).toBe('Chrome')
    expect(out.parked.map((l) => l.title)).toEqual(['Programs'])
    expect(layerOnKey(out, 'k3')).toBeUndefined()
  })

  it('places a parked layer on an empty key', () => {
    const parked = parkLayer(example(), 'k3')
    const out = placeParked(parked, parked.parked[0].id, 'k4')
    expect(layerOnKey(out, 'k4')?.title).toBe('Chrome')
    expect(out.parked).toHaveLength(0)
  })

  it('parking the start layer by placing over it clears the start', () => {
    const parked = parkLayer(example(), 'k3')
    const out = placeParked(parked, parked.parked[0].id, 'k1')
    expect(out.options.defaultKey).toBeNull()
    expect(out.parked.map((l) => l.title)).toEqual(['Media'])
  })

  it('adds a layer on the parked shelf with a unique id', () => {
    const ws = example()
    const { ws: out, layerId } = addLayer(ws, 'New layer', 'default_commands')
    const ids = [...Object.values(ws.slots), ...ws.parked].map((l) => l.id)
    expect(ids).not.toContain(layerId)
    expect(out.parked.at(-1)).toMatchObject({ id: layerId, title: 'New layer', icon: 'default_commands', macros: {} })
    expect(addLayer(out, 'Another', 'x').layerId).not.toBe(layerId)
  })

  it('updates a layer wherever it is', () => {
    const ws = example()
    const out = updateLayer(ws, 'L1', { title: 'Music' })
    expect(layerOnKey(out, 'k1')).toMatchObject({ title: 'Music', icon: 'media' })
    const parked = parkLayer(ws, 'k1')
    expect(updateLayer(parked, 'L1', { icon: 'z' }).parked[0].icon).toBe('z')
  })

  it('sets, clears, swaps and updates macros on their key', () => {
    const ws = example()
    const macro = { action: 'Escape', name: 'Esc', extra: {} }
    const set = setMacro(ws, 'L1', 'k4', macro)
    expect(findLayer(set, 'L1')!.macros.k4).toEqual(macro)
    expect('k4' in findLayer(setMacro(set, 'L1', 'k4', null), 'L1')!.macros).toBe(false)

    const swapped = swapMacros(ws, 'L1', 'k1', 'k4')
    expect(findLayer(swapped, 'L1')!.macros.k4.name).toBe('Prev')
    expect('k1' in findLayer(swapped, 'L1')!.macros).toBe(false)

    const upd = updateMacro(ws, 'L1', 'k1', { name: 'Back', description: '' })
    const m = findLayer(upd, 'L1')!.macros.k1
    expect(m.name).toBe('Back')
    expect('description' in m).toBe(false)
    expect(m.action).toBe('PreviousTrack')
    expect(updateMacro(ws, 'L1', 'k4', { name: 'x' })).toBe(ws)
  })

  it('sets options', () => {
    const out = setOptions(example(), { showLabels: false })
    expect(out.options.showLabels).toBe(false)
    expect(out.options.defaultKey).toBe('k1')
  })

  it('finds layers', () => {
    const ws = example()
    expect(findLayer(ws, 'L1')?.title).toBe('Media')
    expect(findLayer(ws, 'nope')).toBeUndefined()
    expect(layerOnKey(ws, 'k4')).toBeUndefined()
  })

  it('never changes the workspace it is given', () => {
    const ws = example()
    const before = structuredClone(ws)
    const macro = { action: 'Escape', name: 'Esc', extra: {} }
    moveKey(ws, 'k1', 5, 1)
    resizeKey(ws, 'k10', 1, 1)
    renameKey(ws, 'k1', 'F1')
    addKey(ws, 'F25')
    removeKey(ws, 'k2')
    swapLayers(ws, 'k1', 'k2')
    parkLayer(ws, 'k1')
    placeParked(parkLayer(ws, 'k1'), 'L1', 'k2')
    addLayer(ws, 'x', 'y')
    updateLayer(ws, 'L1', { title: 'x' })
    setDefaultLayer(ws, 'k3')
    setMacro(ws, 'L1', 'k4', macro)
    setMacro(ws, 'L1', 'k1', null)
    swapMacros(ws, 'L1', 'k1', 'k2')
    updateMacro(ws, 'L1', 'k1', { name: 'x' })
    setOptions(ws, { showLabels: false })
    expect(ws).toEqual(before)
  })

  it('an edited example still saves', () => {
    const out = ok(moveKey(example(), 'k1', 5, 1)).ws
    expect(writeConfig(out)).toContain('"row": 5')
  })
})

describe('macroLabel', () => {
  it('turns a command name into a label', () => {
    expect(macroLabel('OpenGmail1')).toBe('Gmail 1')
    expect(macroLabel('ChromeNewTab')).toBe('Chrome New Tab')
    expect(macroLabel('Escape')).toBe('Escape')
  })

  it('keeps acronyms together', () => {
    expect(macroLabel('VSCodeOpen')).toBe('VS Code Open')
  })
})
