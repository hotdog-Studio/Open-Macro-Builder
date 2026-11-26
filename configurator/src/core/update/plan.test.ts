import { describe, expect, it } from 'vitest'
import { GuardedFolder } from '../../../test/guardedFolder'
import { MemoryFolder } from '../folder/memory'
import type { DirEntry } from '../folder/types'
import { fingerprint, type StarterIndex } from './fingerprint'
import { everShipped, type KnownReleases } from './history'
import { MANIFEST_PATH } from './manifest'
import { planUpdate, type UpdatePlan } from './plan'

const bytes = (text: string) => new TextEncoder().encode(text)
const print = (path: string, text: string) => fingerprint(path, bytes(text))

/** Each path's text turned into its fingerprint. */
async function printsOf(texts: Record<string, string>): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(texts).map(async ([path, text]) => [path, await print(path, text)] as const),
  )
  return Object.fromEntries(entries)
}

/** The app's copy (1.0.6), as texts. */
const APP: Record<string, string> = {
  'config.json': 'config 1.0.6\n',
  'ahk/lib/json.ahk': 'json 1.0.6\n',
  'ahk/commands/windows.ahk': 'windows 1.0.6\n',
  'powershell/commands/custom/ssh.ps1': 'ssh 1.0.6\n',
  /** New in 1.0.6: no known release shipped it. */
  'powershell/commands/custom/new.ps1': 'new 1.0.6\n',
}

/** What the releases before the record shipped: path -> text -> releases, oldest first. */
const OLD: Record<string, Record<string, string[]>> = {
  'config.json': { 'config 1.0.4\n': ['1.0.4'], 'config 1.0.5\n': ['1.0.5'] },
  'ahk/lib/json.ahk': { 'json 1.0.4\n': ['1.0.4', '1.0.5'] },
  'ahk/commands/windows.ahk': { 'windows 1.0.2\n': ['1.0.2', '1.0.3', '1.0.4', '1.0.5'] },
  'powershell/commands/custom/ssh.ps1': { 'ssh 1.0.5\n': ['1.0.5'] },
  'ahk/commands/gone.ahk': { 'gone 1.0.4\n': ['1.0.4', '1.0.5'] },
}

const WINDOWS_LINE = String.raw`#Include commands\windows.ahk`
const CHROME_LINE = String.raw`#Include commands\custom\chrome.ahk`
const MINE_LINE = String.raw`#Include commands\custom\mine.ahk`
const lines = (...all: string[]) => [...all, ''].join('\n')

/** The app's copy with the include file and a second AutoHotkey command file. */
const LISTED_APP: Record<string, string> = {
  ...APP,
  'ahk/commands/custom/chrome.ahk': 'chrome 1.0.6\n',
  'ahk/config.ahk': lines('; config 1.0.6', WINDOWS_LINE, CHROME_LINE),
}

const LISTED_OLD: Record<string, Record<string, string[]>> = {
  ...OLD,
  'ahk/commands/custom/chrome.ahk': { 'chrome 1.0.5\n': ['1.0.5'] },
  'ahk/config.ahk': { [lines('; config 1.0.5', WINDOWS_LINE, CHROME_LINE)]: ['1.0.5'] },
}

async function indexOf(texts: Record<string, string>): Promise<StarterIndex> {
  return { version: '1.0.6', files: await printsOf(texts) }
}

async function knownOf(old: Record<string, Record<string, string[]>>): Promise<KnownReleases> {
  const entries = await Promise.all(
    Object.entries(old).map(async ([path, byText]) => {
      const pairs = await Promise.all(
        Object.entries(byText).map(async ([text, releases]) => [await print(path, text), releases] as const),
      )
      return [path, Object.fromEntries(pairs)] as const
    }),
  )
  return { last: '1.0.5', files: Object.fromEntries(entries) }
}

interface Fixture {
  app: Record<string, string>
  index: StarterIndex
  known: KnownReleases
}

async function fixtureOf(app: Record<string, string>, old: Record<string, Record<string, string[]>>): Promise<Fixture> {
  return { app, index: await indexOf(app), known: await knownOf(old) }
}

const BASE = fixtureOf(APP, OLD)
const LISTED = fixtureOf(LISTED_APP, LISTED_OLD)
/** The base, where 1.0.5 already shipped config.json as the app's copy has it. */
const APP_TEXT_KNOWN = fixtureOf(APP, { ...OLD, 'config.json': { ...OLD['config.json'], [APP['config.json']]: ['1.0.5'] } })

/** A manifest, with texts where it holds fingerprints. */
interface ManifestTexts {
  version: string
  files?: Record<string, string>
  deleted?: string[]
  offered?: Record<string, string>
}

async function manifestText(manifest: ManifestTexts): Promise<string> {
  return JSON.stringify({
    version: manifest.version,
    files: await printsOf(manifest.files ?? {}),
    deleted: manifest.deleted ?? [],
    offered: await printsOf(manifest.offered ?? {}),
  })
}

/** A text replaces or adds a file; null takes it out. */
type Changes = Record<string, string | null>

/** A folder holding the app's copy with `changes` on top, and the manifest when one is given. */
async function folderOf(app: Record<string, string>, changes: Changes, manifest: ManifestTexts | null): Promise<MemoryFolder> {
  const files: Record<string, string> = {}
  for (const [path, text] of Object.entries({ ...app, ...changes })) {
    if (text !== null) files[path] = text
  }
  if (manifest !== null) files[MANIFEST_PATH] = await manifestText(manifest)
  return new MemoryFolder('scripts', files)
}

async function planOf(changes: Changes = {}, manifest: ManifestTexts | null = null, fixture = BASE): Promise<UpdatePlan> {
  const { app, index, known } = await fixture
  return planUpdate(await folderOf(app, changes, manifest), index, known)
}

type Lists = Pick<UpdatePlan, 'replace' | 'add' | 'remove' | 'changed' | 'deleted' | 'keptRemoved'>
const NO_LISTS: Lists = { replace: [], add: [], remove: [], changed: [], deleted: [], keptRemoved: [] }

const listsOf = (plan: UpdatePlan): Lists => ({
  replace: plan.replace,
  add: plan.add,
  remove: plan.remove,
  changed: plan.changed,
  deleted: plan.deleted,
  keptRemoved: plan.keptRemoved,
})

/** A folder that throws on a read of a path no version ever had (or any path under local/). */
async function guarded(folder: MemoryFolder, fixture = BASE): Promise<GuardedFolder> {
  const { index, known } = await fixture
  const app = new Set(Object.keys(index.files).map((path) => path.toLowerCase()))
  const everHad = (path: string) => app.has(path.toLowerCase()) || everShipped(known, path)
  return new GuardedFolder(folder, (path) => path === MANIFEST_PATH || everHad(path))
}

describe('planUpdate: the check', () => {
  it.each<[string, Changes, ManifestTexts | null, Partial<Lists>]>([
    ["has the fingerprint of the app's copy: up to date, left", {}, null, {}],
    [
      "has the manifest's fingerprint: untouched, replaced",
      { 'config.json': 'config by 1.0.6-rc\n' },
      { version: '1.0.5', files: { 'config.json': 'config by 1.0.6-rc\n' } },
      { replace: ['config.json'] },
    ],
    ['has one known for the path: untouched, replaced', { 'config.json': 'config 1.0.5\n' }, null, { replace: ['config.json'] }],
    ['has any other fingerprint: changed, kept', { 'config.json': 'my config\n' }, null, { changed: ['config.json'] }],
    [
      'is missing, a command file the person deleted: left out',
      { 'ahk/commands/windows.ahk': null },
      { version: '1.0.5', deleted: ['ahk/commands/windows.ahk'] },
      { deleted: ['ahk/commands/windows.ahk'] },
    ],
    ["is missing otherwise, and the app's copy has it: added", { 'ahk/lib/json.ahk': null }, null, { add: ['ahk/lib/json.ahk'] }],
    [
      "exists, the app's copy no longer has it, untouched: removed",
      { 'ahk/commands/gone.ahk': 'gone 1.0.4\n' },
      null,
      { remove: ['ahk/commands/gone.ahk'] },
    ],
    [
      "exists, the app's copy no longer has it, changed: kept",
      { 'ahk/commands/gone.ahk': 'my gone\n' },
      null,
      { keptRemoved: ['ahk/commands/gone.ahk'] },
    ],
  ])('a file that %s', async (_row, changes, manifest, lists) => {
    expect(listsOf(await planOf(changes, manifest))).toEqual({ ...NO_LISTS, ...lists })
  })

  // The files 1.0.7 moved out of what a set-up folder gets: a 1.0.6 folder has them, and its manifest records them.
  const DEVELOPER_FILES = [
    'powershell/tools/spike-hotkeys.ps1',
    'powershell/tools/spike-inputhook.ps1',
    'powershell/tools/preview-overlay.ps1',
    'ahk/dump_config.ahk',
    'img/icon.png',
  ]
  it.each(
    DEVELOPER_FILES.flatMap((path): [string, string, boolean][] => [
      [path, 'as the manifest records it: removed', false],
      [path, 'with other text than the manifest records: kept', true],
    ]),
  )('%s of a 1.0.6 folder, %s', async (path, _row, changed) => {
    const recorded = `${path} 1.0.6\n`
    const plan = await planOf({ [path]: changed ? 'my copy\n' : recorded }, { version: '1.0.6', files: { [path]: recorded } })
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, ...(changed ? { keptRemoved: [path] } : { remove: [path] }) })
    expect(plan.news).toBe(!changed)
  })

  it('never reads a path no version ever had, nor puts it in a list or in seen', async () => {
    const { app, index, known } = await BASE
    const folder = await guarded(await folderOf(app, { 'ahk/lib/mine.ahk': 'mine\n' }, null))
    const plan = await planUpdate(folder, index, known)
    expect(listsOf(plan)).toEqual(NO_LISTS)
    expect(Object.keys(plan.seen)).not.toContain('ahk/lib/mine.ahk')
    expect(folder.calls.filter((call) => call.op === 'readBytes').map((call) => call.path)).not.toContain('ahk/lib/mine.ahk')
    expect(folder.refused).toEqual([])
  })

  it("puts a missing path the app's copy does not have in no list", async () => {
    const plan = await planOf()
    expect(listsOf(plan)).toEqual(NO_LISTS)
    expect(plan.seen['ahk/commands/gone.ahk']).toBeNull()
  })

  it.each<[string, ManifestTexts | null, Promise<Fixture>]>([
    ['the manifest records another', { version: '1.0.5', files: { 'config.json': 'config 1.0.5\n' } }, BASE],
    ['the manifest records it too', { version: '1.0.6', files: { 'config.json': APP['config.json'] } }, BASE],
    ['a known release shipped it too', null, APP_TEXT_KNOWN],
  ])("compares with the app's copy first: its fingerprint is up to date when %s", async (_rule, manifest, fixture) => {
    const plan = await planOf({}, manifest, fixture)
    expect(listsOf(plan)).toEqual(NO_LISTS)
    expect(plan.news).toBe(false)
  })

  it.each<[string, Changes, ManifestTexts, Partial<Lists>, boolean]>([
    [
      'files',
      { 'config.json': 'config by 1.0.6-rc\n' },
      { version: '1.0.5', files: { 'Config.JSON': 'config by 1.0.6-rc\n' } },
      { replace: ['config.json'] },
      true,
    ],
    [
      'deleted',
      { 'ahk/commands/windows.ahk': null },
      { version: '1.0.5', deleted: ['AHK/Commands/Windows.ahk'] },
      { deleted: ['ahk/commands/windows.ahk'] },
      false,
    ],
    [
      'offered',
      { 'config.json': 'my config\n' },
      { version: '1.0.6', offered: { 'CONFIG.json': APP['config.json'] } },
      { changed: ['config.json'] },
      false,
    ],
  ])("reads the manifest's %s ignoring the case of the path", async (_key, changes, manifest, lists, news) => {
    const plan = await planOf(changes, manifest)
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, ...lists })
    expect(plan.news).toBe(news)
  })

  it('counts a file that differs only in its line ends as up to date', async () => {
    const plan = await planOf({ 'config.json': 'config 1.0.6\r\n' })
    expect(listsOf(plan)).toEqual(NO_LISTS)
  })

  it('records in seen each path looked at with its fingerprint, or null when the folder has none', async () => {
    const plan = await planOf({ 'config.json': 'config 1.0.5\n' })
    expect(plan.seen).toEqual({
      'ahk/commands/gone.ahk': null,
      'ahk/commands/windows.ahk': await print('ahk/commands/windows.ahk', APP['ahk/commands/windows.ahk']),
      'ahk/lib/json.ahk': await print('ahk/lib/json.ahk', APP['ahk/lib/json.ahk']),
      'config.json': await print('config.json', 'config 1.0.5\n'),
      'powershell/commands/custom/new.ps1': await print('powershell/commands/custom/new.ps1', APP['powershell/commands/custom/new.ps1']),
      'powershell/commands/custom/ssh.ps1': await print('powershell/commands/custom/ssh.ps1', APP['powershell/commands/custom/ssh.ps1']),
    })
  })

  it('counts a file that goes between the listing and the read as missing', async () => {
    class Vanishing extends MemoryFolder {
      override readBytes(path: string): Promise<Uint8Array | null> {
        return path === 'ahk/lib/json.ahk' ? Promise.resolve(null) : super.readBytes(path)
      }
    }
    const { app, index, known } = await BASE
    const plan = await planUpdate(new Vanishing('scripts', app), index, known)
    expect(plan.add).toEqual(['ahk/lib/json.ahk'])
    expect(plan.seen['ahk/lib/json.ahk']).toBeNull()
  })

  it('sorts each list by the code units of the lower-case path', async () => {
    const plan = await planOf({
      'config.json': null,
      'Config.json': 'config 1.0.5\n',
      'ahk/lib/json.ahk': 'json 1.0.4\n',
      'ahk/commands/Zed.ahk': 'z\n',
      'ahk/commands/custom/mine.ahk': 'm\n',
      'ahk/commands/b.AHK': 'b\n',
    })
    expect(plan.replace).toEqual(['ahk/lib/json.ahk', 'Config.json'])
    expect(plan.ownAhkCommandFiles).toEqual(['ahk/commands/b.AHK', 'ahk/commands/custom/mine.ahk', 'ahk/commands/Zed.ahk'])
  })

  it("gives the person's own AutoHotkey command files from anywhere under ahk/commands, and nothing else", async () => {
    const plan = await planOf({
      'ahk/commands/deep/er/one.ahk': '1\n',
      'ahk/commands/notes.txt': 'n\n',
      'ahk/lib/mine.ahk': 'm\n',
      'powershell/commands/custom/mine.ps1': 'p\n',
    })
    expect(plan.ownAhkCommandFiles).toEqual(['ahk/commands/deep/er/one.ahk'])
  })
})

describe('planUpdate: a folder without a manifest', () => {
  it.each<[string, Changes, Partial<Lists>]>([
    ['replaces a file of a known release', { 'ahk/lib/json.ahk': 'json 1.0.4\n' }, { replace: ['ahk/lib/json.ahk'] }],
    [
      'counts a missing command file that a known release shipped as deleted',
      { 'powershell/commands/custom/ssh.ps1': null },
      { deleted: ['powershell/commands/custom/ssh.ps1'] },
    ],
    [
      'adds a missing command file that no known release shipped, new in the app',
      { 'powershell/commands/custom/new.ps1': null },
      { add: ['powershell/commands/custom/new.ps1'] },
    ],
    ['adds a missing ahk/lib file', { 'ahk/lib/json.ahk': null }, { add: ['ahk/lib/json.ahk'] }],
    ['counts a file of no known release as changed', { 'ahk/lib/json.ahk': 'my json\n' }, { changed: ['ahk/lib/json.ahk'] }],
  ])('%s', async (_rule, changes, lists) => {
    const plan = await planOf(changes)
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, ...lists })
    expect(plan.manifest).toBeNull()
  })

  it.each<[string, Changes, string | null]>([
    ['the newest release whose files were found', { 'config.json': 'config 1.0.5\n', 'ahk/lib/json.ahk': 'json 1.0.4\n' }, '1.0.5'],
    [
      'the oldest release that shipped each content, not the newest',
      { 'ahk/lib/json.ahk': 'json 1.0.4\n', 'ahk/commands/windows.ahk': 'windows 1.0.2\n' },
      '1.0.4',
    ],
    ['null when no file is one a known release shipped', { 'config.json': 'my config\n' }, null],
  ])('says the scripts are from %s', async (_rule, changes, from) => {
    expect((await planOf(changes)).from).toBe(from)
  })

  it('plans a malformed manifest as no manifest', async () => {
    const plan = await planOf({
      [MANIFEST_PATH]: '{ "version": "1.0.5", ',
      'config.json': 'config 1.0.5\n',
      'powershell/commands/custom/ssh.ps1': null,
    })
    expect(plan.manifest).toBeNull()
    expect(plan.from).toBe('1.0.5')
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, replace: ['config.json'], deleted: ['powershell/commands/custom/ssh.ps1'] })
  })
})

describe('planUpdate: a folder with a manifest', () => {
  it("says the scripts are from the manifest's version, whatever the files say", async () => {
    const plan = await planOf({ 'config.json': 'config 1.0.5\n' }, { version: '1.0.3' })
    expect(plan.from).toBe('1.0.3')
    expect(plan.manifest?.version).toBe('1.0.3')
  })

  it.each([['next'], ['2.0']])('says nothing of where the scripts are from, nor skips, for a manifest version %s', async (version) => {
    const plan = await planOf({}, { version })
    expect(plan.skip).toBeNull()
    expect(plan.from).toBeNull()
    expect(plan.manifest?.version).toBe(version)
  })

  it('adds a missing command file the manifest does not name as deleted', async () => {
    const plan = await planOf({ 'powershell/commands/custom/ssh.ps1': null }, { version: '1.0.5', deleted: [] })
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, add: ['powershell/commands/custom/ssh.ps1'] })
  })
})

describe('planUpdate: a folder that is not checked', () => {
  it.each<[string, Changes]>([
    ['a .git folder', { '.git/HEAD': 'ref: refs/heads/main\n' }],
    ['a .git file', { '.git': 'gitdir: ../repo/.git\n' }],
  ])('skips a root with %s, after listing only the root', async (_entry, changes) => {
    const { app, index, known } = await BASE
    const folder = await guarded(await folderOf(app, { ...changes, 'config.json': 'config 1.0.5\n' }, { version: '1.0.5' }))
    const plan = await planUpdate(folder, index, known)
    expect(plan).toEqual({
      skip: { reason: 'git' },
      from: null,
      to: '1.0.6',
      ...NO_LISTS,
      list: 'none',
      news: false,
      seen: {},
      ownAhkCommandFiles: [],
      unfinished: [],
      switchedOff: [],
      manifest: null,
    })
    expect(folder.calls).toEqual([{ op: 'list', path: '' }])
  })

  it.each<[string, string, string, Changes]>([
    ['1.0.6', '1.0.9', 'a file to replace', { 'config.json': 'config 1.0.5\n' }],
    ['1.0.0-dev', '1.0.4', 'a file to replace', { 'config.json': 'config 1.0.5\n' }],
    // The manifest's skip does not depend on news.
    ['1.0.6', '1.0.9', 'nothing to offer', {}],
  ])('skips a %s app for a folder whose manifest is %s, which is newer, with %s', async (appVersion, folderVersion, _what, changes) => {
    const { app, index, known } = await BASE
    const folder = await folderOf(app, changes, { version: folderVersion })
    const plan = await planUpdate(folder, { ...index, version: appVersion }, known)
    expect(plan).toEqual({
      skip: { reason: 'newer', folderVersion },
      from: folderVersion,
      to: appVersion,
      ...NO_LISTS,
      list: 'none',
      news: false,
      seen: {},
      ownAhkCommandFiles: [],
      unfinished: [],
      switchedOff: [],
      manifest: { version: folderVersion, files: {}, deleted: [], offered: {} },
    })
  })

  /** No manifest, and config.json as 1.0.5 shipped it: the scripts are from 1.0.5. */
  const FROM_105: Changes = { 'config.json': 'config 1.0.5\n' }

  /** The base, where 1.0.5 already shipped ahk/lib/json.ahk as the app's copy has it. */
  const JSON_KNOWN = fixtureOf(APP, { ...OLD, 'ahk/lib/json.ahk': { ...OLD['ahk/lib/json.ahk'], [APP['ahk/lib/json.ahk']]: ['1.0.5'] } })

  it.each<[string, Promise<Fixture>, Changes]>([
    ['config.json of an older known content, to replace', BASE, FROM_105],
    // The only difference is a file the person changed: with no manifest, nothing says it was offered before.
    ['ahk/lib/json.ahk as 1.0.5 shipped it and config.json changed by the person', JSON_KNOWN, { 'config.json': 'my config\n' }],
  ])('skips a 1.0.0-dev app for a folder without a manifest whose files are of 1.0.5, which is newer: %s', async (_what, fixture, changes) => {
    const { app, index, known } = await fixture
    const plan = await planUpdate(await folderOf(app, changes, null), { ...index, version: '1.0.0-dev' }, known)
    expect(plan).toEqual({
      skip: { reason: 'newer', folderVersion: '1.0.5' },
      from: '1.0.5',
      to: '1.0.0-dev',
      ...NO_LISTS,
      list: 'none',
      news: false,
      seen: {},
      ownAhkCommandFiles: [],
      unfinished: [],
      switchedOff: [],
      manifest: null,
    })
  })

  it('plans as usual, with no news, a folder without a manifest whose files are the app copy and of 1.0.5, for a 1.0.0-dev app', async () => {
    // The app's own files, as a developer opens them: config.json as 1.0.5 shipped it, which is also the app's copy.
    const { app, index, known } = await APP_TEXT_KNOWN
    const plan = await planUpdate(await folderOf(app, {}, null), { ...index, version: '1.0.0-dev' }, known)
    expect(plan.skip).toBeNull()
    expect(plan.news).toBe(false)
    expect(plan.from).toBe('1.0.5')
    expect(plan.to).toBe('1.0.0-dev')
    expect(listsOf(plan)).toEqual(NO_LISTS)
    expect(plan.seen['config.json']).toBe(index.files['config.json'])
  })

  it.each([
    ['1.0.5', 'of the same version'],
    ['1.0.6', 'newer'],
  ])('checks a folder without a manifest whose files are of 1.0.5 for a %s app, which is %s', async (appVersion) => {
    const { app, index, known } = await BASE
    const plan = await planUpdate(await folderOf(app, FROM_105, null), { ...index, version: appVersion }, known)
    expect(plan.skip).toBeNull()
    expect(plan.from).toBe('1.0.5')
    expect(plan.to).toBe(appVersion)
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, replace: ['config.json'] })
    expect(plan.news).toBe(true)
  })
})

describe('planUpdate: news', () => {
  it('is true with one file to replace', async () => {
    const plan = await planOf({ 'config.json': 'config 1.0.5\n' })
    expect(plan.replace).toHaveLength(1)
    expect(plan.news).toBe(true)
  })

  const RC = 'config by 1.0.6-rc\n'
  it.each<[string, ManifestTexts | null, boolean]>([
    ['no manifest', null, true],
    ['a manifest that names it in neither offered nor files', { version: '1.0.6' }, true],
    ["an offered entry equal to the app's copy's", { version: '1.0.6', offered: { 'config.json': APP['config.json'] } }, false],
    ["an offered entry that differs from the app's copy's", { version: '1.0.6', offered: { 'config.json': 'config 1.0.5\n' } }, true],
    ["no offered entry and a files entry equal to the app's copy's", { version: '1.0.6', files: { 'config.json': APP['config.json'] } }, false],
    ["no offered entry and a files entry that differs from the app's copy's", { version: '1.0.6', files: { 'config.json': RC } }, true],
    [
      "an offered entry equal to the app's copy's over a files entry that differs",
      { version: '1.0.6', files: { 'config.json': RC }, offered: { 'config.json': APP['config.json'] } },
      false,
    ],
  ])('for a changed file, with %s', async (_rule, manifest, news) => {
    const plan = await planOf({ 'config.json': 'my config\n' }, manifest)
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, changed: ['config.json'] })
    expect(plan.news).toBe(news)
  })

  it.each<[string, Changes]>([
    ['a deleted command file', { 'powershell/commands/custom/ssh.ps1': null }],
    ['a removed file the person changed', { 'ahk/commands/gone.ahk': 'my gone\n' }],
    ['an include file to replace for its list alone', { 'ahk/config.ahk': lines('; config 1.0.6', WINDOWS_LINE, CHROME_LINE, MINE_LINE) }],
    [
      "an include file of the app's body with the person's own command file switched off",
      { 'ahk/commands/custom/mine.ahk': 'mine\n' },
    ],
    ["an include file of the app's body with a shared command file switched off", { 'ahk/config.ahk': lines('; config 1.0.6', CHROME_LINE) }],
  ])('is false for %s alone', async (_rule, changes) => {
    const plan = await planOf(changes, null, LISTED)
    expect(plan.replace.length + plan.add.length + plan.remove.length).toBe(0)
    expect(plan.news).toBe(false)
  })

  it.each<[string, ManifestTexts | null]>([
    ['no manifest', null],
    [
      'a manifest that records the earlier body',
      { version: '1.0.5', files: { 'ahk/config.ahk': lines('; config 1.0.5', CHROME_LINE), 'ahk/commands/windows.ahk': 'windows 1.0.2\n' } },
    ],
  ])('is true for an include file of an earlier body with a command file switched off, with %s', async (_rule, manifest) => {
    const plan = await planOf({ 'ahk/config.ahk': lines('; config 1.0.5', CHROME_LINE) }, manifest, LISTED)
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, changed: ['ahk/config.ahk'] })
    expect(plan.news).toBe(true)
  })
})

describe('planUpdate: the include file', () => {
  it.each<[string, Changes, ManifestTexts | null, Partial<Lists>, UpdatePlan['list']]>([
    ['missing: added, replaced', { 'ahk/config.ahk': null }, null, { add: ['ahk/config.ahk'] }, 'replace'],
    ["the app's body, listing exactly the files it will hold: left", {}, null, {}, 'none'],
    [
      "the app's body, still listing a command file the person deleted: replaced",
      { 'ahk/commands/custom/chrome.ahk': null },
      null,
      { deleted: ['ahk/commands/custom/chrome.ahk'] },
      'replace',
    ],
    // What is not an edit: a missing line for a deleted command file, a line for one of the person's own, a line in another case.
    [
      "the app's body, without the line of a command file the person deleted: left",
      { 'ahk/config.ahk': lines('; config 1.0.6', WINDOWS_LINE), 'ahk/commands/custom/chrome.ahk': null },
      null,
      { deleted: ['ahk/commands/custom/chrome.ahk'] },
      'none',
    ],
    [
      "the app's body, listing the person's own command file: left",
      { 'ahk/config.ahk': lines('; config 1.0.6', WINDOWS_LINE, CHROME_LINE, MINE_LINE), 'ahk/commands/custom/mine.ahk': 'mine\n' },
      null,
      {},
      'none',
    ],
    [
      "the app's body, listing a command file in another case: left",
      { 'ahk/config.ahk': lines('; config 1.0.6', String.raw`#Include commands\WINDOWS.ahk`, CHROME_LINE) },
      null,
      {},
      'none',
    ],
    // A command file in the folder without its line was switched off by the person: an edit, kept.
    [
      "the app's body, without the line of the person's own command file: changed, kept, its list left",
      { 'ahk/commands/custom/mine.ahk': 'mine\n' },
      null,
      { changed: ['ahk/config.ahk'] },
      'none',
    ],
    [
      "the app's body, without the line of a shared command file: changed, kept, its list left",
      { 'ahk/config.ahk': lines('; config 1.0.6', CHROME_LINE) },
      null,
      { changed: ['ahk/config.ahk'] },
      'none',
    ],
    [
      "the app's body, without the line of a shared command file, with a command file to add: changed, kept, its list adjusted",
      { 'ahk/config.ahk': lines('; config 1.0.6', CHROME_LINE), 'ahk/commands/custom/chrome.ahk': null },
      { version: '1.0.5', files: { 'ahk/commands/windows.ahk': 'windows 1.0.2\n' } },
      { changed: ['ahk/config.ahk'], add: ['ahk/commands/custom/chrome.ahk'] },
      'adjust',
    ],
    [
      "an earlier body, without the line of the person's own command file, with a command file to remove: changed, kept, its list adjusted",
      {
        'ahk/config.ahk': lines('; config 1.0.5', WINDOWS_LINE, CHROME_LINE, String.raw`#Include commands\gone.ahk`),
        'ahk/commands/custom/mine.ahk': 'mine\n',
        'ahk/commands/gone.ahk': 'gone 1.0.4\n',
      },
      null,
      { changed: ['ahk/config.ahk'], remove: ['ahk/commands/gone.ahk'] },
      'adjust',
    ],
    // A command file the update removes is not switched off: the folder will not hold it. One kept, the app no longer has, is.
    [
      "the app's body, without the line of a command file the update removes: left",
      { 'ahk/config.ahk': lines('; config 1.0.6', WINDOWS_LINE, CHROME_LINE), 'ahk/commands/gone.ahk': 'gone 1.0.4\n' },
      null,
      { remove: ['ahk/commands/gone.ahk'] },
      'none',
    ],
    [
      "the app's body, without the line of a changed command file the app no longer has: changed, kept, its list left",
      { 'ahk/config.ahk': lines('; config 1.0.6', WINDOWS_LINE, CHROME_LINE), 'ahk/commands/gone.ahk': 'my gone\n' },
      null,
      { changed: ['ahk/config.ahk'], keptRemoved: ['ahk/commands/gone.ahk'] },
      'none',
    ],
    [
      'an earlier body, without the line of a shared command file: changed, kept, its list left',
      { 'ahk/config.ahk': lines('; config 1.0.5', CHROME_LINE) },
      null,
      { changed: ['ahk/config.ahk'] },
      'none',
    ],
    [
      "an earlier body with the person's own line and a deleted file's line missing: replaced",
      {
        'ahk/config.ahk': lines('; config 1.0.5', WINDOWS_LINE, MINE_LINE),
        'ahk/commands/custom/mine.ahk': 'mine\n',
        'ahk/commands/custom/chrome.ahk': null,
      },
      null,
      { replace: ['ahk/config.ahk'], deleted: ['ahk/commands/custom/chrome.ahk'] },
      'replace',
    ],
    [
      'a changed body, with a command file to add: kept, its list adjusted',
      { 'ahk/config.ahk': lines('; my config', WINDOWS_LINE), 'ahk/commands/custom/chrome.ahk': null },
      { version: '1.0.5' },
      { changed: ['ahk/config.ahk'], add: ['ahk/commands/custom/chrome.ahk'] },
      'adjust',
    ],
    [
      'a changed body, with a command file to remove: kept, its list adjusted',
      { 'ahk/config.ahk': lines('; my config', WINDOWS_LINE, CHROME_LINE), 'ahk/commands/gone.ahk': 'gone 1.0.4\n' },
      null,
      { changed: ['ahk/config.ahk'], remove: ['ahk/commands/gone.ahk'] },
      'adjust',
    ],
    [
      'a changed body, with no command file added or removed: kept, its list left',
      { 'ahk/config.ahk': lines('; my config', WINDOWS_LINE, CHROME_LINE), 'ahk/lib/json.ahk': null },
      null,
      { changed: ['ahk/config.ahk'], add: ['ahk/lib/json.ahk'] },
      'none',
    ],
  ])('%s', async (_row, changes, manifest, lists, list) => {
    const plan = await planOf(changes, manifest, LISTED)
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, ...lists })
    expect(plan.list).toBe(list)
  })

  /** LISTED, where the app's copy has a command file no release shipped. */
  const NEW_LINE = String.raw`#Include commands\custom\new.ahk`
  const WITH_NEW = fixtureOf(
    {
      ...LISTED_APP,
      'ahk/commands/custom/new.ahk': 'new 1.0.6\n',
      'ahk/config.ahk': lines('; config 1.0.6', WINDOWS_LINE, CHROME_LINE, NEW_LINE),
    },
    LISTED_OLD,
  )
  const CHROME_OFF: Changes = { 'ahk/config.ahk': lines('; config 1.0.6', WINDOWS_LINE) }

  it.each<[string, Changes, ManifestTexts | null, Promise<Fixture>, string[], UpdatePlan['list'], string[]]>([
    [
      'one no release shipped, in a folder without a manifest',
      { 'ahk/config.ahk': lines('; config 1.0.5', WINDOWS_LINE, CHROME_LINE) },
      null,
      WITH_NEW,
      ['ahk/config.ahk'],
      'replace',
      ['ahk/commands/custom/new.ahk'],
    ],
    [
      'one the manifest does not name',
      CHROME_OFF,
      { version: '1.0.5', files: { 'ahk/commands/windows.ahk': 'windows 1.0.6\n' } },
      LISTED,
      [],
      'replace',
      ['ahk/commands/custom/chrome.ahk'],
    ],
    [
      'one the manifest names as deleted',
      CHROME_OFF,
      {
        version: '1.0.5',
        files: { 'ahk/commands/windows.ahk': 'windows 1.0.6\n', 'ahk/commands/custom/chrome.ahk': 'chrome 1.0.5\n' },
        deleted: ['ahk/commands/custom/chrome.ahk'],
      },
      LISTED,
      [],
      'replace',
      ['ahk/commands/custom/chrome.ahk'],
    ],
  ])(
    "does not count a missing line for a command file of the app's copy the folder had no record of, %s: an update that stopped wrote it",
    async (_case, changes, manifest, fixture, replace, list, unfinished) => {
      const plan = await planOf(changes, manifest, fixture)
      expect(plan.unfinished).toEqual(unfinished)
      expect(plan.changed).toEqual([])
      expect(plan.replace).toEqual(replace)
      expect(plan.list).toBe(list)
    },
  )

  it('adjusts the list of a changed include file that leaves out an unfinished command file, so the update puts its line in', async () => {
    const plan = await planOf({ 'ahk/config.ahk': lines('; my config', WINDOWS_LINE, CHROME_LINE) }, null, WITH_NEW)
    expect(plan.unfinished).toEqual(['ahk/commands/custom/new.ahk'])
    expect(plan.changed).toEqual(['ahk/config.ahk'])
    expect(plan.list).toBe('adjust')
  })

  it.each<[string, Changes, ManifestTexts | null]>([
    [
      'the manifest names it',
      CHROME_OFF,
      { version: '1.0.6', files: { 'ahk/commands/windows.ahk': 'windows 1.0.6\n', 'ahk/commands/custom/chrome.ahk': 'chrome 1.0.6\n' } },
    ],
    ['a release shipped it, without a manifest', CHROME_OFF, null],
    [
      'the manifest names it only among its offers, as a changed file kept at an update',
      CHROME_OFF,
      { version: '1.0.6', files: { 'ahk/commands/windows.ahk': 'windows 1.0.6\n' }, offered: { 'ahk/commands/custom/chrome.ahk': 'chrome 1.0.6\n' } },
    ],
    [
      "it is not as the app's copy has it",
      { ...CHROME_OFF, 'ahk/commands/custom/chrome.ahk': 'my chrome\n' },
      { version: '1.0.5', files: { 'ahk/commands/windows.ahk': 'windows 1.0.6\n' } },
    ],
  ])("counts a missing line for a command file of the app's copy when %s", async (_case, changes, manifest) => {
    const plan = await planOf(changes, manifest, LISTED)
    expect(plan.unfinished).toEqual([])
    expect(plan.changed).toContain('ahk/config.ahk')
  })

  it("names a kept removed command file among the folder's own, so a list that names it is left", async () => {
    const GONE_LINE = String.raw`#Include commands\gone.ahk`
    const plan = await planOf(
      { 'ahk/commands/gone.ahk': 'my gone\n', 'ahk/config.ahk': lines('; config 1.0.6', WINDOWS_LINE, GONE_LINE, CHROME_LINE) },
      null,
      LISTED,
    )
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, keptRemoved: ['ahk/commands/gone.ahk'] })
    expect(plan.ownAhkCommandFiles).toEqual(['ahk/commands/gone.ahk'])
    expect(plan.list).toBe('none')
  })

  it('keeps an include file the app no longer has when it switches a command off, though a release shipped it as it is', async () => {
    const plan = await planOf({ 'ahk/config.ahk': lines('; config 1.0.5', CHROME_LINE) }, null, fixtureOf(APP, LISTED_OLD))
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, keptRemoved: ['ahk/config.ahk'] })
  })

  it('is left alone when no version has one', async () => {
    expect((await planOf()).list).toBe('none')
  })
})

describe('planUpdate: the command files switched off', () => {
  it.each<[string, Changes, string[]]>([
    ['none, with every line in', {}, []],
    ["the person's own command file without its line", { 'ahk/commands/custom/mine.ahk': 'mine\n' }, ['ahk/commands/custom/mine.ahk']],
    ['a shared command file without its line', { 'ahk/config.ahk': lines('; my config', CHROME_LINE) }, ['ahk/commands/windows.ahk']],
    ['both, in the order of their lower-case paths', { 'ahk/config.ahk': lines('; config 1.0.5'), 'ahk/commands/custom/Mine.ahk': 'mine\n' }, ['ahk/commands/custom/chrome.ahk', 'ahk/commands/custom/Mine.ahk', 'ahk/commands/windows.ahk']],
    // Not switched off: a deleted command file's line, and the line of a command file the update removes.
    ['none, for a deleted command file without its line', { 'ahk/config.ahk': lines('; config 1.0.6', WINDOWS_LINE), 'ahk/commands/custom/chrome.ahk': null }, []],
    ['none, for a command file the update removes without its line', { 'ahk/commands/gone.ahk': 'gone 1.0.4\n' }, []],
  ])('names %s', async (_row, changes, switchedOff) => {
    const plan = await planOf(changes, null, LISTED)
    expect(plan.switchedOff).toEqual(switchedOff)
  })
})

describe('planUpdate: how the folder spells a path', () => {
  it('replaces ahk/Commands/Windows.ahk of a known release once, spelled as the folder has it', async () => {
    const plan = await planOf({ 'ahk/commands/windows.ahk': null, 'ahk/Commands/Windows.ahk': 'windows 1.0.2\n' })
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, replace: ['ahk/Commands/Windows.ahk'] })
    expect(Object.keys(plan.seen)).toContain('ahk/Commands/Windows.ahk')
    expect(Object.keys(plan.seen)).not.toContain('ahk/commands/windows.ahk')
  })

  it('takes the first of two names that differ only by case, and that one only', async () => {
    const plan = await planOf({ 'ahk/commands/windows.ahk': 'my windows\n', 'ahk/commands/Windows.ahk': 'windows 1.0.2\n' })
    expect(listsOf(plan)).toEqual({ ...NO_LISTS, replace: ['ahk/commands/Windows.ahk'] })
    expect(plan.ownAhkCommandFiles).toEqual([])
  })

  it("spells a path the folder does not have as the app's copy has it", async () => {
    const { app, index, known } = await BASE
    const files = Object.fromEntries(
      Object.entries(index.files).map(([path, sum]) => [path === 'ahk/lib/json.ahk' ? 'AHK/Lib/JSON.ahk' : path, sum]),
    )
    const plan = await planUpdate(await folderOf(app, { 'ahk/lib/json.ahk': null }, null), { ...index, files }, known)
    expect(plan.add).toEqual(['AHK/Lib/JSON.ahk'])
  })
})

describe('planUpdate: what is never touched', () => {
  it("reads nothing under local/ and no path no version had, and only lists the folder of the person's own file", async () => {
    const { app, index, known } = await BASE
    const changes = {
      'local/configurator.json': '{}\n',
      'local/ahk/commands.ahk': 'x\n',
      'ahk/commands/custom/mine.ahk': 'mine\n',
      'docs/readme.md': 'docs\n',
    }
    const folder = await guarded(await folderOf(app, changes, null))
    const plan = await planUpdate(folder, index, known)
    expect(plan.ownAhkCommandFiles).toEqual(['ahk/commands/custom/mine.ahk'])
    expect(folder.refused).toEqual([])
    expect(folder.calls.filter((call) => call.path === 'ahk/commands/custom/mine.ahk')).toEqual([])
    expect(folder.calls).toContainEqual({ op: 'list', path: 'ahk/commands/custom' })
    expect(folder.calls.map((call) => call.path)).not.toContain('docs')
  })

  it('never looks at a path under local/ even when the manifest names one', async () => {
    const { app, index, known } = await BASE
    const manifest = { version: '1.0.5', files: { 'local/configurator.json': '{}\n' } }
    const folder = await guarded(await folderOf(app, { 'local/configurator.json': '{}\n' }, manifest))
    const plan = await planUpdate(folder, index, known)
    expect(folder.refused).toEqual([])
    expect(Object.keys(plan.seen)).not.toContain('local/configurator.json')
  })
})

describe('planUpdate: a folder that cannot be read', () => {
  it.each([
    ['listing', 'ahk/lib'],
    ['reading', 'config.json'],
  ])('rejects when %s %s fails', async (_what, failing) => {
    class Failing extends MemoryFolder {
      override list(dir: string): Promise<DirEntry[]> {
        return dir === failing ? Promise.reject(new Error('no access')) : super.list(dir)
      }
      override readBytes(path: string): Promise<Uint8Array | null> {
        return path === failing ? Promise.reject(new Error('no access')) : super.readBytes(path)
      }
    }
    const { app, index, known } = await BASE
    await expect(planUpdate(new Failing('scripts', app), index, known)).rejects.toThrow('no access')
  })
})
