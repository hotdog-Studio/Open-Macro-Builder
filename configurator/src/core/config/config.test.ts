import { describe, expect, it } from 'vitest'
import { readRepoText } from '../../../test/repo'
import { size } from './model'
import { ConfigError, parseConfig } from './parse'
import { writeConfig } from './write'

const threeKeys = [
  { key: 'F13', row: 1, col: 1 },
  { key: 'F14', row: 1, col: 2 },
  { key: 'F15', row: 1, col: 3 },
]

const config = (fields: Record<string, unknown>) =>
  JSON.stringify({ fn: { key: 'ScrollLock' }, keys: threeKeys, ...fields }, null, 2) + '\n'

const layer = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  icon: 'x',
  macros: [{ action: 'A', name: 'a' }],
  ...extra,
})

describe('config.json', () => {
  it('saves the example config.json byte for byte', () => {
    const text = readRepoText('config.json')
    expect(writeConfig(parseConfig(text, 'config.json'))).toBe(text)
  })

  it('reads the example config.json into slots, keys and options', () => {
    const ws = parseConfig(readRepoText('config.json'), 'config.json')
    expect(ws.fn.id).toBe('fn')
    expect(ws.keys.map((k) => k.id)).toEqual(Array.from({ length: 12 }, (_, i) => `k${i + 1}`))
    expect(ws.slots.k1.title).toBe('Media')
    expect(ws.slots.k4).toBeUndefined()
    expect(ws.slots.k5.title).toBe('VS Code')
    expect(ws.slots.k1.macros.k10.action).toBe('VolumeUp')
    expect(ws.slots.k1.macros.k4).toBeUndefined()
    expect(ws.parked).toEqual([])
    expect(ws.notices).toEqual([])
    expect(ws.options).toMatchObject({ defaultKey: 'k1', hasDefault: true, showFn: ' ', iconAction: 'Layer' })
    expect(ws.hotkeys).toEqual([])
    expect(size(ws.fn)).toEqual({ w: 2, h: 1, row: 4, col: 1 })
  })

  it('maps layers and macros to keys by position, skipping disabled layers', () => {
    const ws = parseConfig(
      config({ layers: [layer('A'), null, layer('B', { disabled: true }), layer('C')] }),
      'config.json',
    )
    expect(ws.slots.k1.title).toBe('A')
    expect(ws.slots.k2).toBeUndefined()
    expect(ws.slots.k3.title).toBe('C')
    expect(ws.parked.map((l) => l.title)).toEqual(['B'])
    expect(new Set([ws.slots.k1.id, ws.slots.k3.id, ws.parked[0].id]).size).toBe(3)
  })

  it('writes parked layers after the slots with "disabled": true', () => {
    const ws = parseConfig(
      config({ layers: [layer('A'), null, layer('B', { disabled: true }), layer('C')] }),
      'config.json',
    )
    const out = writeConfig(ws)
    expect(out).toContain('"title": "B",\n      "icon": "x",\n      "disabled": true,')
    expect(out.indexOf('"title": "C"')).toBeLessThan(out.indexOf('"title": "B"'))
    const again = parseConfig(out, 'config.json')
    expect(again.parked.map((l) => l.title)).toEqual(['B'])
    expect(again.slots.k3.title).toBe('C')
  })

  it('keeps unknown fields', () => {
    const text = config({
      theme: { a: 1 },
      layers: [layer('A', { color: 'red', macros: [{ action: 'A', name: 'a', hold: true }] })],
    }).replace('"key": "F13"', '"key": "F13",\n      "note": "x"')
    const out = writeConfig(parseConfig(text, 'config.json'))
    const data = JSON.parse(out)
    expect(data.theme).toEqual({ a: 1 })
    expect(data.layers[0].color).toBe('red')
    expect(data.layers[0].macros[0].hold).toBe(true)
    expect(data.keys[0].note).toBe('x')
    expect(out).toContain('{ "key": "F13", "row": 1, "col": 1, "note": "x" }')
  })

  it('parks layers without a key and keeps macros past the last key', () => {
    const text = JSON.stringify({
      fn: { key: 'ScrollLock' },
      keys: threeKeys.slice(0, 2),
      layers: [
        { title: 'A', icon: 'x', macros: [{ action: 'A', name: 'a' }, null, { action: 'C', name: 'c' }] },
        layer('B'),
        layer('C'),
      ],
    })
    const ws = parseConfig(text, 'config.json')
    expect(ws.parked.length).toBe(1)
    expect(ws.parked[0].title).toBe('C')
    expect(ws.notices).toEqual([
      'Layer "A" has more macros than keys. Saving needs the extra ones dropped (Save offers this) or more keys added.',
      'Layer "C" had no key, so it was parked.',
    ])
    const data = JSON.parse(writeConfig(ws))
    expect(data.layers.map((l: { title: string }) => l.title)).toEqual(['A', 'B', 'C'])
    expect(data.layers[0].macros).toEqual([{ action: 'A', name: 'a' }, null, { action: 'C', name: 'c' }])
    expect(data.layers[0].macros[2]).toEqual({ action: 'C', name: 'c' })
  })

  it('keeps the start layer on its key, and an out-of-range default as written', () => {
    const ws = parseConfig(config({ layers: [layer('A')], default: 2 }), 'config.json')
    expect(ws.options.defaultKey).toBe('k2')
    expect(JSON.parse(writeConfig(ws)).default).toBe(2)

    const far = parseConfig(config({ layers: [layer('A')], default: 9 }), 'config.json')
    expect(far.options.defaultKey).toBeNull()
    expect(far.options.defaultRaw).toBe(9)
    expect(far.options.hasDefault).toBe(true)
    expect(JSON.parse(writeConfig(far)).default).toBe(9)

    const none = parseConfig(config({ layers: [layer('A')] }), 'config.json')
    expect(none.options.hasDefault).toBe(false)
    expect('default' in JSON.parse(writeConfig(none))).toBe(false)
  })

  it('moves the start layer when its key changes', () => {
    const ws = parseConfig(config({ layers: [layer('A')], default: 1 }), 'config.json')
    ws.options.defaultKey = 'k3'
    expect(JSON.parse(writeConfig(ws)).default).toBe(3)
  })

  it('writes only the options that are set', () => {
    const ws = parseConfig(config({ layers: [] }), 'config.json')
    ws.options.showLabels = true
    ws.options.showFn = 'ScrollLock'
    const keys = Object.keys(JSON.parse(writeConfig(ws)))
    expect(keys).toEqual(['fn', 'keys', 'layers', 'showFn', 'showLabels'])
  })

  it('writes hotkeys and hotstrings one inline entry per line', () => {
    const ws = parseConfig(config({ layers: [], hotkeys: [{ key: '^a', action: 'X' }], hotstrings: [] }), 'config.json')
    const out = writeConfig(ws)
    expect(out).toContain('"hotkeys": [\n    { "key": "^a", "action": "X" }\n  ],\n  "hotstrings": []\n}\n')
  })

  it('keeps a falsy disabled value and leaves that layer in its slot', () => {
    const text = config({ keys: threeKeys.slice(0, 2), layers: [layer('A', { disabled: false }), layer('B')] })
    const ws = parseConfig(text, 'config.json')
    expect(ws.slots.k1.title).toBe('A')
    expect(ws.slots.k2.title).toBe('B')
    expect(ws.parked).toEqual([])
    const out = writeConfig(ws)
    expect(out.split('"disabled": false').length - 1).toBe(1)
    expect(out.split('"disabled"').length - 1).toBe(1)
  })

  it('parks a layer whose disabled value is truthy', () => {
    const ws = parseConfig(config({ layers: [layer('A', { disabled: 1 }), layer('B')] }), 'config.json')
    expect(ws.parked.map((l) => l.title)).toEqual(['A'])
    expect(ws.slots.k1.title).toBe('B')
    const out = writeConfig(ws)
    expect(out).toContain('"disabled": true')
    expect(out.split('"disabled"').length - 1).toBe(1)
  })

  it('never writes a field name twice', () => {
    const keys = [{ key: 'F13', row: '2' }, ...threeKeys.slice(1)]
    const text = config({ keys, layers: [layer('A')], showLabels: 'yes' })
    const ws = parseConfig(text, 'config.json')
    expect(ws.keys[0].extra.row).toBe('2')
    ws.keys[0].row = 3
    ws.options.showLabels = false
    const out = writeConfig(ws)
    const line = out.split('\n').find((l) => l.includes('"F13"'))
    expect(line).toContain('"row": 3')
    expect(line).not.toContain('"row": "2"')
    expect(out).not.toContain('"yes"')
    expect(out.split('"showLabels"').length - 1).toBe(1)
    expect(JSON.parse(out).showLabels).toBe(false)

    // untouched wrong-typed values still survive
    expect(JSON.parse(writeConfig(parseConfig(text, 'config.json'))).showLabels).toBe('yes')
  })

  it('rejects text that is not JSON', () => {
    expect(() => parseConfig('{ "fn": , }', 'config.json')).toThrow(ConfigError)
    expect(() => parseConfig('{ "fn": , }', 'config.json')).toThrow(/config.json is not valid JSON/)
  })

  it('rejects a config without fn or with keys that are not a list', () => {
    expect(() => parseConfig('{ "keys": [] }', 'config.json')).toThrow(ConfigError)
    expect(() => parseConfig('{ "fn": { "key": "F1" }, "keys": {} }', 'config.json')).toThrow(ConfigError)
    expect(() => parseConfig('[]', 'config.json')).toThrow(ConfigError)
  })
})
