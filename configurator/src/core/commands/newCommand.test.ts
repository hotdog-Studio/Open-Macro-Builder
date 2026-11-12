import { describe, expect, it } from 'vitest'
import type { CommandFile } from '../languages'
import { appendBlock, checkCommandName } from './newCommand'

const held = (path: string, text: string): CommandFile => ({
  lang: path.endsWith('.ahk') ? 'ahk' : 'ps',
  group: path.startsWith('local/') ? 'yours' : 'shared',
  pair: 'x',
  file: { path, text, eol: '\n', bom: false, version: 'v' },
  functions: [],
  editable: true,
})

describe('appendBlock', () => {
  it('starts an empty file with the block', () => {
    expect(appendBlock('', 'B')).toBe('B\n')
  })

  it('leaves a blank line after text that ends in a newline', () => {
    expect(appendBlock('A\n', 'B')).toBe('A\n\nB\n')
  })

  it('keeps a file without a final newline that way', () => {
    expect(appendBlock('A', 'B')).toBe('A\n\nB')
  })
})

describe('checkCommandName', () => {
  const files = [
    held('local/ahk/mine.ahk', 'Mine(Macro)\n{\n}\n'),
    held('ahk/commands/custom/other.ahk', 'Other(Macro)\n{\n}\n'),
    held('local/powershell/commands/only.ps1', 'function OnlyPs {\n    param($Macro)\n}\n'),
  ]

  it('accepts a free name', () => {
    expect(checkCommandName(files, {}, 'ahk', 'Fresh_1')).toBeNull()
  })

  it('refuses a name another AutoHotkey file defines, ignoring case', () => {
    expect(checkCommandName(files, {}, 'ahk', 'OTHER')).toBe('OTHER is already defined in AutoHotkey (ahk/commands/custom/other.ahk).')
    expect(checkCommandName(files, {}, 'ahk', 'mine')).toBe('mine is already defined in AutoHotkey (local/ahk/mine.ahk).')
  })

  it('allows a name only the other language defines', () => {
    expect(checkCommandName(files, {}, 'ahk', 'OnlyPs')).toBeNull()
    expect(checkCommandName(files, {}, 'ps', 'Mine')).toBeNull()
    expect(checkCommandName(files, {}, 'ps', 'onlyps')).toBe(
      'onlyps is already defined in PowerShell (local/powershell/commands/only.ps1).',
    )
  })

  it('counts names that exist only in a draft', () => {
    const drafts = { 'local/ahk/mine.ahk': 'Mine(Macro)\n{\n}\nDrafted(Macro)\n{\n}\n' }
    expect(checkCommandName(files, drafts, 'ahk', 'drafted')).toBe('drafted is already defined in AutoHotkey (local/ahk/mine.ahk).')
    // A draft that dropped a name frees it.
    expect(checkCommandName(files, { 'local/ahk/mine.ahk': '' }, 'ahk', 'Mine')).toBeNull()
  })

  it('refuses a name with a hyphen', () => {
    const message = 'A command name starts with a letter or _ and uses only letters, digits and _.'
    expect(checkCommandName(files, {}, 'ahk', 'my-command')).toBe(message)
    expect(checkCommandName(files, {}, 'ahk', '')).toBe(message)
    expect(checkCommandName(files, {}, 'ahk', '1abc')).toBe(message)
  })
})
