import { describe, expect, it } from 'vitest'
import { readRepoText } from '../../../test/repo'
import { LANGUAGES, LANG_IDS, isCommand } from './index'

describe('AutoHotkey findFunctions', () => {
  it('reads a documented command', () => {
    const text = [
      '/**',
      ' * Opens YouTube in Google Chrome.',
      ' * @param {Macro} Macro - The macro object (not used in this function).',
      ' */',
      'OpenYoutube(Macro) {',
      '    ActivateOrOpenChrome("https://www.youtube.com/")',
      '}',
    ].join('\n')
    expect(LANGUAGES.ahk.findFunctions(text)).toEqual([
      { name: 'OpenYoutube', line: 5, params: ['Macro'], description: 'Opens YouTube in Google Chrome.' },
    ])
  })

  it('drops parameter defaults', () => {
    const [fn] = LANGUAGES.ahk.findFunctions('Open(Window, Program, Args := "")\n{\n}')
    expect(fn.params).toEqual(['Window', 'Program', 'Args'])
    expect(isCommand(fn)).toBe(false)
  })

  it('does not split a default on a comma inside quotes', () => {
    const [fn] = LANGUAGES.ahk.findFunctions('Open(A, B := "x, y") {\n}')
    expect(fn.params).toEqual(['A', 'B'])
  })

  it('handles ByRef and variadic parameters, and no parameters', () => {
    const fns = LANGUAGES.ahk.findFunctions('F(&Out, Rest*) {\n}\nG() {\n}')
    expect(fns.map((f) => f.params)).toEqual([['Out', 'Rest'], []])
  })

  it('joins several description lines and keeps @description text', () => {
    const text = '/**\n * @description First part\n * second part.\n * @param x\n */\nThing(Macro) {\n}'
    expect(LANGUAGES.ahk.findFunctions(text)[0].description).toBe('First part second part.')
  })

  it('gives an empty description when no JSDoc block is directly above', () => {
    const text = '/**\n * Old.\n */\n\nThing(Macro) {\n}'
    expect(LANGUAGES.ahk.findFunctions(text)[0].description).toBe('')
  })

  it('ignores indented calls and control flow', () => {
    const text = 'Thing(Macro) {\n    Other(Macro)\n    if(x) {\n    }\n}\nif(y) {\n}'
    expect(LANGUAGES.ahk.findFunctions(text).map((f) => f.name)).toEqual(['Thing'])
  })
})

describe('PowerShell findFunctions', () => {
  const text = [
    'function A { param($Macro) X }',
    'function B {',
    '    param($Macro)',
    '}',
    '# Does C',
    "function C { param($Url = '') }",
  ].join('\n')

  it('reads one-line and multi-line commands', () => {
    const fns = LANGUAGES.ps.findFunctions(text)
    expect(fns.map((f) => [f.name, f.line, f.params])).toEqual([
      ['A', 1, ['Macro']],
      ['B', 2, ['Macro']],
      ['C', 6, ['Url']],
    ])
    expect(fns.map(isCommand)).toEqual([true, true, false])
    expect(fns[2].description).toBe('Does C')
    expect(fns[0].description).toBe('')
  })

  it('does not borrow the param block of the next function', () => {
    const fns = LANGUAGES.ps.findFunctions('function X { Foo }\nfunction Y { param($Macro) }')
    expect(fns.map((f) => f.params)).toEqual([[], ['Macro']])
  })

  it('reads typed parameters and defaults with parentheses', () => {
    const fns = LANGUAGES.ps.findFunctions('function T {\n    param([string]$Exe, $Arguments = (Get-X))\n}')
    expect(fns[0].params).toEqual(['Exe', 'Arguments'])
  })
})

describe('language table', () => {
  it('lists both languages', () => {
    expect(LANG_IDS).toEqual(['ahk', 'ps'])
    expect(LANGUAGES.ahk).toMatchObject({
      label: 'AutoHotkey',
      short: 'AHK',
      ext: '.ahk',
      sharedDir: 'ahk/commands',
      personalDir: 'local/ahk',
      ignore: ['local/ahk/commands.ahk'],
    })
    expect(LANGUAGES.ps).toMatchObject({
      label: 'PowerShell',
      short: 'PS',
      ext: '.ps1',
      sharedDir: 'powershell/commands',
      personalDir: 'local/powershell/commands',
      ignore: [],
    })
  })

  it('accepts Macro in any case only as the single parameter', () => {
    const f = (params: string[]) => ({ name: 'n', line: 1, params, description: '' })
    expect(isCommand(f(['macro']))).toBe(true)
    expect(isCommand(f(['Macro', 'X']))).toBe(false)
    expect(isCommand(f([]))).toBe(false)
  })
})

describe('renameParam', () => {
  it('in AutoHotkey renames the definition and its uses only', () => {
    const text = [
      'Foo(amacrorgs)',
      '{',
      '    Run(AMacroRgs.name, amacrorgsX)',
      '    return amacrorgs',
      '}',
      'Other(amacrorgs) {',
      '    amacrorgs := 1',
      '}',
    ].join('\n')
    const [foo] = LANGUAGES.ahk.findFunctions(text)
    expect(LANGUAGES.ahk.renameParam(text, foo, 'Macro')).toBe(
      [
        'Foo(Macro)',
        '{',
        '    Run(Macro.name, amacrorgsX)',
        '    return Macro',
        '}',
        'Other(amacrorgs) {',
        '    amacrorgs := 1',
        '}',
      ].join('\n'),
    )
  })

  it('in AutoHotkey leaves the function name alone and keeps CRLF', () => {
    const text = 'Macro2(x) {\r\n    return x\r\n}\r\n'
    const [fn] = LANGUAGES.ahk.findFunctions(text)
    expect(LANGUAGES.ahk.renameParam(text, fn, 'Macro')).toBe('Macro2(Macro) {\r\n    return Macro\r\n}\r\n')
  })

  it('in PowerShell renames $name uses up to the next function', () => {
    const text = [
      'function First { param($x) $x }',
      'function Foo {',
      '    param([string]$amacrorgs)',
      '    Write-Host $AMacroRgs "amacrorgs" $amacrorgsMore',
      '}',
      'function Next { param($amacrorgs) $amacrorgs }',
    ].join('\n')
    const foo = LANGUAGES.ps.findFunctions(text)[1]
    expect(LANGUAGES.ps.renameParam(text, foo, 'Macro')).toBe(
      [
        'function First { param($x) $x }',
        'function Foo {',
        '    param([string]$Macro)',
        '    Write-Host $Macro "amacrorgs" $amacrorgsMore',
        '}',
        'function Next { param($amacrorgs) $amacrorgs }',
      ].join('\n'),
    )
  })

  it('in PowerShell renames to the end of the file when no function follows', () => {
    const text = 'function Foo { param($a) $a }\n'
    const [fn] = LANGUAGES.ps.findFunctions(text)
    expect(LANGUAGES.ps.renameParam(text, fn, 'Macro')).toBe('function Foo { param($Macro) $Macro }\n')
  })
})

describe('include listings', () => {
  const { ahk, ps } = LANGUAGES
  const CONFIG_AHK = readRepoText('ahk/config.ahk')
  const HUB_HEADER = [
    '#Requires AutoHotkey v2.0',
    '; Your own AutoHotkey commands. ahk\\config.ahk includes this file when it exists. The local folder',
    '; is ignored by git, so nothing here is ever committed.',
    '',
  ].join('\n')

  it('gives each language its starter text and include file', () => {
    expect(ahk.starterFile('new')).toBe('#Requires AutoHotkey v2.0\n\n; new commands.\n')
    expect(ps.starterFile('new')).toBe('# new commands.\n')
    expect(ahk.listedIn('local/ahk/mine.ahk')).toBe('local/ahk/commands.ahk')
    expect(ahk.listedIn('local/ahk/sub/mine.ahk')).toBe('local/ahk/commands.ahk')
    expect(ahk.listedIn('ahk/commands/custom/new.ahk')).toBe('ahk/config.ahk')
    expect(ps.listedIn('local/powershell/commands/mine.ps1')).toBeNull()
    expect(ps.listedIn('powershell/commands/custom/new.ps1')).toBeNull()
  })

  it('adds a shared include in Custom Commands', () => {
    const next = ahk.addListing(CONFIG_AHK, 'ahk/commands/custom/new.ahk')
    const before = CONFIG_AHK.split('\n')
    const at = before.indexOf('#Include commands\\custom\\automation.ahk')
    expect(at).toBeGreaterThan(0)
    expect(next.split('\n')).toEqual([...before.slice(0, at + 1), '#Include commands\\custom\\new.ahk', ...before.slice(at + 1)])
    // A path already listed leaves the text unchanged.
    expect(ahk.addListing(next, 'ahk/commands/custom/new.ahk')).toBe(next)
    expect(ahk.addListing(CONFIG_AHK, 'ahk/commands/custom/chrome.ahk')).toBe(CONFIG_AHK)
  })

  it('removeListing undoes addListing byte for byte', () => {
    const cases: [string, string][] = [
      [CONFIG_AHK, 'ahk/commands/custom/new.ahk'],
      [CONFIG_AHK.replaceAll('\n', '\r\n'), 'ahk/commands/custom/new.ahk'],
      [HUB_HEADER + '#Include other.ahk\n', 'local/ahk/mine.ahk'],
      [HUB_HEADER + '#Include other.ahk', 'local/ahk/mine.ahk'],
      ['; mine\r\n#Include other.ahk\r\n', 'local/ahk/mine.ahk'],
      ['', 'local/ahk/mine.ahk'],
    ]
    for (const [text, path] of cases) {
      const added = ahk.addListing(text, path)
      expect(added).not.toBe(text)
      expect(ahk.removeListing(added, path)).toBe(text)
    }
  })

  it('starts a missing hub', () => {
    expect(ahk.addListing(null, 'local/ahk/mine.ahk')).toBe(HUB_HEADER + '#Include mine.ahk\n')
    expect(ahk.addListing(null, 'local/ahk/sub/mine.ahk')).toBe(HUB_HEADER + '#Include sub\\mine.ahk\n')
  })

  it('keeps a hub without a final newline that way', () => {
    expect(ahk.addListing('#Include a.ahk', 'local/ahk/mine.ahk')).toBe('#Include a.ahk\n#Include mine.ahk')
    expect(ahk.addListing('#Include a.ahk\n', 'local/ahk/mine.ahk')).toBe('#Include a.ahk\n#Include mine.ahk\n')
  })

  it('refuses a config.ahk without Custom Commands', () => {
    const text = '#Requires AutoHotkey v2.0\n; ****** Commands ******\n#Include commands\\helper.ahk\n'
    expect(() => ahk.addListing(text, 'ahk/commands/custom/new.ahk')).toThrow(
      'ahk/config.ahk has no Custom Commands section. Add "#Include commands\\custom\\new.ahk" there by hand.',
    )
  })

  it('goes directly after the Custom Commands header when the section lists nothing yet', () => {
    const text = '; *** Custom Commands ***\n; Notes.\n\n; **** Macros ****\n#Include commands\\x.ahk\n'
    expect(ahk.addListing(text, 'ahk/commands/custom/new.ahk')).toBe(
      '; *** Custom Commands ***\n#Include commands\\custom\\new.ahk\n; Notes.\n\n; **** Macros ****\n#Include commands\\x.ahk\n',
    )
  })

  it('removes an include written with *i, quotes or forward slashes', () => {
    const hub = [
      '#Requires AutoHotkey v2.0',
      '#Include *i mine.ahk',
      '#include "Mine.AHK"',
      "  #Include 'sub/../mine.ahk'",
      '#Include other.ahk',
      '; #Include mine.ahk is a comment',
      '',
    ].join('\n')
    expect(ahk.removeListing(hub, 'local/ahk/mine.ahk')).toBe(
      '#Requires AutoHotkey v2.0\n#Include other.ahk\n; #Include mine.ahk is a comment\n',
    )
    const config = '; *** Custom Commands ***\r\n#Include *i commands/custom/New.ahk\r\n#Include *i ..\\local\\ahk\\commands.ahk\r\n'
    expect(ahk.removeListing(config, 'ahk/commands/custom/new.ahk')).toBe(
      '; *** Custom Commands ***\r\n#Include *i ..\\local\\ahk\\commands.ahk\r\n',
    )
  })

  it('lists nothing for PowerShell', () => {
    expect(ps.addListing('x', 'local/powershell/commands/mine.ps1')).toBe('x')
    expect(ps.removeListing('x', 'local/powershell/commands/mine.ps1')).toBe('x')
  })
})
