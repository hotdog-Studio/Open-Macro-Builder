/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildDictionary, type DictEntry } from '../../core/commands/dictionary'
import { newTextFile } from '../../core/folder/textFile'
import { commandFileAt, LANGUAGES, type CommandFile } from '../../core/languages'
import { DocCard } from './DocCard'

function cmd(path: string, text: string): CommandFile {
  const at = commandFileAt(path)!
  return {
    ...at,
    file: { ...newTextFile(path, text), version: 'v1' },
    functions: LANGUAGES[at.lang].findFunctions(text),
    editable: true,
  }
}

/** The entry for `name` in a dictionary of the one command file `path` holds. */
function entryOf(path: string, text: string, name: string): DictEntry {
  const file = cmd(path, text)
  const dict = buildDictionary({ lang: file.lang, shown: null, commandFiles: [file], libraryFiles: [], drafts: {} })
  const entry = dict.lookup(name)
  if (!entry) throw new Error(`no entry for ${name}`)
  return entry
}

/** A PowerShell command without docs whose AutoHotkey twin says "Opens the thing.". */
function borrowedEntry(): DictEntry {
  const ahk = cmd('ahk/commands/helper.ahk', '/**\n * Opens the thing.\n */\nOpenThing(Macro)\n{\n}\n')
  const ps = cmd('powershell/commands/helper.ps1', 'function OpenThing {\n    param($Macro)\n}\n')
  const entry = buildDictionary({ lang: 'ps', shown: null, commandFiles: [ahk, ps], libraryFiles: [], drafts: {} }).lookup('OpenThing')
  if (!entry) throw new Error('no entry for OpenThing')
  return entry
}

const PS = [
  '<#', '.SYNOPSIS', 'Clicks a mouse button at a point on the screen.',
  '.PARAMETER X', 'Pixels from the left edge of the screen.',
  '.PARAMETER Button', 'Which button to click.',
  '.OUTPUTS', 'Nothing useful.',
  '.EXAMPLE', 'Send-Click 200 300 -Button Right', '#>',
  'function Send-Click {',
  "    param([int]$X, [int]$Y, [ValidateSet('Left', 'Right')][string]$Button = 'Left', [switch]$Twice)",
  '}',
].join('\n')

afterEach(cleanup)

describe('DocCard', () => {
  it('shows how to call it, what it does, an example, each parameter and where it is', () => {
    render(<DocCard entry={entryOf('powershell/commands/helper.ps1', PS, 'Send-Click')} />)
    expect(screen.getByText('Send-Click <X> <Y> [-Button <string>] [-Twice]')).toBeTruthy()
    expect(screen.getByText('Clicks a mouse button at a point on the screen.')).toBeTruthy()
    expect(screen.getByText('Example')).toBeTruthy()
    expect(screen.getByText('Send-Click 200 300 -Button Right')).toBeTruthy()
    expect(screen.getByText('Pixels from the left edge of the screen.')).toBeTruthy()
    expect(screen.getByText("Optional, 'Left' when left out.")).toBeTruthy()
    expect(screen.getByText('One of: Left, Right.')).toBeTruthy()
    expect(screen.getByText('Optional.')).toBeTruthy()
    expect(screen.getByText('Returns')).toBeTruthy()
    expect(screen.getByText('Nothing useful.')).toBeTruthy()
    expect(screen.getByText('powershell/commands/helper.ps1 · line 13')).toBeTruthy()
  })

  it('shows how to call it, what it does, examples, parameters, returns and where, in that order', () => {
    const { container } = render(<DocCard entry={entryOf('powershell/commands/helper.ps1', PS, 'Send-Click')} />)
    const text = container.textContent!
    // The example comes before the parameters, and every other part is in its place too.
    expect(text.indexOf('Example')).toBeLessThan(text.indexOf('Pixels from the left edge'))
    const at = [
      'Send-Click <X> <Y>',
      'Clicks a mouse button',
      'Example',
      'Pixels from the left edge',
      'Returns',
      'powershell/commands/helper.ps1 · line',
    ].map((part) => text.indexOf(part))
    expect(at.every((n) => n >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })

  it('says so when there is no description, and still says where it is', () => {
    render(<DocCard entry={entryOf('powershell/commands/helper.ps1', 'function Bare {\n}\n', 'Bare')} />)
    expect(screen.getByText('No description.')).toBeTruthy()
    expect(screen.getByText('Bare')).toBeTruthy()
    expect(screen.getByText('powershell/commands/helper.ps1 · line 1')).toBeTruthy()
  })

  it('shows where a function without docs is, and no row for a parameter with nothing to say', () => {
    render(<DocCard entry={entryOf('powershell/commands/helper.ps1', 'function Bare {\n    param($Y)\n}\n', 'Bare')} />)
    expect(screen.getByText('Bare <Y>')).toBeTruthy()
    expect(screen.getByText('powershell/commands/helper.ps1 · line 1')).toBeTruthy()
    expect(screen.queryByText('Y')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('says whose summary a borrowed one is, in either direction', () => {
    const { unmount } = render(<DocCard entry={borrowedEntry()} />)
    expect(screen.getByText('Opens the thing.')).toBeTruthy()
    expect(screen.getByText('From the AutoHotkey version')).toBeTruthy()
    unmount()

    const ahk = cmd('ahk/commands/helper.ahk', 'OpenThing(Macro)\n{\n}\n')
    const ps = cmd('powershell/commands/helper.ps1', '# Opens the thing from PowerShell.\nfunction OpenThing {\n    param($Macro)\n}\n')
    const entry = buildDictionary({ lang: 'ahk', shown: null, commandFiles: [ahk, ps], libraryFiles: [], drafts: {} }).lookup('OpenThing')!
    render(<DocCard entry={entry} />)
    expect(screen.getByText('Opens the thing from PowerShell.')).toBeTruthy()
    expect(screen.getByText('From the PowerShell version')).toBeTruthy()
    expect(screen.queryByText('From the AutoHotkey version')).toBeNull()
  })

  it('shows an example given twice, twice', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const text = '<#\n.SYNOPSIS\nDoes it.\n.EXAMPLE\nInvoke-Twice\n.EXAMPLE\nInvoke-Twice\n#>\nfunction Invoke-Twice {\n}\n'
      const { container } = render(<DocCard entry={entryOf('powershell/commands/helper.ps1', text, 'Invoke-Twice')} />)
      expect(container.querySelectorAll('pre')).toHaveLength(2)
      expect(error.mock.calls.filter(([m]) => String(m).includes('same key'))).toEqual([])
    } finally {
      error.mockRestore()
    }
  })

  it('shows a parameter typed twice while a list is half written, twice', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const text = '<#\n.SYNOPSIS\nDoes it.\n.PARAMETER X\nThe x.\n#>\nfunction Get-Two {\n    param([int]$X, [int]$X\n}\n'
      const { container } = render(<DocCard entry={entryOf('powershell/commands/helper.ps1', text, 'Get-Two')} />)
      expect(container.querySelectorAll('li')).toHaveLength(2)
      expect(error.mock.calls.filter(([m]) => String(m).includes('same key'))).toEqual([])
    } finally {
      error.mockRestore()
    }
  })

  it('shows the type of a parameter, and a row for a parameter that has only a type', () => {
    const { container } = render(<DocCard entry={entryOf('powershell/commands/helper.ps1', 'function Move-It {\n    param([int]$X, $Y)\n}\n', 'Move-It')} />)
    const items = [...container.querySelectorAll('li')]
    expect(items.map((li) => li.textContent)).toEqual(['X int'])
  })

  it('leaves out a type that is the same word as the name', () => {
    const text = '/**\n * Opens it.\n * @param {Macro} Macro - The macro object.\n */\nOpenIt(Macro)\n{\n}\n'
    const { container } = render(<DocCard entry={entryOf('ahk/commands/helper.ahk', text, 'OpenIt')} />)
    expect(container.querySelector('li')!.firstElementChild!.textContent).toBe('Macro')
  })

  it('says what a default means in plain words', () => {
    const text = [
      'function Set-It {',
      "    param($A = '', $B = \"\", $C = $null, [switch]$D = $true, [switch]$E = $false, $F = 3)",
      '}',
    ].join('\n')
    const { container } = render(<DocCard entry={entryOf('powershell/commands/helper.ps1', text, 'Set-It')} />)
    const notes = [...container.querySelectorAll('li')].map((li) => li.lastElementChild!.textContent)
    expect(notes).toEqual([
      'Optional, empty when left out.',
      'Optional, empty when left out.',
      'Optional.',
      'Optional, on when left out.',
      'Optional, off when left out.',
      'Optional, 3 when left out.',
    ])
  })

  it('shows markup from a script as text', () => {
    const text = '<#\n.SYNOPSIS\n<img src=x onerror=alert(1)> <b>bold</b>\n.EXAMPLE\n<script>x</script>\n#>\nfunction Evil {\n}\n'
    const { container } = render(<DocCard entry={entryOf('powershell/commands/helper.ps1', text, 'Evil')} />)
    expect(container.querySelector('img, b, script')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)> <b>bold</b>')).toBeTruthy()
  })
})
