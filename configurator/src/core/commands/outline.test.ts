import { describe, expect, it } from 'vitest'
import { readRepoText } from '../../../test/repo'
import { isCommand, LANGUAGES } from '../languages'
import { pairOutline, paramMismatches } from './outline'

describe('pairOutline', () => {
  it('outlines both languages of chrome', () => {
    const ahk = readRepoText('ahk/commands/custom/chrome.ahk')
    const ps = readRepoText('powershell/commands/custom/chrome.ps1')
    const ahkCommands = LANGUAGES.ahk.findFunctions(ahk).filter(isCommand)
    const psCommands = LANGUAGES.ps.findFunctions(ps).filter(isCommand)
    expect(ahkCommands.length).toBeGreaterThan(0)

    const outline = pairOutline({ ahk, ps })
    // Both files define the same commands, so each name is listed once, in AutoHotkey order.
    expect(outline.map((e) => e.name)).toEqual(ahkCommands.map((f) => f.name))
    for (const [i, entry] of outline.entries()) {
      expect(entry.in.ahk).toEqual({ line: ahkCommands[i].line, description: ahkCommands[i].description })
      const other = psCommands.find((f) => f.name.toLowerCase() === entry.name.toLowerCase())
      expect(entry.in.ps).toEqual(other && { line: other.line, description: other.description })
    }
  })

  it('orders names only in PowerShell after the AutoHotkey ones', () => {
    const outline = pairOutline({
      ahk: 'Zed(Macro) {\n}\nAlpha(Macro) {\n}\n',
      ps: 'function Early { param($Macro) }\nfunction alpha { param($Macro) }\nfunction Late { param($Macro) }\n',
    })
    expect(outline.map((e) => e.name)).toEqual(['Zed', 'Alpha', 'Early', 'Late'])
    // Names match ignoring case, and the first spelling wins.
    expect(outline[1].in).toEqual({ ahk: { line: 3, description: '' }, ps: { line: 2, description: '' } })
    expect(outline[0].in.ps).toBeUndefined()
    expect(outline[2].in.ahk).toBeUndefined()
  })

  it('outlines one language when only its text is given', () => {
    expect(pairOutline({ ps: 'function Only { param($Macro) }\n' }).map((e) => e.name)).toEqual(['Only'])
    expect(pairOutline({})).toEqual([])
  })
})

describe('paramMismatches', () => {
  it('finds a misspelled parameter', () => {
    const texts = { ahk: 'Foo(Macro)\n{\n}\n', ps: 'function Foo { param($amacrorgs) $amacrorgs }\n' }
    expect(paramMismatches(texts)).toEqual([{ lang: 'ps', name: 'Foo', line: 1, param: 'amacrorgs' }])
  })

  it('reports the spelling the language file itself uses', () => {
    const texts = { ahk: 'Foo(Macro)\n{\n}\n', ps: 'function foo { param($x) }\n' }
    expect(paramMismatches(texts)).toEqual([{ lang: 'ps', name: 'foo', line: 1, param: 'x' }])
  })

  it('ignores a same-named helper with two parameters', () => {
    const texts = { ahk: 'Foo(Macro)\n{\n}\n', ps: 'function Foo { param($a, $b) }\n' }
    expect(paramMismatches(texts)).toEqual([])
  })

  it('reports nothing for a language whose text is not given, or that has the command', () => {
    expect(paramMismatches({ ahk: 'Foo(Macro)\n{\n}\n' })).toEqual([])
    expect(paramMismatches({ ahk: 'Foo(Macro)\n{\n}\n', ps: 'function foo { param($macro) }\n' })).toEqual([])
  })
})
