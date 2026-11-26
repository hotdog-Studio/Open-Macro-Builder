import { EditorView } from '@codemirror/view'
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { at as pointOn, carry, checked, cleanUp, click, dirty, drag, drop, hover, hoverPath, keyboard, openTab, padKey, repoFiles, rest, startApp, strip, viewport, type Point } from '../../test/browser/harness'
import { editorView, replaceAll } from '../../test/codeEditor'
import { LANGUAGES } from '../core/languages'
import { HOVER_TIME } from './code/hoverDocs'
import { GAP, GRACE } from './DocHover'

// The Commands tab in a real browser, where the code editor really types, selects, scrolls and
// takes focus. The example repository has no files of "yours", so every pair is shared. The first
// pair listed is custom/automation.

// The window goes back to the size of the other suites after each test, not in the test's own finally,
// which a test that ran past its limit would run late, in the middle of the next test.
afterEach(async () => {
  await cleanUp()
  await viewport(1280, 900)
})

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
const key = keyboard

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
    // The line is in the file, not typed: typing its 601 characters took this test past its time limit
    // on the Windows build agent, at some 80 ms a key, and the test is about the layout, not about typing.
    const long = 'x' + '0123456789'.repeat(60)
    const media = new TextDecoder().decode((await repoFiles())[MEDIA])
    // The file has no line break at its end, and gets none after the long line either: Ctrl+End puts the
    // caret at the end of it, and the editor scrolls sideways to show it. The new line breaks as the
    // checkout breaks the others.
    const eol = media.includes('\r\n') ? '\r\n' : '\n'
    const withLong = `${media}${eol}${long}`
    await startApp('Commands', undefined, { files: { [MEDIA]: new TextEncoder().encode(withLong) } })
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    expect(text().endsWith(`\n${long}`)).toBe(true)
    await waitFor(() => expect(scroller().scrollLeft).toBeGreaterThan(0))
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

const HINT = 'Tab indents. To leave the editor with the keyboard, press Esc and then Tab.'
const hintEl = () => screen.getByText(HINT)
const insideEditor = () => document.activeElement?.closest('.cm-editor') != null

/** The rgb() of a computed colour as numbers. */
const rgbOf = (colour: string): number[] => (colour.match(/[0-9.]+/g) ?? []).slice(0, 3).map(Number)

/** The WCAG relative luminance of a colour. */
function luminance([r, g, b]: number[]): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
}

/** What the editor shows of itself: its size, where its first line of text is, and how the hint is laid out. */
function layoutOfEditor() {
  const hint = hintEl()
  const style = getComputedStyle(hint)
  return {
    editorHeight: document.querySelector('.cm-editor')!.getBoundingClientRect().height,
    firstLineTop: document.querySelector('.cm-line')!.getBoundingClientRect().top,
    hintTop: hint.getBoundingClientRect().top,
    hintHeight: hint.getBoundingClientRect().height,
    display: style.display,
    visibility: style.visibility,
    opacity: style.opacity,
  }
}

describe('Commands tab: leaving the editor with the keyboard', () => {
  /** A real wait: CodeMirror's own Escape lasts two seconds by the clock, so this is past it without any fake timer to misjudge. */
  const pastCodeMirrorsLimit = () => rest(2400)

  it('says how in a line of the editor, which the editor names for a screen reader', async () => {
    await start()
    await openFile('media')
    expect(document.activeElement).toBe(editorEl())
    const line = hintEl()
    expect(editorEl().closest('.cm-editor')?.contains(line)).toBe(true)
    expect(line.id).not.toBe('')
    expect(editorEl().getAttribute('aria-describedby')).toContain(line.id)
  })

  it('Esc and then Tab leaves the editor, however long after the Esc, and nothing is indented', async () => {
    await start()
    await openFile('media')
    const before = text()
    await key('{Escape}')
    await key('{Tab}')
    expect(insideEditor()).toBe(false)
    expect(text()).toBe(before)

    await click(editorEl())
    await key('{Escape}')
    await pastCodeMirrorsLimit()
    await key('{Tab}')
    expect(insideEditor()).toBe(false)
    expect(text()).toBe(before)
  })

  it('Esc and then Shift+Tab leaves the editor backwards', async () => {
    await start()
    await openFile('media')
    const before = text()
    await key('{Escape}')
    await key('{Shift>}{Tab}{/Shift}')
    expect(insideEditor()).toBe(false)
    expect(text()).toBe(before)
  })

  it('another key after the Esc disarms it: Tab indents and the focus stays', async () => {
    await start()
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    await key('{Enter}')
    const before = text()
    await key('{Escape}')
    await key('x')
    await key('{Tab}')
    expect(document.activeElement).toBe(editorEl())
    expect(text().slice(before.length)).toMatch(/^ +x$/)
  })

  it('a click in the text after the Esc disarms it: Tab indents and the focus stays', async () => {
    await start()
    await openFile('media')
    const before = text()
    await key('{Escape}')
    await click(editorEl())
    await key('{Tab}')
    expect(document.activeElement).toBe(editorEl())
    expect(text().length).toBeGreaterThan(before.length)
  })

  it('Esc with text selected collapses the selection and still arms: Tab leaves the editor', async () => {
    await start()
    await openFile('media')
    const before = text()
    await key('{Control>}a{/Control}')
    expect(editorView().state.selection.main.empty).toBe(false)
    await key('{Escape}')
    expect(editorView().state.selection.main.empty).toBe(true)
    await key('{Tab}')
    expect(insideEditor()).toBe(false)
    expect(text()).toBe(before)
  })

  it('Esc with text selected, then a letter, disarms it: Tab indents and the focus stays', async () => {
    await start()
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    await key('{Enter}ab{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}')
    expect(editorView().state.selection.main.empty).toBe(false)
    await key('{Escape}')
    await key('x')
    await key('{Tab}')
    expect(document.activeElement).toBe(editorEl())
    expect(text()).toMatch(/\n +xab$/)
  })

  it('an Esc that closes the search panel does not arm: back in the text, Tab indents', async () => {
    await start()
    await openFile('media')
    await key('{Control>}{End}{/Control}')
    await key('{Enter}')
    const before = text()
    await key('{Control>}f{/Control}')
    await waitFor(() => expect(document.querySelector('.cm-search')).not.toBeNull())
    await key('{Escape}')
    await waitFor(() => expect(document.querySelector('.cm-search')).toBeNull())
    expect(document.activeElement).toBe(editorEl())
    await key('{Tab}')
    expect(document.activeElement).toBe(editorEl())
    expect(text().slice(before.length)).toMatch(/^ +$/)
  })

  it('coming back into the editor, Tab indents again without an Esc', async () => {
    await start()
    await openFile('media')
    await key('{Escape}')
    await key('{Tab}')
    expect(insideEditor()).toBe(false)
    await click(editorEl())
    await key('{Control>}{End}{/Control}')
    await key('{Enter}')
    const before = text()
    await key('{Tab}')
    expect(document.activeElement).toBe(editorEl())
    expect(text().slice(before.length)).toMatch(/^ +$/)
  })
})

describe('Commands tab: the hint line of the editor', () => {
  it('is laid out the same with and without the focus, so the text never moves; only whether it is seen changes', async () => {
    await start()
    await click(pairButton('windows'))
    await waitFor(() => expect(document.querySelector('.cm-line')).not.toBeNull())
    expect(insideEditor()).toBe(false)
    const away = layoutOfEditor()
    await click(editorEl())
    expect(insideEditor()).toBe(true)
    const focused = layoutOfEditor()

    expect(focused.editorHeight).toBe(away.editorHeight)
    expect(focused.firstLineTop).toBe(away.firstLineTop)
    expect(focused.hintTop).toBe(away.hintTop)
    expect(focused.hintHeight).toBe(away.hintHeight)
    // In the page and in the accessibility tree either way: not display:none, hidden or aria-hidden.
    for (const shown of [away, focused]) {
      expect(shown.display).not.toBe('none')
      expect(shown.visibility).toBe('visible')
      expect(shown.hintHeight).toBeGreaterThan(8)
    }
    expect(hintEl().closest('[aria-hidden], [hidden]')).toBeNull()
    expect(away.opacity).toBe('0')
    expect(focused.opacity).toBe('1')
  })

  it('has a contrast of at least 4.5 against the editor when it is seen', async () => {
    await start()
    await openFile('media')
    const ink = luminance(rgbOf(getComputedStyle(hintEl()).color))
    const back = luminance(rgbOf(getComputedStyle(document.querySelector('.cm-editor')!).backgroundColor))
    const [light, dark] = ink > back ? [ink, back] : [back, ink]
    expect((light + 0.05) / (dark + 0.05)).toBeGreaterThanOrEqual(4.5)
  })

  it('does not move a click: the last visible line of a long file takes the cursor, with the focus elsewhere', async () => {
    await start()
    await click(pairButton('windows'))
    await waitFor(() => expect(editorView().state.doc.lines).toBeGreaterThan(30))
    expect(insideEditor()).toBe(false)
    let last = 1
    while (last < editorView().state.doc.lines && lineVisible(last + 1)) last++
    expect(last).toBeGreaterThan(5)
    const view = editorView()
    const block = view.lineBlockAt(view.state.doc.line(last).from)
    // A press and a release on one point: a click, the way the real mouse makes it.
    const spot = { x: editorEl().getBoundingClientRect().left + 24, y: block.top + view.documentTop + block.height / 2 }
    await drag(spot, spot, 1)
    expect(insideEditor()).toBe(true)
    expect(caretLine().n).toBe(last)
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

  it('Delete this file says the macropad will not start and names the keys; Escape keeps the file, Delete removes it', async () => {
    const { folder } = await start()
    await click(pairButton('media'))
    await click(toolbarButton('Delete this file'))

    const ask = await screen.findByRole('dialog', { name: 'Delete media.ahk?' })
    expect(ask.textContent).toContain('PreviousTrack (Media · F13)')
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
const pause = rest
/**
 * How long to rest the pointer to show that no card comes: twice the hover delay, and a margin. A wait
 * for a condition cannot prove that something does not appear, so this one is tied to the delay it outlasts.
 */
const NO_CARD = 2 * HOVER_TIME + 100
/** How long to rest to show that the list's card stays: past the grace after which a card left behind goes. */
const CARD_STAYS = 2 * GRACE + 100

/**
 * The lines of a tool `name` whose docs the test writes: `summary` and thirty examples. An example is a
 * label and a box with padding around its line, 55 px of the card with the fonts of the PC this was
 * written on, where the docs come to some 2,000 px: more than six times the short windows of these tests
 * (300 px and less), so other fonts leave them far taller still than the window, and expectTall fails out
 * loud below twice. No docs that ship are in it, so no help text decides a test that needs a tall card.
 */
const tallTool = (name: string, summary: string) => [
  '/**',
  ` * ${summary}`,
  ...Array.from({ length: 30 }, (_, i) => ` * @example ${name}(${i})`),
  ' */',
  `${name}(A)`,
  '{',
  '}',
]

/** Fails out loud when what `scroller` holds, the docs of a card of tallTool, is not at least twice the window's height. */
function expectTall(scroller: HTMLElement): void {
  expect(scroller.scrollHeight, 'the written card is no longer far taller than the window').toBeGreaterThanOrEqual(2 * window.innerHeight)
}

describe('Commands tab: docs on hover', () => {
  it('shows the docs of an AutoHotkey helper under the pointer', async () => {
    await start()
    await openFile('windows')
    await hover(await wordPoint('ActivateOrOpen'))
    await waitFor(() => expect(card()?.textContent).toContain('ActivateOrOpen(Window, Program, Args := "")'))
    // The summary helper.ahk gives it, as the app's parser reads the file.
    const helper = new TextDecoder().decode((await repoFiles())['ahk/commands/helper.ahk'])
    const summary = LANGUAGES.ahk.findFunctions(helper).find((f) => f.name === 'ActivateOrOpen')!.doc.summary
    expect(summary).not.toBe('')
    expect(card()!.textContent).toContain(summary)
    expect(card()!.textContent).toContain('ahk/commands/helper.ahk · line')
  })

  /** Whether `el` lies wholly inside the window. */
  const inWindow = (el: HTMLElement) => {
    const box = el.getBoundingClientRect()
    return box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight
  }

  /** AutoHotkey's own functions are fetched when the tab first shows: waits until the list has them. */
  const referenceShown = () =>
    within(screen.getByRole('region', { name: 'Other commands available' })).findByRole('heading', { name: "AutoHotkey's own functions" })

  it("shows the card of an AutoHotkey built-in as text, inside the window", async () => {
    await start()
    await openFile('windows')
    // The editor's card comes from the same reference, so it too waits until it has been fetched.
    await referenceShown()
    // A call to Send in a command's body: indented, as AutoHotkey's own function is called there.
    const call = /^([ \t]+)Send\(/m.exec(text())!
    await hover(await pointAt(call.index + call[1].length + 2))
    await waitFor(() => expect(card()?.textContent).toContain('Send(Keys)'))
    const box = card()!
    expect(box.textContent).toContain('In the PowerShell version: Send-Ahk')
    expect(box.textContent).toContain('https://www.autohotkey.com/docs/v2/lib/Send.htm')
    // The braces and symbols of its docs stay text: no link, no markup.
    expect(box.textContent).toContain('{Shift down}...{Shift up}')
    expect(box.querySelector('a, b, i, img, script')).toBeNull()
    await waitFor(() => expect(inWindow(box)).toBe(true))
  })

  it("shows the card of a built-in from the list inside the window, at its full height or scrolled", async () => {
    await start()
    await openFile('windows')
    const other = screen.getByRole('region', { name: 'Other commands available' })
    await click(await within(other).findByRole('button', { name: /^Keys and mouse\b/ }))
    const row = within(other).getByRole('button', { name: /^Send\b/ })
    row.scrollIntoView({ block: 'center' })
    await hover(row)
    const tip = await screen.findByRole('tooltip')
    expect(tip.textContent).toContain('Send(Keys)')
    expect(tip.querySelector('a, b, i, img, script')).toBeNull()
    await waitFor(() => expect(inWindow(tip)).toBe(true))
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
    await viewport(1280, 250)
    await start()
    await openFile('windows')
    // A tool whose docs the test writes, called from a command: its card, of thirty examples, is taller
    // than the window in any font.
    replaceAll([...tallTool('Tall', 'A tall tool.'), 'Caller(Macro)', '{', '    Tall(1)', '}', ''].join('\n'))
    await hover(await pointAt(text().lastIndexOf('Tall(') + 2))
    await waitFor(() => expect(card()?.textContent).toContain('A tall tool.'))
    const box = card()!
    // CodeMirror sizes the box once React has drawn the card in it.
    await waitFor(() => expect(box.scrollHeight).toBeGreaterThan(box.clientHeight))
    expectTall(box)
    expect(box.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight)
    expect(getComputedStyle(box).overflowY).toBe('auto')
    box.scrollTop = box.scrollHeight
    const last = box.querySelector('p:last-child')!
    expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.getBoundingClientRect().bottom + 1)
  })

  /** The PowerShell list of windows, with the library: the rows of lib/WindowOps have long cards. */
  async function powerShellList(): Promise<HTMLElement> {
    await start()
    await click(pairButton('windows'))
    await click(toolbarButton('PowerShell'))
    await waitFor(() => expect(text()).toContain('Send-Chord'))
    return screen.getByRole('region', { name: 'Other commands available' })
  }

  /**
   * The card of a tool whose docs the test writes, a summary and `examples` lines of examples, shown for
   * its row by the keyboard, with the row at the top of the panel. The shown file is 60 tools and the row
   * the 31st, so that the panel has a long way to scroll above the row and below it. No docs that ship
   * are in it, and the tests measure the card and the room they find, so neither a help text nor the
   * machine's fonts decide them.
   */
  async function writtenCard(examples: number): Promise<{ row: HTMLElement; tip: HTMLElement; panel: HTMLElement }> {
    await start()
    await openFile('windows')
    const tool = (name: string, docs: string[]) => ['/**', ...docs.map((line) => ` * ${line}`), ' */', `${name}(A)`, '{', '}', '']
    const written = ['A written tool.', ...Array.from({ length: examples }, (_, i) => `@example Written(${i})`)]
    const tools = Array.from({ length: 60 }, (_, i) => (i === 30 ? tool('Written', written) : tool(`Tool${i}`, ['A tool.'])))
    replaceAll(tools.flat().join('\n'))
    const row = within(screen.getByRole('region', { name: 'Other commands available' })).getByRole('button', { name: /^Written\b/ })
    row.scrollIntoView({ block: 'start' })
    row.focus()
    return { row, tip: await screen.findByRole('tooltip'), panel: row.closest('aside')! }
  }

  const topOf = (el: Element) => el.getBoundingClientRect().top

  it('keeps the card of the list level with its row while the panel scrolls', async () => {
    // A card of one line: short in any font, so it has room under its row before and after.
    const { row, tip, panel } = await writtenCard(0)
    const level = () => Math.abs(topOf(tip) - topOf(row))
    await waitFor(() => expect(level()).toBeLessThanOrEqual(1))
    const before = topOf(row)
    // The card still fits under the row 100 px further down, so level with it is where the page puts it there.
    expect(before + 100 + tip.offsetHeight + GAP).toBeLessThanOrEqual(document.documentElement.clientHeight)
    panel.scrollBy(0, -100)
    await waitFor(() => expect(topOf(row)).toBeGreaterThan(before + 50))
    await waitFor(() => expect(level()).toBeLessThanOrEqual(1))
  })

  it('moves the card of the list up from a row scrolled too low for it, only as far as it takes to keep the whole card in the window', async () => {
    // A card of a summary and four examples: a few times the height of a row, and well under the window's.
    const { row, tip, panel } = await writtenCard(4)
    const before = topOf(row)
    // The lowest the card can be with all of it in the window, the gap under it: where the page stops it.
    const lowest = () => document.documentElement.clientHeight - tip.offsetHeight - GAP
    // The card has room under its row where the row is now, and the panel can scroll the row to 50 px
    // lower than the card can follow.
    expect(lowest()).toBeGreaterThan(before)
    const down = lowest() - before + 50
    expect(panel.scrollTop).toBeGreaterThanOrEqual(down)
    await waitFor(() => expect(Math.abs(topOf(tip) - before)).toBeLessThanOrEqual(1))
    panel.scrollBy(0, -down)
    await waitFor(() => expect(Math.abs(topOf(row) - (before + down))).toBeLessThanOrEqual(1))
    await waitFor(() => expect(Math.abs(topOf(tip) - lowest())).toBeLessThanOrEqual(1))
    expect(Math.abs(tip.getBoundingClientRect().bottom - (document.documentElement.clientHeight - GAP))).toBeLessThanOrEqual(1)
  })

  /**
   * In a 300 px window, a shown file of two tools whose docs the test writes (tallTool), the two rows of its
   * group in the list, next to each other: `Tall` and `Second`, each with a card taller than the window. `row`
   * is Tall's, scrolled to the middle of the panel. Both cards are tall, so that the card going from one
   * row to the other changes neither whether it is tall nor whether there is more below: a change of
   * either would draw the card once more, and that look at where the pointer is would end a grace that a
   * test of the pointer's path must see run out.
   */
  async function tallRows(): Promise<{ row: HTMLElement; other: HTMLElement }> {
    await viewport(1280, 300)
    await start()
    await openFile('windows')
    replaceAll([...tallTool('Tall', 'The first tool.'), ...tallTool('Second', 'The second tool.'), ''].join('\n'))
    const list = screen.getByRole('region', { name: 'Other commands available' })
    const row = within(list).getByRole('button', { name: /^Tall\b/ })
    row.scrollIntoView({ block: 'center' })
    return { row, other: within(list).getByRole('button', { name: /^Second\b/ }) }
  }

  it('keeps a long card of the list inside a short window, and lets it be scrolled', async () => {
    const { row } = await tallRows()
    await hover(row)
    const tip = await screen.findByRole('tooltip')
    expectTall(tip.firstElementChild as HTMLElement)
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
  })

  /**
   * In a 300 px window, the card of a tool of the shown file with 30 examples: taller than the window,
   * so it takes the pointer. `shrink` replaces the docs with one line, which fits.
   */
  async function tallToolCard(): Promise<{ tip: HTMLElement; shrink: () => Promise<void> }> {
    await viewport(1280, 300)
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
    const { tip, shrink } = await tallToolCard()
    // Near the bottom of the card, on its "More below" line, which the shrink takes away; the shrunk card still covers the point.
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
  })

  it('lets the card go when the pointer leaves right after the line under it was taken away, every time', async () => {
    // The line under the resting pointer (the card's "More below" line) goes with the shrink. When the pointer moves before the browser
    // has looked again at what lies under it, the browser's mouseout goes to that line, now off the page,
    // so React's own leave never comes; only the card's native mouseleave does. That race goes either way
    // from one try to the next, so the test makes several.
    const { tip } = await tallToolCard()
    const row = () => within(screen.getByRole('region', { name: 'Other commands available' })).getByRole('button', { name: /^Tool\b/ })
    /** One try from the tall card `card`, which ends on the tall card again, for the next of `tries`. */
    const tryOnce = async (card: HTMLElement, tries: number): Promise<void> => {
      const tall = card.getBoundingClientRect()
      await hover({ x: tall.left + tall.width / 2, y: tall.bottom - 10 })
      replaceAll('/**\n * A tool.\n */\nTool(A)\n{\n}\n')
      await hover(nav())
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
      // The tall card again, for the next try.
      replaceAll(['/**', ' * A tool.', ...Array.from({ length: 30 }, (_, i) => ` * @example Tool(${i})`), ' */', 'Tool(A)', '{', '}', ''].join('\n'))
      await hover(row())
      const again = await screen.findByRole('tooltip')
      await waitFor(() => expect(getComputedStyle(again).pointerEvents).toBe('auto'))
      if (tries > 1) await tryOnce(again, tries - 1)
    }
    await tryOnce(tip, 8)
  })

  it('lets go of the pointer when the shrunk card is no longer under it', async () => {
    const { tip, shrink } = await tallToolCard()
    // Near the top of the tall card, where the shrunk card, placed level with its row, no longer is.
    const tall = tip.getBoundingClientRect()
    const rest = { x: tall.left + tall.width / 2, y: tall.top + 10 }
    await hover(rest)
    expect(tip.contains(document.elementFromPoint(rest.x, rest.y))).toBe(true)
    await shrink()
    await waitFor(() => expect(tip.getBoundingClientRect().top).toBeGreaterThan(rest.y))
    // The pointer has not moved: the card goes.
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  describe('the card of the list, by where the pointer comes from and where it goes', () => {
    /**
     * Where the pointer can be: the card's row, the row under it, the card, the 8 px gap between them,
     * elsewhere (the file list), or outside the window.
     */
    type Spot = 'row' | 'row, another point' | 'other row' | 'card' | 'card, another point' | 'gap' | 'elsewhere' | 'outside the window'
    type From = 'row' | 'card' | 'elsewhere'
    /** Whose card is up once the pointer has rested where it went: the row's, the other row's, or none. */
    type Card = 'row' | 'other row' | 'none'

    /**
     * Tall's card (tallRows) in a 300 px window, taller than the window so that it takes the pointer, up
     * for its row with the pointer on the row; then the pointer is put on `from`. The other row is
     * Second's, next to it. `tip` is the card then up: none from elsewhere.
     */
    async function startFrom(from: From) {
      const { row, other } = await tallRows()
      await hover(nav())
      await hover(row)
      const tip = await screen.findByRole('tooltip')
      expectTall(tip.firstElementChild as HTMLElement)
      await waitFor(() => expect(getComputedStyle(tip).pointerEvents).toBe('auto'))
      const box = tip.getBoundingClientRect()
      const spots: Record<Spot, Point> = {
        row: pointOn(row),
        'row, another point': pointOn(row, 0.2),
        'other row': pointOn(other),
        card: { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        'card, another point': { x: box.left + box.width / 2, y: box.top + box.height / 4 },
        // In the middle of the 8 px between the card and the panel, level with the row.
        gap: { x: box.right + 4, y: pointOn(row).y },
        elsewhere: pointOn(nav()),
        'outside the window': { x: -40, y: pointOn(row).y },
      }
      const names: Record<Exclude<Card, 'none'>, string> = { row: 'The first tool.', 'other row': 'The second tool.' }
      if (from === 'card') await hover(spots.card)
      if (from === 'elsewhere') {
        await hover(spots.elsewhere)
        await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
      }
      return { spot: (s: Spot) => spots[s], names, row, tip: from === 'elsewhere' ? null : tip }
    }

    /** Two frames of the page: what a move set off (React's render, the card placed again) is on screen by then. */
    const frames = () => checked(new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))

    /** Moves the pointer to each point in turn, and holds it there for its milliseconds of the timers' clock. */
    async function stops([[to, ms], ...others]: [Point, number][]): Promise<void> {
      await hoverPath([to])
      await frames()
      vi.advanceTimersByTime(ms)
      if (others.length > 0) await stops(others)
    }

    /**
     * Runs `move` with the page's timers on a clock the test turns (Vitest's fake setTimeout and
     * clearTimeout); the moves, the events, the frames and React run as they do for a person. The grace
     * is such a timer, so a stop is exactly as long as it says against it, on any machine. By the real
     * clock a stop lasts as long as the machine takes to move the pointer twice, and the Windows build
     * agent never once took less than the grace. A grace still pending when the real clock comes back
     * would be dropped, and would keep the card from ever starting another; none can be: `move` ends with
     * a rest of the grace or longer after its last move, which runs every grace started until then, and a
     * look that could start another comes from an event or a render, which come only after the real clock
     * is back (the clock is not empty then: CodeMirror's own hover timer, which measures by the real Date,
     * starts again on it while the pointer is over the editor). If the test ends inside, cleanUp puts the
     * real clock back.
     */
    async function onClock(move: () => Promise<void>): Promise<void> {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        await move()
      } finally {
        vi.useRealTimers()
      }
    }

    /** How long the pointer stops on a spot on the way: two thirds of the grace, by the timers' clock. */
    const STOP = Math.round((GRACE * 2) / 3)

    /** Starts from `from` and stops on each spot of `path` for STOP, then rests on the last for CARD_STAYS. */
    async function along(from: From, path: Spot[]): Promise<Awaited<ReturnType<typeof startFrom>>> {
      const started = await startFrom(from)
      await onClock(() => stops(path.map((s, i) => [started.spot(s), i < path.length - 1 ? STOP : CARD_STAYS])))
      return started
    }

    /**
     * Starts from `from` and moves through every spot of `path` in one command, back to back, so that the
     * next enter or leave can come before React has drawn the last; the stops take no time on the timers'
     * clock. Then the pointer rests on the last spot for CARD_STAYS.
     */
    async function alongInOne(from: From, path: Spot[]): Promise<Awaited<ReturnType<typeof startFrom>>> {
      const started = await startFrom(from)
      await onClock(async () => {
        await hoverPath(path.map((s) => started.spot(s)))
        await frames()
        vi.advanceTimersByTime(CARD_STAYS)
      })
      return started
    }

    // Each path starts with the pointer on `from` and moves through the spots in turn, straight from one to
    // the next (a spot on the way is a stop, shorter than the grace); then the pointer rests on the last one.
    const PATHS: [string, From, Spot[], Card][] = [
      ['row → the same row', 'row', ['row, another point'], 'row'],
      ['row → other row', 'row', ['other row'], 'other row'],
      ['row → card', 'row', ['card'], 'row'],
      ['row → (stop in the gap) → card', 'row', ['gap', 'card'], 'row'],
      ['row → (stop in the gap) → back to the row', 'row', ['gap', 'row'], 'row'],
      ['row → rests in the gap', 'row', ['gap'], 'none'],
      ['row → elsewhere', 'row', ['elsewhere'], 'none'],
      ['row → (stop elsewhere) → back to the row', 'row', ['elsewhere', 'row'], 'row'],
      ['row → outside the window', 'row', ['outside the window'], 'none'],
      ['card → the same card', 'card', ['card, another point'], 'row'],
      ['card → its row', 'card', ['row'], 'row'],
      ['card → (stop in the gap) → its row', 'card', ['gap', 'row'], 'row'],
      ['card → other row', 'card', ['other row'], 'other row'],
      ['card → (stop in the gap) → other row', 'card', ['gap', 'other row'], 'other row'],
      ['card → rests in the gap', 'card', ['gap'], 'none'],
      ['card → elsewhere', 'card', ['elsewhere'], 'none'],
      ['card → (stop elsewhere) → back to the card', 'card', ['elsewhere', 'card'], 'row'],
      ['card → outside the window', 'card', ['outside the window'], 'none'],
      ['elsewhere → row', 'elsewhere', ['row'], 'row'],
      ['elsewhere → other row', 'elsewhere', ['other row'], 'other row'],
    ]

    /** Once the pointer has rested: whose card is up, and whether it is the card that was up from the start. */
    async function expectCard(card: Card, { names, tip }: Awaited<ReturnType<typeof startFrom>>): Promise<void> {
      if (card === 'none') {
        await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
        return
      }
      // Past the grace after which a card left behind goes, by the timers' clock and then by the real one: the
      // card is the one of where the pointer rests, and the same card all along, never gone and back.
      await pause(CARD_STAYS)
      const now = screen.getByRole('tooltip')
      expect(now.textContent).toContain(names[card])
      if (tip) expect(now).toBe(tip)
    }

    it.each(PATHS)('%s', async (_name, from, path, card) => {
      await expectCard(card, await along(from, path))
    })

    // The paths with a stop on the way once more, their moves sent back to back in one command.
    it.each(PATHS.filter(([, , path]) => path.length > 1))('%s, the stop as short as one command makes it', async (_name, from, path, card) => {
      await expectCard(card, await alongInOne(from, path))
    })

    it('row → the panel scrolls under the resting pointer: the card is never the row\'s that slid away', async () => {
      const { row, spot, names } = await startFrom('row')
      const rest = spot('row')
      row.closest('aside')!.scrollBy(0, 3 * row.getBoundingClientRect().height)
      // The row slides up, away from under the resting pointer.
      await waitFor(() => expect(row.getBoundingClientRect().bottom).toBeLessThan(rest.y))
      await pause(CARD_STAYS)
      // What lies under the pointer now: a row of the list shows its own card, anything else none.
      const under = document.elementFromPoint(rest.x, rest.y)?.closest<HTMLElement>('li > button[aria-expanded]')
      const now = screen.queryByRole('tooltip')
      expect(now?.textContent ?? '').not.toContain(names.row)
      if (now) expect(under && now.textContent).toContain(under!.querySelector('span')!.textContent)
    })

    it('card → (button held, as when selecting text) → its row, rests, then released: the same card stays', async () => {
      const { spot, tip } = await startFrom('card')
      // A guard, not a reproduction: with the button held, Chromium keeps :hover on what was pressed, so a
      // hide that asked :hover would take the card away here. It passed before the hide asked the hit test too.
      // Straight onto the row, no step in the gap: the row's enter comes before the card's leave.
      await carry(spot('card'), spot('row'), 1)
      await pause(CARD_STAYS)
      expect(screen.getByRole('tooltip')).toBe(tip)
      await drop()
      await pause(CARD_STAYS)
      expect(screen.getByRole('tooltip')).toBe(tip)
    })

    it('row → its summary line goes from under the resting pointer, which stays on the row, then leaves straight off: the card goes, every time', async () => {
      // The summary line of a row is drawn only while there is a summary. The pointer rests on the top of
      // that line, which is still the row once the line goes (its padding takes the place), so the card stays.
      // When the pointer then moves before the browser has looked again at what lies under it, the browser's
      // mouseout goes to the line, off the page, and React's leave of the row never comes: only the look the
      // move itself makes can take the card away. That race goes either way from one try to the next, so the
      // test makes several.
      await start()
      await openFile('windows')
      const withSummary = '/**\n * A tool.\n */\nTool(A)\n{\n}\n'
      const without = '/**\n * @param A The a.\n */\nTool(A)\n{\n}\n'
      const row = () => within(screen.getByRole('region', { name: 'Other commands available' })).getByRole('button', { name: /^Tool\b/ })
      /** Rests on the top of the summary line, shows the card, and takes the line away from under the pointer. */
      const restAndEmpty = async () => {
        replaceAll(withSummary)
        row().scrollIntoView({ block: 'center' })
        const summary = row().querySelectorAll('span')[1]
        expect(summary.textContent).toBe('A tool.')
        const box = summary.getBoundingClientRect()
        const rest = { x: box.left + 4, y: box.top + 1 }
        await hover(nav())
        await hover(rest)
        const tip = await screen.findByRole('tooltip')
        replaceAll(without)
        expect(summary.isConnected).toBe(false)
        expect(row().contains(document.elementFromPoint(rest.x, rest.y))).toBe(true)
        return tip
      }
      // With nothing moving, the card stays past the grace: neither the re-render nor the card's own look takes it.
      const tip = await restAndEmpty()
      await pause(CARD_STAYS)
      expect(screen.getByRole('tooltip')).toBe(tip)
      const tryOnce = async (tries: number): Promise<void> => {
        await restAndEmpty()
        await hover(nav())
        await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
        if (tries > 1) await tryOnce(tries - 1)
      }
      await tryOnce(8)
    })

    it('elsewhere → (stop on the row) → rests in the gap: the card goes, every time', async () => {
      // A guard: the row is left a few milliseconds after it was entered, possibly before the page has finished
      // showing its card, and the pointer then rests. Nothing moves after that, so the card must go from what was
      // known when the row was left. The order of that leave and the card's showing goes either way from one try
      // to the next, so the test makes several.
      const { spot } = await startFrom('elsewhere')
      const tryOnce = async (tries: number): Promise<void> => {
        await hoverPath([spot('row'), spot('gap')])
        await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
        if (tries > 1) await tryOnce(tries - 1)
      }
      await tryOnce(8)
    })

    it('card → (stop on the other row) → (stop in the gap) → back to the other row: the same card all along', async () => {
      // A guard. From the card straight onto another row, the card's leave comes after that row's enter. It must not
      // start a grace the enter has just ended: the grace would then count from the row, not from the gap, run
      // out in the gap, and the card would go and come back. The stops are set on the timers' clock: two thirds
      // of the grace on the row, half of it in the gap, so the gap alone stays under the grace and the row and
      // the gap together do not.
      const { spot, tip } = await startFrom('card')
      await onClock(() =>
        stops([
          [spot('other row'), STOP],
          [spot('gap'), Math.round(GRACE / 2)],
          [spot('other row'), CARD_STAYS],
        ]),
      )
      await pause(CARD_STAYS)
      expect(screen.getByRole('tooltip')).toBe(tip)
    })

    it.each<[string, From]>([
      ['row', 'row'],
      ['card', 'card'],
    ])('%s → out of the window, with a leave whose own point is still on it: the card goes', async (_name, from) => {
      // Dispatched: a real move out of the window gives its events the outside point, so it cannot show a
      // browser that reports the leave at the last point inside. These are the events of leaving the window,
      // in the browser's order: a mouseout to nothing (relatedTarget null), then the left element's mouseleave.
      const { spot, tip } = await startFrom(from)
      const at = spot(from)
      const under = document.elementFromPoint(at.x, at.y)!
      const left = from === 'row' ? under.closest('button')! : tip!
      const init = { clientX: at.x, clientY: at.y, relatedTarget: null }
      under.dispatchEvent(new MouseEvent('mouseout', { ...init, bubbles: true }))
      left.dispatchEvent(new MouseEvent('mouseleave', init))
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    })

    it('a card shown by the keyboard stays wherever the pointer goes, until the row loses the focus or Escape', async () => {
      const { row, spot } = await startFrom('elsewhere')
      row.focus()
      const tip = await screen.findByRole('tooltip')
      await hoverPath([spot('gap'), spot('card'), spot('elsewhere'), spot('outside the window')])
      await pause(CARD_STAYS)
      expect(screen.getByRole('tooltip')).toBe(tip)
      await keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
      row.blur()
      row.focus()
      await screen.findByRole('tooltip')
      row.blur()
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
    })
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
    /** The card inside the window at each of the widths in turn. */
    const insideAt = async ([width, ...others]: number[]): Promise<void> => {
      await viewport(width, 900)
      row.scrollIntoView({ block: 'center' })
      await hover(row)
      const tip = await screen.findByRole('tooltip')
      await waitFor(() => expect(tip.getBoundingClientRect().left).toBeGreaterThanOrEqual(0))
      expect(tip.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
      await hover(nav())
      await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
      if (others.length > 0) await insideAt(others)
    }
    // 700: room beside the panel for a narrower card; 440: too little, so the card goes over the panel.
    await insideAt([700, 440])
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
