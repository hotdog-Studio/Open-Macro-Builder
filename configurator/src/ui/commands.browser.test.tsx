import { EditorView } from '@codemirror/view'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { click, dirty, drag, hover, openTab, padKey, startApp, strip, unmount, type Point } from '../../test/browser/harness'
import { editorView, replaceAll } from '../../test/codeEditor'

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
const unsavedMark = (name: string) => within(pairButton(name)).queryByTitle('unsaved changes')
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
    expect(within(toolbar()).getByTitle('unsaved changes')).toBeTruthy()
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

/** Where the character at `pos` is drawn, once the editor has scrolled it into view. */
async function pointAt(pos: number): Promise<Point> {
  const view = editorView()
  view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'center' }) })
  const c = await waitFor(() => {
    const at = view.coordsAtPos(pos)
    if (!at) throw new Error('not drawn yet')
    return at
  })
  return { x: c.left + 1, y: (c.top + c.bottom) / 2 }
}
/** Two characters into the first place `needle` stands in the text. */
const wordPoint = (needle: string) => pointAt(text().indexOf(needle) + 2)
const card = () => document.querySelector<HTMLElement>('.cm-tooltip')

describe('Commands tab: docs on hover', () => {
  it('shows the docs of an AutoHotkey helper under the pointer', async () => {
    await start()
    await openFile('windows')
    await hover(await wordPoint('ActivateOrOpen'))
    await waitFor(() => expect(card()?.textContent).toContain('ActivateOrOpen(Window, Program, Args := "")'))
    expect(card()!.textContent).toContain('Activates an existing Window or opens a Program if the Window does not exist.')
    expect(card()!.textContent).toContain('ahk/commands/helper.ahk · line')
  })

  it('shows a PowerShell library function with how to call it', async () => {
    await start()
    await click(pairButton('windows'))
    await click(toolbarButton('PowerShell'))
    await waitFor(() => expect(text()).toContain('Send-Chord'))
    await hover(await wordPoint('Send-Chord'))
    await waitFor(() => expect(card()?.textContent).toContain('Send-Chord <Chord>'))
    expect(card()!.textContent).toContain('powershell/lib/Input.ps1 · line')
  })

  it('follows what is typed', async () => {
    await start()
    await openFile('media')
    replaceAll('/**\n * Brand new.\n */\nJustTyped(Macro)\n{\n}\nOther(Macro)\n{\n    JustTyped(Macro)\n}\n')
    await hover(await pointAt(text().lastIndexOf('JustTyped') + 2))
    await waitFor(() => expect(card()?.textContent).toContain('Brand new.'))
  })

  it('shows nothing over a comment, a string, a variable or an unknown name', async () => {
    await start()
    await click(pairButton('windows'))
    await click(toolbarButton('PowerShell'))
    await waitFor(() => expect(text()).toContain('Send-Chord'))
    replaceAll("# aa Send-Chord\n$bb = 'cc Send-Chord'\n$Send-Chord\nNot-Known 1\nSend-Chord 'Ctrl+c'\n")
    // Five characters in is inside the name each time.
    for (const pos of [text().indexOf('aa Send-Chord') + 5, text().indexOf('cc Send-Chord') + 5, text().indexOf('$Send-Chord') + 3, text().indexOf('Not-Known') + 2]) {
      await hover(await pointAt(pos))
      await new Promise((r) => setTimeout(r, 700))
      expect(card()).toBeNull()
    }
    // The same name as a call does get one, so the silence above is not a broken hover.
    await hover(await pointAt(text().lastIndexOf('Send-Chord') + 2))
    await waitFor(() => expect(card()?.textContent).toContain('Send-Chord <Chord>'))
  })

  it('shows nothing over an AutoHotkey comment, string or member', async () => {
    await start()
    await openFile('windows')
    // The call is indented, as in a function body: alone at the left edge a line reads as a definition.
    replaceAll('; aa ActivateOrOpen\n/* bb ActivateOrOpen */\nx := "cc ActivateOrOpen"\nobj.ActivateOrOpen\n    ActivateOrOpen("x", "y")\n')
    // Five characters in is inside the name each time; after the dot, two characters in.
    for (const pos of [text().indexOf('aa ActivateOrOpen') + 5, text().indexOf('bb ActivateOrOpen') + 5, text().indexOf('cc ActivateOrOpen') + 5, text().indexOf('obj.ActivateOrOpen') + 6]) {
      await hover(await pointAt(pos))
      await new Promise((r) => setTimeout(r, 700))
      expect(card()).toBeNull()
    }
    // The same name as a call does get one, so the silence above is not a broken hover.
    await hover(await pointAt(text().lastIndexOf('ActivateOrOpen') + 2))
    await waitFor(() => expect(card()?.textContent).toContain('ActivateOrOpen(Window, Program, Args := "")'))
  })

  it('shows no card with the pointer on the right half of the character before a name', async () => {
    await start()
    await openFile('windows')
    replaceAll('    x(ActivateOrOpen("a", "b"))\n')
    const open = text().indexOf('(')
    const view = editorView()
    const left = view.coordsAtPos(open)!
    const right = view.coordsAtPos(open + 1)!
    await hover({ x: left.left + (right.left - left.left) * 0.75, y: (left.top + left.bottom) / 2 })
    await new Promise((r) => setTimeout(r, 700))
    expect(card()).toBeNull()
    // The name itself does get its card, so the silence above is not a broken hover.
    await hover(await wordPoint('ActivateOrOpen'))
    await waitFor(() => expect(card()?.textContent).toContain('ActivateOrOpen(Window, Program, Args := "")'))
  })

  it('takes the card away when the text changes', async () => {
    await start()
    await openFile('windows')
    await hover(await wordPoint('ActivateOrOpen'))
    await waitFor(() => expect(card()).not.toBeNull())
    editorView().dispatch({ changes: { from: 0, insert: '; typed\n' } })
    await waitFor(() => expect(card()).toBeNull())
  })

  it('lets a card taller than the room for it scroll inside its box', async () => {
    await page.viewport(1280, 250)
    try {
      await start()
      await openFile('windows')
      await hover(await wordPoint('ActivateOrOpen'))
      await waitFor(() => expect(card()?.textContent).toContain('ActivateOrOpen('))
      const box = card()!
      // CodeMirror sizes the box once React has drawn the card in it.
      await waitFor(() => expect(box.scrollHeight).toBeGreaterThan(box.clientHeight))
      expect(box.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight)
      expect(getComputedStyle(box).overflowY).toBe('auto')
      box.scrollTop = box.scrollHeight
      const last = box.querySelector('p:last-child')!
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.getBoundingClientRect().bottom + 1)
    } finally {
      await page.viewport(1280, 900)
    }
  })

  it('shows the written docs of a library function, in the editor and in the list', async () => {
    await start()
    await click(pairButton('windows'))
    await click(toolbarButton('PowerShell'))
    await waitFor(() => expect(text()).toContain('Send-Chord'))
    await hover(await wordPoint('Send-Chord'))
    await waitFor(() => expect(card()?.textContent).toContain('Example'))
    const other = screen.getByRole('region', { name: 'Other commands available' })
    expect(within(other).getByRole('button', { name: /^Keys and mouse clicks/ })).toBeTruthy()
    // The list sits far down the panel: scroll the row to where a hand can rest on it.
    const row = within(other).getByRole('button', { name: /^Send-Chord\b/ })
    row.scrollIntoView({ block: 'center' })
    await hover(row)
    const tip = await screen.findByRole('tooltip')
    const panel = other.closest('aside')!.getBoundingClientRect()
    // Beside the panel, not under it and not cut off by it.
    expect(tip.getBoundingClientRect().right).toBeLessThanOrEqual(panel.left)
    expect(tip.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
  })
})
