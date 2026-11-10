import { describe, expect, it } from 'vitest'
import type { PadKey } from '../core/config/model'
import { parseConfig } from '../core/config/parse'
import { readRepoText } from '../../test/repo'
import { applyDrop, commandDescription, dropAction, resizeFromDelta } from './dnd'

describe('applyDrop', () => {
  const ws = parseConfig(readRepoText('config.json'), 'config.json')

  it('moves a key to a free cell and refuses a taken one with its reason', () => {
    const moved = applyDrop(ws, { type: 'moveKey', id: 'k1', row: 5, col: 1 }, null)
    expect(moved.ok && moved.ws.keys[0]).toMatchObject({ row: 5, col: 1 })
    expect(applyDrop(ws, { type: 'moveKey', id: 'k1', row: 1, col: 2 }, null)).toEqual({
      ok: false,
      reason: 'That space is taken.',
    })
    expect(applyDrop(ws, { type: 'moveKey', id: 'k1', row: 0, col: 1 }, null)).toEqual({
      ok: false,
      reason: 'Keys start at row 1 and column 1.',
    })
  })

  it('parks and swaps layers', () => {
    const parked = applyDrop(ws, { type: 'parkLayer', key: 'k1' }, null)
    expect(parked.ok && parked.ws.slots.k1).toBeUndefined()
    const swapped = applyDrop(ws, { type: 'swapLayers', a: 'k1', b: 'k2' }, null)
    expect(swapped.ok && swapped.ws.slots.k1.title).toBe('Programs')
  })

  it('puts a command on a key of the selected layer, and swaps two macros', () => {
    const set = applyDrop(ws, { type: 'setMacroFromCommand', command: 'ChromeNewTab', key: 'k4' }, 'L1')
    expect(set.ok && set.ws.slots.k1.macros.k4).toMatchObject({ action: 'ChromeNewTab', name: 'Chrome New Tab' })
    const swapped = applyDrop(ws, { type: 'swapMacros', a: 'k1', b: 'k2' }, 'L1')
    expect(swapped.ok && swapped.ws.slots.k1.macros.k2.name).toBe('Prev')
  })

  it('gives a placed command its description, and leaves the field out when there is none', () => {
    const act = { type: 'setMacroFromCommand', command: 'ChromeNewTab', key: 'k4' } as const
    const described = applyDrop(ws, act, 'L1', () => 'Opens a tab.')
    expect(described.ok && described.ws.slots.k1.macros.k4.description).toBe('Opens a tab.')
    const bare = applyDrop(ws, act, 'L1', () => undefined)
    expect(bare.ok && bare.ws.slots.k1.macros.k4).not.toHaveProperty('description')
  })

  it('asks for a layer when the drop needs one', () => {
    expect(applyDrop(ws, { type: 'swapMacros', a: 'k1', b: 'k2' }, null)).toEqual({
      ok: false,
      reason: 'Pick a layer first.',
    })
  })
})

describe('dropAction', () => {
  it('moves a key onto a cell on the Pad shape tab', () => {
    expect(dropAction('shape', 'key:k1', 'cell:2:5')).toEqual({ type: 'moveKey', id: 'k1', row: 2, col: 5 })
    expect(dropAction('shape', 'key:fn', 'cell:1:1')).toEqual({ type: 'moveKey', id: 'fn', row: 1, col: 1 })
  })

  it('swaps layers, places a parked layer and parks a layer on the Layers tab', () => {
    expect(dropAction('layers', 'slot:k1', 'key:k3')).toEqual({ type: 'swapLayers', a: 'k1', b: 'k3' })
    expect(dropAction('layers', 'parked:L9', 'key:k3')).toEqual({ type: 'placeParked', layerId: 'L9', key: 'k3' })
    expect(dropAction('layers', 'slot:k1', 'shelf')).toEqual({ type: 'parkLayer', key: 'k1' })
  })

  it('sets a macro from a command and swaps macros on the Macros tab', () => {
    expect(dropAction('macros', 'cmd:ChromeNewTab', 'key:k2')).toEqual({
      type: 'setMacroFromCommand',
      command: 'ChromeNewTab',
      key: 'k2',
    })
    expect(dropAction('macros', 'macro:k1', 'key:k2')).toEqual({ type: 'swapMacros', a: 'k1', b: 'k2' })
  })

  it('reads the command name from a palette row id', () => {
    expect(dropAction('macros', 'cmd:yours/x/Foo', 'key:k2')).toEqual({ type: 'setMacroFromCommand', command: 'Foo', key: 'k2' })
    expect(dropAction('macros', 'cmd:shared/custom/chrome/OpenYoutube', 'key:k2')).toEqual({
      type: 'setMacroFromCommand',
      command: 'OpenYoutube',
      key: 'k2',
    })
    expect(dropAction('macros', 'cmd:ChromeNewTab', 'key:k2')).toEqual({
      type: 'setMacroFromCommand',
      command: 'ChromeNewTab',
      key: 'k2',
    })
  })

  it('ignores a drop on the key it came from', () => {
    expect(dropAction('layers', 'slot:k1', 'key:k1')).toBeNull()
    expect(dropAction('macros', 'macro:k1', 'key:k1')).toBeNull()
  })

  it('ignores drops that mean nothing on that tab', () => {
    expect(dropAction('shape', 'cmd:X', 'key:k1')).toBeNull()
    expect(dropAction('shape', 'key:k1', 'key:k2')).toBeNull()
    expect(dropAction('shape', 'key:k1', 'cell:x:5')).toBeNull()
    expect(dropAction('layers', 'cmd:X', 'key:k1')).toBeNull()
    expect(dropAction('layers', 'key:k1', 'key:k2')).toBeNull()
    expect(dropAction('macros', 'slot:k1', 'key:k2')).toBeNull()
    expect(dropAction('macros', 'macro:k1', 'shelf')).toBeNull()
  })
})

describe('resizeFromDelta', () => {
  const one: PadKey = { id: 'k1', key: 'F13', extra: {} }

  it('rounds a drag to whole key units', () => {
    expect(resizeFromDelta(one, 70, 0, 1)).toEqual({ width: 2, height: 1 })
    expect(resizeFromDelta(one, 0, 83 * 2, 1)).toEqual({ width: 1, height: 3 })
  })

  it('never goes below one unit', () => {
    expect(resizeFromDelta(one, -200, 0, 1)).toEqual({ width: 1, height: 1 })
    expect(resizeFromDelta({ ...one, width: 3, height: 2 }, -64, -999, 1)).toEqual({ width: 2, height: 1 })
  })

  it('divides by the scale the grid is drawn at', () => {
    expect(resizeFromDelta(one, 128, 0, 2)).toEqual({ width: 2, height: 1 })
  })

  it('takes the row spacing when the labels are off', () => {
    expect(resizeFromDelta(one, 0, 64, 1, 64)).toEqual({ width: 1, height: 2 })
  })
})

describe('commandDescription', () => {
  const entry = (name: string, pair: string, description: string) => ({ name, pair, group: 'shared' as const, description, in: {} })

  it('finds the first non-empty description for a name, ignoring case and file pair', () => {
    const catalog = [entry('OpenX', 'a', ''), entry('openx', 'b', 'Opens X.'), entry('Other', 'a', 'Nope.')]
    expect(commandDescription(catalog, 'OPENX')).toBe('Opens X.')
    expect(commandDescription(catalog, 'Missing')).toBeUndefined()
  })
})
