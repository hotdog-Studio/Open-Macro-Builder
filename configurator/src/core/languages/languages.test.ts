import { describe, expect, it } from 'vitest'
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
