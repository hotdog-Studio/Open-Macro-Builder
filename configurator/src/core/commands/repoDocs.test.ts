import { describe, expect, it } from 'vitest'
import { memoryFolderFromRepo } from '../../../test/repo'
import { scanCommands, scanLibrary, type LangId } from '../languages'
import { buildDictionary, listSections } from './dictionary'

// The configurator's parsers against the real scripts: they must read the help blocks that
// ahk/commands and powershell/lib carry.

const folder = memoryFolderFromRepo(['ahk/commands', 'powershell/commands', 'powershell/lib'])

async function sections(lang: LangId) {
  const commandFiles = await scanCommands(folder)
  const libraryFiles = await scanLibrary(folder)
  const shown = commandFiles.find((f) => f.lang === lang && f.pair === 'windows')!.file.path
  const dict = buildDictionary({ lang, shown, commandFiles, libraryFiles, drafts: {} })
  return { dict, ...listSections(dict) }
}

describe('the real scripts, as the Commands tab reads them', () => {
  // 63 functions have a help block; Message and ReplaceMe of helper.ps1 are commands, so 61 are functions to call.
  it('lists the 61 documented PowerShell functions to call, each with a summary and an example', async () => {
    const { functions } = await sections('ps')
    const entries = functions.flatMap((g) => g.entries)
    expect(entries).toHaveLength(61)
    expect(entries.filter((e) => e.summary === '' || e.fn.doc.examples.length === 0).map((e) => e.fn.name)).toEqual([])
    expect(entries.filter((e) => e.fn.doc.params.some((p) => p.text === '')).map((e) => e.fn.name)).toEqual([])
  })

  it('heads the library groups with their titles and keeps internals out', async () => {
    const { functions } = await sections('ps')
    expect(functions.map((g) => [g.group.label, g.group.file])).toEqual([
      ['custom/chrome', null],
      ['custom/ssh', null],
      ['helper', null],
      ['Keys and mouse clicks', 'lib/Input'],
      ['Pausing', 'lib/Pump'],
      ['Mouse, screen and tooltips', 'lib/Screen'],
      ['Typing and waiting for keys', 'lib/Send'],
      ['Sound volume', 'lib/Sound'],
      ['Finding windows', 'lib/WinTitle'],
      ['Programs and their windows', 'lib/Window'],
      ['Windows and their controls', 'lib/WindowOps'],
    ])
    const names = functions.flatMap((g) => g.entries.map((e) => e.fn.name))
    for (const internal of ['Get-VirtualKey', 'Resolve-WindowTarget', 'Hotkey', 'Invoke-EngineKey']) expect(names).not.toContain(internal)
  })

  it('still gives an internal function a card', async () => {
    const { dict } = await sections('ps')
    expect(dict.lookup('get-virtualkey')?.fn.usage).toBe('Get-VirtualKey <Name>')
  })

  it('lists the documented AutoHotkey helpers', async () => {
    const { functions } = await sections('ahk')
    const helper = functions.find((g) => g.group.label === 'helper')!
    expect(helper.entries.map((e) => e.fn.name)).toEqual(
      ['ActivateOrOpen', 'Open', 'EnsureActiveOrOpen', 'RunPythonScript', 'RunPowerShellScript', 'RunBatchScript'],
    )
  })

  it('gives every AutoHotkey helper to call a one-line example of a call to it', async () => {
    const { functions } = await sections('ahk')
    const groups = functions.filter((g) => ['helper', 'custom/chrome', 'custom/ssh'].includes(g.group.label))
    expect(groups).toHaveLength(3)
    const entries = groups.flatMap((g) => g.entries)
    expect(entries.map((e) => e.fn.name)).toEqual(expect.arrayContaining(['ActivateOrOpenChrome', 'LoadPuttySession']))
    const bad = entries.filter(
      (e) => e.fn.doc.examples.length === 0 || e.fn.doc.examples.some((x) => x.includes('\n') || !x.startsWith(`${e.fn.name}(`)),
    )
    expect(bad.map((e) => e.fn.name)).toEqual([])
  })
})
