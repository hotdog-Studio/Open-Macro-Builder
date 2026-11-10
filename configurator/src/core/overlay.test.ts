import { describe, expect, it } from 'vitest'
import { readRepoText } from '../../test/repo'
import type { Workspace } from './config/model'
import { setOptions } from './config/ops'
import { parseConfig } from './config/parse'
import { emptyIconPath, keyRect, overlayCells, overlaySize } from './overlay'

const example = (): Workspace => parseConfig(readRepoText('config.json'), 'config.json')

function cell(ws: Workspace, selected: string, id: string) {
  const c = overlayCells(ws, selected).find((x) => x.keyId === id)
  if (!c) throw new Error(`no cell ${id}`)
  return c
}

/** The example with an icon on one macro of the layer on `layerKey`. */
function withMacroIcon(ws: Workspace, layerKey: string, macroKey: string, icon: string): Workspace {
  const layer = ws.slots[layerKey]
  const macros = { ...layer.macros, [macroKey]: { ...layer.macros[macroKey], icon } }
  return { ...ws, slots: { ...ws.slots, [layerKey]: { ...layer, macros } } }
}

describe('keyRect', () => {
  it('puts a 17 px label strip above a labelled key', () => {
    const k10 = example().keys.find((k) => k.id === 'k10')!
    expect(keyRect(k10, true)).toEqual({
      label: { x: 192, y: 0, w: 64, h: 17 },
      key: { x: 192, y: 17, w: 64, h: 145 },
    })
  })

  it('has no label and 64 px rows when labels are off', () => {
    const k10 = example().keys.find((k) => k.id === 'k10')!
    expect(keyRect(k10, false)).toEqual({ label: null, key: { x: 192, y: 0, w: 64, h: 128 } })
  })
})

describe('emptyIconPath', () => {
  it('names the four stock sizes and falls back to empty.png', () => {
    const ws = example()
    const sized = (width: number, height: number) => ({ ...ws.fn, width, height })
    expect(emptyIconPath(sized(1, 1))).toBe('img/empty_1x1.png')
    expect(emptyIconPath(sized(1, 2))).toBe('img/empty_1x2.png')
    expect(emptyIconPath(sized(2, 1))).toBe('img/empty_2x1.png')
    expect(emptyIconPath(sized(2, 2))).toBe('img/empty_2x2.png')
    expect(emptyIconPath(sized(3, 1))).toBe('img/empty.png')
    expect(emptyIconPath(ws.fn)).toBe('img/empty_2x1.png')
  })
})

describe('overlayCells', () => {
  it('lists the macro keys in order, then Fn', () => {
    const ws = example()
    expect(overlayCells(ws, 'k2').map((c) => c.keyId)).toEqual([...ws.keys.map((k) => k.id), 'fn'])
  })

  it('leaves Fn out when showFn is false or absent', () => {
    expect(overlayCells(setOptions(example(), { showFn: false }), 'k2').some((c) => c.keyId === 'fn')).toBe(false)
    expect(overlayCells(setOptions(example(), { showFn: undefined }), 'k2').some((c) => c.keyId === 'fn')).toBe(false)
  })

  it('draws the layer selected on k2 (Programs)', () => {
    const ws = example()
    expect(cell(ws, 'k2', 'k2').image).toBe('img/programs/selected_macro.png')
    const k1 = cell(ws, 'k2', 'k1')
    expect(k1.image).toBe('img/media/macro.png')
    expect(k1.label).toMatchObject({ text: 'Explorer', filled: true })
    expect(cell(ws, 'k2', 'k4').image).toBe('img/empty_1x1.png')
    const fn = cell(ws, 'k2', 'fn')
    expect(fn.image).toBe('img/empty_2x1.png')
    expect(fn.label).toMatchObject({ filled: false })
  })

  it('uses the plain images when markers are off', () => {
    const ws = setOptions(example(), { showMacroMarkers: false })
    expect(cell(ws, 'k2', 'k4').image).toBe('img/blank.png')
    expect(cell(ws, 'k2', 'k1').image).toBe('img/media/layer.png')
    expect(cell(ws, 'k2', 'k2').image).toBe('img/programs/selected.png')
  })

  it('shows the macro icon and the layer title when macro icons are on', () => {
    const ws = setOptions(withMacroIcon(example(), 'k2', 'k1', 'chrome'), { useMacroIcons: true })
    expect(cell(ws, 'k2', 'k1').image).toBe('img/chrome/macro.png')
    expect(cell(ws, 'k2', 'k1').label).toMatchObject({ text: 'Media', filled: true })
    expect(cell(ws, 'k2', 'k4').label).toMatchObject({ text: '', filled: false })
    // a macro without an icon keeps the layer icon
    expect(cell(ws, 'k2', 'k3').image).toBe('img/chrome/macro.png')
    expect(cell(ws, 'k2', 'k5').image).toBe('img/vs_code/macro.png')
  })

  it('uses the macro icon on the selected key too', () => {
    const ws = setOptions(withMacroIcon(example(), 'k2', 'k2', 'chrome'), { useMacroIcons: true })
    expect(cell(ws, 'k2', 'k2').image).toBe('img/chrome/selected_macro.png')
    expect(cell(setOptions(ws, { showMacroMarkers: false }), 'k2', 'k2').image).toBe('img/chrome/selected.png')
  })

  it('uses the layer image of the macro icon when markers are off', () => {
    const ws = setOptions(withMacroIcon(example(), 'k2', 'k1', 'chrome'), {
      useMacroIcons: true,
      showMacroMarkers: false,
    })
    expect(cell(ws, 'k2', 'k1').image).toBe('img/chrome/layer.png')
  })

  it('names the macro under each key when macro icons are off', () => {
    expect(cell(example(), 'k2', 'k2').label).toMatchObject({ text: 'PowerShell', filled: true })
    // Media has no macro on k4
    expect(cell(example(), 'k1', 'k4').label).toMatchObject({ text: '', filled: false })
  })

  it('omits labels when labels are off', () => {
    const ws = setOptions(example(), { showLabels: false })
    for (const c of overlayCells(ws, 'k2')) expect(c.label).toBeNull()
    expect(cell(ws, 'k2', 'k10').key).toEqual({ x: 192, y: 0, w: 64, h: 128 })
  })

  it('names the Fn key, a custom text, or a blank', () => {
    expect(cell(setOptions(example(), { showFn: true }), 'k2', 'fn').label).toMatchObject({
      text: 'ScrollLock',
      filled: true,
    })
    expect(cell(setOptions(example(), { showFn: 'Hold' }), 'k2', 'fn').label).toMatchObject({
      text: 'Hold',
      filled: true,
    })
    expect(cell(setOptions(example(), { showFn: ' ' }), 'k2', 'fn').label).toMatchObject({ text: ' ', filled: false })
  })
})

describe('overlaySize', () => {
  it('is the largest right and bottom edge of all cells', () => {
    expect(overlaySize(example())).toEqual({ w: 256, h: 330 })
  })

  it('is smaller without labels', () => {
    expect(overlaySize(setOptions(example(), { showLabels: false }))).toEqual({ w: 256, h: 256 })
  })
})
