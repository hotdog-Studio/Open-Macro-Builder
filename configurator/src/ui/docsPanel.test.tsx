/** @vitest-environment jsdom */
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { replaceAll, typeAt } from '../../test/codeEditor'
import { langButton, pairButton, startCommands } from '../../test/commandsTab'
import { LANGUAGES } from '../core/languages'

// The right panel's docs, past what otherCommands.test.tsx covers: rows of one name, the state of
// groups, the one floating card, and the docs of the rows of "Commands in this file".

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const other = () => screen.getByRole('region', { name: 'Other commands available' })
const rows = (name: string) => within(other()).getAllByRole('button', { name: new RegExp(String.raw`^${name}\b`) })
const keyWarnings = (error: { mock: { calls: unknown[][] } }) => error.mock.calls.filter(([m]) => String(m).includes('same key'))

describe('the rows of Other commands available', () => {
  it('lists a function defined twice in one file as two rows', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    replaceAll('/**\n * First.\n */\nTwice(A)\n{\n}\n/**\n * Second.\n */\nTwice(A)\n{\n}\n')
    expect(rows('Twice')).toHaveLength(2)
    await user.click(rows('Twice')[0])
    expect(rows('Twice').map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'false'])
    expect(keyWarnings(error)).toEqual([])
  })
})

describe('the floating card of the panel', () => {
  const outline = () => screen.getByRole('region', { name: 'Commands in this file' })

  it('shows one card at a time, the pointer\'s over the focus\'s, and falls back to the focus\'s', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    act(() => rows('ActivateOrOpen')[0].focus())
    expect(screen.getByRole('tooltip').textContent).toContain('ActivateOrOpen(')
    const own = within(outline()).getByRole('button', { name: /^OpenFileExplorer\b/ })
    await user.hover(own)
    expect(screen.getAllByRole('tooltip')).toHaveLength(1)
    expect(screen.getByRole('tooltip').textContent).toContain('OpenFileExplorer(Macro)')
    await user.unhover(own)
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain('ActivateOrOpen('))
  })

  it('takes the card away when its row goes', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    await user.hover(within(outline()).getByRole('button', { name: /^OpenFileExplorer\b/ }))
    expect(screen.getByRole('tooltip')).toBeTruthy()
    replaceAll('OnlyThis(Macro)\n{\n}\n')
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('takes the card away when the filter hides its row', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    await user.hover(rows('ActivateOrOpen')[0])
    expect(screen.getByRole('tooltip')).toBeTruthy()
    // The pointer stays on the row while the keyboard types in the filter.
    act(() => within(other()).getByRole('textbox', { name: 'Filter other commands' }).focus())
    await user.keyboard('zzz')
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('shows what is typed in the docs of the row it is up for', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    replaceAll('/**\n * Old words.\n */\nTool(A)\n{\n}\n')
    await user.hover(rows('Tool')[0])
    expect(screen.getByRole('tooltip').textContent).toContain('Old words.')
    replaceAll('/**\n * New words.\n */\nTool(A)\n{\n}\n')
    expect(screen.getByRole('tooltip').textContent).toContain('New words.')
  })
})

describe('the rows of Commands in this file', () => {
  const outline = () => screen.getByRole('region', { name: 'Commands in this file' })
  const onlyInAhk = {
    'ahk/commands/x.ahk': '/**\n * From AHK\n */\nOnly(Macro)\n{\n}\n',
    'powershell/commands/x.ps1': '# x commands.\n',
    'powershell/lib/Other.ps1': '<#\n.SYNOPSIS\nOther\n.EXAMPLE\nOnly\n#>\nfunction Only {\n}\n',
  }

  it("shows the card of the pair's own definition, even from the other language", async () => {
    const { user } = await startCommands({ files: onlyInAhk })
    await user.click(pairButton('x'))
    await user.click(langButton('PowerShell'))
    await user.hover(within(outline()).getByRole('button', { name: /^Only\b/ }))
    const card = screen.getByRole('tooltip').textContent
    expect(card).toContain('From AHK')
    expect(card).toContain('ahk/commands/x.ahk')
    expect(card).not.toContain('Other')
  })

  it('shows the card of the other language when the shown one has no file', async () => {
    const { user } = await startCommands({ files: { 'ahk/commands/x.ahk': onlyInAhk['ahk/commands/x.ahk'] } })
    await user.click(pairButton('x'))
    await user.click(langButton('PowerShell'))
    await user.hover(within(outline()).getByRole('button', { name: /^Only\b/ }))
    expect(screen.getByRole('tooltip').textContent).toContain('From AHK')
  })

  it('shows the whole docs in the details a click opens, for touch', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    await user.click(within(outline()).getByRole('button', { name: /^OpenFileExplorer\b/ }))
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(within(outline()).getByText('OpenFileExplorer(Macro)')).toBeTruthy()
    expect(within(outline()).getByText('Used by')).toBeTruthy()
  })
})

describe('the dictionary behind the panel', () => {
  it('parses a draft once, not on every keystroke in another file', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('media'))
    typeAt(0, '; kept\n')
    await user.click(pairButton('windows'))
    const parse = vi.spyOn(LANGUAGES.ahk, 'findFunctions')
    typeAt(0, '; one\n')
    typeAt(0, '; two\n')
    expect(parse.mock.calls.filter(([text]) => text.startsWith('; kept\n'))).toHaveLength(0)
  })
})

describe('the groups of Other commands available, while filtering', () => {
  it('folds a group on a click while the filter has text, and gives it back as it was after', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    const helper = () => within(other()).getAllByRole('button', { name: /^helper\b/ })[0]
    const filter = within(other()).getByRole('textbox', { name: 'Filter other commands' })
    await user.type(filter, 'activate')
    expect(helper().getAttribute('aria-expanded')).toBe('true')
    await user.click(helper())
    expect(helper().getAttribute('aria-expanded')).toBe('false')
    expect(within(other()).queryByRole('button', { name: /^ActivateOrOpen\b/ })).toBeNull()
    await user.clear(filter)
    expect(helper().getAttribute('aria-expanded')).toBe('true')
    expect(rows('ActivateOrOpen')).toHaveLength(1)
  })

  it('opens every group with a match again when the filter changes', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    const helper = () => within(other()).getAllByRole('button', { name: /^helper\b/ })[0]
    const filter = within(other()).getByRole('textbox', { name: 'Filter other commands' })
    await user.type(filter, 'activate')
    await user.click(helper())
    await user.type(filter, 'or')
    expect(helper().getAttribute('aria-expanded')).toBe('true')
  })
})

describe('the groups of Other commands available', () => {
  it("starts each shown file's own group open, whatever was done to another's", async () => {
    const { user } = await startCommands({ files: { 'ahk/commands/tools.ahk': '/**\n * A tool.\n */\nTool(A)\n{\n}\n' } })
    await user.click(pairButton('tools'))
    const tools = () => within(other()).getAllByRole('button', { name: /^tools\b/ })[0]
    await user.click(tools())
    expect(tools().getAttribute('aria-expanded')).toBe('false')
    await user.click(pairButton('helper'))
    const shown = within(other()).getAllByRole('button', { name: /^helper\b/ })[0]
    expect(shown.getAttribute('aria-expanded')).toBe('true')
  })
})
