import { describe, expect, it, vi } from 'vitest'
import { commandFileAt, libraryTitle, LANGUAGES, type CommandFile, type LibraryFile } from '../languages'
import { newTextFile } from '../folder/textFile'
import {
  buildDictionary,
  filterSections,
  listSections,
  nameAt,
  parseCache,
  sourceText,
  type DictInput,
  type Dictionary,
  type ListSections,
} from './dictionary'
import { readReference, type Reference } from './reference'

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
    // The only library is PowerShell's: shown in AutoHotkey, none of it may come in.
    const ahk = buildDictionary(input({ lang: 'ahk', shown: WIN_AHK.file.path }))
    expect(ahk.entries.length).toBeGreaterThan(0)
    expect(ahk.entries.every((e) => e.lang === 'ahk')).toBe(true)
  })

  it('leaves out the library of another language', () => {
    const dict = buildDictionary(input({ lang: 'ahk', shown: WIN_AHK.file.path }))
    expect(dict.entries.some((e) => e.group.kind === 'library')).toBe(false)
    expect(dict.lookup('Set-SoundVolume')).toBeUndefined()
  })

  it('lists every file as yours or shared when the pair has no file in the shown language', () => {
    const dict = buildDictionary(input({ shown: null }))
    expect(dict.entries.some((e) => e.group.kind === 'shown')).toBe(false)
    expect(listSections(dict).commands.map((g) => g.group.label)).toEqual(['mine', 'helper', 'windows'])
  })

  it('follows unsaved text, of the shown file and of another', () => {
    const dict = buildDictionary(input({
      drafts: {
        [WIN_PS.file.path]: WIN_PS.file.text + 'function Get-Typed {\n}\n',
        [HELPER_PS.file.path]: 'function Get-Elsewhere {\n}\n',
      },
    }))
    expect(dict.lookup('Get-Typed')!.source).toMatchObject({ line: 4 })
    expect(dict.lookup('Get-Elsewhere')).toBeDefined()
    expect(dict.lookup('Get-Private')).toBeUndefined()
  })

  it('gives a command without docs its twin\'s summary, and says whose', () => {
    expect(buildDictionary(input()).lookup('OpenThing')).toMatchObject({ summary: 'Opens the thing.', borrowed: 'ahk', command: true })
    expect(buildDictionary(input()).lookup('Message')).toMatchObject({ summary: '', borrowed: null })
    // A twin that exists but has no docs of its own lends nothing either.
    const bareTwin = cmd('ahk/commands/helper.ahk', 'Message(Macro)\n{\n}\n')
    const dict = buildDictionary(input({ commandFiles: [MINE_PS, HELPER_PS, bareTwin, WIN_AHK, WIN_PS] }))
    expect(dict.lookup('Message')).toMatchObject({ summary: '', borrowed: null })
  })

  it("gives an AutoHotkey command without docs its PowerShell twin's summary", () => {
    const bare = cmd('ahk/commands/windows.ahk', 'OpenThing(Macro)\n{\n}\n')
    const noted = cmd('powershell/commands/windows.ps1', '# Opens the thing from PowerShell.\nfunction OpenThing {\n    param($Macro)\n}\n')
    const dict = buildDictionary({ lang: 'ahk', shown: bare.file.path, commandFiles: [bare, noted], libraryFiles: [], drafts: {} })
    expect(dict.lookup('openthing')).toMatchObject({ summary: 'Opens the thing from PowerShell.', borrowed: 'ps' })
  })

  it('parses each unsaved text once, however many entries read it', () => {
    const ahkDraft = '/**\n * Opens the thing.\n */\nOpenThing(Macro)\n{\n}\nOpenOther(Macro)\n{\n}\n'
    const ps = cmd(
      'powershell/commands/windows.ps1',
      'function OpenThing {\n    param($Macro)\n}\nfunction OpenOther {\n    param($Macro)\n}\nfunction OpenThird {\n    param($Macro)\n}\n',
    )
    const parse = vi.spyOn(LANGUAGES.ahk, 'findFunctions')
    try {
      const dict = buildDictionary(input({ shown: ps.file.path, commandFiles: [WIN_AHK, ps], drafts: { [WIN_AHK.file.path]: ahkDraft } }))
      expect(dict.lookup('OpenThing')).toMatchObject({ summary: 'Opens the thing.', borrowed: 'ahk' })
      expect(parse).toHaveBeenCalledTimes(1)
    } finally {
      parse.mockRestore()
    }
  })

  it('keeps a library function that takes a lone Macro among the functions to call', () => {
    const tool = lib('Tool', '<#\n.SYNOPSIS\nWorks on a macro.\n.EXAMPLE\nInvoke-Tool $Macro\n#>\nfunction Invoke-Tool {\n    param($Macro)\n}\n')
    const dict = buildDictionary(input({ libraryFiles: [tool] }))
    expect(dict.lookup('Invoke-Tool')).toMatchObject({ command: false, group: { kind: 'library' } })
    const { functions, commands } = listSections(dict)
    expect(functions.flatMap((g) => g.entries.map((e) => e.fn.name))).toContain('Invoke-Tool')
    expect(commands.flatMap((g) => g.entries.map((e) => e.fn.name))).not.toContain('Invoke-Tool')
  })

  it('reads the twin from its unsaved text', () => {
    const dict = buildDictionary(input({
      drafts: { [WIN_AHK.file.path]: '/**\n * Typed just now.\n */\nOpenThing(Macro)\n{\n}\n' },
    }))
    expect(dict.lookup('OpenThing')).toMatchObject({ summary: 'Typed just now.', borrowed: 'ahk' })
  })

  it('names the group of each entry', () => {
    const dict = buildDictionary(input())
    expect(dict.lookup('OpenThing')!.group).toEqual({ key: 'shown:shared:windows', kind: 'shown', label: 'windows', file: null })
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

  it('gives each entry an id of its own, which a moved line keeps', () => {
    const ids = (dict: Dictionary) => dict.entries.filter((e) => e.fn.name === 'ActivateOrOpen').map((e) => e.id)
    const before = ids(buildDictionary(input()))
    expect(new Set(before).size).toBe(2)
    const moved = buildDictionary(input({ drafts: { [HELPER_PS.file.path]: '# Moved down.\n\n' + HELPER_PS.file.text } }))
    expect(moved.lookup('Message')!.fn.line).toBe(13)
    expect(ids(moved)).toEqual(before)
  })

  it('tells apart two definitions of one name in one file', () => {
    const twice = cmd('powershell/commands/windows.ps1', 'function Twice {\n}\nfunction twice {\n}\n')
    const entries = buildDictionary(input({ commandFiles: [twice], libraryFiles: [] })).entries
    expect(entries).toHaveLength(2)
    expect(entries[0].id).not.toBe(entries[1].id)
  })

  it('keys the shown group by its file', () => {
    const shownAs = (shown: string) => buildDictionary(input({ shown })).entries.find((e) => e.group.kind === 'shown')!.group.key
    expect(shownAs(WIN_PS.file.path)).toBe('shown:shared:windows')
    expect(shownAs(MINE_PS.file.path)).toBe('shown:yours:mine')
  })

  it('names the group a pair name of yours and a shared one share', () => {
    const mine = cmd('local/powershell/commands/windows.ps1', 'function OpenMine {\n    param($Macro)\n}\n')
    const dict = buildDictionary(input({ shown: HELPER_PS.file.path, commandFiles: [mine, HELPER_PS, WIN_PS] }))
    expect(listSections(dict).commands.map((g) => g.group.label)).toEqual(['windows · yours', 'windows · shared'])
    expect(dict.lookup('Message')!.group.label).toBe('helper')
  })

  it('finds a name in one file only', () => {
    const dict = buildDictionary(input())
    expect(dict.lookupIn(HELPER_PS.file.path, 'activateoropen')!.summary).toBe('Switches to a program.')
    expect(dict.lookupIn(WIN_PS.file.path, 'ActivateOrOpen')).toBeUndefined()
  })

  it('parses a draft once across builds with a shared parse, and only drafts', () => {
    const cache = parseCache()
    const drafts = { [WIN_PS.file.path]: 'function Get-Typed {\n}\n', [HELPER_PS.file.path]: HELPER_PS.file.text + '\n' }
    const parse = vi.spyOn(LANGUAGES.ps, 'findFunctions')
    try {
      buildDictionary(input({ drafts }), cache)
      expect(parse).toHaveBeenCalledTimes(2)
      parse.mockClear()
      const typed = { ...drafts, [WIN_PS.file.path]: 'function Get-Typed2 {\n}\n' }
      cache.keep(typed)
      expect(buildDictionary(input({ drafts: typed }), cache).lookup('Get-Typed2')).toBeDefined()
      expect(parse.mock.calls.map(([text]) => text)).toEqual(['function Get-Typed2 {\n}\n'])
    } finally {
      parse.mockRestore()
    }
  })
})

describe('the twin rule', () => {
  const dictOf = (lang: 'ahk' | 'ps', ...files: CommandFile[]) =>
    buildDictionary({ lang, shown: null, commandFiles: files, libraryFiles: [], drafts: {} })

  it("keeps a command's own summary over its twin's", () => {
    const own = cmd('powershell/commands/windows.ps1', '# Mine.\nfunction OpenThing {\n    param($Macro)\n}\n')
    expect(dictOf('ps', own, WIN_AHK).lookup('OpenThing')).toMatchObject({ summary: 'Mine.', borrowed: null })
  })

  it('borrows only from the same group and pair', () => {
    const yours = cmd('local/ahk/windows.ahk', '/**\n * Yours.\n */\nOpenThing(Macro)\n{\n}\n')
    expect(dictOf('ps', WIN_PS, yours).lookup('OpenThing')).toMatchObject({ summary: '', borrowed: null })
    const otherPair = cmd('ahk/commands/media.ahk', '/**\n * Another pair.\n */\nOpenThing(Macro)\n{\n}\n')
    expect(dictOf('ps', WIN_PS, otherPair).lookup('OpenThing')).toMatchObject({ summary: '', borrowed: null })
  })

  it('borrows nothing from a twin without docs', () => {
    const bare = cmd('ahk/commands/windows.ahk', 'OpenThing(Macro)\n{\n}\n')
    expect(dictOf('ps', WIN_PS, bare).lookup('OpenThing')).toMatchObject({ summary: '', borrowed: null })
  })

  it('lends nothing to a function that is not a command', () => {
    const ps = cmd('powershell/commands/windows.ps1', 'function GetThing {\n    param($A, $B)\n}\n')
    const ahk = cmd('ahk/commands/windows.ahk', '/**\n * Gets the thing.\n */\nGetThing(A, B)\n{\n}\n')
    expect(dictOf('ps', ps, ahk).lookup('GetThing')).toMatchObject({ summary: '', borrowed: null })
  })

  it('finds the twin whatever its case', () => {
    const ahk = cmd('ahk/commands/windows.ahk', '/**\n * Opens the thing.\n */\nopenthing(Macro)\n{\n}\n')
    expect(dictOf('ps', WIN_PS, ahk).lookup('OpenThing')).toMatchObject({ summary: 'Opens the thing.', borrowed: 'ahk' })
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

// Written with the Windows group first, so only the reference's own order puts Keys and mouse first.
const REFERENCE_TEXT = [
  '/**', ' * Makes a window active.', ' * @param {String} WinTitle - The window.', ' * @example WinActivate "ahk_exe notepad.exe"',
  ' * @group Windows', ' * @see https://www.autohotkey.com/docs/v2/lib/WinActivate.htm', ' */', 'WinActivate(WinTitle?) {', '}',
  '/**', ' * Presses keys and types text.', ' * @param {String} Keys - What to press.', ' * @example Send "^c"',
  ' * @group Keys and mouse', ' * @powershell Send-Ahk', ' * @see https://www.autohotkey.com/docs/v2/lib/Send.htm', ' */', 'Send(Keys) {', '}',
  '/**', ' * Waits.', ' * @group Waiting and timing', ' * @see https://www.autohotkey.com/docs/v2/lib/Sleep.htm', ' */', 'Sleep(Delay) {', '}',
].join('\n')
const REFERENCE: Reference = { lang: 'ahk', entries: readReference(REFERENCE_TEXT) }
const AHK_HELPER = cmd('ahk/commands/helper.ahk', '/**\n * Opens it.\n */\nOpenIt(Window)\n{\n}\n')
const withReference = (over: Partial<DictInput> = {}) =>
  buildDictionary({ lang: 'ahk', shown: WIN_AHK.file.path, commandFiles: [AHK_HELPER, WIN_AHK], libraryFiles: [], drafts: {}, reference: REFERENCE, ...over })

describe('the bundled reference', () => {
  it('gives a built-in an entry of its own, from the reference, after the folder', () => {
    const dict = withReference()
    expect(dict.lookup('send')).toMatchObject({
      lang: 'ahk',
      command: false,
      summary: 'Presses keys and types text.',
      borrowed: null,
      source: { kind: 'reference', page: 'https://www.autohotkey.com/docs/v2/lib/Send.htm', powershell: 'Send-Ahk' },
      group: { key: 'reference:Keys and mouse', kind: 'reference', label: 'Keys and mouse', file: null },
    })
    expect(dict.lookup('WinActivate')!.source).toMatchObject({ powershell: null })
    expect(dict.entries.findIndex((e) => e.group.kind === 'reference')).toBe(dict.entries.length - REFERENCE.entries.length)
  })

  it('lets a function of the folder with the name of a built-in win, and keeps both', () => {
    const own = cmd('ahk/commands/windows.ahk', '/**\n * Mine.\n */\nSleep(Macro)\n{\n}\n')
    const dict = withReference({ shown: own.file.path, commandFiles: [own] })
    expect(dict.lookup('SLEEP')).toMatchObject({ summary: 'Mine.', source: { kind: 'file' } })
    expect(dict.entries.filter((e) => e.fn.name === 'Sleep').map((e) => e.source.kind)).toEqual(['file', 'reference'])
  })

  it('is left out of a dictionary of another language', () => {
    const dict = buildDictionary(input({ reference: REFERENCE }))
    expect(dict.lookup('Send')).toBeUndefined()
    expect(listSections(dict).reference).toEqual([])
  })

  it('is never found in a file', () => {
    expect(withReference().lookupIn(WIN_AHK.file.path, 'Send')).toBeUndefined()
  })

  it("lists its groups after the folder's, in the order of its headings", () => {
    const { functions, commands, reference } = listSections(withReference())
    expect(functions.map((g) => g.group.label)).toEqual(['helper'])
    expect(commands.map((g) => g.group.label)).toEqual([])
    expect(reference.map((g) => [g.group.label, g.entries.map((e) => e.fn.name)])).toEqual([
      ['Keys and mouse', ['Send']],
      ['Windows', ['WinActivate']],
      ['Waiting and timing', ['Sleep']],
    ])
  })

  it('is filtered with the rest', () => {
    const all = listSections(withReference())
    expect(filterSections(all, 'press').reference.flatMap((g) => g.entries.map((e) => e.fn.name))).toEqual(['Send'])
    expect(filterSections(all, 'opens').reference).toEqual([])
    expect(filterSections(all, 'opens').functions).toHaveLength(1)
  })

  it("gives each entry an id apart from a file's entry of the same name", () => {
    const own = cmd('ahk/commands/windows.ahk', 'Send(Keys)\n{\n}\n')
    const ids = withReference({ shown: own.file.path, commandFiles: [own] }).entries.filter((e) => e.fn.name === 'Send').map((e) => e.id)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('readReference', () => {
  it('reads the tags of each block, the first of each name', () => {
    const text = '/**\n * Twice.\n * @group Text\n * @group Other\n * @see a\n */\nTwice(A) {\n}\n'
    expect(readReference(text).map(({ group, page, powershell }) => ({ group, page, powershell }))).toEqual([
      { group: 'Text', page: 'a', powershell: null },
    ])
  })

  it('leaves out a function without a doc block, and puts a group it does not know last', () => {
    const text =
      'Bare() {\n}\n/**\n * Odd.\n * @group Unheard of\n */\nOdd() {\n}\n/**\n * Plain.\n */\nPlain() {\n}\n/**\n * Last.\n * @group Other\n */\nLast() {\n}\n'
    expect(readReference(text).map((e) => [e.fn.name, e.group, e.page])).toEqual([
      ['Last', 'Other', ''],
      ['Odd', 'Unheard of', ''],
      ['Plain', '', ''],
    ])
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

  it('finds no name in a PowerShell parameter, a scoped variable or a splat', () => {
    expect(nameAt('Foo -Name x', 6, 'ps')).toBeNull()
    expect(nameAt('$script:Foo', 9, 'ps')).toBeNull()
    expect(nameAt('$env:Path', 6, 'ps')).toBeNull()
    expect(nameAt('Foo @Splat', 6, 'ps')).toBeNull()
    expect(nameAt('${Foo}', 3, 'ps')).toBeNull()
    expect(nameAt('Send-Key -Name x', 2, 'ps')).toEqual({ from: 0, to: 8, name: 'Send-Key' })
    expect(nameAt('if ($x) { Open:Foo }', 15, 'ps')).toEqual({ from: 15, to: 18, name: 'Foo' })
  })
})

describe('sourceText', () => {
  it('writes where an entry is defined', () => {
    expect(sourceText({ kind: 'file', path: 'powershell/lib/Input.ps1', line: 79 })).toBe('powershell/lib/Input.ps1 · line 79')
  })

  it('gives the page of a reference entry', () => {
    const page = 'https://www.autohotkey.com/docs/v2/lib/Send.htm'
    expect(sourceText({ kind: 'reference', page, powershell: 'Send-Ahk' })).toBe(page)
  })
})
