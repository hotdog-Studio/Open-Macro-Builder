import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PathError } from '../src/core/folder/path'
import { NodeFolder } from './nodeFolder'

const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null)

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'omb-node-folder-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('NodeFolder', () => {
  it('reads, writes, lists and removes', async () => {
    const folder = new NodeFolder(root)
    expect(folder.name).toBe(basename(root))
    expect(await folder.readBytes('config.json')).toBeNull()
    expect(await folder.list('')).toEqual([])
    expect(await folder.list('missing')).toEqual([])

    await folder.writeBytes('config.json', bytes('{}\n'))
    await folder.writeBytes('img/a.png', bytes('png'))
    const read = await folder.readBytes('config.json')
    expect(read).toBeInstanceOf(Uint8Array)
    expect(text(read)).toBe('{}\n')
    expect(text(await folder.readBytes('img\\a.png'))).toBe('png')
    expect(await readFile(join(root, 'config.json'), 'utf8')).toBe('{}\n')

    await folder.writeBytes('config.json', bytes('{"a":1}'))
    expect(text(await folder.readBytes('./config.json'))).toBe('{"a":1}')

    expect(await folder.list('')).toEqual([
      { name: 'config.json', kind: 'file' },
      { name: 'img', kind: 'dir' },
    ])
    expect(await folder.list('img')).toEqual([{ name: 'a.png', kind: 'file' }])

    await folder.remove('config.json')
    expect(await folder.readBytes('config.json')).toBeNull()
    await expect(folder.remove('config.json')).resolves.toBeUndefined()
    await expect(folder.remove('nowhere/x.txt')).resolves.toBeUndefined()
  })

  it('writes atomically and leaves no temporary file', async () => {
    const folder = new NodeFolder(root)
    await writeFile(join(root, 'config.json'), 'old')
    await folder.writeBytes('config.json', bytes('new'))
    expect(await readFile(join(root, 'config.json'), 'utf8')).toBe('new')
    expect(await readdir(root)).toEqual(['config.json'])

    // A rename that cannot replace its target (a folder) fails the write and
    // still removes the temporary file.
    await mkdir(join(root, 'taken'))
    await expect(folder.writeBytes('taken', bytes('x'))).rejects.toThrow()
    expect((await readdir(root)).sort()).toEqual(['config.json', 'taken'])
  })

  it('refuses paths outside the folder', async () => {
    const folder = new NodeFolder(root)
    await expect(folder.readBytes('../x')).rejects.toBeInstanceOf(PathError)
    await expect(folder.readBytes('C:/x')).rejects.toBeInstanceOf(PathError)
    await expect(folder.writeBytes('../x', bytes('x'))).rejects.toBeInstanceOf(PathError)
    await expect(folder.writeBytes('C:/x', bytes('x'))).rejects.toBeInstanceOf(PathError)
    await expect(folder.list('..')).rejects.toBeInstanceOf(PathError)
    await expect(folder.remove('a/../../x')).rejects.toBeInstanceOf(PathError)
    await expect(folder.readBytes('/etc/passwd')).rejects.toBeInstanceOf(PathError)
  })

  it('creates parent folders', async () => {
    const folder = new NodeFolder(root)
    await folder.writeBytes('local/deep/config.json', bytes('{}'))
    expect(await readFile(join(root, 'local', 'deep', 'config.json'), 'utf8')).toBe('{}')
    expect(await folder.list('local')).toEqual([{ name: 'deep', kind: 'dir' }])
  })
})
