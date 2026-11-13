import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SETTINGS_PATH } from '../core/settings'
import { idbHandleStore } from '../platform/browser'
import { detectPlatform } from '../platform/detect'
import type { Platform } from '../platform/types'
import { banner, cell, click, dirty, drag, editableFiles, mount, offset, openTab, padKey, repoFiles, unmount, validatorProblems, ws } from '../../test/browser/harness'

// End to end in the browser: the real platform code (platform/browser.ts) over a real folder
// handle, the folder remembered in the real IndexedDB, and edits made by dragging. The folder is
// in the browser's private storage (OPFS), which hands out the same kind of handle as the folder
// picker; only the picker itself, which a test cannot click, is replaced.

const FOLDER = 'omb-e2e'
const ROW = 103.75

type PickerWindow = Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }
const realPicker = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker')
let folder: FileSystemDirectoryHandle

/** A fresh folder in the browser's private storage holding `files`. */
async function seed(files: Record<string, Uint8Array>): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory()
  await root.removeEntry(FOLDER, { recursive: true }).catch(() => {})
  const dir = await root.getDirectoryHandle(FOLDER, { create: true })
  for (const [path, bytes] of Object.entries(files)) await write(dir, path, bytes)
  return dir
}

async function write(dir: FileSystemDirectoryHandle, path: string, content: Uint8Array | string): Promise<void> {
  const parts = path.split('/')
  const name = parts.pop()!
  let at = dir
  for (const part of parts) at = await at.getDirectoryHandle(part, { create: true })
  const out = await (await at.getFileHandle(name, { create: true })).createWritable()
  await out.write(typeof content === 'string' ? content : (content.slice().buffer as ArrayBuffer))
  await out.close()
}

/** A file of the folder as text, or null when it is not there. */
async function read(path: string): Promise<string | null> {
  const parts = path.split('/')
  const name = parts.pop()!
  try {
    let at = folder
    for (const part of parts) at = await at.getDirectoryHandle(part)
    return await (await (await at.getFileHandle(name)).getFile()).text()
  } catch {
    return null
  }
}

interface SavedConfig {
  fn: { key: string }
  keys: { key: string; row: number; col: number; width?: number; height?: number }[]
  layers: ({ title: string; disabled?: boolean; macros: ({ action: string; name: string } | null)[] } | null)[]
  default: number | null
}
const saved = async (path = 'local/config.json') => JSON.parse((await read(path)) ?? 'null') as SavedConfig

/** The app as main.tsx starts it: whatever platform this window has. */
function launch(): void {
  const platform = detectPlatform(window)
  if ('unsupported' in platform) throw new Error(platform.unsupported)
  mount(platform as Platform)
}

/** Launches the app on a folder that already has a personal config, and opens it. */
async function openEditor(): Promise<void> {
  folder = await seed(await editableFiles())
  launch()
  await click(await screen.findByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
}

const dialog = () => screen.getByRole('dialog')
const choose = (name: string) => click(within(dialog()).getByRole('button', { name }))

/** Saves, and closes the notes about the other language if the save has any. */
async function save(): Promise<void> {
  await click(screen.getByRole('button', { name: 'Save config.json' }))
  await waitFor(() => expect(dirty()).toBe(false))
  if (screen.queryByRole('dialog')) await choose('OK')
}

const layerKey = (title: string) =>
  within(screen.getByRole('list', { name: 'Keys' })).getByRole('button', { name: new RegExp(`^${title}( Start layer)?$`) })
function command(name: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-command="${name}"]`)
  if (!row) throw new Error(`the command list has no ${name}`)
  row.scrollIntoView({ block: 'center' })
  return row
}

beforeEach(async () => {
  await idbHandleStore.clear()
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => folder })
})

afterEach(async () => {
  unmount()
  vi.restoreAllMocks()
  if (realPicker) Object.defineProperty(window, 'showDirectoryPicker', realPicker)
  else delete (window as PickerWindow).showDirectoryPicker
  await idbHandleStore.clear()
  await (await navigator.storage.getDirectory()).removeEntry(FOLDER, { recursive: true }).catch(() => {})
})

describe('in the browser, on a real folder', () => {
  it('first run: makes a personal copy, asks which version you run, and saves a drag to the copy only', async () => {
    const files = await repoFiles()
    folder = await seed(files)
    const shared = await read('config.json')
    launch()

    await click(await screen.findByRole('button', { name: 'Open folder' }))
    await waitFor(() => expect(dialog().textContent).toContain('This folder has no local/config.json yet'))
    await choose('Edit a copy in local/ (recommended)')
    await waitFor(() => expect(dialog().textContent).toContain('Which version do you run?'))
    await choose('AutoHotkey')
    await screen.findByRole('list', { name: 'Keys' })
    expect(screen.getByText('local/config.json')).toBeTruthy()
    expect(JSON.parse((await read(SETTINGS_PATH)) ?? '{}')).toMatchObject({ languages: ['ahk'] })

    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(dirty()).toBe(true))
    await save()

    expect((await saved()).keys[11]).toMatchObject({ key: 'F24', row: 5, col: 1 })
    // The shared example is the file everyone gets: untouched, byte for byte.
    expect(await read('config.json')).toBe(shared)
    expect((await saved('config.json')).keys[11]).toMatchObject({ row: 4, col: 3 })
  })

  it('drags on every tab are saved to the folder, and are there when the app starts again', async () => {
    await openEditor()
    const before = await read('local/config.json')

    // Pad shape: move F24 to the free row and make it two rows tall.
    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(ws().keys[11]).toMatchObject({ row: 5, col: 1 }))
    const corner = screen.getByRole('button', { name: 'Resize F24' })
    await drag(corner, offset(corner, 0, ROW))
    await waitFor(() => expect(ws().keys[11]).toMatchObject({ height: 2 }))

    // Layers: swap Media and Programs, and park Chrome.
    await openTab('Layers')
    await drag(layerKey('Media'), layerKey('Programs'))
    await waitFor(() => expect(ws().slots.k2?.title).toBe('Media'))
    await drag(layerKey('Chrome'), screen.getByRole('group', { name: 'Parked' }))
    await waitFor(() => expect(ws().parked.map((l) => l.title)).toEqual(['Chrome']))

    // Macros (Media, the start layer): a command onto F16, and swap the macros of F13 and F14.
    await openTab('Macros')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Media' }).getAttribute('aria-pressed')).toBe('true'))
    await drag(command('Lock'), padKey('F16'))
    await waitFor(() => expect(ws().slots.k2.macros.k4?.action).toBe('Lock'))
    await drag(padKey('F13'), padKey('F14'))
    await waitFor(() => expect(ws().slots.k2.macros.k1?.name).toBe('Play'))

    await save()

    const config = await saved()
    expect(config.keys[11]).toMatchObject({ key: 'F24', row: 5, col: 1, height: 2 })
    // A layer's place in the list is the key it is on: Programs on F13, Media on F14.
    expect(config.layers[0]?.title).toBe('Programs')
    expect(config.layers[1]?.title).toBe('Media')
    expect(config.default).toBe(2)
    expect(config.layers[2]).toBeNull()
    expect(config.layers.find((l) => l?.title === 'Chrome')).toMatchObject({ disabled: true })
    const media = config.layers[1]!.macros
    expect(media[0]).toMatchObject({ action: 'PlayPause', name: 'Play' })
    expect(media[1]).toMatchObject({ action: 'PreviousTrack', name: 'Prev' })
    expect(media[3]).toMatchObject({ action: 'Lock', name: 'Lock' })
    // The version before the save is kept beside it.
    expect(await read('local/config.json.bak')).toBe(before)
    // And the macropad would load it: the validator Jenkins runs has nothing to say.
    expect(await validatorProblems((await read('local/config.json'))!)).toEqual([])

    // Start the app again: it reopens the remembered folder by itself, on what was saved.
    unmount()
    launch()
    await screen.findByRole('list', { name: 'Keys' })
    expect(dirty()).toBe(false)
    expect(ws().keys[11]).toMatchObject({ row: 5, col: 1, height: 2 })
    expect(ws().slots.k1?.title).toBe('Programs')
    expect(ws().slots.k2?.title).toBe('Media')
    expect(ws().options.defaultKey).toBe('k2')
    expect(ws().parked.map((l) => l.title)).toEqual(['Chrome'])
    expect(ws().slots.k2.macros.k4).toMatchObject({ action: 'Lock' })
    expect(screen.getByRole('button', { name: 'F24 1×2' })).toBeTruthy()
  })

  it('a save with nothing else changed writes the same file back', async () => {
    await openEditor()
    const before = (await read('local/config.json'))!
    // There and back again: the config is unsaved, but the same as on disk.
    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(ws().keys[11]).toMatchObject({ row: 5 }))
    await drag(padKey('F24'), cell(4, 3))
    await waitFor(() => expect(ws().keys[11]).toMatchObject({ row: 4, col: 3 }))
    if (dirty()) await save()
    expect(JSON.parse((await read('local/config.json'))!)).toEqual(JSON.parse(before))
  })

  it('what the configurator saves passes the validator the macropad is checked with, after edits of every kind', async () => {
    await openEditor()
    // The validator does find problems: a config with an action no version defines is refused.
    const broken = await saved()
    broken.layers[0]!.macros[0] = { action: 'NoSuchCommandAnywhere', name: 'x' }
    expect(await validatorProblems(JSON.stringify(broken))).not.toEqual([])

    // Shape: a new key, a moved key, a resized key.
    await click(screen.getByRole('button', { name: '+ Add key' }))
    await waitFor(() => expect(ws().keys).toHaveLength(13))
    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(ws().keys[11]).toMatchObject({ row: 5, col: 1 }))
    const corner = screen.getByRole('button', { name: 'Resize F24' })
    await drag(corner, offset(corner, 80, 0))
    await waitFor(() => expect(ws().keys[11]).toMatchObject({ width: 2 }))

    // Layers: a new layer onto the new key, a swap, a parked layer, another start layer.
    await openTab('Layers')
    await click(screen.getByRole('button', { name: '+ New layer' }))
    await waitFor(() => expect(ws().parked).toHaveLength(1))
    const shelf = screen.getByRole('group', { name: 'Parked' })
    const chip = within(shelf).getByText('New layer').closest('[aria-roledescription="draggable"]') as HTMLElement
    await drag(chip, padKey('F16'))
    await waitFor(() => expect(ws().slots.k4?.title).toBe('New layer'))
    await drag(layerKey('Media'), layerKey('Chrome'))
    await waitFor(() => expect(ws().slots.k3?.title).toBe('Media'))
    await drag(layerKey('Programs'), shelf)
    await waitFor(() => expect(ws().parked.map((l) => l.title)).toEqual(['Programs']))

    // Macros, on the new layer: two commands, then swapped.
    await click(layerKey('New layer'))
    await click(screen.getByRole('button', { name: 'Edit macros →' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'New layer' }).getAttribute('aria-pressed')).toBe('true'))
    await drag(command('Lock'), padKey('F13'))
    await waitFor(() => expect(ws().slots.k4.macros.k1?.action).toBe('Lock'))
    await drag(command('Hibernate'), padKey('F22'))
    await waitFor(() => expect(ws().slots.k4.macros.k10?.action).toBe('Hibernate'))
    await drag(padKey('F13'), padKey('F14'))
    await waitFor(() => expect(ws().slots.k4.macros.k2?.action).toBe('Lock'))

    await save()
    const text = (await read('local/config.json'))!
    expect(await validatorProblems(text)).toEqual([])
    // The file really holds the edits the validator passed.
    const config = JSON.parse(text) as SavedConfig
    expect(config.keys).toHaveLength(13)
    expect(config.layers[3]).toMatchObject({ title: 'New layer' })
    expect(config.layers[3]!.macros[1]).toMatchObject({ action: 'Lock' })
    expect(config.layers.find((l) => l?.title === 'Programs')).toMatchObject({ disabled: true })
  })

  it('cancelling the folder picker leaves the start screen as it was', async () => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        throw new DOMException('The user aborted a request.', 'AbortError')
      },
    })
    launch()
    await click(await screen.findByRole('button', { name: 'Open folder' }))
    await new Promise((done) => setTimeout(done, 200))
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Keys' })).toBeNull()
  })

  it('when another program changed the config: the save is refused, and Reload from disk shows that version', async () => {
    await openEditor()
    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(dirty()).toBe(true))

    const theirs = { ...(await saved()), fn: { key: 'Pause', row: 4, col: 1, width: 2 } }
    await write(folder, 'local/config.json', JSON.stringify(theirs, null, 2) + '\n')

    await click(screen.getByRole('button', { name: 'Save config.json' }))
    await waitFor(() => expect(dialog().textContent).toContain('config.json changed on disk since you opened it.'))
    expect((await saved()).fn.key).toBe('Pause')

    await choose('Reload from disk')
    await waitFor(() => expect(ws().fn.key).toBe('Pause'))
    expect(dirty()).toBe(false)
    // The drag was dropped with the rest of the unsaved edits.
    expect(ws().keys[11]).toMatchObject({ row: 4, col: 3 })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('when another program changed the config: Overwrite anyway saves the drag and keeps their version as .bak', async () => {
    await openEditor()
    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(dirty()).toBe(true))

    const theirs = JSON.stringify({ ...(await saved()), fn: { key: 'Pause', row: 4, col: 1, width: 2 } }, null, 2) + '\n'
    await write(folder, 'local/config.json', theirs)

    await click(screen.getByRole('button', { name: 'Save config.json' }))
    await waitFor(() => expect(dialog().textContent).toContain('config.json changed on disk since you opened it.'))
    await choose('Overwrite anyway')
    await waitFor(() => expect(dialog().textContent).toContain('Overwrite anyway?'))
    await choose('Overwrite anyway')
    await waitFor(() => expect(dirty()).toBe(false))

    const config = await saved()
    expect(config.fn.key).toBe('ScrollLock')
    expect(config.keys[11]).toMatchObject({ row: 5, col: 1 })
    expect(await read('local/config.json.bak')).toBe(theirs)
  })

  it('when another program changed the config: coming back to the window says so, and Reload from disk takes it', async () => {
    await openEditor()
    const theirs = { ...(await saved()), fn: { key: 'Pause', row: 4, col: 1, width: 2 } }
    await write(folder, 'local/config.json', JSON.stringify(theirs, null, 2) + '\n')

    // The app looks again whenever its window gets the focus back.
    window.dispatchEvent(new Event('focus'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('config.json changed on disk.'))
    expect(ws().fn.key).toBe('ScrollLock')

    await click(within(screen.getByRole('alert')).getByRole('button', { name: 'Reload from disk' }))
    await waitFor(() => expect(ws().fn.key).toBe('Pause'))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(dirty()).toBe(false)
  })

  it('closing the tab asks first only while there are unsaved edits', async () => {
    // The test runner listens for beforeunload too, so ask only the listeners the app itself added.
    const guards = new Set<EventListener>()
    const add = window.addEventListener.bind(window)
    const remove = window.removeEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
      if (type === 'beforeunload') guards.add(listener as EventListener)
      add(type, listener as EventListener, options as AddEventListenerOptions)
    })
    vi.spyOn(window, 'removeEventListener').mockImplementation((type: string, listener: unknown, options?: unknown) => {
      if (type === 'beforeunload') guards.delete(listener as EventListener)
      remove(type, listener as EventListener, options as EventListenerOptions)
    })
    await openEditor()
    const closing = () =>
      [...guards].some((guard) => {
        const e = new Event('beforeunload', { cancelable: true })
        guard(e)
        return e.defaultPrevented
      })
    expect(closing()).toBe(false)

    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(dirty()).toBe(true))
    expect(closing()).toBe(true)

    await save()
    await waitFor(() => expect(closing()).toBe(false))
  })

  it('Open folder with unsaved drags asks before throwing them away', async () => {
    await openEditor()
    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(dirty()).toBe(true))

    await click(screen.getByRole('button', { name: 'Open folder' }))
    await waitFor(() => expect(dialog().textContent).toContain('Discard unsaved changes?'))
    await choose('Cancel')
    expect(ws().keys[11]).toMatchObject({ row: 5, col: 1 })

    await click(screen.getByRole('button', { name: 'Open folder' }))
    await choose('Discard and open')
    await waitFor(() => expect(ws().keys[11]).toMatchObject({ row: 4, col: 3 }))
    expect(dirty()).toBe(false)
    expect((await saved()).keys[11]).toMatchObject({ row: 4, col: 3 })
  })
})

// The browser's private storage always allows its own folders, so the one thing replaced here is
// the browser's answer to "may this page still use that folder?". The handle is the real one,
// remembered in the real IndexedDB by the real platform code.
describe('in the browser, when the remembered folder needs permission again or is gone', () => {
  type Handle = { queryPermission: () => Promise<PermissionState>; requestPermission: () => Promise<PermissionState> }
  const proto = FileSystemDirectoryHandle.prototype as unknown as Handle
  const real = { queryPermission: proto.queryPermission, requestPermission: proto.requestPermission }
  const browserSays = (query: PermissionState, request: PermissionState) => {
    proto.queryPermission = async () => query
    proto.requestPermission = async () => request
  }

  afterEach(() => {
    proto.queryPermission = real.queryPermission
    proto.requestPermission = real.requestPermission
  })

  /** Opens the folder once, so it is remembered, and closes the app. */
  async function rememberFolder(): Promise<void> {
    await openEditor()
    unmount()
  }

  it('offers Reopen instead of opening by itself, and opens once the browser allows it', async () => {
    await rememberFolder()
    browserSays('prompt', 'granted')
    launch()

    const reopen = await screen.findByRole('button', { name: `Reopen ${FOLDER}` })
    expect(screen.queryByRole('list', { name: 'Keys' })).toBeNull()
    await click(reopen)
    await screen.findByRole('list', { name: 'Keys' })
    expect(ws().keys).toHaveLength(12)
  })

  it('stays on the start screen, still offering Reopen, when the browser says no', async () => {
    await rememberFolder()
    browserSays('prompt', 'denied')
    launch()

    await click(await screen.findByRole('button', { name: `Reopen ${FOLDER}` }))
    await new Promise((done) => setTimeout(done, 200))
    expect(screen.queryByRole('list', { name: 'Keys' })).toBeNull()
    expect(screen.getByRole('button', { name: `Reopen ${FOLDER}` })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()

    // Asked again and allowed, it opens.
    browserSays('prompt', 'granted')
    await click(screen.getByRole('button', { name: `Reopen ${FOLDER}` }))
    await screen.findByRole('list', { name: 'Keys' })
  })

  it('says the folder is gone when it was deleted since last time, and forgets it', async () => {
    await rememberFolder()
    await (await navigator.storage.getDirectory()).removeEntry(FOLDER, { recursive: true })
    launch()

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(`The folder ${FOLDER} is no longer available. Open it again.`),
    )
    expect(screen.queryByRole('button', { name: /^Reopen/ })).toBeNull()
    expect(await idbHandleStore.get()).toBeUndefined()

    // Starting again finds nothing remembered: the plain start screen.
    unmount()
    launch()
    await screen.findByRole('button', { name: 'Open folder' })
    await new Promise((done) => setTimeout(done, 200))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says the folder is gone when it was deleted and permission is asked for', async () => {
    await rememberFolder()
    await (await navigator.storage.getDirectory()).removeEntry(FOLDER, { recursive: true })
    browserSays('prompt', 'granted')
    launch()

    await click(await screen.findByRole('button', { name: `Reopen ${FOLDER}` }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(`The folder ${FOLDER} is no longer available. Open it again.`),
    )
    expect(screen.queryByRole('button', { name: /^Reopen/ })).toBeNull()
  })

  it('a save after the folder was deleted fails out loud and keeps the edits', async () => {
    await openEditor()
    await drag(padKey('F24'), cell(5, 1))
    await waitFor(() => expect(dirty()).toBe(true))
    await (await navigator.storage.getDirectory()).removeEntry(FOLDER, { recursive: true })

    await click(screen.getByRole('button', { name: 'Save config.json' }))
    await waitFor(() => expect(banner() ?? screen.queryByRole('dialog')?.textContent ?? '').not.toBe(''))
    // Nothing pretends the save worked: the edit is still there and still unsaved.
    expect(dirty()).toBe(true)
    expect(ws().keys[11]).toMatchObject({ row: 5, col: 1 })
  })
})
