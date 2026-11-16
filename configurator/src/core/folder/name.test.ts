import { describe, expect, it } from 'vitest'
import { folderNameError } from './name'

describe('folderNameError', () => {
  it.each(['Open Macro Builder', 'macropad', 'my.pad', 'pad-2'])('accepts %s', (n) =>
    expect(folderNameError(n)).toBeNull(),
  )

  it.each([
    '', '   ', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\tb', '.', '..', 'name.', 'name ', ' name',
    'CON', 'con', 'NUL.txt', 'COM1', 'LPT9', 'x'.repeat(101),
  ])('refuses %j', (n) => expect(folderNameError(n)).toEqual(expect.any(String)))

  it('says why', () => {
    expect(folderNameError('  ')).toBe('Give the folder a name.')
    expect(folderNameError('a/b')).toBe('A folder name cannot contain \\ / : * ? " < > |')
    expect(folderNameError('name.')).toBe('A folder name cannot start with a space or end with a dot or a space.')
    expect(folderNameError('NUL.txt')).toBe('"NUL.txt" is a name Windows reserves.')
    expect(folderNameError('x'.repeat(101))).toBe('That name is too long.')
    expect(folderNameError('x'.repeat(100))).toBeNull()
  })
})
