/** @vitest-environment jsdom */
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { editorView, replaceAll } from '../../test/codeEditor'
import { langButton, pairButton, startCommands } from '../../test/commandsTab'
import { REFERENCE_GROUPS } from '../core/commands/reference'

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
    expect(within(row('ActivateOrOpen')).getByText("Activates the Window, or opens the Program when no such Window exists. When a matching window is already active, the bottom one comes forward instead, so pressing the key again steps through the program's windows. After starting the Program it waits up to 5 seconds for the Window to appear and activates it; if none appears in that time, nothing is activated.")).toBeTruthy()
    expect(other().lastElementChild!.textContent).toBe(
      "Everything else AutoHotkey has, such as its A_ variables and directives like #Include, is described at https://www.autohotkey.com/docs/v2/",
    )
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

  /** The group buttons of the list under the heading `title`, such as "AutoHotkey's own functions". */
  const groupsUnder = (title: string) => {
    const list = within(other()).getByRole('heading', { name: title }).nextElementSibling as HTMLElement
    return within(list).getAllByRole('button', { expanded: false })
  }

  it("lists AutoHotkey's own functions after the folder's, by group, closed until asked", async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    const heading = within(other()).getByRole('heading', { name: "AutoHotkey's own functions" })
    const commands = within(other()).getByRole('heading', { name: 'Commands in other files' })
    expect(commands.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const labels = groupsUnder("AutoHotkey's own functions").map((b) => b.textContent!.replace(/^[▸▾]/, '').replace(/\d+$/, '').trim())
    expect(labels).toEqual([...REFERENCE_GROUPS])
    expect(within(other()).queryByRole('button', { name: /^Send\b/ })).toBeNull()
    await user.click(group(/^Keys and mouse/))
    expect(within(row('Send')).getByText(/^Presses keys and types text in the active window/)).toBeTruthy()
  })

  it("shows a built-in's card from the list, with what the PowerShell version uses and its page", async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    await user.click(group(/^Sound/))
    await user.hover(row('SoundSetMute'))
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('SoundSetMute(NewSetting, Component?, Device?)')
    expect(tip.textContent).toContain('In the PowerShell version: Set-SoundMute, Switch-SoundMute')
    expect(tip.textContent).toContain('https://www.autohotkey.com/docs/v2/lib/SoundSetMute.htm')
  })

  it("finds AutoHotkey's own functions with the filter", async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    await user.type(within(other()).getByRole('textbox', { name: 'Filter other commands' }), 'clipboard')
    expect(row('ClipWait')).toBeTruthy()
    expect(group(/^The clipboard/).getAttribute('aria-expanded')).toBe('true')
    expect(within(other()).queryByRole('button', { name: /^Sound\b/ })).toBeNull()
  })

  it("lists a function of the folder named like a built-in in the folder's group, and gives its card first", async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    replaceAll('/**\n * My own sleep.\n * @param Delay - How long.\n */\nSleep(Delay)\n{\n}\n')
    await user.click(group(/^Waiting and timing/))
    // The folder's function heads the list; the built-in stays in its own group, with its own card.
    const [own, builtIn] = within(other()).getAllByRole('button', { name: /^Sleep\b/ })
    expect(within(own).getByText('My own sleep.')).toBeTruthy()
    await user.hover(own)
    expect(screen.getByRole('tooltip').textContent).toContain('My own sleep.')
    await user.hover(builtIn)
    await waitFor(() => expect(screen.getByRole('tooltip').textContent).toContain('https://www.autohotkey.com/docs/v2/lib/Sleep.htm'))
  })

  it('lists none of them for a PowerShell file', async () => {
    const { user } = await start()
    await user.click(pairButton('windows'))
    await user.click(langButton('PowerShell'))
    expect(within(other()).queryByRole('heading', { name: "AutoHotkey's own functions" })).toBeNull()
    expect(within(other()).queryByRole('button', { name: /^Keys and mouse\b/ })).toBeNull()
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
