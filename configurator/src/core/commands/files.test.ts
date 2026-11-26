import { describe, expect, it } from 'vitest'
import type { CommandFile } from '../languages'
import { checkNewFile, newFilePath } from './files'

const held = (path: string): CommandFile => ({
  lang: path.endsWith('.ahk') ? 'ahk' : 'ps',
  group: path.startsWith('local/') ? 'yours' : 'shared',
  pair: 'x',
  file: { path, text: '', eol: '\n', bom: false, version: 'v' },
  functions: [],
  editable: true,
})

describe('newFilePath', () => {
  it('puts your files under local/ and shared ones next to the shared command sets', () => {
    expect(newFilePath('ahk', 'yours', 'new')).toBe('local/ahk/new.ahk')
    expect(newFilePath('ps', 'yours', 'new')).toBe('local/powershell/commands/new.ps1')
    expect(newFilePath('ahk', 'shared', 'new')).toBe('ahk/commands/custom/new.ahk')
    expect(newFilePath('ps', 'shared', 'new')).toBe('powershell/commands/custom/new.ps1')
  })
})

describe('checkNewFile', () => {
  const files = [held('local/ahk/mine.ahk'), held('powershell/commands/custom/chrome.ps1')]

  it('accepts a new name', () => {
    expect(checkNewFile(files, 'new_one-2', 'yours', ['ahk', 'ps'])).toBeNull()
    expect(checkNewFile(files, 'mine', 'shared', ['ahk', 'ps'])).toBeNull()
    expect(checkNewFile(files, 'chrome', 'shared', ['ahk'])).toBeNull()
  })

  it('wants a name', () => {
    expect(checkNewFile(files, '', 'yours', ['ahk'])).toBe('Enter a name.')
    expect(checkNewFile(files, '   ', 'yours', ['ahk'])).toBe('Enter a name.')
  })

  it('takes letters, digits, _ and - only', () => {
    for (const name of ['a b', 'sub/new', 'sub\\new', 'new.ahk', 'café']) {
      expect(checkNewFile(files, name, 'yours', ['ahk'])).toBe('Use letters, digits, _ and - only.')
    }
  })

  it('wants a language', () => {
    expect(checkNewFile(files, 'new', 'yours', [])).toBe('Choose at least one language.')
  })

  it('refuses a file that already exists, ignoring case', () => {
    expect(checkNewFile(files, 'Mine', 'yours', ['ahk'])).toBe('local/ahk/Mine.ahk already exists.')
    expect(checkNewFile(files, 'chrome', 'shared', ['ps'])).toBe('powershell/commands/custom/chrome.ps1 already exists.')
  })

  it('lets a name through when only some of the chosen languages have the file', () => {
    const half = [held('local/ahk/x.ahk')]
    expect(checkNewFile(half, 'x', 'yours', ['ahk', 'ps'])).toBeNull()
    expect(checkNewFile(half, 'x', 'yours', ['ps', 'ahk'])).toBeNull()
    expect(checkNewFile(files, 'Mine', 'yours', ['ps', 'ahk'])).toBeNull()
  })

  it('still refuses a name every chosen language has', () => {
    const both = [held('local/ahk/x.ahk'), held('local/powershell/commands/x.ps1')]
    expect(checkNewFile(both, 'x', 'yours', ['ahk', 'ps'])).toBe('local/ahk/x.ahk already exists.')
    expect(checkNewFile(both, 'X', 'yours', ['ps', 'ahk'])).toBe('local/powershell/commands/X.ps1 already exists.')
  })

  it('refuses the name of the include hub', () => {
    expect(checkNewFile(files, 'commands', 'yours', ['ahk'])).toBe('local/ahk/commands.ahk already exists.')
    expect(checkNewFile(files, 'commands', 'yours', ['ps'])).toBeNull()
    // Not a half-made pair either: the hub is refused whatever else is chosen.
    expect(checkNewFile(files, 'commands', 'yours', ['ahk', 'ps'])).toBe('local/ahk/commands.ahk already exists.')
  })
})
