import { describe, expect, it } from 'vitest'
import { readRepoText } from '../../../test/repo'
import { appendBlock } from '../commands/newCommand'
import { paramMismatches } from '../commands/outline'
import { LANGUAGES, LANG_IDS, emptyDoc, isCommand } from './index'

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
    expect(LANGUAGES.ahk.findFunctions(text)).toMatchObject([
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

  it('reads the docs of a documented function', () => {
    const text = [
      '/**',
      ' * Activates a window, or opens the program.',
      ' * Second line of the summary.',
      ' * @param {String} Window - The window title.',
      ' *   It may span lines.',
      ' * @param {String} [Args=""] - Optional arguments.',
      ' * @param {String} Nobody - Names no parameter.',
      ' * @returns {Integer} The window id.',
      ' * @example ActivateOrOpen("ahk_exe notepad.exe", "notepad")',
      ' */',
      'ActivateOrOpen(Window, Program, Args := "")',
      '{',
      '}',
    ].join('\n')
    const [fn] = LANGUAGES.ahk.findFunctions(text)
    expect(fn.usage).toBe('ActivateOrOpen(Window, Program, Args := "")')
    expect(fn.description).toBe('Activates a window, or opens the program. Second line of the summary.')
    expect(fn.doc).toEqual({
      form: 'block',
      summary: 'Activates a window, or opens the program. Second line of the summary.',
      params: [
        { name: 'Window', text: 'The window title. It may span lines.', type: 'String', optional: false, default: '', values: [] },
        { name: 'Program', text: '', type: '', optional: false, default: '', values: [] },
        { name: 'Args', text: 'Optional arguments.', type: 'String', optional: true, default: '""', values: [] },
      ],
      returns: 'The window id.',
      examples: ['ActivateOrOpen("ahk_exe notepad.exe", "notepad")'],
    })
  })

  it('leaves the brace out of the usage line', () => {
    expect(LANGUAGES.ahk.findFunctions('Thing(Macro) {\n}')[0].usage).toBe('Thing(Macro)')
  })

  it('gives a function without a block its declared parameters and no docs', () => {
    const [fn] = LANGUAGES.ahk.findFunctions('F(&Out, Rest*, Maybe?) {\n}')
    expect(fn.doc).toEqual({
      form: 'none',
      summary: '',
      params: [
        { name: 'Out', text: '', type: '', optional: false, default: '', values: [] },
        { name: 'Rest', text: '', type: '', optional: true, default: '', values: [] },
        { name: 'Maybe', text: '', type: '', optional: true, default: '', values: [] },
      ],
      returns: '',
      examples: [],
    })
  })

  it('reads an @param without a type or a dash', () => {
    const [fn] = LANGUAGES.ahk.findFunctions('/**\n * Does it.\n * @param wParam the word\n */\nOn(wParam) {\n}')
    expect(fn.doc.params[0]).toMatchObject({ text: 'the word', type: '' })
  })

  describe('doc tag shapes', () => {
    const docOf = (tagLines: string[], head = 'F(Name)') =>
      LANGUAGES.ahk.findFunctions(['/**', ...tagLines.map((l) => ` * ${l}`), ' */', `${head} {`, '}'].join('\n'))[0].doc
    const param = (tag: string) => docOf([tag]).params[0]

    it('reads an @param with a type and no dash', () => {
      expect(param('@param {String} Name the text')).toMatchObject({ type: 'String', text: 'the text' })
    })

    it('reads an @param with a dash and no type', () => {
      expect(param('@param Name - the text')).toMatchObject({ type: '', text: 'the text' })
    })

    it('reads an @param with only a name', () => {
      expect(param('@param Name')).toMatchObject({ type: '', text: '' })
      expect(param('@param {Integer} Name')).toMatchObject({ type: 'Integer', text: '' })
    })

    it('reads an @param with a dash and nothing after it', () => {
      expect(param('@param Name -')).toMatchObject({ type: '', text: '' })
    })

    it('keeps a dash that is not followed by a space as text', () => {
      expect(param('@param Name -x flag')).toMatchObject({ text: '-x flag' })
      expect(param('@param Name --verbose')).toMatchObject({ text: '--verbose' })
    })

    it('reads a [Name] without a default, with and without text', () => {
      expect(param('@param {String} [Name] - the text')).toMatchObject({ type: 'String', text: 'the text' })
      expect(param('@param [Name]')).toMatchObject({ type: '', text: '' })
    })

    it('reads a [Name=default] and a [Name] that has no space before its text', () => {
      expect(param('@param [Name="x y"] the text')).toMatchObject({ text: 'the text' })
      expect(param('@param [Name]the text')).toMatchObject({ text: 'the text' })
      expect(param('@param [Name]- the text')).toMatchObject({ text: 'the text' })
    })

    it('reads a type with spaces and a name after several spaces', () => {
      expect(param('@param   {Map | String}    Name     -     the   text')).toMatchObject({ type: 'Map | String', text: 'the text' })
    })

    it('reads @return and @returns, with and without a type', () => {
      expect(docOf(['@return {Integer} The id.']).returns).toBe('The id.')
      expect(docOf(['@return The id.']).returns).toBe('The id.')
      expect(docOf(['@returns   {Integer}   The id.']).returns).toBe('The id.')
      expect(docOf(['@returns The id.']).returns).toBe('The id.')
      expect(docOf(['@return {Integer}']).returns).toBe('')
      expect(docOf(['@return']).returns).toBe('')
    })

    it('adds the lines after a tag to its text', () => {
      expect(docOf(['@return {Integer} The id,', '  and more.']).returns).toBe('The id, and more.')
      expect(param('@param Name -\n *   the text')).toMatchObject({ text: 'the text' })
    })

    it('reads a tag whose name is followed by a character other than a space', () => {
      expect(docOf(['@return: The id.']).returns).toBe(': The id.')
      expect(docOf(['@example(F("a"))']).examples).toEqual(['(F("a"))'])
    })

    it('reads a tag with several spaces after its name', () => {
      expect(docOf(['@example     F("a")']).examples).toEqual(['F("a")'])
      expect(docOf(['@description     Does it.']).summary).toBe('Does it.')
    })

    it('reads an @example that has spaces before the @', () => {
      expect(docOf(['   @example F("a")']).examples).toEqual(['F("a")'])
      expect(docOf(['Does it.', '   @param Name the text']).params[0].text).toBe('the text')
    })

    it('reads a tag line with nothing after its name', () => {
      expect(docOf(['@example', '  F("a")', '  F("b")']).examples).toEqual(['F("a")\nF("b")'])
      expect(docOf(['@description', 'Does it.']).summary).toBe('Does it.')
      expect(docOf(['@param', '@returns']).returns).toBe('')
    })

    it('drops an @example with nothing in it, and joins text lines with @description', () => {
      expect(docOf(['Does it.', '@example']).examples).toEqual([])
      expect(docOf(['Does it.', '@description And more.']).summary).toBe('Does it. And more.')
    })

    it('keeps the indentation of an example relative to its first line only', () => {
      expect(docOf(['@example', '    F("a")', '        F("b")']).examples).toEqual(['F("a")\n    F("b")'])
    })

    it('does not take an @ in the middle of a line, or a bare @, for a tag', () => {
      expect(docOf(['Mail me @param Name']).summary).toBe('Mail me @param Name')
      expect(docOf(['@ param Name x']).summary).toBe('@ param Name x')
    })

    it('does not take a line with a line break inside it for a tag', () => {
      // The tag pattern stops at the break, so the line is part of the summary and the tag readers never see it.
      const doc = docOf(['@param Name text\rmore'])
      expect(doc.params[0]).toMatchObject({ type: '', text: '' })
      expect(doc.summary).toBe('@param Name text more')
      expect(docOf(['@return {T}\rtext']).returns).toBe('')
    })

    describe('long lines', () => {
      // A line with a line break inside is no tag (the tag pattern stops at it), so the readers only ever see
      // lines without one. These runs are the worst shapes left for them; each must read in a few ms.
      const SPACES = ' '.repeat(50000)
      const LONG = 'a'.repeat(50000)
      const timed = (tag: string) => {
        const started = performance.now()
        docOf([tag])
        return performance.now() - started
      }

      it.each([
        ['@param with spaces everywhere', `@param {String}${SPACES}Name${SPACES}-${SPACES}text b c`],
        ['@param with spaces after the name', `@param Name${SPACES}b c`],
        ['@param with a long name', `@param ${LONG} b c`],
        ['@param with a long [name]', `@param [${LONG}] b c`],
        ['@param with a long {type}', `@param {${LONG}} Name b c`],
        ['@return with a type', `@return {T}${SPACES}b c`],
        ['@example', `@example${SPACES}b c`],
        ['a tag name', `@${LONG}${SPACES}b c`],
      ])('%s', (_label, tag) => {
        expect(timed(tag)).toBeLessThan(1000)
      })
    })
  })

  it('takes a call at the left edge for a call, not a definition', () => {
    const fns = LANGUAGES.ahk.findFunctions('/**\n * Real docs\n */\nFoo(a) {\n}\nFoo(1)\nSetTitleMatchMode(2)\nx := 1\n')
    expect(fns.map((f) => [f.name, f.line])).toEqual([['Foo', 4]])
    expect(fns[0].description).toBe('Real docs')
  })

  it('finds a definition whose brace is on a later line', () => {
    const fns = LANGUAGES.ahk.findFunctions('Foo(a)\n\n{\n}\nBar(b)\n; a comment\n{\n}\nFoo(1)')
    expect(fns.map((f) => [f.name, f.line])).toEqual([['Foo', 1], ['Bar', 5]])
  })

  it('finds a one-line function, a comment after the list, and a ) inside a default', () => {
    const fns = LANGUAGES.ahk.findFunctions('Double(x) => x * 2\nFoo(Macro) ; comment\n{\n}\nBar(a := ")", b := "`"") {\n}')
    expect(fns.map((f) => [f.name, f.params])).toEqual([['Double', ['x']], ['Foo', ['Macro']], ['Bar', ['a', 'b']]])
    expect(isCommand(fns[1])).toBe(true)
    expect(fns[2].usage).toBe('Bar(a := ")", b := "`"")')
  })

  it('reads no docs from a plain /* */ comment above a function', () => {
    const fns = LANGUAGES.ahk.findFunctions('/**\n * A docs.\n */\nA() {\n}\n/* plain */\nB() {\n}')
    expect(fns[1].doc.form).toBe('none')
  })

  it('reads no docs from a */ with no /** above it', () => {
    expect(LANGUAGES.ahk.findFunctions('x := 1 */\nB() {\n}')[0].doc.form).toBe('none')
  })

  it("does not take an earlier function's block for a stray */ above another", () => {
    const fns = LANGUAGES.ahk.findFunctions('/**\n * A docs.\n */\nA() {\n}\n */\nB() {\n}')
    expect(fns[0].doc.summary).toBe('A docs.')
    expect(fns[1].doc).toMatchObject({ form: 'none', summary: '' })
  })

  it("does not take an earlier function's block for a comment at the end of a line of code", () => {
    const fns = LANGUAGES.ahk.findFunctions('/**\n * A docs.\n */\nA() {\n}\nx := 1 /* tweak */\nB() {\n}')
    expect(fns[0].doc.summary).toBe('A docs.')
    expect(fns[1].doc).toMatchObject({ form: 'none', summary: '' })
  })

  it('lists a function under a half-typed block without docs', () => {
    const [fn] = LANGUAGES.ahk.findFunctions('/**\n * Half typed\nThing(Macro) {\n}')
    expect(fn.name).toBe('Thing')
    expect(fn.doc.form).toBe('none')
  })

  it('reads the docs of the real helper file', () => {
    const fns = LANGUAGES.ahk.findFunctions(readRepoText('ahk/commands/helper.ahk'))
    const fn = fns.find((f) => f.name === 'ActivateOrOpen')!
    expect(fn.usage).toBe('ActivateOrOpen(Window, Program, Args := "")')
    expect(fn.doc.form).toBe('block')
    expect(fn.doc.params[0].text).toBe('The Window to check for: a window title, or a string such as "ahk_exe notepad.exe" that names the program.')
    expect(fn.doc.examples).toEqual(['ActivateOrOpen("ahk_exe notepad.exe", "notepad")'])
    expect(fn.doc.params[2]).toMatchObject({ name: 'Args', optional: true, default: '""' })
    expect(fns.find((f) => f.name === 'EncodeInteger')!.doc.returns).toBe('The result of the DllCall operation.')
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

  const HELP = [
    '<#',
    '.SYNOPSIS',
    'Clicks a mouse button at a point on the screen.',
    '.description',
    'Stands in for AutoHotkey Click.',
    '.PARAMETER X',
    'Pixels from the left edge',
    'of the screen.',
    '.PARAMETER Button',
    'Which button to click.',
    '.PARAMETER Nobody',
    'Names no parameter.',
    '.OUTPUTS',
    'Nothing.',
    '.EXAMPLE',
    'Send-Click 200 300',
    '.EXAMPLE',
    'Send-Click 200 300 -Button Right',
    '#>',
    'function Send-Click {',
    "    param([Parameter(Mandatory)][int]$X, [Parameter(Mandatory)][int]$Y, [ValidateSet('Left', 'Right')][string]$Button = 'Left', [switch]$Twice)",
    '}',
  ].join('\n')

  it('reads a help block and builds the usage line', () => {
    const [fn] = LANGUAGES.ps.findFunctions(HELP)
    expect(fn.usage).toBe('Send-Click <X> <Y> [-Button <string>] [-Twice]')
    expect(fn.description).toBe('Clicks a mouse button at a point on the screen. Stands in for AutoHotkey Click.')
    expect(fn.doc).toEqual({
      form: 'block',
      summary: 'Clicks a mouse button at a point on the screen. Stands in for AutoHotkey Click.',
      params: [
        { name: 'X', text: 'Pixels from the left edge of the screen.', type: 'int', optional: false, default: '', values: [] },
        { name: 'Y', text: '', type: 'int', optional: false, default: '', values: [] },
        { name: 'Button', text: 'Which button to click.', type: 'string', optional: true, default: "'Left'", values: ['Left', 'Right'] },
        { name: 'Twice', text: '', type: 'switch', optional: true, default: '', values: [] },
      ],
      returns: 'Nothing.',
      examples: ['Send-Click 200 300', 'Send-Click 200 300 -Button Right'],
    })
  })

  it('joins a run of # lines into the summary', () => {
    const text = '# Posts WM_CLOSE and waits,\n# and with -Force ends its process.\nfunction Close-Window {\n    param($Window, [switch]$Force, [int]$TimeoutMs = 2000)\n}'
    const [fn] = LANGUAGES.ps.findFunctions(text)
    expect(fn.doc.form).toBe('note')
    expect(fn.description).toBe('Posts WM_CLOSE and waits, and with -Force ends its process.')
    expect(fn.usage).toBe('Close-Window <Window> [-Force] [-TimeoutMs <int>]')
  })

  it('writes an untyped default as <value>, and a function without parameters as its name', () => {
    const fns = LANGUAGES.ps.findFunctions("function C { param($Url = '') }\nfunction Get-Things {\n    $x\n}")
    expect(fns.map((f) => f.usage)).toEqual(['C [-Url <value>]', 'Get-Things'])
  })

  it('keeps an array type and skips attributes with arguments', () => {
    const [fn] = LANGUAGES.ps.findFunctions('function S {\n    param([IntPtr[]]$Windows, [Parameter(Mandatory)][AllowEmptyString()][string]$Name)\n}')
    expect(fn.doc.params.map((p) => p.type)).toEqual(['IntPtr[]', 'string'])
    expect(fn.usage).toBe('S <Windows> <Name>')
  })

  it('reads no docs across a blank line, from #region or from #Requires', () => {
    const none = (text: string) => LANGUAGES.ps.findFunctions(text)[0].doc.form
    expect(none('<#\n.SYNOPSIS\nOld.\n#>\n\nfunction A {\n}')).toBe('none')
    expect(none('#region Helpers\nfunction A {\n}')).toBe('none')
    expect(none('#Requires -Version 5\nfunction A {\n}')).toBe('none')
  })

  it('lists a function under half-typed docs or with an unclosed param list', () => {
    expect(LANGUAGES.ps.findFunctions('<#\n.SYNOPSIS\nHalf typed\nfunction A {\n}')[0].doc.form).toBe('none')
    const [fn] = LANGUAGES.ps.findFunctions('function B {\n    param([string]$Exe, [int]$N = (Get-X')
    expect(fn.name).toBe('B')
    expect(fn.params[0]).toBe('Exe')
  })

  it('stops an unclosed param list at the next function', () => {
    const fns = LANGUAGES.ps.findFunctions('function B {\n    param([string]$Exe, [int]$N = (Get-X\n}\nfunction C {\n    param($Macro)\n}')
    expect(fns.map((f) => f.params)).toEqual([['Exe', 'N'], ['Macro']])
    expect(fns[0].doc.params[1].default).not.toContain('function C')
  })

  it('opens a help section only at a keyword of PowerShell help', () => {
    const [fn] = LANGUAGES.ps.findFunctions('<#\n.SYNOPSIS\nReads a value.\n.NET types are fine.\n.Description\nMore.\n#>\nfunction A {\n}')
    expect(fn.doc.summary).toBe('Reads a value. .NET types are fine. More.')
  })

  it('reads a note that starts with the letters of #region or #Requires', () => {
    expect(LANGUAGES.ps.findFunctions('#requirements: none\nfunction A {\n}')[0].doc).toMatchObject({ form: 'note', summary: 'requirements: none' })
    expect(LANGUAGES.ps.findFunctions('#regional settings\nfunction A {\n}')[0].doc).toMatchObject({ form: 'note', summary: 'regional settings' })
  })

  it('writes a parameter without a default after one with a default by name', () => {
    expect(LANGUAGES.ps.findFunctions('function F {\n    param($A, $B = 1, $C)\n}')[0].usage).toBe('F <A> [-B <value>] -C <C>')
    expect(LANGUAGES.ps.findFunctions('function F {\n    param([switch]$A, [int]$B)\n}')[0].usage).toBe('F [-A] -B <B>')
  })

  it('reads a name with a scope, and a parameter list after the name', () => {
    const fns = LANGUAGES.ps.findFunctions('function global:Send-Thing {\n    param($X, $Y = 2)\n}\nfunction Send-Other ($X,\n    $Y = 2) {\n}\nfunction Open($Macro) {\n}')
    expect(fns.map((f) => [f.name, f.params])).toEqual([['Send-Thing', ['X', 'Y']], ['Send-Other', ['X', 'Y']], ['Open', ['Macro']]])
    expect(fns[1].usage).toBe('Send-Other <X> [-Y <value>]')
    expect(isCommand(fns[2])).toBe(true)
  })

  it('reads past comments inside the parameter list', () => {
    const text = [
      'function Send-Click {',
      '    param(',
      "        # the window's left edge",
      '        [int]$X,',
      '        <# the top, $Top in pixels #>',
      '        [int]$Y,',
      "        [string]$Button = 'Left' # which one",
      '    )',
      '}',
    ].join('\n')
    const [fn] = LANGUAGES.ps.findFunctions(text)
    expect(fn.params).toEqual(['X', 'Y', 'Button'])
    expect(fn.usage).toBe('Send-Click <X> <Y> [-Button <string>]')
    expect(fn.doc.params.map((p) => [p.type, p.default])).toEqual([['int', ''], ['int', ''], ['string', "'Left'"]])
  })

  it('takes no parameter name from a comment', () => {
    expect(LANGUAGES.ps.findFunctions('function A {\n    param(\n        # Like $Path\n        $Name)\n}')[0].params).toEqual(['Name'])
  })

  it('reads a command whose parameter has a comment above it as a command', () => {
    const ps = 'function OpenIt {\n    param(\n        # Uses $Window from the caller\n        $Macro)\n}\n'
    const [fn] = LANGUAGES.ps.findFunctions(ps)
    expect(isCommand(fn)).toBe(true)
    expect(paramMismatches({ ahk: 'OpenIt(Macro) {\n}\n', ps })).toEqual([])
  })

  it('reads a type with a comma inside brackets, and a type after a comment', () => {
    expect(LANGUAGES.ps.findFunctions('function A {\n    param([Dictionary[string,int]]$Map, $B)\n}')[0].doc.params.map((p) => p.type))
      .toEqual(['Dictionary[string,int]', ''])
    expect(LANGUAGES.ps.findFunctions('function A {\n    param(\n        # left\n        [int]$X)\n}')[0].doc.params[0].type).toBe('int')
  })

  it('reads no docs from a #> with no <# above it', () => {
    expect(LANGUAGES.ps.findFunctions('#>\nfunction A {\n}')[0].doc.form).toBe('none')
  })

  it("does not take an earlier function's block for a stray #> above another", () => {
    const fns = LANGUAGES.ps.findFunctions('<#\n.SYNOPSIS\nA.\n#>\nfunction A {\n}\n#>\nfunction B {\n}')
    expect(fns[0].doc.summary).toBe('A.')
    expect(fns[1].doc).toMatchObject({ form: 'none', summary: '' })
  })

  it("does not take an earlier function's block for a comment at the end of a line of code", () => {
    const fns = LANGUAGES.ps.findFunctions('<#\n.SYNOPSIS\nDoes A.\n#>\nfunction A {\n}\n$y = 2 <# tweak #>\nfunction B {\n}')
    expect(fns[0].doc.summary).toBe('Does A.')
    expect(fns[1].doc).toMatchObject({ form: 'none', summary: '' })
  })

  it('reads a help block whose last text line closes it', () => {
    expect(LANGUAGES.ps.findFunctions('<#\n.SYNOPSIS\nDoes it. #>\nfunction A {\n}')[0].doc).toMatchObject({ form: 'block', summary: 'Does it.' })
  })

  it('reads an indented help block without its indentation', () => {
    const [fn] = LANGUAGES.ps.findFunctions('    <#\n    .SYNOPSIS\n    Clicks.\n    .EXAMPLE\n    Send-Click 1 2\n\n    Send-Click 3 4\n    #>\nfunction Send-Click {\n}')
    expect(fn.doc.examples).toEqual(['Send-Click 1 2\n\nSend-Click 3 4'])
  })

  it('builds the usage lines of real library functions', () => {
    const usage = (path: string, name: string) =>
      LANGUAGES.ps.findFunctions(readRepoText(path)).find((f) => f.name === name)!.usage
    expect(usage('powershell/lib/WindowOps.ps1', 'Wait-Window')).toBe('Wait-Window <WinTitle> [-Active] [-TimeoutMs <int>]')
    expect(usage('powershell/commands/helper.ps1', 'ActivateOrOpen')).toBe('ActivateOrOpen <Exe> <Program> [-Arguments <string>]')
    expect(usage('powershell/lib/Input.ps1', 'Send-Click')).toBe('Send-Click <X> <Y> [-Button <string>]')
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
    const f = (params: string[]) => ({ name: 'n', line: 1, params, description: '', usage: 'n', doc: emptyDoc(params) })
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

  it('tells whether an include file loads a path, as removeListing matches it', () => {
    const hub = '#Include *i Mine.AHK ; mine\n; #Include other.ahk\n#Include "sub/two.ahk"\n'
    expect(ahk.isListed(hub, 'local/ahk/mine.ahk')).toBe(true)
    expect(ahk.isListed(hub, 'local/ahk/sub/two.ahk')).toBe(true)
    // A commented-out line loads nothing.
    expect(ahk.isListed(hub, 'local/ahk/other.ahk')).toBe(false)
    expect(ahk.isListed('', 'local/ahk/mine.ahk')).toBe(false)
    expect(ahk.isListed(CONFIG_AHK, 'ahk/commands/custom/chrome.ahk')).toBe(true)
    expect(ahk.isListed(CONFIG_AHK, 'ahk/commands/custom/new.ahk')).toBe(false)
    expect(ahk.isListed(ahk.addListing(CONFIG_AHK, 'ahk/commands/custom/new.ahk'), 'ahk/commands/custom/new.ahk')).toBe(true)
  })

  it('lists nothing for PowerShell', () => {
    expect(ps.addListing('x', 'local/powershell/commands/mine.ps1')).toBe('x')
    expect(ps.removeListing('x', 'local/powershell/commands/mine.ps1')).toBe('x')
    expect(ps.isListed('', 'local/powershell/commands/mine.ps1')).toBe(true)
  })
})

describe('starter command', () => {
  it('a starter command is found as a command with its description', () => {
    for (const id of LANG_IDS) {
      const text = appendBlock('', LANGUAGES[id].starterCommand('Foo', 'Does foo'))
      const fns = LANGUAGES[id].findFunctions(text)
      expect(fns).toHaveLength(1)
      expect(fns[0]).toMatchObject({ name: 'Foo', description: 'Does foo' })
      expect(isCommand(fns[0])).toBe(true)
    }
  })

  it('has the documented text, and leaves out an empty description', () => {
    expect(LANGUAGES.ahk.starterCommand('Foo', 'Does foo')).toBe(
      '/**\n * Does foo\n * @param {Macro} Macro - The macro object.\n */\nFoo(Macro)\n{\n}',
    )
    expect(LANGUAGES.ahk.starterCommand('Foo', '')).toBe('/**\n * @param {Macro} Macro - The macro object.\n */\nFoo(Macro)\n{\n}')
    expect(LANGUAGES.ps.starterCommand('Foo', 'Does foo')).toBe('# Does foo\nfunction Foo {\n    param($Macro)\n}')
    expect(LANGUAGES.ps.starterCommand('Foo', '')).toBe('function Foo {\n    param($Macro)\n}')
  })
})

describe('starter command description', () => {
  it('keeps a */ inside the AutoHotkey comment', () => {
    const text = appendBlock('', LANGUAGES.ahk.starterCommand('Foo', 'fast */ copy'))
    expect(text).toBe('/**\n * fast * / copy\n * @param {Macro} Macro - The macro object.\n */\nFoo(Macro)\n{\n}\n')
    const fns = LANGUAGES.ahk.findFunctions(text)
    expect(fns).toMatchObject([{ name: 'Foo', line: 5, params: ['Macro'], description: 'fast * / copy' }])
    expect(isCommand(fns[0])).toBe(true)
  })

  it('makes a one-line comment of a description with line breaks, and trims it', () => {
    for (const id of LANG_IDS) {
      const block = LANGUAGES[id].starterCommand('Foo', '  one\r\ntwo \n\n three\t four  ')
      expect(block).toContain('one two three four')
      expect(block).not.toContain('\r')
      const fns = LANGUAGES[id].findFunctions(appendBlock('', block))
      expect(fns).toHaveLength(1)
      expect(fns[0]).toMatchObject({ name: 'Foo', description: 'one two three four' })
      expect(isCommand(fns[0])).toBe(true)
    }
  })

  it('leaves out the description line when nothing but whitespace is left', () => {
    expect(LANGUAGES.ahk.starterCommand('Foo', ' \n ')).toBe(LANGUAGES.ahk.starterCommand('Foo', ''))
    expect(LANGUAGES.ps.starterCommand('Foo', ' \n ')).toBe(LANGUAGES.ps.starterCommand('Foo', ''))
  })
})
