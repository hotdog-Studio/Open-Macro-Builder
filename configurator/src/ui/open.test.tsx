/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import type { FolderAccess } from '../core/folder/types'
import { MemoryFolder } from '../core/folder/memory'
import { SETTINGS_PATH } from '../core/settings'
import type { Platform } from '../platform/types'
import { AppProvider } from '../state/store'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'

afterEach(cleanup)

const EXAMPLE = readRepoText('config.json')
const KEY_NAMES = ['F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F22', 'F23', 'F24']

/** The example repository: config.json, the AutoHotkey entry point, both command libraries and the icons. */
function repoFolder(): MemoryFolder {
  return memoryFolderFromRepo(['config.json', 'ahk/main.ahk', 'ahk/commands', 'powershell/commands', 'img'])
}

/** Ruling R4: a personal copy of the example and saved settings, so the folder opens straight onto the tabs. */
async function readyFolder(config = EXAMPLE, languages: string[] = ['ahk']): Promise<MemoryFolder> {
  const folder = repoFolder()
  await folder.writeBytes('local/config.json', new TextEncoder().encode(config))
  await folder.writeBytes(SETTINGS_PATH, new TextEncoder().encode(JSON.stringify({ languages }, null, 2) + '\n'))
  return folder
}

function fakePlatform(folder: FolderAccess | null, more: Partial<Platform> = {}): Platform {
  return {
    kind: 'browser',
    openFolder: async () => folder,
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

describe('opening a folder', () => {
  it('opens a folder and shows the Pad shape tab with 12 keys', async () => {
    await openFolder(fakePlatform(await readyFolder()))
    const keys = await screen.findByRole('list', { name: 'Keys' })
    // Each key is a button named like "F13 1×1": its name, then its size.
    const names = within(keys)
      .getAllByRole('button', { name: /^F\d+ \d×\d$/ })
      .map((b) => /^(\S+) /.exec(b.textContent ?? '')?.[1])
    expect(names).toEqual(KEY_NAMES)
    expect(screen.getByRole('tab', { name: 'Pad shape', selected: true })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Layers' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Macros' })).toBeTruthy()
    expect(screen.getByText('repo')).toBeTruthy()
    const save = screen.getByRole('button', { name: 'Save config.json' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
  })

  it('offers a copy in local/ when local/config.json is missing', async () => {
    const folder = repoFolder()
    await folder.writeBytes(SETTINGS_PATH, new TextEncoder().encode('{ "languages": ["ahk"] }\n'))
    const user = await openFolder(fakePlatform(folder))
    await user.click(await screen.findByRole('button', { name: 'Edit a copy in local/ (recommended)' }))
    await screen.findByRole('list', { name: 'Keys' })
    expect(await folder.readBytes('local/config.json')).toEqual(await folder.readBytes('config.json'))
    expect(screen.getByText('local/config.json')).toBeTruthy()
  })

  it('does not copy a config.json that is not JSON into local/', async () => {
    const folder = repoFolder()
    await folder.writeBytes('config.json', new TextEncoder().encode('{ "fn": { "key": "ScrollLock" }, "keys": [\n'))
    await folder.writeBytes(SETTINGS_PATH, new TextEncoder().encode('{ "languages": ["ahk"] }\n'))
    const before = await snapshot(folder)
    const user = await openFolder(fakePlatform(folder))
    await user.click(await screen.findByRole('button', { name: 'Edit a copy in local/ (recommended)' }))
    expect(await screen.findByText(/^config\.json is not valid JSON: /)).toBeTruthy()
    expect(await folder.readBytes('local/config.json')).toBeNull()
    expect(await snapshot(folder)).toEqual(before)
  })

  it('does not copy the example into local/ when a command file is not UTF-8', async () => {
    const folder = repoFolder()
    await folder.writeBytes('ahk/commands/broken.ahk', new Uint8Array([0x4f, 0x6b, 0xe9, 0x0a]))
    await folder.writeBytes(SETTINGS_PATH, new TextEncoder().encode('{ "languages": ["ahk"] }\n'))
    const before = await snapshot(folder)
    const user = await openFolder(fakePlatform(folder))
    await user.click(await screen.findByRole('button', { name: 'Edit a copy in local/ (recommended)' }))
    expect(
      await screen.findByText('ahk/commands/broken.ahk is not UTF-8 text, so the configurator will not edit it.'),
    ).toBeTruthy()
    expect(await folder.readBytes('local/config.json')).toBeNull()
    expect(await snapshot(folder)).toEqual(before)
  })

  it('edits the shared example without writing anything when asked to', async () => {
    const folder = repoFolder()
    await folder.writeBytes(SETTINGS_PATH, new TextEncoder().encode('{ "languages": ["ahk"] }\n'))
    const before = await snapshot(folder)
    const user = await openFolder(fakePlatform(folder))
    await user.click(await screen.findByRole('button', { name: 'Edit the shared example' }))
    await screen.findByRole('list', { name: 'Keys' })
    expect(await snapshot(folder)).toEqual(before)
  })

  it('asks which version you run and saves it', async () => {
    const folder = repoFolder()
    await folder.writeBytes('local/config.json', new TextEncoder().encode(EXAMPLE))
    const user = await openFolder(fakePlatform(folder))
    const dialog = await screen.findByRole('dialog', { name: 'Which version do you run?' })
    expect(within(dialog).getByRole('button', { name: 'AutoHotkey' })).toBeTruthy()
    await user.click(within(dialog).getByRole('button', { name: 'PowerShell' }))
    await screen.findByRole('list', { name: 'Keys' })
    expect(folder.text(SETTINGS_PATH)).toContain('"languages": [\n    "ps"\n  ]')
    expect((screen.getByRole('checkbox', { name: 'PowerShell' }) as HTMLInputElement).checked).toBe(true)
  })

  it('uses the first installed language in the desktop app without asking', async () => {
    const folder = repoFolder()
    await folder.writeBytes('local/config.json', new TextEncoder().encode(EXAMPLE))
    await openFolder(fakePlatform(folder, { kind: 'electron', installedLanguages: async () => ['ps', 'ahk'] }))
    await screen.findByRole('list', { name: 'Keys' })
    expect(JSON.parse(folder.text(SETTINGS_PATH) ?? '')).toEqual({ languages: ['ps'] })
  })

  it('explains when the folder is not Open Macro Builder', async () => {
    const folder = new MemoryFolder('projects', { 'open-macro-builder/config.json': '{}', 'README.md': 'x' })
    const before = await snapshot(folder)
    await openFolder(fakePlatform(folder))
    expect(
      await screen.findByText(
        "This folder doesn't look like Open Macro Builder: it needs config.json and an ahk or powershell folder.",
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeTruthy()
    expect(await snapshot(folder)).toEqual(before)
  })

  it('shows a config.json that is not JSON and does not write it', async () => {
    const folder = await readyFolder('{ "fn": { "key": "ScrollLock" }, "keys": [\n')
    const before = await snapshot(folder)
    await openFolder(fakePlatform(folder))
    expect(await screen.findByText(/^local\/config\.json is not valid JSON: /)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open folder' })).toBeTruthy()
    expect(await snapshot(folder)).toEqual(before)
  })

  it('shows a command file that is not UTF-8 and does not open the folder', async () => {
    const folder = await readyFolder()
    await folder.writeBytes('ahk/commands/broken.ahk', new Uint8Array([0x4f, 0x6b, 0xe9, 0x0a]))
    await openFolder(fakePlatform(folder))
    expect(
      await screen.findByText('ahk/commands/broken.ahk is not UTF-8 text, so the configurator will not edit it.'),
    ).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Keys' })).toBeNull()
  })

  it('shows load notices', async () => {
    const config = {
      fn: { key: 'ScrollLock', row: 2, col: 1 },
      keys: [
        { key: 'F13', row: 1, col: 1 },
        { key: 'F14', row: 1, col: 2 },
      ],
      layers: ['A', 'B', 'C'].map((title) => ({ title, icon: 'media', macros: [] })),
    }
    await openFolder(fakePlatform(await readyFolder(JSON.stringify(config, null, 2) + '\n')))
    expect(await screen.findByText('Layer "C" had no key, so it was parked.')).toBeTruthy()
  })
})

describe('the header', () => {
  it('I run keeps at least one language', async () => {
    const folder = await readyFolder(EXAMPLE, ['ahk'])
    const user = await openFolder(fakePlatform(folder))
    await screen.findByRole('list', { name: 'Keys' })
    const ahk = screen.getByRole('checkbox', { name: 'AutoHotkey' }) as HTMLInputElement
    const ps = screen.getByRole('checkbox', { name: 'PowerShell' }) as HTMLInputElement
    const saved = folder.text(SETTINGS_PATH)
    expect([ahk.checked, ps.checked]).toEqual([true, false])

    await user.click(ahk)
    expect(ahk.checked).toBe(true)
    expect(folder.text(SETTINGS_PATH)).toBe(saved)

    await user.click(ps)
    expect(JSON.parse(folder.text(SETTINGS_PATH) ?? '')).toEqual({ languages: ['ahk', 'ps'] })
    await user.click(ahk)
    expect([ahk.checked, ps.checked]).toEqual([false, true])
    expect(JSON.parse(folder.text(SETTINGS_PATH) ?? '')).toEqual({ languages: ['ps'] })
  })

  it('switches tabs', async () => {
    const user = await openFolder(fakePlatform(await readyFolder()))
    await screen.findByRole('list', { name: 'Keys' })
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    expect(screen.getByRole('tab', { name: 'Layers', selected: true })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Keys' })).toBeNull()
  })
})

describe('a remembered folder', () => {
  it('reopens it after a click when the browser asks for permission again', async () => {
    const folder = await readyFolder()
    let asked = 0
    const user = renderApp(
      fakePlatform(null, {
        restoreFolder: async () => ({ needsPermission: 'repo' }),
        grantPermission: async () => {
          asked++
          return { folder }
        },
      }),
    )
    await user.click(await screen.findByRole('button', { name: 'Reopen repo' }))
    await screen.findByRole('list', { name: 'Keys' })
    expect(asked).toBe(1)
  })

  it('stays on the open screen quietly when permission is declined', async () => {
    const user = renderApp(
      fakePlatform(null, {
        restoreFolder: async () => ({ needsPermission: 'repo' }),
        grantPermission: async () => null,
      }),
    )
    await user.click(await screen.findByRole('button', { name: 'Reopen repo' }))
    expect(screen.getByRole('button', { name: 'Reopen repo' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says when the folder has gone', async () => {
    const gone = 'The folder repo is no longer available. Open it again.'
    const user = renderApp(
      fakePlatform(null, {
        restoreFolder: async () => ({ needsPermission: 'repo' }),
        grantPermission: async () => ({ lost: gone }),
      }),
    )
    await user.click(await screen.findByRole('button', { name: 'Reopen repo' }))
    expect(await screen.findByText(gone)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reopen repo' })).toBeNull()
  })

  it('opens it straight away when permission is still granted', async () => {
    renderApp(fakePlatform(null, { restoreFolder: async () => ({ folder: await readyFolder() }) }))
    expect(await screen.findByRole('list', { name: 'Keys' })).toBeTruthy()
  })
})
