/// <reference types="@vitest/browser-playwright" />
import { cleanup, render, screen } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { vi } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import type { Workspace } from '../../src/core/config/model'
import { MemoryFolder } from '../../src/core/folder/memory'
import { SETTINGS_PATH } from '../../src/core/settings'
import type { Platform } from '../../src/platform/types'
import { AppProvider, useApp, type Banner } from '../../src/state/store'
import type { UpdateSource } from '../../src/state/updateActions'
import { App } from '../../src/ui/App'
import type { PointerPath, TouchPath } from './commands'
import { checked, endTest, rest } from './lifetime'

export { checked, rest } from './lifetime'

declare module 'vitest/browser' {
  interface BrowserCommands {
    pointerPath: (path: PointerPath) => Promise<void>
    releaseHeld: () => Promise<boolean>
    touchPath: (path: TouchPath) => Promise<void>
    validateSavedConfig: (text: string) => Promise<string[]>
  }
}

// ---------------------------------------------------------------- the example repository

// The browser has no file system, so Vite serves the repository's files and the tests fetch them.
// As URLs, not ?raw: the bytes stay as they are on disk. Nothing under local/ is listed here.
const urls = import.meta.glob<string>(
  [
    '../../../config.json',
    '../../../ahk/main.ahk',
    '../../../ahk/commands/**/*.ahk',
    '../../../powershell/commands/**/*.ps1',
    '../../../powershell/lib/*.ps1',
    '../../../img/**/*.png',
  ],
  { query: '?url', import: 'default', eager: true },
)

let fetched: Promise<Record<string, Uint8Array>> | undefined

/**
 * The example repository's files by path ('config.json', 'img/media/layer.png'). Fetched once per test
 * file; a test that ended while they were fetched stops here.
 */
export function repoFiles(): Promise<Record<string, Uint8Array>> {
  fetched ??= (async () => {
    const files: Record<string, Uint8Array> = {}
    await Promise.all(
      Object.entries(urls).map(async ([glob, url]) => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`repoFiles: ${url} answered ${res.status}`)
        files[glob.replace(/^(\.\.\/)+/, '')] = new Uint8Array(await res.arrayBuffer())
      }),
    )
    return files
  })()
  return checked(fetched)
}

/** The files a folder opens straight into the editor with: the repository, a personal config and settings. */
export async function editableFiles(config?: string): Promise<Record<string, Uint8Array>> {
  const files = await repoFiles()
  return {
    ...files,
    'local/config.json': config === undefined ? files['config.json'] : new TextEncoder().encode(config),
    [SETTINGS_PATH]: new TextEncoder().encode('{ "languages": ["ahk"] }\n'),
  }
}

// ---------------------------------------------------------------- the app

/** Hands the tests whatever useApp() gives the components. */
let seen: ReturnType<typeof useApp> | undefined
function Probe() {
  const app = useApp()
  // A layout effect: in place by the time the page changes, so a test that waited for the page sees it.
  useLayoutEffect(() => {
    seen = app
  })
  return null
}

function editor() {
  if (seen?.state.screen !== 'edit') throw new Error('expected the editor')
  return seen.state
}

/** The workspace being edited. */
export const ws = (): Workspace => editor().ws
/** Whether config.json has unsaved edits. */
export const dirty = (): boolean => editor().dirty

/**
 * Renders the app full-window, as index.html does, with a Probe beside it. No update check unless an
 * `updateSource` is given: the folder lacks shared files, and the bar would float over the editor
 * part-way through a test.
 */
export function mount(platform: Platform, updateSource: UpdateSource | null = null): void {
  inputOpen = true
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  render(
    <AppProvider platform={platform} updateSource={updateSource}>
      <App />
      <Probe />
    </AppProvider>,
    { container: root },
  )
}

/** Takes the app away. Between tests, cleanUp does it once the test's input has ended. */
export function unmount(): void {
  cleanup()
  seen = undefined
  document.getElementById('root')?.remove()
}

// ---------------------------------------------------------------- input in flight

// A test that ends first (a timeout, a failed assertion) stops nothing by itself: a command it sent
// runs on in the Node side of Vitest, and its body goes on running once what it awaited ends. On the
// Windows build agent a test once timed out with hundreds of keys still to type, and the four tests
// after it failed on them. So, between one test and the next:
// - cleanUp closes input, ends the test for the waits (lifetime.ts), puts the real clock back, waits
//   for the commands in flight (and the changes to the browser's storage, inStorage), takes the app
//   away and lets go of a mouse button a carry left down (keys held are let go by Vitest itself). The
//   next test starts when cleanUp has ended, so nothing of the test before is still going by then;
// - a body that outlived its test stops when the wait or command it was in ends: every await of a test
//   that waits on the browser or on Node is checked (waitFor, findBy*, rest, input, viewport,
//   validatorProblems, repoFiles, inStorage, checked); and input it sends before the next app is
//   mounted is refused;
// - a command is never longer than LONGEST_COMMAND moves or presses, which keeps that wait of cleanUp,
//   and so cleanUp, far inside the time limit of its hook (see there). Nothing here is built for a
//   clean-up that ends after the next test has started: the limit on a command is what rules it out.

/**
 * How long a single command may be: how many moves of the mouse or of a finger, or presses of a key.
 *
 * cleanUp waits for the command in flight when its test ended, and must itself end inside the time
 * limit of its hook: 30 s (Vitest's hookTimeout in browser mode; vitest.browser.config.ts sets only
 * testTimeout). On the Windows build agent, the slowest machine these tests run on, a move costs
 * 0.3 s at most (a step of a drag, the dearest kind: a test of six drags in 11 moves each took 19.3 s
 * in all) and a key 0.4 s at most (the slowest there, typed while another command typed too, which a
 * test typing one key a command no longer meets). So a command of 20 lasts 8 s there at the very
 * most, about a quarter of the limit; the rest is for what else the hook waits for (a change to the
 * storage, the button let go, the window's size: a few seconds together there). The longest command
 * the tests send is a drag in 10 steps, 11 moves. A click or a fill counts as one: Vitest gives it a
 * time limit of its own, which runs out before that of the test that sent it.
 */
export const LONGEST_COMMAND = 20

/** The commands that type, click or move the pointer, and the test's changes to the browser's storage, from when they start until they end. */
const inFlight = new Set<Promise<unknown>>()

/** Whether input may be sent: not from a test's clean-up until the next app is mounted. */
let inputOpen = true

/** Every command still in flight has ended. */
const inputEnded = async (): Promise<void> => {
  await Promise.allSettled(inFlight)
}

/** Keeps `work` in inFlight until it ends, so that cleanUp waits for it; a test that ended meanwhile stops when it ends. */
function keptInFlight<T>(work: Promise<T>): Promise<T> {
  inFlight.add(work)
  const forget = () => inFlight.delete(work)
  void work.then(forget, forget)
  return checked(work)
}

/**
 * Sends a command that types, clicks or moves the pointer, `length` moves or presses long, and keeps it
 * in inFlight until it ends. Refuses one longer than LONGEST_COMMAND, and any sent after its test ended.
 */
function input<T>(length: number, send: () => PromiseLike<T>): Promise<T> {
  if (length > LONGEST_COMMAND) {
    return Promise.reject(
      new Error(
        `a command of ${length} moves or presses: one command may make ${LONGEST_COMMAND} at most, so that the clean-up after a test, which waits for the command in flight, ends inside its hook's time limit on the slowest build machine. Send it as several commands.`,
      ),
    )
  }
  if (!inputOpen) return Promise.reject(new Error('input sent after its test had ended'))
  return keptInFlight(Promise.resolve().then(send))
}

/**
 * A change the test makes to the browser's storage outside the app (a folder of its private storage
 * written or deleted, the remembered folder read): kept in inFlight like a command, so that cleanUp
 * waits for it to end before the next test, and a test that ended meanwhile stops when it ends.
 */
export const inStorage = <T,>(change: () => Promise<T>): Promise<T> => keptInFlight(change())

/** How long dnd-kit goes on swallowing clicks after a drag ends, and a little more, in milliseconds. */
const DND_KIT_CLICK_GUARD = 60

/**
 * Takes the app away after a test, whatever way the test ended, so that nothing of it reaches the
 * next: see the list above. The wait for what is in flight is for one command, of LONGEST_COMMAND
 * at most, and in the e2e tests for a change to the storage (the folder of the example: a second or
 * two on the build agent), which keeps the clean-up far inside its hook's limit of 30 s.
 *
 * The button is let go after whatever was in flight, and after the app has gone, so that no app takes
 * it as a drop. A drag the app was in when it went keeps dnd-kit's listeners on the document, among
 * them one that stops every click, until the button is let go; dnd-kit then takes them away with a
 * timer of 50 ms, so the clean-up waits for a longer timer, set after that one: the browser runs the
 * two in that order on a machine of any speed.
 */
export async function cleanUp(): Promise<void> {
  inputOpen = false
  endTest()
  vi.useRealTimers()
  await inputEnded()
  unmount()
  if (await commands.releaseHeld()) await new Promise((done) => setTimeout(done, DND_KIT_CLICK_GUARD))
}

export type TabName = 'Get started' | 'Pad shape' | 'Layers' | 'Macros' | 'Icons' | 'Commands'

/** A real click, through the browser: in the middle of the element, or where `options` say. */
export const click = (el: Element, options?: Parameters<typeof userEvent.click>[1]) => input(1, () => userEvent.click(el, options))

const CLOSERS: Record<string, string> = { '{': '}', '[': ']' }

/** The keys of a text in the syntax of userEvent.keyboard: `{Enter}`, `{Control>}`, `[KeyA]`, an escaped `{{` or `[[`, or one character. */
function keysOf(text: string): string[] {
  const keys: string[] = []
  let at = 0
  while (at < text.length) {
    const close = CLOSERS[text[at]]
    let end = at + 1
    if (close !== undefined && text[at + 1] === text[at]) end = at + 2
    else if (close !== undefined) end = text.indexOf(close, at) + 1 || text.length
    keys.push(text.slice(at, end))
    at = end
  }
  return keys
}

/** How many times a key of keysOf is pressed: once, or the count after its `>` (`{a>3}`, `{a>3/}`). */
const pressesOf = (key: string): number => Number(/>(\d+)\/?[}\]]$/.exec(key)?.[1] ?? 1)

/** Presses the keys one command each: a key held with `>` stays held from one to the next. */
async function pressEach([first, ...others]: string[]): Promise<void> {
  if (first === undefined) return
  await input(pressesOf(first), () => userEvent.keyboard(first))
  await pressEach(others)
}

/** Real typing, through the browser, in the syntax of userEvent.keyboard: one command a key. */
export const keyboard = (text: string): Promise<void> => pressEach(keysOf(text))

/** Puts `text` in a field at once, through the browser, as pasting does. */
export const fill = (el: Element, text: string) => input(1, () => userEvent.fill(el, text))

/** How startApp opens the app, beyond the tab and the layout. */
export interface StartHow {
  /** The look the app has: `electron` is the desktop app, with no Download link. */
  kind?: Platform['kind']
  folderName?: string
  /** What the check after opening compares the folder with; none checks no folder. */
  updateSource?: UpdateSource
  /** Files put into the folder over the repository's (null leaves one out). */
  files?: Record<string, Uint8Array | null>
}

/**
 * The example repository in memory, opened in the editor on a tab. `layout` is the text of the
 * personal config.json to open instead of the example's, for a pad of another shape. `how` says
 * which look the app has, the folder's name, and for the tests of the update, its source and files.
 */
export async function startApp(tab: TabName = 'Pad shape', layout?: string, how: StartHow = {}): Promise<{ folder: MemoryFolder }> {
  const files: Record<string, Uint8Array | null> = { ...(await editableFiles(layout)), ...how.files }
  const kept = Object.entries(files).filter((entry): entry is [string, Uint8Array] => entry[1] !== null)
  const folder = new MemoryFolder(how.folderName ?? 'repo', Object.fromEntries(kept))
  const platform: Platform = { kind: how.kind ?? 'browser', openFolder: async () => folder, createFolder: async () => null, restoreFolder: async () => null }
  mount(platform, how.updateSource ?? null)
  await click(await screen.findByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
  if (tab !== 'Pad shape') await openTab(tab)
  return { folder }
}

/** The start screen, with no folder open and none to reopen. */
export function startOpenScreen(): void {
  mount({ kind: 'browser', openFolder: async () => null, createFolder: async () => null, restoreFolder: async () => null })
}

export async function openTab(tab: TabName): Promise<void> {
  await click(screen.getByRole('tab', { name: tab }))
}

/**
 * What the repository's validator (scripts/validate-config.mjs) says about a saved config: its
 * problems, none when both versions of the macropad would load it.
 */
export const validatorProblems = (text: string): Promise<string[]> => checked(commands.validateSavedConfig(text))

/** Sets the size of the page's window, as page.viewport does; a test that ended meanwhile stops here. */
export const viewport = (width: number, height: number): Promise<void> => checked(page.viewport(width, height))

// ---------------------------------------------------------------- the mouse

export interface Point {
  x: number
  y: number
}

/** The middle of an element, or the point at a fraction of its width and height. */
export function at(el: Element, fx = 0.5, fy = 0.5): Point {
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width * fx, y: r.top + r.height * fy }
}

const point = (p: Element | Point): Point => (p instanceof Element ? at(p) : p)
export const offset = (p: Element | Point, dx: number, dy: number): Point => {
  const from = point(p)
  return { x: from.x + dx, y: from.y + dy }
}

/** How many moves a path makes: one to its first point, then `steps` to each of the others. */
const movesOf = (points: Point[], steps: number): number => (points.length === 0 ? 0 : 1 + (points.length - 1) * steps)

function path(points: Point[], press: boolean, release: boolean, steps: number): Promise<void> {
  return input(movesOf(points, steps), () =>
    commands.pointerPath({
      points,
      press,
      release,
      steps,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }),
  )
}

/** The invisible box dnd-kit's DragOverlay keeps over the page during a drag and its drop animation. */
const overlayBox = () =>
  [...document.querySelectorAll<HTMLElement>('div')].some((d) => d.style.position === 'fixed' && d.style.zIndex === '999')

/**
 * Waits until the page takes the mouse again after a drop. Two things linger: for 50 ms dnd-kit
 * swallows clicks (so that letting a key go does not also click it), and for about a quarter of a
 * second the DragOverlay's box still covers the spot of the drop. A person is slower than both; a
 * test is not, and its next press would land on nothing.
 */
async function afterDrop(): Promise<void> {
  await rest(DND_KIT_CLICK_GUARD)
  await overlayGone(80)
}

/** Waits until the DragOverlay's box has gone, looking every 25 ms, `tries` times at most. */
async function overlayGone(tries: number): Promise<void> {
  if (tries === 0 || !overlayBox()) return
  await rest(25)
  await overlayGone(tries - 1)
}

/**
 * Presses the mouse on `from`, moves it to `to` and lets go. An element means its middle. The
 * move is split into steps, as a hand moves: the grid starts a drag only after 5 px of travel.
 */
export async function drag(from: Element | Point, to: Element | Point, steps = 10): Promise<void> {
  await path([point(from), point(to)], true, true, steps)
  await afterDrop()
}

/** A drag that does not wait afterwards, for testing what the page does with the very next press. */
export function dragNoWait(from: Element | Point, to: Element | Point, steps = 10): Promise<void> {
  return path([point(from), point(to)], true, true, steps)
}

/** Like drag, but keeps the button down, so a test can look at the page mid-drag. End with drop(). */
export function carry(from: Element | Point, to: Element | Point, steps = 10): Promise<void> {
  return path([point(from), point(to)], true, false, steps)
}

/** Moves the real mouse to `to` without pressing, as a hand resting the pointer on something. */
export function hover(to: Element | Point): Promise<void> {
  return path([point(to), point(to)], false, false, 1)
}

/**
 * Moves the real mouse through `points` in one command, straight from each to the next with no step
 * between: a point on the way is a stop, as short as the browser makes two moves.
 */
export function hoverPath(points: (Element | Point)[]): Promise<void> {
  return path(points.map(point), false, false, 1)
}

/** Moves the mouse on to `to`, the button still down from carry(). */
export function carryOn(to: Element | Point, steps = 10): Promise<void> {
  return path([point(to), point(to)], false, false, steps)
}

/** A drag with one finger on a touch screen: down on `from`, across to `to`, and up. */
export async function touchDrag(from: Element | Point, to: Element | Point, steps = 10): Promise<void> {
  const points = [point(from), point(to)]
  await input(movesOf(points, steps), () =>
    commands.touchPath({
      points,
      steps,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    }),
  )
  await afterDrop()
}

/** Lets the button go. */
export async function drop(): Promise<void> {
  await path([], false, true, 1)
  await afterDrop()
}

// ---------------------------------------------------------------- the pad

/** A square of the grid, by row and column from 1. */
export function cell(row: number, col: number): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)
  if (!el) throw new Error(`the grid has no square at row ${row}, column ${col}`)
  return el
}

/** A key of the grid by the name of the keyboard key it sends ('F13'), whatever else its face says. */
export function padKey(name: string): HTMLElement {
  const keys = screen.getByRole('list', { name: 'Keys' })
  const found = [...keys.querySelectorAll<HTMLElement>(':scope > li > [data-key]')].filter((el) =>
    // The Fn key's face reads "Fn" straight before its name on the Layers and Macros tabs.
    (el.textContent ?? '')
      .replace(/^Fn(?=\S)/, '')
      .split(/[\s×+]+/)
      .includes(name),
  )
  if (found.length !== 1) throw new Error(`expected one key named ${name}, found ${found.length}`)
  return found[0]
}

/** The label strip above a key (the layer's title, the macro's label), or null when it has none. */
export function strip(name: string): string | null {
  return padKey(name).closest('li')?.querySelector('.pointer-events-none.absolute.font-mono')?.textContent ?? null
}

/** The copy of a dragged chip or command row that follows the mouse, or null when nothing is carried. */
export function carried(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.cursor-grabbing')
}

/** Shows `message` as the app shows its messages, floating over the editor. */
export function showMessage(message: Banner): void {
  if (!seen) throw new Error('the app is not mounted')
  seen.dispatch({ type: 'banner', banner: message })
}

/** The message floating over the editor (a notice, a refused action or an error), or null. */
export function banner(): string | null {
  return document.querySelector('[role="alert"] > span, output > span')?.textContent ?? null
}
