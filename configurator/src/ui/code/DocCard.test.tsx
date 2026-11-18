/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
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

  it('puts the example before the parameters', () => {
    const { container } = render(<DocCard entry={entryOf('powershell/commands/helper.ps1', PS, 'Send-Click')} />)
    const text = container.textContent!
    expect(text.indexOf('Example')).toBeLessThan(text.indexOf('Pixels from the left edge'))
  })

  it('says so when there is no description', () => {
    render(<DocCard entry={entryOf('powershell/commands/helper.ps1', 'function Bare {\n}\n', 'Bare')} />)
    expect(screen.getByText('No description.')).toBeTruthy()
    expect(screen.getByText('Bare')).toBeTruthy()
  })

  it('says whose summary a borrowed one is', () => {
    render(<DocCard entry={borrowedEntry()} />)
    expect(screen.getByText('Opens the thing.')).toBeTruthy()
    expect(screen.getByText('From the AutoHotkey version')).toBeTruthy()
  })

  it('shows markup from a script as text', () => {
    const text = '<#\n.SYNOPSIS\n<img src=x onerror=alert(1)> <b>bold</b>\n.EXAMPLE\n<script>x</script>\n#>\nfunction Evil {\n}\n'
    const { container } = render(<DocCard entry={entryOf('powershell/commands/helper.ps1', text, 'Evil')} />)
    expect(container.querySelector('img, b, script')).toBeNull()
    expect(screen.getByText('<img src=x onerror=alert(1)> <b>bold</b>')).toBeTruthy()
  })
})
