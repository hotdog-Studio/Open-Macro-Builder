import { describe, expect, it } from 'vitest'
import { commandFileAt, libraryTitle, LANGUAGES, type CommandFile, type LibraryFile } from '../languages'
import { newTextFile } from '../folder/textFile'
import { buildDictionary, filterSections, listSections, nameAt, sourceText, type DictInput, type ListSections } from './dictionary'

function cmd(path: string, text: string): CommandFile {
  const at = commandFileAt(path)!
  return {
    ...at,
    file: { ...newTextFile(path, text), version: 'v1' },
    functions: LANGUAGES[at.lang].findFunctions(text),
    editable: true,
  }
}

function lib(name: string, text: string): LibraryFile {
  return {
    lang: 'ps',
    path: `powershell/lib/${name}.ps1`,
    name,
    title: libraryTitle('ps', text, name),
    version: 'v1',
    functions: LANGUAGES.ps.findFunctions(text),
  }
}

const HELPER_PS = cmd('powershell/commands/helper.ps1',
  '<#\n.SYNOPSIS\nSwitches to a program.\n#>\nfunction ActivateOrOpen {\n    param([string]$Exe)\n}\n' +
  '# A plain note.\nfunction Get-Private {\n}\nfunction Message {\n    param($Macro)\n}\n')
const MINE_PS = cmd('local/powershell/commands/mine.ps1',
  '<#\n.SYNOPSIS\nMine.\n#>\nfunction ActivateOrOpen {\n    param([string]$Exe)\n}\nfunction OpenMine {\n    param($Macro)\n}\n')
const WIN_PS = cmd('powershell/commands/windows.ps1', 'function OpenThing {\n    param($Macro)\n}\n')
const WIN_AHK = cmd('ahk/commands/windows.ahk', '/**\n * Opens the thing.\n */\nOpenThing(Macro)\n{\n}\n')
const SOUND = lib('Sound', '# Sound volume\n\n<#\n.SYNOPSIS\nSets the volume of the speakers.\n#>\nfunction Set-SoundVolume {\n    param([int]$Percent)\n}\n\n# Internal.\nfunction ConvertTo-VolumeLevel {\n}\n')
const input = (over: Partial<DictInput> = {}): DictInput => ({
  lang: 'ps', shown: WIN_PS.file.path, commandFiles: [MINE_PS, HELPER_PS, WIN_AHK, WIN_PS], libraryFiles: [SOUND], drafts: {}, ...over,
})

describe('buildDictionary', () => {
  it('finds a name whatever its case, the owner\'s definition first', () => {
    // The shared file comes first in the input, so only the yours-before-shared order picks the owner's.
    const hit = buildDictionary(input({ commandFiles: [HELPER_PS, MINE_PS, WIN_AHK, WIN_PS] })).lookup('activateoropen')!
    expect(hit.source).toEqual({ kind: 'file', path: 'local/powershell/commands/mine.ps1', line: 5 })
    expect(hit.summary).toBe('Mine.')
  })

  it('resolves the shown file before every other', () => {
    const shown = cmd('powershell/commands/windows.ps1', 'function ActivateOrOpen {\n}\n')
    const dict = buildDictionary(input({ commandFiles: [MINE_PS, HELPER_PS, shown] }))
    expect(dict.lookup('ActivateOrOpen')!.group.kind).toBe('shown')
  })

  it('holds only the shown language', () => {
    expect(buildDictionary(input()).entries.every((e) => e.lang === 'ps')).toBe(true)
  })

  it('follows unsaved text, of the shown file and of another', () => {
    const dict = buildDictionary(input({
      drafts: {
        [WIN_PS.file.path]: WIN_PS.file.text + 'function Get-Typed {\n}\n',
        [HELPER_PS.file.path]: 'function Get-Elsewhere {\n}\n',
      },
    }))
    expect(dict.lookup('Get-Typed')!.source.line).toBe(4)
    expect(dict.lookup('Get-Elsewhere')).toBeDefined()
    expect(dict.lookup('Get-Private')).toBeUndefined()
  })

  it('gives a command without docs its twin\'s summary, and says whose', () => {
    expect(buildDictionary(input()).lookup('OpenThing')).toMatchObject({ summary: 'Opens the thing.', borrowed: 'ahk', command: true })
    expect(buildDictionary(input()).lookup('Message')).toMatchObject({ summary: '', borrowed: null })
  })

  it('reads the twin from its unsaved text', () => {
    const dict = buildDictionary(input({
      drafts: { [WIN_AHK.file.path]: '/**\n * Typed just now.\n */\nOpenThing(Macro)\n{\n}\n' },
    }))
    expect(dict.lookup('OpenThing')).toMatchObject({ summary: 'Typed just now.', borrowed: 'ahk' })
  })

  it('names the group of each entry', () => {
    const dict = buildDictionary(input())
    expect(dict.lookup('OpenThing')!.group).toEqual({ key: 'shown', kind: 'shown', label: 'windows', file: null })
    expect(dict.lookup('OpenMine')!.group).toEqual({ key: 'yours:mine', kind: 'yours', label: 'mine', file: null })
    expect(dict.lookup('Message')!.group).toEqual({ key: 'shared:helper', kind: 'shared', label: 'helper', file: null })
    expect(dict.lookup('Set-SoundVolume')!.group).toEqual({
      key: 'library:powershell/lib/Sound.ps1', kind: 'library', label: 'Sound volume', file: 'lib/Sound',
    })
  })

  it('keeps every definition of a name in the entries', () => {
    const dict = buildDictionary(input())
    expect(dict.entries.filter((e) => e.fn.name === 'ActivateOrOpen')).toHaveLength(2)
  })
})

describe('listSections', () => {
  it('lists documented functions, then the commands of other files', () => {
    const { functions, commands } = listSections(buildDictionary(input()))
    expect(functions.map((g) => [g.group.label, g.group.file, g.entries.map((e) => e.fn.name)])).toEqual([
      ['mine', null, ['ActivateOrOpen']],
      ['helper', null, ['ActivateOrOpen']],
      ['Sound volume', 'lib/Sound', ['Set-SoundVolume']],
    ])
    expect(commands.map((g) => [g.group.label, g.entries.map((e) => e.fn.name)])).toEqual([
      ['mine', ['OpenMine']],
      ['helper', ['Message']],
    ])
  })

  it('lists the shown file\'s own documented functions first', () => {
    const shown = cmd('powershell/commands/windows.ps1', '<#\n.SYNOPSIS\nLocal tool.\n#>\nfunction Get-Local {\n}\n')
    const { functions } = listSections(buildDictionary(input({ commandFiles: [HELPER_PS, shown] })))
    expect(functions[0]).toMatchObject({ group: { kind: 'shown', label: 'windows' } })
  })
})

describe('filterSections', () => {
  it('filters by name or summary as plain text', () => {
    const all = listSections(buildDictionary(input()))
    const names = (s: ListSections) => [...s.functions, ...s.commands].flatMap((g) => g.entries.map((e) => e.fn.name))
    expect(names(filterSections(all, 'SOUNDV'))).toEqual(['Set-SoundVolume'])
    expect(names(filterSections(all, 'speakers'))).toEqual(['Set-SoundVolume'])
    expect(names(filterSections(all, 'Send-('))).toEqual([])
    expect(names(filterSections(all, '[\\'))).toEqual([])
    expect(filterSections(all, '   ')).toEqual(all)
  })
})

describe('nameAt', () => {
  it('finds the name under a column', () => {
    expect(nameAt("    Send-Chord 'Ctrl+c'", 6, 'ps')).toEqual({ from: 4, to: 14, name: 'Send-Chord' })
    expect(nameAt('    Send-Chord x', 2, 'ps')).toBeNull()
    expect(nameAt('$Macro.Name', 2, 'ps')).toBeNull()
    expect(nameAt('$Macro.Name', 8, 'ps')).toBeNull()
    expect(nameAt('[Macropad.Native]::GetForegroundWindow()', 22, 'ps')).toBeNull()
    expect(nameAt('ActivateOrOpen("x")', 3, 'ahk')).toEqual({ from: 0, to: 14, name: 'ActivateOrOpen' })
    expect(nameAt('obj.Method()', 6, 'ahk')).toBeNull()
    expect(nameAt('Send-Chord', 2, 'ahk')).toEqual({ from: 0, to: 4, name: 'Send' })
  })

  it('treats the column after a name as outside it', () => {
    expect(nameAt('Send x', 4, 'ahk')).toBeNull()
    expect(nameAt('Send x', 3, 'ahk')).toEqual({ from: 0, to: 4, name: 'Send' })
  })
})

describe('sourceText', () => {
  it('writes where an entry is defined', () => {
    expect(sourceText({ kind: 'file', path: 'powershell/lib/Input.ps1', line: 79 })).toBe('powershell/lib/Input.ps1 · line 79')
  })
})
