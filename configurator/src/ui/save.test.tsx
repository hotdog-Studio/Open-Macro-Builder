/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Workspace } from '../core/config/model'
import type { MemoryFolder } from '../core/folder/memory'
import type { LangId } from '../core/languages'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider, useApp } from '../state/store'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'

beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(cleanup)

const CONFIG = 'local/config.json'
const BAK = 'local/config.json.bak'
const EXAMPLE = readRepoText('config.json')
const enc = new TextEncoder()

let seen: ReturnType<typeof useApp>
function Probe() {
  const app = useApp()
  useEffect(() => {
    seen = app
  })
  return null
}

function editor() {
  if (seen.state.screen !== 'edit') throw new Error('expected the editor')
  return seen.state
}
const ws = (): Workspace => editor().ws

interface Setup {
  languages?: LangId[]
  /** The text of local/config.json; the example's text by default. */
  config?: string
  /** Extra files for the folder. */
  files?: Record<string, string>
  /** Extra platform members, such as watch. */
  platform?: Partial<Platform>
}

/** The example config changed by `change`, as a hand-edited file would be. */
function exampleWith(change: (c: { layers: { title: string; macros: unknown[] }[] }) => void): string {
  const parsed = JSON.parse(EXAMPLE)
  change(parsed)
  return JSON.stringify(parsed, null, 2) + '\n'
}

async function start({ languages = ['ahk', 'ps'], config = EXAMPLE, files = {}, platform = {} }: Setup = {}) {
  const folder: MemoryFolder = memoryFolderFromRepo([
    'config.json',
    'ahk/main.ahk',
    'ahk/commands',
    'powershell/commands',
    'img',
  ])
  await folder.writeBytes(CONFIG, enc.encode(config))
  await folder.writeBytes(SETTINGS_PATH, enc.encode(JSON.stringify({ languages }) + '\n'))
  for (const [path, text] of Object.entries(files)) await folder.writeBytes(path, enc.encode(text))
  const fake: Platform = {
    kind: 'browser',
    openFolder: async () => folder,
    restoreFolder: async () => null,
    ...platform,
  }
  render(
    <AppProvider platform={fake}>
      <App />
      <Probe />
    </AppProvider>,
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
  return { user, folder }
}

const saveButton = () => screen.getByRole('button', { name: 'Save config.json' }) as HTMLButtonElement

/** Renames the macro on F13 of the Media layer from Prev to `name`. */
async function editLabel(user: ReturnType<typeof userEvent.setup>, name = 'Back') {
  await user.click(screen.getByRole('tab', { name: 'Macros' }))
  await user.click(within(screen.getByRole('main')).getByRole('button', { name: /^F13( |$)/ }))
  const label = screen.getByLabelText('Label (shown on the overlay)')
  await user.clear(label)
  await user.type(label, name)
  expect(ws().slots.k1.macros.k1.name).toBe(name)
}

/** The bytes of a file as a string of numbers, or null when it does not exist. */
async function bytesOf(folder: MemoryFolder, path: string): Promise<string | null> {
  const raw = await folder.readBytes(path)
  return raw ? Array.from(raw).join(',') : null
}
const bytes = (text: string) => Array.from(enc.encode(text)).join(',')

/** An outside edit: the Media layer renamed to Music. */
const OUTSIDE = EXAMPLE.replace('"title": "Media"', '"title": "Music"')

const CHANGED = 'config.json changed on disk.'
const CONFLICT = 'config.json changed on disk since you opened it.'

/** A platform whose watch keeps the callback, so the test can fire it. */
function watching() {
  const watch = {
    paths: [] as string[][],
    stops: 0,
    onChange: null as ((path: string) => void) | null,
    /** Fires the last watch and waits for the recheck it starts. */
    fire: async () => {
      await act(async () => {
        await (watch.onChange?.(CONFIG) as unknown as Promise<void>)
      })
    },
  }
  const platform: Partial<Platform> = {
    watch: (paths, onChange) => {
      watch.paths.push(paths)
      watch.onChange = onChange
      return () => {
        watch.stops++
      }
    },
  }
  return { watch, platform }
}

describe('Save config.json', () => {
  it('Save writes config.json and keeps a .bak of the previous file', async () => {
    const { user, folder } = await start()
    expect(saveButton().disabled).toBe(true)
    expect(saveButton().querySelector('[data-dot]')).toBeNull()

    await editLabel(user)
    expect(saveButton().disabled).toBe(false)
    expect(saveButton().querySelector('[data-dot]')).not.toBeNull()

    await user.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect(folder.text(CONFIG)).toBe(EXAMPLE.replace('"name": "Prev",', '"name": "Back",'))
    expect(await bytesOf(folder, BAK)).toBe(bytes(EXAMPLE))
    expect(editor().dirty).toBe(false)
    expect(saveButton().querySelector('[data-dot]')).toBeNull()
    // No warnings: nothing to read after the save.
    expect(screen.queryByRole('dialog')).toBeNull()

    // A second save keeps the file it replaces, which is now the first save.
    const first = folder.text(CONFIG)!
    await editLabel(user, 'Again')
    await user.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect(folder.text(BAK)).toBe(first)
    expect(folder.text(CONFIG)).toContain('"name": "Again"')
  })

  it('errors block the save and are listed', async () => {
    const config = exampleWith((c) => {
      c.layers[0].macros[3] = { action: 'ZzPsOnly', name: 'Only PS' }
    })
    const { user, folder } = await start({
      languages: ['ahk'],
      config,
      files: { 'powershell/commands/custom/zz_only.ps1': 'function ZzPsOnly { param($Macro) }\n' },
    })
    await editLabel(user)
    await user.click(saveButton())

    const dialog = await screen.findByRole('dialog', { name: "Can't save yet" })
    expect(within(dialog).getByText(/action "ZzPsOnly" is not defined in ahk\/commands/)).toBeTruthy()
    expect(folder.text(CONFIG)).toBe(config)
    expect(await folder.readBytes(BAK)).toBeNull()
    expect(editor().dirty).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(saveButton().disabled).toBe(false)
  })

  it('a layout with macros past the last key can be saved after dropping them', async () => {
    // Two keys, and a Media layer with three macros: the third is past the last key.
    const parsed = JSON.parse(EXAMPLE)
    parsed.keys = parsed.keys.slice(0, 2)
    parsed.layers = [{ ...parsed.layers[0], macros: parsed.layers[0].macros.slice(0, 3) }]
    const config = JSON.stringify(parsed, null, 2) + '\n'
    const { user, folder } = await start({ config })
    expect(editor().banner?.text).toContain('Layer "Media" has more macros than keys.')
    await editLabel(user)
    await user.click(saveButton())

    const dialog = await screen.findByRole('dialog', { name: "Can't save yet" })
    expect(within(dialog).getByText('Layer "Media": 1 macro past the last key')).toBeTruthy()
    expect(folder.text(CONFIG)).toBe(config)
    await user.click(within(dialog).getByRole('button', { name: 'Drop the macros past the last key' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    // Dropping is an edit, not a save.
    expect(folder.text(CONFIG)).toBe(config)
    expect(ws().slots.k1.overflowMacros).toEqual([])
    expect(ws().slots.k1.macros.k1.name).toBe('Back')

    await user.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
    const written = JSON.parse(folder.text(CONFIG)!)
    expect(written.layers[0].title).toBe('Media')
    expect(written.layers[0].macros.length).toBeLessThanOrEqual(2)
    expect(written.layers[0].macros[0].name).toBe('Back')
  })

  it('warnings do not block the save', async () => {
    const config = exampleWith((c) => {
      c.layers[0].macros[3] = { action: 'ZzAhkOnly', name: 'Only AHK' }
    })
    const { user, folder } = await start({
      languages: ['ahk'],
      config,
      files: { 'ahk/commands/custom/zz_only.ahk': 'ZzAhkOnly(Macro)\n{\n}\n' },
    })
    await editLabel(user)
    await user.click(saveButton())

    const dialog = await screen.findByRole('dialog', { name: 'Saved, with notes about the other language' })
    expect(within(dialog).getByText(/action "ZzAhkOnly" is not defined in powershell\/commands/)).toBeTruthy()
    expect(folder.text(CONFIG)).toContain('"name": "Back"')
    expect(folder.text(BAK)).toBe(config)
    expect(editor().dirty).toBe(false)

    await user.click(within(dialog).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('refuses to save over an outside change and offers reload or overwrite', async () => {
    const { user, folder } = await start()
    await editLabel(user)
    await folder.writeBytes(CONFIG, enc.encode(OUTSIDE))

    await user.click(saveButton())
    const dialog = await screen.findByRole('dialog', { name: CONFLICT })
    expect(within(dialog).getByRole('button', { name: 'Reload from disk' })).toBeTruthy()
    // A refused save writes nothing at all, not even the .bak.
    expect(await bytesOf(folder, CONFIG)).toBe(bytes(OUTSIDE))
    expect(await folder.readBytes(BAK)).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'Overwrite anyway' }))
    const confirm = await screen.findByRole('dialog', { name: 'Overwrite anyway?' })
    // Still nothing written until the user confirms.
    expect(await bytesOf(folder, CONFIG)).toBe(bytes(OUTSIDE))
    await user.click(within(confirm).getByRole('button', { name: 'Overwrite anyway' }))

    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(folder.text(CONFIG)).toBe(EXAMPLE.replace('"name": "Prev",', '"name": "Back",'))
    // The outside edit is kept in the .bak.
    expect(await bytesOf(folder, BAK)).toBe(bytes(OUTSIDE))
  })

  it('Cancel on the overwrite confirmation writes nothing', async () => {
    const { user, folder } = await start()
    await editLabel(user)
    await folder.writeBytes(CONFIG, enc.encode(OUTSIDE))
    await user.click(saveButton())
    await user.click(
      within(await screen.findByRole('dialog', { name: CONFLICT })).getByRole('button', { name: 'Overwrite anyway' }),
    )
    const confirm = await screen.findByRole('dialog', { name: 'Overwrite anyway?' })
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await bytesOf(folder, CONFIG)).toBe(bytes(OUTSIDE))
    expect(await folder.readBytes(BAK)).toBeNull()
    expect(editor().dirty).toBe(true)
  })

  it('Reload from disk in the conflict dialog loads the disk version', async () => {
    const { user, folder } = await start()
    await editLabel(user)
    await folder.writeBytes(CONFIG, enc.encode(OUTSIDE))
    await user.click(saveButton())
    const dialog = await screen.findByRole('dialog', { name: CONFLICT })
    await user.click(within(dialog).getByRole('button', { name: 'Reload from disk' }))
    await waitFor(() => expect(ws().slots.k1.title).toBe('Music'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(ws().slots.k1.macros.k1.name).toBe('Prev')
    expect(editor().dirty).toBe(false)
    expect(await bytesOf(folder, CONFIG)).toBe(bytes(OUTSIDE))
  })

  it('a failed write shows its message and keeps the edits', async () => {
    const { user, folder } = await start()
    const write = folder.writeBytes.bind(folder)
    folder.writeBytes = async (path, data) => {
      if (path === CONFIG) throw new Error('Access is denied.')
      return write(path, data)
    }
    await editLabel(user)
    await user.click(saveButton())
    expect((await screen.findByRole('alert')).textContent).toContain('Access is denied.')
    expect(folder.text(CONFIG)).toBe(EXAMPLE)
    expect(editor().dirty).toBe(true)
    expect(saveButton().disabled).toBe(false)
  })
})

describe('leaving the page', () => {
  /** Whether a closing window, tab or reload would be asked to stay. */
  const leaveIsStopped = () => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  it('the unsaved-changes guard is active only while there are unsaved edits', async () => {
    const { user } = await start()
    expect(leaveIsStopped()).toBe(false)

    await editLabel(user)
    expect(leaveIsStopped()).toBe(true)

    await user.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect(leaveIsStopped()).toBe(false)

    await editLabel(user, 'Again')
    expect(leaveIsStopped()).toBe(true)
    cleanup()
    expect(leaveIsStopped()).toBe(false)
  })
})

describe('outside changes', () => {
  it('regaining focus after an outside change shows the banner', async () => {
    const { user, folder } = await start()
    await editLabel(user)
    fireEvent.focus(window)
    // Nothing changed yet: no banner.
    await act(async () => {
      await seen.actions.recheck()
    })
    expect(screen.queryByText(CHANGED)).toBeNull()

    await folder.writeBytes(CONFIG, enc.encode(OUTSIDE))
    fireEvent.focus(window)
    expect(await screen.findByText(CHANGED)).toBeTruthy()
    // The unsaved edit stays until the user chooses.
    expect(ws().slots.k1.macros.k1.name).toBe('Back')
    expect(ws().slots.k1.title).toBe('Media')
    expect(editor().dirty).toBe(true)
  })

  it('a platform watch event shows the banner', async () => {
    const { watch, platform } = watching()
    const { folder } = await start({ platform })
    // config.json first, then every command file.
    expect(watch.paths.map((paths) => paths[0])).toEqual([CONFIG])

    await watch.fire()
    expect(screen.queryByText(CHANGED)).toBeNull()

    await folder.writeBytes(CONFIG, enc.encode(OUTSIDE))
    await watch.fire()
    expect(screen.getByText(CHANGED)).toBeTruthy()
  })

  it("the app's own save does not raise the banner, even when its watch event comes late", async () => {
    const { watch, platform } = watching()
    const { user, folder } = await start({ platform })
    await editLabel(user)
    await user.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect(folder.text(CONFIG)).toContain('"name": "Back"')

    await watch.fire()
    fireEvent.focus(window)
    await act(async () => {
      await seen.actions.recheck()
    })
    expect(screen.queryByText(CHANGED)).toBeNull()
  })

  it('a watch event right after the save resolves does not raise the banner', async () => {
    const { watch, platform } = watching()
    const { user } = await start({ platform })
    await editLabel(user)
    let fired: Promise<void> | undefined
    await act(async () => {
      // The watch event lands before React has committed the saved state.
      const result = await seen.actions.save({})
      expect(result).toBe('saved')
      fired = watch.onChange?.(CONFIG) as unknown as Promise<void>
      await fired
    })
    expect(screen.queryByText(CHANGED)).toBeNull()
  })

  it('Reload from disk discards edits and loads the disk version', async () => {
    const { watch, platform } = watching()
    const { user, folder } = await start({ platform })
    await editLabel(user)
    await folder.writeBytes(CONFIG, enc.encode(OUTSIDE))
    fireEvent.focus(window)
    const banner = (await screen.findByText(CHANGED)).closest('[role]') as HTMLElement
    await user.click(within(banner).getByRole('button', { name: 'Reload from disk' }))

    await waitFor(() => expect(ws().slots.k1.title).toBe('Music'))
    expect(ws().slots.k1.macros.k1.name).toBe('Prev')
    expect(editor().dirty).toBe(false)
    expect(saveButton().disabled).toBe(true)
    expect(screen.queryByText(CHANGED)).toBeNull()
    expect(await bytesOf(folder, CONFIG)).toBe(bytes(OUTSIDE))
    // The reload watches the file again and stops the old watch.
    expect(watch.paths.map((paths) => paths[0])).toEqual([CONFIG, CONFIG])
    expect(watch.stops).toBe(1)

    // The reloaded version is the one later saves and rechecks compare with.
    await watch.fire()
    expect(screen.queryByText(CHANGED)).toBeNull()
    await editLabel(user)
    await user.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect(folder.text(CONFIG)).toBe(OUTSIDE.replace('"name": "Prev",', '"name": "Back",'))
  })

  it('Dismiss hides the banner until the file changes again', async () => {
    const { watch, platform } = watching()
    const { user, folder } = await start({ platform })
    await folder.writeBytes(CONFIG, enc.encode(OUTSIDE))
    await watch.fire()
    const banner = screen.getByText(CHANGED).closest('[role]') as HTMLElement
    await user.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText(CHANGED)).toBeNull()

    await watch.fire()
    expect(screen.queryByText(CHANGED)).toBeNull()

    await folder.writeBytes(CONFIG, enc.encode(OUTSIDE.replace('"title": "Music"', '"title": "Tunes"')))
    await watch.fire()
    expect(screen.getByText(CHANGED)).toBeTruthy()
  })

  it('stops watching when the app goes away', async () => {
    const { watch, platform } = watching()
    await start({ platform })
    expect(watch.stops).toBe(0)
    cleanup()
    expect(watch.stops).toBe(1)
  })
})

describe('Reload macropad', () => {
  it('offers Reload macropad after saving when one is running', async () => {
    const reloadMacropad = vi.fn(async (): Promise<LangId | null> => 'ahk')
    const { user } = await start({ platform: { kind: 'electron', findMacropad: async () => 'ahk', reloadMacropad } })
    await editLabel(user)
    await user.click(saveButton())

    const dialog = await screen.findByRole('dialog', { name: 'Saved' })
    expect(reloadMacropad).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Reload macropad' }))
    expect(reloadMacropad).toHaveBeenCalledTimes(1)
    expect(await within(dialog).findByText('Reloaded the AutoHotkey macropad.')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Reload macropad' })).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: 'OK' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(reloadMacropad).toHaveBeenCalledTimes(1)
  })

  it('names the PowerShell macropad and keeps the warnings', async () => {
    const config = exampleWith((c) => {
      c.layers[0].macros[3] = { action: 'ZzAhkOnly', name: 'Only AHK' }
    })
    const { user } = await start({
      languages: ['ahk'],
      config,
      files: { 'ahk/commands/custom/zz_only.ahk': 'ZzAhkOnly(Macro)\n{\n}\n' },
      platform: { kind: 'electron', findMacropad: async () => 'ps', reloadMacropad: async () => 'ps' },
    })
    await editLabel(user)
    await user.click(saveButton())
    const dialog = await screen.findByRole('dialog', { name: 'Saved, with notes about the other language' })
    expect(within(dialog).getByText(/not defined in powershell\/commands/)).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'Reload macropad' }))
    expect(await within(dialog).findByText('Reloaded the PowerShell macropad.')).toBeTruthy()
    expect(within(dialog).getByText(/not defined in powershell\/commands/)).toBeTruthy()
  })

  it('says so when the reload fails', async () => {
    const { user } = await start({
      platform: {
        kind: 'electron',
        findMacropad: async () => 'ahk',
        reloadMacropad: async () => {
          throw new Error('spawn denied')
        },
      },
    })
    await editLabel(user)
    await user.click(saveButton())
    const dialog = await screen.findByRole('dialog', { name: 'Saved' })
    await user.click(within(dialog).getByRole('button', { name: 'Reload macropad' }))
    expect(await within(dialog).findByText('The macropad was not reloaded: spawn denied')).toBeTruthy()
  })

  it('shows no dialog when no macropad is running, and none in the browser', async () => {
    const find = vi.fn(async (): Promise<LangId | null> => null)
    const a = await start({ platform: { kind: 'electron', findMacropad: find } })
    await editLabel(a.user)
    await a.user.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect(find).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()

    const b = await start()
    await editLabel(b.user)
    await b.user.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reload macropad' })).toBeNull()
  })

  it('still saves when looking for the macropad fails', async () => {
    const { user } = await start({
      platform: {
        kind: 'electron',
        findMacropad: async () => {
          throw new Error('no powershell')
        },
      },
    })
    await editLabel(user)
    await user.click(saveButton())
    await waitFor(() => expect(saveButton().disabled).toBe(true))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
