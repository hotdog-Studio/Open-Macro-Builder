import { describe, expect, it } from 'vitest'
import { memoryFolderFromRepo, readRepoText } from '../../../test/repo'
import { isCommand, LANGUAGES, scanCommands } from '../languages'
import { commandCount, commandPairs, languagesDiffer } from './pairs'

async function load(extra: Record<string, string> = {}) {
  const folder = memoryFolderFromRepo(['ahk/commands', 'powershell/commands'])
  for (const [path, text] of Object.entries(extra)) await folder.writeBytes(path, new TextEncoder().encode(text))
  return commandPairs(await scanCommands(folder))
}

describe('commandPairs', () => {
  it('pairs each file once, yours first', async () => {
    const pairs = await load({
      'local/ahk/mine.ahk': 'Mine(Macro) {\n}\n',
      'local/powershell/commands/mine.ps1': 'function Mine { param($Macro) }\n',
    })
    expect(pairs[0]).toMatchObject({ key: 'yours:mine', group: 'yours', pair: 'mine' })
    expect(Object.keys(pairs[0].files)).toEqual(['ahk', 'ps'])
    const keys = pairs.map((p) => p.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys.filter((k) => k.startsWith('yours:'))).toEqual(['yours:mine'])
    const chrome = pairs.find((p) => p.key === 'shared:custom/chrome')!
    expect(chrome.files.ahk?.file.path).toBe('ahk/commands/custom/chrome.ahk')
    expect(chrome.files.ps?.file.path).toBe('powershell/commands/custom/chrome.ps1')
  })
})

describe('commandCount', () => {
  it('counts commands only', async () => {
    const pairs = await load()
    const file = pairs.find((p) => p.key === 'shared:custom/chrome')!.files.ahk!
    const expected = LANGUAGES.ahk
      .findFunctions(readRepoText('ahk/commands/custom/chrome.ahk'))
      .filter(isCommand).length
    expect(expected).toBeGreaterThan(0)
    expect(commandCount(file)).toBe(expected)
  })

  it('ignores helpers', async () => {
    const pairs = await load({ 'local/ahk/h.ahk': 'Helper(X) {\n}\nCmd(Macro) {\n}\n' })
    expect(commandCount(pairs.find((p) => p.key === 'yours:h')!.files.ahk!)).toBe(1)
  })
})

describe('languagesDiffer', () => {
  it('is false for a shared pair that has the same commands in both languages', async () => {
    const pairs = await load()
    expect(languagesDiffer(pairs.find((p) => p.key === 'shared:custom/chrome')!)).toBe(false)
  })

  it('is true when the PowerShell file lacks an AutoHotkey command', async () => {
    const pairs = await load({
      'local/ahk/gap.ahk': 'One(Macro) {\n}\nTwo(Macro) {\n}\n',
      'local/powershell/commands/gap.ps1': 'function One { param($Macro) }\n',
    })
    expect(languagesDiffer(pairs.find((p) => p.key === 'yours:gap')!)).toBe(true)
  })

  it('is true for a pair with only an AutoHotkey file that has commands', async () => {
    const pairs = await load({ 'local/ahk/solo.ahk': 'One(Macro) {\n}\n' })
    expect(languagesDiffer(pairs.find((p) => p.key === 'yours:solo')!)).toBe(true)
  })

  it('ignores case, and a lone file without commands does not differ', async () => {
    const pairs = await load({
      'local/ahk/case.ahk': 'One(Macro) {\n}\n',
      'local/powershell/commands/case.ps1': 'function ONE { param($Macro) }\n',
      'local/ahk/empty.ahk': 'Helper(X) {\n}\n',
    })
    expect(languagesDiffer(pairs.find((p) => p.key === 'yours:case')!)).toBe(false)
    expect(languagesDiffer(pairs.find((p) => p.key === 'yours:empty')!)).toBe(false)
  })
})
