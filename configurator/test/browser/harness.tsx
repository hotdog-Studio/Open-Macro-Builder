/// <reference types="@vitest/browser-playwright" />
import { cleanup, render, screen } from '@testing-library/react'
import { useLayoutEffect } from 'react'
import { commands, userEvent } from 'vitest/browser'
import type { Workspace } from '../../src/core/config/model'
import { MemoryFolder } from '../../src/core/folder/memory'
import { SETTINGS_PATH } from '../../src/core/settings'
import type { Platform } from '../../src/platform/types'
import { AppProvider, useApp } from '../../src/state/store'
import { App } from '../../src/ui/App'
import type { PointerPath, TouchPath } from './commands'

declare module 'vitest/browser' {
  interface BrowserCommands {
    pointerPath: (path: PointerPath) => Promise<void>
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
    '../../../img/**/*.png',
  ],
  { query: '?url', import: 'default', eager: true },
)

let fetched: Promise<Record<string, Uint8Array>> | undefined

/** The example repository's files by path ('config.json', 'img/media/layer.png'). Fetched once per test file. */
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
  return fetched
}

/** The files a folder opens straight into the editor with: the repository, a personal config and settings. */
export async function editableFiles(): Promise<Record<string, Uint8Array>> {
  const files = await repoFiles()
  return {
    ...files,
    'local/config.json': files['config.json'],
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

/** Renders the app full-window, as index.html does, with a Probe beside it. */
export function mount(platform: Platform): void {
  const root = document.createElement('div')
  root.id = 'root'
  document.body.append(root)
  render(
    <AppProvider platform={platform}>
      <App />
      <Probe />
    </AppProvider>,
    { container: root },
  )
}

/** Takes the app away after a test. */
export function unmount(): void {
  cleanup()
  seen = undefined
  document.getElementById('root')?.remove()
}

export type TabName = 'Pad shape' | 'Layers' | 'Macros' | 'Commands'

/** A real click, through the browser. */
export const click = (el: Element) => userEvent.click(el)

/** The example repository in memory, opened in the editor on a tab. */
export async function startApp(tab: TabName = 'Pad shape'): Promise<{ folder: MemoryFolder }> {
  const folder = new MemoryFolder('repo', await editableFiles())
  mount({ kind: 'browser', openFolder: async () => folder, restoreFolder: async () => null })
  await click(await screen.findByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
  if (tab !== 'Pad shape') await openTab(tab)
  return { folder }
}

export async function openTab(tab: TabName): Promise<void> {
  await click(screen.getByRole('tab', { name: tab }))
}

/**
 * What the repository's validator (scripts/validate-config.mjs) says about a saved config: its
 * problems, none when both versions of the macropad would load it.
 */
export const validatorProblems = (text: string): Promise<string[]> => commands.validateSavedConfig(text)

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

function path(points: Point[], press: boolean, release: boolean, steps: number): Promise<void> {
  return commands.pointerPath({
    points,
    press,
    release,
    steps,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  })
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

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
  await sleep(60)
  for (let i = 0; i < 80 && overlayBox(); i++) await sleep(25)
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

/** Moves the mouse on to `to`, the button still down from carry(). */
export function carryOn(to: Element | Point, steps = 10): Promise<void> {
  return path([point(to), point(to)], false, false, steps)
}

/** A drag with one finger on a touch screen: down on `from`, across to `to`, and up. */
export async function touchDrag(from: Element | Point, to: Element | Point, steps = 10): Promise<void> {
  await commands.touchPath({
    points: [point(from), point(to)],
    steps,
    viewport: { width: window.innerWidth, height: window.innerHeight },
  })
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

/** The error or notice above the editor, or null. */
export function banner(): string | null {
  return document.querySelector('[role="alert"] > span, output > span')?.textContent ?? null
}
