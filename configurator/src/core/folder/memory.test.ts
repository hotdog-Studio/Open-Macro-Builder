import { describe, expect, it } from 'vitest'
import { MemoryFolder } from './memory'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('MemoryFolder', () => {
  it('lists the folders implied by a nested write', async () => {
    const folder = new MemoryFolder('demo')
    await folder.writeBytes('a/b/c.txt', bytes('hi'))
    expect(await folder.list('a')).toEqual([{ name: 'b', kind: 'dir' }])
    expect(await folder.list('a/b')).toEqual([{ name: 'c.txt', kind: 'file' }])
    expect(await folder.list('')).toEqual([{ name: 'a', kind: 'dir' }])
  })

  it('returns null for a missing file and [] for a missing folder', async () => {
    const folder = new MemoryFolder('demo')
    expect(await folder.readBytes('missing')).toBeNull()
    expect(await folder.list('nope')).toEqual([])
  })

  it('resolves when removing a missing file', async () => {
    const folder = new MemoryFolder('demo')
    await expect(folder.remove('missing')).resolves.toBeUndefined()
  })

  it('reads back seeded and written content', async () => {
    const folder = new MemoryFolder('demo', { 'x.txt': 'one', 'y/z.bin': new Uint8Array([1, 2]) })
    expect(folder.name).toBe('demo')
    expect(folder.text('x.txt')).toBe('one')
    expect(await folder.readBytes('y/z.bin')).toEqual(new Uint8Array([1, 2]))
    await folder.writeBytes('x.txt', bytes('two'))
    expect(folder.text('x.txt')).toBe('two')
    await folder.remove('x.txt')
    expect(folder.text('x.txt')).toBeNull()
  })

  it('normalises paths and rejects unsafe ones', async () => {
    const folder = new MemoryFolder('demo', { 'a/b.txt': 'x' })
    expect(await folder.readBytes('a\\.\\b.txt')).not.toBeNull()
    await expect(folder.readBytes('../b.txt')).rejects.toThrow()
  })
})
