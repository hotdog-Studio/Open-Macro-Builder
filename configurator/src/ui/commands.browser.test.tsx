import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { click, dirty, drag, openTab, padKey, startApp, strip, unmount } from '../../test/browser/harness'
import { editorView } from '../../test/codeEditor'

// The Commands tab in a real browser, where the code editor really types, selects, scrolls and
// takes focus. The example repository has no files of "yours", so every pair is shared. The first
// pair listed is custom/automation.

afterEach(unmount)

const MEDIA = 'ahk/commands/media.ahk'
const POWER = 'ahk/commands/power.ahk'

const start = () => startApp('Commands')

const nav = () => screen.getByRole('navigation', { name: 'Command files' })
const pairButton = (name: string) => within(nav()).getByRole('button', { name: new RegExp(`^${name}\\b`) })
const editorEl = () => document.querySelector<HTMLElement>('.cm-content')!
const scroller = () => document.querySelector<HTMLElement>('.cm-scroller')!
const text = () => editorView().state.doc.toString()
const toolbar = () => screen.getByRole('toolbar', { name: 'Command file' })
const toolbarButton = (name: string) => within(toolbar()).getByRole('button', { name })
const unsavedMark = (name: string) => within(pairButton(name)).queryByRole('img', { name: 'unsaved changes' })
const outline = () => screen.getByRole('region', { name: 'Commands in this file' })
const key = (combo: string) => userEvent.keyboard(combo)

/** Shows a pair in AutoHotkey, then puts the caret in the editor. */
async function openFile(pair: string): Promise<void> {
  await click(pairButton(pair))
  await click(editorEl())
}

/** The line the caret is on (1-based) and its text. */
function caretLine(): { n: number; text: string } {
  const line = editorView().state.doc.lineAt(editorView().state.selection.main.head)
  return { n: line.number, text: line.text }
}

/** Whether the document line `n` is drawn inside the editor's viewport. */
function lineVisible(n: number): boolean {
  const view = editorView()
  const block = view.lineBlockAt(view.state.doc.line(n).from)
  const top = block.top + view.documentTop
  const box = scroller().getBoundingClientRect()
  return top >= box.top && top + block.height <= box.bottom
}

/** The colour of the text drawn for `needle` in the editor. */
function colourOf(needle: string): string {
  const spans = [...document.querySelectorAll<HTMLElement>('.cm-line span')]
  const hit = spans.find((s) => s.children.length === 0 && s.textContent?.includes(needle))
  if (!hit) throw new Error(`no drawn text with ${needle}`)
  return getComputedStyle(hit).color
}

describe('Commands tab: reading a command file', () => {
  it('opens on the first pair with its real AutoHotkey text drawn in the editor', async () => {
    await start()
    expect(pairButton('custom/automation').getAttribute('aria-current')).toBe('true')
    await waitFor(() => expect(editorEl().textContent).toContain('AutoHotkey v2'))
    expect(editorEl().getAttribute('aria-label')).toBe('AutoHotkey code')
    expect(screen.getByText('ahk/commands/custom/automation.ahk')).toBeTruthy()
  })

  it('shows the file of the pair clicked, and the other language of it on the language button', async () => {
    await start()
    await click(pairButton('media'))
    await waitFor(() => expect(editorEl().textContent).toContain('Media Functions'))
    expect(editorEl().textContent).toContain('PreviousTrack(Macro)')

    await click(toolbarButton('PowerShell'))
    await waitFor(() => expect(editorEl().getAttribute('aria-label')).toBe('PowerShell code'))
    expect(text()).toContain('function PreviousTrack')
    expect(text()).not.toContain('PreviousTrack(Macro)')
    expect(toolbarButton('PowerShell').getAttribute('aria-pressed')).toBe('true')
  })

  it('colours comments, strings and plain code differently on screen', async () => {
    await start()
    await click(pairButton('media'))
    await waitFor(() => expect(editorEl().textContent).toContain('Media Functions'))
    const comment = colourOf('Media Functions')
    const string = colourOf('{Media_Prev}')
    const plain = getComputedStyle(editorEl()).color
    expect(new Set([comment, string, plain]).size).toBe(3)
  })

  it('gives the editor the whole height of the centre, with its own scrollbar for a long file', async () => {
    await start()
    await openFile('windows')
    const main = document.querySelector('main')!.getBoundingClientRect()
    const box = document.querySelector('.cm-editor')!.getBoundingClientRect()
    expect(box.bottom).toBeGreaterThan(main.bottom - 4)
    expect(box.bottom).toBeLessThanOrEqual(main.bottom + 1)
    expect(box.width).toBeGreaterThan(main.width - 2)
    // 273 lines do not fit in the 900 px window, so the editor scrolls inside itself.
    expect(scroller().scrollHeight).toBeGreaterThan(scroller().clientHeight * 2)
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(window.innerHeight)
  })

  it('does not make the page scroll sideways at 1280 px, even with a very long line in the file', async () => {
    await start()
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    await key('{Enter}x' + '0123456789'.repeat(60))
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    expect(document.body.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    // The editor scrolls inside itself instead.
    expect(scroller().scrollWidth).toBeGreaterThan(scroller().clientWidth)
  })
})

describe('Commands tab: typing', () => {
  it('real typing makes a draft: the unsaved marks appear and Save turns on, with nothing on disk yet', async () => {
    const { folder } = await start()
    await openFile('media')
    expect(unsavedMark('media')).toBeNull()
    expect((toolbarButton('Save media.ahk') as HTMLButtonElement).disabled).toBe(true)

    await key('{Control>}{End}{/Control}')
    await key('; typed by hand')

    await waitFor(() => expect(unsavedMark('media')).not.toBeNull())
    expect(text().endsWith('; typed by hand')).toBe(true)
    expect((toolbarButton('Save media.ahk') as HTMLButtonElement).disabled).toBe(false)
    expect(within(toolbar()).getByRole('img', { name: 'unsaved changes' })).toBeTruthy()
    expect(folder.text(MEDIA)).not.toContain('typed by hand')
    // Command files are not part of config.json.
    expect(dirty()).toBe(false)
  })

  it('Ctrl+Z takes typing back, and Ctrl+Y puts it again', async () => {
    await start()
    await openFile('media')
    const original = text()
    await key('{Control>}{End}{/Control}')
    await key('abc')
    await waitFor(() => expect(unsavedMark('media')).not.toBeNull())

    await key('{Control>}z{/Control}')
    // Undone back to the file's own text, so it is no longer a draft.
    await waitFor(() => expect(unsavedMark('media')).toBeNull())
    expect(text()).toBe(original)

    await key('{Control>}y{/Control}')
    await waitFor(() => expect(unsavedMark('media')).not.toBeNull())
    expect(text()).toBe(original + 'abc')
  })

  it('Ctrl+A then typing replaces everything, and the outline follows', async () => {
    await start()
    await openFile('media')
    await waitFor(() => expect(within(outline()).getAllByText('AHK ✓').length).toBeGreaterThan(0))
    await key('{Control>}a{/Control}')
    await key('Gone')
    expect(text()).toBe('Gone')
    await waitFor(() => expect(unsavedMark('media')).not.toBeNull())
    // Every command now lacks its AutoHotkey side (the outline still lists the PowerShell file's).
    await waitFor(() => {
      const marks = within(outline()).getAllByText(/AHK/)
      expect(marks.length).toBeGreaterThan(0)
      expect(marks.every((m) => m.textContent === 'AHK ✗')).toBe(true)
    })
  })

  it('Tab indents inside the editor and keeps the focus there; Shift+Tab takes the indent back', async () => {
    await start()
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    await key('{Enter}')
    const before = text()

    await key('{Tab}')
    expect(document.activeElement).toBe(editorEl())
    // One indent unit of spaces, not a tab character.
    expect(text().startsWith(before)).toBe(true)
    expect(text().slice(before.length)).toMatch(/^ +$/)

    await key('{Shift>}{Tab}{/Shift}')
    expect(document.activeElement).toBe(editorEl())
    expect(text()).toBe(before)
  })

  it('a command typed by hand appears in the outline', async () => {
    await start()
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    await key('{Enter}{Enter}Hello(Macro) {{{Enter}}')
    await waitFor(() => expect(within(outline()).getByRole('button', { name: /^Hello/ })).toBeTruthy())
  })

  it('Ctrl+F opens the search panel with the focus in it, and Enter selects the next match in the file', async () => {
    await start()
    await openFile('media')
    await key('{Control>}f{/Control}')
    const field = await waitFor(() => {
      const el = document.querySelector<HTMLInputElement>('.cm-search input[name="search"]')
      expect(el).not.toBeNull()
      return el!
    })
    expect(document.activeElement).toBe(field)
    await key('Volume')
    await key('{Enter}')
    await waitFor(() => {
      const { from, to } = editorView().state.selection.main
      expect(text().slice(from, to)).toBe('Volume')
    })
  })
})

describe('Commands tab: scrolling and jumping', () => {
  it('Ctrl+End scrolls a long file to its last line and keeps the caret on screen', async () => {
    await start()
    await openFile('windows')
    expect(scroller().scrollTop).toBe(0)
    await key('{Control>}{End}{/Control}')
    const last = editorView().state.doc.lines
    await waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(0))
    expect(caretLine().n).toBe(last)
    expect(lineVisible(last)).toBe(true)
  })

  it('typing at the bottom of a long file scrolls to follow the caret', async () => {
    await start()
    await openFile('windows')
    await key('{Control>}{End}{/Control}')
    const before = scroller().scrollTop
    await key('{Enter}'.repeat(30) + 'end')
    await waitFor(() => expect(scroller().scrollTop).toBeGreaterThan(before))
    expect(lineVisible(caretLine().n)).toBe(true)
  })

  it('a command in the outline scrolls to its line, centres it and puts the caret at its start', async () => {
    await start()
    await click(pairButton('windows'))
    await click(within(outline()).getByRole('button', { name: /^ShowDesktop/ }))
    await waitFor(() => expect(caretLine().text).toBe('ShowDesktop(Macro) {'))
    expect(scroller().scrollTop).toBeGreaterThan(0)
    expect(lineVisible(caretLine().n)).toBe(true)
    // Centred, not left at an edge.
    const box = scroller().getBoundingClientRect()
    const view = editorView()
    const top = view.lineBlockAt(view.state.doc.line(caretLine().n).from).top + view.documentTop
    expect(Math.abs(top - (box.top + box.height / 2))).toBeLessThan(box.height / 4)
  })

  it('Open in Commands on the Macros tab lands on the command, deep in a long file', async () => {
    await startApp('Macros')
    // ShowDesktop is on no key of the example pad, so it is put on one first.
    const row = document.querySelector<HTMLElement>('[data-command="ShowDesktop"]')!
    row.scrollIntoView({ block: 'center' })
    await drag(row, padKey('F16'))
    await waitFor(() => expect(strip('F16')).toBe('Show Desktop'))
    await click(padKey('F16'))
    await click(await screen.findByRole('button', { name: 'Open in Commands' }))

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Commands' }).getAttribute('aria-selected')).toBe('true'))
    await waitFor(() => expect(caretLine().text).toBe('ShowDesktop(Macro) {'))
    expect(pairButton('windows').getAttribute('aria-current')).toBe('true')
    expect(scroller().scrollTop).toBeGreaterThan(0)
    expect(lineVisible(caretLine().n)).toBe(true)
  })
})

describe('Commands tab: saving', () => {
  it('Ctrl+S in the editor writes the file, says so and clears the marks', async () => {
    const { folder } = await start()
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    await key('{Enter}; saved with the keyboard')
    await waitFor(() => expect(unsavedMark('media')).not.toBeNull())

    await key('{Control>}s{/Control}')

    await waitFor(() => expect(folder.text(MEDIA)?.endsWith('; saved with the keyboard')).toBe(true))
    await waitFor(() => expect(unsavedMark('media')).toBeNull())
    expect(await screen.findByText('Saved media.ahk.')).toBeTruthy()
    expect((toolbarButton('Save media.ahk') as HTMLButtonElement).disabled).toBe(true)
    // The editor keeps what was typed and the focus.
    expect(text().endsWith('; saved with the keyboard')).toBe(true)
    expect(document.activeElement).toBe(editorEl())
  })

  it('the Save button writes the file too, and the saved note goes away with the next keystroke', async () => {
    const { folder } = await start()
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    await key('; one')
    await click(toolbarButton('Save media.ahk'))
    await waitFor(() => expect(folder.text(MEDIA)?.endsWith('; one')).toBe(true))
    await screen.findByText('Saved media.ahk.')

    await click(editorEl())
    await key('{Control>}{End}{/Control}')
    await key('2')
    await waitFor(() => expect(screen.queryByText('Saved media.ahk.')).toBeNull())
  })

  it('a file changed on disk after it was opened asks before it is overwritten; Escape leaves both untouched', async () => {
    const { folder } = await start()
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    await key('; mine')
    await waitFor(() => expect(unsavedMark('media')).not.toBeNull())
    await folder.writeBytes(MEDIA, new TextEncoder().encode((folder.text(MEDIA) ?? '') + '; theirs\n'))

    await key('{Control>}s{/Control}')

    expect(await screen.findByRole('dialog', { name: 'media.ahk changed on disk since you opened it.' })).toBeTruthy()
    await key('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(folder.text(MEDIA)).toContain('; theirs')
    expect(folder.text(MEDIA)).not.toContain('; mine')
    expect(text().endsWith('; mine')).toBe(true)
    expect(unsavedMark('media')).not.toBeNull()
  })

  it('Overwrite anyway asks twice, then writes the draft and keeps the other edit in a .bak', async () => {
    const { folder } = await start()
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    await key('; mine')
    await folder.writeBytes(MEDIA, new TextEncoder().encode((folder.text(MEDIA) ?? '') + '; theirs\n'))
    await key('{Control>}s{/Control}')
    await click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Overwrite anyway' }))

    const sure = await screen.findByRole('dialog', { name: 'Overwrite anyway?' })
    expect(folder.text(MEDIA)).not.toContain('; mine')
    await click(within(sure).getByRole('button', { name: 'Overwrite anyway' }))

    await waitFor(() => expect(folder.text(MEDIA)?.endsWith('; mine')).toBe(true))
    expect(folder.text(`${MEDIA}.bak`)).toContain('; theirs')
    await waitFor(() => expect(unsavedMark('media')).toBeNull())
  })

  it('Reload from disk asks before dropping typing, and shows the disk text once confirmed', async () => {
    await start()
    await openFile('media')
    const original = text()
    await key('{Control>}{End}{/Control}')
    await key('; throw away')
    await click(toolbarButton('Reload from disk'))

    await screen.findByRole('dialog', { name: 'Discard your changes to media.ahk?' })
    await key('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(text().endsWith('; throw away')).toBe(true)

    await click(toolbarButton('Reload from disk'))
    await click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard and reload' }))
    await waitFor(() => expect(text()).toBe(original))
    expect(unsavedMark('media')).toBeNull()
  })
})

describe('Commands tab: New command', () => {
  it('opens with the caret in Name, takes real typing through both fields, and Enter adds it at the end of the file', async () => {
    await start()
    await openFile('power')
    const lines = editorView().state.doc.lines
    await click(toolbarButton('New command'))

    const name = await screen.findByLabelText('Name')
    await waitFor(() => expect(document.activeElement).toBe(name))
    await key('Wake')
    await key('{Tab}')
    expect(document.activeElement).toBe(screen.getByLabelText('Description'))
    await key('Wakes the PC up.')
    await key('{Enter}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(text()).toContain('Wake(Macro)')
    expect(text()).toContain(' * Wakes the PC up.')
    expect(editorView().state.doc.lines).toBeGreaterThan(lines)
    expect(caretLine().text).toBe('Wake(Macro)')
    expect(lineVisible(caretLine().n)).toBe(true)
    expect(unsavedMark('power')).not.toBeNull()
    expect(within(outline()).getByRole('button', { name: /^Wake/ })).toBeTruthy()
  })

  it('a name that is taken keeps the dialog open with the reason, and Escape closes it without adding anything', async () => {
    await start()
    await openFile('power')
    const original = text()
    await click(toolbarButton('New command'))
    await screen.findByLabelText('Name')
    await key('Lock{Enter}')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Lock/)
    expect(screen.getByRole('dialog')).toBeTruthy()
    // Typing carries on in the same field.
    expect(document.activeElement).toBe(screen.getByLabelText('Name'))

    await key('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(text()).toBe(original)
    expect(unsavedMark('power')).toBeNull()
  })

  it('a saved new command shows up in the Macros tab list and can be dragged onto a key', async () => {
    const { folder } = await start()
    await openFile('power')
    await click(toolbarButton('New command'))
    await screen.findByLabelText('Name')
    await key('Wake')
    await key('{Tab}Wakes the PC up.{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await click(toolbarButton('Save power.ahk'))
    await waitFor(() => expect(folder.text(POWER)).toContain('Wake(Macro)'))

    await openTab('Macros')
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-command="Wake"]')
      expect(el).not.toBeNull()
      return el!
    })
    row.scrollIntoView({ block: 'center' })
    await drag(row, padKey('F16'))

    await waitFor(() => expect(strip('F16')).toBe('Wake'))
    expect(row.getAttribute('title')).toBe('Wakes the PC up.')
  })
})

describe('Commands tab: files', () => {
  it('New file: Enter in the name makes the file under Yours and lists it', async () => {
    const { folder } = await start()
    await click(screen.getByRole('button', { name: 'New file' }))
    const name = await screen.findByLabelText('Name')
    await waitFor(() => expect(document.activeElement).toBe(name))
    await key('mine{Enter}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(folder.text('local/ahk/mine.ahk')).not.toBeNull())
    expect(within(nav()).getByRole('button', { name: /^mine\b/ })).toBeTruthy()
    expect(within(nav()).getByRole('heading', { name: 'Yours' })).toBeTruthy()
  })

  it('Delete this file lists the keys that stop working; Escape keeps the file, Delete removes it', async () => {
    const { folder } = await start()
    await click(pairButton('media'))
    await click(toolbarButton('Delete this file'))

    const ask = await screen.findByRole('dialog', { name: 'Delete media.ahk?' })
    expect(ask.textContent).toContain('Media · F13 (PreviousTrack)')
    await key('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(folder.text(MEDIA)).not.toBeNull()

    await click(toolbarButton('Delete this file'))
    await click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(folder.text(MEDIA)).toBeNull())
    await waitFor(() => expect(pairButton('media').textContent).toContain('AHK —'))
  })
})
