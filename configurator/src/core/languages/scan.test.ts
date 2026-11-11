import { describe, expect, it } from 'vitest'
import { memoryFolderFromRepo } from '../../../test/repo'
import { MemoryFolder } from '../folder/memory'
import {
  commandCatalog,
  commandFileAt,
  commandFileNotices,
  commandFilePath,
  definedNames,
  mergeRescan,
  readCommandFile,
  scanCommands,
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
})

describe('shared library', () => {
  const load = () => scanCommands(memoryFolderFromRepo(['ahk/commands', 'powershell/commands']))

  it('has every command in both languages', async () => {
    const catalog = commandCatalog(await load())
    expect(catalog.length).toBeGreaterThan(100)
    const missing = catalog.filter((e) => !e.in.ahk || !e.in.ps).map((e) => e.name)
    expect(missing).toEqual([])
    expect(catalog.every((e) => e.group === 'shared')).toBe(true)
    expect(catalog.find((e) => e.name === 'ChromeNewTab')?.description).toBe(
      'Opens a new tab in Google Chrome.',
    )
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
