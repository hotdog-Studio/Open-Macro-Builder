import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { MemoryFolder } from '../core/folder/memory'
import { fingerprint } from '../core/update/fingerprint'
import type { KnownReleases } from '../core/update/history'
import type { UpdateSource } from '../state/updateActions'
import { click, repoFiles, showMessage, startApp, unmount, type StartHow } from '../../test/browser/harness'

// The update's bar and dialog as the page lays them out, in the 1280×900 window of the other suites: a
// folder of an older release, with thirty icons to replace, two command files the person changed and
// one they deleted.

afterEach(async () => {
  unmount()
  await page.viewport(1280, 900)
})

const DIALOG = { name: 'Update the scripts in this folder' }
const REVIEW = { name: 'Review the update' }
const REPLACED = { name: 'Replaced 30 files you have not changed' }
const CHANGED = ['ahk/commands/media.ahk', 'powershell/commands/media.ps1']
const DELETED = 'ahk/commands/power.ahk'
const MINE = 'local/ahk/mine.ahk'
const MINE_TEXT = 'Mine(Macro) {\n}\n'

/** 1.0.4's copy of a file: one byte longer than the app's. */
function older(data: Uint8Array): Uint8Array {
  const copy = new Uint8Array(data.length + 1)
  copy.set(data)
  return copy
}

/** Each file's fingerprint. */
async function printsOf(files: [string, Uint8Array][]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(files.map(async ([path, data]) => [path, await fingerprint(path, data)])))
}

/**
 * The repository's scripts as the app's copy (1.0.6), and a folder of 1.0.4 to open: thirty icons as 1.0.4
 * shipped them, two command files the person changed, one they deleted, and a command file of their own.
 * The app's files load once `hold` has resolved.
 */
async function olderRelease(hold: Promise<void> = Promise.resolve()): Promise<{ updateSource: UpdateSource; files: Record<string, Uint8Array | null> }> {
  const repo = await repoFiles()
  const icons = Object.keys(repo)
    .filter((path) => path.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 30)
  const shipped: [string, Uint8Array][] = [...icons.map((path): [string, Uint8Array] => [path, older(repo[path])]), [DELETED, repo[DELETED]]]
  const [index, old] = await Promise.all([printsOf(Object.entries(repo)), printsOf(shipped)])
  const known: KnownReleases = {
    last: '1.0.4',
    files: Object.fromEntries(Object.entries(old).map(([path, print]) => [path, { [print]: ['1.0.4'] }])),
  }
  const updateSource: UpdateSource = {
    loadIndex: async () => ({ version: '1.0.6', files: index }),
    loadFiles: async () => {
      await hold
      return Object.entries(repo).map(([path, data]) => ({ path, data }))
    },
    known,
  }
  const files: Record<string, Uint8Array | null> = {
    ...Object.fromEntries(shipped.slice(0, 30)),
    ...Object.fromEntries(CHANGED.map((path) => [path, new TextEncoder().encode('; mine\n')])),
    [DELETED]: null,
    [MINE]: new TextEncoder().encode(MINE_TEXT),
  }
  return { updateSource, files }
}

/** Opens the older release's folder, and the dialog when asked. */
async function opened(dialog: boolean): Promise<HTMLElement | null> {
  await startApp('Pad shape', undefined, await olderRelease())
  return review(dialog)
}

/** Waits for the bar, and opens the dialog when asked. */
async function review(dialog: boolean): Promise<HTMLElement | null> {
  const review = await screen.findByRole('button', REVIEW)
  if (!dialog) return null
  await click(review)
  return screen.getByRole('dialog', DIALOG)
}

const editorEl = () => {
  const el = document.querySelector<HTMLElement>('.cm-content')
  if (!el) throw new Error('no code editor')
  return el
}

/** Records every element that gets the focus from now on, until `stop()`. */
function focusesOf() {
  const reached: Element[] = []
  const record = (e: FocusEvent) => reached.push(e.target as Element)
  document.addEventListener('focusin', record)
  return {
    stop: () => {
      document.removeEventListener('focusin', record)
      return reached
    },
  }
}

const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
const inWindow = (r: DOMRect) => r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth
/** Whether the mouse can reach the middle of an element: on screen and not covered or cut off. */
const reachable = (el: Element) => {
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return hit !== null && el.contains(hit)
}

describe('the update, at 1280 × 900', () => {
  it("shows the bar under the header, clear of the header's buttons", async () => {
    await opened(false)
    const review = screen.getByRole('button', REVIEW)
    const bar = review.closest('output')
    if (!bar) throw new Error('Review the update is not in the bar')
    const box = bar.getBoundingClientRect()
    expect(inWindow(box)).toBe(true)
    for (const el of document.querySelectorAll('header button, header a')) {
      expect(overlap(el.getBoundingClientRect(), box), el.textContent ?? '').toBe(false)
    }
    expect(reachable(review)).toBe(true)
    expect(reachable(within(bar).getByRole('button', { name: 'Not now' }))).toBe(true)
  })

  it('fits the dialog in the window with thirty paths shown: its list scrolls, and its buttons stay reachable', async () => {
    const dialog = await opened(true)
    if (!dialog) throw new Error('no dialog')
    await click(within(dialog).getByRole('button', REPLACED))
    const list = within(dialog).getByRole('list', REPLACED)
    expect(within(list).getAllByRole('listitem')).toHaveLength(30)
    expect(inWindow(dialog.getBoundingClientRect())).toBe(true)
    const body = list.closest('.overflow-auto')
    if (!body) throw new Error('the paths are not in a scrolling part of the dialog')
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
    expect(reachable(within(dialog).getByRole('button', { name: 'Not now' }))).toBe(true)
    expect(reachable(within(dialog).getByRole('button', { name: 'Update' }))).toBe(true)
    // The last tick box is reached by scrolling the dialog, not the page.
    const last = within(dialog).getByRole('checkbox', { name: DELETED })
    last.scrollIntoView({ block: 'nearest' })
    expect(reachable(last)).toBe(true)
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(document.documentElement.clientHeight)
  })

  it('closes on Escape as Not now does: the dialog and the bar go', async () => {
    await opened(true)
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', DIALOG)).toBeNull()
    expect(screen.queryByRole('button', REVIEW)).toBeNull()
  })

  it('starts on the dialog, and Tab goes through every tick box and both buttons, never behind the dialog', async () => {
    const dialog = await opened(true)
    if (!dialog) throw new Error('no dialog')
    expect(document.activeElement).toBe(dialog)
    const reached = focusesOf()
    // More presses than the dialog has controls (six): the seventh and later would leave it if anything let them.
    await userEvent.keyboard('{Tab}'.repeat(9))
    const controls = [
      within(dialog).getByRole('button', REPLACED),
      ...CHANGED.map((path) => within(dialog).getByRole('checkbox', { name: path })),
      within(dialog).getByRole('checkbox', { name: DELETED }),
      within(dialog).getByRole('button', { name: 'Not now' }),
      within(dialog).getByRole('button', { name: 'Update' }),
    ]
    expect(reached.stop().slice(0, 6)).toEqual(controls)
    expect(reached.stop().filter((el) => !dialog.contains(el))).toEqual([])
  })

  it('while it runs, keeps the focus on the dialog: Tab and Ctrl+S reach nothing behind it', async () => {
    let release!: () => void
    const hold = new Promise<void>((resolve) => (release = resolve))
    const { folder } = await startApp('Commands', undefined, await olderRelease(hold))
    // An unsaved edit of a command file of your own, which does not keep Update off.
    await click(within(screen.getByRole('navigation', { name: 'Command files' })).getByRole('button', { name: /^mine\b/ }))
    await click(editorEl())
    await userEvent.keyboard('x')
    const dialog = await review(true)
    if (!dialog) throw new Error('no dialog')
    await click(within(dialog).getByRole('button', { name: 'Update' }))
    const busy = screen.getByRole('dialog', DIALOG)
    expect(within(busy).getByText('Updating the scripts…')).toBeTruthy()
    expect(document.activeElement).toBe(busy)
    const reached = focusesOf()
    await userEvent.keyboard('{Tab}{Tab}{Tab}{Control>}s{/Control}')
    expect(reached.stop().filter((el) => !busy.contains(el))).toEqual([])
    expect(folder.text(MINE)).toBe(MINE_TEXT)
    release()
    expect(await screen.findByText(/^Updated to 1\.0\.6: 30 replaced/)).toBeTruthy()
  })
})

// ---------------------------------------------------------------- a command the update takes away

const VS_AHK = 'ahk/commands/custom/vsstudio.ahk'
const VS_PS1 = 'powershell/commands/custom/vsstudio.ps1'
/** A command only 1.0.4's vsstudio files defined, with a name too long for one line of the dialog. */
const LONG = 'VsStudioSplitTheEditorIntoTwoPanelsSideBySideWithACommandNameFarTooLongForOneLine'
/** A layer title that would be markup if it were not shown as text. */
const MARKUP = '<b>VS</b> Studio & <i>more</i>'
const UNSET_HEAD = 'Your layout runs commands that no file would define after this update:'

/**
 * The repository's scripts as the app's copy (1.0.6); a folder whose vsstudio files are 1.0.4's, which also defined
 * LONG; and a layout whose first layer, titled MARKUP, runs LONG on its first key (F13).
 */
async function takenAway(): Promise<{ how: StartHow; layout: string }> {
  const repo = await repoFiles()
  const enc = new TextEncoder()
  const dec = new TextDecoder()
  const shipped: [string, Uint8Array][] = [
    [VS_AHK, enc.encode(`${dec.decode(repo[VS_AHK])}\n${LONG}(Macro) {\n}\n`)],
    [VS_PS1, enc.encode(`${dec.decode(repo[VS_PS1])}function ${LONG} { param($Macro) }\n`)],
  ]
  const [index, old] = await Promise.all([printsOf(Object.entries(repo)), printsOf(shipped)])
  const known: KnownReleases = {
    last: '1.0.4',
    files: Object.fromEntries(Object.entries(old).map(([path, print]) => [path, { [print]: ['1.0.4'] }])),
  }
  const updateSource: UpdateSource = {
    loadIndex: async () => ({ version: '1.0.6', files: index }),
    loadFiles: async () => Object.entries(repo).map(([path, data]) => ({ path, data })),
    known,
  }
  const config = JSON.parse(dec.decode(repo['config.json'])) as { layers: { title: string; macros: unknown[] }[] }
  config.layers[0].title = MARKUP
  config.layers[0].macros[0] = { action: LONG, name: 'Split' }
  return { how: { updateSource, files: Object.fromEntries(shipped) }, layout: JSON.stringify(config, null, 2) }
}

describe('the warning of a command the update takes away', () => {
  it.each([
    [1280, 900],
    [760, 420],
  ])('at %i × %i, reads as text and fits the dialog', async (width, height) => {
    await page.viewport(width, height)
    const { how, layout } = await takenAway()
    await startApp('Pad shape', layout, how)
    const dialog = await review(true)
    if (!dialog) throw new Error('no dialog')
    const list = await within(dialog).findByRole('list', { name: UNSET_HEAD })
    const items = within(list).getAllByRole('listitem')
    expect(items.map((item) => item.textContent)).toEqual([`${LONG} (${MARKUP} · F13)`])
    expect(dialog.querySelector('b, i')).toBeNull()
    const box = dialog.getBoundingClientRect()
    expect(inWindow(box)).toBe(true)
    for (const el of [list.parentElement ?? list, list, ...items]) {
      el.scrollIntoView({ block: 'nearest' })
      const r = el.getBoundingClientRect()
      expect(r.left >= box.left && r.right <= box.right, el.textContent ?? '').toBe(true)
      expect(el.scrollWidth, el.textContent ?? '').toBeLessThanOrEqual(el.clientWidth)
    }
    expect(reachable(within(dialog).getByRole('button', { name: 'Update' }))).toBe(true)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  })
})

// ---------------------------------------------------------------- the bars float

const ON_DISK = 'config.json changed on disk.'
const MESSAGE = 'A message that stays until it is dismissed.'
const SIZES: [number, number][] = [
  [1280, 900],
  [760, 420],
]

/** The older release's folder, whose check waits until `release` is called. */
async function heldRelease(): Promise<{ how: StartHow; release: () => void }> {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  const { updateSource, files } = await olderRelease()
  const loadIndex = async () => {
    await held
    return updateSource.loadIndex()
  }
  return { how: { updateSource: { ...updateSource, loadIndex }, files }, release }
}

/** Where each element of the app is now. */
function placesOf(): Map<Element, string> {
  const places = new Map<Element, string>()
  for (const el of document.querySelectorAll('#root *')) {
    const r = el.getBoundingClientRect()
    places.set(el, `${r.left},${r.top},${r.width},${r.height}`)
  }
  return places
}

/** The elements still in the page that are not where `before` had them, named for a failure message. */
function moved(before: Map<Element, string>): string[] {
  const now = placesOf()
  return [...before]
    .filter(([el, place]) => el.isConnected && now.get(el) !== place)
    .map(([el, place]) => `<${el.tagName.toLowerCase()}> ${el.textContent?.slice(0, 40)}: ${place} -> ${now.get(el)}`)
}

/** Makes config.json change on disk and the window get the focus back, then waits for the bar that says so. */
async function changeOnDisk(folder: MemoryFolder): Promise<HTMLElement> {
  await folder.writeBytes('local/config.json', new TextEncoder().encode(`${folder.text('local/config.json')}\n`))
  window.dispatchEvent(new Event('focus'))
  const bar = (await screen.findByText(ON_DISK)).closest<HTMLElement>('[role="alert"]')
  if (!bar) throw new Error('the changed-on-disk text is not in an alert')
  return bar
}

const updateBar = () => {
  const bar = screen.getByRole('button', REVIEW).closest<HTMLElement>('output')
  if (!bar) throw new Error('Review the update is not in the bar')
  return bar
}

const messageCard = () => {
  const card = screen.getByText(MESSAGE).closest<HTMLElement>('[role="alert"]')
  if (!card) throw new Error('the message is not in an alert')
  return card
}

interface Spot {
  x: number
  y: number
  under: Element
}

/** A point of the content area beside `bar`, level with its middle, and what is there. */
function besideOf(bar: HTMLElement): Spot {
  const r = bar.getBoundingClientRect()
  const x = r.left / 2
  const y = r.top + r.height / 2
  const under = document.elementFromPoint(x, y)
  if (!under) throw new Error('nothing beside the bar')
  return { x, y, under }
}

/** Whether a real click at the spot reaches the element there. */
async function clickReaches({ x, y, under }: Spot): Promise<boolean> {
  let reached = false
  const note = () => {
    reached = true
  }
  under.addEventListener('click', note)
  const r = under.getBoundingClientRect()
  // Through the browser, which refuses when another element would take the click at that point.
  await userEvent.click(under, { position: { x: x - r.left, y: y - r.top } })
  under.removeEventListener('click', note)
  return reached
}

describe('the bars float over the top of the content area', () => {
  it.each(SIZES)('at %i × %i, nothing in the page moves when the changed-on-disk bar comes or goes', async (width, height) => {
    await page.viewport(width, height)
    const { folder } = await startApp()
    const before = placesOf()
    const bar = await changeOnDisk(folder)
    expect(moved(before)).toEqual([])
    const shown = placesOf()
    await click(within(bar).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(ON_DISK)).toBeNull()
    expect(moved(shown)).toEqual([])
  })

  it.each(SIZES)('at %i × %i, nothing in the page moves when the update bar comes or goes', async (width, height) => {
    await page.viewport(width, height)
    const { how, release } = await heldRelease()
    await startApp('Pad shape', undefined, how)
    const before = placesOf()
    release()
    await screen.findByRole('button', REVIEW)
    expect(moved(before)).toEqual([])
    const shown = placesOf()
    await click(within(updateBar()).getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('button', REVIEW)).toBeNull()
    expect(moved(shown)).toEqual([])
  })

  it.each(SIZES)(
    'at %i × %i, stacks the changed-on-disk bar, the update bar and a message in that order, apart and clear of the header, and each of their buttons can be pressed',
    async (width, height) => {
      await page.viewport(width, height)
      const { folder } = await startApp('Pad shape', undefined, await olderRelease())
      await screen.findByRole('button', REVIEW)
      const onDisk = await changeOnDisk(folder)
      showMessage({ kind: 'warning', text: MESSAGE, stays: true })
      await screen.findByText(MESSAGE)
      const message = messageCard()
      const update = updateBar()
      const boxes = [onDisk, update, message].map((el) => el.getBoundingClientRect())
      for (const box of boxes) expect(inWindow(box)).toBe(true)
      expect(boxes[0].bottom).toBeLessThanOrEqual(boxes[1].top)
      expect(boxes[1].bottom).toBeLessThanOrEqual(boxes[2].top)
      const header = screen.getByRole('banner').getBoundingClientRect()
      for (const box of boxes) expect(box.top).toBeGreaterThanOrEqual(header.bottom)
      for (const el of document.querySelectorAll('header button, header a')) {
        for (const box of boxes) expect(overlap(el.getBoundingClientRect(), box), el.textContent ?? '').toBe(false)
      }
      const buttons = [
        within(onDisk).getByRole('button', { name: 'Reload from disk' }),
        within(onDisk).getByRole('button', { name: 'Dismiss' }),
        within(update).getByRole('button', REVIEW),
        within(update).getByRole('button', { name: 'Not now' }),
        within(message).getByRole('button', { name: 'Dismiss' }),
      ]
      for (const button of buttons) expect(reachable(button), button.textContent ?? '').toBe(true)
      // Pressed from the last up, each goes, and the bar above stays where it was.
      await click(within(message).getByRole('button', { name: 'Dismiss' }))
      expect(screen.queryByText(MESSAGE)).toBeNull()
      await click(within(update).getByRole('button', { name: 'Not now' }))
      expect(screen.queryByRole('button', REVIEW)).toBeNull()
      expect(onDisk.getBoundingClientRect().top).toBe(boxes[0].top)
      await click(within(onDisk).getByRole('button', { name: 'Dismiss' }))
      expect(screen.queryByText(ON_DISK)).toBeNull()
    },
  )

  it('lets a click on the empty space beside each bar reach what is under it', async () => {
    const { folder } = await startApp('Pad shape', undefined, await olderRelease())
    await screen.findByRole('button', REVIEW)
    const onDisk = await changeOnDisk(folder)
    for (const bar of [onDisk, updateBar()]) {
      const beside = besideOf(bar)
      // The bars stand in the stack they float in; the point beside them is not in it.
      expect(bar.parentElement?.contains(beside.under), beside.under.tagName).toBe(false)
      expect(await clickReaches(beside)).toBe(true)
    }
  })
})
