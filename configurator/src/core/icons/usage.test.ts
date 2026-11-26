import { describe, expect, it } from 'vitest'
import { readRepoText } from '../../../test/repo'
import { parseConfig } from '../config/parse'
import { padSizes, setUsage } from './usage'

const example = () => parseConfig(readRepoText('config.json'), 'config.json')

describe('where an icon set is used', () => {
  it('lists the layers and the sizes of the keys they sit on', () => {
    const use = setUsage(example(), 'media')
    expect(use.layers).toEqual([{ title: 'Media', key: 'k1', size: '1x1' }])
    expect(use.sizes).toContain('1x1')
  })

  it('finds a layer on a tall key, a parked layer and a macro icon', () => {
    const ws = example()
    const tall = ws.keys.find((k) => k.height === 2)!
    const layer = ws.slots[tall.id]
    expect(layer).toBeDefined()
    layer.icon = 'tall_set'
    ws.parked.push({ id: 'P', title: 'Parked', icon: 'tall_set', macros: {}, overflowMacros: [], extra: {} })
    ws.slots.k1.macros.k1.icon = 'tall_set'
    const use = setUsage(ws, 'tall_set')
    expect(use.layers.map((l) => [l.title, l.size])).toEqual([[layer.title, '1x2'], ['Parked', null]])
    expect(use.macros).toEqual([{ layer: ws.slots.k1.title, macro: ws.slots.k1.macros.k1.name, key: 'k1', size: '1x1' }])
    expect(use.sizes).toEqual(['1x1', '1x2'])
  })

  it('is empty for a set nothing uses', () => {
    expect(setUsage(example(), 'nothing')).toEqual({ layers: [], macros: [], sizes: [] })
  })

  it('lists every key size of the pad', () => {
    expect(padSizes(example())).toEqual(['1x1', '2x1', '1x2'])
  })
})
