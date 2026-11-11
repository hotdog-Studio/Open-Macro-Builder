import { StringStream } from '@codemirror/language'
import { describe, expect, it } from 'vitest'
import { ahkMode } from './ahkMode'

/** Runs the parser over the lines and returns the non-blank tokens as [text, style] pairs. */
function tokens(...lines: string[]): [string, string | null][] {
  const state = ahkMode.startState!(2)
  const out: [string, string | null][] = []
  for (const line of lines) {
    const stream = new StringStream(line, 4, 2)
    while (!stream.eol()) {
      const style = ahkMode.token(stream, state)
      const text = stream.current()
      stream.start = stream.pos
      if (text.trim() !== '') out.push([text, style])
    }
  }
  return out
}

describe('ahkMode', () => {
  it('a semicolon after a space starts a comment', () => {
    expect(tokens('x := 1 ; the rest, "all" of it')).toContainEqual([
      '; the rest, "all" of it',
      'comment',
    ])
    expect(tokens('; whole line')).toEqual([['; whole line', 'comment']])
  })

  it('a semicolon inside a string does not', () => {
    const t = tokens('x := "a;b"')
    expect(t).toContainEqual(['"a;b"', 'string'])
    expect(t.some(([, s]) => s === 'comment')).toBe(false)
  })

  it('block comments span lines', () => {
    expect(tokens('/* one', 'two', 'three */ x')).toEqual([
      ['/* one', 'comment'],
      ['two', 'comment'],
      ['three */', 'comment'],
      ['x', null],
    ])
  })

  it('directives are meta', () => {
    expect(tokens('#Include x.ahk')[0]).toEqual(['#Include', 'meta'])
  })

  it('keywords', () => {
    expect(tokens('if x')[0]).toEqual(['if', 'keyword'])
    expect(tokens('return 1')).toEqual([
      ['return', 'keyword'],
      ['1', 'number'],
    ])
    expect(tokens('iffy')).toEqual([['iffy', null]])
  })

  it('an escaped quote stays inside the string', () => {
    expect(tokens('s := "a`"b" . 2')).toContainEqual(['"a`"b"', 'string'])
    expect(tokens("s := 'it`'s'")).toContainEqual(["'it`'s'", 'string'])
  })
})
