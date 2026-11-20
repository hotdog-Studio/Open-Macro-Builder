/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useLayoutEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renameKey } from '../core/config/ops'
import { MemoryFolder } from '../core/folder/memory'
import type { DirEntry, FolderAccess } from '../core/folder/types'
import { SETTINGS_PATH } from '../core/settings'
import { fingerprint, type StarterIndex } from '../core/update/fingerprint'
import { KNOWN_RELEASES, type KnownReleases } from '../core/update/history'
import { MANIFEST_PATH } from '../core/update/manifest'
import { planUpdate, type UpdatePlan } from '../core/update/plan'
import { compareVersions } from '../core/update/version'
import type { StarterFile } from '../core/starter'
import type { Platform } from '../platform/types'
import { loadStarter, loadStarterIndex } from '../state/starter'
import { AppProvider, useApp, type AppState, type UpdateOffer } from '../state/store'
import { createUpdateActions, SHARED_DRAFTS, updateSentence, type UpdateDeps, type UpdateSource } from '../state/updateActions'
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
const NEWER_109 = 'This folder was last updated by version 1.0.9, which is newer than this app (1.0.6).'
const NOT_UTF8 = 'ahk/commands/broken.ahk is not UTF-8 text; its commands are listed, but the configurator will not edit it.'

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

/**
 * The small copy of the scripts these tests check folders against, as the app of `version` carries it;
 * `onCheck` runs as each check starts.
 */
async function sourceOf(onCheck: () => void = () => {}, version = '1.0.6'): Promise<UpdateSource> {
  const [index, known] = await Promise.all([INDEX, KNOWN])
  return {
    loadIndex: async () => {
      onCheck()
      return { ...index, version }
    },
    loadFiles: async () => starterFilesOf(APP),
    known,
  }
}

/** Texts as the files of the app's copy. */
const starterFilesOf = (texts: Record<string, string>): StarterFile[] =>
  Object.entries(texts).map(([path, text]) => ({ path, data: enc.encode(text) }))

/**
 * A folder around a MemoryFolder that records its reads, writes and removals, and whose calls a test can
 * hold back or fail.
 */
class TestFolder implements FolderAccess {
  /** Every path read, in order. */
  readonly reads: string[] = []
  /** Every path written or removed, in order. */
  readonly changes: string[] = []
  /** Runs before each read; may wait. */
  beforeRead: (path: string) => Promise<void> | void = () => {}
  /** Runs before each listing; may wait or throw. */
  beforeList: (dir: string) => Promise<void> | void = () => {}
  /** Runs before each write and removal; may wait or throw, and a throw is that call's failure. */
  beforeChange: (path: string) => Promise<void> | void = () => {}

  constructor(readonly inner: MemoryFolder) {}

  get name() {
    return this.inner.name
  }
  async readBytes(path: string) {
    this.reads.push(path)
    await this.beforeRead(path)
    return this.inner.readBytes(path)
  }
  async writeBytes(path: string, data: Uint8Array) {
    await this.beforeChange(path)
    this.changes.push(path)
    return this.inner.writeBytes(path, data)
  }
  async list(dir: string): Promise<DirEntry[]> {
    await this.beforeList(dir)
    return this.inner.list(dir)
  }
  async remove(path: string) {
    await this.beforeChange(path)
    this.changes.push(path)
    return this.inner.remove(path)
  }
  text(path: string) {
    return this.inner.text(path)
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

/**
 * Holds back every read of `folder` from the moment a check starts until `release` is called. Give
 * `onCheck` to sourceOf; `checking()` says whether a check has started.
 */
function holdReadsOnceChecking(folder: TestFolder) {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  let started = false
  folder.beforeRead = () => (started ? held : undefined)
  return {
    onCheck: () => {
      started = true
    },
    checking: () => started,
    release: () => release(),
  }
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

/**
 * Opens `folders` one after another with Open folder: the app checks against `source` (its own copy when
 * none is given). `more` changes the platform (the desktop app's, with a macropad).
 */
function renderApp(folders: FolderAccess[], source?: UpdateSource, more: Partial<Platform> = {}) {
  const platform: Platform = {
    kind: 'browser',
    openFolder: async () => folders.shift() ?? null,
    createFolder: async () => null,
    restoreFolder: async () => null,
    ...more,
  }
  render(
    <AppProvider platform={platform} updateSource={source}>
      <App />
      <Probe />
    </AppProvider>,
  )
  return userEvent.setup()
}

/** Opens the folder onto the tabs. */
async function open(folder: FolderAccess, source?: UpdateSource, more: Partial<Platform> = {}) {
  const user = renderApp([folder], source, more)
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

  it.each([
    ['a manifest of a newer app', { version: '1.0.9' }, '1.0.6', NEWER_109],
    [
      'no manifest and files of a release newer than a development build',
      null,
      '1.0.0-dev',
      'This folder was last updated by version 1.0.4, which is newer than this app (1.0.0-dev).',
    ],
  ])('a folder with %s says so in a passing message, and shows no bar', async (_name, manifest, appVersion, text) => {
    await open(await scriptsFolder(FROM_104, manifest), await sourceOf(undefined, appVersion))
    expect(await screen.findByText(text)).toBeTruthy()
    expect(editor().banner).toEqual({ text, kind: 'info' })
    noBar()
  })

  it('adds the newer-folder sentence to a load notice that stays, on a new line', async () => {
    const folder = await scriptsFolder(FROM_104, { version: '1.0.9' })
    // A command file that is not UTF-8 makes the folder open with a notice.
    await folder.writeBytes('ahk/commands/broken.ahk', new Uint8Array([0x4f, 0x6b, 0xe9, 0x0a]))
    await open(folder, await sourceOf())
    await checkEnded()
    expect(editor().banner).toEqual({ text: `${NOT_UTF8}\n${NEWER_109}`, kind: 'info', stays: true })
    noBar()
  })

  it('shows no bar for a folder it has just set up', async () => {
    const user = renderApp([new MemoryFolder('fresh', {})])
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await user.click(await screen.findByRole('button', { name: 'Set up' }))
    await user.click(await screen.findByRole('button', { name: 'Edit a copy in local/' }))
    const language = await screen.findByRole('dialog', { name: 'Which version do you run?' })
    await user.click(within(language).getByRole('button', { name: 'AutoHotkey' }))
    await screen.findByRole('tab', { name: 'Get started', selected: true })
    await checkEnded()
    await expect(planned.mock.results[0].value).resolves.toMatchObject({ skip: null, news: false })
    noBar()
    expect(editor().banner).toBeNull()
  })

  it('a rescan and a reload from disk start no check, and the bar stays', async () => {
    await open(await scriptsFolder(FROM_104), await sourceOf())
    await findBar()
    fireEvent.focus(window)
    await act(() => seen.actions.recheckCommands())
    await act(() => seen.actions.reloadFromDisk())
    expect(within(await findBar()).getByText(BAR_104)).toBeTruthy()
    expect(planned).toHaveBeenCalledTimes(1)
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
    const hold = holdReadsOnceChecking(folder)
    await open(folder, await sourceOf(hold.onCheck))
    await waitFor(() => expect(hold.checking()).toBe(true))
    expect(screen.getByRole('tab', { name: 'Pad shape', selected: true })).toBeTruthy()
    noBar()
    hold.release()
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
    const hold = holdReadsOnceChecking(older)
    const user = renderApp([older, await scriptsFolder(APP)], await sourceOf(hold.onCheck))
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await waitFor(() => expect(hold.checking()).toBe(true))
    // The second folder is opened while the first one's check waits.
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await checkEnded(2)
    hold.release()
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
    // Many of its files are as a known release shipped them, so the check tells which release it is from.
    const folder = await scriptsFolder({ [MAIN_AHK]: null }, null, ['config.json', 'ahk', 'powershell', 'img'])
    await open(folder)
    const { version } = await loadStarterIndex()
    const releases = new Set(Object.values(KNOWN_RELEASES.files).flatMap((byPrint) => Object.values(byPrint).flat()))
    if ([...releases].every((release) => compareVersions(version, release) < 0)) {
      // A build older than every known release (a development build, no APP_VERSION): the folder is newer.
      const toast = await screen.findByText(/^This folder was last updated by version \d+\.\d+\.\d+, which is newer than this app/)
      expect(toast.textContent).toContain(`(${version}).`)
      noBar()
    } else {
      // A release build (APP_VERSION set) is never older than the releases before the record.
      expect(compareVersions(version, KNOWN_RELEASES.last)).toBeGreaterThanOrEqual(0)
      const bar = await findBar()
      expect(bar.textContent).toContain(version)
      expect(bar.textContent).not.toContain('from an older version')
    }
  })
})

// ---------------------------------------------------------------- the dialog and the update

const INCLUDE = 'ahk/config.ahk'
const NEW_AHK = 'ahk/commands/custom/new.ahk'
const BACK_AHK = 'ahk/commands/custom/back.ahk'
const GONE_AHK = 'ahk/commands/custom/gone.ahk'
const GONE_PS1 = 'powershell/commands/custom/gone.ps1'
const TOOLS_PS1 = 'powershell/lib/tools.ps1'
const ICON = 'img/update/icon.png'
const HELPER_AHK = 'ahk/commands/helper.ahk'
const NEW_LINE = String.raw`#Include commands\custom\new.ahk`
const BACK_LINE = String.raw`#Include commands\custom\back.ahk`
const GONE_LINE = String.raw`#Include commands\custom\gone.ahk`

/** An include file: a title line, then a Custom Commands section listing `listed`, then the next section. */
const includeOf = (title: string, ...listed: string[]) =>
  [title, '; ****** Custom Commands ******', ...listed, '; ****** Macro Definitions ******', ''].join('\n')

/** The app's copy of the scripts in the tests of the update (1.0.6): new.ahk is new in it, gone.ahk and gone.ps1 are gone from it. */
const APP_6: Record<string, string> = {
  'config.json': EXAMPLE,
  [MAIN_AHK]: 'main 1.0.6\n',
  [MAIN_PS]: 'main 1.0.6\n',
  [TOOLS_PS1]: 'tools 1.0.6\n',
  [ICON]: 'icon 1.0.6',
  [INCLUDE]: includeOf('; config 1.0.6', BACK_LINE, NEW_LINE),
  [BACK_AHK]: 'BackCommand(Macro) {\n}\n',
  [NEW_AHK]: 'NewCommand(Macro) {\n}\n',
}

/** The scripts of 1.0.4, a release before the record (config.json is the same in every version). */
const FILES_4: Record<string, string> = {
  [MAIN_AHK]: 'main 1.0.4\n',
  [MAIN_PS]: 'main 1.0.4\n',
  [TOOLS_PS1]: 'tools 1.0.4\n',
  [ICON]: 'icon 1.0.4',
  [INCLUDE]: includeOf('; config 1.0.4', BACK_LINE, GONE_LINE),
  [BACK_AHK]: 'BackCommand(Macro) { ; 1.0.4\n}\n',
  [GONE_AHK]: 'GoneCommand(Macro) {\n}\n',
  [GONE_PS1]: 'function GoneCommand { param($Macro) }\n',
}

/** A folder 1.0.4 set up that the person worked in: main.ahk and the include file changed, back.ahk deleted. */
const WORKED: Record<string, string | null> = {
  ...FILES_4,
  [MAIN_AHK]: 'my main\n',
  [INCLUDE]: includeOf('; my config', BACK_LINE, GONE_LINE),
  [BACK_AHK]: null,
}

/** The app's copy (`app`, APP_6 unless given) and what 1.0.4 shipped (FILES_4); `files` loads the app's files. */
async function updateSourceOf({
  app = APP_6,
  files = async () => starterFilesOf(app),
}: { app?: Record<string, string>; files?: () => Promise<StarterFile[]> } = {}): Promise<UpdateSource> {
  const shipped = Object.entries(FILES_4).map(([path, text]) => [path, { [text]: ['1.0.4'] }])
  const [prints, known] = await Promise.all([printsOf(app), knownOf(Object.fromEntries(shipped))])
  return { loadIndex: async () => ({ version: '1.0.6', files: prints }), loadFiles: files, known }
}

const DIALOG = { name: 'Update the scripts in this folder' }
const UPDATE = { name: 'Update' }
const CHANGED = 'You changed these. They are kept as they are unless you tick them.'
const DELETED = 'You deleted these. They stay deleted unless you tick them.'
const BACKUP = 'A ticked file is replaced, and yours is kept beside it as <name>.before-update.bak.'
const ADJUST = 'ahk/config.ahk: yours is kept, and its list of command files was brought up to date.'
const START_AGAIN = 'Start the macropad again to use the new scripts.'
const NO_PICKS = { replaceChanged: [], restoreDeleted: [] }

const dialogOf = () => screen.getByRole('dialog', DIALOG)
const itemsOf = (list: HTMLElement) => within(list).getAllByRole('listitem').map((item) => item.textContent)
const ticksOf = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('checkbox')
    .map((box) => [box.closest('label')?.textContent, (box as HTMLInputElement).checked])
const disabled = (button: HTMLElement) => (button as HTMLButtonElement).disabled

/** Opens a folder of `files` with the update's source, and opens the dialog from the bar. */
async function reviewed(files: Record<string, string | null>, more: Partial<Platform> = {}, source?: UpdateSource) {
  const folder = await scriptsFolder(files)
  const user = await open(folder, source ?? (await updateSourceOf()), more)
  await user.click(within(await findBar()).getByRole('button', REVIEW))
  return { folder, user, dialog: dialogOf() }
}

/** Ticks `ticks`, presses Update and waits until the dialog says what came of it. */
async function press(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, ticks: string[] = []) {
  act(() => {
    for (const path of ticks) fireEvent.click(within(dialog).getByRole('checkbox', { name: path }))
  })
  await user.click(within(dialog).getByRole('button', UPDATE))
  await waitFor(() => expect(editor().update?.result).toBeTruthy())
}

/** A promise that waits until `release` is called. */
function gate() {
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  return { held, release: () => release() }
}

/** Starts a draft of the command file at `path`, as typing in the Commands tab does. */
const draft = (path: string) => () => {
  const file = editor().commandFiles.find((f) => f.file.path === path)
  seen.actions.editCommand(path, 'changed\n', file?.file.version ?? null)
}

const MINE_AHK = 'local/ahk/mine.ahk'
const MINE: Record<string, string> = { [MINE_AHK]: 'Mine(Macro) {\n}\n' }
const backupNames = Array.from({ length: 10 }, (_, i) => (i === 0 ? `${MAIN_AHK}.before-update.bak` : `${MAIN_AHK}.before-update.${i}.bak`))
const IN_THE_WAY = Object.fromEntries(backupNames.map((name) => [name, 'older\n']))

/** The files of an app's copy, one of which cannot be read: the update throws. */
const BROKEN = async (): Promise<StarterFile[]> => [
  {
    path: MAIN_AHK,
    get data(): Uint8Array {
      throw new Error('A broken copy.')
    },
  },
]

describe('the update dialog', () => {
  it('shows the counts of the plan, with nothing ticked and the focus on the dialog', async () => {
    const { dialog } = await reviewed(WORKED)
    expect(document.activeElement).toBe(dialog)
    expect(within(dialog).getByText('From 1.0.4 to 1.0.6. Nothing under local/ is read or changed.')).toBeTruthy()
    for (const name of ['Replaced 3 files you have not changed', 'Added 1 file', 'Removed 2 files']) {
      expect(within(dialog).getByRole('button', { name, expanded: false })).toBeTruthy()
    }
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([CHANGED, DELETED])
    expect(within(dialog).getByText(BACKUP)).toBeTruthy()
    expect(ticksOf(dialog)).toEqual([
      [INCLUDE, false],
      [MAIN_AHK, false],
      [BACK_AHK, false],
    ])
    expect(within(dialog).getByText(ADJUST)).toBeTruthy()
    expect(disabled(within(dialog).getByRole('button', NOT_NOW))).toBe(false)
    expect(disabled(within(dialog).getByRole('button', UPDATE))).toBe(false)
  })

  it.each<[string, string[]]>([
    ['Replaced 3 files you have not changed', [ICON, TOOLS_PS1, MAIN_PS]],
    ['Added 1 file', [NEW_AHK]],
    ['Removed 2 files', [GONE_AHK, GONE_PS1]],
  ])('the row "%s" shows and hides its paths', async (name, paths) => {
    const { user, dialog } = await reviewed(WORKED)
    const row = within(dialog).getByRole('button', { name, expanded: false })
    expect(within(dialog).queryByRole('list', { name })).toBeNull()
    await user.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(itemsOf(within(dialog).getByRole('list', { name }))).toEqual(paths)
    await user.click(row)
    expect(within(dialog).queryByRole('list', { name })).toBeNull()
  })

  it.each<{ name: string; files: Record<string, string | null>; rows: string[]; sections: string[] }>([
    {
      name: 'nothing changed or deleted',
      files: FILES_4,
      rows: ['Replaced 6 files you have not changed', 'Added 1 file', 'Removed 2 files'],
      sections: [],
    },
    {
      name: 'nothing to add',
      files: { ...FILES_4, [NEW_AHK]: APP_6[NEW_AHK] },
      rows: ['Replaced 6 files you have not changed', 'Removed 2 files'],
      sections: [],
    },
    { name: 'only a changed file', files: { ...APP_6, [MAIN_AHK]: 'my main\n' }, rows: [], sections: [CHANGED] },
  ])('leaves out what is empty: $name', async ({ files, rows, sections }) => {
    const { dialog } = await reviewed(files)
    expect(within(dialog).queryAllByRole('button', { expanded: false })).toHaveLength(rows.length)
    for (const name of rows) expect(within(dialog).getByRole('button', { name, expanded: false })).toBeTruthy()
    expect(within(dialog).queryAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(sections)
    expect(within(dialog).queryByText(ADJUST)).toBeNull()
  })

  it('does not say the include file is kept once it is ticked', async () => {
    const { user, dialog } = await reviewed(WORKED)
    await user.click(within(dialog).getByRole('checkbox', { name: INCLUDE }))
    expect(within(dialog).queryByText(ADJUST)).toBeNull()
  })

  it.each([
    ['no version, when its files tell none', null, 'From an older version to 1.0.6. Nothing under local/ is read or changed.'],
    [
      'the version both have, when its manifest names it',
      { version: '1.0.6', files: APP_6 },
      'Brings the scripts back to version 1.0.6. Nothing under local/ is read or changed.',
    ],
  ])('names %s', async (_name, manifest, line) => {
    const folder = await scriptsFolder({ ...APP_6, [MAIN_PS]: null }, manifest)
    const user = await open(folder, await updateSourceOf())
    await user.click(within(await findBar()).getByRole('button', REVIEW))
    expect(within(dialogOf()).getByText(line)).toBeTruthy()
  })

  it.each<{ ticks: string[]; main: string; backup: string | null; back: string | null }>([
    { ticks: [], main: 'my main\n', backup: null, back: null },
    { ticks: [MAIN_AHK], main: APP_6[MAIN_AHK], backup: 'my main\n', back: null },
    { ticks: [BACK_AHK], main: 'my main\n', backup: null, back: APP_6[BACK_AHK] },
  ])('writes exactly what was ticked: $ticks', async ({ ticks, main, backup, back }) => {
    const { folder, user, dialog } = await reviewed(WORKED)
    await press(user, dialog, ticks)
    expect(folder.text(MAIN_AHK)).toBe(main)
    expect(folder.text(`${MAIN_AHK}.before-update.bak`)).toBe(backup)
    expect(folder.text(BACK_AHK)).toBe(back)
    // What the person did not change is brought up to date whatever was ticked.
    expect(folder.text(MAIN_PS)).toBe(APP_6[MAIN_PS])
    expect(folder.text(NEW_AHK)).toBe(APP_6[NEW_AHK])
    expect(folder.text(GONE_AHK)).toBeNull()
    // The include file is theirs, with its list brought up to date.
    const include = folder.text(INCLUDE) ?? ''
    expect(include.startsWith('; my config\n')).toBe(true)
    expect(include).toContain(NEW_LINE)
    expect(include).not.toContain(GONE_LINE)
  })

  it('applies the ticks to the folder as it is at the press, not as the bar found it', async () => {
    const { folder, user, dialog } = await reviewed(WORKED)
    await user.click(within(dialog).getByRole('checkbox', { name: MAIN_AHK }))
    await user.click(within(dialog).getByRole('checkbox', { name: BACK_AHK }))
    // Since the bar: main.ahk is back to what 1.0.4 shipped, main.ps1 was edited, back.ahk was made again by hand.
    await folder.inner.writeBytes(MAIN_AHK, enc.encode(FILES_4[MAIN_AHK]))
    await folder.inner.writeBytes(MAIN_PS, enc.encode('my own ps\n'))
    await folder.inner.writeBytes(BACK_AHK, enc.encode('my back\n'))
    await press(user, dialog)
    expect(planned).toHaveBeenCalledTimes(2)
    expect(folder.text(MAIN_AHK)).toBe(APP_6[MAIN_AHK])
    expect(folder.text(`${MAIN_AHK}.before-update.bak`)).toBeNull()
    expect(folder.text(MAIN_PS)).toBe('my own ps\n')
    expect(folder.text(BACK_AHK)).toBe('my back\n')
    expect(editor().update?.result).toMatchObject({ ok: true, backups: [] })
  })

  it.each<{ name: string; files: Record<string, string>; edit: () => void; reasons: string[] }>([
    { name: 'a shared command file', files: {}, edit: draft(HELPER_AHK), reasons: [SHARED_DRAFTS] },
    { name: 'the layout', files: {}, edit: () => seen.dispatch({ type: 'edit', ws: renameKey(editor().ws, 'k1', 'F1') }), reasons: [] },
    { name: 'a command file of your own', files: MINE, edit: draft(MINE_AHK), reasons: [] },
  ])('with unsaved changes in $name, Update is off only for a shared command file', async ({ files, edit, reasons }) => {
    const { dialog } = await reviewed({ ...WORKED, ...files })
    act(edit)
    expect(within(dialog).queryAllByText(/^Save or discard/).map((p) => p.textContent)).toEqual(reasons)
    expect(disabled(within(dialog).getByRole('button', UPDATE))).toBe(reasons.length > 0)
    expect(disabled(within(dialog).getByRole('button', NOT_NOW))).toBe(false)
  })

  it.each<[string, () => void]>([
    ['Not now', () => fireEvent.click(within(dialogOf()).getByRole('button', NOT_NOW))],
    ['Escape', () => fireEvent.keyDown(window, { key: 'Escape' })],
    ['a press on the backdrop', () => fireEvent.pointerDown(dialogOf().parentElement!)],
  ])('%s closes the dialog and the bar, and writes nothing', async (_name, close) => {
    const { folder } = await reviewed(WORKED)
    act(close)
    expect(screen.queryByRole('dialog', DIALOG)).toBeNull()
    noBar()
    expect(editor().update).toBeNull()
    expect(folder.changes).toEqual([])
  })

  it('a press inside the dialog does not close it', async () => {
    const { dialog } = await reviewed(WORKED)
    fireEvent.pointerDown(within(dialog).getByText(CHANGED))
    expect(dialogOf()).toBeTruthy()
  })
})

describe('updating', () => {
  it.each<{ ticks: string[]; counts: string; kept: string[] | null; backups: string[] | null }>([
    { ticks: [MAIN_AHK], counts: 'Updated to 1.0.6: 4 replaced, 1 added, 2 removed.', kept: null, backups: [`${MAIN_AHK}.before-update.bak`] },
    { ticks: [], counts: 'Updated to 1.0.6: 3 replaced, 1 added, 2 removed.', kept: [MAIN_AHK], backups: null },
  ])(
    'says what was done with $ticks ticked, names the kept files and the backups, and says the include file was brought up to date',
    async ({ ticks, counts, kept, backups }) => {
      const { user, dialog } = await reviewed(WORKED)
      await press(user, dialog, ticks)
      const done = dialogOf()
      expect(within(done).getByText(counts)).toBeTruthy()
      const keptList = within(done).queryByRole('list', { name: 'Kept as they are:' })
      expect(keptList && itemsOf(keptList)).toEqual(kept)
      const backupList = within(done).queryByRole('list', { name: 'Your versions, kept beside the new ones:' })
      expect(backupList && itemsOf(backupList)).toEqual(backups)
      // The include file kept with its list brought up to date is said so, not listed as kept as it is.
      expect(within(done).getByText(ADJUST)).toBeTruthy()
      expect(within(done).getByText(START_AGAIN)).toBeTruthy()
      expect(within(done).queryByRole('button', { name: 'Reload the macropad' })).toBeNull()
      noBar()
      const close = within(done).getByRole('button', { name: 'Close' })
      expect(document.activeElement).toBe(close)
      await user.click(close)
      expect(screen.queryByRole('dialog', DIALOG)).toBeNull()
      expect(editor().update).toBeNull()
    },
  )

  it('in the desktop app with no macropad running, says to start it again', async () => {
    const { user, dialog } = await reviewed(WORKED, { kind: 'electron', findMacropad: async () => null, reloadMacropad: async () => null })
    await press(user, dialog)
    expect(within(dialogOf()).getByText(START_AGAIN)).toBeTruthy()
    expect(within(dialogOf()).queryByRole('button', { name: 'Reload the macropad' })).toBeNull()
  })

  it('in the desktop app with a macropad running, offers to reload it, then says what the reload said', async () => {
    const reloadMacropad = vi.fn(async () => 'ahk' as const)
    const { user, dialog } = await reviewed(WORKED, { kind: 'electron', findMacropad: async () => 'ahk', reloadMacropad })
    await press(user, dialog)
    expect(within(dialogOf()).queryByText(START_AGAIN)).toBeNull()
    expect(document.activeElement).toBe(within(dialogOf()).getByRole('button', { name: 'Close' }))
    await user.click(within(dialogOf()).getByRole('button', { name: 'Reload the macropad' }))
    expect(await within(dialogOf()).findByText('Reloaded the AutoHotkey macropad.')).toBeTruthy()
    expect(reloadMacropad).toHaveBeenCalledTimes(1)
    expect(within(dialogOf()).queryByRole('button', { name: 'Reload the macropad' })).toBeNull()
    expect(within(dialogOf()).queryByText(START_AGAIN)).toBeNull()
  })

  it('stops at a write that fails, says the folder holds two versions, and Try again finishes the update', async () => {
    const { folder, user, dialog } = await reviewed(WORKED)
    folder.beforeChange = (path) => {
      if (path === TOOLS_PS1) throw new Error('The disk is full.')
    }
    await press(user, dialog)
    const failed = dialogOf()
    const stopped = `The update stopped at ${TOOLS_PS1}: The disk is full. This folder now has scripts of two versions. Run the update again to finish it.`
    expect(within(failed).getByText(stopped)).toBeTruthy()
    expect(document.activeElement).toBe(within(failed).getByRole('button', { name: 'Close' }))
    expect(folder.text(NEW_AHK)).toBe(APP_6[NEW_AHK])
    expect(folder.text(MANIFEST_PATH)).toBeNull()
    // Some files changed, so the command lists are scanned again.
    await waitFor(() => expect(editor().commandFiles.map((f) => f.file.path)).toContain(NEW_AHK))

    folder.beforeChange = () => {}
    await user.click(within(failed).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(editor().update?.result?.ok).toBe(true))
    expect(within(dialogOf()).getByText('Updated to 1.0.6: 2 replaced, 0 added, 2 removed.')).toBeTruthy()
    expect(folder.text(TOOLS_PS1)).toBe(APP_6[TOOLS_PS1])
    expect(folder.text(MANIFEST_PATH)).not.toBeNull()
  })

  it.each<{
    name: string
    ticks: string[]
    put: Record<string, string>
    failAt?: string
    files?: () => Promise<StarterFile[]>
    sentence: string
    changes: string[]
  }>([
    {
      name: 'the backups of a ticked file are in the way',
      ticks: [MAIN_AHK],
      put: IN_THE_WAY,
      sentence:
        'The update could not start at ahk/main.ahk: ahk/main.ahk.before-update.bak and ahk/main.ahk.before-update.1.bak to .9.bak are all in the way, so ahk/main.ahk cannot be backed up. Move some of them away, then update again. Nothing was changed.',
      changes: [],
    },
    {
      name: 'the first script fails after the backups were written',
      ticks: [MAIN_AHK],
      put: {},
      failAt: NEW_AHK,
      sentence: `The update could not start at ${NEW_AHK}: The disk is full. The backups it had made stay: ${MAIN_AHK}.before-update.bak.`,
      changes: [`${MAIN_AHK}.before-update.bak`],
    },
    {
      name: 'the folder is newer than the app now',
      ticks: [],
      put: { [MANIFEST_PATH]: JSON.stringify({ version: '1.0.9', files: {}, deleted: [], offered: {} }) },
      sentence:
        'The update could not start: this folder was last updated by version 1.0.9, which is newer than this app (1.0.6). Nothing was changed.',
      changes: [],
    },
    {
      name: 'the folder is kept with Git now',
      ticks: [],
      put: { '.git/HEAD': 'ref: refs/heads/main\n' },
      sentence:
        'The update could not start: this folder has a .git entry now, and a folder kept with Git is not updated by this app. Nothing was changed.',
      changes: [],
    },
    {
      name: "the app's copy cannot be loaded",
      ticks: [],
      put: {},
      files: () => Promise.reject(new Error('Failed to fetch.')),
      sentence: "The update could not start: the app's copy of the scripts could not be loaded (Failed to fetch). Nothing was changed.",
      changes: [],
    },
  ])('says what could not start when $name', async ({ ticks, put, failAt, files, sentence, changes }) => {
    const { folder, user, dialog } = await reviewed(WORKED, {}, await updateSourceOf({ files }))
    // Changed since the bar showed.
    await Promise.all(Object.entries(put).map(([path, text]) => folder.inner.writeBytes(path, enc.encode(text))))
    folder.beforeChange = (path) => {
      if (path === failAt) throw new Error('The disk is full.')
    }
    await press(user, dialog, ticks)
    const failed = dialogOf()
    expect(within(failed).getByText(sentence)).toBeTruthy()
    expect(within(failed).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(document.activeElement).toBe(within(failed).getByRole('button', { name: 'Close' }))
    expect(folder.changes).toEqual(changes)
  })

  it('ends an update that throws in a failure of its own, not in a dialog that stays busy', async () => {
    const { user, dialog } = await reviewed(WORKED, {}, await updateSourceOf({ files: BROKEN }))
    await press(user, dialog)
    const failed = dialogOf()
    const sentence = 'The update stopped: A broken copy. Some scripts may already be the new ones. Run the update again to finish it.'
    expect(within(failed).getByText(sentence)).toBeTruthy()
    expect(editor().update?.busy).toBe(false)
    expect(within(failed).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(document.activeElement).toBe(within(failed).getByRole('button', { name: 'Close' }))
  })

  it.each<{ name: string; ticks: string[]; put: Record<string, string>; failAt?: string }>([
    { name: 'a write failed', ticks: [], put: {}, failAt: TOOLS_PS1 },
    { name: 'it could not start', ticks: [MAIN_AHK], put: IN_THE_WAY },
  ])('after Close on a failure where $name, the bar comes back to run it again', async ({ ticks, put, failAt }) => {
    const { folder, user, dialog } = await reviewed(WORKED)
    await Promise.all(Object.entries(put).map(([path, text]) => folder.inner.writeBytes(path, enc.encode(text))))
    folder.beforeChange = (path) => {
      if (path === failAt) throw new Error('The disk is full.')
    }
    await press(user, dialog, ticks)
    await user.click(within(dialogOf()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', DIALOG)).toBeNull()
    expect(within(await findBar()).getByRole('button', REVIEW)).toBeTruthy()
    expect(planned).toHaveBeenCalledTimes(3)
  })

  it('afterwards, the Commands tab lists the command file it added, and a key whose command the newer scripts lack is marked', async () => {
    const layout = EXAMPLE.replace('"action": "PreviousTrack"', '"action": "GoneCommand"')
    const folder = await scriptsFolder({ ...WORKED, [CONFIG]: layout })
    const user = await open(folder, await updateSourceOf())
    const files = () => within(screen.getByRole('navigation', { name: 'Command files' }))
    const f13 = () => within(within(screen.getByRole('main')).getByRole('button', { name: /^F13( |$)/ }))
    await user.click(screen.getByRole('tab', { name: 'Commands' }))
    expect(files().getByText('custom/gone')).toBeTruthy()
    expect(files().queryByText('custom/new')).toBeNull()
    await user.click(screen.getByRole('tab', { name: 'Macros' }))
    expect(f13().queryByText(/^not in/)).toBeNull()

    await user.click(within(await findBar()).getByRole('button', REVIEW))
    await press(user, dialogOf())
    await user.click(within(dialogOf()).getByRole('button', { name: 'Close' }))
    noBar()
    expect(await f13().findByText('not in AHK, PS')).toBeTruthy()
    await user.click(screen.getByRole('tab', { name: 'Commands' }))
    expect(files().getByText('custom/new')).toBeTruthy()
    expect(files().queryByText('custom/gone')).toBeNull()
  })

  it('afterwards, lists the icon sets again: one the update added is there', async () => {
    const { user, dialog } = await reviewed(WORKED, {}, await updateSourceOf({ app: { ...APP_6, 'img/fresh/layer.png': 'png' } }))
    expect(editor().iconSets).not.toContain('fresh')
    await press(user, dialog)
    await waitFor(() => expect(editor().iconSets).toContain('fresh'))
  })

  it('keeps an unsaved draft of your own command file through the update and the scan after it', async () => {
    const { folder, user, dialog } = await reviewed({ ...WORKED, ...MINE })
    act(draft(MINE_AHK))
    await press(user, dialog)
    // The scan after the update has run once the command file it added is listed.
    await waitFor(() => expect(editor().commandFiles.map((f) => f.file.path)).toContain(NEW_AHK))
    expect(editor().commands.drafts[MINE_AHK]).toBe('changed\n')
    expect(folder.text(MINE_AHK)).toBe(MINE[MINE_AHK])
  })

  it('while it runs: the focus is on the dialog, both buttons are off, Escape and the backdrop do nothing, and no folder is opened, closed or reloaded', async () => {
    const folder = await scriptsFolder(WORKED)
    const user = renderApp([folder, await scriptsFolder(APP_6)], await updateSourceOf())
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await user.click(within(await findBar()).getByRole('button', REVIEW))
    const { held, release } = gate()
    let writing = false
    folder.beforeChange = () => {
      writing = true
      return held
    }
    await user.click(within(dialogOf()).getByRole('button', UPDATE))
    await waitFor(() => expect(writing).toBe(true))

    expect(document.activeElement).toBe(dialogOf())
    expect(disabled(within(dialogOf()).getByRole('button', NOT_NOW))).toBe(true)
    expect(disabled(within(dialogOf()).getByRole('button', UPDATE))).toBe(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.pointerDown(dialogOf().parentElement!)
    expect(editor().update?.busy).toBe(true)
    const configReads = folder.reads.filter((path) => path === CONFIG).length
    await act(() => seen.actions.openFolder())
    await act(() => seen.actions.reloadFromDisk())
    act(() => seen.actions.closeFolder())
    expect(editor().folder).toBe(folder)
    expect(folder.reads.filter((path) => path === CONFIG)).toHaveLength(configReads)

    release()
    await waitFor(() => expect(editor().update?.result?.ok).toBe(true))
    // Once it has ended, Escape closes what the dialog says, as Close does.
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(editor().update).toBeNull()
  })

  it('lets no folder open until the outcome is shown, the running macropad looked for', async () => {
    const find = gate()
    let looking = false
    const findMacropad = async () => {
      looking = true
      await find.held
      return null
    }
    const folder = await scriptsFolder(WORKED)
    const user = renderApp([folder, await scriptsFolder(APP_6)], await updateSourceOf(), { kind: 'electron', findMacropad })
    await user.click(screen.getByRole('button', { name: 'Open folder' }))
    await user.click(within(await findBar()).getByRole('button', REVIEW))
    await user.click(within(dialogOf()).getByRole('button', UPDATE))
    await waitFor(() => expect(looking).toBe(true))
    expect(folder.changes).toContain(MANIFEST_PATH)
    await act(() => seen.actions.openFolder())
    expect(editor().folder).toBe(folder)
    find.release()
    await waitFor(() => expect(editor().update?.result?.ok).toBe(true))
  })

  it('waits for a delete in the Commands tab to end before it makes the plan again', async () => {
    const { folder, user, dialog } = await reviewed(WORKED)
    const { held, release } = gate()
    folder.beforeChange = (path) => (path === HELPER_AHK ? held : undefined)
    let deleted!: Promise<string | null>
    act(() => {
      deleted = seen.actions.deleteCommandFile(HELPER_AHK)
    })
    await user.click(within(dialog).getByRole('button', UPDATE))
    await act(() => new Promise((done) => setTimeout(done, 50)))
    expect(planned).toHaveBeenCalledTimes(1)
    release()
    await act(async () => {
      await deleted
    })
    await waitFor(() => expect(editor().update?.result?.ok).toBe(true))
    expect(planned).toHaveBeenCalledTimes(2)
    expect(folder.text(HELPER_AHK)).toBeNull()
  })

  it('waits for a New file in two languages to end as a whole before it makes the plan again', async () => {
    const { folder, user, dialog } = await reviewed(WORKED)
    const ahk = gate()
    const ps = gate()
    const holds: Record<string, Promise<void>> = { 'ahk/commands/custom/two.ahk': ahk.held, 'powershell/commands/custom/two.ps1': ps.held }
    folder.beforeChange = (path) => holds[path]
    let created!: Promise<string | null>
    act(() => {
      created = seen.actions.createCommandFiles({ group: 'shared', name: 'two', langs: ['ahk', 'ps'] })
    })
    await user.click(within(dialog).getByRole('button', UPDATE))
    ahk.release()
    await act(() => new Promise((done) => setTimeout(done, 50)))
    // The first file is made, the second is being written: the plan is not made again yet.
    expect(folder.text('ahk/commands/custom/two.ahk')).not.toBeNull()
    expect(planned).toHaveBeenCalledTimes(1)
    ps.release()
    await act(async () => {
      await created
    })
    await waitFor(() => expect(editor().update?.result?.ok).toBe(true))
    expect(planned).toHaveBeenCalledTimes(2)
  })

  it("writes the app's own copy of the scripts, as the page carries it", async () => {
    const folder = await scriptsFolder({ [MAIN_AHK]: null }, null, ['config.json', 'ahk', 'powershell', 'img'])
    const source: UpdateSource = { loadIndex: loadStarterIndex, loadFiles: loadStarter, known: { last: '0.0.0', files: {} } }
    const user = await open(folder, source)
    await user.click(within(await findBar()).getByRole('button', REVIEW))
    await press(user, dialogOf())
    const { version } = await loadStarterIndex()
    expect(within(dialogOf()).getByText(`Updated to ${version}: 0 replaced, 1 added, 0 removed.`)).toBeTruthy()
    expect(folder.text(MAIN_AHK)?.replaceAll('\r\n', '\n')).toBe(readRepoText(MAIN_AHK))
  })
})

describe('the update action on its own', () => {
  /** The update actions alone, with the editor's dialog open on `plan`, and `deps` changed. */
  function actionsFor(source: UpdateSource, plan: UpdatePlan, deps: Partial<UpdateDeps>) {
    let update: UpdateOffer | null = { plan, dialog: true, busy: false, result: null, macropad: null, note: null }
    const shown: (UpdateOffer | null)[] = []
    const actions = createUpdateActions({
      source,
      dispatch: (action) => {
        if (action.type !== 'update') return
        update = action.update
        shown.push(update)
      },
      getState: () => ({ screen: 'edit', dirty: false, update }) as unknown as AppState,
      current: () => true,
      loadNumber: () => 1,
      folder: () => null,
      idle: async () => {},
      draftPaths: () => [],
      rescan: async () => {},
      macropad: { find: async () => null, reload: async () => null },
      ...deps,
    })
    return { actions, shown }
  }

  /** The update of a folder the person worked in, with its plan and the source. */
  async function worked() {
    const folder = await scriptsFolder(WORKED)
    const source = await updateSourceOf()
    const index = await source.loadIndex()
    return { folder, source, index, plan: await planUpdate(folder, index, source.known) }
  }

  it.each<[string, 'plan' | 'macropad', boolean]>([
    ['the plan is made again', 'plan', false],
    ['the running macropad is looked for', 'macropad', true],
  ])('shows nothing when the open folder changed while %s', async (_name, when, wrote) => {
    const { folder, source, index, plan } = await worked()
    const other = await scriptsFolder(APP_6)
    let opened: FolderAccess = folder
    const switching: UpdateSource = {
      ...source,
      loadIndex: async () => {
        if (when === 'plan') opened = other
        return index
      },
    }
    const find = async () => {
      opened = other
      return null
    }
    const { actions, shown } = actionsFor(switching, plan, { folder: () => opened, macropad: { find, reload: async () => null } })
    await actions.applyUpdate({ replaceChanged: [MAIN_AHK], restoreDeleted: [BACK_AHK] })
    expect(shown).toEqual([expect.objectContaining({ busy: true, result: null })])
    expect(folder.changes.length > 0).toBe(wrote)
    expect(other.changes).toEqual([])
    expect(actions.updating()).toBe(false)
  })

  it('refuses to start while a shared command file has unsaved changes, whatever the dialog shows', async () => {
    const { folder, source, plan } = await worked()
    const { actions, shown } = actionsFor(source, plan, { folder: () => folder, draftPaths: () => [HELPER_AHK] })
    await actions.applyUpdate(NO_PICKS)
    expect(shown).toEqual([])
    expect(folder.changes).toEqual([])
  })

  it.each<{ name: string; files?: () => Promise<StarterFile[]>; rescans: number; result: object }>([
    { name: 'a success', rescans: 1, result: { ok: true } },
    { name: 'a throw', files: BROKEN, rescans: 1, result: { ok: false, threw: 'A broken copy.' } },
    {
      name: 'a reason that names no file',
      files: () => Promise.reject(new Error('Failed to fetch.')),
      rescans: 0,
      result: { ok: false, notStarted: "the app's copy of the scripts could not be loaded (Failed to fetch)" },
    },
  ])('after $name, scans the shared files again only when they may have changed', async ({ files, rescans, result }) => {
    const { folder, plan } = await worked()
    const rescan = vi.fn(async () => {})
    const { actions, shown } = actionsFor(await updateSourceOf({ files }), plan, { folder: () => folder, rescan })
    await actions.applyUpdate(NO_PICKS)
    expect(shown.at(-1)).toMatchObject({ busy: false, result })
    expect(rescan).toHaveBeenCalledTimes(rescans)
  })
})
