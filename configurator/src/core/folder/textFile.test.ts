import { describe, expect, it } from 'vitest'
import { MemoryFolder } from './memory'
import {
  ConflictError,
  currentVersion,
  EncodingError,
  keepEndings,
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

describe('saving a file with both kinds of line ending', () => {
  // ignoreBOM keeps a byte-order mark in the string, so a test sees the bytes that were written.
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  const save = async (before: string, edit: (text: string) => string) => {
    const folder = new MemoryFolder('demo', { 'x.ahk': before })
    const file = (await readTextFile(folder, 'x.ahk'))!
    const written = await writeTextFile(folder, { ...file, text: edit(file.text) })
    return { written, bytes: decoder.decode((await folder.readBytes('x.ahk'))!) }
  }

  it('keeps every untouched line of a mixed file byte for byte', async () => {
    expect((await save('a\r\nb\nc\r\nd\n', (t) => t.replace('c', 'C'))).bytes).toBe('a\r\nb\nC\r\nd\n')
  })

  it('gives a line added in the middle the ending most of the file has', async () => {
    expect((await save('a\r\nb\r\nc\nd\r\n', (t) => t.replace('b\n', 'b\nnew\n'))).bytes).toBe('a\r\nb\r\nnew\r\nc\nd\r\n')
    expect((await save('a\nb\nc\r\nd\n', (t) => t.replace('b\n', 'b\nnew\n'))).bytes).toBe('a\nb\nnew\nc\r\nd\n')
  })

  it('writes a mixed file back unchanged when nothing was edited', async () => {
    expect((await save('a\r\nb\nc', (t) => t)).bytes).toBe('a\r\nb\nc')
  })

  it('compares the next save with what the last one wrote', async () => {
    const { written } = await save('a\r\nb\n', (t) => t.replace('a', 'A'))
    expect(written.original).toBe('A\r\nb\n')
  })

  it('keeps the untouched lines of a second save made on the first one', async () => {
    const folder = new MemoryFolder('demo', { 'x.ahk': 'a\nb\nc\r\nd\n' })
    const first = await writeTextFile(folder, { ...(await readTextFile(folder, 'x.ahk'))!, text: 'A\nb\nc\nd\n' })
    expect(folder.text('x.ahk')).toBe('A\nb\nc\r\nd\n')
    await writeTextFile(folder, { ...first, text: first.text.replace('d', 'D') })
    expect(folder.text('x.ahk')).toBe('A\nb\nc\r\nD\n')
  })

  it.each(['a\nb\n', 'a\r\nb\r\n'])('leaves a file with one kind of ending as it was written before', async (before) => {
    const { written, bytes } = await save(before, (t) => `${t}c\n`)
    expect(bytes).toBe(`${before}${before.includes('\r') ? 'c\r\n' : 'c\n'}`)
    expect(written.original).toBeUndefined()
  })

  it('remembers the original only for a file that has both kinds', async () => {
    const folder = new MemoryFolder('demo', { 'm.txt': 'a\r\nb\n', 'c.txt': 'a\r\nb\r\n', 'l.txt': 'a\nb\n', 'n.txt': 'ab' })
    expect((await readTextFile(folder, 'm.txt'))!.original).toBe('a\r\nb\n')
    for (const path of ['c.txt', 'l.txt', 'n.txt']) expect((await readTextFile(folder, path))!.original).toBeUndefined()
  })

  it.each([
    ['a\r\nb\r\nc\n', '\r\n'],
    ['a\r\nb\nc\n', '\n'],
    ['a\r\nb\n', '\r\n'],
  ])('gives %j the ending most of its lines have, a tie going to CRLF', async (before, eol) => {
    expect((await readTextFile(new MemoryFolder('demo', { 'x.ahk': before }), 'x.ahk'))!.eol).toBe(eol)
  })

  it('keeps the original while the file is still mixed, and drops it once it is not', async () => {
    const still = await save('a\r\nb\nc\nd\r\n', (t) => t.replace('a', 'A'))
    expect(still.written.original).toBe('A\r\nb\nc\nd\r\n')
    const edited = await save('a\r\nb\nc\r\n', (t) => t.replace('b', 'B'))
    expect(edited.bytes).toBe('a\r\nB\r\nc\r\n')
    expect(edited.written.original).toBeUndefined()
    const crlf = await save('a\r\nb\nc\r\n', () => 'x\ny\nz\n')
    expect(crlf.bytes).toBe('x\r\ny\r\nz\r\n')
    expect(crlf.written.original).toBeUndefined()
    expect(crlf.written.eol).toBe('\r\n')
    const lf = await save('a\r\nb\nc\n', (t) => t.replace('a', 'x\ny'))
    expect(lf.bytes).toBe('x\ny\nb\nc\n')
    expect(lf.written.original).toBeUndefined()
    expect(lf.written.eol).toBe('\n')
  })

  it('keeps a byte-order mark, and leaves it out of the original', async () => {
    const { bytes, written } = await save('\u{feff}a\r\nb\nc\nd\r\n', (t) => t.replace('a', 'A'))
    expect(bytes).toBe('\u{feff}A\r\nb\nc\nd\r\n')
    expect(written.original).toBe('A\r\nb\nc\nd\r\n')
  })

  it('saves a mixed file that has a line deleted in the middle', async () => {
    expect((await save('a\r\nb\nc\r\nd\n', (t) => t.replace('b\n', ''))).bytes).toBe('a\r\nc\r\nd\n')
  })

  it('writes the last line edited of a file that does not end in a new line without one', async () => {
    expect((await save('a\r\nb\nc', (t) => t.replace('c', 'C'))).bytes).toBe('a\r\nb\nC')
  })

  it('ends the line a new last line follows, and leaves the new one without an ending', async () => {
    expect((await save('a\r\nb\nc', (t) => `${t}\nd`)).bytes).toBe('a\r\nb\nc\r\nd')
    expect((await save('a\nb\r\nc\nd', (t) => `${t}\ne`)).bytes).toBe('a\nb\r\nc\nd\ne')
  })

  it('adds a final new line after the last line', async () => {
    expect((await save('a\r\nb\nc', (t) => `${t}\n`)).bytes).toBe('a\r\nb\nc\r\n')
  })

  it('gives every line the common ending when none is shared', async () => {
    expect((await save('a\r\nb\nc\r\n', () => 'x\ny\n')).bytes).toBe('x\r\ny\r\n')
  })

  it('writes a text of nothing for a mixed file', async () => {
    const { bytes, written } = await save('a\r\nb\n', () => '')
    expect(bytes).toBe('')
    expect(written.original).toBeUndefined()
  })

  it('does not double or lose a carriage return when the text has CRLF in it', async () => {
    expect((await save('a\r\nb\nc\n', (t) => t.replace('b\n', 'b\r\nnew\r\n'))).bytes).toBe('a\r\nb\nnew\nc\n')
    expect((await save('a\r\nb\nc\n', (t) => t.replace('c', 'c\rd'))).bytes).toBe('a\r\nb\nc\rd\n')
  })

  it('does not let the shared start and the shared end overlap in lines that repeat', async () => {
    expect((await save('a\nb\r\na\nb\r\n', (t) => t.replace('a', 'A'))).bytes).toBe('A\r\nb\r\na\nb\r\n')
    expect((await save('a\nb\r\na\nb\r\n', (t) => t.replace('a\nb\n', 'a\nb\nb\n'))).bytes).toBe('a\nb\r\nb\r\na\nb\r\n')
    expect((await save('a\r\na\na\r\n', (t) => `a\n${t}`)).bytes).toBe('a\r\na\na\r\na\r\n')
  })
})

describe('keepEndings', () => {
  it.each([
    ['a\r\nb\n', 'a\nb\n', '\n', 'a\r\nb\n'],
    ['a\r\nb\n', 'a\nB\nc\n', '\r\n', 'a\r\nB\r\nc\r\n'],
    ['', 'x', '\n', 'x'],
    ['', 'x\ny\n', '\r\n', 'x\r\ny\r\n'],
    ['a\r\nb\n', '', '\n', ''],
    ['a\nb\r\n', 'a\nb\r\nc', '\n', 'a\nb\r\nc'],
    ['a\nb\r\n', 'a\nx\r\ny\n', '\r\n', 'a\nx\r\ny\r\n'],
  ] as const)('keepEndings(%j, %j, %j) is %j', (original, text, eol, expected) => {
    expect(keepEndings(original, text, eol)).toBe(expected)
  })
})
