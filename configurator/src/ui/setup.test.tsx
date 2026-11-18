/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FolderAccess } from '../core/folder/types'
import { MemoryFolder } from '../core/folder/memory'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider } from '../state/store'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'

afterEach(cleanup)

const REFUSAL = "This folder doesn't look like Open Macro Builder: it needs config.json and an ahk or powershell folder."
const empty = () => new MemoryFolder('fresh', {})

/** A copy of the example repository with a personal config and saved settings: it opens straight onto the tabs. */
async function readyFolder(): Promise<MemoryFolder> {
  const folder = memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/commands', 'powershell/commands', 'img'])
  await folder.writeBytes('local/config.json', new TextEncoder().encode(readRepoText('config.json')))
  await folder.writeBytes(SETTINGS_PATH, new TextEncoder().encode('{ "languages": ["ahk"] }\n'))
  return folder
}

function fakePlatform(folder: FolderAccess | null, more: Partial<Platform> = {}): Platform {
  return {
    kind: 'browser',
    openFolder: async () => folder,
    createFolder: async () => null,
    restoreFolder: async () => null,
    ...more,
  }
}

/** Every file of the folder with its bytes, to prove nothing was written. */
async function snapshot(folder: FolderAccess, dir = ''): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const entry of await folder.list(dir)) {
    const path = dir === '' ? entry.name : `${dir}/${entry.name}`
    if (entry.kind === 'dir') Object.assign(out, await snapshot(folder, path))
    else out[path] = Array.from((await folder.readBytes(path)) ?? []).join(',')
  }
  return out
}

function renderApp(platform: Platform) {
  render(
    <AppProvider platform={platform}>
      <App />
    </AppProvider>,
  )
  return userEvent.setup()
}

async function openFolder(platform: Platform) {
  const user = renderApp(platform)
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  return user
}

/** The F-keys of the Keys list, one button each. */
const keyButtons = async () =>
  within(await screen.findByRole('list', { name: 'Keys' })).getAllByRole('button', { name: /^F\d+ \d×\d$/ })

/** Answers the two first-run prompts of a folder without local/config.json. */
async function answerFirstRun(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Edit a copy in local/' }))
  const language = await screen.findByRole('dialog', { name: 'Which version do you run?' })
  await user.click(within(language).getByRole('button', { name: 'AutoHotkey' }))
}

/** Opens the Create new folder dialog; gives its name field. */
async function nameDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Create new folder…' }))
  const dialog = screen.getByRole('dialog', { name: 'Create new folder' })
  return { dialog, field: within(dialog).getByRole('textbox', { name: 'Folder name' }) as HTMLInputElement }
}

describe('opening an empty folder', () => {
  it('offers to set it up, and writes nothing until asked', async () => {
    const folder = empty()
    await openFolder(fakePlatform(folder))
    const dialog = await screen.findByRole('dialog', { name: 'This folder is empty' })
    expect(within(dialog).getByText(/Set up a fresh Open Macro Builder here\?/)).toBeTruthy()
    expect(await snapshot(folder)).toEqual({})
  })

  it('Set up copies the starter and carries on to the local/config.json prompt', async () => {
    const folder = empty()
    const user = await openFolder(fakePlatform(folder))
    await user.click(await screen.findByRole('button', { name: 'Set up' }))
    await screen.findByRole('dialog', { name: 'This folder has no local/config.json yet' })
    const repo = memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'powershell/main.ps1', 'img/blank.png'])
    for (const path of ['config.json', 'ahk/main.ahk', 'powershell/main.ps1', 'img/blank.png'])
      expect(await folder.readBytes(path)).toEqual(await repo.readBytes(path))
    expect(await folder.list('powershell/tests')).toEqual([])
    expect(await folder.list('local')).toEqual([])
  })

  it('then opens onto the tabs after the two first-run answers', async () => {
    const user = await openFolder(fakePlatform(empty()))
    await user.click(await screen.findByRole('button', { name: 'Set up' }))
    await answerFirstRun(user)
    expect(await screen.findByRole('tab', { name: 'Get started', selected: true })).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Pad shape' }))
    expect(await keyButtons()).toHaveLength(12)
  })

  it('in the desktop app a fresh setup is not asked which version, and opens on the guide for the one installed', async () => {
    const user = await openFolder(fakePlatform(empty(), { kind: 'electron', installedLanguages: async () => ['ps'] }))
    await user.click(await screen.findByRole('button', { name: 'Set up' }))
    await user.click(await screen.findByRole('button', { name: 'Edit a copy in local/' }))
    const guide = await screen.findByRole('article', { name: 'Get started' })
    expect(screen.getByRole('tab', { name: 'Get started', selected: true })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Which version do you run?' })).toBeNull()
    const step5 = within(guide).getByRole('heading', { name: '5. Start the macropad' }).parentElement!
    expect(step5.textContent).toContain('launch.vbs')
    expect(step5.textContent).not.toContain('main.ahk')
    expect(guide.textContent).not.toContain('main.ahk')
  })

  it('a setup cancelled at a prompt, then opened with Open folder, opens on Pad shape', async () => {
    const user = await openFolder(fakePlatform(empty()))
    await user.click(await screen.findByRole('button', { name: 'Set up' }))
    const prompt = await screen.findByRole('dialog', { name: 'This folder has no local/config.json yet' })
    await user.click(within(prompt).getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await answerFirstRun(user)
    expect(await screen.findByRole('tab', { name: 'Pad shape', selected: true })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Get started' })).toBeNull()
  })

  it('a fresh setup with its prompt up, then another existing setup opened with Open folder, opens on Pad shape', async () => {
    // The prompt only covers the screen: the Open folder button behind it can still be pressed.
    const folders = [empty(), await readyFolder()]
    const user = await openFolder(fakePlatform(null, { openFolder: async () => folders.shift() ?? null }))
    await user.click(await screen.findByRole('button', { name: 'Set up' }))
    await screen.findByRole('dialog', { name: 'This folder has no local/config.json yet' })
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(await screen.findByRole('tab', { name: 'Pad shape', selected: true })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Get started' })).toBeNull()
  })

  it('Cancel goes back to the open screen with nothing written', async () => {
    const folder = empty()
    const user = await openFolder(fakePlatform(folder))
    const dialog = await screen.findByRole('dialog', { name: 'This folder is empty' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(await snapshot(folder)).toEqual({})
  })

  it('a double click on Set up copies once', async () => {
    class Counting extends MemoryFolder {
      configWrites = 0
      override writeBytes(path: string, data: Uint8Array): Promise<void> {
        if (path === 'config.json') this.configWrites++
        return super.writeBytes(path, data)
      }
    }
    const folder = new Counting('fresh')
    const user = await openFolder(fakePlatform(folder))
    await user.dblClick(await screen.findByRole('button', { name: 'Set up' }))
    await screen.findByRole('dialog', { name: 'This folder has no local/config.json yet' })
    expect(folder.configWrites).toBe(1)
  })

  it('shows Setting up… with nothing to press while the copy runs', async () => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    class Held extends MemoryFolder {
      override async writeBytes(path: string, data: Uint8Array): Promise<void> {
        await held
        return super.writeBytes(path, data)
      }
    }
    const user = await openFolder(fakePlatform(new Held('fresh')))
    await user.click(await screen.findByRole('button', { name: 'Set up' }))
    const dialog = await screen.findByRole('dialog', { name: 'Setting up…' })
    expect(within(dialog).getByText('Copying files into fresh.')).toBeTruthy()
    expect(within(dialog).queryAllByRole('button')).toEqual([])
    for (const name of ['Open folder', 'Create new folder…'])
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Setting up…' })).toBeTruthy()
    release()
    await screen.findByRole('dialog', { name: 'This folder has no local/config.json yet' })
    expect((screen.getByRole('button', { name: 'Open folder' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('a folder holding only desktop.ini is refused as before, untouched', async () => {
    const folder = new MemoryFolder('fresh', { 'desktop.ini': '[.ShellClassInfo]\r\n' })
    const before = await snapshot(folder)
    await openFolder(fakePlatform(folder))
    expect((await screen.findByRole('alert')).textContent).toBe(REFUSAL)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await snapshot(folder)).toEqual(before)
  })

  it('says the copy stopped part-way when a write fails', async () => {
    class Failing extends MemoryFolder {
      writes = 0
      override writeBytes(path: string, data: Uint8Array): Promise<void> {
        if (++this.writes === 5) return Promise.reject(new Error('disk full'))
        return super.writeBytes(path, data)
      }
    }
    const folder = new Failing('fresh')
    const user = await openFolder(fakePlatform(folder))
    await user.click(await screen.findByRole('button', { name: 'Set up' }))
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Setting up stopped part-way: disk full. The folder may hold a partial copy: delete it, or pick another empty folder.',
    )
    expect(await folder.readBytes('config.json')).toBeNull()
  })
})

describe('Create new folder…', () => {
  it('asks for a name, defaulting to Open Macro Builder', async () => {
    const user = renderApp(fakePlatform(null))
    const { field } = await nameDialog(user)
    expect(field.value).toBe('Open Macro Builder')
  })

  it('creates the folder and sets it up without asking again', async () => {
    const folder = empty()
    const createFolder = vi.fn<Platform['createFolder']>(async () => folder)
    const user = renderApp(fakePlatform(null, { createFolder }))
    const { dialog, field } = await nameDialog(user)
    await user.clear(field)
    await user.type(field, 'pad')
    await user.click(within(dialog).getByRole('button', { name: 'Choose where…' }))
    expect(createFolder).toHaveBeenCalledWith('pad')
    await screen.findByRole('dialog', { name: 'This folder has no local/config.json yet' })
    expect(screen.queryByRole('dialog', { name: 'This folder is empty' })).toBeNull()
    expect(await folder.readBytes('ahk/main.ahk')).not.toBeNull()
  })

  it('Create new folder… opens the editor on Get started', async () => {
    const user = renderApp(fakePlatform(null, { createFolder: async () => empty() }))
    const { dialog } = await nameDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Choose where…' }))
    await answerFirstRun(user)
    expect(await screen.findByRole('tab', { name: 'Get started', selected: true })).toBeTruthy()
    expect(screen.getByRole('article', { name: 'Get started' })).toBeTruthy()
  })

  it.each(['a/b', 'CON', 'name.', ''])('will not go on with the name %j', async (name) => {
    const createFolder = vi.fn<Platform['createFolder']>(async () => empty())
    const user = renderApp(fakePlatform(null, { createFolder }))
    const { dialog, field } = await nameDialog(user)
    await user.clear(field)
    if (name !== '') await user.type(field, name)
    const choose = within(dialog).getByRole('button', { name: 'Choose where…' }) as HTMLButtonElement
    expect(choose.disabled).toBe(true)
    if (name.trim() !== '') expect(within(dialog).getByRole('alert').textContent).not.toBe('')
    await user.click(choose)
    await user.type(field, '{Enter}')
    expect(createFolder).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Create new folder' })).toBeTruthy()
  })

  it('Enter chooses where, and Escape closes the dialog', async () => {
    const createFolder = vi.fn<Platform['createFolder']>(async () => null)
    const user = renderApp(fakePlatform(null, { createFolder }))
    await nameDialog(user)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    const { field } = await nameDialog(user)
    await user.clear(field)
    // A space at the end is dropped, as Windows would drop it.
    await user.type(field, 'pad {Enter}')
    expect(createFolder).toHaveBeenCalledTimes(1)
    expect(createFolder).toHaveBeenCalledWith('pad')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does nothing when the location picker is cancelled', async () => {
    const createFolder = vi.fn<Platform['createFolder']>(async () => null)
    const user = renderApp(fakePlatform(null, { createFolder }))
    const { dialog } = await nameDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Choose where…' }))
    await waitFor(() => expect(createFolder).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeTruthy()
  })

  it('refuses an existing folder with files in it, untouched', async () => {
    const folder = new MemoryFolder('pad', { 'notes.txt': 'mine' })
    const before = await snapshot(folder)
    const user = renderApp(fakePlatform(null, { createFolder: async () => folder }))
    const { dialog } = await nameDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Choose where…' }))
    expect((await screen.findByRole('alert')).textContent).toBe(REFUSAL)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await snapshot(folder)).toEqual(before)
  })

  it('opens an existing setup of that name instead of copying over it', async () => {
    const folder = await readyFolder()
    const before = await snapshot(folder)
    const user = renderApp(fakePlatform(null, { createFolder: async () => folder }))
    const { dialog } = await nameDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Choose where…' }))
    expect(await keyButtons()).toHaveLength(12)
    expect(await snapshot(folder)).toEqual(before)
  })

  it('opening an existing setup of that name with Create new folder… opens on Pad shape', async () => {
    const folder = await readyFolder()
    const user = renderApp(fakePlatform(null, { createFolder: async () => folder }))
    const { dialog } = await nameDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Choose where…' }))
    expect(await screen.findByRole('tab', { name: 'Pad shape', selected: true })).toBeTruthy()
    expect(screen.queryByRole('article', { name: 'Get started' })).toBeNull()
  })

  it('shows why when the folder could not be created', async () => {
    const createFolder = async () => {
      throw new Error('EACCES')
    }
    const user = renderApp(fakePlatform(null, { createFolder }))
    const { dialog } = await nameDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Choose where…' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The folder could not be opened: EACCES')
  })
})
