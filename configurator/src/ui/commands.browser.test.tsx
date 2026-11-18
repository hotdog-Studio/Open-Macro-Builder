import { EditorView } from '@codemirror/view'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { click, dirty, drag, hover, openTab, padKey, startApp, strip, unmount, type Point } from '../../test/browser/harness'
import { editorView, replaceAll } from '../../test/codeEditor'
import { HOVER_TIME } from './code/hoverDocs'
import { GRACE } from './DocHover'

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
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms))
/**
 * How long to rest the pointer to show that no card comes: twice the hover delay, and a margin. A wait
 * for a condition cannot prove that something does not appear, so this one is tied to the delay it outlasts.
 */
const NO_CARD = 2 * HOVER_TIME + 100
/** How long to rest to show that the list's card stays: past the grace after which a card left behind goes. */
const CARD_STAYS = 2 * GRACE + 100

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
      await pause(NO_CARD)
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
      await pause(NO_CARD)
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
    const width = right.left - left.left
    const y = (left.top + left.bottom) / 2
    // The left half of the name's first letter, just right of the paren, gets the card: time how long
    // this machine takes to show it, so the wait below grows with a slow machine.
    const started = performance.now()
    await hover({ x: right.left + width * 0.25, y })
    await waitFor(() => expect(card()?.textContent).toContain('ActivateOrOpen(Window, Program, Args := "")'))
    const shown = performance.now() - started
    await hover(toolbar())
    await waitFor(() => expect(card()).toBeNull())
    // The right half of the paren, the same position from the other side: no card, however long it rests.
    await hover({ x: left.left + width * 0.75, y })
    await pause(Math.max(NO_CARD, 3 * shown))
    expect(card()).toBeNull()
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

  /** The PowerShell list of windows, with the library: the rows of lib/WindowOps have long cards. */
  async function powerShellList(): Promise<HTMLElement> {
    await start()
    await click(pairButton('windows'))
    await click(toolbarButton('PowerShell'))
    await waitFor(() => expect(text()).toContain('Send-Chord'))
    return screen.getByRole('region', { name: 'Other commands available' })
  }

  it('keeps the card of the list level with its row while the panel scrolls', async () => {
    const other = await powerShellList()
    const row = within(other).getByRole('button', { name: /^Send-Chord\b/ })
    // Near the top of the window, so the card has room under the row's top edge before and after.
    row.scrollIntoView({ block: 'start' })
    row.focus()
    const tip = await screen.findByRole('tooltip')
    const level = () => Math.abs(tip.getBoundingClientRect().top - row.getBoundingClientRect().top)
    await waitFor(() => expect(level()).toBeLessThanOrEqual(1))
    const before = row.getBoundingClientRect().top
    other.closest('aside')!.scrollBy(0, -100)
    await waitFor(() => expect(row.getBoundingClientRect().top).toBeGreaterThan(before + 50))
    await waitFor(() => expect(level()).toBeLessThanOrEqual(1))
  })

  it('keeps a long card of the list inside a short window, and lets it be scrolled', async () => {
    await page.viewport(1280, 300)
    try {
      const other = await powerShellList()
      const row = within(other).getByRole('button', { name: /^Set-ControlText\b/ })
      row.scrollIntoView({ block: 'center' })
      await hover(row)
      const tip = await screen.findByRole('tooltip')
      expect(tip.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight)
      expect(within(tip).getByText('More below. Scroll the card, or click the row.')).toBeTruthy()
      // The pointer can go from the row onto the card, and the card stays to be scrolled.
      await hover(tip)
      await pause(CARD_STAYS)
      expect(screen.getByRole('tooltip')).toBe(tip)
      // At the end of the scroll there is nothing more below.
      const scroller = tip.firstElementChild as HTMLElement
      scroller.scrollTop = scroller.scrollHeight
      await waitFor(() => expect(within(tip).queryByText('More below. Scroll the card, or click the row.')).toBeNull())
      expect(screen.getByRole('tooltip')).toBe(tip)
      // Back onto its row across the gap between them, as a hand moves: the same card stays, it does
      // not go and come back.
      const gap = { x: tip.getBoundingClientRect().right + 4, y: row.getBoundingClientRect().top + 4 }
      await hover(gap)
      expect(screen.getByRole('tooltip')).toBe(tip)
      await hover(row)
      await pause(CARD_STAYS)
      expect(screen.getByRole('tooltip')).toBe(tip)
      await hover(nav())
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    } finally {
      await page.viewport(1280, 900)
    }
  })

  /**
   * In a 300 px window, the card of a tool of the shown file with 30 examples: taller than the window,
   * so it takes the pointer. `shrink` replaces the docs with one line, which fits.
   */
  async function tallToolCard(): Promise<{ tip: HTMLElement; shrink: () => Promise<void> }> {
    await page.viewport(1280, 300)
    await start()
    await openFile('windows')
    const examples = Array.from({ length: 30 }, (_, i) => ` * @example Tool(${i})`)
    replaceAll(['/**', ' * A tool.', ...examples, ' */', 'Tool(A)', '{', '}', ''].join('\n'))
    const other = screen.getByRole('region', { name: 'Other commands available' })
    const row = within(other).getByRole('button', { name: /^Tool\b/ })
    row.scrollIntoView({ block: 'end' })
    await waitFor(() => expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight))
    // From a known place, so that resting on the row is a move the page sees.
    await hover(nav())
    await hover(row)
    const tip = await screen.findByRole('tooltip')
    await waitFor(() => expect(getComputedStyle(tip).pointerEvents).toBe('auto'))
    const shrink = async () => {
      replaceAll('/**\n * A tool.\n */\nTool(A)\n{\n}\n')
      await waitFor(() => expect(tip.textContent).not.toContain('Tool(29)'))
      await waitFor(() => expect(within(tip).queryByText('More below. Scroll the card, or click the row.')).toBeNull())
    }
    return { tip, shrink }
  }

  it('keeps the pointer on a tall card of the list whose docs shrink under it, until it leaves', async () => {
    try {
      const { tip, shrink } = await tallToolCard()
      // Near the bottom of the card, on an example line the shrink takes away; the shrunk card still covers it.
      const tall = tip.getBoundingClientRect()
      const rest = { x: tall.left + tall.width / 2, y: tall.bottom - 10 }
      await hover(rest)
      const line = document.elementFromPoint(rest.x, rest.y)!
      expect(tip.contains(line)).toBe(true)
      await shrink()
      expect(line.isConnected).toBe(false)
      // The card still lies under the resting pointer and takes it, past the grace a card left behind waits.
      expect(tip.contains(document.elementFromPoint(rest.x, rest.y))).toBe(true)
      await pause(CARD_STAYS)
      expect(screen.getByRole('tooltip')).toBe(tip)
      expect(getComputedStyle(tip).pointerEvents).toBe('auto')
      // Straight off it, with nothing entering the card again: the card goes.
      await hover(nav())
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    } finally {
      await page.viewport(1280, 900)
    }
  })

  it('lets the card go when the pointer leaves right after the line under it was taken away, every time', async () => {
    // The line under the resting pointer goes with the shrink. When the pointer moves before the browser
    // has looked again at what lies under it, the browser's mouseout goes to that line, now off the page,
    // so React's own leave never comes; only the card's native mouseleave does. That race goes either way
    // from one try to the next, so the test makes several.
    try {
      const { tip } = await tallToolCard()
      const row = () => within(screen.getByRole('region', { name: 'Other commands available' })).getByRole('button', { name: /^Tool\b/ })
      let card = tip
      for (let attempt = 0; attempt < 8; attempt++) {
        const tall = card.getBoundingClientRect()
        await hover({ x: tall.left + tall.width / 2, y: tall.bottom - 10 })
        replaceAll('/**\n * A tool.\n */\nTool(A)\n{\n}\n')
        await hover(nav())
        await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
        // The tall card again, for the next try.
        replaceAll(['/**', ' * A tool.', ...Array.from({ length: 30 }, (_, i) => ` * @example Tool(${i})`), ' */', 'Tool(A)', '{', '}', ''].join('\n'))
        await hover(row())
        card = await screen.findByRole('tooltip')
        await waitFor(() => expect(getComputedStyle(card).pointerEvents).toBe('auto'))
      }
    } finally {
      await page.viewport(1280, 900)
    }
  })

  it('lets go of the pointer when the shrunk card is no longer under it', async () => {
    try {
      const { tip, shrink } = await tallToolCard()
      // Near the top of the tall card, where the shrunk card, placed level with its row, no longer is.
      const tall = tip.getBoundingClientRect()
      const rest = { x: tall.left + tall.width / 2, y: tall.top + 10 }
      await hover(rest)
      expect(tip.contains(document.elementFromPoint(rest.x, rest.y))).toBe(true)
      await shrink()
      await waitFor(() => expect(tip.getBoundingClientRect().top).toBeGreaterThan(rest.y))
      // The pointer has not moved: the card goes, and blocks no click where the pointer rests.
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
      expect(tip.contains(document.elementFromPoint(rest.x, rest.y))).toBe(false)
    } finally {
      await page.viewport(1280, 900)
    }
  })

  it('lets the pointer pass over a card that fits, on its way to the editor', async () => {
    const other = await powerShellList()
    const row = within(other).getByRole('button', { name: /^Wait-Pump\b/ })
    row.scrollIntoView({ block: 'center' })
    await hover(row)
    const tip = await screen.findByRole('tooltip')
    expect(within(tip).queryByText('More below. Scroll the card, or click the row.')).toBeNull()
    const box = tip.getBoundingClientRect()
    const spot = { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    // What lies under the card there takes the pointer, not the card.
    expect(tip.contains(document.elementFromPoint(spot.x, spot.y))).toBe(false)
    await hover(spot)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('keeps the card of the list inside a narrow window', async () => {
    const other = await powerShellList()
    const row = within(other).getByRole('button', { name: /^Set-ControlText\b/ })
    try {
      // 700: room beside the panel for a narrower card; 440: too little, so the card goes over the panel.
      for (const width of [700, 440]) {
        await page.viewport(width, 900)
        row.scrollIntoView({ block: 'center' })
        await hover(row)
        const tip = await screen.findByRole('tooltip')
        await waitFor(() => expect(tip.getBoundingClientRect().left).toBeGreaterThanOrEqual(0))
        expect(tip.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
        await hover(nav())
        await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
      }
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
    // And it holds Send-Chord's docs, not just any box.
    expect(tip.textContent).toContain('Send-Chord <Chord>')
    expect(tip.textContent).toContain('Example')
    expect(tip.textContent).toContain('powershell/lib/Input.ps1 · line')
  })

  it("shows the card on a function's own definition line", async () => {
    await start()
    await openFile('windows')
    const definition = text().search(/^OpenFileExplorer\(/m)
    expect(definition).toBeGreaterThanOrEqual(0)
    await hover(await pointAt(definition + 2))
    await waitFor(() => expect(card()?.textContent).toContain('OpenFileExplorer(Macro)'))
  })

  it('shows the card in a file it will not edit', async () => {
    const { folder } = await start()
    const enc = new TextEncoder()
    await folder.writeBytes(
      'ahk/commands/latin.ahk',
      new Uint8Array([...enc.encode('; caf'), 0xe9, ...enc.encode('\nLatin(Macro)\n{\n    ActivateOrOpen("x", "y")\n}\n')]),
    )
    // The save flow rechecks the command files when the window regains the focus.
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(pairButton('latin')).toBeTruthy())
    await click(pairButton('latin'))
    await waitFor(() => expect(editorView().state.readOnly).toBe(true))
    await hover(await wordPoint('ActivateOrOpen'))
    await waitFor(() => expect(card()?.textContent).toContain('ActivateOrOpen(Window, Program, Args := "")'))
  })

  it('shows the card with the pointer on the right half of the last letter', async () => {
    await start()
    await openFile('windows')
    const last = text().indexOf('ActivateOrOpen') + 'ActivateOrOpen'.length - 1
    const middle = await pointAt(last)
    // coordsAtPos gives a box of no width at a position: the last letter runs from one to the next.
    const from = editorView().coordsAtPos(last, 1)!.left
    const to = editorView().coordsAtPos(last + 1, -1)!.left
    const x = to - 1
    expect(x).toBeGreaterThan((from + to) / 2)
    await hover({ x, y: middle.y })
    await waitFor(() => expect(card()?.textContent).toContain('ActivateOrOpen('))
  })

  it('unmounts the card of the editor once it goes', async () => {
    await start()
    await openFile('windows')
    await hover(await wordPoint('ActivateOrOpen'))
    await waitFor(() => expect(card()?.textContent).toContain('ActivateOrOpen('))
    // The element the card was rendered into, inside CodeMirror's own box.
    const dom = card()!.firstElementChild as HTMLElement
    expect(dom.textContent).toContain('ActivateOrOpen(')
    await hover(toolbar())
    await waitFor(() => expect(card()).toBeNull())
    // root.unmount() empties the element the card was rendered into.
    await waitFor(() => expect(dom.childElementCount).toBe(0))
  })
})
