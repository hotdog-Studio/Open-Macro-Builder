import { describe, expect, it } from 'vitest'
import { MemoryFolder } from '../folder/memory'
import { MANIFEST_PATH, readManifest, writeManifest, type Manifest } from './manifest'

const good: Manifest = {
  version: '1.0.6',
  files: { 'ahk/main.ahk': 'a'.repeat(64), 'config.json': 'b'.repeat(64) },
  deleted: ['ahk/commands/lock.ahk'],
  offered: { 'ahk/config.ahk': 'c'.repeat(64) },
}

const folderHolding = (text: string) => new MemoryFolder('x', { [MANIFEST_PATH]: text })

describe('readManifest', () => {
  it('gives null when there is no manifest', async () => {
    expect(await readManifest(new MemoryFolder('x'))).toBeNull()
  })

  it.each([
    ['text that is not JSON', 'not json {'],
    ['an empty file', ''],
    ['JSON null', 'null'],
    ['a JSON array', '[]'],
    ['a JSON number', '7'],
    ['no version', '{ "files": {} }'],
    ['a version that is not text', '{ "version": 1, "files": {} }'],
    ['no files', '{ "version": "1.0.6" }'],
    ['files that are an array', '{ "version": "1.0.6", "files": [] }'],
    ['files that are null', '{ "version": "1.0.6", "files": null }'],
    ['a files value that is not text', '{ "version": "1.0.6", "files": { "a": 1 } }'],
    ['deleted that is not a list of text', '{ "version": "1.0.6", "files": {}, "deleted": [1] }'],
    ['deleted that is not a list', '{ "version": "1.0.6", "files": {}, "deleted": "a" }'],
    ['deleted that is null', '{ "version": "1.0.6", "files": {}, "deleted": null }'],
    ['offered that is null', '{ "version": "1.0.6", "files": {}, "offered": null }'],
    ['an offered value that is not text', '{ "version": "1.0.6", "files": {}, "offered": { "a": false } }'],
    ['offered that is an array', '{ "version": "1.0.6", "files": {}, "offered": [] }'],
  ])('gives null for %s', async (_name, text) => {
    expect(await readManifest(folderHolding(text))).toBeNull()
  })

  it('gives null for bytes that are not UTF-8 text', async () => {
    const folder = new MemoryFolder('x', { [MANIFEST_PATH]: new Uint8Array([0xff, 0xfe, 0x00, 0x7b]) })
    expect(await readManifest(folder)).toBeNull()
  })

  it('gives back what writeManifest wrote', async () => {
    const folder = new MemoryFolder('x')
    await writeManifest(folder, good)
    expect(await readManifest(folder)).toEqual(good)
  })

  it('lets deleted and offered default to empty when the file has none', async () => {
    const folder = folderHolding('{ "version": "1.0.6", "files": { "a": "f" } }')
    expect(await readManifest(folder)).toEqual({ version: '1.0.6', files: { a: 'f' }, deleted: [], offered: {} })
  })

  it('rejects when the folder cannot be read', async () => {
    class Unreadable extends MemoryFolder {
      override readBytes(): Promise<Uint8Array | null> {
        return Promise.reject(new Error('no access'))
      }
    }
    await expect(readManifest(new Unreadable('x'))).rejects.toThrow('no access')
  })
})

describe('writeManifest', () => {
  it('writes JSON indented by two spaces, a final newline, the paths sorted', async () => {
    const folder = new MemoryFolder('x')
    await writeManifest(folder, {
      version: '1.0.6',
      files: { 'img/b.png': 'f2', 'ahk/main.ahk': 'f1', 'Zed.txt': 'f0' },
      deleted: ['ahk/commands/z.ahk', 'ahk/commands/a.ahk'],
      offered: { 'powershell/b.ps1': 'o2', 'ahk/a.ahk': 'o1' },
    })
    expect(folder.text(MANIFEST_PATH)).toBe(
      [
        '{',
        '  "version": "1.0.6",',
        '  "files": {',
        '    "Zed.txt": "f0",',
        '    "ahk/main.ahk": "f1",',
        '    "img/b.png": "f2"',
        '  },',
        '  "deleted": [',
        '    "ahk/commands/a.ahk",',
        '    "ahk/commands/z.ahk"',
        '  ],',
        '  "offered": {',
        '    "ahk/a.ahk": "o1",',
        '    "powershell/b.ps1": "o2"',
        '  }',
        '}',
        '',
      ].join('\n'),
    )
  })

  it('replaces the manifest that is there', async () => {
    const folder = folderHolding('{}')
    await writeManifest(folder, good)
    expect(await readManifest(folder)).toEqual(good)
  })
})
