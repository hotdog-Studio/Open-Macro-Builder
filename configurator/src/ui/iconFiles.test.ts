import { describe, expect, it, vi } from 'vitest'
import { MemoryFolder } from '../core/folder/memory'
import { DEFAULT_RECIPE } from '../core/icons/recipe'
import { planFiles, writePlanned, type PlannedFile } from './iconFiles'

// No canvas here: an encoded PNG is two bytes holding the picture's size.
vi.mock('./iconCodec', () => ({
  decodePng: vi.fn(),
  encodePng: vi.fn(async (image: { width: number; height: number }) => new Uint8Array([image.width, image.height])),
}))

const picture = { width: 2, height: 3, data: new Uint8ClampedArray(24) }

describe('planFiles', () => {
  it('says which files are there, and counts one that cannot be read as there', async () => {
    const folder = new MemoryFolder('r', { 'img/x/macro.png': 'old', 'img/x/selected.png': 'locked' })
    const readBytes = folder.readBytes.bind(folder)
    folder.readBytes = async (path: string) => {
      if (path.endsWith('selected.png')) throw new Error('locked by another program')
      return readBytes(path)
    }
    const pictures = new Map([
      ['layer.png', picture],
      ['macro.png', picture],
      ['selected.png', picture],
    ])
    const files = await planFiles(folder, 'img/x', pictures, { source: picture, recipe: DEFAULT_RECIPE })
    expect(files.map((f) => [f.path, f.replaces])).toEqual([
      ['img/x/layer.png', false],
      ['img/x/macro.png', true],
      ['img/x/selected.png', true],
      ['img/x/source.png', false],
      ['img/x/icon.json', false],
    ])
    expect([...files[0].bytes]).toEqual([2, 3])
  })
})

describe('writePlanned', () => {
  it("writes a set's layer.png last, so a failed write never leaves a set the macropads would load half made", async () => {
    const folder = new MemoryFolder('r', {})
    const order: string[] = []
    const writeBytes = folder.writeBytes.bind(folder)
    folder.writeBytes = async (path: string, data: Uint8Array) => {
      order.push(path)
      return writeBytes(path, data)
    }
    const file = (path: string): PlannedFile => ({ path, bytes: new Uint8Array([1]), replaces: false })
    await writePlanned(folder, [file('img/x/layer.png'), file('img/x/macro.png'), file('img/x/icon.json')])
    expect(order.at(-1)).toBe('img/x/layer.png')
    expect(order).toHaveLength(3)
  })
})
