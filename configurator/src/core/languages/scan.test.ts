import { describe, expect, it, vi } from 'vitest'
import { memoryFolderFromRepo } from '../../../test/repo'
import { MemoryFolder } from '../folder/memory'
import { compareText } from '../folder/path'
import type { FolderAccess } from '../folder/types'
import {
  commandCatalog,
  commandFileAt,
  commandFileNotices,
  commandFilePath,
  definedNames,
  LANGUAGES,
  libraryTitle,
  mergeRescan,
  readCommandFile,
  sameLibrary,
  scanCommands,
  scanLibrary,
  sortCommandFiles,
  withCommandFile,
} from './index'
import type { CommandFile } from './index'

describe('personal files', () => {
  it('skips the include hub and pairs the two languages by file name', async () => {
    const folder = new MemoryFolder('mine', {
      'local/ahk/commands.ahk': '#Include x.ahk\n',
      'local/ahk/x.ahk': 'Hello(Macro) {\n}\n',
      'local/powershell/commands/x.ps1': 'function Hello { param($Macro) }\n',
    })
    const files = await scanCommands(folder)
    expect(files).toHaveLength(2)
    expect(files.map((f) => [f.lang, f.group, f.pair])).toEqual([
      ['ahk', 'yours', 'x'],
      ['ps', 'yours', 'x'],
    ])
    const catalog = commandCatalog(files)
    expect(catalog).toHaveLength(1)
    expect(catalog[0]).toMatchObject({ name: 'Hello', group: 'yours', pair: 'x' })
    expect(Object.keys(catalog[0].in)).toEqual(['ahk', 'ps'])
  })

  it('returns nothing for a folder without commands', async () => {
    expect(await scanCommands(new MemoryFolder('empty'))).toEqual([])
  })

  it('lists yours before shared, merges names ignoring case, and keeps the first description', async () => {
    const folder = new MemoryFolder('mix', {
      'ahk/commands/b.ahk': 'Zed(Macro) {\n}\n',
      'powershell/commands/b.ps1': 'function Zed { param($Macro) }\n',
      'local/ahk/a.ahk': '/**\n * Mine.\n */\nAlpha(Macro) {\n}\n',
      'local/powershell/commands/a.ps1':
        '# Other\nfunction ALPHA { param($Macro) }\nfunction Helper { param($X) }\n',
    })
    const catalog = commandCatalog(await scanCommands(folder))
    expect(catalog.map((e) => [e.group, e.pair, e.name, e.description])).toEqual([
      ['yours', 'a', 'Alpha', 'Mine.'],
      ['shared', 'b', 'Zed', ''],
    ])
    expect(catalog[0].in).toEqual({
      ahk: { path: 'local/ahk/a.ahk', line: 4 },
      ps: { path: 'local/powershell/commands/a.ps1', line: 2 },
    })
  })
})

describe('a file that is not UTF-8', () => {
  it('a command file that is not UTF-8 is scanned but marked not editable', async () => {
    // "Café" in Windows-1252: 0xE9 is not valid UTF-8.
    const latin = new Uint8Array([
      ...new TextEncoder().encode('; Caf'),
      0xe9,
      ...new TextEncoder().encode('\nLatinCmd(Macro) {\n}\n'),
    ])
    const folder = new MemoryFolder('mixed', {
      'ahk/commands/latin.ahk': latin,
      'ahk/commands/plain.ahk': 'PlainCmd(Macro) {\n}\n',
    })
    const files = await scanCommands(folder)
    expect(files.map((f) => [f.file.path, f.editable])).toEqual([
      ['ahk/commands/latin.ahk', false],
      ['ahk/commands/plain.ahk', true],
    ])
    expect(files[0].file.text).toBe('; Caf�\nLatinCmd(Macro) {\n}\n')
    expect(definedNames(files, 'ahk').has('latincmd')).toBe(true)
    expect(commandCatalog(files).map((e) => e.name)).toEqual(['LatinCmd', 'PlainCmd'])
    expect(commandFileNotices(files)).toEqual([
      'ahk/commands/latin.ahk is not UTF-8 text; its commands are listed, but the configurator will not edit it.',
    ])
  })

  it('shows a PowerShell command file that is not UTF-8 as Windows-1252, and still does not edit it', async () => {
    const latin = new Uint8Array([...new TextEncoder().encode('# Caf'), 0xe9, ...new TextEncoder().encode('\nfunction LatinCmd { param($Macro) }\n')])
    const [file] = await scanCommands(new MemoryFolder('ps', { 'powershell/commands/latin.ps1': latin }))
    expect(file.file.text).toBe('# Café\nfunction LatinCmd { param($Macro) }\n')
    expect(file.functions[0].description).toBe('Café')
    expect(file.editable).toBe(false)
  })
})

describe('a PowerShell command defined with a scope', () => {
  it('is defined, under its name without the scope, for the catalog and for the check alike', async () => {
    const files = await scanCommands(new MemoryFolder('scoped', { 'local/powershell/commands/x.ps1': 'function global:OpenIt { param($Macro) }\n' }))
    expect(commandCatalog(files).map((e) => e.name)).toEqual(['OpenIt'])
    expect(definedNames(files, 'ps').has('openit')).toBe(true)
  })
})

describe('shared library', () => {
  const load = () => scanCommands(memoryFolderFromRepo(['ahk/commands', 'powershell/commands']))

  it('has every command in both languages', async () => {
    const files = await load()
    const catalog = commandCatalog(files)
    expect(catalog.length).toBeGreaterThan(100)
    const missing = catalog.filter((e) => !e.in.ahk || !e.in.ps).map((e) => e.name)
    expect(missing).toEqual([])
    expect(catalog.every((e) => e.group === 'shared')).toBe(true)
    // The description is the one the AutoHotkey file gives, as its parser reads it.
    const chrome = files.find((f) => f.file.path === 'ahk/commands/custom/chrome.ahk')!
    const description = LANGUAGES.ahk.findFunctions(chrome.file.text).find((f) => f.name === 'ChromeNewTab')!.description
    expect(description).not.toBe('')
    expect(catalog.find((e) => e.name === 'ChromeNewTab')?.description).toBe(description)
  })

  it('counts helpers like the validator', async () => {
    const files = await load()
    expect(definedNames(files, 'ahk').has('activateoropen')).toBe(true)
    expect(definedNames(files, 'ps').has('activateoropen')).toBe(true)
    expect(definedNames(files, 'ahk').has('chromenewtab')).toBe(true)
  })
})

describe('single command files', () => {
  it('commandFileAt maps the four command folders', () => {
    expect(commandFileAt('local/ahk/x.ahk')).toEqual({ lang: 'ahk', group: 'yours', pair: 'x' })
    expect(commandFileAt('ahk/commands/custom/chrome.ahk')).toEqual({
      lang: 'ahk',
      group: 'shared',
      pair: 'custom/chrome',
    })
    expect(commandFileAt('local/powershell/commands/y.ps1')).toEqual({ lang: 'ps', group: 'yours', pair: 'y' })
    expect(commandFileAt('powershell/commands/z.ps1')).toEqual({ lang: 'ps', group: 'shared', pair: 'z' })
    expect(commandFileAt('local/ahk/commands.ahk')).toBeNull()
    expect(commandFileAt('ahk/config.ahk')).toBeNull()
    expect(commandFileAt('powershell/commands/a.txt')).toBeNull()
  })

  it('commandFilePath is the inverse of commandFileAt', () => {
    expect(commandFilePath('ahk', 'yours', 'x')).toBe('local/ahk/x.ahk')
    expect(commandFilePath('ps', 'shared', 'custom/chrome')).toBe('powershell/commands/custom/chrome.ps1')
  })

  it('readCommandFile reads one file as scanCommands would', async () => {
    const folder = memoryFolderFromRepo(['ahk/commands', 'powershell/commands'])
    const scanned = await scanCommands(folder)
    const path = 'ahk/commands/custom/chrome.ahk'
    expect(await readCommandFile(folder, path)).toEqual(scanned.find((f) => f.file.path === path))
  })

  it('readCommandFile gives null for a missing file and for a path that is not a command file', async () => {
    const folder = new MemoryFolder('mine', {
      'local/ahk/commands.ahk': '#Include x.ahk\n',
      'ahk/config.ahk': 'x := 1\n',
    })
    expect(await readCommandFile(folder, 'local/ahk/gone.ahk')).toBeNull()
    expect(await readCommandFile(folder, 'local/ahk/commands.ahk')).toBeNull()
    expect(await readCommandFile(folder, 'ahk/config.ahk')).toBeNull()
  })
})

describe('keeping the list in step', () => {
  const entry = async (path: string, text: string, version?: string): Promise<CommandFile> => {
    const cf = (await readCommandFile(new MemoryFolder('m', { [path]: text }), path))!
    return version === undefined ? cf : { ...cf, file: { ...cf.file, version } }
  }

  it('sortCommandFiles puts yours first, then pair, then AutoHotkey before PowerShell', async () => {
    const files = [
      await entry('powershell/commands/a.ps1', ''),
      await entry('ahk/commands/a.ahk', ''),
      await entry('local/powershell/commands/z.ps1', ''),
      await entry('local/ahk/z.ahk', ''),
    ]
    expect(sortCommandFiles(files).map((f) => f.file.path)).toEqual([
      'local/ahk/z.ahk',
      'local/powershell/commands/z.ps1',
      'ahk/commands/a.ahk',
      'powershell/commands/a.ps1',
    ])
  })

  it('withCommandFile replaces, inserts in order and removes', async () => {
    const a = await entry('local/ahk/a.ahk', 'A(Macro) {\n}\n')
    const c = await entry('local/ahk/c.ahk', 'C(Macro) {\n}\n')
    const b = await entry('local/ahk/b.ahk', 'B(Macro) {\n}\n')
    const start = [a, c]

    const inserted = withCommandFile(start, b.file.path, b)
    expect(inserted.map((f) => f.pair)).toEqual(['a', 'b', 'c'])
    expect(start.map((f) => f.pair)).toEqual(['a', 'c'])

    const a2 = await entry('local/ahk/a.ahk', 'A2(Macro) {\n}\n')
    const replaced = withCommandFile(inserted, a.file.path, a2)
    expect(replaced.map((f) => f.pair)).toEqual(['a', 'b', 'c'])
    expect(replaced[0].functions.map((f) => f.name)).toEqual(['A2'])

    const removed = withCommandFile(replaced, b.file.path, null)
    expect(removed.map((f) => f.pair)).toEqual(['a', 'c'])
    expect(replaced).toHaveLength(3)
  })

  it('mergeRescan keeps files with unsaved edits and reports their outside changes', async () => {
    const heldA = await entry('local/ahk/a.ahk', 'A(Macro) {\n}\n', 'v1')
    const heldB = await entry('local/ahk/b.ahk', 'B(Macro) {\n}\n', 'v1')
    const freshA = await entry('local/ahk/a.ahk', 'A(Macro) {\n}\n; edited\n', 'v2')
    const freshB = await entry('local/ahk/b.ahk', 'B(Macro) {\n}\n; edited\n', 'v2')
    const freshC = await entry('local/ahk/c.ahk', 'C(Macro) {\n}\n', 'v1')

    const merged = mergeRescan([heldA, heldB], [freshA, freshB, freshC], new Set([heldA.file.path]))
    expect(merged.files).toHaveLength(3)
    expect(merged.files[0]).toBe(heldA)
    expect(merged.files[1]).toBe(freshB)
    expect(merged.files[2]).toBe(freshC)
    expect(merged.changed).toEqual([{ path: 'local/ahk/a.ahk', version: 'v2' }])
  })

  it('mergeRescan does not report a kept file whose version is unchanged', async () => {
    const held = await entry('local/ahk/a.ahk', 'A(Macro) {\n}\n', 'v1')
    const fresh = await entry('local/ahk/a.ahk', 'A(Macro) {\n}\n', 'v1')
    const merged = mergeRescan([held], [fresh], new Set([held.file.path]))
    expect(merged.files).toEqual([held])
    expect(merged.changed).toEqual([])
  })

  it('mergeRescan reports a kept file deleted on disk with a null version', async () => {
    const held = await entry('local/ahk/a.ahk', 'A(Macro) {\n}\n', 'v1')
    const gone = await entry('local/ahk/b.ahk', 'B(Macro) {\n}\n', 'v1')
    const merged = mergeRescan([held, gone], [], new Set([held.file.path]))
    expect(merged.files).toEqual([held])
    expect(merged.changed).toEqual([{ path: 'local/ahk/a.ahk', version: null }])
  })
})

describe('memoryFolderFromRepo', () => {
  it('refuses paths under local/', () => {
    expect(() => memoryFolderFromRepo(['local/config.json'])).toThrow(/local/)
    expect(() => memoryFolderFromRepo(['Local\\ahk'])).toThrow(/local/)
  })
})

/** `inner` with every listing reversed: a real folder lists in its own order, not by name as MemoryFolder does. */
function listedBackwards(inner: FolderAccess): FolderAccess {
  return {
    name: inner.name,
    readBytes: (path) => inner.readBytes(path),
    writeBytes: (path, data) => inner.writeBytes(path, data),
    remove: (path) => inner.remove(path),
    list: async (dir) => (await inner.list(dir)).toReversed(),
  }
}

describe('scanLibrary', () => {
  it('reads the PowerShell library by file name, and nothing of AutoHotkey', async () => {
    const lib = await scanLibrary(listedBackwards(memoryFolderFromRepo(['powershell/lib', 'ahk/lib'])))
    expect(lib.every((f) => f.lang === 'ps')).toBe(true)
    expect(lib.length).toBeGreaterThan(1)
    expect(lib.map((f) => f.name)).toEqual([...lib.map((f) => f.name)].sort(compareText))
    expect(lib.some((f) => f.path.includes('/cs/'))).toBe(false)
    const input = lib.find((f) => f.name === 'Input')!
    expect(input.path).toBe('powershell/lib/Input.ps1')
    expect(input.functions.map((f) => f.name)).toContain('Send-Chord')
  })

  it('sorts the library by name whatever order the folder lists it in', async () => {
    const enc = new TextEncoder()
    const inner = new MemoryFolder('lib', {
      'powershell/lib/Bravo.ps1': enc.encode('function Y {\n}\n'),
      'powershell/lib/Alpha.ps1': enc.encode('function X {\n}\n'),
      'powershell/lib/Charlie.ps1': enc.encode('function Z {\n}\n'),
    })
    expect((await scanLibrary(listedBackwards(inner))).map((f) => f.name)).toEqual(['Alpha', 'Bravo', 'Charlie'])
  })

  it('skips a library file that is gone by the time it is read', async () => {
    const enc = new TextEncoder()
    const folder = new MemoryFolder('lib', {
      'powershell/lib/A.ps1': enc.encode('function X {\n}\n'),
      'powershell/lib/B.ps1': enc.encode('function Y {\n}\n'),
    })
    const read = folder.readBytes.bind(folder)
    const spy = vi.spyOn(folder, 'readBytes').mockImplementation((path) => (path.endsWith('/A.ps1') ? Promise.resolve(null) : read(path)))
    try {
      expect((await scanLibrary(folder)).map((f) => f.name)).toEqual(['B'])
    } finally {
      spy.mockRestore()
    }
  })

  it('gives no library for a folder without one', async () => {
    expect(await scanLibrary(new MemoryFolder('empty', {}))).toEqual([])
  })

  it('titles a file by its first comment line, else by its name', async () => {
    const enc = new TextEncoder()
    const folder = new MemoryFolder('lib', {
      'powershell/lib/A.ps1': enc.encode('# Keys and mouse clicks\n# More.\nfunction X {\n}\n'),
      'powershell/lib/B.ps1': enc.encode('function Y {\n}\n'),
      'powershell/lib/C.ps1': enc.encode('#Requires -Version 5\n'),
      'powershell/lib/D.ps1': enc.encode('<#\n.SYNOPSIS\nA script.\n#>\n'),
      'powershell/lib/notes.txt': enc.encode('# Not a script\n'),
    })
    expect((await scanLibrary(folder)).map((f) => [f.name, f.title])).toEqual([
      ['A', 'Keys and mouse clicks'],
      ['B', 'B'],
      ['C', 'C'],
      ['D', 'D'],
    ])
  })

  it('still reads a library file that is not UTF-8', async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('function Z {\n}\n# caf'), 0xe9, 0x0a])
    const lib = await scanLibrary(new MemoryFolder('lib', { 'powershell/lib/Z.ps1': bytes }))
    expect(lib[0].functions.map((f) => f.name)).toEqual(['Z'])
  })

  it('reads a library file that is not UTF-8 as Windows-1252, as Windows PowerShell does', async () => {
    const bytes = new Uint8Array([...new TextEncoder().encode('# Caf'), 0xe9, ...new TextEncoder().encode('\n\n# Caf'), 0xe9, ...new TextEncoder().encode(' note.\nfunction Z {\n}\n')])
    const lib = await scanLibrary(new MemoryFolder('lib', { 'powershell/lib/Z.ps1': bytes }))
    expect(lib[0].title).toBe('Café')
    expect(lib[0].functions[0].doc.summary).toBe('Café note.')
  })

  it('keeps a held file whose bytes did not change, without reading its functions again', async () => {
    const folder = memoryFolderFromRepo(['powershell/lib'])
    const held = await scanLibrary(folder)
    await folder.writeBytes('powershell/lib/Input.ps1', new TextEncoder().encode('# Changed\nfunction Get-New {\n}\n'))
    const parse = vi.spyOn(LANGUAGES.ps, 'findFunctions')
    const fresh = await scanLibrary(folder, held)
    expect(parse.mock.calls).toHaveLength(1)
    parse.mockRestore()
    expect(fresh.filter((f) => held.includes(f))).toHaveLength(held.length - 1)
    expect(fresh.find((f) => f.name === 'Input')!.title).toBe('Changed')
  })

  it('sameLibrary compares paths and versions', async () => {
    const a = await scanLibrary(memoryFolderFromRepo(['powershell/lib']))
    expect(sameLibrary(a, [...a])).toBe(true)
    expect(sameLibrary(a, a.slice(1))).toBe(false)
    expect(sameLibrary(a, [{ ...a[0], version: 'other' }, ...a.slice(1)])).toBe(false)
  })
})

describe('libraryTitle', () => {
  it('drops every leading comment mark and the spaces around them, in either language', () => {
    expect(libraryTitle('ps', '## Keys\n', 'N')).toBe('Keys')
    expect(libraryTitle('ps', '  #   Keys  \n', 'N')).toBe('Keys')
    expect(libraryTitle('ahk', ';; Keys\n', 'N')).toBe('Keys')
    expect(libraryTitle('ahk', '# Keys\n', 'N')).toBe('N')
  })

  it('falls back to the name for a mark alone, #region, #endregion and an empty file', () => {
    expect(libraryTitle('ps', '#\n', 'N')).toBe('N')
    expect(libraryTitle('ps', '#Region Keys\n', 'N')).toBe('N')
    expect(libraryTitle('ps', '#endregion\n', 'N')).toBe('N')
    expect(libraryTitle('ps', '', 'N')).toBe('N')
  })
})
