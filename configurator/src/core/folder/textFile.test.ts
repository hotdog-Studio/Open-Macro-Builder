import { describe, expect, it } from 'vitest'
import { MemoryFolder } from './memory'
import {
  ConflictError,
  currentVersion,
  EncodingError,
  newTextFile,
  readTextFile,
  writeTextFile,
} from './textFile'

const bytes = (s: string) => new TextEncoder().encode(s)

describe('text files', () => {
  it('keeps CRLF and a BOM through a round trip', async () => {
    const raw = '﻿a\r\nb'
    const folder = new MemoryFolder('demo', { 'f.txt': raw })
    const file = await readTextFile(folder, 'f.txt')
    expect(file).not.toBeNull()
    expect(file!.text).toBe('a\nb')
    expect(file!.eol).toBe('\r\n')
    expect(file!.bom).toBe(true)
    await writeTextFile(folder, file!)
    expect(await folder.readBytes('f.txt')).toEqual(bytes(raw))
  })

  it('keeps a missing final newline', async () => {
    const folder = new MemoryFolder('demo', { 'f.txt': 'x\ny' })
    const file = await readTextFile(folder, 'f.txt')
    expect(file!.eol).toBe('\n')
    expect(file!.bom).toBe(false)
    await writeTextFile(folder, file!)
    expect(await folder.readBytes('f.txt')).toEqual(bytes('x\ny'))
  })

  it('refuses a file that is not UTF-8', async () => {
    const latin = new Uint8Array([0x66, 0x6f, 0xe9, 0x0a])
    const folder = new MemoryFolder('demo', { 'f.txt': latin })
    const err = await readTextFile(folder, 'f.txt').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EncodingError)
    expect((err as EncodingError).path).toBe('f.txt')
    expect((err as EncodingError).message).toBe(
      'f.txt is not UTF-8 text, so the configurator will not edit it.',
    )
    expect(await folder.readBytes('f.txt')).toEqual(latin)
  })

  it('keeps a second BOM', async () => {
    const raw = new Uint8Array([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x61])
    const folder = new MemoryFolder('demo', { 'f.txt': raw })
    const file = (await readTextFile(folder, 'f.txt'))!
    expect(file.bom).toBe(true)
    await writeTextFile(folder, file)
    expect(await folder.readBytes('f.txt')).toEqual(raw)
  })

  it('returns null for a missing file', async () => {
    const folder = new MemoryFolder('demo')
    expect(await readTextFile(folder, 'nope.txt')).toBeNull()
    expect(await currentVersion(folder, 'nope.txt')).toBeNull()
  })

  it('creates a new file and returns its version', async () => {
    const folder = new MemoryFolder('demo')
    const made = newTextFile('n/new.txt', 'a\nb')
    expect(made).toEqual({ path: 'n/new.txt', text: 'a\nb', eol: '\n', bom: false, version: null })
    const saved = await writeTextFile(folder, made)
    expect(saved.version).toBe(await currentVersion(folder, 'n/new.txt'))
    expect(saved.version).toMatch(/^[0-9a-f]{64}$/)
    expect(folder.text('n/new.txt')).toBe('a\nb')
  })

  it('refuses to overwrite an outside change', async () => {
    const folder = new MemoryFolder('demo', { 'f.txt': 'one' })
    const file = (await readTextFile(folder, 'f.txt'))!
    const saved = await writeTextFile(folder, { ...file, text: 'two' })
    await folder.writeBytes('f.txt', bytes('edited elsewhere'))
    const err = await writeTextFile(folder, { ...saved, text: 'three' }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ConflictError)
    expect((err as ConflictError).path).toBe('f.txt')
    expect(folder.text('f.txt')).toBe('edited elsewhere')
    await writeTextFile(folder, { ...saved, text: 'three' }, { force: true })
    expect(folder.text('f.txt')).toBe('three')
  })

  it('refuses to create a file that appeared meanwhile', async () => {
    const folder = new MemoryFolder('demo', { 'f.txt': 'already here' })
    await expect(writeTextFile(folder, newTextFile('f.txt', 'mine'))).rejects.toBeInstanceOf(
      ConflictError,
    )
    expect(folder.text('f.txt')).toBe('already here')
  })
})
