import { screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { fingerprint } from '../core/update/fingerprint'
import type { KnownReleases } from '../core/update/history'
import type { UpdateSource } from '../state/updateActions'
import { click, repoFiles, startApp, unmount } from '../../test/browser/harness'

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
  it("shows the bar in the page, clear of the header's buttons", async () => {
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
