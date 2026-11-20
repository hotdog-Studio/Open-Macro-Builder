/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemoryFolder } from '../core/folder/memory'
import type { DirEntry, FolderAccess } from '../core/folder/types'
import { SETTINGS_PATH } from '../core/settings'
import { fingerprint, type StarterIndex } from '../core/update/fingerprint'
import type { KnownReleases } from '../core/update/history'
import { MANIFEST_PATH } from '../core/update/manifest'
import { planUpdate } from '../core/update/plan'
import type { Platform } from '../platform/types'
import { loadStarterIndex } from '../state/starter'
import { AppProvider, useApp } from '../state/store'
import { updateSentence, type UpdateSource } from '../state/updateActions'
import { memoryFolderFromRepo, readRepoText } from '../../test/repo'
import { App } from './App'

// The real planUpdate, watched: a test that says what a check did not show waits for that check to end first.
vi.mock('../core/update/plan', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../core/update/plan')>()
  return { ...actual, planUpdate: vi.fn(actual.planUpdate) }
})

const planned = vi.mocked(planUpdate)

beforeEach(() => {
  let n = 0
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`)
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  cleanup()
  planned.mockClear()
  vi.restoreAllMocks()
})

const enc = new TextEncoder()
const EXAMPLE = readRepoText('config.json')
const CONFIG = 'local/config.json'
const MAIN_AHK = 'ahk/main.ahk'
const MAIN_PS = 'powershell/main.ps1'

/** The app's copy of the scripts in these tests (1.0.6), as texts. */
const APP: Record<string, string> = {
  'config.json': EXAMPLE,
  [MAIN_AHK]: 'main 1.0.6\n',
  [MAIN_PS]: 'main 1.0.6\n',
}

/** What the releases before the record shipped: path -> text -> releases, oldest first. */
const OLD: Record<string, Record<string, string[]>> = {
  [MAIN_AHK]: { 'main 1.0.4\n': ['1.0.4'], 'main 1.0.5\n': ['1.0.5'] },
  [MAIN_PS]: { 'main 1.0.4\n': ['1.0.4', '1.0.5'] },
}

/** The scripts of 1.0.4 (config.json is the same in every version). */
const FROM_104: Record<string, string> = { [MAIN_AHK]: 'main 1.0.4\n', [MAIN_PS]: 'main 1.0.4\n' }

const BAR_104 = 'The scripts in this folder are from version 1.0.4. This app has 1.0.6.'

const print = (path: string, text: string) => fingerprint(path, enc.encode(text))

/** Each path's text turned into its fingerprint. */
async function printsOf(texts: Record<string, string>): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(Object.entries(texts).map(async ([path, text]) => [path, await print(path, text)])))
}

async function knownOf(old: Record<string, Record<string, string[]>>): Promise<KnownReleases> {
  const entries = await Promise.all(
    Object.entries(old).map(async ([path, byText]) => {
      const pairs = await Promise.all(Object.entries(byText).map(async ([text, releases]) => [await print(path, text), releases]))
      return [path, Object.fromEntries(pairs)]
    }),
  )
  return { last: '1.0.5', files: Object.fromEntries(entries) }
}

const INDEX: Promise<StarterIndex> = printsOf(APP).then((files) => ({ version: '1.0.6', files }))
const KNOWN = knownOf(OLD)

/** The small copy of the scripts these tests check folders against; `onCheck` runs as each check starts. */
async function sourceOf(onCheck: () => void = () => {}): Promise<UpdateSource> {
  const [index, known] = await Promise.all([INDEX, KNOWN])
  return {
    loadIndex: async () => {
      onCheck()
      return index
    },
    known,
  }
}

/** A folder around a MemoryFolder that records its reads, and whose reads and listings a test can hold back or fail. */
class TestFolder implements FolderAccess {
  /** Every path read, in order. */
  readonly reads: string[] = []
  /** Runs before each read; may wait. */
  beforeRead: (path: string) => Promise<void> | void = () => {}
  /** Runs before each listing; may wait or throw. */
  beforeList: (dir: string) => Promise<void> | void = () => {}

  constructor(readonly inner: MemoryFolder) {}

  get name() {
    return this.inner.name
  }
  async readBytes(path: string) {
    this.reads.push(path)
    await this.beforeRead(path)
    return this.inner.readBytes(path)
  }
  writeBytes(path: string, data: Uint8Array) {
    return this.inner.writeBytes(path, data)
  }
  async list(dir: string): Promise<DirEntry[]> {
    await this.beforeList(dir)
    return this.inner.list(dir)
  }
  remove(path: string) {
    return this.inner.remove(path)
  }
}

/** A manifest, with texts where it holds fingerprints. */
interface ManifestTexts {
  version: string
  files?: Record<string, string>
  offered?: Record<string, string>
}

/**
 * A scripts folder that opens straight onto the tabs: the repository's config.json and command files,
 * a personal config, saved settings, and `files` on top (null leaves a file out).
 */
async function scriptsFolder(
  files: Record<string, string | null>,
  manifest: ManifestTexts | null = null,
  from: string[] = ['config.json', 'ahk/commands', 'powershell/commands', 'img'],
): Promise<TestFolder> {
  const inner = memoryFolderFromRepo(from)
  const texts: Record<string, string> = {
    [CONFIG]: EXAMPLE,
    [SETTINGS_PATH]: '{ "languages": ["ahk", "ps"] }\n',
  }
  if (manifest !== null) {
    texts[MANIFEST_PATH] = JSON.stringify({
      version: manifest.version,
      files: await printsOf(manifest.files ?? {}),
      deleted: [],
      offered: await printsOf(manifest.offered ?? {}),
    })
  }
  const put = Object.entries({ ...texts, ...files }).map(([path, text]) =>
    text === null ? inner.remove(path) : inner.writeBytes(path, enc.encode(text)),
  )
  await Promise.all(put)
  return new TestFolder(inner)
}

let seen: ReturnType<typeof useApp>
function Probe() {
  const app = useApp()
  useLayoutEffect(() => {
    seen = app
  })
  return null
}

function editor() {
  if (seen.state.screen !== 'edit') throw new Error('expected the editor')
  return seen.state
}

/** Opens `folders` one after another with Open folder: the app checks against `source` (the real copy when null). */
function renderApp(folders: FolderAccess[], source: UpdateSource | null) {
  const platform: Platform = {
    kind: 'browser',
    openFolder: async () => folders.shift() ?? null,
    createFolder: async () => null,
    restoreFolder: async () => null,
  }
  render(
    <AppProvider platform={platform} updateSource={source ?? undefined}>
      <App />
      <Probe />
    </AppProvider>,
  )
  return userEvent.setup()
}

/** Opens the folder onto the tabs. */
async function open(folder: FolderAccess, source: UpdateSource | null) {
  const user = renderApp([folder], source)
  await user.click(screen.getByRole('button', { name: 'Open folder' }))
  await screen.findByRole('list', { name: 'Keys' })
  return user
}

/** Waits until the check of opening number `n` (1 the first) has ended, however it ended, and React has shown its outcome. */
async function checkEnded(n = 1) {
  await waitFor(() => expect(planned.mock.results.length).toBeGreaterThanOrEqual(n))
  const result = planned.mock.results[n - 1].value
  await act(async () => {
    await result.catch(() => undefined)
  })
}

const REVIEW = { name: 'Review the update' }
const NOT_NOW = { name: 'Not now' }

/** The update bar, once it shows: the status around Review the update. */
async function findBar(): Promise<HTMLElement> {
  const review = await screen.findByRole('button', REVIEW)
  const bar = screen.getAllByRole('status').find((status) => status.contains(review))
  if (!bar) throw new Error('Review the update is not inside a status')
  return bar
}

const noBar = () => expect(screen.queryByRole('button', REVIEW)).toBeNull()

describe('the sentence of the update bar', () => {
  it.each([
    ['a version', '1.0.4', '1.0.6', BAR_104],
    ['no version', null, '1.0.6', 'The scripts in this folder are from an older version. This app has 1.0.6.'],
    ['the same version', '1.0.6', '1.0.6', "Some of the scripts in this folder are missing or differ from this app's (1.0.6)."],
    ['the same version as a development build', '1.0.6', '1.0.6-dev', "Some of the scripts in this folder are missing or differ from this app's (1.0.6-dev)."],
  ])('names the folder %s', (_name, from, to, sentence) => {
    expect(updateSentence({ from, to })).toBe(sentence)
  })
})

describe('the check after a folder opens', () => {
  it.each([
    ['files of a known older release', FROM_104, null, BAR_104],
    [
      'files of no known release',
      { [MAIN_AHK]: 'mine\n', [MAIN_PS]: 'mine too\n' },
      null,
      'The scripts in this folder are from an older version. This app has 1.0.6.',
    ],
    [
      'a manifest of this version and a file missing',
      { ...APP, [MAIN_PS]: null },
      { version: '1.0.6', files: APP },
      "Some of the scripts in this folder are missing or differ from this app's (1.0.6).",
    ],
  ])('a folder with %s shows the bar with the versions and both buttons', async (_name, files, manifest, sentence) => {
    await open(await scriptsFolder(files, manifest), await sourceOf())
    const bar = await findBar()
    expect(within(bar).getByText(sentence)).toBeTruthy()
    expect(within(bar).getByRole('button', REVIEW)).toBeTruthy()
    expect(within(bar).getByRole('button', NOT_NOW)).toBeTruthy()
  })

  it('an up-to-date folder shows none', async () => {
    await open(await scriptsFolder(APP), await sourceOf())
    await checkEnded()
    noBar()
  })

  it('a folder with a .git entry shows none, and the check reads no file under ahk/', async () => {
    const folder = await scriptsFolder({ ...FROM_104, '.git/HEAD': 'ref: refs/heads/main\n' })
    let start = -1
    await open(folder, await sourceOf(() => (start = folder.reads.length)))
    await checkEnded()
    noBar()
    expect(start).toBeGreaterThanOrEqual(0)
    expect(folder.reads.slice(start).filter((path) => path.startsWith('ahk/'))).toEqual([])
  })

  it('a folder whose only differences are kept edits shows none', async () => {
    // ahk/main.ahk was the 1.0.5 copy, then edited; the person kept their edit when 1.0.6 was offered.
    const manifest = {
      version: '1.0.6',
      files: { ...APP, [MAIN_AHK]: 'main 1.0.5\n' },
      offered: { [MAIN_AHK]: APP[MAIN_AHK] },
    }
    await open(await scriptsFolder({ ...APP, [MAIN_AHK]: 'my own main\n' }, manifest), await sourceOf())
    await checkEnded()
    noBar()
  })

  it('a folder last updated by a newer app says so in a passing message, and shows no bar', async () => {
    await open(await scriptsFolder(FROM_104, { version: '1.0.9' }), await sourceOf())
    expect(
      await screen.findByText('This folder was last updated by version 1.0.9, which is newer than this app (1.0.6).'),
    ).toBeTruthy()
    expect(editor().banner?.kind).toBe('info')
    noBar()
  })

  it('Not now removes the bar until the folder is opened again; a tab change or a save does not bring it back', async () => {
    const folder = await scriptsFolder(FROM_104)
    const user = renderApp([folder, folder], await sourceOf())
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await user.click(within(await findBar()).getByRole('button', NOT_NOW))
    noBar()
    expect(editor().update).toBeNull()

    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    await user.click(screen.getByRole('tab', { name: 'Macros' }))
    await user.click(within(screen.getByRole('main')).getByRole('button', { name: /^F13( |$)/ }))
    const label = screen.getByLabelText('Label (shown on the overlay)')
    await user.clear(label)
    await user.type(label, 'Back')
    const save = screen.getByRole('button', { name: 'Save config.json' }) as HTMLButtonElement
    await user.click(save)
    await waitFor(() => expect(save.disabled).toBe(true))
    noBar()
    // Nothing but an opening starts a check.
    expect(planned).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    expect(within(await findBar()).getByText(BAR_104)).toBeTruthy()
    expect(planned).toHaveBeenCalledTimes(2)
  })

  it('Review the update asks for the dialog and keeps the bar', async () => {
    const user = await open(await scriptsFolder(FROM_104), await sourceOf())
    await user.click(within(await findBar()).getByRole('button', REVIEW))
    expect(editor().update).toMatchObject({ dialog: true, busy: false, result: null, plan: { from: '1.0.4', to: '1.0.6' } })
    expect(within(await findBar()).getByText(BAR_104)).toBeTruthy()
  })

  it('runs after the tabs are shown: the pad is on screen while the check still waits for its first read', async () => {
    const folder = await scriptsFolder(FROM_104)
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let checking = false
    folder.beforeRead = () => (checking ? held : undefined)
    await open(folder, await sourceOf(() => (checking = true)))
    await waitFor(() => expect(checking).toBe(true))
    expect(screen.getByRole('tab', { name: 'Pad shape', selected: true })).toBeTruthy()
    noBar()
    release()
    expect(within(await findBar()).getByText(BAR_104)).toBeTruthy()
  })

  it('a check that throws shows nothing and breaks nothing', async () => {
    const error = vi.spyOn(console, 'error')
    const folder = await scriptsFolder(FROM_104)
    const failing = () => Promise.reject(new Error('The folder went away.'))
    const user = await open(
      folder,
      await sourceOf(() => {
        folder.beforeList = failing
      }),
    )
    await checkEnded()
    await expect(planned.mock.results[0].value).rejects.toThrow('The folder went away.')
    noBar()
    // No message of any kind: the toast shows the banner.
    expect(editor().banner).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Layers' }))
    expect(screen.getByRole('tab', { name: 'Layers', selected: true })).toBeTruthy()
    expect(error).not.toHaveBeenCalled()
  })

  it('a check whose folder is no longer the open one leaves no trace', async () => {
    const older = await scriptsFolder(FROM_104)
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    let checking = false
    older.beforeRead = () => (checking ? held : undefined)
    const user = renderApp([older, await scriptsFolder(APP)], await sourceOf(() => (checking = true)))
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await waitFor(() => expect(checking).toBe(true))
    // The second folder is opened while the first one's check waits.
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await checkEnded(2)
    release()
    await checkEnded(1)
    await expect(planned.mock.results[0].value).resolves.toMatchObject({ news: true })
    noBar()
  })

  it('shows the bar under the changed-on-disk bar, and neither replaces the other', async () => {
    const folder = await scriptsFolder(FROM_104)
    await open(folder, await sourceOf())
    await findBar()
    await folder.writeBytes(CONFIG, enc.encode(EXAMPLE.replace('"title": "Media"', '"title": "Music"')))
    fireEvent.focus(window)
    const changed = await screen.findByRole('alert')
    expect(changed.textContent).toContain('config.json changed on disk.')
    const bar = await findBar()
    expect(within(bar).getByText(BAR_104)).toBeTruthy()
    // The update bar comes after (under) the changed-on-disk bar.
    expect(changed.compareDocumentPosition(bar)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it("checks against the app's own copy of the scripts and what the releases shipped", async () => {
    // The repository's scripts are the app's copy; without ahk/main.ahk the folder has something to add.
    const folder = await scriptsFolder({ [MAIN_AHK]: null }, null, ['config.json', 'ahk', 'powershell', 'img'])
    await open(folder, null)
    const { version } = await loadStarterIndex()
    const bar = await findBar()
    expect(bar.textContent).toContain(version)
    // The folder's files are ones the releases shipped, so it can tell which version they are from.
    expect(bar.textContent).not.toContain('from an older version')
  })
})
