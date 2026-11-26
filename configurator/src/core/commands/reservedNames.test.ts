import { describe, expect, it } from 'vitest'
import { AHK_REFERENCE } from './ahkReference'
import { AHK_BUILTINS, AHK_RESERVED_WORDS, reservedAs } from './reservedNames'

describe('reservedAs', () => {
  it.each(['if', 'Loop', 'RETURN', 'isset'])('%s is a reserved word', (name) => {
    expect(reservedAs(name)).toBe('word')
  })

  it.each(['Send', 'run', 'Sleep', 'WinActivate', 'MsgBox', 'DllCall', 'Map', 'Array', 'Gui', 'IsInteger', 'isnumber', 'IsXDigit'])(
    "%s is one of AutoHotkey's own",
    (name) => {
      expect(reservedAs(name)).toBe('builtin')
    },
  )

  it.each(['OpenCalculator', 'MyCommand', '_x', 'Go', ''])('%s is free', (name) => {
    expect(reservedAs(name)).toBeNull()
  })

  it('knows every function of the Is page, which the index of functions mostly leaves out', () => {
    // https://www.autohotkey.com/docs/v2/lib/Is.htm, read 2026-11-26.
    const page = ['IsInteger', 'IsFloat', 'IsNumber', 'IsObject', 'IsLabel', 'IsSetRef', 'IsDigit', 'IsXDigit', 'IsAlpha', 'IsUpper', 'IsLower', 'IsAlnum', 'IsSpace', 'IsTime']
    expect(page.filter((name) => reservedAs(name) !== 'builtin')).toEqual([])
    expect(reservedAs('IsSet')).toBe('word')
  })

  it('knows every function the bundled reference describes', () => {
    // IsSet is the one the documentation lists among the functions and also reserves as a word.
    for (const { fn } of AHK_REFERENCE.entries) expect(reservedAs(fn.name), fn.name).toBe(fn.name === 'IsSet' ? 'word' : 'builtin')
  })
})

describe('the two lists', () => {
  it.each([
    ['AHK_RESERVED_WORDS', AHK_RESERVED_WORDS],
    ['AHK_BUILTINS', AHK_BUILTINS],
  ])('%s is lower case, without a repeat and without anything a command name cannot be', (_, list) => {
    expect(list.every((name) => /^[a-z_]\w*$/.test(name))).toBe(true)
    expect(new Set(list).size).toBe(list.length)
  })

  it('AHK_BUILTINS is sorted', () => {
    expect(AHK_BUILTINS).toEqual([...AHK_BUILTINS].sort())
  })

  it('a name is on one list only: control flow is a reserved word, not one of the functions', () => {
    const words = new Set(AHK_RESERVED_WORDS)
    expect(AHK_BUILTINS.filter((name) => words.has(name))).toEqual([])
  })
})
