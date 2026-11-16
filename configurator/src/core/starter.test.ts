import { describe, expect, it } from 'vitest'
import { MemoryFolder } from './folder/memory'
import { StarterError, writeStarter } from './starter'

const bytes = (s: string) => new TextEncoder().encode(s)
const FILES = [
  { path: 'config.json', data: bytes('{}') },
  { path: 'ahk/main.ahk', data: bytes('a') },
  { path: 'img/x/layer.png', data: new Uint8Array([1, 2, 3]) },
]

describe('writeStarter', () => {
  it('writes every file, byte for byte', async () => {
    const folder = new MemoryFolder('new')
    await writeStarter(folder, FILES)
    for (const file of FILES) expect(await folder.readBytes(file.path)).toEqual(file.data)
  })

  it('writes config.json last', async () => {
    const written: string[] = []
    class Recording extends MemoryFolder {
      override writeBytes(path: string, data: Uint8Array): Promise<void> {
        written.push(path)
        return super.writeBytes(path, data)
      }
    }
    await writeStarter(new Recording('new'), FILES)
    expect(written).toHaveLength(FILES.length)
    expect(written[written.length - 1]).toBe('config.json')
  })

  it('refuses a folder that holds anything, and writes nothing', async () => {
    const folder = new MemoryFolder('x', { 'notes.txt': bytes('mine') })
    await expect(writeStarter(folder, FILES)).rejects.toThrow(StarterError)
    expect((await folder.list('')).map((e) => e.name)).toEqual(['notes.txt'])
  })

  it('stops without config.json when a write fails part-way', async () => {
    class Failing extends MemoryFolder {
      private calls = 0
      override writeBytes(path: string, data: Uint8Array): Promise<void> {
        this.calls += 1
        if (this.calls === 2) return Promise.reject(new Error('disk full'))
        return super.writeBytes(path, data)
      }
    }
    const failing = new Failing('new')
    await expect(writeStarter(failing, FILES)).rejects.toThrow('disk full')
    expect(await failing.readBytes('config.json')).toBeNull()
  })

  it('does not replace a file that appeared meanwhile', async () => {
    const other = bytes('other')
    class Racing extends MemoryFolder {
      private first = true
      override async writeBytes(path: string, data: Uint8Array): Promise<void> {
        await super.writeBytes(path, data)
        if (this.first) {
          this.first = false
          await super.writeBytes('img/x/layer.png', other)
        }
      }
    }
    const racing = new Racing('new')
    await expect(writeStarter(racing, FILES)).rejects.toThrow(StarterError)
    expect(await racing.readBytes('img/x/layer.png')).toEqual(other)
    expect(await racing.readBytes('config.json')).toBeNull()
  })
})
