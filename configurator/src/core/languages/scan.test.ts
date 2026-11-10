import { describe, expect, it } from 'vitest'
import { memoryFolderFromRepo } from '../../../test/repo'
import { MemoryFolder } from '../folder/memory'
import { commandCatalog, definedNames, scanCommands } from './index'

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

describe('memoryFolderFromRepo', () => {
  it('refuses paths under local/', () => {
    expect(() => memoryFolderFromRepo(['local/config.json'])).toThrow(/local/)
    expect(() => memoryFolderFromRepo(['Local\\ahk'])).toThrow(/local/)
  })
})
