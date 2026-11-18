/** @vitest-environment jsdom */
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { editorView, replaceAll } from '../../test/codeEditor'
import { langButton, pairButton, startCommands } from '../../test/commandsTab'

afterEach(cleanup)

const DEMO = '# Demo tools\n\n<#\n.SYNOPSIS\nDoes the demo thing.\n.EXAMPLE\nInvoke-Demo\n#>\nfunction Invoke-Demo {\n}\n\n# Internal note.\nfunction Get-DemoInternal {\n}\n'
const files = { 'powershell/lib/Demo.ps1': DEMO }
const start = () => startCommands({ files })
const other = () => screen.getByRole('region', { name: 'Other commands available' })
const group = (name: RegExp) => within(other()).getByRole('button', { name })
const row = (name: string) => within(other()).getByRole('button', { name: new RegExp(String.raw`^${name}\b`) })

describe('Other commands available', () => {
  it('lists what the shown AutoHotkey file can call, under the outline', async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    expect(within(other()).getByText('What your commands can call. Hover a name for its docs.')).toBeTruthy()
    expect(within(other()).getByText('Functions to call')).toBeTruthy()
    // helper.ahk has both documented functions and commands: its group is in each list, open under the first only.
    const helpers = within(other()).getAllByRole('button', { name: /^helper/ })
    expect(helpers.map((b) => b.getAttribute('aria-expanded'))).toEqual(['true', 'false'])
    expect(within(row('ActivateOrOpen')).getByText('Activates an existing Window or opens a Program if the Window does not exist.')).toBeTruthy()
    expect(within(other()).getByText("AutoHotkey's own functions, such as Send and Run, are not listed here. They are described at autohotkey.com/docs/v2.")).toBeTruthy()
    // Below the outline, in the same panel.
    const outline = screen.getByRole('region', { name: 'Commands in this file' })
    expect(outline.compareDocumentPosition(other()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('opens and closes a group in its own list only', async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    const helpers = () => within(other()).getAllByRole('button', { name: /^helper/ })
    const states = () => helpers().map((b) => b.getAttribute('aria-expanded'))
    expect(states()).toEqual(['true', 'false'])
    await user.click(helpers()[1])
    expect(states()).toEqual(['true', 'true'])
    await user.click(helpers()[0])
    expect(states()).toEqual(['false', 'true'])
  })

  it('keeps the commands of other files closed until asked, and leaves the shown file out', async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    expect(within(other()).getByText('Commands in other files')).toBeTruthy()
    expect(group(/^media/).getAttribute('aria-expanded')).toBe('false')
    expect(within(other()).queryByRole('button', { name: /^PreviousTrack\b/ })).toBeNull()
    await user.click(group(/^media/))
    expect(row('PreviousTrack')).toBeTruthy()
    expect(within(other()).queryByRole('button', { name: /^windows\b/ })).toBeNull()
  })

  it("lists a library function that has a help block, under its file's title", async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    await user.click(langButton('PowerShell'))
    expect(group(/^Demo tools/).textContent).toContain('lib/Demo')
    expect(within(row('Invoke-Demo')).getByText('Does the demo thing.')).toBeTruthy()
    expect(within(other()).queryByRole('button', { name: /^Get-DemoInternal\b/ })).toBeNull()
    expect(within(other()).getByText("PowerShell's own cmdlets are not listed here.")).toBeTruthy()
  })

  it('filters by name and by what it does, as plain text', async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    await user.click(langButton('PowerShell'))
    const filter = within(other()).getByRole('textbox', { name: 'Filter other commands' })
    await user.type(filter, 'demo thing')
    expect(row('Invoke-Demo')).toBeTruthy()
    expect(within(other()).queryByRole('button', { name: /^helper/ })).toBeNull()
    await user.clear(filter)
    await user.type(filter, 'Send-([[') // user-event reads [[ as one [
    expect(within(other()).getByText('Nothing matches.')).toBeTruthy()
    await user.clear(filter)
    await user.type(filter, 'previoustrack')
    expect(row('PreviousTrack')).toBeTruthy() // a match opens its closed group
  })

  it('shows the card for a row under the pointer or the keyboard, and takes it away', async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    await user.hover(row('ActivateOrOpen'))
    expect(screen.getByRole('tooltip').textContent).toContain('ActivateOrOpen(Window, Program, Args := "")')
    await user.unhover(row('ActivateOrOpen'))
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    act(() => row('ActivateOrOpen').focus())
    expect(screen.getByRole('tooltip')).toBeTruthy()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('opens the docs under a row on a click, and does nothing else', async () => {
    const { user, editor } = await start()
    await user.click(pairButton('windows'))
    const before = editorView().state.doc.toString()
    const jump = editor().commands.jump
    const caret = editorView().state.selection.main.head
    await user.click(row('ActivateOrOpen'))
    expect(row('ActivateOrOpen').getAttribute('aria-expanded')).toBe('true')
    expect(within(other()).getByText('ahk/commands/helper.ahk · line 11')).toBeTruthy()
    expect(editorView().state.doc.toString()).toBe(before)
    expect(pairButton('windows').getAttribute('aria-current')).toBe('true')
    // No jump to the definition, and the caret stays where it was.
    expect(editor().commands.jump).toBe(jump)
    expect(editorView().state.selection.main.head).toBe(caret)
    await user.click(row('ActivateOrOpen'))
    expect(row('ActivateOrOpen').getAttribute('aria-expanded')).toBe('false')
  })

  it('gives the rows of Commands in this file the card too, and keeps their click', async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    const outline = screen.getByRole('region', { name: 'Commands in this file' })
    const own = within(outline).getByRole('button', { name: /^OpenFileExplorer\b/ })
    await user.hover(own)
    expect(screen.getByRole('tooltip').textContent).toContain('OpenFileExplorer(Macro)')
    await user.click(own)
    expect(within(outline).getByText('Used by')).toBeTruthy()
  })

  it('follows what is typed in the shown file', async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    replaceAll('/**\n * A tool typed just now.\n */\nJustTyped(A, B)\n{\n}\n')
    expect(within(row('JustTyped')).getByText('A tool typed just now.')).toBeTruthy()
  })

  it('works in a folder that has no library', async () => {
    const { user } = await startCommands()
    await user.click(pairButton('windows'))
    await user.click(langButton('PowerShell'))
    expect(within(other()).queryByText(/^lib\//)).toBeNull()
    expect(within(other()).getByText('Commands in other files')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
