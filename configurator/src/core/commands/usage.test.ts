import { describe, expect, it } from 'vitest'
import { readRepoText } from '../../../test/repo'
import { parkLayer, setMacro } from '../config/ops'
import { parseConfig } from '../config/parse'
import { keysUsing } from './usage'

const macro = (action: string) => ({ action, name: action, extra: {} })

describe('keysUsing', () => {
  it('lists the keys that use a command, slotted then parked', () => {
    let ws = parseConfig(readRepoText('config.json'), 'config.json')
    const slotted = ws.keys.filter((k) => ws.slots[k.id])
    const [first, second, third] = slotted.map((k) => ws.slots[k.id])
    const [thirdKey] = slotted.slice(2)
    const name = (id: string) => ws.keys.find((k) => k.id === id)!.key
    // Two uses on one layer come in key order, whatever order they were added in.
    ws = setMacro(ws, second.id, ws.keys[4].id, macro('ZED'))
    ws = setMacro(ws, second.id, ws.keys[1].id, macro('Zed'))
    ws = setMacro(ws, first.id, ws.keys[2].id, macro('zed'))
    ws = setMacro(ws, third.id, ws.keys[3].id, macro('zed'))
    ws = setMacro(ws, third.id, ws.keys[5].id, macro('Other'))
    ws = parkLayer(ws, thirdKey.id)
    expect(keysUsing(ws, 'Zed')).toEqual([
      { layer: first.title, key: name(ws.keys[2].id), parked: false },
      { layer: second.title, key: name(ws.keys[1].id), parked: false },
      { layer: second.title, key: name(ws.keys[4].id), parked: false },
      { layer: third.title, key: name(ws.keys[3].id), parked: true },
    ])
    expect(keysUsing(ws, 'Nothing')).toEqual([])
  })
})
